"""Per-user LLM token usage tracking and daily quota enforcement.

Attribution model: every authenticated request sets the current user id in a
ContextVar (see ``set_current_user_id``). LLMService reads it when a call
finishes and fire-and-forgets the token counts into ``llm_usage_daily``, so
the quota ledger is kept without blocking responses or threading a user
argument through the ~40 LLM call sites.
"""

import asyncio
import logging
import uuid
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

from fastapi import Depends, HTTPException

from app.config import settings
from app.models.user import User
from app.utils.auth import get_current_user

logger = logging.getLogger(__name__)

# Set by auth/WS entry points to attribute LLM spend to the current user.
_current_user_id: ContextVar[str | None] = ContextVar("current_user_id", default=None)


def set_current_user_id(user_id: str | None) -> None:
    """Attach the current user to this task's context (called after auth)."""
    _current_user_id.set(user_id)


def get_current_user_id() -> str | None:
    """Return the authenticated user id for the current task, if any."""
    return _current_user_id.get()


def estimate_tokens(messages: list[dict[str, Any]], output_text: str = "") -> dict[str, int]:
    """Coarse token estimate (~3 chars/token) for streams that omit usage.

    Used as a fallback so streaming calls still count toward the quota even
    when the provider does not report per-stream token usage.
    """
    input_tokens = sum(len(str(m.get("content", ""))) for m in messages) // 3
    output_tokens = len(output_text) // 3
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
    }


async def persist_usage(user_id: str, usage: dict[str, int] | None) -> None:
    """Upsert a user's daily token totals. Never raises — accounting must not
    break the request path."""
    try:
        if not user_id or not usage or not usage.get("total_tokens"):
            return
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        from app.database import async_session
        from app.models.llm_usage import LLMUsageDaily

        today = datetime.now(UTC).date()
        stmt = pg_insert(LLMUsageDaily).values(
            user_id=uuid.UUID(user_id),
            usage_date=today,
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            total_tokens=usage.get("total_tokens", 0),
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[LLMUsageDaily.user_id, LLMUsageDaily.usage_date],
            set_={
                "input_tokens": LLMUsageDaily.input_tokens + stmt.excluded.input_tokens,
                "output_tokens": LLMUsageDaily.output_tokens + stmt.excluded.output_tokens,
                "total_tokens": LLMUsageDaily.total_tokens + stmt.excluded.total_tokens,
            },
        )
        async with async_session() as db:
            await db.execute(stmt)
            await db.commit()
    except Exception as e:
        logger.warning("Failed to persist LLM usage: %s", e)


def schedule_usage_record(user_id: str | None, usage: dict[str, int] | None) -> None:
    """Fire-and-forget usage persistence (never blocks the response)."""
    if not user_id or not usage:
        return
    asyncio.create_task(persist_usage(user_id, usage))


async def get_daily_total(user_id: uuid.UUID) -> int:
    """Return today's total tokens consumed by a user."""
    from sqlalchemy import func, select

    from app.database import async_session
    from app.models.llm_usage import LLMUsageDaily

    today = datetime.now(UTC).date()
    async with async_session() as db:
        result = await db.execute(
            select(func.coalesce(func.sum(LLMUsageDaily.total_tokens), 0)).where(
                LLMUsageDaily.user_id == user_id,
                LLMUsageDaily.usage_date == today,
            )
        )
        return int(result.scalar() or 0)


async def llm_quota_guard(user: User = Depends(get_current_user)) -> None:
    """FastAPI dependency: reject LLM requests once the daily quota is spent.

    A quota of 0 (default) disables enforcement.
    """
    if settings.llm_daily_quota_tokens <= 0:
        return
    total = await get_daily_total(user.id)
    if total >= settings.llm_daily_quota_tokens:
        raise HTTPException(
            status_code=429,
            detail=(
                f"今日 LLM 配额已用尽（{total}/{settings.llm_daily_quota_tokens} tokens），"
                "请明天再试"
            ),
        )

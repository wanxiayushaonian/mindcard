"""SplitGuard — prevents excessive forking in chat conversations.

Checks three conditions before allowing a fork:
1. At least N messages have been exchanged since the last fork divider IN THIS BRANCH.
2. No sibling fork shares the same branch label (scoped to the same parent branch).
3. At least M messages have been exchanged since the most recent fork divider ANYWHERE
   in the chat (global cross-branch cooldown). This prevents immediately nesting a fork
   inside a freshly created child branch.

All checks are pure DB queries — no in-memory state, so they work correctly across
multiple uvicorn workers and survive process restarts.
"""

import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatMessage

logger = logging.getLogger(__name__)


async def get_last_fork_message(
    db: AsyncSession, chat_id: str, fork_id: str | None
) -> dict | None:
    """Get the last fork-divider message in the current branch scope."""
    query = (
        select(ChatMessage)
        .where(
            ChatMessage.chat_id == chat_id,
            ChatMessage.role == "fork-divider",
        )
        .order_by(ChatMessage.created_at.desc())
        .limit(1)
    )
    if fork_id:
        query = query.where(ChatMessage.fork_id == fork_id)
    result = await db.execute(query)
    msg = result.scalar_one_or_none()
    if msg:
        return {"id": str(msg.id), "created_at": msg.created_at}
    return None


async def get_message_count_since(
    db: AsyncSession,
    chat_id: str,
    since_msg: dict | None,
    fork_id: str | None,
) -> int:
    """Count user/assistant messages since the last fork divider."""
    query = select(func.count()).select_from(ChatMessage).where(
        ChatMessage.chat_id == chat_id,
        ChatMessage.role.in_(["user", "assistant"]),
    )
    if fork_id:
        query = query.where(ChatMessage.fork_id == fork_id)
    if since_msg:
        query = query.where(ChatMessage.created_at > since_msg["created_at"])
    result = await db.execute(query)
    return result.scalar() or 0


async def get_sibling_fork_labels(
    db: AsyncSession, chat_id: str, fork_id: str | None
) -> list[str]:
    """Get labels of sibling forks scoped to the same parent branch.

    Only looks at fork-dividers whose fork_id matches the current branch scope,
    preventing false duplicate-label rejections across unrelated branches.
    """
    query = select(ChatMessage).where(
        ChatMessage.chat_id == chat_id,
        ChatMessage.role == "fork-divider",
    )
    if fork_id:
        query = query.where(ChatMessage.fork_id == fork_id)
    else:
        query = query.where(ChatMessage.fork_id.is_(None))
    result = await db.execute(query)
    messages = result.scalars().all()
    return [
        meta["branch_label"]
        for m in messages
        if (meta := (m.metadata_ or {})) and meta.get("branch_label")
    ]


async def get_global_messages_since_last_fork(
    db: AsyncSession, chat_id: str
) -> int:
    """Count user/assistant messages since the most recent fork-divider anywhere in chat.

    Returns 0 if no fork has ever occurred (first fork is always allowed by this check).
    Returns a large sentinel (9999) when no prior fork exists so condition 3 is skipped.
    """
    latest_fork = await db.execute(
        select(ChatMessage.created_at)
        .where(ChatMessage.chat_id == chat_id, ChatMessage.role == "fork-divider")
        .order_by(ChatMessage.created_at.desc())
        .limit(1)
    )
    last_fork_at = latest_fork.scalar_one_or_none()
    if last_fork_at is None:
        return 9999  # No prior fork — skip global cooldown

    count_result = await db.execute(
        select(func.count()).select_from(ChatMessage).where(
            ChatMessage.chat_id == chat_id,
            ChatMessage.role.in_(["user", "assistant"]),
            ChatMessage.created_at > last_fork_at,
        )
    )
    return count_result.scalar() or 0


class SplitGuard:
    """Prevent excessive forking in chat conversations.

    All state is derived from the DB on each call — no instance state,
    so the singleton is safe across workers.

    Args:
        min_messages_between_forks: Minimum user/assistant messages required
            in the current branch since the last fork-divider (branch-local check).
        cooldown_messages: Minimum user/assistant messages required globally
            (any branch) since the most recent fork-divider (cross-branch check).
    """

    def __init__(
        self,
        min_messages_between_forks: int = 5,
        cooldown_messages: int = 3,
    ):
        self.min_messages_between_forks = min_messages_between_forks
        self.cooldown_messages = cooldown_messages

    def record_split(self, chat_id: str, message_count: int) -> None:
        """No-op: state is now fully DB-driven."""

    async def can_fork(
        self,
        db: AsyncSession,
        chat_id: str,
        current_fork_id: str | None,
        label: str,
    ) -> bool:
        """Check whether a new fork is allowed.

        Returns True when all conditions pass:
        1. Enough messages in this branch since the last branch-local fork-divider.
        2. The proposed label is unique among siblings in the same branch scope.
        3. Enough messages globally since the most recent fork anywhere in the chat.
        """
        # 1. Branch-local message interval (skipped if no prior fork in this branch)
        last_fork = await get_last_fork_message(db, chat_id, current_fork_id)
        if last_fork is not None:
            msg_count = await get_message_count_since(db, chat_id, last_fork, current_fork_id)
            if msg_count < self.min_messages_between_forks:
                logger.info(
                    "SplitGuard: blocked fork, only %d messages since last branch fork (need %d)",
                    msg_count, self.min_messages_between_forks,
                )
                return False

        # 2. Duplicate label check (scoped to sibling branches only)
        siblings = await get_sibling_fork_labels(db, chat_id, current_fork_id)
        if label in siblings:
            logger.info(
                "SplitGuard: blocked fork, duplicate label '%s' among siblings",
                label,
            )
            return False

        # 3. Global cross-branch cooldown
        global_count = await get_global_messages_since_last_fork(db, chat_id)
        if global_count < self.cooldown_messages:
            logger.info(
                "SplitGuard: blocked fork, global cooldown (%d messages since last fork, need %d)",
                global_count, self.cooldown_messages,
            )
            return False

        return True


split_guard = SplitGuard()

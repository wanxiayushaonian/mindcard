"""SplitGuard — prevents excessive forking in chat conversations.

Checks two conditions before allowing a fork:
1. At least N messages have been exchanged since the last fork divider.
2. No sibling fork shares the same branch label.
"""

import logging
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatMessage

logger = logging.getLogger(__name__)


async def get_last_fork_message(
    db: AsyncSession, chat_id: str, fork_id: str | None
) -> dict[str, Any] | None:
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
    since_msg: dict[str, Any] | None,
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
    """Get labels of sibling forks (same parent scope).

    When fork_id is given, we look for all fork-divider messages in the same
    chat that are *not* inside the current fork branch — i.e. the siblings
    sharing the same parent.  For simplicity we collect all fork-divider
    labels in the chat and let the caller decide uniqueness.
    """
    query = select(ChatMessage).where(
        ChatMessage.chat_id == chat_id,
        ChatMessage.role == "fork-divider",
    )
    result = await db.execute(query)
    messages = result.scalars().all()
    labels: list[str] = []
    for msg in messages:
        meta = msg.metadata_ or {}
        label = meta.get("branch_label", "")
        if label:
            labels.append(label)
    return labels


class SplitGuard:
    """Prevent excessive forking in chat conversations.

    Args:
        min_messages_between_forks: Minimum number of user/assistant messages
            required between consecutive fork dividers.
    """

    def __init__(self, min_messages_between_forks: int = 5):
        self.min_messages_between_forks = min_messages_between_forks

    async def can_fork(
        self,
        db: AsyncSession,
        chat_id: str,
        current_fork_id: str | None,
        label: str,
    ) -> bool:
        """Check whether a new fork is allowed.

        Returns ``True`` when both conditions pass:
        1. Enough messages since the last fork divider.
        2. The proposed *label* is unique among sibling forks.
        """
        # 1. Message interval check
        last_fork = await get_last_fork_message(db, chat_id, current_fork_id)
        msg_count = await get_message_count_since(db, chat_id, last_fork, current_fork_id)
        if msg_count < self.min_messages_between_forks:
            logger.info(
                "SplitGuard: blocked fork, only %d messages since last fork (need %d)",
                msg_count,
                self.min_messages_between_forks,
            )
            return False

        # 2. Duplicate label check
        siblings = await get_sibling_fork_labels(db, chat_id, current_fork_id)
        if label in siblings:
            logger.info(
                "SplitGuard: blocked fork, duplicate label '%s' among siblings",
                label,
            )
            return False

        return True


# Module-level singleton for convenient import
split_guard = SplitGuard()

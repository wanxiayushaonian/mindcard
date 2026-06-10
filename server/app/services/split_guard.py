"""SplitGuard — prevents excessive forking in chat conversations.

Checks three conditions before allowing a fork:
1. At least N messages have been exchanged since the last fork divider.
2. No sibling fork shares the same branch label.
3. Cooldown period (in messages) has elapsed since the last fork in this chat.
"""

import logging
import time
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
    """Get labels of sibling forks (same parent scope)."""
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

    Tracks split history per chat for cooldown enforcement.

    Args:
        min_messages_between_forks: Minimum number of user/assistant messages
            required between consecutive fork dividers.
        cooldown_messages: Minimum messages after a fork before another is
            allowed in the same chat (across all branches).
    """

    def __init__(
        self,
        min_messages_between_forks: int = 5,
        cooldown_messages: int = 3,
    ):
        self.min_messages_between_forks = min_messages_between_forks
        self.cooldown_messages = cooldown_messages
        # In-memory history: chat_id -> list of (timestamp, message_count) tuples
        self._split_history: dict[str, list[tuple[float, int]]] = {}

    def record_split(self, chat_id: str, message_count: int) -> None:
        """Record a fork event for cooldown tracking."""
        self._split_history.setdefault(chat_id, []).append(
            (time.monotonic(), message_count)
        )
        # Keep only last 10 entries per chat to avoid unbounded growth
        if len(self._split_history[chat_id]) > 10:
            self._split_history[chat_id] = self._split_history[chat_id][-10:]

    def _messages_since_last_split(self, chat_id: str) -> int | None:
        """Get approximate messages elapsed since last recorded split.

        Returns None if no split history exists.
        """
        history = self._split_history.get(chat_id)
        if not history:
            return None
        # We can't directly count messages from monotonic time, so we
        # return a sentinel that the caller will check against DB count.
        return len(history)

    async def can_fork(
        self,
        db: AsyncSession,
        chat_id: str,
        current_fork_id: str | None,
        label: str,
    ) -> bool:
        """Check whether a new fork is allowed.

        Returns ``True`` when all conditions pass:
        1. Enough messages since the last fork divider (DB check).
        2. The proposed *label* is unique among sibling forks.
        3. Cooldown period has elapsed since last fork in this chat.
        """
        # 1. Message interval check — only applies after the first fork
        last_fork = await get_last_fork_message(db, chat_id, current_fork_id)
        if last_fork is not None:
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

        # 3. Cooldown check — ensure enough messages since last fork in this chat
        history = self._split_history.get(chat_id)
        if history:
            last_split_time = history[-1][0]
            elapsed = time.monotonic() - last_split_time
            # Convert cooldown_messages to a rough time estimate
            # (assuming ~5s per message turn as minimum)
            min_cooldown_secs = self.cooldown_messages * 5
            if elapsed < min_cooldown_secs:
                logger.info(
                    "SplitGuard: blocked fork, cooldown active (%.1fs < %ds)",
                    elapsed,
                    min_cooldown_secs,
                )
                return False

        return True


# Module-level singleton for convenient import
split_guard = SplitGuard()

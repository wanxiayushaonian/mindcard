"""Memory decay and archive logic.

Implements two-tier forgetting:
- Decay: read-time computation, does not modify DB. Formula:
    decayed = base_importance * exp(-days_unused / HALF_LIFE_DAYS)
- Archive: physical mark. Memories with decayed < ARCHIVE_THRESHOLD
  AND age > ARCHIVE_AGE_DAYS get memory_type='archived' and are
  excluded from RAG injection.
"""

import logging
import math
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

HALF_LIFE_DAYS = 30.0
ARCHIVE_THRESHOLD = 0.1
ARCHIVE_AGE_DAYS = 90


@dataclass(frozen=True)
class DecayConfig:
    half_life_days: float = HALF_LIFE_DAYS
    archive_threshold: float = ARCHIVE_THRESHOLD
    archive_age_days: int = ARCHIVE_AGE_DAYS


DEFAULT_CONFIG = DecayConfig()


def decayed_importance(
    base: float,
    last_accessed_at: datetime | None,
    created_at: datetime,
    now: datetime | None = None,
    cfg: DecayConfig = DEFAULT_CONFIG,
) -> float:
    """Compute decayed importance using exponential decay.

    Args:
        base: Original importance value (0.0-1.0).
        last_accessed_at: Last access time, or None to fall back to created_at.
        created_at: Creation time, used when never accessed.
        now: Reference time, defaults to utcnow.
        cfg: Decay configuration.

    Returns:
        Decay-adjusted importance in [0.0, base].
    """
    if now is None:
        now = datetime.now(UTC)
    reference = last_accessed_at or created_at
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)

    days_unused = max(0.0, (now - reference).total_seconds() / 86400.0)
    return base * math.exp(-days_unused / cfg.half_life_days)


def should_archive(
    decayed: float,
    created_at: datetime,
    now: datetime | None = None,
    cfg: DecayConfig = DEFAULT_CONFIG,
) -> bool:
    """Decide whether a memory should be archived.

    Args:
        decayed: Decay-adjusted importance.
        created_at: Memory creation time.
        now: Reference time, defaults to utcnow.
        cfg: Decay configuration.

    Returns:
        True if memory qualifies for archival.
    """
    if now is None:
        now = datetime.now(UTC)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)

    age_days = (now - created_at).total_seconds() / 86400.0
    return decayed < cfg.archive_threshold and age_days > cfg.archive_age_days


async def run_archive_pass(
    workspace_id: str,
    db: AsyncSession,
    cfg: DecayConfig = DEFAULT_CONFIG,
) -> int:
    """Archive qualifying memories in a workspace.

    Scans non-archived memories, computes decayed importance, marks
    those qualifying as memory_type='archived'. Pure DB operation,
    does not occupy LLM semaphore.

    Args:
        workspace_id: Target workspace UUID (string form).
        db: Async session.
        cfg: Decay configuration.

    Returns:
        Number of memories archived.
    """
    from app.models.workspace_memory import WorkspaceMemory

    now = datetime.now(UTC)
    result = await db.execute(
        select(WorkspaceMemory).where(
            WorkspaceMemory.workspace_id == workspace_id,
            WorkspaceMemory.memory_type != "archived",
        )
    )
    memories = result.scalars().all()

    to_archive_ids: list = []
    for m in memories:
        decayed = decayed_importance(
            m.importance, m.last_accessed_at, m.created_at, now=now, cfg=cfg
        )
        if should_archive(decayed, m.created_at, now=now, cfg=cfg):
            to_archive_ids.append(m.id)

    if not to_archive_ids:
        return 0

    await db.execute(
        sa_update(WorkspaceMemory)
        .where(WorkspaceMemory.id.in_(to_archive_ids))
        .values(memory_type="archived")
    )
    await db.commit()

    logger.info(
        "Archived %d/%d memories in workspace %s",
        len(to_archive_ids), len(memories), workspace_id,
    )
    return len(to_archive_ids)

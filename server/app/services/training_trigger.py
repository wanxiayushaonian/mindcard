import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.card import Card
from app.models.graph import GNNTrainingLog

logger = logging.getLogger(__name__)


async def should_trigger_training(
    workspace_id: uuid.UUID, db: AsyncSession
) -> bool:
    last_training = await db.execute(
        select(GNNTrainingLog)
        .where(
            GNNTrainingLog.workspace_id == workspace_id,
            GNNTrainingLog.status == "completed",
        )
        .order_by(GNNTrainingLog.created_at.desc())
        .limit(1)
    )
    last = last_training.scalar_one_or_none()

    if last is None:
        logger.info("No previous training found for workspace %s, triggering", workspace_id)
        return True

    from datetime import datetime, timezone
    days_since = (datetime.now(timezone.utc) - last.created_at).days
    if days_since >= settings.gnn_training_trigger_days:
        logger.info(
            "Training trigger: %d days since last training (threshold: %d)",
            days_since, settings.gnn_training_trigger_days,
        )
        return True

    new_cards = await db.scalar(
        select(func.count())
        .select_from(Card)
        .where(
            Card.workspace_id == workspace_id,
            Card.created_at > last.created_at,
        )
    ) or 0

    if new_cards >= settings.gnn_training_trigger_cards:
        logger.info(
            "Training trigger: %d new cards since last training (threshold: %d)",
            new_cards, settings.gnn_training_trigger_cards,
        )
        return True

    return False

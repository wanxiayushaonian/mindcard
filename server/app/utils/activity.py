"""Shared helpers for creating notifications and activity log entries."""

import json
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import ActivityLog
from app.models.notification import Notification


async def create_notification(
    db: AsyncSession,
    user_id: uuid.UUID,
    notif_type: str,
    content: str,
    link: str | None = None,
) -> Notification:
    notif = Notification(
        user_id=user_id,
        type=notif_type,
        content=content,
        link=link,
    )
    db.add(notif)
    return notif


async def create_activity(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    action: str,
    target_type: str,
    target_id: str | None = None,
    metadata: dict | None = None,
) -> ActivityLog:
    log = ActivityLog(
        workspace_id=workspace_id,
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        metadata_json=json.dumps(metadata, ensure_ascii=False) if metadata else None,
    )
    db.add(log)
    return log

import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.activity import ActivityLog
from app.models.user import User
from app.schemas.activity import ActivityResponse
from app.utils.auth import get_current_user, get_workspace_membership
from app.utils.helpers import parse_uuid

router = APIRouter()


@router.get("/{workspace_id}", response_model=list[ActivityResponse])
async def list_activities(
    workspace_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ws_id = parse_uuid(workspace_id)
    await get_workspace_membership(ws_id, user, db)

    result = await db.execute(
        select(ActivityLog, User.nickname)
        .outerjoin(User, User.id == ActivityLog.actor_id)
        .where(ActivityLog.workspace_id == ws_id)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
    )
    rows = result.all()
    return [
        ActivityResponse(
            id=log.id,
            actor_nickname=nickname or "",
            action=log.action,
            target_type=log.target_type,
            target_id=log.target_id,
            metadata=json.loads(log.metadata_json) if log.metadata_json else None,
            created_at=log.created_at,
        )
        for log, nickname in rows
    ]

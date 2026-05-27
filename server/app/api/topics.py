import uuid
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.topic import Topic, TopicCard
from app.models.user import User
from app.schemas.topic import TopicListResponse, TopicResponse
from app.services.topic import topic_service
from app.utils.auth import get_current_user, get_workspace_membership, require_role
from app.utils.helpers import parse_uuid

router = APIRouter()


@router.get("/", response_model=TopicListResponse)
async def list_topics(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all topics in a workspace."""
    ws_id = parse_uuid(workspace_id)
    await get_workspace_membership(ws_id, user, db)

    result = await db.execute(
        select(Topic).where(Topic.workspace_id == ws_id).order_by(Topic.card_count.desc())
    )
    topics = list(result.scalars().all())

    # Batch fetch all topic-card mappings (fixes N+1)
    topic_ids = [t.id for t in topics]
    cards_by_topic: dict[UUID, list[str]] = {}
    if topic_ids:
        tc_result = await db.execute(
            select(TopicCard.topic_id, TopicCard.card_id).where(TopicCard.topic_id.in_(topic_ids))
        )
        for row in tc_result.all():
            cards_by_topic.setdefault(row[0], []).append(str(row[1]))

    topic_responses = [
        TopicResponse(
            id=t.id,
            workspace_id=t.workspace_id,
            name=t.name,
            card_count=t.card_count,
            card_ids=cards_by_topic.get(t.id, []),
            created_at=t.created_at,
            updated_at=t.updated_at,
        )
        for t in topics
    ]

    return TopicListResponse(topics=topic_responses)


@router.post("/rebuild")
async def rebuild_topics(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Full rebuild of topics for a workspace."""
    ws_id = parse_uuid(workspace_id)
    membership = await get_workspace_membership(ws_id, user, db)
    require_role(membership, "owner", "admin")

    await topic_service.rebuild_topics(db, ws_id)
    await db.commit()
    return {"ok": True}

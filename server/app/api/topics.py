from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.card import Card
from app.models.synthesis_template import SynthesisTemplate
from app.models.topic import Topic, TopicCard
from app.models.user import User
from app.schemas.topic import TopicListResponse, TopicResponse
from app.services.llm import get_llm_service
from app.services.synthesis import SYNTHESIS_PROMPTS, build_card_content_block
from app.services.topic import topic_service
from app.utils.auth import get_current_user, get_workspace_membership, require_role
from app.utils.helpers import parse_uuid

router = APIRouter()


class SynthesizeRequest(BaseModel):
    topic_id: str
    mode: str = Field("free", pattern=r"^(timeline|argument|comparison|free)$")
    card_ids: list[str] = Field(default=[])  # optional subset
    template_id: str | None = None  # optional custom template


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


@router.post("/synthesize")
async def synthesize_topic(
    req: SynthesizeRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Stream AI-synthesized content for a topic's cards (SSE)."""
    topic = await db.get(Topic, parse_uuid(req.topic_id))
    if not topic:
        raise HTTPException(404, "Topic not found")

    await get_workspace_membership(topic.workspace_id, user, db)

    # Fetch card IDs for this topic
    if req.card_ids:
        # Validate that requested cards actually belong to this topic
        requested_ids = [parse_uuid(cid) for cid in req.card_ids]
        tc_result = await db.execute(
            select(TopicCard.card_id).where(
                TopicCard.topic_id == topic.id,
                TopicCard.card_id.in_(requested_ids),
            )
        )
        card_ids = [row[0] for row in tc_result.all()]
    else:
        tc_result = await db.execute(
            select(TopicCard.card_id).where(TopicCard.topic_id == topic.id)
        )
        card_ids = [row[0] for row in tc_result.all()]

    if not card_ids:
        async def empty():
            yield "data: No related cards found.\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(empty(), media_type="text/event-stream")

    # Fetch card contents
    result = await db.execute(select(Card).where(Card.id.in_(card_ids)))
    cards = list(result.scalars().all())

    cards_content = build_card_content_block(cards)

    system_prompt = SYNTHESIS_PROMPTS.get(req.mode, SYNTHESIS_PROMPTS["free"])

    # Use custom template if provided
    if req.template_id:
        template = await db.get(SynthesisTemplate, parse_uuid(req.template_id))
        if template and template.workspace_id == topic.workspace_id:
            system_prompt = template.prompt

    system_prompt += f"\n\nTopic: {topic.name}"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Cards to synthesize:\n\n{cards_content}"},
    ]

    async def event_generator():
        async for chunk in get_llm_service().stream(messages, max_tokens=8192, temperature=0.5):
            for line in chunk.split("\n"):
                yield f"data: {line}\n"
            yield "\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

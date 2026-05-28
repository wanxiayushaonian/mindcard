import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.card import Card
from app.models.topic import Topic, TopicCard
from app.models.user import User
from app.schemas.topic import TopicListResponse, TopicResponse
from app.services.llm import llm_service
from app.services.topic import topic_service
from app.utils.auth import get_current_user, get_workspace_membership, require_role
from app.utils.helpers import parse_uuid

router = APIRouter()

# Synthesis mode prompts
_SYNTHESIS_PROMPTS = {
    "timeline": (
        "你是一个知识整理专家。请将以下零散的卡片笔记按时间线或逻辑发展顺序整理成一篇结构清晰的文章。"
        "保留原始信息的完整性，添加适当的过渡语句，使文章流畅连贯。"
        "使用 Markdown 格式，包含标题、小节和列表。"
    ),
    "argument": (
        "你是一个知识整理专家。请将以下零散的卡片笔记整理成一篇有论点-论据结构的文章。"
        "提炼核心观点，将相关卡片归类为支撑论据，形成有说服力的论述结构。"
        "使用 Markdown 格式，包含标题、小节和列表。"
    ),
    "comparison": (
        "你是一个知识整理专家。请将以下零散的卡片笔记按对比或分类方式整理成一篇结构化文章。"
        "识别卡片之间的异同点，按维度进行分类对比，形成清晰的对照结构。"
        "使用 Markdown 格式，包含标题、小节和列表。"
    ),
    "free": (
        "你是一个知识整理专家。请将以下零散的卡片笔记整理成一篇结构清晰、逻辑连贯的文章。"
        "自动识别最佳组织方式，提炼关键信息，消除重复，补充过渡。"
        "使用 Markdown 格式，包含标题、小节和列表。"
    ),
}


class SynthesizeRequest(BaseModel):
    topic_id: str
    mode: str = Field("free", pattern=r"^(timeline|argument|comparison|free)$")
    card_ids: list[str] = Field(default=[])  # optional subset


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
        raise HTTPException(404, "话题不存在")

    await get_workspace_membership(topic.workspace_id, user, db)

    # Fetch card IDs for this topic
    if req.card_ids:
        card_ids = [parse_uuid(cid) for cid in req.card_ids]
    else:
        tc_result = await db.execute(
            select(TopicCard.card_id).where(TopicCard.topic_id == topic.id)
        )
        card_ids = [row[0] for row in tc_result.all()]

    if not card_ids:
        async def empty():
            yield "data: 没有找到关联的卡片。\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(empty(), media_type="text/event-stream")

    # Fetch card contents
    result = await db.execute(select(Card).where(Card.id.in_(card_ids)))
    cards = list(result.scalars().all())

    # Build card content block
    card_texts = []
    for c in cards:
        title = c.title or "无标题"
        card_texts.append(f"### {title}\n\n{c.content}")
    cards_content = "\n\n---\n\n".join(card_texts)

    system_prompt = _SYNTHESIS_PROMPTS.get(req.mode, _SYNTHESIS_PROMPTS["free"])
    system_prompt += f"\n\n话题名称：{topic.name}"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"以下是需要整理的卡片内容：\n\n{cards_content}"},
    ]

    async def event_generator():
        async for chunk in llm_service.stream(messages, max_tokens=8192, temperature=0.5):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

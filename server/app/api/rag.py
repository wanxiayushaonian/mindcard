import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.card import Card
from app.models.user import User
from app.models.workspace import WorkspaceMember
from app.schemas.card import CardResponse
from app.schemas.rag import (
    CardSummary,
    ChatRequest,
    ChatResponse,
    InsightRequest,
    InsightResponse,
    RAGRequest,
    RAGResponse,
)
from app.services.rag import rag_service
from app.utils.auth import get_current_user, get_workspace_membership
from app.utils.helpers import parse_uuid
from app.utils.rate_limit import rag_rate_limit

router = APIRouter()


async def _resolve_workspace_ids(
    workspace_id: str | None, user: User, db: AsyncSession
) -> list[uuid.UUID]:
    """Resolve workspace_id to a list of UUIDs. None = all user workspaces."""
    if workspace_id:
        ws_id = parse_uuid(workspace_id)
        await get_workspace_membership(ws_id, user, db)
        return [ws_id]
    result = await db.execute(
        select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user.id)
    )
    ws_ids = [row[0] for row in result.all()]
    if not ws_ids:
        raise HTTPException(status_code=400, detail="你还没有加入任何空间")
    return ws_ids


@router.post("/ask", response_model=RAGResponse)
async def rag_ask(
    req: RAGRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(rag_rate_limit),
):
    """RAG knowledge Q&A: retrieve relevant cards, then generate answer."""
    ws_ids = await _resolve_workspace_ids(req.workspace_id, user, db)
    result = await rag_service.ask(
        db, req.question, ws_ids, card_id=req.card_id, top_k=req.top_k, web_search=req.web_search,
        history=req.history or None, use_graph=req.use_graph,
    )
    source_cards = [
        CardSummary.model_validate(s) if isinstance(s, dict) else s
        for s in result["source_cards"]
    ]
    return RAGResponse(
        answer=result["answer"],
        source_cards=source_cards,
        confidence=result["confidence"],
        web_search_results=result.get("web_search_results", []),
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, user: User = Depends(get_current_user), _: None = Depends(rag_rate_limit)):
    """General chat without RAG, supports conversation history."""
    reply = await rag_service.chat(req.message, history=req.history, web_search=req.web_search)
    return ChatResponse(reply=reply)


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, user: User = Depends(get_current_user), _: None = Depends(rag_rate_limit)):
    """Streaming general chat without RAG (SSE)."""
    import json as _json

    async def event_generator():
        async for chunk in rag_service.chat_stream(req.message, history=req.history, web_search=req.web_search):
            if isinstance(chunk, dict):
                yield f"data: {_json.dumps(chunk)}\n\n"
            else:
                yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/ask/stream")
async def ask_stream(
    req: RAGRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(rag_rate_limit),
):
    """Streaming RAG Q&A (SSE). Sends text chunks, then sources JSON, then [DONE]."""
    import json as _json

    ws_ids = await _resolve_workspace_ids(req.workspace_id, user, db)

    async def event_generator():
        sources = []
        async for chunk in rag_service.ask_stream(
            db, req.question, ws_ids, card_id=req.card_id, top_k=req.top_k, web_search=req.web_search,
            history=req.history or None, retrieval_level=req.retrieval_level, chat_id=req.chat_id,
        ):
            if isinstance(chunk, dict):
                chunk_type = chunk.get("type", "")
                if chunk_type == "web_search_results":
                    # Send web search results immediately
                    yield f"data: {_json.dumps(chunk)}\n\n"
                elif chunk_type == "sources":
                    sources = chunk.get("source_cards", [])
            else:
                yield f"data: {chunk}\n\n"
        if sources:
            source_data = [
                {"id": s.id, "title": s.title, "content": s.content, "keywords": s.keywords, "color": s.color}
                for s in sources
            ]
            yield f"data: {_json.dumps({'type': 'sources', 'cards': source_data})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/similar/{card_id}", response_model=list[CardResponse])
async def find_similar(
    card_id: str,
    limit: int = 5,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Find similar cards using vector cosine distance, excluding already-related cards."""
    card = await db.get(Card, parse_uuid(card_id))
    if not card:
        raise HTTPException(status_code=404, detail="卡片不存在")
    await get_workspace_membership(card.workspace_id, user, db)

    from app.models.card import CardRelation

    result = await db.execute(
        select(CardRelation.related_card_id).where(CardRelation.card_id == parse_uuid(card_id))
    )
    related_ids = [str(row[0]) for row in result.all()]

    cards = await rag_service.find_similar(db, card_id, limit=limit, exclude_ids=related_ids)
    return [CardResponse.model_validate(c) for c in cards]


@router.post("/insights", response_model=InsightResponse)
async def generate_insights(
    req: InsightRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    _: None = Depends(rag_rate_limit),
):
    """Analyze workspace inspiration patterns."""
    await get_workspace_membership(req.workspace_id, user, db)
    result = await rag_service.generate_insights(db, req.workspace_id)
    return InsightResponse(**result)

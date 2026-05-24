from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.card import Card
from app.models.user import User
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

router = APIRouter()


@router.post("/ask", response_model=RAGResponse)
async def rag_ask(
    req: RAGRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """RAG knowledge Q&A: retrieve relevant cards, then generate answer."""
    await get_workspace_membership(req.workspace_id, user, db)
    result = await rag_service.ask(
        db, req.question, req.workspace_id, card_id=req.card_id, top_k=req.top_k
    )
    source_cards = [
        CardSummary.model_validate(s) if isinstance(s, dict) else s
        for s in result["source_cards"]
    ]
    return RAGResponse(
        answer=result["answer"],
        source_cards=source_cards,
        confidence=result["confidence"],
    )


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, user: User = Depends(get_current_user)):
    """General chat without RAG, supports conversation history."""
    reply = await rag_service.chat(req.message, history=req.history)
    return ChatResponse(reply=reply)


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, user: User = Depends(get_current_user)):
    """Streaming general chat without RAG (SSE)."""

    async def event_generator():
        async for chunk in rag_service.chat_stream(req.message, history=req.history):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/ask/stream")
async def ask_stream(
    req: RAGRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Streaming RAG Q&A (SSE). Sends text chunks, then sources JSON, then [DONE]."""
    import json as _json

    await get_workspace_membership(req.workspace_id, user, db)

    async def event_generator():
        sources = []
        async for chunk in rag_service.ask_stream(
            db, req.question, req.workspace_id, card_id=req.card_id, top_k=req.top_k
        ):
            if isinstance(chunk, dict):
                sources = chunk.get("source_cards", [])
            else:
                yield f"data: {chunk}\n\n"
        if sources:
            source_data = [
                {"id": s.id, "title": s.title, "content": s.content, "keywords": s.keywords}
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
):
    """Analyze workspace inspiration patterns."""
    await get_workspace_membership(req.workspace_id, user, db)
    result = await rag_service.generate_insights(db, req.workspace_id)
    return InsightResponse(**result)

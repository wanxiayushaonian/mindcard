import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
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

router = APIRouter()


@router.post("/ask", response_model=RAGResponse)
async def rag_ask(req: RAGRequest, db: AsyncSession = Depends(get_db)):
    """RAG knowledge Q&A: retrieve relevant cards, then generate answer."""
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
async def chat(req: ChatRequest):
    """General chat without RAG, supports conversation history."""
    reply = await rag_service.chat(req.message, history=req.history)
    return ChatResponse(reply=reply)


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """Streaming general chat without RAG (SSE)."""

    async def event_generator():
        async for chunk in rag_service.chat_stream(req.message, history=req.history):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/ask/stream")
async def ask_stream(req: RAGRequest, db: AsyncSession = Depends(get_db)):
    """Streaming RAG Q&A (SSE)."""

    async def event_generator():
        async for chunk in rag_service.ask_stream(
            db, req.question, req.workspace_id, card_id=req.card_id, top_k=req.top_k
        ):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/similar/{card_id}", response_model=list[CardResponse])
async def find_similar(card_id: str, limit: int = 5, db: AsyncSession = Depends(get_db)):
    """Find similar cards using vector cosine distance, excluding already-related cards."""
    from app.models.card import CardRelation

    result = await db.execute(
        select(CardRelation.related_card_id).where(CardRelation.card_id == uuid.UUID(card_id))
    )
    related_ids = [str(row[0]) for row in result.all()]

    cards = await rag_service.find_similar(db, card_id, limit=limit, exclude_ids=related_ids)
    return [CardResponse.model_validate(c) for c in cards]


@router.post("/insights", response_model=InsightResponse)
async def generate_insights(req: InsightRequest, db: AsyncSession = Depends(get_db)):
    """Analyze workspace inspiration patterns."""
    result = await rag_service.generate_insights(db, req.workspace_id)
    return InsightResponse(**result)

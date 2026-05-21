from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.rag import (
    InsightRequest,
    InsightResponse,
    RAGRequest,
    RAGResponse,
)

router = APIRouter()


@router.post("/ask", response_model=RAGResponse)
async def rag_ask(req: RAGRequest, db: AsyncSession = Depends(get_db)):
    """RAG knowledge Q&A: retrieve relevant cards, then generate answer."""
    # TODO: implement with RAGService
    return RAGResponse(answer="Not yet implemented", source_cards=[], confidence=0.0)


@router.get("/similar/{card_id}")
async def find_similar(card_id: str, limit: int = 5, db: AsyncSession = Depends(get_db)):
    """Find similar cards using vector cosine distance (replaces agent.js)."""
    # TODO: implement with pgvector cosine_distance
    return []


@router.post("/insights", response_model=InsightResponse)
async def generate_insights(req: InsightRequest, db: AsyncSession = Depends(get_db)):
    """Analyze workspace inspiration patterns."""
    # TODO: implement with RAGService
    return InsightResponse(themes=[], trends="", unexplored=[], suggestions=[])

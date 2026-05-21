from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.search import SearchRequest, SearchResponse

router = APIRouter()


@router.post("/semantic", response_model=SearchResponse)
async def semantic_search(req: SearchRequest, db: AsyncSession = Depends(get_db)):
    """Vector semantic search using pgvector cosine similarity."""
    # TODO: implement with EmbeddingService + pgvector query
    return SearchResponse(results=[], total=0)


@router.post("/fulltext", response_model=SearchResponse)
async def fulltext_search(req: SearchRequest, db: AsyncSession = Depends(get_db)):
    """Full-text search using PostgreSQL tsvector."""
    # TODO: implement with to_tsvector + ts_rank
    return SearchResponse(results=[], total=0)


@router.post("/hybrid", response_model=SearchResponse)
async def hybrid_search(req: SearchRequest, db: AsyncSession = Depends(get_db)):
    """Hybrid search: vector + fulltext with RRF fusion."""
    # TODO: implement with Reciprocal Rank Fusion
    return SearchResponse(results=[], total=0)

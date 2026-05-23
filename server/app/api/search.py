import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.card import CardResponse
from app.schemas.search import SearchRequest, SearchResponse, SearchResult
from app.services.search import search_service
from app.utils.auth import get_current_user, get_workspace_membership

router = APIRouter()


def _parse_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid UUID: {value}")


def _to_search_result(scored) -> SearchResult:
    return SearchResult(
        card=CardResponse.model_validate(scored.card),
        score=round(scored.score, 4),
    )


@router.post("/semantic", response_model=SearchResponse)
async def semantic_search(
    req: SearchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Vector semantic search using pgvector cosine similarity."""
    ws_id = _parse_uuid(req.workspace_id)
    await get_workspace_membership(ws_id, user, db)
    scored = await search_service.vector_search(db, req.query, req.workspace_id, limit=req.limit)
    results = [_to_search_result(s) for s in scored]
    return SearchResponse(results=results, total=len(results))


@router.post("/fulltext", response_model=SearchResponse)
async def fulltext_search(
    req: SearchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Full-text search using PostgreSQL tsvector."""
    ws_id = _parse_uuid(req.workspace_id)
    await get_workspace_membership(ws_id, user, db)
    scored = await search_service.fulltext_search(db, req.query, req.workspace_id, limit=req.limit)
    results = [_to_search_result(s) for s in scored]
    return SearchResponse(results=results, total=len(results))


@router.post("/hybrid", response_model=SearchResponse)
async def hybrid_search(
    req: SearchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Hybrid search: vector + fulltext with RRF fusion."""
    ws_id = _parse_uuid(req.workspace_id)
    await get_workspace_membership(ws_id, user, db)
    scored = await search_service.hybrid_search(db, req.query, req.workspace_id, limit=req.limit)
    results = [_to_search_result(s) for s in scored]
    return SearchResponse(results=results, total=len(results))

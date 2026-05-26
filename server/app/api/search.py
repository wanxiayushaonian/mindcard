import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.workspace import WorkspaceMember
from app.schemas.card import CardResponse
from app.schemas.search import SearchRequest, SearchResponse, SearchResult
from app.services.search import search_service
from app.utils.auth import get_current_user, get_workspace_membership
from app.utils.helpers import parse_uuid

router = APIRouter()


def _to_search_result(scored) -> SearchResult:
    return SearchResult(
        card=CardResponse.model_validate(scored.card),
        score=round(scored.score, 4),
    )


async def _resolve_workspace_ids(
    workspace_id: str | None, user: User, db: AsyncSession
) -> list[uuid.UUID] | None:
    """Resolve workspace_id to a list of UUIDs. None input = all user workspaces."""
    if workspace_id:
        ws_id = parse_uuid(workspace_id)
        await get_workspace_membership(ws_id, user, db)
        return [ws_id]
    # Global search: get all workspace IDs the user is a member of
    result = await db.execute(
        select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user.id)
    )
    ws_ids = [row[0] for row in result.all()]
    if not ws_ids:
        return []
    return ws_ids


def _apply_sort(results: list, sort_by: str) -> list:
    """Apply post-fetch sorting to search results."""
    if sort_by == "created_at":
        return sorted(results, key=lambda r: r.card.created_at, reverse=True)
    return results  # default: relevance order (already sorted)


@router.post("/semantic", response_model=SearchResponse)
async def semantic_search(
    req: SearchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Vector semantic search using pgvector cosine similarity."""
    ws_ids = await _resolve_workspace_ids(req.workspace_id, user, db)
    if not ws_ids:
        return SearchResponse(results=[], total=0)
    scored = await search_service.vector_search(db, req.query, ws_ids, limit=req.limit)
    scored = _apply_sort(scored, req.sort_by)
    results = [_to_search_result(s) for s in scored]
    return SearchResponse(results=results, total=len(results))


@router.post("/fulltext", response_model=SearchResponse)
async def fulltext_search(
    req: SearchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Full-text search using PostgreSQL tsvector."""
    ws_ids = await _resolve_workspace_ids(req.workspace_id, user, db)
    if not ws_ids:
        return SearchResponse(results=[], total=0)
    scored = await search_service.fulltext_search(db, req.query, ws_ids, limit=req.limit)
    scored = _apply_sort(scored, req.sort_by)
    results = [_to_search_result(s) for s in scored]
    return SearchResponse(results=results, total=len(results))


@router.post("/hybrid", response_model=SearchResponse)
async def hybrid_search(
    req: SearchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Hybrid search: vector + fulltext with RRF fusion."""
    ws_ids = await _resolve_workspace_ids(req.workspace_id, user, db)
    if not ws_ids:
        return SearchResponse(results=[], total=0)
    scored = await search_service.hybrid_search(db, req.query, ws_ids, limit=req.limit)
    scored = _apply_sort(scored, req.sort_by)
    results = [_to_search_result(s) for s in scored]
    return SearchResponse(results=results, total=len(results))

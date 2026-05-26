from pydantic import BaseModel

from app.schemas.card import CardResponse


class SearchRequest(BaseModel):
    query: str
    workspace_id: str | None = None  # None = search all user workspaces
    limit: int = 20
    sort_by: str = "relevance"  # "relevance" | "created_at"


class SearchResult(BaseModel):
    card: CardResponse
    score: float


class SearchResponse(BaseModel):
    results: list[SearchResult]
    total: int

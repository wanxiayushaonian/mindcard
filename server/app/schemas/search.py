from pydantic import BaseModel

from app.schemas.card import CardResponse


class SearchRequest(BaseModel):
    query: str
    workspace_id: str
    limit: int = 20


class SearchResult(BaseModel):
    card: CardResponse
    score: float


class SearchResponse(BaseModel):
    results: list[SearchResult]
    total: int

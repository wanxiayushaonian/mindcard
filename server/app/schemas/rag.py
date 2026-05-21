from pydantic import BaseModel

from app.schemas.card import CardResponse


class RAGRequest(BaseModel):
    question: str
    workspace_id: str
    card_id: str | None = None  # Optional: use a specific card as context center
    top_k: int = 5


class CardSummary(BaseModel):
    id: str
    title: str
    content: str
    keywords: list[str]


class RAGResponse(BaseModel):
    answer: str
    source_cards: list[CardSummary]
    confidence: float


class InsightRequest(BaseModel):
    workspace_id: str


class InsightResponse(BaseModel):
    themes: list[str]
    trends: str
    unexplored: list[str]
    suggestions: list[str]

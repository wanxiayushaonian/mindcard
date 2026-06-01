from pydantic import BaseModel

from app.schemas.card import CardResponse


class RAGRequest(BaseModel):
    question: str
    workspace_id: str | None = None  # None = search all user workspaces
    card_id: str | None = None  # Optional: use a specific card as context center
    top_k: int = 5
    web_search: bool = False  # Enable web search for supplementary context
    use_graph: bool = True  # Enable Graph RAG (falls back to hybrid search if unavailable)
    history: list[dict[str, str]] = []  # [{"role": "user"/"assistant", "content": "..."}]


class CardSummary(BaseModel):
    id: str
    title: str
    content: str
    keywords: list[str]
    color: str = "#B8D4E3"


class WebSearchResult(BaseModel):
    title: str
    snippet: str
    url: str


class RAGResponse(BaseModel):
    answer: str
    source_cards: list[CardSummary]
    confidence: float
    web_search_results: list[WebSearchResult] = []


class InsightRequest(BaseModel):
    workspace_id: str


class InsightResponse(BaseModel):
    themes: list[str]
    trends: str
    unexplored: list[str]
    suggestions: list[str]


class ChatRequest(BaseModel):
    message: str
    history: list[dict[str, str]] = []  # [{"role": "user"/"assistant", "content": "..."}]
    web_search: bool = False  # Enable web search for supplementary context


class ChatResponse(BaseModel):
    reply: str

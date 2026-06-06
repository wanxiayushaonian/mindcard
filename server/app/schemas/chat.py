import uuid
from datetime import datetime

from pydantic import BaseModel


class ChatCreate(BaseModel):
    local_id: str = ""
    mode: str = "rag"  # 'rag' | 'chat'
    workspace_id: str | None = None
    card_id: str | None = None
    parent_id: str | None = None
    title: str = ""


class ChatForkRequest(BaseModel):
    """Request to fork a conversation."""
    topic: str = ""  # Optional focus topic for the fork
    mode: str = "rag"
    title: str = ""
    context_strategy: str = "compress"  # none | inherit | compress
    fork_id: str | None = None  # parent fork_id for nested forks


class ChatSummarizeRequest(BaseModel):
    """Request to summarize a conversation into a card."""
    title: str = ""  # Optional title for the summary card
    keywords: list[str] = []  # Optional keywords


class WebSearchResult(BaseModel):
    title: str
    snippet: str
    url: str


class ChatMessageCreate(BaseModel):
    role: str  # 'user' | 'assistant' | 'fork-divider'
    content: str
    web_search_results: list[WebSearchResult] | None = None
    fork_id: str | None = None


class ChatMessageResponse(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    role: str
    content: str
    web_search_results: list[WebSearchResult] | None = None
    fork_id: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatListResponse(BaseModel):
    id: uuid.UUID
    mode: str
    workspace_id: uuid.UUID | None
    card_id: uuid.UUID | None
    parent_id: uuid.UUID | None = None
    node_type: str = "branch"
    title: str
    chat_status: str = "active"
    created_at: datetime
    message_count: int = 0
    last_message: str = ""

    model_config = {"from_attributes": True}


class ChatResponse(BaseModel):
    id: uuid.UUID
    mode: str
    workspace_id: uuid.UUID | None
    card_id: uuid.UUID | None
    parent_id: uuid.UUID | None = None
    node_type: str = "branch"
    title: str
    description: str = ""
    summary: str = ""
    chat_status: str = "active"
    created_at: datetime
    messages: list[ChatMessageResponse] = []

    model_config = {"from_attributes": True}


class ChatForkResponse(BaseModel):
    """Response after forking a conversation."""
    chat_id: str  # The new child AiChat ID
    context_summary: str

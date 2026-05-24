import uuid
from datetime import datetime

from pydantic import BaseModel


class ChatCreate(BaseModel):
    local_id: str = ""
    mode: str = "rag"  # 'rag' | 'chat'
    workspace_id: str | None = None
    card_id: str | None = None
    title: str = ""


class ChatMessageCreate(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str


class ChatMessageResponse(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatListResponse(BaseModel):
    id: uuid.UUID
    mode: str
    workspace_id: uuid.UUID | None
    card_id: uuid.UUID | None
    title: str
    created_at: datetime
    message_count: int = 0
    last_message: str = ""

    model_config = {"from_attributes": True}


class ChatResponse(BaseModel):
    id: uuid.UUID
    mode: str
    workspace_id: uuid.UUID | None
    card_id: uuid.UUID | None
    title: str
    created_at: datetime
    messages: list[ChatMessageResponse] = []

    model_config = {"from_attributes": True}

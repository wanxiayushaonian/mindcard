import uuid
from datetime import datetime

from pydantic import BaseModel


class ChatCreate(BaseModel):
    local_id: str
    card_id: str
    title: str = ""


class ChatMessageCreate(BaseModel):
    role: str
    content: str


class ChatMessageResponse(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatResponse(BaseModel):
    id: uuid.UUID
    local_id: str
    card_id: uuid.UUID
    title: str
    created_at: datetime
    messages: list[ChatMessageResponse] = []

    model_config = {"from_attributes": True}

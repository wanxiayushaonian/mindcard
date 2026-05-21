import uuid
from datetime import datetime

from pydantic import BaseModel


class CardCreate(BaseModel):
    local_id: str
    workspace_id: str
    title: str = ""
    content: str
    keywords: list[str] = []
    color: str = "#B8D4E3"
    emotion_tag: str = ""
    is_favorite: bool = False
    is_temp: bool = True


class CardUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    keywords: list[str] | None = None
    color: str | None = None
    emotion_tag: str | None = None
    is_favorite: bool | None = None
    is_temp: bool | None = None


class CardResponse(BaseModel):
    id: uuid.UUID
    local_id: str
    workspace_id: uuid.UUID
    title: str
    content: str
    keywords: list[str]
    color: str
    emotion_tag: str
    is_favorite: bool
    is_temp: bool
    created_at: datetime
    updated_at: datetime | None

    model_config = {"from_attributes": True}


class CardRelationCreate(BaseModel):
    related_card_id: str
    relation_type: str = "manual"
    score: float = 0.0

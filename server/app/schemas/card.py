import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class CardCreate(BaseModel):
    local_id: str = Field(..., max_length=64)
    workspace_id: str
    title: str = Field("", max_length=128)
    content: str = Field(..., min_length=1, max_length=50000)
    keywords: list[str] = Field(default=[], max_length=5)
    color: str = Field("#B8D4E3", max_length=16)
    emotion_tag: str = Field("", max_length=32)
    is_favorite: bool = False
    is_temp: bool = True


class CardUpdate(BaseModel):
    title: str | None = Field(None, max_length=128)
    content: str | None = Field(None, max_length=50000)
    keywords: list[str] | None = Field(None, max_length=5)
    color: str | None = Field(None, max_length=16)
    emotion_tag: str | None = Field(None, max_length=32)
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


class CardListResponse(BaseModel):
    items: list[CardResponse]
    next_cursor: str | None


class CardRelationCreate(BaseModel):
    related_card_id: str
    relation_type: str = "manual"
    score: float = 0.0

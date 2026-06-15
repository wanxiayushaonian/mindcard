import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_serializer


class CardCreate(BaseModel):
    local_id: str = Field(..., max_length=64)
    workspace_id: str
    chat_id: str | None = None  # Optional: which chat created this card
    title: str = Field("", max_length=128)
    content: str = Field(..., min_length=1, max_length=50000)
    keywords: list[str] = Field(default=[], max_length=5)
    color: str = Field("#B8D4E3", max_length=16, pattern=r"^#[0-9A-Fa-f]{6}$")
    emotion_tag: str = Field("", max_length=32)
    is_favorite: bool = False
    is_temp: bool = True
    parent_card_ids: list[str] = Field(default=[])


class CardUpdate(BaseModel):
    title: str | None = Field(None, max_length=128)
    content: str | None = Field(None, max_length=50000)
    keywords: list[str] | None = Field(None, max_length=5)
    color: str | None = Field(None, max_length=16, pattern=r"^#[0-9A-Fa-f]{6}$")
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
    parent_card_ids: list[uuid.UUID] = []
    created_at: datetime
    updated_at: datetime | None

    model_config = {"from_attributes": True}

    @field_serializer('parent_card_ids')
    def serialize_parent_card_ids(self, value: list[uuid.UUID]) -> list[str]:
        """Convert UUID objects to strings for JSON serialization."""
        return [str(v) for v in value]


class CardListResponse(BaseModel):
    items: list[CardResponse]
    next_cursor: str | None


class CardRelationCreate(BaseModel):
    related_card_id: str
    relation_type: str = "manual"
    score: float = 0.0


class CardBatchItem(BaseModel):
    """A single card within a batch request."""
    local_id: str = Field(..., max_length=64)
    title: str = Field("", max_length=128)
    content: str = Field(..., min_length=1, max_length=50000)
    keywords: list[str] = Field(default=[], max_length=5)
    color: str = Field("#B8D4E3", max_length=16, pattern=r"^#[0-9A-Fa-f]{6}$")
    emotion_tag: str = Field("", max_length=32)
    is_favorite: bool = False
    is_temp: bool = True
    parent_card_ids: list[str] = Field(default=[])


class CardBatchRequest(BaseModel):
    workspace_id: str
    chat_id: str | None = None
    cards: list[CardBatchItem] = Field(..., min_length=1, max_length=500)
    mark_as_temp: bool = False


class CardBatchResponse(BaseModel):
    created: int
    failed: int
    card_ids: list[str]
    errors: list[dict]

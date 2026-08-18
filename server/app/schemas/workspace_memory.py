from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

MemoryType = Literal["fact", "preference", "insight", "summary", "claim", "archived"]


class WorkspaceMemoryCreate(BaseModel):
    slug: str
    title: str
    body: str
    source_chat_id: str | None = None
    memory_type: MemoryType = "fact"
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    importance: float = Field(default=0.5, ge=0.0, le=1.0)
    source_card_ids: list[str] = []


class WorkspaceMemoryUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    memory_type: MemoryType | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    importance: float | None = Field(default=None, ge=0.0, le=1.0)
    source_card_ids: list[str] | None = None


class WorkspaceMemoryResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    slug: str
    title: str
    body: str
    source_chat_id: UUID | None
    memory_type: str
    confidence: float
    importance: float
    source_card_ids: list[UUID]
    last_accessed_at: datetime | None
    updated_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}

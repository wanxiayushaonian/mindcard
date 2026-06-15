from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class WorkspaceMemoryCreate(BaseModel):
    slug: str
    title: str
    body: str
    source_chat_id: str | None = None


class WorkspaceMemoryResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    slug: str
    title: str
    body: str
    source_chat_id: UUID | None
    updated_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}

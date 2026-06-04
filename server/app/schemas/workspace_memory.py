from datetime import datetime

from pydantic import BaseModel


class WorkspaceMemoryCreate(BaseModel):
    slug: str
    title: str
    body: str
    source_chat_id: str | None = None


class WorkspaceMemoryResponse(BaseModel):
    id: str
    workspace_id: str
    slug: str
    title: str
    body: str
    source_chat_id: str | None
    updated_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}

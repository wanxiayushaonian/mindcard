import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class TreeNodeCreate(BaseModel):
    workspace_id: str
    parent_id: str | None = None
    node_type: str = Field("branch", pattern=r"^(root|branch|leaf)$")
    title: str = Field("", max_length=256)
    description: str = ""
    sort_order: int = 0


class TreeNodeUpdate(BaseModel):
    title: str | None = Field(None, max_length=256)
    description: str | None = None
    summary: str | None = None
    status: str | None = Field(None, pattern=r"^(active|completed|archived)$")
    sort_order: int | None = None
    parent_id: str | None = None


class TreeNodeResponse(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    parent_id: uuid.UUID | None
    chat_id: uuid.UUID | None
    node_type: str
    title: str
    description: str
    summary: str
    status: str
    sort_order: int
    card_ids: list[str] = []
    card_count: int = 0
    child_ids: list[str] = []
    ref_ids: list[str] = []
    created_at: datetime
    updated_at: datetime | None
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class TreeNodeListResponse(BaseModel):
    nodes: list[TreeNodeResponse]


class NodeCardAdd(BaseModel):
    card_id: str


class NodeRefCreate(BaseModel):
    target_node_id: str
    ref_type: str = Field("related", pattern=r"^(related|contradicts|extends)$")
    reason: str = ""

import uuid
from datetime import datetime

from pydantic import BaseModel


class WorkspaceCreate(BaseModel):
    local_id: str
    name: str
    icon: str = "💡"
    color: str = "#94B4C8"


class WorkspaceUpdate(BaseModel):
    name: str | None = None
    icon: str | None = None
    color: str | None = None


class WorkspaceResponse(BaseModel):
    id: uuid.UUID
    local_id: str
    name: str
    icon: str
    color: str
    invite_code: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class WorkspaceMemberResponse(BaseModel):
    user_id: uuid.UUID
    nickname: str
    role: str
    joined_at: datetime

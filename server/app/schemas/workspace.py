import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class WorkspaceCreate(BaseModel):
    local_id: str = Field(..., max_length=64)
    name: str = Field(..., min_length=1, max_length=64)
    icon: str = Field("💡", max_length=8)
    color: str = Field("#94B4C8", max_length=16)


class JoinWorkspaceRequest(BaseModel):
    invite_code: str


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(None, max_length=64)
    icon: str | None = Field(None, max_length=8)
    color: str | None = Field(None, max_length=16)


class WorkspaceResponse(BaseModel):
    id: uuid.UUID
    local_id: str
    name: str
    icon: str
    color: str
    invite_code: str | None
    created_at: datetime
    member_role: str | None = None

    model_config = {"from_attributes": True}


class WorkspaceMemberResponse(BaseModel):
    user_id: uuid.UUID
    nickname: str
    role: str
    joined_at: datetime

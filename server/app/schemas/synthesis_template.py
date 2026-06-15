from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class SynthesisTemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    prompt: str = Field(..., min_length=1, max_length=50000)
    description: str | None = Field(None, max_length=500)


class SynthesisTemplateUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=128)
    prompt: str | None = Field(None, min_length=1, max_length=50000)
    description: str | None = Field(None, max_length=500)


class SynthesisTemplateResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    name: str
    prompt: str
    description: str | None
    created_at: datetime
    updated_at: datetime | None

    model_config = {"from_attributes": True}


class SynthesisTemplateListResponse(BaseModel):
    templates: list[SynthesisTemplateResponse]

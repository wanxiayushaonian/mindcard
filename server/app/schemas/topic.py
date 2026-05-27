from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class TopicResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    name: str
    card_count: int
    card_ids: list[str] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TopicListResponse(BaseModel):
    topics: list[TopicResponse]

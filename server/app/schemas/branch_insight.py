from datetime import datetime

from pydantic import BaseModel


class BranchInsightCreate(BaseModel):
    target_chat_id: str
    content: str


class BranchInsightResponse(BaseModel):
    id: str
    source_chat_id: str
    target_chat_id: str
    content: str
    consumed: bool
    created_at: datetime

    model_config = {"from_attributes": True}

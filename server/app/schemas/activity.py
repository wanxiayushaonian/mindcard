import uuid
from datetime import datetime

from pydantic import BaseModel


class ActivityResponse(BaseModel):
    id: uuid.UUID
    actor_nickname: str
    action: str
    target_type: str
    target_id: str | None
    metadata: dict | None
    created_at: datetime

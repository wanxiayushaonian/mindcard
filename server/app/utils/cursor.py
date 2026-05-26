import base64
import json
import uuid
from datetime import datetime


def encode_cursor(value: datetime | str, item_id: uuid.UUID) -> str:
    """Encode a cursor from sort value + id."""
    if isinstance(value, datetime):
        v = value.isoformat()
    else:
        v = str(value)
    payload = {"v": v, "id": str(item_id)}
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()


def decode_cursor(cursor: str) -> tuple[str, str]:
    """Decode a cursor to (value_str, id_str)."""
    payload = json.loads(base64.urlsafe_b64decode(cursor.encode()))
    return payload["v"], payload["id"]

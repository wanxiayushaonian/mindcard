"""Shared utility functions."""

import uuid

from fastapi import HTTPException


def parse_uuid(value: str) -> uuid.UUID:
    """Parse a string as UUID, raising 400 on invalid format."""
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID")

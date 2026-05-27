import hashlib
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.api_key import ApiKey
from app.models.user import User
from app.schemas.api_key import ApiKeyCreate, ApiKeyCreated, ApiKeyResponse
from app.utils.auth import get_current_user

router = APIRouter()

KEY_PREFIX_LEN = 3 + 8  # "mc_" + 8 chars


def _generate_api_key() -> tuple[str, str, str]:
    """Generate an API key. Returns (full_key, key_prefix, key_hash)."""
    raw = secrets.token_urlsafe(36)  # ~48 chars
    full_key = f"mc_{raw}"
    key_prefix = full_key[:KEY_PREFIX_LEN]
    key_hash = hashlib.sha256(full_key.encode()).hexdigest()
    return full_key, key_prefix, key_hash


@router.get("/", response_model=list[ApiKeyResponse])
async def list_api_keys(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ApiKey)
        .where(ApiKey.user_id == user.id)
        .order_by(ApiKey.created_at.desc())
    )
    return result.scalars().all()


@router.post("/", response_model=ApiKeyCreated)
async def create_api_key(
    req: ApiKeyCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    full_key, key_prefix, key_hash = _generate_api_key()
    api_key = ApiKey(
        id=uuid.uuid4(),
        user_id=user.id,
        key_prefix=key_prefix,
        key_hash=key_hash,
        name=req.name or "未命名",
    )
    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)
    return ApiKeyCreated(
        id=api_key.id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        key=full_key,
        created_at=api_key.created_at,
    )


@router.delete("/{key_id}")
async def revoke_api_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    api_key = await db.get(ApiKey, uuid.UUID(key_id))
    if not api_key or api_key.user_id != user.id:
        raise HTTPException(status_code=404, detail="API Key 不存在")
    api_key.is_active = False
    await db.commit()
    return {"ok": True}

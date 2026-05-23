import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.chat import AiChat, ChatMessage
from app.models.user import User
from app.schemas.chat import (
    ChatCreate,
    ChatListResponse,
    ChatMessageCreate,
    ChatMessageResponse,
    ChatResponse,
)
from app.utils.auth import get_current_user, get_workspace_membership

router = APIRouter()


def _parse_uuid(value: str) -> uuid.UUID:
    """Parse a UUID string, raising 400 on invalid input."""
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid UUID: {value}")


@router.get("/", response_model=list[ChatListResponse])
async def list_chats(
    workspace_id: str | None = None,
    mode: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List chat sessions, optionally filtered by workspace or mode."""
    if workspace_id:
        await get_workspace_membership(_parse_uuid(workspace_id), user, db)
    stmt = select(AiChat).order_by(AiChat.created_at.desc())
    stmt = stmt.where(or_(AiChat.user_id == user.id, AiChat.user_id.is_(None)))
    if workspace_id:
        stmt = stmt.where(AiChat.workspace_id == _parse_uuid(workspace_id))
    if mode:
        stmt = stmt.where(AiChat.mode == mode)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/", response_model=ChatResponse)
async def create_chat(
    req: ChatCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new chat session."""
    if req.workspace_id:
        await get_workspace_membership(_parse_uuid(req.workspace_id), user, db)
    import time
    local_id = req.local_id or f"chat_{int(time.time() * 1000)}"
    chat = AiChat(
        local_id=local_id,
        user_id=user.id,
        mode=req.mode,
        title=req.title,
        workspace_id=_parse_uuid(req.workspace_id) if req.workspace_id else None,
        card_id=_parse_uuid(req.card_id) if req.card_id else None,
    )
    db.add(chat)
    await db.flush()
    await db.commit()
    await db.refresh(chat)
    return ChatResponse(
        id=chat.id,
        mode=chat.mode,
        workspace_id=chat.workspace_id,
        card_id=chat.card_id,
        title=chat.title,
        created_at=chat.created_at,
        messages=[],
    )


@router.get("/{chat_id}", response_model=ChatResponse)
async def get_chat(
    chat_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get a chat session with all messages."""
    chat = await db.get(AiChat, _parse_uuid(chat_id))
    if not chat:
        raise HTTPException(status_code=404, detail="对话不存在")
    if chat.workspace_id:
        await get_workspace_membership(chat.workspace_id, user, db)
    elif chat.user_id and chat.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权访问此对话")
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.chat_id == chat.id)
        .order_by(ChatMessage.created_at.asc())
    )
    messages = result.scalars().all()
    return ChatResponse(
        id=chat.id,
        mode=chat.mode,
        workspace_id=chat.workspace_id,
        card_id=chat.card_id,
        title=chat.title,
        created_at=chat.created_at,
        messages=[ChatMessageResponse.model_validate(m) for m in messages],
    )


@router.post("/{chat_id}/messages", response_model=ChatMessageResponse)
async def add_message(
    chat_id: str,
    req: ChatMessageCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Add a message to a chat session."""
    chat = await db.get(AiChat, _parse_uuid(chat_id))
    if not chat:
        raise HTTPException(status_code=404, detail="对话不存在")
    if chat.workspace_id:
        await get_workspace_membership(chat.workspace_id, user, db)
    elif chat.user_id and chat.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权访问此对话")
    msg = ChatMessage(
        chat_id=chat.id,
        role=req.role,
        content=req.content,
    )
    db.add(msg)
    await db.flush()
    # Update chat title with first user message
    if req.role == "user" and not chat.title:
        chat.title = req.content[:50]
    await db.commit()
    await db.refresh(msg)
    return msg


@router.delete("/{chat_id}")
async def delete_chat(
    chat_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a chat session and all its messages."""
    chat = await db.get(AiChat, _parse_uuid(chat_id))
    if not chat:
        raise HTTPException(status_code=404, detail="对话不存在")
    if chat.workspace_id:
        await get_workspace_membership(chat.workspace_id, user, db)
    elif chat.user_id and chat.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权访问此对话")
    await db.delete(chat)
    await db.commit()
    return {"ok": True}

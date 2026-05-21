import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.chat import AiChat, ChatMessage
from app.schemas.chat import (
    ChatCreate,
    ChatListResponse,
    ChatMessageCreate,
    ChatMessageResponse,
    ChatResponse,
)

router = APIRouter()


@router.get("/", response_model=list[ChatListResponse])
async def list_chats(
    workspace_id: str | None = None,
    mode: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List chat sessions, optionally filtered by workspace or mode."""
    stmt = select(AiChat).order_by(AiChat.created_at.desc())
    if workspace_id:
        stmt = stmt.where(AiChat.workspace_id == uuid.UUID(workspace_id))
    if mode:
        stmt = stmt.where(AiChat.mode == mode)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/", response_model=ChatResponse)
async def create_chat(req: ChatCreate, db: AsyncSession = Depends(get_db)):
    """Create a new chat session."""
    import time
    local_id = req.local_id or f"chat_{int(time.time() * 1000)}"
    chat = AiChat(
        local_id=local_id,
        mode=req.mode,
        title=req.title,
        workspace_id=uuid.UUID(req.workspace_id) if req.workspace_id else None,
        card_id=uuid.UUID(req.card_id) if req.card_id else None,
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
async def get_chat(chat_id: str, db: AsyncSession = Depends(get_db)):
    """Get a chat session with all messages."""
    chat = await db.get(AiChat, uuid.UUID(chat_id))
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
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
    chat_id: str, req: ChatMessageCreate, db: AsyncSession = Depends(get_db)
):
    """Add a message to a chat session."""
    chat = await db.get(AiChat, uuid.UUID(chat_id))
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
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
async def delete_chat(chat_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a chat session and all its messages."""
    chat = await db.get(AiChat, uuid.UUID(chat_id))
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    await db.delete(chat)
    await db.commit()
    return {"ok": True}

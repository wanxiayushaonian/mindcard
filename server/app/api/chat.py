from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.utils.helpers import parse_uuid

router = APIRouter()


@router.get("/", response_model=list[ChatListResponse])
async def list_chats(
    workspace_id: str | None = None,
    mode: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List chat sessions, optionally filtered by workspace or mode."""
    if workspace_id:
        await get_workspace_membership(parse_uuid(workspace_id), user, db)
    stmt = select(AiChat).order_by(AiChat.created_at.desc())
    stmt = stmt.where(AiChat.user_id == user.id)
    if workspace_id:
        stmt = stmt.where(AiChat.workspace_id == parse_uuid(workspace_id))
    if mode:
        stmt = stmt.where(AiChat.mode == mode)
    result = await db.execute(stmt)
    chats = result.scalars().all()

    # Fetch message counts and last messages for each chat
    chat_ids = [c.id for c in chats]
    if not chat_ids:
        return []

    # Get message counts
    count_stmt = (
        select(ChatMessage.chat_id, func.count(ChatMessage.id))
        .where(ChatMessage.chat_id.in_(chat_ids))
        .group_by(ChatMessage.chat_id)
    )
    count_result = await db.execute(count_stmt)
    count_map = dict(count_result.all())

    # Get last messages
    from sqlalchemy import desc

    last_msg_subq = (
        select(
            ChatMessage.chat_id,
            ChatMessage.content,
            func.row_number().over(
                partition_by=ChatMessage.chat_id,
                order_by=desc(ChatMessage.created_at),
            ).label("rn"),
        )
        .where(ChatMessage.chat_id.in_(chat_ids))
        .subquery()
    )
    last_msg_stmt = select(last_msg_subq.c.chat_id, last_msg_subq.c.content).where(
        last_msg_subq.c.rn == 1
    )
    last_msg_result = await db.execute(last_msg_stmt)
    last_msg_map = dict(last_msg_result.all())

    return [
        ChatListResponse(
            id=c.id,
            mode=c.mode,
            workspace_id=c.workspace_id,
            card_id=c.card_id,
            parent_chat_id=c.parent_chat_id,
            title=c.title,
            created_at=c.created_at,
            message_count=count_map.get(c.id, 0),
            last_message=last_msg_map.get(c.id, ""),
        )
        for c in chats
    ]


@router.post("/", response_model=ChatResponse)
async def create_chat(
    req: ChatCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new chat session."""
    import time

    workspace_uuid = None
    if req.workspace_id:
        try:
            workspace_uuid = parse_uuid(req.workspace_id)
            await get_workspace_membership(workspace_uuid, user, db)
        except Exception:
            workspace_uuid = None

    card_uuid = None
    if req.card_id:
        try:
            card_uuid = parse_uuid(req.card_id)
        except Exception:
            card_uuid = None

    parent_uuid = None
    if req.parent_chat_id:
        try:
            parent_uuid = parse_uuid(req.parent_chat_id)
        except Exception:
            parent_uuid = None

    local_id = req.local_id or f"chat_{int(time.time() * 1000)}"

    # Check if chat with this local_id already exists
    existing = await db.execute(
        select(AiChat).where(AiChat.local_id == local_id)
    )
    chat = existing.scalar_one_or_none()
    if chat:
        return ChatResponse(
            id=chat.id,
            mode=chat.mode,
            workspace_id=chat.workspace_id,
            card_id=chat.card_id,
            title=chat.title,
            created_at=chat.created_at,
            messages=[],
        )

    chat = AiChat(
        local_id=local_id,
        user_id=user.id,
        mode=req.mode,
        title=req.title,
        workspace_id=workspace_uuid,
        card_id=card_uuid,
        parent_chat_id=parent_uuid,
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
    chat = await db.get(AiChat, parse_uuid(chat_id))
    if not chat:
        raise HTTPException(status_code=404, detail="对话不存在")
    if chat.user_id != user.id:
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
    chat = await db.get(AiChat, parse_uuid(chat_id))
    if not chat:
        raise HTTPException(status_code=404, detail="对话不存在")
    if chat.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权访问此对话")
    msg = ChatMessage(
        chat_id=chat.id,
        role=req.role,
        content=req.content,
        web_search_results=[r.model_dump() for r in req.web_search_results] if req.web_search_results else None,
    )
    db.add(msg)
    await db.flush()
    # Update chat title with first user message
    if req.role == "user" and not chat.title:
        chat.title = req.content[:50]
    await db.commit()
    await db.refresh(msg)
    return msg


@router.post("/{chat_id}/messages/batch")
async def add_messages_batch(
    chat_id: str,
    req: list[ChatMessageCreate],
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Add multiple messages to a chat session at once."""
    chat = await db.get(AiChat, parse_uuid(chat_id))
    if not chat:
        raise HTTPException(status_code=404, detail="对话不存在")
    if chat.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权访问此对话")

    # Delete existing messages first (full replace)
    from sqlalchemy import delete as sql_delete

    await db.execute(sql_delete(ChatMessage).where(ChatMessage.chat_id == chat.id))

    msgs = []
    for item in req:
        msg = ChatMessage(
            chat_id=chat.id,
            role=item.role,
            content=item.content,
        )
        db.add(msg)
        msgs.append(msg)

    # Update title with first user message
    if not chat.title:
        for item in req:
            if item.role == "user":
                chat.title = item.content[:50]
                break

    await db.flush()
    await db.commit()
    for msg in msgs:
        await db.refresh(msg)
    return {"ok": True, "count": len(msgs)}


@router.delete("/{chat_id}")
async def delete_chat(
    chat_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a chat session and all its messages."""
    chat = await db.get(AiChat, parse_uuid(chat_id))
    if not chat:
        raise HTTPException(status_code=404, detail="对话不存在")
    if chat.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权访问此对话")
    await db.delete(chat)
    await db.commit()
    return {"ok": True}

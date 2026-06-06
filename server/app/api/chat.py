import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.chat import AiChat, ChatMessage
from app.models.user import User
from app.schemas.chat import (
    ChatCreate,
    ChatForkRequest,
    ChatForkResponse,
    ChatListResponse,
    ChatMessageCreate,
    ChatMessageResponse,
    ChatResponse,
    ChatSummarizeRequest,
)
from app.utils.auth import get_current_user, get_workspace_membership
from app.utils.helpers import parse_uuid

router = APIRouter()
logger = logging.getLogger(__name__)


async def _require_chat_access(chat: AiChat, user: User, db: AsyncSession) -> None:
    """Verify user can access this chat: owner OR workspace member."""
    if chat.user_id == user.id:
        return
    if chat.workspace_id:
        await get_workspace_membership(chat.workspace_id, user, db)
        return
    raise HTTPException(status_code=403, detail="无权访问此对话")


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
    if workspace_id:
        # When workspace scope is set, include root nodes without user_id
        # (legacy root nodes created before user_id was required)
        stmt = stmt.where(
            or_(AiChat.user_id == user.id, AiChat.node_type == "root")
        )
        stmt = stmt.where(AiChat.workspace_id == parse_uuid(workspace_id))
    else:
        stmt = stmt.where(AiChat.user_id == user.id)
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
            parent_id=c.parent_id,
            node_type=c.node_type,
            title=c.title,
            chat_status=c.chat_status,
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
        workspace_uuid = parse_uuid(req.workspace_id)
        await get_workspace_membership(workspace_uuid, user, db)

    card_uuid = None
    if req.card_id:
        card_uuid = parse_uuid(req.card_id)

    parent_uuid = None
    if req.parent_id:
        parent_uuid = parse_uuid(req.parent_id)

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
            parent_id=chat.parent_id,
            node_type=chat.node_type,
            title=chat.title,
            description=chat.description,
            summary=chat.summary,
            chat_status=chat.chat_status,
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
        parent_id=parent_uuid,
        node_type="branch" if parent_uuid else "root",
    )
    db.add(chat)
    await db.flush()

    # New conversations are root-level trees (forest model).
    # Auto-bind to topology only when explicitly provided a parent.
    if workspace_uuid and chat.parent_id:
        try:
            from app.services.topology import topology_service

            await topology_service.auto_bind_chat_to_node(
                db, chat, req.title or ""
            )
            await db.flush()
        except Exception as e:
            import logging

            logging.getLogger(__name__).warning(
                "Auto-bind chat to node failed: %s", e
            )

    await db.commit()
    await db.refresh(chat)
    return ChatResponse(
        id=chat.id,
        mode=chat.mode,
        workspace_id=chat.workspace_id,
        card_id=chat.card_id,
        parent_id=chat.parent_id,
        node_type=chat.node_type,
        title=chat.title,
        description=chat.description,
        summary=chat.summary,
        chat_status=chat.chat_status,
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
    await _require_chat_access(chat, user, db)
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
        parent_id=chat.parent_id,
        node_type=chat.node_type,
        title=chat.title,
        description=chat.description,
        summary=chat.summary,
        chat_status=chat.chat_status,
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
    await _require_chat_access(chat, user, db)
    msg = ChatMessage(
        chat_id=chat.id,
        role=req.role,
        content=req.content,
        web_search_results=[r.model_dump() for r in req.web_search_results] if req.web_search_results else None,
        fork_id=req.fork_id,
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
    await _require_chat_access(chat, user, db)

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


@router.patch("/{chat_id}/messages/{msg_id}", response_model=ChatMessageResponse)
async def update_message(
    chat_id: str,
    msg_id: str,
    req: ChatMessageCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update an existing message's content."""
    chat = await db.get(AiChat, parse_uuid(chat_id))
    if not chat:
        raise HTTPException(status_code=404, detail="对话不存在")
    await _require_chat_access(chat, user, db)
    msg = await db.get(ChatMessage, parse_uuid(msg_id))
    if not msg or msg.chat_id != chat.id:
        raise HTTPException(status_code=404, detail="消息不存在")
    msg.role = req.role
    msg.content = req.content
    if req.fork_id is not None:
        msg.fork_id = req.fork_id
    await db.commit()
    await db.refresh(msg)
    return msg


@router.delete("/{chat_id}")
async def delete_chat(
    chat_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a chat session and all its messages.

    Child chats (topology children) are cascade-deleted via parent_id FK.
    Also removes fork-divider messages in parent chats that reference this chat.
    """
    chat = await db.get(AiChat, parse_uuid(chat_id))
    if not chat:
        raise HTTPException(status_code=404, detail="对话不存在")
    await _require_chat_access(chat, user, db)

    # Remove fork-divider messages in other chats that reference this chat as a child
    fork_dividers = await db.execute(
        select(ChatMessage).where(
            ChatMessage.role == "fork-divider",
            ChatMessage.metadata_["child_chat_id"].as_string() == str(chat.id),
        )
    )
    for msg in fork_dividers.scalars().all():
        await db.delete(msg)

    await db.delete(chat)
    await db.commit()
    logger.info("Deleted chat %s", chat_id)
    return {"ok": True}


@router.get("/{chat_id}/delete-preview")
async def delete_chat_preview(
    chat_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Preview what will be affected by deleting a chat."""
    chat = await db.get(AiChat, parse_uuid(chat_id))
    if not chat:
        raise HTTPException(status_code=404, detail="对话不存在")
    await _require_chat_access(chat, user, db)

    from sqlalchemy import func

    # Count messages
    msg_count = await db.execute(
        select(func.count()).where(ChatMessage.chat_id == chat.id)
    )
    # Count child chats (topology children)
    child_count = await db.execute(
        select(func.count()).where(AiChat.parent_id == chat.id)
    )

    return {
        "chat_title": chat.title or "未命名对话",
        "messages": msg_count.scalar() or 0,
        "child_chats": child_count.scalar() or 0,
        "node_title": chat.title,
        "node_will_archive": False,
    }


# ── Fork & Summarize ──


@router.post("/{chat_id}/fork", response_model=ChatForkResponse)
async def fork_chat(
    chat_id: str,
    req: ChatForkRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Fork a conversation by creating a child AiChat with compressed parent context."""
    from app.services.fork_compress import fork_compressor

    parent_chat = await db.get(AiChat, parse_uuid(chat_id))
    if not parent_chat:
        raise HTTPException(status_code=404, detail="对话不存在")
    await _require_chat_access(parent_chat, user, db)

    # Fetch messages for compression (last 50)
    result = await db.execute(
        select(ChatMessage)
        .where(
            ChatMessage.chat_id == parent_chat.id,
            ChatMessage.role.in_(["user", "assistant"]),
        )
        .order_by(ChatMessage.created_at.desc())
        .limit(50)
    )
    messages = [{"role": m.role, "content": m.content} for m in reversed(result.scalars().all())]

    # Use ForkCompressor
    context_summary = await fork_compressor.compress(messages, strategy=req.context_strategy)

    # Determine depth from parent by walking the chain
    depth = 0
    current_parent_id = parent_chat.parent_id
    max_depth = 20
    while current_parent_id and max_depth > 0:
        max_depth -= 1
        depth += 1
        depth_result = await db.execute(
            select(AiChat.parent_id).where(AiChat.id == current_parent_id)
        )
        current_parent_id = depth_result.scalar_one_or_none()

    # Create child AiChat
    branch_label = req.topic or "手动分支"
    child_chat = AiChat(
        workspace_id=parent_chat.workspace_id,
        parent_id=parent_chat.id,
        user_id=user.id,
        mode=req.mode,
        title=branch_label,
        node_type="branch",
    )
    db.add(child_chat)
    await db.flush()

    # Insert fork-divider message in parent chat
    divider = ChatMessage(
        chat_id=parent_chat.id,
        role="fork-divider",
        content="",
        metadata_={
            "child_chat_id": str(child_chat.id),
            "branch_label": branch_label,
            "parent_context_summary": context_summary,
            "depth": depth,
        },
    )
    db.add(divider)
    await db.commit()

    return ChatForkResponse(
        chat_id=str(child_chat.id),
        context_summary=context_summary or "",
    )


@router.get("/{chat_id}/path")
async def get_chat_path(
    chat_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the topology path from root to this chat (walks ai_chats.parent_id chain)"""
    chat = await db.get(AiChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    await _require_chat_access(chat, current_user, db)

    # Build path by walking parent_id chain
    path = []
    current_id: uuid.UUID | None = chat.id
    max_depth = 20  # safety limit

    while current_id and max_depth > 0:
        max_depth -= 1
        node_result = await db.execute(
            select(AiChat).where(AiChat.id == current_id)
        )
        node = node_result.scalar_one_or_none()
        if not node:
            break

        path.insert(0, {
            "node_id": str(node.id),
            "title": node.title,
            "chat_id": str(node.id),
            "node_type": node.node_type,
        })

        current_id = node.parent_id

    return {"path": path}


@router.post("/{chat_id}/summarize")
async def summarize_chat(
    chat_id: str,
    req: ChatSummarizeRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Summarize a conversation into a card. Runs LLM in background."""
    chat = await db.get(AiChat, parse_uuid(chat_id))
    if not chat:
        raise HTTPException(status_code=404, detail="对话不存在")
    await _require_chat_access(chat, user, db)

    # Fetch all messages
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.chat_id == chat.id)
        .order_by(ChatMessage.created_at.asc())
    )
    messages = result.scalars().all()

    if len(messages) < 2:
        raise HTTPException(status_code=400, detail="对话内容太少，无法生成摘要")

    # Build conversation text
    conversation_text = "\n".join(
        f"{'用户' if m.role == 'user' else 'AI'}: {m.content}"
        for m in messages
    )

    # Generate summary in background
    background_tasks.add_task(
        _generate_summary_card,
        chat_id=chat.id,
        workspace_id=chat.workspace_id,
        user_id=user.id,
        conversation_text=conversation_text,
        title=req.title,
        keywords=req.keywords,
    )

    return {"ok": True, "message": "摘要生成中，稍后将作为卡片保存"}


async def _generate_summary_card(
    chat_id: uuid.UUID,
    workspace_id: uuid.UUID | None,
    user_id: uuid.UUID,
    conversation_text: str,
    title: str = "",
    keywords: list[str] | None = None,
):
    """Generate a summary card from a conversation (runs in background)."""
    import logging

    logger = logging.getLogger(__name__)

    try:
        from app.database import async_session
        from app.models.card import Card
        from app.services.llm import llm_service

        async with async_session() as db:
            # Generate summary using LLM
            summary_prompt = (
                "请将以下对话内容整理成一篇结构化的知识笔记。\n"
                "要求：\n"
                "- 使用 Markdown 格式\n"
                "- 用 ## 标题分段\n"
                "- 提取关键观点和结论\n"
                "- 保留重要的技术细节\n"
                "- 语言简洁精炼\n\n"
                f"对话内容：\n{conversation_text[:8000]}"
            )

            summary = await llm_service.complete_simple(
                summary_prompt, "", max_tokens=2048
            )

            # Generate title if not provided
            if not title:
                title_raw = await llm_service.extraction_complete_simple(
                    "请用不超过20个字概括以下内容的主题，作为标题。只输出标题文字本身。",
                    summary[:500],
                    max_tokens=32,
                )
                title = title_raw.strip()[:50]

            # Extract keywords if not provided
            if not keywords:
                kw_raw = await llm_service.extraction_complete_simple(
                    "从以下内容中提取3-5个核心关键字，用逗号分隔。",
                    summary[:500],
                    max_tokens=64,
                )
                keywords = [kw.strip() for kw in kw_raw.split(",") if kw.strip()][:5]

            # Create card
            card = Card(
                local_id=f"summary_{uuid.uuid4().hex[:16]}",
                workspace_id=workspace_id,
                creator_id=user_id,
                title=title,
                content=summary,
                keywords=keywords or [],
                is_temp=False,
            )
            db.add(card)
            await db.flush()

            # Generate embedding and classify
            from app.services.embedding import embedding_service
            text = embedding_service.card_to_text(card.title, card.content, card.keywords, card.emotion_tag)
            embedding = await embedding_service.embed(text)
            card.embedding = embedding
            await db.commit()

            # Assign to topic
            from app.services.topic import topic_service
            await topic_service.assign_card_to_topic(db, card)
            await db.commit()

            # Auto-classify into topology tree
            from app.services.topology import topology_service
            await topology_service.assign_card_to_node(db, card)
            await db.commit()

            logger.info("Summary card created: %s (from chat %s)", card.id, chat_id)

    except Exception as e:
        logger.error("Summary generation failed for chat %s: %s", chat_id, e, exc_info=True)

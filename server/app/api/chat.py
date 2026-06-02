import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.chat import AiChat, ChatMessage
from app.models.topology import TreeNode
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
        workspace_uuid = parse_uuid(req.workspace_id)
        try:
            await get_workspace_membership(workspace_uuid, user, db)
        except HTTPException:
            workspace_uuid = None

    card_uuid = None
    if req.card_id:
        card_uuid = parse_uuid(req.card_id)

    parent_uuid = None
    if req.parent_chat_id:
        parent_uuid = parse_uuid(req.parent_chat_id)

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
    if chat.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权访问此对话")
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
    """Delete a chat session and all its messages."""
    chat = await db.get(AiChat, parse_uuid(chat_id))
    if not chat:
        raise HTTPException(status_code=404, detail="对话不存在")
    if chat.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权访问此对话")
    await db.delete(chat)
    await db.commit()
    return {"ok": True}


# ── Fork & Summarize ──


@router.post("/{chat_id}/fork", response_model=ChatForkResponse)
async def fork_chat(
    chat_id: str,
    req: ChatForkRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Fork a conversation into a sub-conversation, creating a child topology node."""
    import time

    parent_chat = await db.get(AiChat, parse_uuid(chat_id))
    if not parent_chat:
        raise HTTPException(status_code=404, detail="对话不存在")
    if parent_chat.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权访问此对话")

    # Get parent's topology node
    parent_node_id = parent_chat.tree_node_id
    if not parent_node_id:
        # Parent chat has no node - create root node for workspace first
        root_result = await db.execute(
            select(TreeNode).where(
                TreeNode.workspace_id == parent_chat.workspace_id,
                TreeNode.parent_id == None,
                TreeNode.node_type == "root"
            )
        )
        root_node = root_result.scalar_one_or_none()
        if not root_node:
            # Create root node
            root_node = TreeNode(
                workspace_id=parent_chat.workspace_id,
                title="知识探索",
                node_type="root",
                status="active",
                embedding=[0.0] * 768  # Placeholder embedding
            )
            db.add(root_node)
            await db.flush()

        # Bind parent chat to root
        parent_chat.tree_node_id = root_node.id
        parent_node_id = root_node.id

    # Create child topology node
    child_node = TreeNode(
        workspace_id=parent_chat.workspace_id,
        parent_id=parent_node_id,
        title=req.title or req.topic[:50] if req.topic else "新分支",
        node_type="branch",
        status="active",
        embedding=[0.0] * 768  # Will be updated when cards are added
    )
    db.add(child_node)
    await db.flush()

    # Fetch recent messages for context
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.chat_id == parent_chat.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(20)
    )
    recent_messages = list(reversed(result.scalars().all()))

    # Build context summary
    context_lines = []
    for msg in recent_messages:
        role_label = "用户" if msg.role == "user" else "AI"
        context_lines.append(f"{role_label}: {msg.content[:200]}")
    context_summary = "\n".join(context_lines)

    # If a topic is specified, prepend it to the context
    if req.topic:
        context_summary = f"## 聚焦主题: {req.topic}\n\n{context_summary}"

    # Auto-generate title if not provided
    title = req.title
    if not title:
        title = req.topic[:50] if req.topic else f"分支: {parent_chat.title[:40]}"

    # Create sub-conversation
    local_id = f"fork_{int(time.time() * 1000)}"
    forked = AiChat(
        local_id=local_id,
        user_id=user.id,
        mode=req.mode,
        title=title,
        workspace_id=parent_chat.workspace_id,
        card_id=parent_chat.card_id,
        parent_chat_id=parent_chat.id,
        tree_node_id=child_node.id,
    )
    db.add(forked)
    await db.flush()

    # Link node back to chat
    child_node.chat_id = forked.id

    # Add context as the first system message
    context_msg = ChatMessage(
        chat_id=forked.id,
        role="assistant",
        content=f"这是从「{parent_chat.title}」分叉出来的对话。\n\n以下是之前的对话上下文：\n\n{context_summary}",
    )
    db.add(context_msg)
    await db.commit()
    await db.refresh(forked)

    return ChatForkResponse(
        chat=ChatResponse(
            id=forked.id,
            mode=forked.mode,
            workspace_id=forked.workspace_id,
            card_id=forked.card_id,
            parent_chat_id=forked.parent_chat_id,
            tree_node_id=forked.tree_node_id,
            title=forked.title,
            created_at=forked.created_at,
            messages=[ChatMessageResponse.model_validate(context_msg)],
        ),
        context_summary=context_summary,
    )


@router.get("/{chat_id}/path")
async def get_chat_path(
    chat_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the topology path from root to this chat's node"""
    # Get chat
    result = await db.execute(
        select(AiChat).where(AiChat.id == chat_id, AiChat.user_id == current_user.id)
    )
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    if not chat.tree_node_id:
        return {"path": []}

    # Build path from node to root
    path = []
    current_node_id = chat.tree_node_id

    while current_node_id:
        node_result = await db.execute(
            select(TreeNode).where(TreeNode.id == current_node_id)
        )
        node = node_result.scalar_one_or_none()
        if not node:
            break

        path.insert(0, {
            "node_id": str(node.id),
            "title": node.title,
            "chat_id": str(node.chat_id) if node.chat_id else None,
            "node_type": node.node_type
        })

        current_node_id = node.parent_id

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
    if chat.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权访问此对话")

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
                title_raw = await llm_service.complete_simple(
                    "请用不超过20个字概括以下内容的主题，作为标题。只输出标题文字本身。",
                    summary[:500],
                    max_tokens=32,
                )
                title = title_raw.strip()[:50]

            # Extract keywords if not provided
            if not keywords:
                kw_raw = await llm_service.complete_simple(
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

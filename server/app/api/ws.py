"""
WebSocket endpoint for streaming AI chat responses.

Inspired by DeepTutor's unified WebSocket architecture.
"""

import asyncio
import json
import logging
import re
import uuid
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.chat import AiChat, ChatMessage
from app.services.rag import rag_service
from app.services.topology import topology_service

router = APIRouter()
logger = logging.getLogger(__name__)

BRANCH_PATTERN = re.compile(r'^\s*\[BRANCH:\s*(.+?)\]\s*')


@router.websocket("/ws")
async def chat_websocket(websocket: WebSocket):
    """
    Unified WebSocket endpoint for AI chat streaming.

    Client message types:
    - chat: Start a new chat turn
    - rag: Start a RAG query turn
    - cancel: Cancel current streaming

    Server event types:
    - content: Text chunk from LLM
    - sources: Source cards (for RAG)
    - web_search_results: Web search results
    - done: Stream completed
    - error: Error occurred
    """
    # Accept connection first
    await websocket.accept()

    # Auth check - token from query params
    token = websocket.query_params.get("token")
    if not token:
        await websocket.send_json({
            "type": "error",
            "content": "Missing authentication token",
        })
        await websocket.close(code=4001)
        return

    # Verify token and get user
    from app.utils.auth import decode_access_token
    try:
        user_id = decode_access_token(token)
        if not user_id:
            raise ValueError("Invalid token")
    except Exception as e:
        await websocket.send_json({
            "type": "error",
            "content": f"Authentication failed: {str(e)}",
        })
        await websocket.close(code=4001)
        return

    closed = False
    current_task: asyncio.Task | None = None

    async def safe_send(data: dict[str, Any]) -> None:
        nonlocal closed
        if closed:
            return
        try:
            await websocket.send_json(data)
        except Exception:
            closed = True

    async def handle_branch_marker(
        db: AsyncSession,
        chat_id: str,
        full_response: str,
        current_fork_id: str | None,
        workspace_id: str | None = None,
    ) -> tuple[str, str | None]:
        """Parse [BRANCH: ...] marker from LLM response.

        Returns (clean_response, fork_id). fork_id is set if a fork was created.
        """
        from app.config import settings
        from app.services.fork_compress import fork_compressor
        from app.services.split_guard import split_guard

        stripped = full_response.lstrip()
        match = BRANCH_PATTERN.match(stripped)
        if not match:
            return full_response, current_fork_id

        branch_label = match.group(1).strip()
        clean_response = stripped[match.end():]

        # Check auto-fork enabled
        if not getattr(settings, "auto_fork_enabled", True):
            return clean_response, current_fork_id

        # SplitGuard check
        if not await split_guard.can_fork(db, chat_id, current_fork_id, branch_label):
            await safe_send({"type": "toast", "content": f"分叉被保护机制阻止：{branch_label}"})
            return clean_response, current_fork_id

        # Get parent chat for workspace_id and parent_id
        parent_chat = await db.get(AiChat, uuid.UUID(chat_id))
        if not parent_chat:
            return clean_response, current_fork_id

        # Compress parent context
        result = await db.execute(
            select(ChatMessage).where(
                ChatMessage.chat_id == uuid.UUID(chat_id),
                ChatMessage.role.in_(["user", "assistant"]),
            ).order_by(ChatMessage.created_at.desc()).limit(50)
        )
        messages = [{"role": m.role, "content": m.content} for m in reversed(result.scalars().all())]
        strategy = getattr(settings, "fork_context_strategy", "compress")
        summary = await fork_compressor.compress(messages, strategy=strategy)

        # Create child AiChat
        child_chat = AiChat(
            workspace_id=parent_chat.workspace_id,
            parent_id=parent_chat.id,
            user_id=parent_chat.user_id,
            mode="rag",
            title=branch_label,
            node_type="branch",
        )
        db.add(child_chat)
        await db.flush()

        # Insert fork-divider in parent chat
        divider = ChatMessage(
            chat_id=parent_chat.id,
            role="fork-divider",
            content="",
            metadata_={
                "child_chat_id": str(child_chat.id),
                "branch_label": branch_label,
                "parent_context_summary": summary,
                "depth": 0,
            },
        )
        db.add(divider)
        await db.commit()

        # Notify frontend
        await safe_send({
            "type": "fork_created",
            "chat_id": str(child_chat.id),
            "branch_label": branch_label,
            "depth": 0,
        })

        return clean_response, str(child_chat.id)

    async def handle_chat(
        message: str,
        history: list[dict[str, str]] | None,
        web_search: bool,
        chat_id: str | None = None,
        workspace_id: str | None = None,
        current_fork_id: str | None = None,
    ):
        """Handle general chat without RAG."""
        try:
            # Collect full response for branch marker parsing
            full_response = ""

            async for chunk in rag_service.chat_stream(message, history=history, web_search=web_search):
                if isinstance(chunk, dict):
                    # Web search results or other metadata
                    await safe_send(chunk)
                else:
                    # Text content — accumulate for marker parsing
                    full_response += chunk
                    await safe_send({
                        "type": "content",
                        "content": chunk,
                    })

            # Parse branch marker from the full response
            if chat_id and full_response:
                try:
                    async for db_session in get_db():
                        clean_response, new_fork_id = await handle_branch_marker(
                            db_session, chat_id, full_response, current_fork_id, workspace_id,
                        )
                        break
                    # If a fork was created, send the clean response (without marker)
                    if new_fork_id and new_fork_id != current_fork_id:
                        await safe_send({"type": "content_replace", "content": clean_response})
                except Exception as e:
                    logger.warning("Branch marker parsing failed: %s", e)

            await safe_send({"type": "done"})

            # Async summary update (fire-and-forget)
            if chat_id:
                try:
                    async for db_session in get_db():
                        await topology_service.update_node_summary_from_chat(db_session, chat_id)
                        break
                except Exception as e:
                    logger.warning("Auto summary update failed: %s", e)
        except Exception as e:
            logger.error(f"Chat stream error: {e}", exc_info=True)
            await safe_send({
                "type": "error",
                "content": str(e),
            })

    async def handle_rag(
        question: str,
        workspace_ids: list[str] | None,
        card_id: str | None,
        top_k: int,
        web_search: bool,
        history: list[dict[str, str]] | None,
        retrieval_level: int | None = None,
        chat_id: str | None = None,
        current_fork_id: str | None = None,
    ):
        """Handle RAG query. Creates its own DB session to avoid lifecycle issues."""
        try:
            async for db in get_db():
                # Collect full response for branch marker parsing
                full_response = ""

                async for chunk in rag_service.ask_stream(
                    db,
                    question,
                    workspace_ids=workspace_ids,
                    card_id=card_id,
                    top_k=top_k,
                    web_search=web_search,
                    history=history,
                    retrieval_level=retrieval_level,
                    chat_id=chat_id,
                ):
                    if isinstance(chunk, dict):
                        # Sources, web search results, or other metadata
                        await safe_send(chunk)
                    else:
                        # Text content — accumulate for marker parsing
                        full_response += chunk
                        await safe_send({
                            "type": "content",
                            "content": chunk,
                        })

                # Parse branch marker from the full response
                if chat_id and full_response:
                    try:
                        clean_response, new_fork_id = await handle_branch_marker(
                            db, chat_id, full_response, current_fork_id,
                            workspace_ids[0] if workspace_ids else None,
                        )
                        # If a fork was created, send the clean response (without marker)
                        if new_fork_id and new_fork_id != current_fork_id:
                            await safe_send({"type": "content_replace", "content": clean_response})
                    except Exception as e:
                        logger.warning("Branch marker parsing failed: %s", e)

                # Async summary update
                if chat_id:
                    try:
                        await topology_service.update_node_summary_from_chat(db, chat_id)
                        await db.commit()
                    except Exception as e:
                        logger.warning("Auto summary update failed: %s", e)
                break

            await safe_send({"type": "done"})
        except Exception as e:
            logger.error(f"RAG stream error: {e}", exc_info=True)
            await safe_send({
                "type": "error",
                "content": str(e),
            })

    try:
        while not closed:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await safe_send({"type": "error", "content": "Invalid JSON"})
                continue

            msg_type = msg.get("type")

            if msg_type == "chat":
                # Cancel previous task if any
                if current_task and not current_task.done():
                    current_task.cancel()

                message = msg.get("message", "")
                history = msg.get("history")
                web_search = msg.get("web_search", False)
                chat_id = msg.get("chat_id")
                workspace_id = msg.get("workspace_id")
                current_fork_id = msg.get("current_fork_id")

                current_task = asyncio.create_task(
                    handle_chat(
                        message, history, web_search,
                        chat_id=chat_id, workspace_id=workspace_id,
                        current_fork_id=current_fork_id,
                    )
                )

            elif msg_type == "rag":
                # Cancel previous task if any
                if current_task and not current_task.done():
                    current_task.cancel()

                question = msg.get("question", "")
                workspace_ids = msg.get("workspace_ids")
                card_id = msg.get("card_id")
                top_k = msg.get("top_k", 5)
                web_search = msg.get("web_search", False)
                history = msg.get("history")
                retrieval_level = msg.get("retrieval_level")
                chat_id = msg.get("chat_id")
                current_fork_id = msg.get("current_fork_id")

                current_task = asyncio.create_task(
                    handle_rag(
                        question, workspace_ids, card_id, top_k,
                        web_search, history, retrieval_level, chat_id,
                        current_fork_id=current_fork_id,
                    )
                )

            elif msg_type == "cancel":
                if current_task and not current_task.done():
                    current_task.cancel()
                    await safe_send({"type": "cancelled"})

            elif msg_type == "ping":
                await safe_send({"type": "pong"})

            else:
                await safe_send({
                    "type": "error",
                    "content": f"Unknown message type: {msg_type}",
                })

    except WebSocketDisconnect:
        logger.debug("Client disconnected from /ws")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
        await safe_send({"type": "error", "content": str(e)})
    finally:
        closed = True
        if current_task and not current_task.done():
            current_task.cancel()

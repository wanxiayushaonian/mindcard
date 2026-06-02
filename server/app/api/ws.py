"""
WebSocket endpoint for streaming AI chat responses.

Inspired by DeepTutor's unified WebSocket architecture.
"""

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.chat import AiChat, ChatMessage
from app.models.topology import TreeNode
from app.services.embedding import embedding_service
from app.services.rag import rag_service
from app.services.topology import topology_service

router = APIRouter()
logger = logging.getLogger(__name__)


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

    async def detect_topic_drift(
        db: AsyncSession,
        chat_id: str,
        current_message: str,
        workspace_id: str | None,
    ) -> dict | None:
        """Detect topic drift by comparing with previous user message.

        Returns drift info dict if drift detected, None otherwise.
        """
        if not workspace_id or not chat_id:
            return None

        # Get previous user messages in this chat
        result = await db.execute(
            select(ChatMessage)
            .where(ChatMessage.chat_id == chat_id)
            .where(ChatMessage.role == "user")
            .order_by(ChatMessage.created_at.desc())
            .limit(1)
        )
        prev_msg = result.scalar_one_or_none()
        if not prev_msg:
            return None  # First message, no drift possible

        # Embed both messages
        prev_embedding = await embedding_service.embed(prev_msg.content)
        curr_embedding = await embedding_service.embed(current_message)
        if not prev_embedding or not curr_embedding:
            return None

        # Calculate similarity
        dist = topology_service._cosine_distance(prev_embedding, curr_embedding)
        similarity = 1.0 - dist

        if similarity >= 0.5:
            return None  # No drift

        # Drift detected — create child node
        chat = await db.get(AiChat, chat_id)
        if not chat or not chat.tree_node_id:
            return None

        current_node = await db.get(TreeNode, chat.tree_node_id)
        if not current_node:
            return None

        title = current_message[:50].strip()
        if len(current_message) > 50:
            title += "..."

        child_node = TreeNode(
            workspace_id=workspace_id,
            parent_id=current_node.id,
            node_type="branch",
            title=title,
            description="",
            summary="",
            status="active",
            embedding=curr_embedding,
        )
        db.add(child_node)
        await db.flush()

        # Bind chat to new child node
        chat.tree_node_id = child_node.id
        await db.flush()

        return {
            "node_id": str(child_node.id),
            "title": title,
            "parent_id": str(current_node.id),
        }

    async def handle_chat(
        message: str,
        history: list[dict[str, str]] | None,
        web_search: bool,
        chat_id: str | None = None,
        workspace_id: str | None = None,
    ):
        """Handle general chat without RAG."""
        try:
            async for chunk in rag_service.chat_stream(message, history=history, web_search=web_search):
                if isinstance(chunk, dict):
                    # Web search results or other metadata
                    await safe_send(chunk)
                else:
                    # Text content
                    await safe_send({
                        "type": "content",
                        "content": chunk,
                    })
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
        db: AsyncSession,
        question: str,
        workspace_ids: list[str] | None,
        card_id: str | None,
        top_k: int,
        web_search: bool,
        history: list[dict[str, str]] | None,
        retrieval_level: int | None = None,
        chat_id: str | None = None,
    ):
        """Handle RAG query."""
        try:
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
                    # Text content
                    await safe_send({
                        "type": "content",
                        "content": chunk,
                    })
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

                # Detect topic drift before streaming
                if chat_id and workspace_id:
                    try:
                        async for db in get_db():
                            drift = await detect_topic_drift(db, chat_id, message, workspace_id)
                            if drift:
                                await safe_send({
                                    "type": "auto_fork",
                                    "node_id": drift["node_id"],
                                    "title": drift["title"],
                                })
                            break
                    except Exception as e:
                        logger.warning("Topic drift detection failed: %s", e)

                current_task = asyncio.create_task(
                    handle_chat(
                        message, history, web_search,
                        chat_id=chat_id, workspace_id=workspace_id,
                    )
                )

            elif msg_type == "rag":
                # Cancel previous task if any
                if current_task and not current_task.done():
                    current_task.cancel()

                # Get database session
                async for db in get_db():
                    question = msg.get("question", "")
                    workspace_ids = msg.get("workspace_ids")
                    card_id = msg.get("card_id")
                    top_k = msg.get("top_k", 5)
                    web_search = msg.get("web_search", False)
                    history = msg.get("history")
                    retrieval_level = msg.get("retrieval_level")
                    chat_id = msg.get("chat_id")

                    # Detect topic drift before streaming
                    if chat_id:
                        ws_id = workspace_ids[0] if workspace_ids else None
                        drift = await detect_topic_drift(db, chat_id, question, ws_id)
                        if drift:
                            await safe_send({
                                "type": "auto_fork",
                                "node_id": drift["node_id"],
                                "title": drift["title"],
                            })

                    current_task = asyncio.create_task(
                        handle_rag(db, question, workspace_ids, card_id, top_k, web_search, history, retrieval_level, chat_id)
                    )
                    break

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

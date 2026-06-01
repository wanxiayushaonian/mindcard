"""
WebSocket endpoint for streaming AI chat responses.

Inspired by DeepTutor's unified WebSocket architecture.
"""

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.rag import rag_service

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
    from app.utils.auth import decode_token
    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
        if not user_id:
            raise ValueError("Invalid token payload")
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

    async def handle_chat(message: str, history: list[dict[str, str]] | None, web_search: bool):
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

                current_task = asyncio.create_task(
                    handle_chat(message, history, web_search)
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

                    current_task = asyncio.create_task(
                        handle_rag(db, question, workspace_ids, card_id, top_k, web_search, history)
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

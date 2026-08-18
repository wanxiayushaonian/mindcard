"""
WebSocket endpoint for streaming AI chat responses.

Inspired by DeepTutor's unified WebSocket architecture.
"""

import asyncio
import json
import logging
import re
import uuid
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.rag import rag_service
from app.services.topology import topology_service
from app.services.web_search import web_search_service
from app.utils.helpers import parse_uuid
from app.utils.rate_limit import ws_limiter
from app.utils.usage import get_daily_total

MAX_TOOL_ROUNDS = 5

# Tools available to the forest-level synthesis agent (VISION 理念6).
_SYNTHESIS_TOOLS = {
    "topology_forest_map",
    "get_node_detail",
    "get_card_relations",
    "get_node_subtree",
}

router = APIRouter()


async def _quota_exceeded(user_id: str) -> bool:
    """True when the user has exhausted today's LLM token quota (0 = disabled)."""
    from app.config import settings

    if settings.llm_daily_quota_tokens <= 0:
        return False
    try:
        return await get_daily_total(uuid.UUID(user_id)) >= settings.llm_daily_quota_tokens
    except (ValueError, TypeError):
        return False
logger = logging.getLogger(__name__)

def _strip_thinking(text: str) -> tuple[str, str]:
    """Remove thinking blocks from LLM response, returning (clean_text, thinking_content).

    Handles both <think> and <thinking> tags.
    """
    thinking_parts: list[str] = []

    def _collect(match: re.Match) -> str:
        thinking_parts.append(match.group(1).strip())
        return ""

    clean = re.sub(r"<think>(.*?)</think>\s*", _collect, text, flags=re.DOTALL)
    clean = re.sub(r"<thinking>(.*?)</thinking>\s*", _collect, clean, flags=re.DOTALL)
    return clean.strip(), "\n\n".join(thinking_parts)



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

    # Attribute LLM usage to this user for the whole WS session.
    from app.utils.usage import set_current_user_id
    set_current_user_id(user_id)

    closed = False
    current_task: asyncio.Task | None = None
    send_lock = asyncio.Lock()

    async def _verify_chat_ownership(chat_id: str) -> bool:
        """Check that the chat belongs to the authenticated user."""
        from app.models.chat import AiChat
        try:
            async for db in get_db():
                chat = await db.get(AiChat, uuid.UUID(chat_id))
                if not chat:
                    return False
                if chat.user_id and str(chat.user_id) != str(user_id):
                    return False
                return True
        except (ValueError, TypeError):
            return False

    async def _verify_workspace_access(workspace_id: str | None) -> bool:
        """Check that the authenticated user is a member of the workspace."""
        if not workspace_id:
            return True
        from app.models.user import User
        from app.utils.auth import get_workspace_membership
        try:
            async for db in get_db():
                db_user = await db.get(User, uuid.UUID(user_id))
                if db_user is None:
                    return False
                await get_workspace_membership(parse_uuid(workspace_id), db_user, db)
                return True
        except Exception:
            return False

    def _make_serializable(obj: Any) -> Any:
        """Recursively convert Pydantic models and other non-serializable objects."""
        if isinstance(obj, BaseModel):
            return obj.model_dump()
        if isinstance(obj, list):
            return [_make_serializable(item) for item in obj]
        if isinstance(obj, dict):
            return {k: _make_serializable(v) for k, v in obj.items()}
        return obj

    async def safe_send(data: dict[str, Any]) -> None:
        nonlocal closed
        async with send_lock:
            if closed:
                return
            try:
                await websocket.send_json(_make_serializable(data))
            except Exception as e:
                logger.warning("safe_send failed: %s (%s)", data.get("type", "?"), e)
                closed = True

    async def _run_tool_loop(
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        db: AsyncSession,
        workspace_id: str | None,
        chat_id: str | None = None,
        current_fork_id: str | None = None,
        max_rounds: int = MAX_TOOL_ROUNDS,
    ) -> AsyncGenerator[str | dict[str, Any], None]:
        """Run the tool execution loop around the LLM.

        Yields text chunks and event dicts (tool_executed, fork_created, etc.).
        When create_fork succeeds, emits a fork_created event so the frontend
        switches context before the LLM streams its answer in the next round.
        """
        from app.services.llm import get_llm_service
        from app.tools.registry import get_tool

        active_fork_id = current_fork_id

        for round_idx in range(max_rounds):
            full_response = ""
            tool_calls_collected: list[dict[str, Any]] = []

            logger.info("_run_tool_loop: round %d, %d messages, %d tools",
                        round_idx + 1, len(messages), len(tools))
            try:
                async for chunk in get_llm_service().stream(messages, tools=tools):
                    if isinstance(chunk, dict):
                        if chunk.get("type") == "tool_call":
                            tool_calls_collected.append(chunk)
                        elif chunk.get("type") == "tool_calls_end":
                            pass
                        else:
                            yield chunk
                    else:
                        full_response += chunk
                        yield chunk
            except Exception as e:
                logger.error("_run_tool_loop: LLM stream failed: %s", e, exc_info=True)
                yield {"type": "error", "content": f"LLM stream error: {e}"}
                return

            logger.info("_run_tool_loop: round %d done, response_len=%d, tool_calls=%d",
                        round_idx + 1, len(full_response), len(tool_calls_collected))

            if not tool_calls_collected:
                return

            # Append assistant message with tool_calls
            messages.append({
                "role": "assistant",
                "content": full_response,
                "tool_calls": [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": json.dumps(tc["arguments"], ensure_ascii=False),
                        },
                    }
                    for tc in tool_calls_collected
                ],
            })

            # Execute each tool and append results
            for tc in tool_calls_collected:
                tool = get_tool(tc["name"])
                if tool:
                    try:
                        # Notify frontend that tool is executing (loading state)
                        yield {
                            "type": "tool_executing",
                            "tool_name": tc["name"],
                            "arguments": tc["arguments"],
                        }
                        result = await tool.execute(
                            tc["arguments"],
                            {
                                "db": db,
                                "workspace_id": workspace_id,
                                "chat_id": chat_id,
                                "current_fork_id": active_fork_id,
                            },
                        )
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": result,
                        })

                        # create_fork emits fork_created so frontend switches context
                        if tc["name"] == "create_fork":
                            try:
                                parsed = json.loads(result)
                                if parsed.get("status") == "created":
                                    active_fork_id = parsed["chat_id"]
                                    # Inject profile system prompt suffix
                                    suffix = parsed.get("system_prompt_suffix")
                                    if suffix and messages and messages[0].get("role") == "system":
                                        messages[0]["content"] += f"\n\n{suffix}"
                                    yield {
                                        "type": "fork_created",
                                        "chat_id": parsed["chat_id"],
                                        "branch_label": parsed["branch_label"],
                                        "depth": parsed["depth"],
                                        "node_id": parsed["chat_id"],
                                        "divider_msg_id": parsed["divider_msg_id"],
                                        "profile": parsed.get("profile"),
                                    }
                            except (json.JSONDecodeError, KeyError):
                                pass
                        # Always emit tool_executed (including create_fork)
                        yield {
                            "type": "tool_executed",
                            "tool_name": tc["name"],
                            "arguments": tc["arguments"],
                            "result": result,
                        }
                    except Exception as e:
                        logger.warning("Tool %s execution failed: %s", tc["name"], e)
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": f"Error: {e}",
                        })
                else:
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": f"Unknown tool: {tc['name']}",
                    })

    async def handle_chat(
        message: str,
        history: list[dict[str, str]] | None,
        web_search: bool,
        chat_id: str | None = None,
        workspace_id: str | None = None,
        current_fork_id: str | None = None,
    ):
        """Handle general chat without RAG."""
        from app.tools.registry import get_all_tool_specs

        try:
            full_response = ""
            streamed_thinking = False
            tools = get_all_tool_specs() if workspace_id else None

            if tools:
                system_content = (
                    rag_service.MARKDOWN_SYSTEM_PROMPT
                    + "\n\n" + rag_service.CREATE_FORK_INSTRUCTION
                    + "\n\n" + rag_service.MEMORY_EDIT_INSTRUCTION
                )
                messages = [{"role": "system", "content": system_content}]
                if history:
                    messages.extend(history)
                user_message = message
                if web_search:
                    search_results = await web_search_service.search(message, max_results=8)
                    if search_results:
                        user_message = (
                            message + "\n\n" + web_search_service.format_results(search_results)
                        )
                        await safe_send({
                            "type": "web_search_results",
                            "results": [
                                {"title": r.title, "snippet": r.snippet, "url": r.url}
                                for r in search_results
                            ],
                        })
                messages.append({"role": "user", "content": user_message})

                async for db_session in get_db():
                    async for chunk in _run_tool_loop(
                        messages, tools, db_session, workspace_id,
                        chat_id=chat_id, current_fork_id=current_fork_id,
                    ):
                        if isinstance(chunk, dict):
                            if chunk.get("type") == "thinking":
                                streamed_thinking = True
                            await safe_send(chunk)
                        else:
                            full_response += chunk
                            await safe_send({"type": "content", "content": chunk})
                    break
            else:
                async for chunk in rag_service.chat_stream(
                    message, history=history, web_search=web_search
                ):
                    if isinstance(chunk, dict):
                        if chunk.get("type") == "thinking":
                            streamed_thinking = True
                        await safe_send(chunk)
                    else:
                        full_response += chunk
                        await safe_send({"type": "content", "content": chunk})

            # Strip thinking blocks only if not already streamed in real-time
            if full_response and not streamed_thinking:
                clean, thinking = _strip_thinking(full_response)
                if thinking:
                    await safe_send({"type": "thinking", "content": thinking})
                if clean != full_response:
                    await safe_send({"type": "content_replace", "content": clean})

            await safe_send({"type": "done", "chat_id": chat_id})

            # Post-stream background tasks (fire-and-forget, non-blocking)
            async def _bg_summary():
                try:
                    async for db_session in get_db():
                        await topology_service.update_node_summary_from_chat(db_session, chat_id)
                        break
                except Exception as e:
                    logger.warning("Auto summary update failed: %s", e)

            async def _bg_consolidation():
                try:
                    from app.services.consolidation import consolidation_service
                    async for db_session in get_db():
                        await consolidation_service.consolidate(db_session, chat_id, workspace_id)
                        break
                except Exception as e:
                    logger.warning("Consolidation failed: %s", e)

            if chat_id:
                asyncio.create_task(_bg_summary())
            if chat_id and workspace_id:
                asyncio.create_task(_bg_consolidation())
        except Exception as e:
            logger.error(f"Chat stream error: {e}", exc_info=True)
            err_payload: dict = {"type": "error", "content": str(e)}
            if chat_id:
                err_payload["chat_id"] = chat_id
            await safe_send(err_payload)

    # ── Synthesis mode: forest-level convergence (VISION 理念6) ────────────

    async def handle_synthesis(goal: str, workspace_id: str | None) -> None:
        """Two-pass forest convergence (VISION 理念6).

        Pass 1: the agent walks the forest with the exploration tools; its draft
        is buffered (only tool events stream to the UI).
        Pass 2: produce_synthesis refines the draft with the stronger synthesis
        LLM and streams the final report.

        Events: `synthesis_start` → tool events → `synthesis_progress {refining}`
        → `content` (report) → `synthesis_complete {report}`.
        """
        from app.tools.registry import get_all_tool_specs

        if not workspace_id:
            await safe_send({"type": "error", "content": "synthesis 需要 workspace_id"})
            return

        tools = [
            s for s in get_all_tool_specs()
            if s.get("name") in _SYNTHESIS_TOOLS
        ]

        system_content = (
            "你是 MindCard 的知识森林收敛分析员。用户会给出一个收敛目标。\n"
            "你的任务是走查工作区的知识拓扑森林（对话分叉 + 沉淀卡片 + 关系），"
            "然后产出一份**草稿**（会被更强的模型精修为最终报告）。\n\n"
            "分析步骤：\n"
            "1. 先用 topology_forest_map 看整片森林的结构与各分支摘要。\n"
            "2. 根据收敛目标，用 get_node_detail 或 get_node_subtree 深入相关分支，"
            "用 get_card_relations 查看关键卡片的连接。\n"
            "3. 观察：哪些分支被充分探索、哪些是孤立的；卡片之间的关系揭示了怎样的思考结构；"
            "是否有本该连接却未连接的知识。\n"
            "4. 最后产出一份结构化的**草稿**（Markdown），包含：主题概览、关键洞察、"
            "知识之间的关系、以及可进一步探索的方向。草稿只需条理清晰，表达精修交给后续模型。\n\n"
            "如果森林为空或目标无法从森林中获取信息，如实说明，不要编造。"
        )
        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": f"收敛目标：{goal}"},
        ]

        await safe_send({"type": "synthesis_start", "goal": goal})

        # Pass 1: agent walk — buffer the draft, stream only tool events.
        draft = ""
        try:
            async for db_session in get_db():
                try:
                    async for chunk in _run_tool_loop(
                        messages, tools, db_session, workspace_id,
                        chat_id=None, current_fork_id=None,
                        max_rounds=10,
                    ):
                        if isinstance(chunk, dict):
                            await safe_send(chunk)
                        else:
                            draft += chunk
                finally:
                    break
        except Exception as e:
            logger.error(f"Synthesis walk error: {e}", exc_info=True)
            await safe_send({"type": "synthesis_error", "message": str(e)})
            return

        if not draft.strip():
            await safe_send({
                "type": "synthesis_error",
                "message": "agent 未产出草稿，无法收敛",
            })
            return

        # Pass 2: refine the draft with the stronger synthesis LLM.
        await safe_send({"type": "synthesis_progress", "stage": "refining"})
        try:
            from app.services.synthesis import produce_synthesis

            report = await produce_synthesis(goal, draft)
        except Exception as e:
            logger.error(f"Synthesis refine error: {e}", exc_info=True)
            report = draft  # fall back to the raw draft

        if report:
            await safe_send({"type": "content", "content": report})
        await safe_send({"type": "synthesis_complete", "report": report})

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
        context_card_ids: list[str] | None = None,
    ):
        """Handle RAG query. Creates its own DB session to avoid lifecycle issues."""
        from app.tools.registry import get_all_tool_specs

        ws_id = workspace_ids[0] if workspace_ids else None

        try:
            async for db in get_db():
                # Collect full response for branch marker parsing
                full_response = ""
                streamed_thinking = False

                # Decide whether to use tool loop for RAG
                tools = get_all_tool_specs() if ws_id else None

                if tools:
                    # Use ask_stream to build context (system prompt + retrieval),
                    # then wrap with tool execution loop
                    generator = rag_service.ask_stream(
                        db,
                        question,
                        workspace_ids=workspace_ids,
                        card_id=card_id,
                        top_k=top_k,
                        web_search=web_search,
                        history=history,
                        retrieval_level=retrieval_level,
                        chat_id=chat_id,
                        current_fork_id=current_fork_id,
                        tools=tools,
                        context_card_ids=context_card_ids,
                    )

                    # ask_stream with tools yields a "messages_ready" dict instead of
                    # streaming directly — we feed those messages into the tool loop
                    messages_for_llm = None
                    insight_ids: list = []
                    async for chunk in generator:
                        if isinstance(chunk, dict) and chunk.get("type") == "messages_ready":
                            messages_for_llm = chunk["messages"]
                            insight_ids = chunk.get("insight_ids", [])
                        elif isinstance(chunk, dict):
                            if chunk.get("type") == "thinking":
                                streamed_thinking = True
                            await safe_send(chunk)
                        else:
                            full_response += chunk
                            await safe_send({"type": "content", "content": chunk})

                    # Run tool loop on the prepared messages
                    if messages_for_llm:
                        async for chunk in _run_tool_loop(
                            messages_for_llm, tools, db, ws_id,
                            chat_id=chat_id, current_fork_id=current_fork_id,
                        ):
                            if isinstance(chunk, dict):
                                if chunk.get("type") == "thinking":
                                    streamed_thinking = True
                                await safe_send(chunk)
                            else:
                                full_response += chunk
                                await safe_send({"type": "content", "content": chunk})

                    # Consume insights after tool loop completes successfully
                    if insight_ids:
                        from app.services.rag import mark_insights_consumed
                        await mark_insights_consumed(db, insight_ids)
                else:
                    # No tools — standard RAG streaming
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
                        current_fork_id=current_fork_id,
                        context_card_ids=context_card_ids,
                    ):
                        if isinstance(chunk, dict):
                            if chunk.get("type") == "thinking":
                                streamed_thinking = True
                            await safe_send(chunk)
                        else:
                            full_response += chunk
                            await safe_send({"type": "content", "content": chunk})

                # Strip thinking blocks only if not already streamed in real-time
                if full_response and not streamed_thinking:
                    clean, thinking = _strip_thinking(full_response)
                    if thinking:
                        await safe_send({"type": "thinking", "content": thinking})
                    if clean != full_response:
                        await safe_send({"type": "content_replace", "content": clean})

                # Send done BEFORE background tasks to avoid frontend timeout
                await safe_send({"type": "done", "chat_id": chat_id})
                logger.info("handle_rag: done event sent")
                break

            # Post-processing with separate DB sessions (fire-and-forget)
            async def _bg_summary():
                try:
                    async for db2 in get_db():
                        await topology_service.update_node_summary_from_chat(db2, chat_id)
                        await db2.commit()
                        break
                except Exception as e:
                    logger.warning("Auto summary update failed: %s", e)

            async def _bg_consolidation():
                try:
                    from app.services.consolidation import consolidation_service
                    async for db2 in get_db():
                        await consolidation_service.consolidate(db2, chat_id, ws_id)
                        break
                except Exception as e:
                    logger.warning("Consolidation failed: %s", e)

            if chat_id:
                asyncio.create_task(_bg_summary())
            if chat_id and ws_id:
                asyncio.create_task(_bg_consolidation())
        except Exception as e:
            logger.error(f"RAG stream error: {e}", exc_info=True)
            err_payload: dict = {"type": "error", "content": str(e)}
            if chat_id:
                err_payload["chat_id"] = chat_id
            await safe_send(err_payload)

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

                # Rate limit per user (LLM cost protection)
                if not await ws_limiter.is_allowed(user_id):
                    await safe_send({"type": "error", "content": "消息过于频繁，请稍后再试"})
                    continue

                # Daily LLM quota check
                if await _quota_exceeded(user_id):
                    await safe_send({"type": "error", "content": "今日 LLM 配额已用尽，请明天再试"})
                    continue

                message = msg.get("message", "")
                history = msg.get("history")
                web_search = msg.get("web_search", False)
                chat_id = msg.get("chat_id")
                workspace_id = msg.get("workspace_id")
                current_fork_id = msg.get("current_fork_id")

                # Verify chat ownership
                if chat_id and not await _verify_chat_ownership(chat_id):
                    await safe_send({"type": "error", "content": "无权访问该对话"})
                    continue

                # Verify workspace membership
                if not await _verify_workspace_access(workspace_id):
                    await safe_send({"type": "error", "content": "无权访问该空间"})
                    continue

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

                # Rate limit per user (LLM cost protection)
                if not await ws_limiter.is_allowed(user_id):
                    await safe_send({"type": "error", "content": "消息过于频繁，请稍后再试"})
                    continue

                # Daily LLM quota check
                if await _quota_exceeded(user_id):
                    await safe_send({"type": "error", "content": "今日 LLM 配额已用尽，请明天再试"})
                    continue

                question = msg.get("question", "")
                workspace_ids = msg.get("workspace_ids")
                card_id = msg.get("card_id")
                top_k = msg.get("top_k", 5)
                web_search = msg.get("web_search", False)
                history = msg.get("history")
                retrieval_level = msg.get("retrieval_level")
                chat_id = msg.get("chat_id")
                current_fork_id = msg.get("current_fork_id")
                context_card_ids = msg.get("context_card_ids")

                # Verify chat ownership
                if chat_id and not await _verify_chat_ownership(chat_id):
                    await safe_send({"type": "error", "content": "无权访问该对话"})
                    continue

                # Verify workspace membership for all requested workspaces
                if workspace_ids:
                    allowed = True
                    for wid in workspace_ids:
                        if not await _verify_workspace_access(wid):
                            allowed = False
                            break
                    if not allowed:
                        await safe_send({"type": "error", "content": "无权访问该空间"})
                        continue

                current_task = asyncio.create_task(
                    handle_rag(
                        question, workspace_ids, card_id, top_k,
                        web_search, history, retrieval_level, chat_id,
                        current_fork_id=current_fork_id,
                        context_card_ids=context_card_ids,
                    )
                )

            elif msg_type == "synthesis":
                # Forest-level convergence (VISION 理念6)
                if current_task and not current_task.done():
                    current_task.cancel()

                if not await ws_limiter.is_allowed(user_id):
                    await safe_send({"type": "error", "content": "消息过于频繁，请稍后再试"})
                    continue

                if await _quota_exceeded(user_id):
                    await safe_send({"type": "error", "content": "今日 LLM 配额已用尽，请明天再试"})
                    continue

                goal = msg.get("goal", "").strip()
                workspace_id = msg.get("workspace_id")
                if not goal:
                    await safe_send({"type": "error", "content": "synthesis 需要 goal"})
                    continue
                if not await _verify_workspace_access(workspace_id):
                    await safe_send({"type": "error", "content": "无权访问该空间"})
                    continue

                current_task = asyncio.create_task(
                    handle_synthesis(goal, workspace_id)
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

"""create_fork tool — lets the LLM create a conversation branch."""

import json
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import AiChat, ChatMessage
from app.tools.base import Tool, ToolSpec
from app.tools.fork_profiles import FORK_PROFILES, get_profile

logger = logging.getLogger(__name__)

# Build profile names for the description
_profile_names = ", ".join(f"{k}({v.label})" for k, v in FORK_PROFILES.items())

_SPEC = ToolSpec(
    name="create_fork",
    description=(
        "Create a new conversation branch when the user's question is clearly about "
        "a different topic from the current conversation. Call this BEFORE answering "
        "the question, so the answer streams into the new branch. "
        "Do NOT fork for follow-up questions, elaborations, clarifications, or natural "
        "conversation flow within the same topic. Do NOT fork repeatedly in consecutive messages.\n\n"
        f"Available profiles: {_profile_names}. "
        "Choose the profile that best matches the user's intent."
    ),
    parameters={
        "type": "object",
        "properties": {
            "branch_label": {
                "type": "string",
                "description": "Short label for the new branch topic (e.g. '机器学习入门', 'Agent概念').",
            },
            "reason": {
                "type": "string",
                "description": "One sentence explaining why this topic warrants a new branch.",
            },
            "profile": {
                "type": "string",
                "description": (
                    "Fork profile name. Options: "
                    "deep_dive(深入探讨), explore(发散探索), "
                    "summarize(总结提炼), challenge(质疑挑战). "
                    "Defaults to deep_dive if not specified."
                ),
                "enum": list(FORK_PROFILES.keys()),
            },
        },
        "required": ["branch_label", "reason"],
    },
)


class CreateForkTool(Tool):
    def spec(self) -> ToolSpec:
        return _SPEC

    async def execute(self, arguments: dict, context: dict) -> str:
        db: AsyncSession = context["db"]
        workspace_id = context.get("workspace_id")
        chat_id = context.get("chat_id")
        current_fork_id = context.get("current_fork_id")

        branch_label = arguments.get("branch_label", "新分支").strip()
        profile_name = arguments.get("profile", "deep_dive")
        profile = get_profile(profile_name)
        if not profile:
            profile = get_profile("deep_dive")

        # SplitGuard check
        from app.services.split_guard import split_guard
        if not await split_guard.can_fork(db, chat_id, current_fork_id, branch_label):
            return json.dumps({"status": "blocked", "reason": "split_guard protection active"})

        # Resolve parent chat — prefer active fork over root chat
        parent_chat = None
        if current_fork_id:
            try:
                parent_chat = await db.get(AiChat, uuid.UUID(current_fork_id))
            except (ValueError, TypeError):
                pass
        if not parent_chat and chat_id:
            try:
                parent_chat = await db.get(AiChat, uuid.UUID(chat_id))
            except (ValueError, TypeError):
                pass
        if not parent_chat:
            return json.dumps({"status": "error", "reason": "parent chat not found"})

        # Compress parent context for continuity (using profile's strategy)
        result = await db.execute(
            select(ChatMessage)
            .where(
                ChatMessage.chat_id == parent_chat.id,
                ChatMessage.role.in_(["user", "assistant"]),
            )
            .order_by(ChatMessage.created_at.desc())
            .limit(50)
        )
        msgs = [{"role": m.role, "content": m.content} for m in reversed(result.scalars().all())]
        from app.services.fork_compress import fork_compressor
        summary = await fork_compressor.compress(msgs, strategy=profile.context_strategy)

        # Walk parent chain to compute depth
        depth = 0
        cursor = parent_chat.parent_id
        max_walk = 20
        while cursor and max_walk > 0:
            max_walk -= 1
            depth += 1
            row = await db.execute(select(AiChat.parent_id).where(AiChat.id == cursor))
            cursor = row.scalar_one_or_none()

        # Create child AiChat
        child_chat = AiChat(
            local_id=f"fork-{uuid.uuid4().hex[:12]}",
            workspace_id=parent_chat.workspace_id,
            parent_id=parent_chat.id,
            user_id=parent_chat.user_id,
            mode="rag",
            title=branch_label,
            node_type="branch",
        )
        db.add(child_chat)
        await db.flush()

        # Insert fork-divider into parent chat
        divider = ChatMessage(
            chat_id=parent_chat.id,
            role="fork-divider",
            content="",
            metadata_={
                "child_chat_id": str(child_chat.id),
                "branch_label": branch_label,
                "parent_context_summary": summary,
                "depth": depth,
                "fork_profile": profile_name,
            },
        )
        db.add(divider)
        await db.commit()

        # Record split for cooldown tracking
        split_guard.record_split(str(parent_chat.id), len(msgs))

        logger.info("Fork created: %s → %s (label=%s, profile=%s)", parent_chat.id, child_chat.id, branch_label, profile_name)

        return json.dumps({
            "status": "created",
            "chat_id": str(child_chat.id),
            "branch_label": branch_label,
            "depth": depth,
            "divider_msg_id": str(divider.id),
            "profile": profile_name,
            "system_prompt_suffix": profile.system_prompt_suffix,
        })

"""Fork compressor — compress parent conversation context for fork branches."""

import logging
from typing import Any

from app.services.llm import llm_service

logger = logging.getLogger(__name__)


class ForkCompressor:
    """Compress parent conversation context for fork branches."""

    def _format_conversation(self, messages: list[dict[str, Any]]) -> str:
        """Format messages into a readable conversation string."""
        lines = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            label = "用户" if role == "user" else "助手"
            lines.append(f"{label}: {content}")
        return "\n".join(lines)

    async def compress(
        self,
        messages: list[dict[str, Any]],
        strategy: str = "compress",
    ) -> str | None:
        """Compress parent conversation context.

        - none: No parent context
        - inherit: Raw conversation text
        - compress: LLM-generated structured summary
        """
        if strategy == "none":
            return None
        if strategy == "inherit":
            return self._format_conversation(messages)
        # strategy == "compress"
        conversation = self._format_conversation(messages)
        if not conversation.strip():
            return None

        prompt = f"""请将以下对话压缩为结构化摘要，保留关键信息：
1. 主题和核心问题
2. 关键发现和结论
3. 未解决的问题
4. 重要的上下文信息

对话内容：
{conversation}

请用简洁的中文输出摘要。"""
        summary = await llm_service.complete_simple(
            system_prompt="你是一个对话摘要助手。",
            user_content=prompt,
            max_tokens=500,
            temperature=0.3,
        )
        return summary


fork_compressor = ForkCompressor()

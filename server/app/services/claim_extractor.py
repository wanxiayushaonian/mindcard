"""Fork claims extractor — distills parent conversation into reusable knowledge claims.

When a conversation is forked, this runs in background to extract 3-7
standalone knowledge assertions that can be referenced by the child branch
via the existing WorkspaceMemory injection path.

Stored as WorkspaceMemory rows with memory_type='claim', source_chat_id=parent.
Silent degradation on LLM/parse failure — Fork main flow is never blocked.
"""

import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.embedding import current_model_tag, embedding_service
from app.services.llm import get_llm_service

logger = logging.getLogger(__name__)

CLAIM_SYSTEM_PROMPT = """你是一个知识断言抽取器。
从给定对话中抽取 3-7 条可独立成立的知识断言。要求：
1. 每条断言 ≤ 50 字
2. 自包含（脱离对话上下文也能理解）
3. 来自对话中的事实/结论/共识，过滤问题与闲聊
4. 每条标注 confidence (0.0-1.0)，反映该断言在对话中的支撑度
5. topic_hint: 3-5 字主题标签

输出 JSON 数组：
[{"claim": "断言内容", "confidence": 0.85, "topic_hint": "主题"}]

只输出 JSON 数组，不要其他文字。"""

MAX_CLAIMS = 7
MAX_CLAIM_LENGTH = 200
MAX_INPUT_CHARS = 8000
MIN_MESSAGES_FOR_EXTRACTION = 4


@dataclass(frozen=True)
class Claim:
    claim: str
    confidence: float
    topic_hint: str | None = None


class ClaimExtractor:
    """Extract standalone claims from a conversation for cross-branch reuse."""

    async def extract(self, messages: list[dict[str, Any]]) -> list[Claim]:
        """Extract 3-7 claims from a conversation.

        Returns empty list on failure or insufficient input (silent degradation).
        """
        if len(messages) < MIN_MESSAGES_FOR_EXTRACTION:
            logger.info(
                "Skipping claim extraction: too few messages (%d < %d)",
                len(messages), MIN_MESSAGES_FOR_EXTRACTION,
            )
            return []

        conversation = self._format_conversation(messages)
        if not conversation.strip():
            return []

        try:
            response = await get_llm_service().extraction_complete_simple(
                system_prompt=CLAIM_SYSTEM_PROMPT,
                user_content=conversation[:MAX_INPUT_CHARS],
                max_tokens=800,
                temperature=0.2,
            )
        except Exception as e:
            logger.warning("Claim extraction LLM call failed: %s", e)
            return []

        claims = self._parse_claims(response)
        logger.info(
            "Claim extraction: %d claims parsed from %d messages",
            len(claims), len(messages),
        )
        return claims

    async def store_claims(
        self,
        claims: list[Claim],
        parent_chat_id: str,
        workspace_id: str,
        child_chat_id: str,
        db: AsyncSession,
    ) -> int:
        """Persist claims as WorkspaceMemory rows. Returns count stored.

        Slug includes child_chat_id (not parent) to avoid UniqueConstraint
        collisions when the same parent is forked multiple times.
        """
        if not claims:
            return 0

        from app.models.workspace_memory import WorkspaceMemory

        claim_texts = [c.claim for c in claims]
        try:
            embeddings = await embedding_service.embed_batch(claim_texts)
        except Exception as e:
            logger.warning("Claim embedding failed: %s — storing without embeddings", e)
            embeddings = [None] * len(claims)

        for i, claim in enumerate(claims):
            importance = 0.6 + claim.confidence * 0.3  # 0.6-0.9 range
            title = (claim.topic_hint or claim.claim[:30])[:200]
            embedding = embeddings[i] if i < len(embeddings) else None

            memory = WorkspaceMemory(
                workspace_id=uuid.UUID(workspace_id),
                slug=f"claim-{child_chat_id}-{i}",
                title=title,
                body=claim.claim,
                source_chat_id=uuid.UUID(parent_chat_id),
                memory_type="claim",
                confidence=claim.confidence,
                importance=importance,
                source_card_ids=[],
                embedding=embedding,
                embedding_model=current_model_tag(),
            )
            db.add(memory)

        await db.commit()
        logger.info(
            "Stored %d claims for child_chat=%s parent_chat=%s",
            len(claims), child_chat_id, parent_chat_id,
        )
        return len(claims)

    @staticmethod
    def _format_conversation(messages: list[dict[str, Any]]) -> str:
        lines: list[str] = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content") or ""
            label = "用户" if role == "user" else "助手"
            lines.append(f"{label}: {content}")
        return "\n".join(lines)

    @staticmethod
    def _parse_claims(response: str) -> list[Claim]:
        """Parse LLM response into Claim list. Silent on failure."""
        if not response or not response.strip():
            return []

        text = response.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = "\n".join(text.split("\n")[1:])
            if text.endswith("```"):
                text = text[:-3]
        text = text.strip()

        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            logger.warning(
                "Claim JSON parse failed: %s, response_head=%s",
                e, response[:200],
            )
            return []

        if not isinstance(data, list):
            return []

        claims: list[Claim] = []
        seen_claims: set[str] = set()
        for item in data:
            if not isinstance(item, dict):
                continue
            claim_text = str(item.get("claim", "")).strip()
            if not claim_text or len(claim_text) > MAX_CLAIM_LENGTH:
                continue
            if claim_text in seen_claims:
                continue
            seen_claims.add(claim_text)

            try:
                confidence = float(item.get("confidence", 0.7))
            except (TypeError, ValueError):
                confidence = 0.7
            confidence = max(0.0, min(1.0, confidence))

            topic_hint = item.get("topic_hint")
            if topic_hint:
                topic_hint = str(topic_hint)[:30]

            claims.append(Claim(
                claim=claim_text,
                confidence=confidence,
                topic_hint=topic_hint,
            ))

        return claims[:MAX_CLAIMS]


claim_extractor = ClaimExtractor()

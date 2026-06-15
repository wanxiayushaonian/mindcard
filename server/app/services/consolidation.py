"""Consolidation service — extracts insights, memory, and summaries after conversations."""

import json
import logging
import uuid

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Run consolidation every N user messages in a chat.
TURN_INTERVAL = 5


class ConsolidationService:
    """Fire-and-forget service that runs after a chat turn completes.

    Single combined LLM call extracts:
    1. Session summary → updates AiChat.summary
    2. Cross-branch insights → creates BranchInsight records for sibling branches
    3. Workspace knowledge → creates/updates WorkspaceMemory entries
    """

    async def should_consolidate(
        self, db: AsyncSession, chat_id: uuid.UUID
    ) -> bool:
        """Check if enough new messages accumulated since last consolidation."""
        from app.models.chat import AiChat, ChatMessage

        chat = await db.get(AiChat, chat_id)
        if not chat:
            return False

        msg_count = await db.execute(
            select(func.count()).where(
                ChatMessage.chat_id == chat_id,
                ChatMessage.role == "user",
            )
        )
        user_msgs = msg_count.scalar() or 0
        return user_msgs > 0 and user_msgs % TURN_INTERVAL == 0

    async def consolidate(
        self, db: AsyncSession, chat_id: str, workspace_id: str | None
    ) -> None:
        """Entry point — runs all consolidation steps. Fire-and-forget."""
        try:
            chat_uuid = uuid.UUID(chat_id)
            if not await self.should_consolidate(db, chat_uuid):
                return

            context = await self._build_context(db, chat_uuid)
            if not context:
                return

            result = await self._run_llm_extraction(context)
            if not result:
                return

            await self._apply_extractions(db, chat_uuid, workspace_id, result)
            await self._feed_to_graph(db, chat_uuid, workspace_id, result)
            await db.commit()
            logger.info("Consolidation completed for chat %s", chat_id)
        except Exception as e:
            logger.warning("Consolidation failed for chat %s: %s", chat_id, e)

    async def _build_context(
        self, db: AsyncSession, chat_id: uuid.UUID
    ) -> str | None:
        """Collect recent messages for the consolidation prompt."""
        from app.models.chat import AiChat, ChatMessage

        chat = await db.get(AiChat, chat_id)
        if not chat:
            return None

        result = await db.execute(
            select(ChatMessage)
            .where(
                ChatMessage.chat_id == chat_id,
                ChatMessage.role.in_(["user", "assistant"]),
            )
            .order_by(ChatMessage.created_at.desc())
            .limit(10)
        )
        messages = list(reversed(result.scalars().all()))
        if not messages:
            return None

        lines = []
        for m in messages:
            role = "用户" if m.role == "user" else "AI"
            lines.append(f"{role}: {m.content[:300]}")

        return "\n".join(lines)

    async def _run_llm_extraction(self, context: str) -> dict | None:
        """Single LLM call to extract summary, insights, and knowledge."""
        from app.services.llm import get_llm_service

        prompt = f"""分析以下对话，提取三类信息。严格按JSON格式输出。

对话内容：
{context}

输出格式（必须严格遵循）：
```json
{{
  "summary": "50-100字的对话核心主题总结",
  "insights": ["跨分支有价值的发现1", "跨分支有价值的发现2"],
  "knowledge": [{{"slug": "english-id", "title": "中文标题", "body": "Markdown内容"}}]
}}
```

规则：
- summary: 必须有，简洁概括主题和关键结论
- insights: 只提取真正有价值且可能对其他分支有用的发现，最多3条。如果没有就返回空数组。
- knowledge: 只提取值得长期记住的事实、决策或规则，最多2条。如果没有就返回空数组。
- 不要编造对话中没有的信息

只输出JSON，不要其他内容。"""

        try:
            raw = await get_llm_service().extraction_complete_simple(
                system_prompt="你是一个对话分析助手。只输出JSON。",
                user_content=prompt,
                max_tokens=512,
                temperature=0.3,
            )
        except Exception as e:
            logger.warning("Consolidation LLM call failed: %s", e)
            return None

        return self._parse_response(raw)

    def _parse_response(self, raw: str) -> dict | None:
        """Parse JSON from LLM response."""
        text = raw.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]

        try:
            data = json.loads(text.strip())
        except (json.JSONDecodeError, IndexError):
            logger.warning("Consolidation: failed to parse LLM JSON: %s", raw[:200])
            return None

        # Validate minimum structure
        if not isinstance(data, dict) or "summary" not in data:
            return None

        data.setdefault("insights", [])
        data.setdefault("knowledge", [])
        return data

    async def _apply_extractions(
        self,
        db: AsyncSession,
        chat_id: uuid.UUID,
        workspace_id: str | None,
        result: dict,
    ) -> None:
        """Apply all three extraction outputs to the database."""
        from app.models.chat import AiChat
        from app.models.branch_insight import BranchInsight
        from app.models.workspace_memory import WorkspaceMemory

        chat = await db.get(AiChat, chat_id)
        if not chat:
            return

        # 1. Update session summary
        summary = result.get("summary", "").strip()
        if summary:
            chat.summary = summary

        # 2. Create cross-branch insights targeting sibling branches
        insights = result.get("insights", [])
        if insights and chat.parent_id:
            # Find sibling branches (same parent, different chat)
            siblings = await db.execute(
                select(AiChat.id).where(
                    AiChat.parent_id == chat.parent_id,
                    AiChat.id != chat_id,
                )
            )
            sibling_ids = [row[0] for row in siblings.all()]
            for sibling_id in sibling_ids:
                for content in insights[:3]:
                    # Dedup: skip if identical insight already exists
                    existing = await db.execute(
                        select(BranchInsight.id).where(
                            BranchInsight.source_chat_id == chat_id,
                            BranchInsight.target_chat_id == sibling_id,
                            BranchInsight.content == content,
                        ).limit(1)
                    )
                    if existing.scalar_one_or_none() is not None:
                        continue
                    db.add(BranchInsight(
                        source_chat_id=chat_id,
                        target_chat_id=sibling_id,
                        content=content,
                    ))

        # 3. Write workspace knowledge
        knowledge_items = result.get("knowledge", [])
        if knowledge_items and workspace_id:
            ws_uuid = uuid.UUID(workspace_id)
            for item in knowledge_items[:2]:
                slug = item.get("slug", "").strip()
                title = item.get("title", "").strip()
                body = item.get("body", "").strip()
                if not slug or not title or not body:
                    continue

                # Upsert by (workspace_id, slug)
                existing = await db.execute(
                    select(WorkspaceMemory).where(
                        WorkspaceMemory.workspace_id == ws_uuid,
                        WorkspaceMemory.slug == slug,
                    )
                )
                mem = existing.scalar_one_or_none()
                if mem:
                    mem.title = title
                    mem.body = body
                else:
                    db.add(WorkspaceMemory(
                        workspace_id=ws_uuid,
                        slug=slug,
                        title=title,
                        body=body,
                        source_chat_id=chat_id,
                    ))

        await db.flush()

    async def _feed_to_graph(
        self,
        db: AsyncSession,
        chat_id: uuid.UUID,
        workspace_id: str | None,
        result: dict,
    ) -> None:
        """Feed consolidation insights into the knowledge graph via triple extraction."""
        if not workspace_id:
            return

        # Combine insights and knowledge into a single text block for extraction
        texts = []
        for insight in result.get("insights", []):
            if insight and len(insight) > 10:
                texts.append(insight)
        for item in result.get("knowledge", []):
            body = item.get("body", "")
            if body and len(body) > 10:
                texts.append(body)

        if not texts:
            return

        combined = "\n".join(texts)
        ws_uuid = uuid.UUID(workspace_id)

        try:
            from app.services.triple_extractor import triple_extractor
            from app.services.entity_linker import EntityLinker

            entities, triples = await triple_extractor.extract(combined, ws_uuid)
            if not entities:
                return

            linker = EntityLinker(db)
            # Link entities to a card if the chat has one; otherwise skip card linking
            # (chat_id is NOT a valid card_id — entity_cards has FK to cards.id)
            from app.models.chat import AiChat
            chat = await db.get(AiChat, chat_id)
            card_id = chat.card_id if chat and chat.card_id else None

            await linker.link_triples(entities, triples, card_id, ws_uuid)
            logger.info("Consolidation graph feed: %d entities, %d triples linked (card_id=%s)", len(entities), len(triples), card_id)
        except Exception as e:
            logger.warning("Consolidation graph feed failed: %s", e)


consolidation_service = ConsolidationService()

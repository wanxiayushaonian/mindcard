import json
import logging
import uuid
from collections.abc import AsyncGenerator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.schemas.rag import CardSummary
from app.services.embedding import embedding_service
from app.services.llm import llm_service
from app.services.search import search_service

logger = logging.getLogger(__name__)

MARKDOWN_SYSTEM_PROMPT = (
    "你是一个知识问答助手。回答必须使用 Markdown 格式，严格遵守以下规则：\n"
    "1. 每个主题用 ## 标题开头，标题前后必须有空行\n"
    "2. 列表项每项占一行，以 - 或 1. 开头\n"
    "3. 对比信息用表格，每列用 | 分隔\n"
    "4. 不同段落之间必须用空行分隔\n"
    "5. 绝对不要把所有内容写在一行里\n\n"
    "示例格式：\n"
    "## 主题一\n\n"
    "这里是内容说明。\n\n"
    "- 要点1\n"
    "- 要点2\n\n"
    "## 主题二\n\n"
    "| 列A | 列B |\n"
    "|-----|-----|\n"
    "| 值1 | 值2 |"
)


class RAGService:
    """RAG pipeline: retrieve relevant cards → build context → LLM answer."""

    async def ask(
        self,
        db: AsyncSession,
        question: str,
        workspace_id: str,
        card_id: str | None = None,
        top_k: int = 5,
    ) -> dict:
        """Answer a question using RAG over workspace cards."""
        # 1. Retrieve relevant cards
        if card_id:
            context_cards = await self._find_similar_cards(db, card_id, limit=top_k)
        else:
            scored = await search_service.hybrid_search(db, question, workspace_id, limit=top_k)
            context_cards = [sc.card for sc in scored]

        if not context_cards:
            return {
                "answer": "No relevant cards found for your question.",
                "source_cards": [],
                "confidence": 0.0,
            }

        # 2. Build context
        context = "\n\n".join(
            f"【{c.title or 'Untitled'}】{c.content}" for c in context_cards
        )
        prompt = f"""基于以下灵感卡片回答用户问题。如果卡片内容不足以回答，请说明。

回答格式要求（必须严格遵守）：
- 用 ## 标题分隔不同主题，标题前后加空行
- 用 - 列表罗列要点，每项一行
- 用 Markdown 表格对比信息
- 段落之间用空行分隔
- 不要把所有内容写成一段

相关灵感卡片：
{context}

用户问题：{question}"""

        # 3. Call LLM
        answer = await llm_service.complete([{"role": "user", "content": prompt}])

        # 4. Return with sources
        source_cards = [
            CardSummary(
                id=str(c.id),
                title=c.title,
                content=c.content[:200],
                keywords=c.keywords,
            )
            for c in context_cards
        ]
        return {
            "answer": answer,
            "source_cards": source_cards,
            "confidence": 0.8 if context_cards else 0.0,
        }

    async def find_similar(
        self, db: AsyncSession, card_id: str, limit: int = 5, exclude_ids: list[str] | None = None
    ) -> list[Card]:
        """Find similar cards using vector cosine distance (replaces agent.js)."""
        return await self._find_similar_cards(db, card_id, limit, exclude_ids=exclude_ids)

    async def generate_insights(self, db: AsyncSession, workspace_id: str) -> dict:
        """Analyze workspace inspiration patterns."""
        ws_uuid = uuid.UUID(workspace_id)
        result = await db.execute(
            select(Card).where(Card.workspace_id == ws_uuid).limit(100)
        )
        cards = result.scalars().all()

        if not cards:
            return {"themes": [], "trends": "", "unexplored": [], "suggestions": []}

        cards_text = "\n".join(
            f"- [{c.title or 'No title'}] {c.content[:100]}" for c in cards
        )
        prompt = f"""Analyze the following {len(cards)} inspiration cards and provide:
1. Main thinking themes (3-5)
2. Thinking evolution trends
3. Potentially unexplored directions
4. Suggestions for further development

Inspiration cards:
{cards_text}

Respond in JSON format:
{{"themes": [...], "trends": "...", "unexplored": [...], "suggestions": [...]}}"""

        answer = await llm_service.complete([{"role": "user", "content": prompt}])

        # Parse JSON from answer
        try:
            # Extract JSON from response (may be wrapped in markdown code block)
            json_str = answer
            if "```json" in answer:
                json_str = answer.split("```json")[1].split("```")[0]
            elif "```" in answer:
                json_str = answer.split("```")[1].split("```")[0]
            data = json.loads(json_str.strip())
            # Normalize types: LLM may return trends as a list instead of string
            if isinstance(data.get("trends"), list):
                data["trends"] = "\n".join(data["trends"])
            return data
        except (json.JSONDecodeError, IndexError):
            return {
                "themes": [],
                "trends": answer,
                "unexplored": [],
                "suggestions": [],
            }

    async def _find_similar_cards(
        self, db: AsyncSession, card_id: str, limit: int = 5, exclude_ids: list[str] | None = None
    ) -> list[Card]:
        card = await db.get(Card, uuid.UUID(card_id))
        if not card:
            return []

        exclude = {uuid.UUID(card_id)}
        if exclude_ids:
            exclude.update(uuid.UUID(rid) for rid in exclude_ids)

        if card.embedding is None:
            # Fallback: return recent cards from the same workspace
            result = await db.execute(
                select(Card)
                .where(Card.workspace_id == card.workspace_id)
                .where(Card.id.notin_(exclude))
                .order_by(Card.created_at.desc())
                .limit(limit)
            )
            return result.scalars().all()

        result = await db.execute(
            select(Card)
            .where(Card.workspace_id == card.workspace_id)
            .where(Card.id.notin_(exclude))
            .order_by(Card.embedding.cosine_distance(card.embedding))
            .limit(limit)
        )
        return result.scalars().all()

    async def chat(
        self, message: str, history: list[dict[str, str]] | None = None
    ) -> str:
        """General chat without RAG, supports conversation history."""
        messages = [{"role": "system", "content": MARKDOWN_SYSTEM_PROMPT}]
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": message})
        return await llm_service.complete(messages)

    async def chat_stream(
        self, message: str, history: list[dict[str, str]] | None = None
    ) -> AsyncGenerator[str, None]:
        """Streaming general chat without RAG."""
        messages = [{"role": "system", "content": MARKDOWN_SYSTEM_PROMPT}]
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": message})
        async for chunk in llm_service.stream(messages):
            yield chunk

    async def ask_stream(
        self,
        db: AsyncSession,
        question: str,
        workspace_id: str,
        card_id: str | None = None,
        top_k: int = 5,
    ) -> AsyncGenerator[str | dict, None]:
        """Streaming RAG answer: retrieve cards, stream LLM, yield sources dict at end."""
        # 1. Retrieve relevant cards
        if card_id:
            context_cards = await self._find_similar_cards(db, card_id, limit=top_k)
        else:
            scored = await search_service.hybrid_search(db, question, workspace_id, limit=top_k)
            context_cards = [sc.card for sc in scored]

        if not context_cards:
            yield "没有找到相关的灵感卡片。"
            return

        # 2. Build context
        context = "\n\n".join(
            f"【{c.title or 'Untitled'}】{c.content}" for c in context_cards
        )
        prompt = f"""基于以下灵感卡片回答用户问题。如果卡片内容不足以回答，请说明。

回答格式要求（必须严格遵守）：
- 用 ## 标题分隔不同主题，标题前后加空行
- 用 - 列表罗列要点，每项一行
- 用 Markdown 表格对比信息
- 段落之间用空行分隔
- 不要把所有内容写成一段

相关灵感卡片：
{context}

用户问题：{question}"""

        # 3. Stream LLM response
        messages = [{"role": "user", "content": prompt}]
        async for chunk in llm_service.stream(messages):
            yield chunk

        # 4. Yield sources as a dict (the endpoint layer will serialize it)
        source_cards = [
            CardSummary(
                id=str(c.id),
                title=c.title,
                content=c.content[:200],
                keywords=c.keywords,
            )
            for c in context_cards
        ]
        yield {"source_cards": source_cards}


rag_service = RAGService()

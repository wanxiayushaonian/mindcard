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
from app.services.web_search import web_search_service

logger = logging.getLogger(__name__)

MARKDOWN_SYSTEM_PROMPT = (
    "你是一个知识问答助手。回答必须使用 Markdown 格式，严格遵守以下规则：\n"
    "1. 每个主题必须用 ## 标题开头（必须写 ## 符号，不能省略），标题前后必须有空行\n"
    "2. 列表项必须单独占一行，以 - 开头且 - 后面必须有空格（如 - 要点1）。绝对不要在句子中间用 - 做分隔符\n"
    "3. 对比信息必须用 Markdown 表格，格式为 | 列名 | 列名 |，数据行之间不能用 --- 分隔，只需表头和数据行\n"
    "4. 不同段落之间必须用空行分隔\n"
    "5. 绝对不要把所有内容写在一行里\n"
    "6. 标题只能用 ##（二级），不要用 # 或 ### 或 ####\n"
    "7. 绝对不要在句子中间写 -xxx 这样的格式，- 只能用于列表项的开头。需要列举多项内容时，必须每项单独一行写 - xxx\n"
    "8. 绝对不要把多个列表项写在同一行。每条 - xxx 必须独占一行，用换行分隔\n"
    "示例格式：\n"
    "## 主题一\n\n"
    "这里是内容说明。\n\n"
    "- 要点1\n"
    "- 要点2\n\n"
    "## 主题二\n\n"
    "| 列A | 列B |\n"
    "|-----|-----|\n"
    "| 值1 | 值2 |\n\n"
    "重要：标题前面必须有 ## 符号。列表项 - 必须在行首且后面有空格。绝对不要在段落中间用 - 做分隔。"
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
        web_search: bool = False,
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

        # 2.5 Optional web search
        search_context = ""
        web_search_results = []
        if web_search:
            search_results = web_search_service.search(question, max_results=8)
            web_search_results = search_results
            if search_results:
                search_context = "\n\n" + web_search_service.format_results(search_results)

        prompt = f"""基于以下灵感卡片回答用户问题。如果卡片内容不足以回答，请说明。

回答格式要求（必须严格遵守）：
- 每个主题必须用 ## 标题开头（必须写 ## 符号，不能省略），标题前后加空行
- 列表项必须单独占一行，以 - 开头且后面必须有空格（如 - 要点1）
- 绝对不要在句子中间用 - 做分隔符（如不要写 成果。-阶段一，应该每项单独一行）
- 对比信息必须用 Markdown 表格，格式为 | 列名 | 列名 |，用 | 分隔每列
- 段落之间用空行分隔
- 不要把所有内容写成一段
- 标题只能用 ##（二级），不要用 # 或 ### 或 ####
- 重要：标题前面必须有 ## 符号。列表项 - 必须在行首。绝对不要在段落中间写 -xxx
- 绝对不要把多个列表项写在同一行，每条 - xxx 必须独占一行

相关灵感卡片：
{context}
{search_context}

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
            "web_search_results": [
                {"title": r.title, "snippet": r.snippet, "url": r.url}
                for r in web_search_results
            ],
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
        self, message: str, history: list[dict[str, str]] | None = None, web_search: bool = False
    ) -> str:
        """General chat without RAG, supports conversation history."""
        messages = [{"role": "system", "content": MARKDOWN_SYSTEM_PROMPT}]
        if history:
            messages.extend(history)

        # Optional web search
        user_message = message
        if web_search:
            search_results = web_search_service.search(message, max_results=8)
            if search_results:
                user_message = message + "\n\n" + web_search_service.format_results(search_results)

        messages.append({"role": "user", "content": user_message})
        return await llm_service.complete(messages)

    async def chat_stream(
        self, message: str, history: list[dict[str, str]] | None = None, web_search: bool = False
    ) -> AsyncGenerator[str | dict, None]:
        """Streaming general chat without RAG."""
        messages = [{"role": "system", "content": MARKDOWN_SYSTEM_PROMPT}]
        if history:
            messages.extend(history)

        # Optional web search - yield results immediately
        user_message = message
        if web_search:
            search_results = web_search_service.search(message, max_results=8)
            if search_results:
                user_message = message + "\n\n" + web_search_service.format_results(search_results)
                # Yield web search results immediately for frontend display
                yield {
                    "type": "web_search_results",
                    "results": [
                        {"title": r.title, "snippet": r.snippet, "url": r.url}
                        for r in search_results
                    ],
                }

        messages.append({"role": "user", "content": user_message})
        async for chunk in llm_service.stream(messages):
            yield chunk

    async def ask_stream(
        self,
        db: AsyncSession,
        question: str,
        workspace_id: str,
        card_id: str | None = None,
        top_k: int = 5,
        web_search: bool = False,
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

        # 2.5 Optional web search - yield results immediately
        search_context = ""
        web_search_results = []
        if web_search:
            search_results = web_search_service.search(question, max_results=8)
            web_search_results = search_results
            if search_results:
                search_context = "\n\n" + web_search_service.format_results(search_results)
                # Yield web search results immediately for frontend display
                yield {
                    "type": "web_search_results",
                    "results": [
                        {"title": r.title, "snippet": r.snippet, "url": r.url}
                        for r in search_results
                    ],
                }

        prompt = f"""基于以下灵感卡片回答用户问题。如果卡片内容不足以回答，请说明。

回答格式要求（必须严格遵守）：
- 每个主题必须用 ## 标题开头（必须写 ## 符号，不能省略），标题前后加空行
- 列表项必须单独占一行，以 - 开头且后面必须有空格（如 - 要点1）
- 绝对不要在句子中间用 - 做分隔符（如不要写 成果。-阶段一，应该每项单独一行）
- 对比信息必须用 Markdown 表格，格式为 | 列名 | 列名 |，用 | 分隔每列
- 段落之间用空行分隔
- 不要把所有内容写成一段
- 标题只能用 ##（二级），不要用 # 或 ### 或 ####
- 重要：标题前面必须有 ## 符号。列表项 - 必须在行首。绝对不要在段落中间写 -xxx
- 绝对不要把多个列表项写在同一行，每条 - xxx 必须独占一行

相关灵感卡片：
{context}
{search_context}

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
        yield {
            "type": "sources",
            "source_cards": source_cards,
        }


rag_service = RAGService()

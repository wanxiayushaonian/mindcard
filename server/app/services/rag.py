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

MARKDOWN_SYSTEM_PROMPT = """你是一个知识问答助手。

# Markdown格式规范

## 标题
- 使用 ## 或 ### 创建标题
- 标题前后必须有空行
- 标题和 # 之间必须有空格

## 段落
- 段落之间用空行分隔
- 不要在段落中间插入列表
- 不要把所有内容写成一段

## 列表
- 列表项必须单独成行
- 使用 `- ` 开头（短横线后有空格）
- 列表前后必须有空行
- 不要在句子中间使用 `-` 作为分隔符

## 表格
- 使用标准Markdown表格格式
- 表头和内容之间用 `|---|---|` 分隔
- 表格前后必须有空行

## 示例

正确格式：
```
## 核心功能

Notion是一款综合性工具。

### 笔记管理

- 支持富文本编辑
- 可以创建页面层级
- 支持双向链接
```

错误格式（避免）：
```
##核心功能
Notion是一款综合性工具。-支持富文本-可以创建页面
```
"""


class RAGService:
    """RAG pipeline: retrieve relevant cards → build context → LLM answer."""

    async def ask(
        self,
        db: AsyncSession,
        question: str,
        workspace_ids: list | None = None,
        card_id: str | None = None,
        top_k: int = 5,
        web_search: bool = False,
        history: list[dict[str, str]] | None = None,
        use_graph: bool = True,
    ) -> dict:
        """Answer a question using RAG over workspace cards."""
        # 1. Retrieve relevant cards
        if card_id:
            context_cards = await self._find_similar_cards(db, card_id, limit=top_k)
        elif use_graph and workspace_ids and len(workspace_ids) == 1:
            # Try Graph RAG first for single workspace queries
            try:
                from app.services.gnn_retriever import graph_retriever
                graph_result = await graph_retriever.retrieve(
                    question, workspace_ids[0], db, k=top_k
                )
                context_cards = [c.id for c in graph_result.cards]
                # Fetch full card objects
                if context_cards:
                    stmt = select(Card).where(Card.id.in_(context_cards))
                    result = await db.execute(stmt)
                    context_cards = list(result.scalars().all())
                else:
                    context_cards = []
            except Exception as e:
                logger.warning("Graph retrieval failed, falling back to hybrid search: %s", e)
                scored = await search_service.hybrid_search(db, question, workspace_ids, limit=top_k)
                context_cards = [sc.card for sc in scored]
        else:
            scored = await search_service.hybrid_search(db, question, workspace_ids, limit=top_k)
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

        system_prompt = f"""你是一个知识问答助手。基于以下灵感卡片回答用户问题。如果卡片内容不足以回答，请说明。

# Markdown格式规范

## 标题
- 使用 ## 或 ### 创建标题
- 标题前后必须有空行
- 标题和 # 之间必须有空格

## 段落
- 段落之间用空行分隔
- 不要在段落中间插入列表

## 列表
- 列表项必须单独成行
- 使用 `- ` 开头（短横线后有空格）
- 列表前后必须有空行
- 不要在句子中间使用 `-` 作为分隔符

## 表格
- 使用标准Markdown表格格式
- 表头和内容之间用 `|---|---|` 分隔
- 表格前后必须有空行

## 示例

正确格式：
```
## 核心功能

Notion是一款综合性工具。

### 笔记管理

- 支持富文本编辑
- 可以创建页面层级
- 支持双向链接
```

错误格式（避免）：
```
##核心功能
Notion是一款综合性工具。-支持富文本-可以创建页面
```

相关灵感卡片：
{context}
{search_context}"""

        # 3. Call LLM
        messages = [{"role": "system", "content": system_prompt}]
        if history:
            messages.extend(history[-10:])
        messages.append({"role": "user", "content": question})
        answer = await llm_service.complete(messages)

        # 4. Return with sources
        source_cards = [
            CardSummary(
                id=str(c.id),
                title=c.title,
                content=c.content[:200],
                keywords=c.keywords,
                color=c.color,
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
        workspace_ids: list | None = None,
        card_id: str | None = None,
        top_k: int = 5,
        web_search: bool = False,
        history: list[dict[str, str]] | None = None,
    ) -> AsyncGenerator[str | dict, None]:
        """Streaming RAG answer: retrieve cards, stream LLM, yield sources dict at end."""
        # 1. Retrieve relevant cards
        if card_id:
            context_cards = await self._find_similar_cards(db, card_id, limit=top_k)
        else:
            scored = await search_service.hybrid_search(db, question, workspace_ids, limit=top_k)
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

        system_prompt = f"""你是一个知识问答助手。基于以下灵感卡片回答用户问题。如果卡片内容不足以回答，请说明。

# Markdown格式规范

## 标题
- 使用 ## 或 ### 创建标题
- 标题前后必须有空行
- 标题和 # 之间必须有空格

## 段落
- 段落之间用空行分隔
- 不要在段落中间插入列表

## 列表
- 列表项必须单独成行
- 使用 `- ` 开头（短横线后有空格）
- 列表前后必须有空行
- 不要在句子中间使用 `-` 作为分隔符

## 表格
- 使用标准Markdown表格格式
- 表头和内容之间用 `|---|---|` 分隔
- 表格前后必须有空行

## 示例

正确格式：
```
## 核心功能

Notion是一款综合性工具。

### 笔记管理

- 支持富文本编辑
- 可以创建页面层级
- 支持双向链接
```

错误格式（避免）：
```
##核心功能
Notion是一款综合性工具。-支持富文本-可以创建页面
```

相关灵感卡片：
{context}
{search_context}"""

        # 3. Stream LLM response
        messages = [{"role": "system", "content": system_prompt}]
        if history:
            messages.extend(history[-10:])
        messages.append({"role": "user", "content": question})
        async for chunk in llm_service.stream(messages):
            yield chunk

        # 4. Yield sources as a dict (the endpoint layer will serialize it)
        source_cards = [
            CardSummary(
                id=str(c.id),
                title=c.title,
                content=c.content[:200],
                keywords=c.keywords,
                color=c.color,
            )
            for c in context_cards
        ]
        yield {
            "type": "sources",
            "source_cards": source_cards,
        }


rag_service = RAGService()

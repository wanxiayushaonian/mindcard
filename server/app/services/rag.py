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

# 重要：严格遵守以下Markdown格式规则

## 标题格式（必须遵守）
1. ## 和标题文字之间必须有一个空格：`## 标题` ✓  `##标题` ✗
2. 标题前后必须有空行

示例：
```
（空行）
## 这是标题
（空行）
这是段落内容。
```

## 列表格式（必须遵守）
1. 短横线和文字之间必须有一个空格：`- 列表项` ✓  `-列表项` ✗
2. 列表前后必须有空行
3. 每个列表项单独一行

示例：
```
这是段落。
（空行）
- 第一项
- 第二项
- 第三项
（空行）
继续段落。
```

## 段落格式
- 段落之间用空行分隔
- 不要把标题、列表、段落混在一起

## 错误示例（绝对不要这样写）
```
##标题-列表项-列表项
###子标题-内容-内容
```

## 正确示例（必须这样写）
```
## 标题

这是段落内容。

### 子标题

- 列表项一
- 列表项二
- 列表项三

继续段落内容。
```

请严格按照以上格式输出，每次输出前检查：
1. ## 后面有空格吗？
2. 标题前后有空行吗？
3. - 后面有空格吗？
4. 列表前后有空行吗？
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

# 重要：严格遵守以下Markdown格式规则

## 标题格式（必须遵守）
1. ## 和标题文字之间必须有一个空格：`## 标题` ✓  `##标题` ✗
2. 标题前后必须有空行

## 列表格式（必须遵守）
1. 短横线和文字之间必须有一个空格：`- 列表项` ✓  `-列表项` ✗
2. 列表前后必须有空行
3. 每个列表项单独一行

## 错误示例（绝对不要这样写）
```
##标题-列表项-列表项
###子标题-内容-内容
```

## 正确示例（必须这样写）
```
## 标题

这是段落内容。

### 子标题

- 列表项一
- 列表项二

继续段落内容。
```

请严格按照以上格式输出，每次输出前检查：
1. ## 后面有空格吗？
2. 标题前后有空行吗？
3. - 后面有空格吗？
4. 列表前后有空行吗？

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

# 重要：严格遵守以下Markdown格式规则

## 标题格式（必须遵守）
1. ## 和标题文字之间必须有一个空格：`## 标题` ✓  `##标题` ✗
2. 标题前后必须有空行

## 列表格式（必须遵守）
1. 短横线和文字之间必须有一个空格：`- 列表项` ✓  `-列表项` ✗
2. 列表前后必须有空行
3. 每个列表项单独一行

## 错误示例（绝对不要这样写）
```
##标题-列表项-列表项
###子标题-内容-内容
```

## 正确示例（必须这样写）
```
## 标题

这是段落内容。

### 子标题

- 列表项一
- 列表项二

继续段落内容。
```

请严格按照以上格式输出，每次输出前检查：
1. ## 后面有空格吗？
2. 标题前后有空行吗？
3. - 后面有空格吗？
4. 列表前后有空行吗？

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

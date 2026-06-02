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

# ⚠️ 关键要求：必须输出标准Markdown格式

你的回答将被Markdown渲染器解析。如果格式不正确，用户将看到混乱的文本。

## 标题格式规则（强制）

**正确写法：**
```markdown
## 标题文字
```
- `##` 和标题文字之间**必须有一个空格**
- 标题前后**必须有空行**

**错误写法（会导致渲染失败）：**
```markdown
##标题文字          ❌ 缺少空格
## 标题文字继续内容   ❌ 标题后没有换行
```

## 列表格式规则（强制）

**正确写法：**
```markdown
- 列表项一
- 列表项二
```
- `-` 和文字之间**必须有一个空格**
- 每个列表项**必须单独一行**
- 列表前后**必须有空行**

**错误写法（会导致渲染失败）：**
```markdown
-列表项           ❌ 缺少空格
- 列表项一- 列表项二  ❌ 多个项在同一行
```

## 段落格式规则

- 段落之间用**一个空行**分隔
- 不要把标题、列表、段落挤在同一行

## 完整示例对比

**❌ 错误（所有内容挤在一起）：**
```markdown
##Obsidian的核心作用Obsidian是一个强大的知识管理工具。###构建知识网络-双向链接-标签系统-图谱视图
```

**✅ 正确（清晰的结构）：**
```markdown
## Obsidian的核心作用

Obsidian是一个强大的知识管理工具。

### 构建知识网络

- 双向链接
- 标签系统
- 图谱视图
```

## 输出前自检清单

在生成每一段内容时，请确认：
1. ✓ 每个 `##` 后面都有空格
2. ✓ 每个标题前后都有空行
3. ✓ 每个 `-` 后面都有空格
4. ✓ 每个列表项都单独一行
5. ✓ 列表前后都有空行
6. ✓ 段落之间有空行分隔

**记住：格式错误会让用户看到乱码般的文本！**
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

# ⚠️ 关键要求：必须输出标准Markdown格式

你的回答将被Markdown渲染器解析。如果格式不正确，用户将看到混乱的文本。

## 标题格式规则（强制）

**正确写法：**
```markdown
## 标题文字
```
- `##` 和标题文字之间**必须有一个空格**
- 标题前后**必须有空行**

**错误写法（会导致渲染失败）：**
```markdown
##标题文字          ❌ 缺少空格
## 标题文字继续内容   ❌ 标题后没有换行
```

## 列表格式规则（强制）

**正确写法：**
```markdown
- 列表项一
- 列表项二
```
- `-` 和文字之间**必须有一个空格**
- 每个列表项**必须单独一行**
- 列表前后**必须有空行**

**错误写法（会导致渲染失败）：**
```markdown
-列表项           ❌ 缺少空格
- 列表项一- 列表项二  ❌ 多个项在同一行
```

## 输出前自检清单

在生成每一段内容时，请确认：
1. ✓ 每个 `##` 后面都有空格
2. ✓ 每个标题前后都有空行
3. ✓ 每个 `-` 后面都有空格
4. ✓ 每个列表项都单独一行
5. ✓ 列表前后都有空行

**记住：格式错误会让用户看到乱码般的文本！**

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
        retrieval_level: int | None = None,
        chat_id: str | None = None,
    ) -> AsyncGenerator[str | dict, None]:
        """Streaming RAG answer: retrieve cards via RetrievalDispatcher, stream LLM, yield sources dict at end."""
        from app.schemas.retrieval import RetrievalLevel
        from app.services.retrieval_dispatcher import retrieval_dispatcher

        # Determine retrieval level
        if retrieval_level is not None:
            level = RetrievalLevel(retrieval_level)
        else:
            # Default: FREE (pure LLM chat); user can select deeper levels explicitly
            level = RetrievalLevel.FREE

        ws_ids = [uuid.UUID(w) for w in workspace_ids] if workspace_ids else []

        retrieval_result = await retrieval_dispatcher.dispatch(
            question=question,
            level=level,
            workspace_ids=ws_ids,
            db=db,
            top_k=top_k,
            card_id=card_id,
            chat_id=chat_id,
        )

        context_cards = retrieval_result.cards

        # Build entity and topology context strings
        entity_ctx = retrieval_dispatcher.build_entity_context_string(retrieval_result)
        topo_ctx = retrieval_dispatcher.build_topology_context_string(retrieval_result)

        # Fall back to FREE if no cards found at higher levels
        if not context_cards and level != RetrievalLevel.FREE:
            level = RetrievalLevel.FREE
            retrieval_result.level_used = RetrievalLevel.FREE

        # Build context from cards
        if context_cards:
            context = "\n\n".join(
                f"【{c.title or 'Untitled'}】{c.content}" for c in context_cards
            )
        else:
            context = ""

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

        # Build enhanced system prompt with entity/topology context
        system_parts = ["""你是一个知识问答助手。基于以下灵感卡片回答用户问题。如果卡片内容不足以回答，请说明。

# ⚠️ 关键要求：必须输出标准Markdown格式

你的回答将被Markdown渲染器解析。如果格式不正确，用户将看到混乱的文本。

## 标题格式规则（强制）

**正确写法：**
```markdown
## 标题文字
```
- `##` 和标题文字之间**必须有一个空格**
- 标题前后**必须有空行**

**错误写法（会导致渲染失败）：**
```markdown
##标题文字          ❌ 缺少空格
## 标题文字继续内容   ❌ 标题后没有换行
```

## 列表格式规则（强制）

**正确写法：**
```markdown
- 列表项一
- 列表项二
```
- `-` 和文字之间**必须有一个空格**
- 每个列表项**必须单独一行**
- 列表前后**必须有空行**

**错误写法（会导致渲染失败）：**
```markdown
-列表项           ❌ 缺少空格
- 列表项一- 列表项二  ❌ 多个项在同一行
```

## 输出前自检清单

在生成每一段内容时，请确认：
1. ✓ 每个 `##` 后面都有空格
2. ✓ 每个标题前后都有空行
3. ✓ 每个 `-` 后面都有空格
4. ✓ 每个列表项都单独一行
5. ✓ 列表前后都有空行

**记住：格式错误会让用户看到乱码般的文本！**"""]

        if entity_ctx:
            system_parts.append(entity_ctx)
        if topo_ctx:
            system_parts.append(topo_ctx)
        system_parts.append(f"\n相关灵感卡片：\n{context}")
        if search_context:
            system_parts.append(search_context)

        system_prompt = "\n\n".join(system_parts)

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

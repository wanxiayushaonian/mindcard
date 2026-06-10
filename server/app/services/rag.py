import json
import logging
import uuid
from collections.abc import AsyncGenerator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.schemas.rag import CardSummary
from app.services.llm import llm_service
from app.services.search import search_service
from app.services.web_search import web_search_service

logger = logging.getLogger(__name__)

# Shared markdown formatting instructions (used by all prompts)
_MARKDOWN_FORMAT_INSTRUCTIONS = """# ⚠️ 关键要求：必须输出标准Markdown格式

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
- 不要把标题、列表、段落挤在同一一行

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

**记住：格式错误会让用户看到乱码般的文本！**"""

MARKDOWN_SYSTEM_PROMPT = f"""你是一个知识问答助手。

{_MARKDOWN_FORMAT_INSTRUCTIONS}

## 思考与回答分离（强制）

你的回复必须严格按以下顺序输出，**第一个字符必须是 `<`**：

```
<thinking>
你的所有分析推理过程：理解用户意图、判断是否需要分叉、规划回答要点等。
</thinking>

最终回答内容（Markdown格式）
```

**绝对规则（违反将导致渲染错误）：**
1. `<thinking>` 标签必须是回复的**第一个内容**，前面不能有任何文字
2. 所有分析、推理、意图判断必须放在 `<thinking>` 块内
3. `</thinking>` 之后只输出最终回答，不要再有分析性文字
4. 最终回答必须完整、独立可读，不依赖 thinking 内容
5. 不要在最终回答中重复 thinking 中的分析过程
"""


CREATE_FORK_INSTRUCTION = """
## 话题分叉规则（create_fork 工具）

当用户的新问题与当前对话话题**明显不同**时，在回答前先调用 `create_fork` 工具创建新分支。
工具调用之后立即给出完整回答——回答内容将自动归入新分支。

**应该分叉的情况：**
- 当前讨论"RAG 原理"，用户问"怎么做红烧肉" → 分叉（完全不同领域）
- 当前讨论"Python 语法"，用户问"机器学习入门" → 分叉（独立探索方向）
- 用户明确说"换个话题"或"另一个问题" → 分叉

**不应该分叉的情况：**
- 同一话题的追问、延伸、澄清、举例
- 自然的对话流动
- 刚创建分支后的连续消息（不要连续分叉）

**分叉类型（profile）：**
- `deep_dive`（深入探讨）：聚焦当前话题的深层细节
- `explore`（发散探索）：自由联想、头脑风暴
- `summarize`（总结提炼）：对已有对话进行结构化回顾
- `challenge`（质疑挑战）：批判性审视当前结论

根据用户的意图选择合适的 profile。不确定时默认用 `deep_dive`。
"""

MEMORY_EDIT_INSTRUCTION = """
## 工作区记忆工具使用规则

你可以使用 `memory_edit` 工具来保存重要的知识到工作区的共享记忆中。

**何时使用：**
- 用户明确要求"记住这个"、"保存这个结论"等
- 对话中产生了重要的决策或结论，值得在未来对话中引用
- 用户提供了关于项目的重要背景信息（目标、约束、偏好）

**何时不使用：**
- 普通问答，用户没有要求记住
- 临时性的、只在当前对话中有意义的信息
- 已经存在于记忆中的重复信息

**使用方式：**
- slug: 使用简短的英文标识（如 "project-goals", "tech-stack"）
- title: 简短的中文描述
- body: 结构化的 Markdown 内容
"""


async def build_branch_context(
    db: AsyncSession,
    chat_id: str,
    workspace_id: str | None,
) -> tuple[str, list]:
    """Build branch context string for system prompt injection.

    Includes: cross-branch insights and shared memory.
    Parent context is intentionally excluded — it lives in fork-divider
    metadata for UI display only, following Stello's principle that memory
    should not enter its own session's context (avoids self-referential noise).

    Returns (context_string, unconsumed_insight_ids) — caller should call
    mark_insights_consumed() only after the stream succeeds.
    """
    from app.models.branch_insight import BranchInsight
    from app.models.workspace_memory import WorkspaceMemory

    parts = []
    consumed_ids = []

    # 1. Unconsumed cross-branch insights (read-only, don't consume yet)
    result = await db.execute(
        select(BranchInsight).where(
            BranchInsight.target_chat_id == chat_id,
            BranchInsight.consumed.is_(False),
        )
    )
    insights = result.scalars().all()
    if insights:
        insight_text = "\n".join(f"- {i.content}" for i in insights)
        parts.append(f"<cross_branch_insights>\n来自其他分支的发现：\n{insight_text}\n</cross_branch_insights>")
        consumed_ids = [i.id for i in insights]

    # 2. Shared memory
    if workspace_id:
        result = await db.execute(
            select(WorkspaceMemory).where(
                WorkspaceMemory.workspace_id == workspace_id,
            )
        )
        memories = result.scalars().all()
        if memories:
            memory_text = "\n\n".join(f"## {m.title}\n{m.body}" for m in memories)
            parts.append(f"<shared_memory>\n{memory_text}\n</shared_memory>")

    return ("\n\n".join(parts) if parts else ""), consumed_ids


async def mark_insights_consumed(db: AsyncSession, insight_ids: list) -> None:
    """Mark insights as consumed after successful stream."""
    if not insight_ids:
        return
    from sqlalchemy import update as sa_update

    from app.models.branch_insight import BranchInsight
    await db.execute(
        sa_update(BranchInsight)
        .where(BranchInsight.id.in_(insight_ids))
        .values(consumed=True)
    )
    await db.commit()


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
            search_results = await web_search_service.search(question, max_results=8)
            web_search_results = search_results
            if search_results:
                search_context = "\n\n" + web_search_service.format_results(search_results)

        system_prompt = f"""你是一个知识问答助手。基于以下灵感卡片回答用户问题。如果卡片内容不足以回答，请说明。

{_MARKDOWN_FORMAT_INSTRUCTIONS}

相关灵感卡片：
{context}
{search_context}"""

        # 3. Call LLM
        messages = [{"role": "system", "content": system_prompt}]
        if history:
            messages.extend(history[-10:])
        messages.append({"role": "user", "content": question})
        response = await llm_service.complete(messages)
        answer = response.content

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

        response = await llm_service.complete([{"role": "user", "content": prompt}])
        answer = response.content

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
            search_results = await web_search_service.search(message, max_results=8)
            if search_results:
                user_message = message + "\n\n" + web_search_service.format_results(search_results)

        messages.append({"role": "user", "content": user_message})
        result = await llm_service.complete(messages)
        return result.content

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
            search_results = await web_search_service.search(message, max_results=8)
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
        try:
            async for chunk in llm_service.stream(messages):
                yield chunk
        except Exception as e:
            logger.error("chat_stream LLM error: %s", e)
            yield {"type": "error", "message": f"AI 回复出错: {e}"}

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
        current_fork_id: str | None = None,
        tools: list[dict] | None = None,
    ) -> AsyncGenerator[str | dict, None]:
        """Streaming RAG answer: retrieve cards via RetrievalDispatcher, stream LLM, yield sources dict at end.

        When tools is provided, yields a "messages_ready" dict instead of streaming
        directly — the caller (ws.py tool loop) handles LLM streaming with tool execution.
        """
        from app.schemas.retrieval import RetrievalLevel
        from app.services.retrieval_dispatcher import retrieval_dispatcher

        # Determine retrieval level
        if retrieval_level is not None:
            level = RetrievalLevel(retrieval_level)
        else:
            # Default: FREE (pure LLM chat); user can select deeper levels explicitly
            level = RetrievalLevel.CHAT

        logger.info("RAG.ask_stream: level=%s, question=%s, workspace_ids=%s, chat_id=%s",
                     level, question[:80], workspace_ids, chat_id)

        ws_ids = [w if isinstance(w, uuid.UUID) else uuid.UUID(w) for w in workspace_ids] if workspace_ids else []

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

        entity_ctx = retrieval_dispatcher.build_entity_context_string(retrieval_result)
        topo_ctx = retrieval_dispatcher.build_topology_context_string(retrieval_result)
        community_ctx = retrieval_result.community_context or ""

        logger.info("RAG.ask_stream: dispatch returned %d cards, level_used=%s, %d reasoning_paths, entity_ctx=%d chars, topo_ctx=%d chars, community_ctx=%d chars",
                     len(context_cards), retrieval_result.level_used, len(retrieval_result.reasoning_paths),
                     len(entity_ctx), len(topo_ctx), len(community_ctx))

        # Fall back to FREE if no cards found at higher levels (GLOBAL uses community context, not cards)
        if not context_cards and level not in (RetrievalLevel.CHAT, RetrievalLevel.INSIGHT):
            level = RetrievalLevel.CHAT
            retrieval_result.level_used = RetrievalLevel.CHAT

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
            search_results = await web_search_service.search(question, max_results=8)
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

        # Build enhanced system prompt based on retrieval level
        if level == RetrievalLevel.CHAT:
            system_parts = [MARKDOWN_SYSTEM_PROMPT]
        else:
            system_parts = [f"你是一个知识问答助手。基于以下灵感卡片回答用户问题。如果卡片内容不足以回答，请说明。\n\n{_MARKDOWN_FORMAT_INSTRUCTIONS}"]

        if entity_ctx:
            system_parts.append(entity_ctx)
        if topo_ctx:
            system_parts.append(topo_ctx)
        if community_ctx:
            system_parts.append(community_ctx)
        if context:
            system_parts.append(f"\n相关灵感卡片：\n{context}")
        if search_context:
            system_parts.append(search_context)

        # Inject branch context (cross-branch insights + shared memory)
        branch_context, insight_ids = await build_branch_context(
            db, chat_id,
            workspace_id=workspace_ids[0] if workspace_ids else None,
        )
        if branch_context:
            system_parts.append(branch_context)

        # Add memory_edit + fork instructions when tools are available
        if tools:
            system_parts.append(CREATE_FORK_INSTRUCTION)
            system_parts.append(MEMORY_EDIT_INSTRUCTION)

        system_prompt = "\n\n".join(system_parts)

        # Build messages list
        messages = [{"role": "system", "content": system_prompt}]
        if history:
            messages.extend(history[-10:])
        messages.append({"role": "user", "content": question})

        # Yield sources (before messages_ready so frontend receives them in tool mode)
        source_cards = [
            CardSummary(
                id=str(c.id),
                title=c.title,
                content=c.content[:200],
                keywords=c.keywords,
                color=c.color,
            ).model_dump()
            for c in context_cards
        ]
        yield {
            "type": "sources",
            "source_cards": source_cards,
        }

        if tools:
            # Tool-enabled mode: yield prepared messages, let caller run tool loop
            # Include insight_ids so caller can consume them after stream completes
            yield {"type": "messages_ready", "messages": messages, "insight_ids": insight_ids}
        else:
            # Standard mode: stream LLM response directly
            try:
                async for chunk in llm_service.stream(messages):
                    yield chunk
            except Exception as e:
                logger.error("ask_stream LLM error: %s", e)
                yield {"type": "error", "message": f"AI 回复出错: {e}"}
            # Consume insights only after successful stream (tool path defers to ws.py)
            await mark_insights_consumed(db, insight_ids)


rag_service = RAGService()

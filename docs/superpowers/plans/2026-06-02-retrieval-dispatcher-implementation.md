# RetrievalDispatcher + Depth Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the RAG/Chat binary mode with a unified RetrievalDispatcher supporting 4-level retrieval depth (FREE/CARD/GRAPH/FULL), and add a frontend depth selector.

**Architecture:** A new `RetrievalDispatcher` service routes queries through progressively deeper retrieval strategies. Level 0-1 reuse existing code. Level 2 adds entity/relation context from the knowledge graph. Level 3 adds topology path context. The frontend replaces the RAG/Chat toggle with a depth selector dropdown.

**Tech Stack:** FastAPI, SQLAlchemy async, pgvector, WebSocket, Next.js, Zustand

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `server/app/services/retrieval_dispatcher.py` | Core dispatcher: level routing, entity matching, relation traversal, topology path context, entity context builder |
| `server/app/schemas/retrieval.py` | `RetrievalLevel` enum, `RetrievalResult` dataclass |

### Modified files
| File | Responsibility |
|------|---------------|
| `server/app/services/rag.py` | Replace inline retrieval with `RetrievalDispatcher.dispatch()` in `ask_stream()` |
| `server/app/api/ws.py` | Read `retrieval_level` from WS message, pass to `ask_stream()` |
| `server/app/api/rag.py` | Read `retrieval_level` from `RAGRequest`, pass to `ask_stream()` |
| `server/app/schemas/rag.py` | Add `retrieval_level` field to `RAGRequest` |
| `web/components/AiChatPanel.tsx` | Replace mode toggle with depth selector, update WS message format |
| `web/lib/unified-ws.ts` | Add `retrieval_level` to `RAGMessage` interface |

---

### Task 1: Create RetrievalResult schema

**Files:**
- Create: `server/app/schemas/retrieval.py`

- [ ] **Step 1: Create the schema file**

```python
# server/app/schemas/retrieval.py
from dataclasses import dataclass, field
from enum import IntEnum


class RetrievalLevel(IntEnum):
    FREE = 0       # No retrieval, pure LLM + history
    CARD = 1       # Hybrid search (vector + fulltext RRF)
    GRAPH = 2      # Card retrieval + entity/relation context
    FULL = 3       # Graph + topology path + topic context


@dataclass
class EntityContext:
    """A matched entity with its relations and linked cards."""
    entity_id: str
    name: str
    entity_type: str | None = None
    relations: list[dict] = field(default_factory=list)  # [{head, relation, tail, head_name, tail_name}]
    linked_card_titles: list[str] = field(default_factory=list)


@dataclass
class RetrievalResult:
    """Unified result from RetrievalDispatcher."""
    cards: list = field(default_factory=list)              # list[Card] objects
    card_scores: list[float] = field(default_factory=list) # parallel scores
    entities: list[EntityContext] = field(default_factory=list)
    topology_path: list[dict] | None = None                # [{node_id, title, summary}]
    node_card_titles: list[str] = field(default_factory=list)
    cross_refs: list[dict] = field(default_factory=list)   # [{target_title, ref_type, reason}]
    level_used: RetrievalLevel = RetrievalLevel.FREE
```

- [ ] **Step 2: Verify syntax**

Run: `cd server && python -c "from app.schemas.retrieval import RetrievalLevel, RetrievalResult; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add server/app/schemas/retrieval.py
git commit -m "feat(server): add RetrievalLevel enum and RetrievalResult schema"
```

---

### Task 2: Create RetrievalDispatcher with Level 0/1

**Files:**
- Create: `server/app/services/retrieval_dispatcher.py`

- [ ] **Step 1: Create the dispatcher with FREE and CARD levels**

```python
# server/app/services/retrieval_dispatcher.py
import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.retrieval import RetrievalLevel, RetrievalResult

logger = logging.getLogger(__name__)


class RetrievalDispatcher:
    """Unified retrieval dispatcher with 4-level depth."""

    async def dispatch(
        self,
        question: str,
        level: RetrievalLevel,
        workspace_ids: list[uuid.UUID],
        db: AsyncSession,
        top_k: int = 5,
        card_id: str | None = None,
    ) -> RetrievalResult:
        """Route query through the appropriate retrieval strategy."""
        if level == RetrievalLevel.FREE:
            return RetrievalResult(level_used=RetrievalLevel.FREE)

        if level == RetrievalLevel.CARD:
            return await self._level_card(question, workspace_ids, db, top_k, card_id)

        if level == RetrievalLevel.GRAPH:
            return await self._level_graph(question, workspace_ids, db, top_k, card_id)

        if level == RetrievalLevel.FULL:
            return await self._level_full(question, workspace_ids, db, top_k, card_id)

        return RetrievalResult(level_used=RetrievalLevel.FREE)

    async def _level_card(
        self,
        question: str,
        workspace_ids: list[uuid.UUID],
        db: AsyncSession,
        top_k: int,
        card_id: str | None,
    ) -> RetrievalResult:
        """Level 1: Hybrid search (vector + fulltext RRF)."""
        from app.services.search import search_service
        from app.services.rag import rag_service

        if card_id:
            cards = await rag_service._find_similar_cards(db, card_id, top_k)
            return RetrievalResult(
                cards=cards,
                card_scores=[1.0] * len(cards),
                level_used=RetrievalLevel.CARD,
            )

        scored = await search_service.hybrid_search(db, question, workspace_ids, limit=top_k)
        return RetrievalResult(
            cards=[sc.card for sc in scored],
            card_scores=[sc.score for sc in scored],
            level_used=RetrievalLevel.CARD,
        )

    async def _level_graph(
        self,
        question: str,
        workspace_ids: list[uuid.UUID],
        db: AsyncSession,
        top_k: int,
        card_id: str | None,
    ) -> RetrievalResult:
        """Level 2: Card retrieval + entity/relation context. Implemented in Task 3."""
        # Fallback to Level 1 for now
        return await self._level_card(question, workspace_ids, db, top_k, card_id)

    async def _level_full(
        self,
        question: str,
        workspace_ids: list[uuid.UUID],
        db: AsyncSession,
        top_k: int,
        card_id: str | None,
    ) -> RetrievalResult:
        """Level 3: Graph + topology path + topic context. Implemented in Task 5."""
        # Fallback to Level 2 for now
        return await self._level_graph(question, workspace_ids, db, top_k, card_id)


retrieval_dispatcher = RetrievalDispatcher()
```

- [ ] **Step 2: Verify import works**

Run: `cd server && python -c "from app.services.retrieval_dispatcher import retrieval_dispatcher; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add server/app/services/retrieval_dispatcher.py
git commit -m "feat(server): create RetrievalDispatcher with Level 0/1"
```

---

### Task 3: Implement Level 2 (Graph Enhancement)

**Files:**
- Modify: `server/app/services/retrieval_dispatcher.py`

- [ ] **Step 1: Add entity matching and relation traversal methods**

Add these methods to `RetrievalDispatcher`:

```python
    async def _level_graph(
        self,
        question: str,
        workspace_ids: list[uuid.UUID],
        db: AsyncSession,
        top_k: int,
        card_id: str | None,
    ) -> RetrievalResult:
        """Level 2: Card retrieval + entity/relation context."""
        from app.services.embedding import embedding_service
        from app.models.graph import GraphEntity, GraphRelation, EntityCard
        from app.models.card import Card
        from sqlalchemy import select, or_

        # Step 1: Get card results (same as Level 1)
        card_result = await self._level_card(question, workspace_ids, db, top_k, card_id)

        # Step 2: Extract entities from question
        entities = await self._extract_entities(question)

        # Step 3: Match entities in graph
        entity_contexts = []
        for ent_name in entities:
            matched = await self._match_entity(ent_name, workspace_ids, db)
            if matched:
                ctx = await self._build_entity_context(matched, workspace_ids, db)
                entity_contexts.append(ctx)

        # Step 4: If no entity matches, try vector similarity on question
        if not entity_contexts:
            q_emb = await embedding_service.embed(question)
            result = await db.execute(
                select(GraphEntity)
                .where(GraphEntity.workspace_id.in_(workspace_ids))
                .where(GraphEntity.embedding.isnot(None))
                .order_by(GraphEntity.embedding.cosine_distance(q_emb))
                .limit(3)
            )
            for ent in result.scalars().all():
                ctx = await self._build_entity_context(ent, workspace_ids, db)
                entity_contexts.append(ctx)

        return RetrievalResult(
            cards=card_result.cards,
            card_scores=card_result.card_scores,
            entities=entity_contexts,
            level_used=RetrievalLevel.GRAPH,
        )

    async def _extract_entities(self, text: str) -> list[str]:
        """Extract entity names from text using the triple extractor."""
        try:
            from app.services.triple_extractor import triple_extractor
            entities = await triple_extractor._extract_entities(text)
            return [e.name for e in entities]
        except Exception:
            return []

    async def _match_entity(
        self, name: str, workspace_ids: list[uuid.UUID], db: AsyncSession
    ) -> "GraphEntity | None":
        """Match entity by exact name or embedding similarity."""
        from app.models.graph import GraphEntity
        from app.services.embedding import embedding_service
        from sqlalchemy import select, func

        # Try exact match first
        result = await db.execute(
            select(GraphEntity)
            .where(GraphEntity.workspace_id.in_(workspace_ids))
            .where(func.lower(GraphEntity.name) == name.lower())
            .limit(1)
        )
        exact = result.scalar_one_or_none()
        if exact:
            return exact

        # Try embedding similarity
        try:
            emb = await embedding_service.embed(name)
            result = await db.execute(
                select(GraphEntity)
                .where(GraphEntity.workspace_id.in_(workspace_ids))
                .where(GraphEntity.embedding.isnot(None))
                .order_by(GraphEntity.embedding.cosine_distance(emb))
                .limit(1)
            )
            best = result.scalar_one_or_none()
            if best and best.embedding:
                # Check similarity threshold (cosine_distance returns 0..2, lower = more similar)
                dist = await db.execute(
                    select(GraphEntity.embedding.cosine_distance(emb))
                    .where(GraphEntity.id == best.id)
                )
                d = dist.scalar_one_or_none()
                if d is not None and d < 0.6:  # similarity > 0.7 (distance < 0.3 normalized)
                    return best
        except Exception:
            pass
        return None

    async def _build_entity_context(
        self, entity: "GraphEntity", workspace_ids: list[uuid.UUID], db: AsyncSession
    ) -> "EntityContext":
        """Build entity context with relations and linked card titles."""
        from app.models.graph import GraphRelation, EntityCard, GraphEntity
        from app.models.card import Card
        from sqlalchemy import select

        from app.schemas.retrieval import EntityContext

        # Get relations (1-hop)
        rels_result = await db.execute(
            select(GraphRelation)
            .where(
                or_(
                    GraphRelation.head_id == entity.id,
                    GraphRelation.tail_id == entity.id,
                )
            )
            .limit(10)
        )
        relations = []
        for rel in rels_result.scalars().all():
            # Get head/tail names
            head = await db.get(GraphEntity, rel.head_id)
            tail = await db.get(GraphEntity, rel.tail_id)
            relations.append({
                "head_name": head.name if head else "?",
                "relation": rel.relation,
                "tail_name": tail.name if tail else "?",
                "weight": rel.weight,
            })

        # Get linked card titles
        cards_result = await db.execute(
            select(Card.title)
            .join(EntityCard, EntityCard.card_id == Card.id)
            .where(EntityCard.entity_id == entity.id)
            .limit(5)
        )
        card_titles = [row[0] for row in cards_result.all() if row[0]]

        return EntityContext(
            entity_id=str(entity.id),
            name=entity.name,
            entity_type=entity.entity_type,
            relations=relations,
            linked_card_titles=card_titles,
        )
```

- [ ] **Step 2: Verify the import chain works**

Run: `cd server && python -c "from app.services.retrieval_dispatcher import retrieval_dispatcher; print('Level 2 OK')"`
Expected: `Level 2 OK`

- [ ] **Step 3: Commit**

```bash
git add server/app/services/retrieval_dispatcher.py
git commit -m "feat(server): implement Level 2 graph-enhanced retrieval"
```

---

### Task 4: Implement Level 3 (Full Awareness)

**Files:**
- Modify: `server/app/services/retrieval_dispatcher.py`

- [ ] **Step 1: Add topology path context methods**

Add these methods to `RetrievalDispatcher`:

```python
    async def _level_full(
        self,
        question: str,
        workspace_ids: list[uuid.UUID],
        db: AsyncSession,
        top_k: int,
        card_id: str | None,
    ) -> RetrievalResult:
        """Level 3: Graph + topology path + topic context."""
        # Get Level 2 results
        graph_result = await self._level_graph(question, workspace_ids, db, top_k, card_id)

        # For Level 3 we need a chat_id to find topology position
        # This will be passed via the caller; for now, topology context is optional
        # The chat_id is added in the dispatch() signature when wiring up

        return RetrievalResult(
            cards=graph_result.cards,
            card_scores=graph_result.card_scores,
            entities=graph_result.entities,
            level_used=RetrievalLevel.FULL,
        )

    async def get_topology_context(
        self, chat_id: str, workspace_id: uuid.UUID, db: AsyncSession
    ) -> dict:
        """Get topology path context for a chat session.

        Returns dict with keys: path, node_card_titles, cross_refs
        """
        from app.models.topology import TreeNode, NodeCard, NodeRef
        from app.models.card import Card
        from app.models.chat import AiChat
        from sqlalchemy import select

        # Find the tree node bound to this chat
        chat_result = await db.execute(
            select(AiChat.tree_node_id).where(AiChat.id == chat_id)
        )
        tree_node_id = chat_result.scalar_one_or_none()

        if not tree_node_id:
            return {"path": [], "node_card_titles": [], "cross_refs": []}

        # Walk up the tree to root
        path = []
        current_id = tree_node_id
        while current_id:
            node_result = await db.execute(
                select(TreeNode).where(TreeNode.id == current_id)
            )
            node = node_result.scalar_one_or_none()
            if not node:
                break
            path.append({
                "node_id": str(node.id),
                "title": node.title or "",
                "summary": node.summary or "",
            })
            current_id = node.parent_id

        path.reverse()  # root first

        # Get cards bound to current node
        cards_result = await db.execute(
            select(Card.title)
            .join(NodeCard, NodeCard.card_id == Card.id)
            .where(NodeCard.node_id == tree_node_id)
        )
        node_card_titles = [row[0] for row in cards_result.all() if row[0]]

        # Get cross-branch references
        refs_result = await db.execute(
            select(NodeRef).where(NodeRef.source_node_id == tree_node_id)
        )
        cross_refs = []
        for ref in refs_result.scalars().all():
            target = await db.get(TreeNode, ref.target_node_id)
            if target:
                cross_refs.append({
                    "target_title": target.title or "",
                    "ref_type": ref.ref_type,
                    "reason": ref.reason or "",
                })

        return {
            "path": path,
            "node_card_titles": node_card_titles,
            "cross_refs": cross_refs,
        }
```

- [ ] **Step 2: Update dispatch() to accept chat_id and wire Level 3**

Update the `dispatch()` signature to accept `chat_id`:

```python
    async def dispatch(
        self,
        question: str,
        level: RetrievalLevel,
        workspace_ids: list[uuid.UUID],
        db: AsyncSession,
        top_k: int = 5,
        card_id: str | None = None,
        chat_id: str | None = None,
    ) -> RetrievalResult:
        """Route query through the appropriate retrieval strategy."""
        if level == RetrievalLevel.FREE:
            return RetrievalResult(level_used=RetrievalLevel.FREE)

        if level == RetrievalLevel.CARD:
            return await self._level_card(question, workspace_ids, db, top_k, card_id)

        if level == RetrievalLevel.GRAPH:
            return await self._level_graph(question, workspace_ids, db, top_k, card_id)

        if level == RetrievalLevel.FULL:
            result = await self._level_full(question, workspace_ids, db, top_k, card_id)
            # Inject topology context if chat_id available
            if chat_id and workspace_ids:
                topo = await self.get_topology_context(chat_id, workspace_ids[0], db)
                result.topology_path = topo["path"]
                result.node_card_titles = topo["node_card_titles"]
                result.cross_refs = topo["cross_refs"]
            return result

        return RetrievalResult(level_used=RetrievalLevel.FREE)
```

- [ ] **Step 3: Commit**

```bash
git add server/app/services/retrieval_dispatcher.py
git commit -m "feat(server): implement Level 3 full-awareness retrieval with topology context"
```

---

### Task 5: Build entity context string builder

**Files:**
- Modify: `server/app/services/retrieval_dispatcher.py`

- [ ] **Step 1: Add context builder method to RetrievalDispatcher**

```python
    @staticmethod
    def build_entity_context_string(result: RetrievalResult) -> str:
        """Build a human-readable entity context string for system prompt injection."""
        if not result.entities:
            return ""

        lines = ["知识库中的相关概念："]
        for ctx in result.entities:
            if ctx.relations:
                for rel in ctx.relations[:3]:  # limit per entity
                    lines.append(
                        f"- [{rel['head_name']}] 是 [{rel['tail_name']}] 的 [{rel['relation']}]"
                    )
            if ctx.linked_card_titles:
                titles = "、".join(ctx.linked_card_titles[:3])
                lines.append(f"  关联卡片：{titles}")
        return "\n".join(lines)

    @staticmethod
    def build_topology_context_string(result: RetrievalResult) -> str:
        """Build topology path context string for system prompt injection."""
        parts = []

        if result.topology_path:
            path_titles = " → ".join(n["title"] for n in result.topology_path if n["title"])
            if path_titles:
                parts.append(f"你当前的探索路径：{path_titles}")

        if result.node_card_titles:
            titles = "、".join(result.node_card_titles[:5])
            parts.append(f"你在这条路径上积累的知识：{titles}")

        if result.cross_refs:
            refs = []
            for ref in result.cross_refs[:3]:
                refs.append(f"{ref['target_title']}（关系：{ref['ref_type']}）")
            parts.append(f"相关分支：{', '.join(refs)}")

        return "\n".join(parts)
```

- [ ] **Step 2: Commit**

```bash
git add server/app/services/retrieval_dispatcher.py
git commit -m "feat(server): add entity and topology context string builders"
```

---

### Task 6: Wire RetrievalDispatcher into ask_stream()

**Files:**
- Modify: `server/app/services/rag.py:369-488`
- Modify: `server/app/schemas/rag.py:6-15`
- Modify: `server/app/api/rag.py:95-130`
- Modify: `server/app/api/ws.py:160-177`

- [ ] **Step 1: Add retrieval_level to RAGRequest schema**

In `server/app/schemas/rag.py`, add to `RAGRequest`:

```python
class RAGRequest(BaseModel):
    question: str
    workspace_id: str | None = None
    card_id: str | None = None
    top_k: int = 5
    web_search: bool = False
    use_graph: bool = True
    retrieval_level: int | None = None  # 0=FREE, 1=CARD, 2=GRAPH, 3=FULL, None=auto
    history: list[dict[str, str]] = []
```

- [ ] **Step 2: Add retrieval_level to ask_stream() signature**

In `server/app/services/rag.py`, update `ask_stream()`:

```python
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
```

- [ ] **Step 3: Replace inline retrieval in ask_stream() with RetrievalDispatcher**

Replace the retrieval section (around lines 380-410) with:

```python
        # Determine retrieval level
        from app.schemas.retrieval import RetrievalLevel
        from app.services.retrieval_dispatcher import retrieval_dispatcher

        if retrieval_level is not None:
            level = RetrievalLevel(retrieval_level)
        else:
            # Auto-detect: default to GRAPH for RAG mode
            level = RetrievalLevel.GRAPH if workspace_ids else RetrievalLevel.FREE

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

        cards = retrieval_result.cards

        # Build enhanced system prompt with entity context
        entity_ctx = retrieval_dispatcher.build_entity_context_string(retrieval_result)
        topo_ctx = retrieval_dispatcher.build_topology_context_string(retrieval_result)
```

- [ ] **Step 4: Update system prompt to include entity and topology context**

In the system prompt construction section of `ask_stream()`, add the context blocks:

```python
        # Build context from cards
        if cards:
            context = "\n\n".join(
                f"【{c.title or '无标题'}】{c.content or ''}" for c in cards
            )
        else:
            context = ""

        # Enhanced system prompt with entity/topology context
        system_parts = [
            "你是一个知识问答助手。基于以下灵感卡片回答用户问题。如果卡片内容不足以回答，请说明。",
        ]
        if entity_ctx:
            system_parts.append(entity_ctx)
        if topo_ctx:
            system_parts.append(topo_ctx)
        system_parts.append(f"\n相关灵感卡片：\n{context}")

        system_msg = "\n\n".join(system_parts)
```

- [ ] **Step 5: Update the API endpoint to pass retrieval_level**

In `server/app/api/rag.py`, update the `ask_stream` endpoint:

```python
async for chunk in rag_service.ask_stream(
    db, req.question, ws_ids, card_id=req.card_id,
    top_k=req.top_k, web_search=req.web_search,
    history=req.history or None,
    retrieval_level=req.retrieval_level,
):
```

- [ ] **Step 6: Update WebSocket handler to read retrieval_level**

In `server/app/api/ws.py`, update the RAG message handler:

```python
    retrieval_level = msg.get("retrieval_level")
    # ... pass to handle_rag
```

And in `handle_rag`, pass it through to `ask_stream()`.

- [ ] **Step 7: Commit**

```bash
git add server/app/schemas/rag.py server/app/services/rag.py server/app/api/rag.py server/app/api/ws.py
git commit -m "feat(server): wire RetrievalDispatcher into ask_stream with retrieval_level"
```

---

### Task 7: Add auto-level detection

**Files:**
- Modify: `server/app/services/retrieval_dispatcher.py`

- [ ] **Step 1: Add auto-detection method**

```python
    async def detect_level(
        self, question: str, workspace_ids: list[uuid.UUID], db: AsyncSession
    ) -> RetrievalLevel:
        """Auto-detect the appropriate retrieval level for a question."""
        from app.services.embedding import embedding_service
        from app.models.graph import GraphEntity
        from sqlalchemy import select, func

        # Short questions with no domain terms -> CARD
        if len(question) < 10:
            return RetrievalLevel.CARD

        # Check if question contains known entity names
        if workspace_ids:
            # Quick check: embed question and compare to entity embeddings
            try:
                q_emb = await embedding_service.embed(question)
                result = await db.execute(
                    select(GraphEntity.name)
                    .where(GraphEntity.workspace_id.in_(workspace_ids))
                    .where(GraphEntity.embedding.isnot(None))
                    .order_by(GraphEntity.embedding.cosine_distance(q_emb))
                    .limit(1)
                )
                best_name = result.scalar_one_or_none()
                if best_name:
                    # Check if any word from question matches an entity
                    q_lower = question.lower()
                    if best_name.lower() in q_lower:
                        return RetrievalLevel.GRAPH
            except Exception:
                pass

        # Keywords that suggest deeper analysis
        deep_keywords = ["总结", "梳理", "关联", "对比", "分析", "关系", "结构", "整体", "全貌"]
        if any(kw in question for kw in deep_keywords):
            return RetrievalLevel.FULL

        # Default to GRAPH for substantive questions
        if len(question) >= 10:
            return RetrievalLevel.GRAPH

        return RetrievalLevel.CARD
```

- [ ] **Step 2: Update dispatch() to handle auto-detection**

Update `dispatch()` to call `detect_level` when level is passed as a special value. Add a class constant:

```python
class RetrievalDispatcher:
    """Unified retrieval dispatcher with 4-level depth."""

    AUTO_LEVEL = -1  # sentinel for auto-detection

    async def dispatch(
        self,
        question: str,
        level: RetrievalLevel | int,
        workspace_ids: list[uuid.UUID],
        db: AsyncSession,
        top_k: int = 5,
        card_id: str | None = None,
        chat_id: str | None = None,
    ) -> RetrievalResult:
        # Auto-detect level if requested
        if level == self.AUTO_LEVEL:
            level = await self.detect_level(question, workspace_ids, db)

        level = RetrievalLevel(level) if isinstance(level, int) else level
        # ... rest of dispatch
```

- [ ] **Step 3: Commit**

```bash
git add server/app/services/retrieval_dispatcher.py
git commit -m "feat(server): add auto-level detection for RetrievalDispatcher"
```

---

### Task 8: Frontend - Replace RAG/Chat toggle with depth selector

**Files:**
- Modify: `web/components/AiChatPanel.tsx`
- Modify: `web/lib/unified-ws.ts`

- [ ] **Step 1: Update RAGMessage interface in unified-ws.ts**

Add `retrieval_level` to the RAG message type:

```typescript
export interface RAGMessage {
  type: "rag";
  question: string;
  workspace_ids?: string[];
  card_id?: string;
  top_k?: number;
  web_search?: boolean;
  retrieval_level?: number;  // 0=FREE, 1=CARD, 2=GRAPH, 3=FULL, undefined=auto
  history?: Array<{ role: string; content: string }>;
}
```

- [ ] **Step 2: Add retrievalLevel state to AiChatPanel**

In `AiChatPanel.tsx`, replace the mode state with depth:

```typescript
// Replace:
// const [mode, setMode] = useState<ChatMode>("rag");

// With:
const [retrievalLevel, setRetrievalLevel] = useState<number | undefined>(undefined); // undefined = auto
```

Keep the `mode` state for now as a UI convenience, but the actual logic will use `retrievalLevel`.

- [ ] **Step 3: Add depth selector UI in the toolbar**

Replace the RAG/Chat toggle in the header with a depth selector dropdown. In the toolbar section (around lines 963-995), add after the fork toggle:

```tsx
{/* Depth selector */}
<div className="flex items-center gap-1">
  <Layers size={14} className="text-text-secondary" />
  <select
    value={retrievalLevel ?? ""}
    onChange={(e) => {
      const v = e.target.value;
      setRetrievalLevel(v === "" ? undefined : Number(v));
    }}
    className="rounded-md border border-border/30 bg-transparent px-1.5 py-0.5 text-[11px] text-text-secondary outline-none"
  >
    <option value="">自动</option>
    <option value="1">卡片</option>
    <option value="2">图谱</option>
    <option value="3">全量</option>
  </select>
</div>
```

Import `Layers` from lucide-react.

- [ ] **Step 4: Update doSend to use retrievalLevel**

In the RAG message sending section of `doSend()` (lines 422-432), add `retrieval_level`:

```typescript
wsClientRef.current.send({
  type: "rag",
  question: question,
  workspace_ids: globalRag ? undefined : [workspaceId],
  card_id: cardId,
  top_k: 5,
  web_search: webSearch,
  retrieval_level: retrievalLevel,
  history: hist,
});
```

- [ ] **Step 5: Update switchMode to handle the new depth model**

Update `switchMode` so that toggling to "自由对话" sets `retrievalLevel = 0` (FREE), and toggling to "知识问答" resets to `undefined` (auto).

Alternatively, if removing the mode toggle entirely: remove the mode toggle UI from the header and just use the depth selector. When `retrievalLevel = 0`, it's effectively "free chat". When `retrievalLevel` is undefined/1/2/3, it uses retrieval.

- [ ] **Step 6: Commit**

```bash
git add web/components/AiChatPanel.tsx web/lib/unified-ws.ts
git commit -m "feat(web): replace RAG/Chat toggle with depth selector"
```

---

### Task 9: Update WebSocket handler for retrieval_level

**Files:**
- Modify: `server/app/api/ws.py`

- [ ] **Step 1: Read retrieval_level from WS message and pass through**

In `server/app/api/ws.py`, find the RAG message handling section and add:

```python
    retrieval_level = msg.get("retrieval_level")
```

Pass this to the `handle_rag` function, which should forward it to `rag_service.ask_stream()`.

- [ ] **Step 2: Verify the full chain works**

Start the server and test:
1. Send a RAG message without `retrieval_level` → should default to GRAPH
2. Send with `retrieval_level: 0` → should use FREE (no retrieval)
3. Send with `retrieval_level: 2` → should use GRAPH
4. Send with `retrieval_level: 3` → should use FULL

- [ ] **Step 3: Commit**

```bash
git add server/app/api/ws.py
git commit -m "feat(server): wire retrieval_level through WebSocket handler"
```

---

### Task 10: Integration test - verify full pipeline

**Files:**
- Test manually via WebSocket or curl

- [ ] **Step 1: Start the backend**

Run: `cd server && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`

- [ ] **Step 2: Test Level 0 (FREE)**

Send a chat message (not RAG). Verify no card context is injected.

- [ ] **Step 3: Test Level 1 (CARD)**

Send a RAG message with `retrieval_level: 1`. Verify cards are retrieved and injected as context.

- [ ] **Step 4: Test Level 2 (GRAPH)**

Send a RAG message with `retrieval_level: 2`. Verify:
- Cards are retrieved
- If entities match the question, entity context is included in the system prompt
- The AI response references knowledge base concepts

- [ ] **Step 5: Test Level 3 (FULL)**

Send a RAG message with `retrieval_level: 3` and a valid `chat_id`. Verify:
- Everything from Level 2
- Topology path context is injected (if chat is bound to a tree node)
- Node card titles are included

- [ ] **Step 6: Test auto-detection**

Send a RAG message with `retrieval_level: undefined`. Verify the system auto-detects the appropriate level based on question content.

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration test fixes for RetrievalDispatcher"
```

---

## Self-Review Checklist

- [x] Spec section 3 (RetrievalDispatcher core) → Tasks 1-2
- [x] Spec section 4 (Level 0-3) → Tasks 2-4
- [x] Spec section 9 (Frontend depth selector) → Task 8
- [x] Entity context building → Tasks 3, 5
- [x] Topology context injection → Task 4
- [x] Auto-level detection → Task 7
- [x] WebSocket integration → Tasks 6, 9
- [x] RAGRequest schema update → Task 6
- [ ] Placeholder scan: No TBD/TODO found
- [ ] Type consistency: RetrievalLevel, RetrievalResult, EntityContext used consistently

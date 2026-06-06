import logging
import uuid

from sqlalchemy import or_, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.retrieval import EntityContext, RetrievalLevel, RetrievalResult

logger = logging.getLogger(__name__)


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
        """Route query through the appropriate retrieval strategy."""
        # Auto-detect level if requested
        if level == self.AUTO_LEVEL:
            level = await self.detect_level(question, workspace_ids, db)

        level = RetrievalLevel(level) if isinstance(level, int) else level

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

    # ── Level 1: Card retrieval ──────────────────────────────────────────

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

    # ── Level 2: Graph enhancement ───────────────────────────────────────

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
        from app.models.graph import GraphEntity

        # Step 1: Get card results (same as Level 1)
        card_result = await self._level_card(question, workspace_ids, db, top_k, card_id)

        # Step 2: Extract entities from question
        entities = await self._extract_entities(question)

        # Step 3: Match entities in graph
        entity_contexts: list[EntityContext] = []
        for ent_name in entities:
            matched = await self._match_entity(ent_name, workspace_ids, db)
            if matched:
                ctx = await self._build_entity_context(matched, db)
                entity_contexts.append(ctx)

        # Step 4: If no entity matches, try vector similarity on question
        if not entity_contexts:
            try:
                q_emb = await embedding_service.embed(question)
                result = await db.execute(
                    select(GraphEntity)
                    .where(GraphEntity.workspace_id.in_(workspace_ids))
                    .where(GraphEntity.embedding.isnot(None))
                    .order_by(GraphEntity.embedding.cosine_distance(q_emb))
                    .limit(3)
                )
                for ent in result.scalars().all():
                    ctx = await self._build_entity_context(ent, db)
                    entity_contexts.append(ctx)
            except Exception as e:
                logger.warning("Graph entity vector fallback failed: %s", e)

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
        except Exception as e:
            logger.warning("Entity extraction failed: %s", e)
            return []

    async def _match_entity(
        self, name: str, workspace_ids: list[uuid.UUID], db: AsyncSession
    ) -> "GraphEntity | None":
        """Match entity by exact name or embedding similarity."""
        from app.models.graph import GraphEntity
        from app.services.embedding import embedding_service

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
                dist_result = await db.execute(
                    select(GraphEntity.embedding.cosine_distance(emb))
                    .where(GraphEntity.id == best.id)
                )
                d = dist_result.scalar_one_or_none()
                if d is not None and d < 0.6:
                    return best
        except Exception as e:
            logger.warning("Entity embedding match failed: %s", e)
        return None

    async def _build_entity_context(
        self, entity: "GraphEntity", db: AsyncSession
    ) -> EntityContext:
        """Build entity context with relations and linked card titles."""
        from app.models.graph import GraphRelation, EntityCard, GraphEntity
        from app.models.card import Card

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
        rels = rels_result.scalars().all()
        # Batch-fetch all referenced entities to avoid N+1 queries
        all_entity_ids: set[uuid.UUID] = set()
        for rel in rels:
            all_entity_ids.add(rel.head_id)
            all_entity_ids.add(rel.tail_id)
        entity_map: dict[uuid.UUID, "GraphEntity"] = {}
        if all_entity_ids:
            fetched = await db.execute(select(GraphEntity).where(GraphEntity.id.in_(all_entity_ids)))
            entity_map = {e.id: e for e in fetched.scalars().all()}

        for rel in rels:
            head = entity_map.get(rel.head_id)
            tail = entity_map.get(rel.tail_id)
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

    # ── Level 3: Full awareness ──────────────────────────────────────────

    async def _level_full(
        self,
        question: str,
        workspace_ids: list[uuid.UUID],
        db: AsyncSession,
        top_k: int,
        card_id: str | None,
    ) -> RetrievalResult:
        """Level 3: Graph + topology path + topic context."""
        graph_result = await self._level_graph(question, workspace_ids, db, top_k, card_id)
        return RetrievalResult(
            cards=graph_result.cards,
            card_scores=graph_result.card_scores,
            entities=graph_result.entities,
            level_used=RetrievalLevel.FULL,
        )

    async def get_topology_context(
        self, chat_id: str, workspace_id: uuid.UUID, db: AsyncSession
    ) -> dict:
        """Get topology path context for a chat session."""
        from app.models.topology import NodeCard
        from app.models.card import Card
        from app.models.chat import AiChat

        chat_uuid = uuid.UUID(chat_id) if isinstance(chat_id, str) else chat_id

        # Walk up the parent_id chain to root
        ancestor_ids: list[uuid.UUID] = []
        current_id: uuid.UUID | None = chat_uuid
        max_depth = 20
        while current_id and max_depth > 0:
            max_depth -= 1
            node_result = await db.execute(
                select(AiChat).where(AiChat.id == current_id)
            )
            node = node_result.scalar_one_or_none()
            if not node:
                break
            ancestor_ids.append(node.id)
            current_id = node.parent_id

        # Fetch all ancestors in one query
        path = []
        if ancestor_ids:
            result = await db.execute(select(AiChat).where(AiChat.id.in_(ancestor_ids)))
            nodes_map = {n.id: n for n in result.scalars().all()}
            for aid in ancestor_ids:
                node = nodes_map.get(aid)
                if node:
                    path.append({
                        "node_id": str(node.id),
                        "title": node.title or "",
                        "summary": node.summary or "",
                    })

        path.reverse()  # root first

        # Get cards bound to current chat
        cards_result = await db.execute(
            select(Card.title)
            .join(NodeCard, NodeCard.card_id == Card.id)
            .where(NodeCard.chat_id == chat_uuid)
        )
        node_card_titles = [row[0] for row in cards_result.all() if row[0]]

        return {
            "path": path,
            "node_card_titles": node_card_titles,
            "cross_refs": [],
        }

    # ── Auto-level detection ─────────────────────────────────────────────

    async def detect_level(
        self, question: str, workspace_ids: list[uuid.UUID], db: AsyncSession
    ) -> RetrievalLevel:
        """Auto-detect the appropriate retrieval level for a question."""
        from app.services.embedding import embedding_service
        from app.models.graph import GraphEntity

        # Short questions with no domain terms -> CARD
        if len(question) < 10:
            return RetrievalLevel.CARD

        # Check if question contains known entity names
        if workspace_ids:
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
                    q_lower = question.lower()
                    if best_name.lower() in q_lower:
                        return RetrievalLevel.GRAPH
            except Exception as e:
                logger.warning("Auto-level entity detection failed: %s", e)

        # Keywords that suggest deeper analysis
        deep_keywords = ["总结", "梳理", "关联", "对比", "分析", "关系", "结构", "整体", "全貌"]
        if any(kw in question for kw in deep_keywords):
            return RetrievalLevel.FULL

        # Default to GRAPH for substantive questions
        if len(question) >= 10:
            return RetrievalLevel.GRAPH

        return RetrievalLevel.CARD

    # ── Context string builders ──────────────────────────────────────────

    @staticmethod
    def build_entity_context_string(result: RetrievalResult) -> str:
        """Build a human-readable entity context string for system prompt injection."""
        if not result.entities:
            return ""

        lines = ["知识库中的相关概念："]
        for ctx in result.entities:
            if ctx.relations:
                for rel in ctx.relations[:3]:
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


retrieval_dispatcher = RetrievalDispatcher()

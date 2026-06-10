import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.retrieval import ReasoningPathItem, RetrievalLevel, RetrievalResult

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
        logger.info("RetrievalDispatcher.dispatch: level=%s, question=%s, workspace_ids=%s, chat_id=%s",
                     level, question[:80], workspace_ids, chat_id)
        if level == self.AUTO_LEVEL:
            level = await self.detect_level(question, workspace_ids, db)

        level = RetrievalLevel(level) if isinstance(level, int) else level

        if level == RetrievalLevel.CHAT:
            return RetrievalResult(level_used=RetrievalLevel.CHAT)

        if level == RetrievalLevel.SEARCH:
            return await self._level_card(question, workspace_ids, db, top_k, card_id)

        if level == RetrievalLevel.EXPLORE:
            return await self._level_graph(question, workspace_ids, db, top_k, card_id)

        if level == RetrievalLevel.CONTEXT:
            result = await self._level_full(question, workspace_ids, db, top_k, card_id)
            if chat_id and workspace_ids:
                topo = await self.get_topology_context(chat_id, workspace_ids[0], db)
                result.topology_path = topo["path"]
                result.node_card_titles = topo["node_card_titles"]
                result.cross_refs = topo["cross_refs"]
            return result

        if level == RetrievalLevel.INSIGHT:
            return await self._level_global(question, workspace_ids, db)

        return RetrievalResult(level_used=RetrievalLevel.CHAT)

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
        from app.services.rag import rag_service
        from app.services.search import search_service

        if card_id:
            cards = await rag_service._find_similar_cards(db, card_id, top_k)
            return RetrievalResult(
                cards=cards,
                card_scores=[1.0] * len(cards),
                level_used=RetrievalLevel.SEARCH,
            )

        scored = await search_service.hybrid_search(db, question, workspace_ids, limit=top_k)
        return RetrievalResult(
            cards=[sc.card for sc in scored],
            card_scores=[sc.score for sc in scored],
            level_used=RetrievalLevel.SEARCH,
        )

    # ── Level 2: Graph traversal retrieval ──────────────────────────────

    async def _level_graph(
        self,
        question: str,
        workspace_ids: list[uuid.UUID],
        db: AsyncSession,
        top_k: int,
        card_id: str | None,
    ) -> RetrievalResult:
        """Level 2: Graph traversal — entity match → 1/2-hop scoring → card reranking.

        Uses graph_retriever for single-workspace queries. Falls back to CARD
        level when no workspace is available or graph yields no results.
        """
        from app.models.card import Card
        from app.services.gnn_retriever import graph_retriever

        # card_id mode: fall back to CARD (no graph context needed)
        if card_id or not workspace_ids:
            result = await self._level_card(question, workspace_ids, db, top_k, card_id)
            result.level_used = RetrievalLevel.EXPLORE
            return result

        workspace_id = workspace_ids[0]
        logger.info("RetrievalDispatcher._level_graph: calling graph_retriever.retrieve for workspace %s", workspace_id)
        graph_response = await graph_retriever.retrieve(question, workspace_id, db, k=top_k)
        logger.info("RetrievalDispatcher._level_graph: graph returned %d cards, mode=%s, %d reasoning paths",
                     len(graph_response.cards), graph_response.retrieval_mode, len(graph_response.reasoning_paths))

        # Convert GraphSearchResultCard → full Card objects
        cards: list[Card] = []
        scores: list[float] = []
        if graph_response.cards:
            card_ids = [c.id for c in graph_response.cards]
            result = await db.execute(select(Card).where(Card.id.in_(card_ids)))
            card_map = {c.id: c for c in result.scalars().all()}
            for gc in graph_response.cards:
                card = card_map.get(gc.id)
                if card:
                    cards.append(card)
                    scores.append(gc.score)

        # Fall back to hybrid search when graph finds nothing
        if not cards:
            fallback = await self._level_card(question, workspace_ids, db, top_k, card_id)
            fallback.level_used = RetrievalLevel.EXPLORE
            return fallback

        # Convert reasoning paths
        paths = [
            ReasoningPathItem(
                entities=p.entities,
                relations=p.relations,
                score=p.score,
            )
            for p in graph_response.reasoning_paths
        ]

        return RetrievalResult(
            cards=cards,
            card_scores=scores,
            reasoning_paths=paths,
            level_used=RetrievalLevel.EXPLORE,
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
        """Level 3: Graph retrieval + topology path context."""
        graph_result = await self._level_graph(question, workspace_ids, db, top_k, card_id)
        return RetrievalResult(
            cards=graph_result.cards,
            card_scores=graph_result.card_scores,
            reasoning_paths=graph_result.reasoning_paths,
            level_used=RetrievalLevel.CONTEXT,
        )

    async def _level_global(
        self,
        question: str,
        workspace_ids: list[uuid.UUID],
        db: AsyncSession,
    ) -> RetrievalResult:
        """Level 4: Map-Reduce over community reports for global/thematic questions."""
        import asyncio
        from app.models.graph import CommunityReport
        from app.services.llm import llm_service

        if not workspace_ids:
            return RetrievalResult(level_used=RetrievalLevel.INSIGHT)

        workspace_id = workspace_ids[0]

        # Load community reports
        result = await db.execute(
            select(CommunityReport)
            .where(CommunityReport.workspace_id == workspace_id)
            .order_by(CommunityReport.rating.desc())
        )
        reports = list(result.scalars().all())

        if not reports:
            logger.info("Global search: no community reports found, falling back to CARD")
            card_result = await self._level_card(question, workspace_ids, db, 5, None)
            card_result.level_used = RetrievalLevel.INSIGHT
            return card_result

        # ── Map phase: extract scored key points from each report ──
        map_system = (
            "你是一个知识分析专家。根据以下社区报告内容，提取与用户问题相关的关键信息点。\n"
            "每个信息点用 JSON 格式输出：\n"
            '{"points": [{"description": "信息点描述", "score": 1-10}]}\n'
            "只输出 JSON，不要解释。如果报告与问题无关，输出 {\"points\": []}"
        )

        sem = asyncio.Semaphore(3)

        async def _map_report(report: CommunityReport) -> list[dict]:
            async with sem:
                try:
                    user_content = (
                        f"社区主题：{report.title}\n"
                        f"摘要：{report.summary}\n"
                        f"发现：{', '.join(report.findings or [])}\n\n"
                        f"用户问题：{question}"
                    )
                    response = await llm_service.extraction_complete_simple(
                        system_prompt=map_system,
                        user_content=user_content,
                        max_tokens=512,
                        temperature=0.2,
                    )
                    if not response:
                        return []

                    import json
                    # Try to parse JSON from response
                    response = response.strip()
                    if response.startswith("```"):
                        response = response.split("```")[1]
                        if response.startswith("json"):
                            response = response[4:]
                    data = json.loads(response)
                    return data.get("points", [])
                except Exception as e:
                    logger.warning("Global map failed for report %s: %s", report.id, e)
                    return []

        all_points = await asyncio.gather(*[_map_report(r) for r in reports])

        # ── Collect and filter scored points ──
        scored_points: list[tuple[str, float]] = []
        for points in all_points:
            for p in points:
                desc = p.get("description", "")
                score = float(p.get("score", 0))
                if desc and score > 0:
                    scored_points.append((desc, score))

        scored_points.sort(key=lambda x: x[1], reverse=True)

        # ── Build community context string ──
        context_parts = [
            f"## 全局知识库分析（基于 {len(reports)} 个知识社区）\n"
        ]
        for desc, score in scored_points[:20]:
            context_parts.append(f"- [{score:.0f}/10] {desc}")

        community_context = "\n".join(context_parts)

        return RetrievalResult(
            community_context=community_context,
            level_used=RetrievalLevel.INSIGHT,
        )

    async def get_topology_context(
        self, chat_id: str, workspace_id: uuid.UUID, db: AsyncSession
    ) -> dict:
        """Get topology path context for a chat session."""
        from app.models.card import Card
        from app.models.chat import AiChat
        from app.models.topology import NodeCard

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

        cards_result = await db.execute(
            select(Card.title)
            .join(NodeCard, NodeCard.card_id == Card.id)
            .where(NodeCard.chat_id == chat_uuid)
        )
        node_card_titles = [row[0] for row in cards_result.all() if row[0]]

        # Cross-references: NodeRef where this node is source or target
        from app.models.topology import NodeRef

        cross_refs: list[dict] = []
        refs_result = await db.execute(
            select(NodeRef).where(
                (NodeRef.source_chat_id == chat_uuid) | (NodeRef.target_chat_id == chat_uuid)
            )
        )
        for ref in refs_result.scalars().all():
            other_id = ref.target_chat_id if ref.source_chat_id == chat_uuid else ref.source_chat_id
            other_node = await db.get(AiChat, other_id)
            if other_node:
                cross_refs.append({
                    "node_id": str(other_id),
                    "title": other_node.title or "",
                    "ref_type": ref.ref_type,
                    "reason": ref.reason or "",
                })

        return {
            "path": path,
            "node_card_titles": node_card_titles,
            "cross_refs": cross_refs,
        }

    # ── Auto-level detection ─────────────────────────────────────────────

    async def detect_level(
        self, question: str, workspace_ids: list[uuid.UUID], db: AsyncSession
    ) -> RetrievalLevel:
        """Auto-detect the appropriate retrieval level for a question."""
        # Short questions → CARD
        if len(question) < 10:
            return RetrievalLevel.SEARCH

        # Keywords suggesting broad/global synthesis → GLOBAL
        global_keywords = ["总览", "全局", "整体概况", "知识库", "所有主题", "涵盖"]
        if any(kw in question for kw in global_keywords):
            return RetrievalLevel.INSIGHT

        # Keywords suggesting cross-node synthesis → FULL
        deep_keywords = ["总结", "梳理", "关联", "对比", "分析", "关系", "结构", "整体", "全貌"]
        if any(kw in question for kw in deep_keywords):
            return RetrievalLevel.CONTEXT

        # Check if the question mentions known entity names → GRAPH
        if workspace_ids:
            from app.models.graph import GraphEntity
            from app.services.embedding import embedding_service
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
                if best_name and best_name.lower() in question.lower():
                    return RetrievalLevel.EXPLORE
            except Exception as e:
                logger.warning("Auto-level entity detection failed: %s", e)

        # Default substantive questions → CARD (not GRAPH, to avoid LLM NER overhead)
        return RetrievalLevel.SEARCH

    # ── Context string builders ──────────────────────────────────────────

    @staticmethod
    def build_entity_context_string(result: RetrievalResult) -> str:
        """Build reasoning path context string for system prompt injection."""
        if not result.reasoning_paths:
            return ""

        lines = ["知识图谱推理路径："]
        for path in result.reasoning_paths[:5]:
            if len(path.entities) >= 2 and path.relations:
                parts = [path.entities[0]]
                for rel, ent in zip(path.relations, path.entities[1:]):
                    parts.append(f"—[{rel}]→")
                    parts.append(ent)
                lines.append("- " + " ".join(parts))
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
                refs.append(f"{ref['title']}（关系：{ref['ref_type']}）")
            parts.append(f"相关分支：{', '.join(refs)}")

        return "\n".join(parts)


retrieval_dispatcher = RetrievalDispatcher()

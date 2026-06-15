import logging
import uuid

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.graph import EntityCard, GraphEntity, GraphRelation
from app.schemas.graph import (
    GraphSearchResponse,
    GraphSearchResultCard,
    ReasoningPath,
)
from app.services.embedding import embedding_service
from app.services.triple_extractor import triple_extractor

logger = logging.getLogger(__name__)


class GraphRetriever:
    """Graph-based retriever that traverses the knowledge graph for search.

    Falls back to embedding-based retrieval when no graph entities match.
    """

    async def retrieve(
        self, query: str, workspace_id: uuid.UUID, db: AsyncSession, k: int = 10
    ) -> GraphSearchResponse:
        """Retrieve cards via graph traversal, with embedding fallback."""
        logger.info("GraphRetriever.retrieve: query=%s, workspace=%s, k=%d", query[:80], workspace_id, k)

        query_entities = await triple_extractor.extract_entities_only(query)
        logger.info("GraphRetriever: extracted %d entities: %s", len(query_entities), [e.name for e in query_entities])

        if not query_entities:
            logger.info("GraphRetriever: no entities extracted, falling back to embedding")
            return await self._embedding_fallback(query, workspace_id, db, k)

        entity_names = [e.name for e in query_entities]
        query_embedding = await embedding_service.embed(query)
        logger.info("GraphRetriever: query embedded, dim=%d", len(query_embedding))

        matched_entities = await self._match_entities(
            entity_names, query_embedding, workspace_id, db
        )
        logger.info("GraphRetriever: matched %d entities: %s", len(matched_entities), [(m[1], m[2]) for m in matched_entities])

        if not matched_entities:
            logger.info("GraphRetriever: no entity matches in graph, falling back to embedding")
            return await self._embedding_fallback(query, workspace_id, db, k)

        # Build reasoning paths early so they are available for all paths
        reasoning_paths = await self._build_reasoning_paths(
            matched_entities, workspace_id, db
        )

        # Graph traversal: score cards via entity links and 1-hop neighbors
        card_scores = await self._collect_card_scores(
            matched_entities, workspace_id, db
        )

        top_cards = sorted(card_scores.items(), key=lambda x: x[1], reverse=True)[:k]
        result_cards: list[GraphSearchResultCard] = []
        for card_id, score in top_cards:
            card = await db.get(Card, card_id)
            if card:
                result_cards.append(
                    GraphSearchResultCard(
                        id=card.id,
                        title=card.title,
                        content_snippet=(
                            card.content[:200] if card.content else None
                        ),
                        score=round(score, 4),
                    )
                )

        return GraphSearchResponse(
            query=query,
            retrieval_mode="graph_traversal",
            reasoning_paths=reasoning_paths[:5],
            cards=result_cards,
        )

    async def _match_entities(
        self,
        entity_names: list[str],
        query_embedding: list[float],
        workspace_id: uuid.UUID,
        db: AsyncSession,
    ) -> list[tuple[uuid.UUID, str, float]]:
        """Match query entities against graph entities by name then embedding."""
        matched: list[tuple[uuid.UUID, str, float]] = []
        seen_ids: set[uuid.UUID] = set()
        for name in entity_names:
            # Exact (case-insensitive) name match
            exact = await db.execute(
                select(GraphEntity).where(
                    GraphEntity.workspace_id == workspace_id,
                    GraphEntity.name.ilike(name),
                )
            )
            entity = exact.scalar_one_or_none()
            if entity:
                if entity.id not in seen_ids:
                    logger.info("GraphRetriever._match: exact match '%s' -> '%s'", name, entity.name)
                    matched.append((entity.id, entity.name, 1.0))
                    seen_ids.add(entity.id)
                continue

            # Similarity-based match via embedding cosine distance
            count_result = await db.scalar(
                select(func.count())
                .select_from(GraphEntity)
                .where(GraphEntity.workspace_id == workspace_id)
            )
            logger.info("GraphRetriever._match: no exact match for '%s', workspace has %d entities", name, count_result or 0)
            if (count_result or 0) > 0:
                similar = await db.execute(
                    select(GraphEntity)
                    .where(GraphEntity.workspace_id == workspace_id)
                    .where(GraphEntity.embedding.isnot(None))
                    .order_by(
                        GraphEntity.embedding.cosine_distance(query_embedding)
                    )
                    .limit(3)
                )
                for candidate in similar.scalars().all():
                    if candidate.id in seen_ids:
                        continue
                    if candidate.embedding is not None:
                        sim = float(np.dot(query_embedding, candidate.embedding))
                        logger.info("GraphRetriever._match: embedding match '%s' (sim=%.4f)", candidate.name, sim)
                        if sim > 0.7:
                            matched.append((candidate.id, candidate.name, sim))
                            seen_ids.add(candidate.id)
                        else:
                            logger.info("GraphRetriever._match: sim %.4f below threshold 0.7, skipping", sim)
                    break
        return matched

    async def _collect_card_scores(
        self,
        matched_entities: list[tuple[uuid.UUID, str, float]],
        workspace_id: uuid.UUID,
        db: AsyncSession,
    ) -> dict[uuid.UUID, float]:
        """Aggregate card scores from direct entity links, 1-hop and 2-hop neighbors."""
        card_scores: dict[uuid.UUID, float] = {}

        # Direct entity-card links
        for entity_id, _, entity_score in matched_entities:
            result = await db.execute(
                select(EntityCard).where(EntityCard.entity_id == entity_id)
            )
            for link in result.scalars().all():
                card_scores[link.card_id] = (
                    card_scores.get(link.card_id, 0.0) + entity_score
                )

        # 1-hop neighbor entities -> their cards (weighted by relation strength)
        hop1_weights: dict[uuid.UUID, float] = {}  # entity_id -> score
        for entity_id, _, _ in matched_entities:
            out = await db.execute(
                select(GraphRelation).where(
                    GraphRelation.head_id == entity_id,
                    GraphRelation.workspace_id == workspace_id,
                )
            )
            for rel in out.scalars().all():
                score = rel.weight * 0.3
                prev = hop1_weights.get(rel.tail_id, 0.0)
                hop1_weights[rel.tail_id] = max(prev, score)

        if hop1_weights:
            result = await db.execute(
                select(EntityCard).where(EntityCard.entity_id.in_(hop1_weights.keys()))
            )
            for link in result.scalars().all():
                card_scores[link.card_id] = (
                    card_scores.get(link.card_id, 0.0) + hop1_weights.get(link.entity_id, 0.0)
                )

        # 2-hop neighbors with further decay (weight * 0.15)
        hop1_entity_ids = set(hop1_weights.keys()) - {eid for eid, _, _ in matched_entities}
        if hop1_entity_ids:
            hop2_weights: dict[uuid.UUID, float] = {}
            out2 = await db.execute(
                select(GraphRelation).where(
                    GraphRelation.head_id.in_(hop1_entity_ids),
                    GraphRelation.workspace_id == workspace_id,
                )
            )
            for rel in out2.scalars().all():
                base = hop1_weights.get(rel.head_id, 0.0)
                score = base * rel.weight * 0.5  # 2-hop decay
                if score > 0.02:  # Skip very weak connections
                    prev = hop2_weights.get(rel.tail_id, 0.0)
                    hop2_weights[rel.tail_id] = max(prev, score)

            # Exclude entities already covered by 0-hop and 1-hop
            covered = {eid for eid, _, _ in matched_entities} | set(hop1_weights.keys())
            new_entities = set(hop2_weights.keys()) - covered
            if new_entities:
                result2 = await db.execute(
                    select(EntityCard).where(EntityCard.entity_id.in_(new_entities))
                )
                for link in result2.scalars().all():
                    card_scores[link.card_id] = (
                        card_scores.get(link.card_id, 0.0) + hop2_weights.get(link.entity_id, 0.0)
                    )

        return card_scores

    async def _build_reasoning_paths(
        self,
        matched_entities: list[tuple[uuid.UUID, str, float]],
        workspace_id: uuid.UUID,
        db: AsyncSession,
    ) -> list[ReasoningPath]:
        """Construct 1-hop and 2-hop reasoning paths from matched entities."""
        paths: list[ReasoningPath] = []

        for entity_id, entity_name, score in matched_entities:
            out = await db.execute(
                select(GraphRelation)
                .where(
                    GraphRelation.head_id == entity_id,
                    GraphRelation.workspace_id == workspace_id,
                )
                .order_by(GraphRelation.weight.desc())
                .limit(3)
            )
            for rel in out.scalars().all():
                tail = await db.get(GraphEntity, rel.tail_id)
                if not tail:
                    continue

                # 2-hop: try to extend one more level
                inner_out = await db.execute(
                    select(GraphRelation)
                    .where(
                        GraphRelation.head_id == tail.id,
                        GraphRelation.workspace_id == workspace_id,
                    )
                    .order_by(GraphRelation.weight.desc())
                    .limit(2)
                )
                inner_rels = inner_out.scalars().all()
                has_inner = False
                for inner_rel in inner_rels:
                    inner_tail = await db.get(GraphEntity, inner_rel.tail_id)
                    if inner_tail:
                        paths.append(
                            ReasoningPath(
                                entities=[entity_name, tail.name, inner_tail.name],
                                relations=[rel.relation, inner_rel.relation],
                                score=round(score * 0.8, 4),
                            )
                        )
                        has_inner = True

                # 1-hop fallback (only when no 2-hop was found for this edge)
                if not has_inner:
                    paths.append(
                        ReasoningPath(
                            entities=[entity_name, tail.name],
                            relations=[rel.relation],
                            score=round(score * 0.9, 4),
                        )
                    )

        return paths[:5]

    async def _embedding_fallback(
        self,
        query: str,
        workspace_id: uuid.UUID,
        db: AsyncSession,
        k: int,
    ) -> GraphSearchResponse:
        """Fallback to pure embedding similarity when graph yields no matches."""
        logger.info("GraphRetriever._embedding_fallback: using pure embedding search, workspace=%s, k=%d", workspace_id, k)
        query_embedding = await embedding_service.embed(query)
        result = await db.execute(
            select(Card)
            .where(Card.workspace_id == workspace_id)
            .where(Card.embedding.isnot(None))
            .order_by(Card.embedding.cosine_distance(query_embedding))
            .limit(k)
        )
        cards: list[GraphSearchResultCard] = []
        for card in result.scalars().all():
            sim = (
                float(np.dot(query_embedding, card.embedding))
                if card.embedding is not None
                else 0.0
            )
            cards.append(
                GraphSearchResultCard(
                    id=card.id,
                    title=card.title,
                    content_snippet=(
                        card.content[:200] if card.content else None
                    ),
                    score=round(sim, 4),
                )
            )
        return GraphSearchResponse(
            query=query,
            retrieval_mode="embedding_fallback",
            reasoning_paths=[],
            cards=cards,
        )


graph_retriever = GraphRetriever()

import logging
import uuid

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.graph import GNNTrainingLog, EntityCard, GraphEntity, GraphRelation
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
        query_entities = await triple_extractor._extract_entities(query)
        if not query_entities:
            return await self._embedding_fallback(query, workspace_id, db, k)

        entity_names = [e.name for e in query_entities]
        query_embedding = await embedding_service.embed(query)

        matched_entities = await self._match_entities(
            entity_names, query_embedding, workspace_id, db
        )

        if not matched_entities:
            return await self._embedding_fallback(query, workspace_id, db, k)

        # Build reasoning paths early so they are available for all paths
        reasoning_paths = await self._build_reasoning_paths(
            matched_entities, workspace_id, db
        )

        # Try GNN retrieval first
        gnn_scores = await self._gnn_retrieve(
            matched_entities, workspace_id, db, query_embedding, k
        )

        if gnn_scores is not None:
            # Hybrid: GNN 60% + graph traversal 40%
            traversal_scores = await self._collect_card_scores(
                matched_entities, workspace_id, db
            )
            card_scores: dict[uuid.UUID, float] = {}
            for cid, s in gnn_scores.items():
                card_scores[cid] = card_scores.get(cid, 0.0) + s * 0.6
            for cid, s in traversal_scores.items():
                card_scores[cid] = card_scores.get(cid, 0.0) + s * 0.4

            top_cards = sorted(card_scores.items(), key=lambda x: x[1], reverse=True)[:k]
            result_cards: list[GraphSearchResultCard] = []
            for card_id, score in top_cards:
                card = await db.get(Card, card_id)
                if card:
                    result_cards.append(GraphSearchResultCard(
                        id=card.id,
                        title=card.title,
                        content_snippet=card.content[:200] if card.content else None,
                        score=round(score, 4),
                    ))

            return GraphSearchResponse(
                query=query,
                retrieval_mode="hybrid",
                reasoning_paths=reasoning_paths[:5],
                cards=result_cards,
            )

        # Fallback to pure graph traversal
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
                matched.append((entity.id, entity.name, 1.0))
                continue

            # Similarity-based match via embedding cosine distance
            count_result = await db.scalar(
                select(func.count())
                .select_from(GraphEntity)
                .where(GraphEntity.workspace_id == workspace_id)
            )
            if (count_result or 0) > 0:
                similar = await db.execute(
                    select(GraphEntity)
                    .where(GraphEntity.workspace_id == workspace_id)
                    .where(GraphEntity.embedding.isnot(None))
                    .order_by(
                        GraphEntity.embedding.cosine_distance(query_embedding)
                    )
                    .limit(1)
                )
                entity = similar.scalar_one_or_none()
                if entity and entity.embedding:
                    sim = float(np.dot(query_embedding, entity.embedding))
                    if sim > 0.7:
                        matched.append((entity.id, entity.name, sim))
        return matched

    async def _collect_card_scores(
        self,
        matched_entities: list[tuple[uuid.UUID, str, float]],
        workspace_id: uuid.UUID,
        db: AsyncSession,
    ) -> dict[uuid.UUID, float]:
        """Aggregate card scores from direct entity links and 1-hop neighbors."""
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

        # 1-hop neighbor entities -> their cards (lower weight)
        neighbor_ids: set[uuid.UUID] = set()
        for entity_id, _, _ in matched_entities:
            out = await db.execute(
                select(GraphRelation).where(
                    GraphRelation.head_id == entity_id,
                    GraphRelation.workspace_id == workspace_id,
                )
            )
            for rel in out.scalars().all():
                neighbor_ids.add(rel.tail_id)

        if neighbor_ids:
            result = await db.execute(
                select(EntityCard).where(EntityCard.entity_id.in_(neighbor_ids))
            )
            for link in result.scalars().all():
                card_scores[link.card_id] = (
                    card_scores.get(link.card_id, 0.0) + 0.3
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

    async def _load_checkpoint(self, workspace_id: uuid.UUID, db: AsyncSession) -> dict | None:
        """Load the latest completed GNN checkpoint for a workspace."""
        result = await db.execute(
            select(GNNTrainingLog)
            .where(
                GNNTrainingLog.workspace_id == workspace_id,
                GNNTrainingLog.status == "completed",
            )
            .order_by(GNNTrainingLog.created_at.desc())
            .limit(1)
        )
        log = result.scalar_one_or_none()
        if not log or not log.checkpoint_path:
            return None

        from pathlib import Path

        import torch

        from app.services.sage_model import SAGERetriever

        path = Path(log.checkpoint_path)
        if not path.exists():
            return None

        data = torch.load(path, map_location="cpu", weights_only=False)
        model = SAGERetriever(
            num_nodes=data["num_nodes"],
            num_relations=data["num_relations"],
            hidden_dim=data["hidden_dim"],
            num_layers=data["num_layers"],
        )
        model.load_state_dict(data["model_state_dict"])
        model.eval()

        entity_id_map = data["entity_id_map"]
        id_to_idx = {v: k for k, v in entity_id_map.items()}

        return {
            "model": model,
            "num_nodes": data["num_nodes"],
            "hidden_dim": data["hidden_dim"],
            "entity_id_map": entity_id_map,
            "id_to_idx": id_to_idx,
            "relation_type_map": data["relation_type_map"],
            "edge_index": data.get("edge_index"),
            "edge_type": data.get("edge_type"),
            "edge_weight": data.get("edge_weight"),
        }

    async def _gnn_retrieve(
        self,
        matched_entities: list[tuple[uuid.UUID, str, float]],
        workspace_id: uuid.UUID,
        db: AsyncSession,
        query_embedding: list[float],
        k: int,
    ) -> dict[uuid.UUID, float] | None:
        """Run GNN inference to score cards based on entity matches.

        Returns None when no trained model is available.
        """
        checkpoint = await self._load_checkpoint(workspace_id, db)
        if checkpoint is None:
            return None

        import torch

        id_to_idx = checkpoint["id_to_idx"]
        matched_indices: list[int] = []
        for entity_id, _, _ in matched_entities:
            if entity_id in id_to_idx:
                matched_indices.append(id_to_idx[entity_id])

        if not matched_indices:
            return None

        seed_mask = torch.zeros(checkpoint["num_nodes"])
        for idx in matched_indices:
            seed_mask[idx] = 1.0

        hidden_dim = checkpoint["hidden_dim"]
        if len(query_embedding) >= hidden_dim:
            query_tensor = torch.tensor(query_embedding[:hidden_dim], dtype=torch.float)
        else:
            query_tensor = torch.zeros(hidden_dim)
            query_tensor[: len(query_embedding)] = torch.tensor(
                query_embedding, dtype=torch.float
            )

        with torch.no_grad():
            scores = checkpoint["model"](
                checkpoint["edge_index"],
                checkpoint["edge_type"],
                checkpoint["edge_weight"],
                query_tensor,
                seed_mask,
            )

        entity_id_map = checkpoint["entity_id_map"]
        card_scores: dict[uuid.UUID, float] = {}
        for idx in range(checkpoint["num_nodes"]):
            entity_id = entity_id_map.get(idx)
            if entity_id is None:
                continue
            score = scores[idx].item()
            if score > 0.3:
                result = await db.execute(
                    select(EntityCard).where(EntityCard.entity_id == entity_id)
                )
                for link in result.scalars().all():
                    card_scores[link.card_id] = (
                        card_scores.get(link.card_id, 0.0) + score
                    )

        return card_scores

    async def _embedding_fallback(
        self,
        query: str,
        workspace_id: uuid.UUID,
        db: AsyncSession,
        k: int,
    ) -> GraphSearchResponse:
        """Fallback to pure embedding similarity when graph yields no matches."""
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
                if card.embedding
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

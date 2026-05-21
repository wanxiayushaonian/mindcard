import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.services.embedding import embedding_service

logger = logging.getLogger(__name__)


@dataclass
class ScoredCard:
    card: Card
    score: float


class SearchService:
    """Hybrid search: vector similarity + full-text search with RRF fusion."""

    async def vector_search(
        self, db: AsyncSession, query: str, workspace_id: str, limit: int = 20
    ) -> list[ScoredCard]:
        """Semantic search using pgvector cosine distance."""
        query_embedding = await embedding_service.embed(query)
        ws_uuid = uuid.UUID(workspace_id)

        # pgvector cosine distance: 0 = identical, 2 = opposite
        # cosine similarity = 1 - cosine_distance
        stmt = (
            select(Card)
            .where(Card.workspace_id == ws_uuid)
            .order_by(Card.embedding.cosine_distance(query_embedding))
            .limit(limit)
        )
        result = await db.execute(stmt)
        cards = result.scalars().all()

        # Approximate similarity score (cosine_distance returns 0-2, we want 0-1)
        scored = []
        for card in cards:
            if card.embedding is not None:
                dist = np_distance(card.embedding, query_embedding)
                score = 1.0 - dist / 2.0
            else:
                score = 0.0
            scored.append(ScoredCard(card=card, score=score))
        return scored

    async def fulltext_search(
        self, db: AsyncSession, query: str, workspace_id: str, limit: int = 20
    ) -> list[ScoredCard]:
        """Full-text search using PostgreSQL tsvector + ts_rank."""
        ws_uuid = uuid.UUID(workspace_id)
        ts_query = func.plainto_tsquery("chinese", query)

        stmt = (
            select(Card, func.ts_rank(Card.fts_vector, ts_query).label("rank"))
            .where(Card.workspace_id == ws_uuid)
            .where(Card.fts_vector.op("@@")(ts_query))
            .order_by(text("rank DESC"))
            .limit(limit)
        )
        result = await db.execute(stmt)
        rows = result.all()
        return [ScoredCard(card=row[0], score=float(row[1])) for row in rows]

    async def hybrid_search(
        self, db: AsyncSession, query: str, workspace_id: str, limit: int = 20
    ) -> list[ScoredCard]:
        """Hybrid search with Reciprocal Rank Fusion (RRF)."""
        vector_results = await self.vector_search(db, query, workspace_id, limit=limit * 2)
        fts_results = await self.fulltext_search(db, query, workspace_id, limit=limit * 2)

        # RRF: score = sum(1 / (k + rank_i)) for each result list
        k = 60  # RRF constant
        card_scores: dict[str, float] = {}
        card_map: dict[str, Card] = {}

        for rank, sc in enumerate(vector_results):
            card_id = str(sc.card.id)
            card_scores[card_id] = card_scores.get(card_id, 0) + 1.0 / (k + rank)
            card_map[card_id] = sc.card

        for rank, sc in enumerate(fts_results):
            card_id = str(sc.card.id)
            card_scores[card_id] = card_scores.get(card_id, 0) + 1.0 / (k + rank)
            card_map[card_id] = sc.card

        # Sort by RRF score descending
        sorted_ids = sorted(card_scores.keys(), key=lambda cid: card_scores[cid], reverse=True)
        return [
            ScoredCard(card=card_map[cid], score=card_scores[cid])
            for cid in sorted_ids[:limit]
        ]


def np_distance(embedding_a, embedding_b) -> float:
    """Compute cosine distance between two embeddings."""
    import numpy as np

    a = np.array(embedding_a)
    b = np.array(embedding_b)
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 2.0
    return 1.0 - dot / (norm_a * norm_b)


search_service = SearchService()

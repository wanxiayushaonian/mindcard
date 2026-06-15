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


def _ws_filter(workspace_ids: list[uuid.UUID] | None):
    """Return a workspace filter clause, or empty list for no filter."""
    if not workspace_ids:
        return []
    return [Card.workspace_id.in_(workspace_ids)]


class SearchService:
    """Hybrid search: vector similarity + full-text search with RRF fusion."""

    async def vector_search(
        self, db: AsyncSession, query: str, workspace_ids: list[uuid.UUID] | None = None, limit: int = 20
    ) -> list[ScoredCard]:
        """Semantic search using pgvector cosine distance.

        Two-path strategy:
        - Path A: query CardChunk embeddings (best chunk distance per card)
        - Path B: fallback to Card.embedding for cards that have no chunks
        Results are merged and returned sorted by score descending.
        """
        try:
            query_embedding = await embedding_service.embed(query)
        except Exception as e:
            logger.warning("Embedding failed, skipping vector search: %s", e)
            return []

        from app.models.card_chunk import CardChunk

        # ------------------------------------------------------------------
        # Path A: find best-matching chunk per card
        # ------------------------------------------------------------------
        chunk_stmt = (
            select(
                CardChunk.card_id,
                func.min(CardChunk.embedding.cosine_distance(query_embedding)).label("best_dist"),
            )
            .where(CardChunk.embedding.is_not(None))
            .group_by(CardChunk.card_id)
            .order_by("best_dist")
            .limit(limit)
        )
        if workspace_ids:
            chunk_stmt = chunk_stmt.join(Card, Card.id == CardChunk.card_id).where(
                Card.workspace_id.in_(workspace_ids)
            )

        chunk_result = await db.execute(chunk_stmt)
        chunk_rows = chunk_result.all()  # list of Row(card_id, best_dist)

        chunked_card_ids: set[uuid.UUID] = {row.card_id for row in chunk_rows}

        scored: list[ScoredCard] = []
        if chunked_card_ids:
            card_stmt = select(Card).where(Card.id.in_(chunked_card_ids))
            card_result = await db.execute(card_stmt)
            card_by_id: dict[uuid.UUID, Card] = {c.id: c for c in card_result.scalars().all()}
            for row in chunk_rows:
                card = card_by_id.get(row.card_id)
                if card:
                    dist = float(row.best_dist) if row.best_dist is not None else 2.0
                    scored.append(ScoredCard(card=card, score=1.0 - dist / 2.0))

        # ------------------------------------------------------------------
        # Path B: fallback for cards that have no chunk rows
        # ------------------------------------------------------------------
        fallback_limit = limit - len(scored)
        if fallback_limit > 0:
            fb_stmt = select(Card).where(Card.embedding.is_not(None))
            for f in _ws_filter(workspace_ids):
                fb_stmt = fb_stmt.where(f)
            if chunked_card_ids:
                fb_stmt = fb_stmt.where(Card.id.not_in(chunked_card_ids))
            fb_stmt = fb_stmt.order_by(Card.embedding.cosine_distance(query_embedding)).limit(fallback_limit)
            fb_result = await db.execute(fb_stmt)
            for card in fb_result.scalars().all():
                dist = np_distance(card.embedding, query_embedding)
                scored.append(ScoredCard(card=card, score=1.0 - dist / 2.0))

        # Sort combined results by score descending, return top `limit`
        scored.sort(key=lambda x: x.score, reverse=True)
        return scored[:limit]

    _fts_extension_available: bool | None = None  # Cache extension check

    async def fulltext_search(
        self, db: AsyncSession, query: str, workspace_ids: list[uuid.UUID] | None = None, limit: int = 20
    ) -> list[ScoredCard]:
        """Full-text search using PostgreSQL tsvector + ts_rank, with ILIKE fallback."""
        # Try tsvector search first (requires zhparser/pg_jieba extension)
        if self._fts_extension_available is not False:
            try:
                ts_query = func.plainto_tsquery("chinese", query)
                stmt = select(Card, func.ts_rank(Card.fts_vector, ts_query).label("rank"))
                for f in _ws_filter(workspace_ids):
                    stmt = stmt.where(f)
                stmt = stmt.where(Card.fts_vector.op("@@")(ts_query)).order_by(text("rank DESC")).limit(limit)
                result = await db.execute(stmt)
                rows = result.all()
                if self._fts_extension_available is None:
                    self._fts_extension_available = True
                return [ScoredCard(card=row[0], score=float(row[1])) for row in rows]
            except Exception as e:
                if self._fts_extension_available is None:
                    logger.warning(
                        "Chinese full-text search unavailable (missing zhparser/pg_jieba extension?), "
                        "falling back to ILIKE. Error: %s", e
                    )
                self._fts_extension_available = False

        # Fallback: simple ILIKE search
        ilike_pattern = f"%{query}%"
        stmt = select(Card)
        for f in _ws_filter(workspace_ids):
            stmt = stmt.where(f)
        stmt = stmt.where(Card.title.ilike(ilike_pattern) | Card.content.ilike(ilike_pattern)).limit(limit)
        result = await db.execute(stmt)
        cards = result.scalars().all()
        return [ScoredCard(card=c, score=0.5) for c in cards]

    async def hybrid_search(
        self, db: AsyncSession, query: str, workspace_ids: list[uuid.UUID] | None = None, limit: int = 20
    ) -> list[ScoredCard]:
        """Hybrid search with Reciprocal Rank Fusion (RRF)."""
        vector_results = await self.vector_search(db, query, workspace_ids, limit=limit * 2)
        fts_results = await self.fulltext_search(db, query, workspace_ids, limit=limit * 2)

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

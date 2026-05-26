import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card, CardRelation
from app.services.embedding import embedding_service

logger = logging.getLogger(__name__)


class RecommendationService:
    """Card recommendation using vector similarity (replaces utils/agent.js)."""

    async def find_recommendations(
        self, db: AsyncSession, card_id: str, limit: int = 5
    ) -> list[dict]:
        """Find recommended cards for a given card.

        Returns list of {card: Card, score: float, relation_type: str}.
        Score is cosine similarity when embeddings are available,
        keyword overlap (Jaccard) otherwise.
        """
        card = await db.get(Card, uuid.UUID(card_id))
        if not card:
            return []

        # Get existing relations to exclude
        existing_result = await db.execute(
            select(CardRelation.related_card_id).where(CardRelation.card_id == card.id)
        )
        existing_ids = {row[0] for row in existing_result.all()}

        # Find similar cards by vector similarity
        if card.embedding is not None:
            dist_expr = Card.embedding.cosine_distance(card.embedding)
            result = await db.execute(
                select(Card, dist_expr.label("distance"))
                .where(Card.workspace_id == card.workspace_id)
                .where(Card.id != card.id)
                .where(Card.id.notin_(existing_ids))
                .order_by(dist_expr)
                .limit(limit)
            )
            rows = result.all()
            recommendations = []
            for c, distance in rows:
                # cosine_distance: 0 = identical, 2 = opposite → similarity = 1 - dist/2
                score = max(0.0, 1.0 - float(distance) / 2.0)
                recommendations.append({
                    "card": c,
                    "score": round(score, 4),
                    "relation_type": "agent",
                })
            return recommendations
        else:
            # Fallback: keyword overlap for both sorting and scoring
            result = await db.execute(
                select(Card)
                .where(Card.workspace_id == card.workspace_id)
                .where(Card.id != card.id)
                .where(Card.id.notin_(existing_ids))
                .limit(limit * 3)  # Fetch more, then sort by keyword overlap
            )
            candidates = result.scalars().all()
            scored = [
                (c, self._keyword_overlap(card.keywords, c.keywords))
                for c in candidates
            ]
            scored.sort(key=lambda x: x[1], reverse=True)
            return [
                {
                    "card": c,
                    "score": round(score, 4),
                    "relation_type": "agent",
                }
                for c, score in scored[:limit]
            ]

    @staticmethod
    def _keyword_overlap(kw1: list[str], kw2: list[str]) -> float:
        """Jaccard similarity of keyword sets (fallback when no embedding)."""
        if not kw1 or not kw2:
            return 0.0
        set1, set2 = set(kw1), set(kw2)
        intersection = len(set1 & set2)
        union = len(set1 | set2)
        return intersection / union if union > 0 else 0.0


recommendation_service = RecommendationService()

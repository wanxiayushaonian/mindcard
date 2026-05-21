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
        This replaces the Jaccard keyword similarity in agent.js.
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
            result = await db.execute(
                select(Card)
                .where(Card.workspace_id == card.workspace_id)
                .where(Card.id != card.id)
                .where(Card.id.notin_(existing_ids))
                .order_by(Card.embedding.cosine_distance(card.embedding))
                .limit(limit)
            )
        else:
            # Fallback: keyword overlap
            result = await db.execute(
                select(Card)
                .where(Card.workspace_id == card.workspace_id)
                .where(Card.id != card.id)
                .where(Card.id.notin_(existing_ids))
                .limit(limit)
            )

        candidates = result.scalars().all()

        recommendations = []
        for c in candidates:
            # Calculate a simple score
            score = self._keyword_overlap(card.keywords, c.keywords)
            recommendations.append({
                "card": c,
                "score": score,
                "relation_type": "agent",
            })

        return recommendations

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

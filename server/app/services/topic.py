import logging
import uuid
from collections import Counter
from datetime import datetime, timezone

import numpy as np
from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.topic import Topic, TopicCard

logger = logging.getLogger(__name__)


class TopicService:
    async def assign_card_to_topic(self, db: AsyncSession, card: Card):
        """Assign a card to the nearest topic, or create a new one."""
        if not card.embedding:
            logger.warning("Card %s has no embedding, skipping topic assignment", card.id)
            return

        # Serialize per-workspace to prevent race conditions
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:ws_id))"),
            {"ws_id": str(card.workspace_id)},
        )

        # Find nearest topic using pgvector index
        result = await db.execute(
            select(Topic)
            .where(Topic.workspace_id == card.workspace_id)
            .where(Topic.centroid.isnot(None))
            .order_by(Topic.centroid.cosine_distance(card.embedding))
            .limit(1)
        )
        best_topic = result.scalar_one_or_none()

        if best_topic:
            dist = self._cosine_distance(card.embedding, best_topic.centroid)
        else:
            dist = 1.0

        threshold = await self._compute_adaptive_threshold(db, card.workspace_id)

        if best_topic and dist < threshold:
            # Merge into existing topic (ON CONFLICT handles re-assignment)
            stmt = pg_insert(TopicCard).values(topic_id=best_topic.id, card_id=card.id)
            stmt = stmt.on_conflict_do_update(
                index_elements=["card_id"],
                set_={"topic_id": best_topic.id, "created_at": datetime.now(timezone.utc)},
            )
            await db.execute(stmt)
            best_topic.card_count = await self._count_members(db, best_topic.id)
            best_topic.updated_at = datetime.now(timezone.utc)
            await db.flush()
            await self._recalculate_centroid(db, best_topic.id)
            await self._generate_topic_name(db, best_topic.id)
            logger.info(
                "Card %s assigned to topic %s (dist=%.4f, threshold=%.4f)",
                card.id, best_topic.id, dist, threshold,
            )
        else:
            await self._create_topic(db, card)
            logger.info("Card %s created new topic (best_dist=%.4f, threshold=%.4f)", card.id, dist, threshold)

    async def rebuild_topics(self, db: AsyncSession, workspace_id: uuid.UUID):
        """Full rebuild of topics for a workspace. Does NOT commit — caller must commit."""
        # Delete existing
        topics_result = await db.execute(select(Topic.id).where(Topic.workspace_id == workspace_id))
        topic_ids = [row[0] for row in topics_result.all()]
        if topic_ids:
            await db.execute(delete(TopicCard).where(TopicCard.topic_id.in_(topic_ids)))
            await db.execute(delete(Topic).where(Topic.id.in_(topic_ids)))
            await db.flush()

        # Load all cards with embeddings
        cards_result = await db.execute(
            select(Card)
            .where(Card.workspace_id == workspace_id)
            .where(Card.embedding.isnot(None))
            .order_by(Card.created_at.asc())
        )
        cards = list(cards_result.scalars().all())
        logger.info("Rebuilding topics for workspace %s: %d cards", workspace_id, len(cards))

        if not cards:
            return

        # Compute threshold once
        threshold = self._compute_threshold_from_embeddings([c.embedding for c in cards])

        # Greedy clustering in Python
        topics_data: list[dict] = []  # {topic_id, centroid, card_ids}

        for card in cards:
            best_idx = -1
            best_dist = 1.0
            for i, t in enumerate(topics_data):
                dist = self._cosine_distance(card.embedding, t["centroid"])
                if dist < best_dist:
                    best_dist = dist
                    best_idx = i

            if best_idx >= 0 and best_dist < threshold:
                # Merge
                topics_data[best_idx]["card_ids"].append(card.id)
                # Update centroid incrementally
                n = len(topics_data[best_idx]["card_ids"])
                old = np.array(topics_data[best_idx]["centroid"], dtype=np.float32)
                new_emb = np.array(card.embedding, dtype=np.float32)
                updated = old * ((n - 1) / n) + new_emb * (1 / n)
                norm = np.linalg.norm(updated)
                if norm > 0:
                    updated = updated / norm
                topics_data[best_idx]["centroid"] = updated.tolist()
            else:
                topics_data.append({
                    "topic_id": uuid.uuid4(),
                    "centroid": card.embedding,
                    "card_ids": [card.id],
                })

        # Bulk create topics and topic_cards
        for t in topics_data:
            name = await self._generate_topic_name_from_cards(db, t["card_ids"])
            topic = Topic(
                id=t["topic_id"],
                workspace_id=workspace_id,
                name=name,
                centroid=t["centroid"],
                card_count=len(t["card_ids"]),
            )
            db.add(topic)
            for card_id in t["card_ids"]:
                tc = TopicCard(topic_id=t["topic_id"], card_id=card_id)
                db.add(tc)

        await db.flush()
        logger.info("Rebuild complete: %d topics from %d cards", len(topics_data), len(cards))

    async def _create_topic(self, db: AsyncSession, card: Card):
        """Create a new topic from a single card."""
        topic = Topic(
            id=uuid.uuid4(),
            workspace_id=card.workspace_id,
            name=self._keywords_to_name(card.keywords),
            centroid=card.embedding,
            card_count=1,
        )
        db.add(topic)
        await db.flush()

        stmt = pg_insert(TopicCard).values(topic_id=topic.id, card_id=card.id)
        stmt = stmt.on_conflict_do_nothing(index_elements=["card_id"])
        await db.execute(stmt)
        await db.flush()

    async def _recalculate_centroid(self, db: AsyncSession, topic_id: uuid.UUID):
        """Recalculate topic centroid as mean of member embeddings, L2 normalized."""
        result = await db.execute(
            select(Card.embedding)
            .join(TopicCard, TopicCard.card_id == Card.id)
            .where(TopicCard.topic_id == topic_id)
            .where(Card.embedding.isnot(None))
        )
        embeddings = [row[0] for row in result.all()]
        if not embeddings:
            return

        arr = np.array(embeddings, dtype=np.float32)
        mean = arr.mean(axis=0)
        norm = np.linalg.norm(mean)
        if norm > 0:
            mean = mean / norm

        topic = await db.get(Topic, topic_id)
        if topic:
            topic.centroid = mean.tolist()
            topic.updated_at = datetime.now(timezone.utc)
            await db.flush()

    async def _generate_topic_name(self, db: AsyncSession, topic_id: uuid.UUID):
        """Generate topic name from top keywords of member cards."""
        result = await db.execute(
            select(Card.keywords)
            .join(TopicCard, TopicCard.card_id == Card.id)
            .where(TopicCard.topic_id == topic_id)
        )
        all_keywords: list[str] = []
        for row in result.all():
            if row[0]:
                all_keywords.extend(row[0])

        name = self._keywords_to_name(all_keywords)
        topic = await db.get(Topic, topic_id)
        if topic:
            topic.name = name
            await db.flush()

    async def _generate_topic_name_from_cards(self, db: AsyncSession, card_ids: list[uuid.UUID]) -> str:
        """Generate topic name from keywords of given cards."""
        result = await db.execute(select(Card.keywords).where(Card.id.in_(card_ids)))
        all_keywords: list[str] = []
        for row in result.all():
            if row[0]:
                all_keywords.extend(row[0])
        return self._keywords_to_name(all_keywords)

    async def _count_members(self, db: AsyncSession, topic_id: uuid.UUID) -> int:
        """Count members of a topic."""
        result = await db.execute(
            select(TopicCard.card_id).where(TopicCard.topic_id == topic_id)
        )
        return len(result.all())

    async def _compute_adaptive_threshold(self, db: AsyncSession, workspace_id: uuid.UUID) -> float:
        """Compute adaptive threshold based on pairwise similarity distribution."""
        result = await db.execute(
            select(Card.embedding)
            .where(Card.workspace_id == workspace_id)
            .where(Card.embedding.isnot(None))
            .limit(30)
        )
        embeddings = [row[0] for row in result.all()]
        return self._compute_threshold_from_embeddings(embeddings)

    @staticmethod
    def _compute_threshold_from_embeddings(embeddings: list[list[float]]) -> float:
        """Compute threshold from a list of embeddings."""
        if len(embeddings) < 5:
            return 0.45

        arr = np.array(embeddings, dtype=np.float32)
        distances: list[float] = []
        n = min(len(arr), 20)
        for i in range(n):
            for j in range(i + 1, n):
                dist = 1.0 - float(np.dot(arr[i], arr[j]))
                distances.append(dist)

        if not distances:
            return 0.45

        median_dist = float(np.median(distances))
        threshold = median_dist * 0.7
        return max(0.2, min(threshold, 0.6))

    @staticmethod
    def _cosine_distance(a: list[float], b: list[float]) -> float:
        """Cosine distance between two (assumed normalized) vectors."""
        arr_a = np.array(a, dtype=np.float32)
        arr_b = np.array(b, dtype=np.float32)
        return float(1.0 - np.dot(arr_a, arr_b))

    @staticmethod
    def _keywords_to_name(keywords: list[str]) -> str:
        """Convert keywords list to a topic name."""
        if not keywords:
            return "未分类"
        counter = Counter(keywords)
        top_kws = [kw for kw, _ in counter.most_common(3)]
        return " / ".join(top_kws)


topic_service = TopicService()

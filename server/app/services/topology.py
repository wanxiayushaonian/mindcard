"""Topology auto-classification service.

Automatically assigns cards to the most relevant tree node (AiChat) based on
embedding similarity, and maintains node centroids.
"""

import logging
import uuid
from datetime import datetime, timezone

import numpy as np
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.chat import AiChat
from app.models.topology import NodeCard
from app.services.embedding import embedding_service

logger = logging.getLogger(__name__)

# Cosine distance threshold: cards closer than this merge into an existing node.
# Higher = more permissive (cards more likely to merge).
AUTO_CLASSIFY_THRESHOLD = 0.55


class TopologyService:
    """Auto-classify cards into the topology tree."""

    async def assign_card_to_node(
        self, db: AsyncSession, card: Card, default_node_id: uuid.UUID | None = None
    ):
        """Find the best-matching tree node (AiChat) for a card and attach it.

        If default_node_id is provided, checks similarity with that node first.
        Only assigns to default node if similarity > 0.7 (or if embeddings are missing).
        Otherwise falls back to embedding-based search.

        Skips the root node — only matches against branch/leaf nodes that
        have an embedding (i.e., nodes with at least one card already).
        Falls back to attaching to root if no good match is found.
        """
        # Serialize per-workspace
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:ws_id))"),
            {"ws_id": str(card.workspace_id)},
        )

        # Find the root node (AiChat with parent_id=None) for this workspace
        root_result = await db.execute(
            select(AiChat)
            .where(AiChat.workspace_id == card.workspace_id)
            .where(AiChat.parent_id.is_(None))
            .limit(1)
        )
        root_node = root_result.scalar_one_or_none()

        # Ensure root exists
        if not root_node:
            root_node = AiChat(
                id=uuid.uuid4(),
                local_id=f"root-{card.workspace_id}",
                workspace_id=card.workspace_id,
                user_id=card.creator_id,
                node_type="root",
                title="主线",
                mode="rag",
            )
            db.add(root_node)
            await db.flush()

        # Handle default_node_id if provided
        if default_node_id:
            default_node_result = await db.execute(
                select(AiChat).where(AiChat.id == default_node_id)
            )
            default_node = default_node_result.scalar_one_or_none()

            if default_node:
                # If both card and default node have embeddings, check similarity
                if default_node.embedding and card.embedding:
                    similarity = 1.0 - self._cosine_distance(card.embedding, default_node.embedding)
                    if similarity > 0.7:
                        # High similarity - assign to default node
                        existing = await db.execute(
                            select(NodeCard).where(
                                NodeCard.chat_id == default_node.id,
                                NodeCard.card_id == card.id,
                            )
                        )
                        if not existing.scalar_one_or_none():
                            db.add(NodeCard(chat_id=default_node.id, card_id=card.id))
                            await db.flush()
                            await self._recalculate_node_centroid(db, default_node.id)
                            logger.info(
                                "Card %s assigned to default node %s '%s' (similarity=%.4f)",
                                card.id, default_node.id, default_node.title, similarity,
                            )
                        return
                    # Similarity too low - fall through to embedding-based search
                else:
                    # Missing embeddings - assign directly to default node
                    existing = await db.execute(
                        select(NodeCard).where(
                            NodeCard.chat_id == default_node.id,
                            NodeCard.card_id == card.id,
                        )
                    )
                    if not existing.scalar_one_or_none():
                        db.add(NodeCard(chat_id=default_node.id, card_id=card.id))
                        await db.flush()
                        await self._recalculate_node_centroid(db, default_node.id)
                        logger.info(
                            "Card %s assigned to default node %s '%s' (no embeddings)",
                            card.id, default_node.id, default_node.title,
                        )
                    return

        # Fall through to embedding-based assignment
        if not card.embedding:
            # No embedding - assign to root as fallback
            logger.info(
                f"Card {card.id} has no embedding, assigning to root node {root_node.id}"
            )
            existing = await db.execute(
                select(NodeCard).where(
                    NodeCard.chat_id == root_node.id,
                    NodeCard.card_id == card.id,
                )
            )
            if not existing.scalar_one_or_none():
                db.add(NodeCard(chat_id=root_node.id, card_id=card.id))
                await db.flush()
            return

        # Find best matching non-root node with embedding
        result = await db.execute(
            select(AiChat)
            .where(AiChat.workspace_id == card.workspace_id)
            .where(AiChat.id != root_node.id)
            .where(AiChat.embedding.isnot(None))
            .where(AiChat.chat_status != "archived")
            .order_by(AiChat.embedding.cosine_distance(card.embedding))
            .limit(1)
        )
        best_node = result.scalar_one_or_none()

        if best_node:
            dist = self._cosine_distance(card.embedding, best_node.embedding)
        else:
            dist = 1.0

        target_node = best_node if best_node and dist < AUTO_CLASSIFY_THRESHOLD else root_node

        # Check if card is already associated with the target node
        existing = await db.execute(
            select(NodeCard).where(
                NodeCard.chat_id == target_node.id,
                NodeCard.card_id == card.id,
            )
        )
        if existing.scalar_one_or_none():
            return

        # Attach card to node
        db.add(NodeCard(chat_id=target_node.id, card_id=card.id))
        await db.flush()

        # Recalculate the node's centroid
        await self._recalculate_node_centroid(db, target_node.id)

        logger.info(
            "Card %s auto-classified to node %s '%s' (dist=%.4f)",
            card.id, target_node.id, target_node.title, dist,
        )

    async def _recalculate_node_centroid(self, db: AsyncSession, node_id: uuid.UUID):
        """Recalculate a tree node's centroid as the mean of its card embeddings."""
        result = await db.execute(
            select(Card.embedding)
            .join(NodeCard, NodeCard.card_id == Card.id)
            .where(NodeCard.chat_id == node_id)
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

        node = await db.get(AiChat, node_id)
        if node:
            node.embedding = mean.tolist()
            node.updated_at = datetime.now(timezone.utc)
            await db.flush()

    async def auto_bind_chat_to_node(
        self, db: AsyncSession, chat: AiChat, first_message: str
    ) -> None:
        """Find or set parent_id on an AiChat based on the first message.

        Embeds the first message, finds the best-matching non-root node in the
        workspace, and sets chat.parent_id if similarity >= 0.7.  Otherwise
        attaches the chat under the root node (creating root if needed).
        """
        if not first_message:
            return

        workspace_id = chat.workspace_id
        if not workspace_id:
            return

        query_embedding = await embedding_service.embed(first_message)
        if not query_embedding:
            return

        # Find best matching non-root node with embedding
        stmt = (
            select(AiChat)
            .where(AiChat.workspace_id == workspace_id)
            .where(AiChat.node_type != "root")
            .where(AiChat.embedding.isnot(None))
            .where(AiChat.chat_status != "archived")
            .where(AiChat.id != chat.id)  # exclude self
            .order_by(AiChat.embedding.cosine_distance(query_embedding))
            .limit(1)
        )
        result = await db.execute(stmt)
        best_node = result.scalar_one_or_none()

        if best_node:
            dist = self._cosine_distance(query_embedding, best_node.embedding)
            similarity = 1.0 - dist
            if similarity >= 0.7:
                chat.parent_id = best_node.id
                chat.node_type = "leaf"
                chat.embedding = query_embedding
                chat.updated_at = datetime.now(timezone.utc)
                await db.flush()
                logger.info(
                    "Chat %s auto-bound to node %s '%s' (similarity=%.4f)",
                    chat.id, best_node.id, best_node.title, similarity,
                )
                return

        # No good match — attach under root (create root if needed)
        root_stmt = select(AiChat).where(
            AiChat.workspace_id == workspace_id,
            AiChat.node_type == "root",
        )
        root_result = await db.execute(root_stmt)
        root = root_result.scalar_one_or_none()

        if not root:
            root = AiChat(
                id=uuid.uuid4(),
                local_id=f"root-{workspace_id}",
                workspace_id=workspace_id,
                user_id=chat.user_id,
                node_type="root",
                title="主线",
                mode="rag",
            )
            db.add(root)
            await db.flush()

        chat.parent_id = root.id
        chat.node_type = "leaf"
        chat.embedding = query_embedding
        chat.updated_at = datetime.now(timezone.utc)
        await db.flush()

    async def rebuild_node_embeddings(self, db: AsyncSession, workspace_id: uuid.UUID):
        """Rebuild centroids for all tree nodes (AiChats) in a workspace."""
        result = await db.execute(
            select(AiChat).where(AiChat.workspace_id == workspace_id)
        )
        nodes = list(result.scalars().all())

        for node in nodes:
            await self._recalculate_node_centroid(db, node.id)

        logger.info("Rebuilt embeddings for %d nodes in workspace %s", len(nodes), workspace_id)

    async def mark_core_entities(self, db: AsyncSession, node_id: uuid.UUID) -> None:
        """Mark top-3 entities by frequency as core entities for a topology node."""
        from collections import Counter

        from sqlalchemy import update as sa_update

        from app.models.graph import EntityCard

        # Get cards assigned to this node
        cards_result = await db.execute(
            select(NodeCard).where(NodeCard.chat_id == node_id)
        )
        node_cards = cards_result.scalars().all()
        if not node_cards:
            return

        entity_freq: Counter = Counter()
        for nc in node_cards:
            ec_result = await db.execute(
                select(EntityCard).where(EntityCard.card_id == nc.card_id)
            )
            for ec in ec_result.scalars().all():
                entity_freq[ec.entity_id] += 1

        core_ids = [eid for eid, _ in entity_freq.most_common(3)]
        if core_ids:
            await db.execute(
                sa_update(AiChat)
                .where(AiChat.id == node_id)
                .values(core_entity_ids=core_ids)
            )
            await db.flush()

    async def update_node_summary_from_chat(
        self, db: AsyncSession, chat_id: str
    ) -> None:
        """Generate and update node summary from recent chat messages."""
        from app.models.chat import ChatMessage

        chat = await db.get(AiChat, chat_id)
        if not chat:
            return

        # Get last few messages
        result = await db.execute(
            select(ChatMessage)
            .where(ChatMessage.chat_id == chat_id)
            .where(ChatMessage.role.in_(["user", "assistant"]))
            .order_by(ChatMessage.created_at.desc())
            .limit(6)
        )
        messages = list(reversed(result.scalars().all()))
        if not messages:
            return

        # Build context for summary
        context = "\n".join(
            f"{'用户' if m.role == 'user' else 'AI'}: {m.content[:200]}"
            for m in messages
        )

        prompt = f"""请用50-100字总结以下对话的核心主题和关键发现：

{context}

只输出总结，不要其他内容。"""

        from app.services.llm import llm_service

        response = await llm_service.complete([{"role": "user", "content": prompt}])

        chat.summary = response.content.strip()
        await db.flush()

    @staticmethod
    def _cosine_distance(a: list[float], b: list[float]) -> float:
        """Cosine distance between two (assumed normalized) vectors."""
        arr_a = np.array(a, dtype=np.float32)
        arr_b = np.array(b, dtype=np.float32)
        return float(1.0 - np.dot(arr_a, arr_b))


topology_service = TopologyService()

"""Graph cleanup and pruning service.

Removes orphan entities, stale relations, and optionally merges duplicates.
"""

import logging
import uuid

from sqlalchemy import func, select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.graph import EntityCard, GraphEntity, GraphRelation

logger = logging.getLogger(__name__)


class GraphCleaner:
    """Prune orphan entities, stale relations, and optionally create HNSW index."""

    async def cleanup_workspace(
        self, workspace_id: uuid.UUID, db: AsyncSession
    ) -> dict:
        """Run all cleanup steps for a workspace. Returns stats."""
        orphan_count = await self._remove_orphan_entities(workspace_id, db)
        stale_count = await self._remove_stale_relations(workspace_id, db)
        await db.flush()

        stats = {
            "orphan_entities_removed": orphan_count,
            "stale_relations_removed": stale_count,
        }
        logger.info("Graph cleanup for workspace %s: %s", workspace_id, stats)
        return stats

    async def _remove_orphan_entities(
        self, workspace_id: uuid.UUID, db: AsyncSession
    ) -> int:
        """Remove entities with no relations and no card links."""
        # Find entities that have no outgoing or incoming relations
        rel_subq = (
            select(GraphRelation.head_id)
            .where(GraphRelation.workspace_id == workspace_id)
            .union(
                select(GraphRelation.tail_id)
                .where(GraphRelation.workspace_id == workspace_id)
            )
        )
        rel_result = await db.execute(rel_subq)
        entities_with_relations = {row[0] for row in rel_result.all()}

        # Find entities that have card links
        card_result = await db.execute(
            select(EntityCard.entity_id).join(
                GraphEntity, GraphEntity.id == EntityCard.entity_id
            ).where(GraphEntity.workspace_id == workspace_id)
        )
        entities_with_cards = {row[0] for row in card_result.all()}

        # Find all entities in workspace
        all_result = await db.execute(
            select(GraphEntity.id).where(GraphEntity.workspace_id == workspace_id)
        )
        all_entities = {row[0] for row in all_result.all()}

        # Orphans = no relations AND no card links
        orphans = all_entities - entities_with_relations - entities_with_cards

        if not orphans:
            return 0

        # Delete orphan entities
        await db.execute(
            delete(GraphEntity).where(GraphEntity.id.in_(orphans))
        )
        logger.info("Removed %d orphan entities", len(orphans))
        return len(orphans)

    async def _remove_stale_relations(
        self, workspace_id: uuid.UUID, db: AsyncSession
    ) -> int:
        """Remove relations where head or tail entity no longer exists."""
        # This is handled by FK CASCADE, but we can also do explicit cleanup
        # for SET NULL cases (source_card_id)
        result = await db.execute(
            select(func.count())
            .select_from(GraphRelation)
            .where(
                GraphRelation.workspace_id == workspace_id,
                GraphRelation.source_card_id.is_(None),
            )
        )
        stale_count = result.scalar() or 0

        if stale_count > 0:
            await db.execute(
                delete(GraphRelation).where(
                    GraphRelation.workspace_id == workspace_id,
                    GraphRelation.source_card_id.is_(None),
                )
            )
            logger.info("Removed %d relations with null source_card_id", stale_count)

        return stale_count

    async def create_hnsw_index(self, db: AsyncSession) -> None:
        """Create HNSW index on GraphEntity.embedding for fast similarity search."""
        from sqlalchemy import text

        try:
            await db.execute(text(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_entities_embedding_hnsw "
                "ON graph_entities USING hnsw (embedding vector_cosine_ops) "
                "WITH (m = 16, ef_construction = 64)"
            ))
            await db.commit()
            logger.info("HNSW index created on graph_entities.embedding")
        except Exception as e:
            logger.warning("HNSW index creation failed (may already exist): %s", e)


graph_cleaner = GraphCleaner()

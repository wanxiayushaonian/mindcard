import logging
import uuid

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.graph import EntityCard, GraphEntity, GraphRelation
from app.services.embedding import embedding_service
from app.services.triple_extractor import ExtractedEntity, ExtractedTriple

logger = logging.getLogger(__name__)

LINK_SIMILARITY_THRESHOLD = 0.85


class EntityLinker:
    """Resolve extracted entities against the knowledge graph and persist relations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def link_triples(
        self,
        entities: list[ExtractedEntity],
        triples: list[ExtractedTriple],
        card_id: uuid.UUID,
        workspace_id: uuid.UUID,
    ) -> list[GraphRelation]:
        """Resolve entities, link them to the source card, and persist triples."""
        entity_name_to_id = await self._resolve_entities(entities, workspace_id)
        await self.db.flush()

        await self._link_entities_to_card(entity_name_to_id, card_id)

        relations: list[GraphRelation] = []
        for triple in triples:
            head_id = entity_name_to_id.get(triple.head)
            tail_id = entity_name_to_id.get(triple.tail)
            if not head_id or not tail_id:
                continue

            existing = await self.db.execute(
                select(GraphRelation).where(
                    GraphRelation.head_id == head_id,
                    GraphRelation.relation == triple.relation,
                    GraphRelation.tail_id == tail_id,
                )
            )
            if existing.scalar_one_or_none():
                continue

            relation = GraphRelation(
                workspace_id=workspace_id,
                head_id=head_id,
                relation=triple.relation,
                tail_id=tail_id,
                source_card_id=card_id,
            )
            self.db.add(relation)
            relations.append(relation)

        await self.db.flush()
        return relations

    async def _resolve_entities(
        self, entities: list[ExtractedEntity], workspace_id: uuid.UUID
    ) -> dict[str, uuid.UUID]:
        """Map each extracted entity name to a graph entity ID."""
        entity_name_to_id: dict[str, uuid.UUID] = {}
        entity_names = [e.name for e in entities]
        embeddings = await self._embed_names(entity_names)

        for entity, embedding in zip(entities, embeddings):
            entity_id = await self._find_or_create_entity(
                entity.name, entity.entity_type, embedding, workspace_id
            )
            entity_name_to_id[entity.name] = entity_id

        return entity_name_to_id

    async def _find_or_create_entity(
        self,
        name: str,
        entity_type: str,
        embedding: list[float] | None,
        workspace_id: uuid.UUID,
    ) -> uuid.UUID:
        """Return an existing entity ID if a similar one exists, otherwise create one."""
        if embedding:
            existing = await self._find_similar_entity(name, embedding, workspace_id)
            if existing:
                existing.access_count += 1
                return existing.id

        new_entity = GraphEntity(
            workspace_id=workspace_id,
            name=name,
            entity_type=entity_type,
            embedding=embedding,
            access_count=1,
        )
        self.db.add(new_entity)
        await self.db.flush()
        return new_entity.id

    async def _find_similar_entity(
        self, name: str, embedding: list[float], workspace_id: uuid.UUID
    ) -> GraphEntity | None:
        """Find the most similar existing entity via exact name match or embedding cosine similarity."""
        q = (
            select(GraphEntity)
            .where(GraphEntity.workspace_id == workspace_id)
            .where(GraphEntity.embedding.isnot(None))
            .order_by(GraphEntity.embedding.cosine_distance(embedding))
            .limit(5)
        )
        result = await self.db.execute(q)
        candidates = result.scalars().all()

        for candidate in candidates:
            if candidate.name.lower() == name.lower():
                return candidate
            if candidate.embedding is None:
                continue
            sim = float(np.dot(embedding, candidate.embedding))
            if sim > LINK_SIMILARITY_THRESHOLD:
                logger.info(
                    "Merging entity '%s' into existing '%s' (sim=%.3f)",
                    name,
                    candidate.name,
                    sim,
                )
                return candidate

        return None

    async def _link_entities_to_card(
        self, entity_name_to_id: dict[str, uuid.UUID], card_id: uuid.UUID
    ) -> None:
        """Create EntityCard associations if they do not already exist."""
        for entity_id in entity_name_to_id.values():
            existing = await self.db.execute(
                select(EntityCard).where(
                    EntityCard.entity_id == entity_id,
                    EntityCard.card_id == card_id,
                )
            )
            if not existing.scalar_one_or_none():
                self.db.add(EntityCard(entity_id=entity_id, card_id=card_id))
        await self.db.flush()

    async def _embed_names(self, names: list[str]) -> list[list[float] | None]:
        """Embed a batch of entity names, returning None for any that fail."""
        if not names:
            return []
        try:
            return await embedding_service.embed_batch(names)
        except Exception as e:
            logger.warning("Entity embedding failed: %s", e)
            return [None] * len(names)

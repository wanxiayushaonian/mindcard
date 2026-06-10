import logging
import uuid

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.graph import EntityCard, GraphEntity, GraphRelation
from app.services.embedding import embedding_service
from app.services.triple_extractor import ExtractedEntity, ExtractedTriple

logger = logging.getLogger(__name__)

# Vectors above this threshold merge without LLM confirmation.
LINK_SIMILARITY_THRESHOLD = 0.85
# Vectors above this threshold are passed to LLM for alias/coreference check.
LINK_CANDIDATE_THRESHOLD = 0.70

_COREFERENCE_SYSTEM = (
    "You decide whether two entity names refer to the same real-world entity. "
    "Reply with exactly one word: YES or NO."
)


async def _llm_is_same_entity(name_a: str, name_b: str, entity_type: str | None) -> bool:
    """Ask the extraction LLM whether two names are coreferent."""
    from app.services.llm import llm_service

    type_hint = f" (type: {entity_type})" if entity_type else ""
    user_content = f'Entity A: "{name_a}"{type_hint}\nEntity B: "{name_b}"\nSame entity?'
    try:
        answer = await llm_service.extraction_complete_simple(
            _COREFERENCE_SYSTEM, user_content, max_tokens=4, temperature=0.0
        )
        return answer.strip().upper().startswith("YES")
    except Exception as e:
        logger.warning("Coreference LLM call failed (%s vs %s): %s", name_a, name_b, e)
        return False


class EntityLinker:
    """Resolve extracted entities against the knowledge graph and persist relations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def link_triples(
        self,
        entities: list[ExtractedEntity],
        triples: list[ExtractedTriple],
        card_id: uuid.UUID | None,
        workspace_id: uuid.UUID,
    ) -> list[GraphRelation]:
        """Resolve entities, link them to the source card, and persist triples."""
        entity_name_to_id = await self._resolve_entities(entities, workspace_id)
        await self.db.flush()

        if card_id is not None:
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
                weight=triple.weight,
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
        # Use "name: description" for richer embeddings when description is available
        embed_texts = [
            f"{e.name}: {e.description}" if e.description else e.name
            for e in entities
        ]
        embeddings = await self._embed_names(embed_texts)

        for entity, embedding in zip(entities, embeddings):
            entity_id = await self._find_or_create_entity(
                entity.name, entity.entity_type, entity.description, embedding, workspace_id
            )
            entity_name_to_id[entity.name] = entity_id

        return entity_name_to_id

    async def _find_or_create_entity(
        self,
        name: str,
        entity_type: str,
        description: str | None,
        embedding: list[float] | None,
        workspace_id: uuid.UUID,
    ) -> uuid.UUID:
        """Return an existing entity ID if a similar one exists, otherwise create one."""
        # Truncate to DB column limits
        name = (name or "").strip()[:128]
        entity_type = (entity_type or "").strip()[:64] if entity_type else None
        description = (description or "").strip()[:500] if description else None
        if not name:
            name = "未知实体"

        if embedding:
            existing = await self._find_similar_entity(name, entity_type, embedding, workspace_id)
            if existing:
                existing.access_count += 1
                # Backfill description if existing entity lacks one
                if description and not existing.description:
                    existing.description = description
                return existing.id

        new_entity = GraphEntity(
            workspace_id=workspace_id,
            name=name,
            entity_type=entity_type,
            description=description,
            embedding=embedding,
            access_count=1,
        )
        self.db.add(new_entity)
        await self.db.flush()
        return new_entity.id

    async def _find_similar_entity(
        self, name: str, entity_type: str | None, embedding: list[float], workspace_id: uuid.UUID
    ) -> GraphEntity | None:
        """Find an existing entity via exact name match, high-confidence vector similarity,
        or LLM-confirmed coreference for the ambiguous mid-range."""
        q = (
            select(GraphEntity)
            .where(GraphEntity.workspace_id == workspace_id)
            .where(GraphEntity.embedding.isnot(None))
            .order_by(GraphEntity.embedding.cosine_distance(embedding))
            .limit(5)
        )
        result = await self.db.execute(q)
        candidates = result.scalars().all()

        llm_candidates: list[GraphEntity] = []

        for candidate in candidates:
            # Exact case-insensitive name → always merge
            if candidate.name.lower() == name.lower():
                return candidate

            if candidate.embedding is None:
                continue

            sim = float(np.dot(embedding, candidate.embedding))

            if sim >= LINK_SIMILARITY_THRESHOLD:
                # High confidence — merge without LLM
                logger.info(
                    "Merging '%s' into '%s' (sim=%.3f, direct)",
                    name, candidate.name, sim,
                )
                return candidate

            if sim >= LINK_CANDIDATE_THRESHOLD:
                # Ambiguous zone — queue for LLM coreference check
                llm_candidates.append(candidate)

        # Ask LLM about each ambiguous candidate (highest similarity first)
        for candidate in llm_candidates:
            if await _llm_is_same_entity(name, candidate.name, entity_type):
                sim = float(np.dot(embedding, candidate.embedding))
                logger.info(
                    "Merging '%s' into '%s' (sim=%.3f, LLM-confirmed)",
                    name, candidate.name, sim,
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

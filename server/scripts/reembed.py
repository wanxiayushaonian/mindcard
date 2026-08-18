"""Re-embed all vectors using the currently configured embedding model.

Replaces the one-off 768->1024 migration script (scripts/re_embed_ollama.py).
Uses the active embedding_service (Ollama or OpenAI-compatible) and stamps
every vector with the current embedding_model tag, so mixed-model data can
be detected and normalized after an EMBEDDING_MODEL change.

What it does:
1. Re-embeds direct vectors: cards, card_chunks, graph_entities,
   workspace_memories, community_reports.
2. Rebuilds aggregate vectors per workspace: topic centroids and
   ai_chat (tree-node) embeddings, reusing the existing services.

Usage:
    cd server
    uv run python -m scripts.reembed
"""

import asyncio
import logging
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

sys.path.insert(0, ".")

from app.database import async_session
from app.models.card import Card
from app.models.card_chunk import CardChunk
from app.models.graph import CommunityReport, GraphEntity
from app.models.workspace import Workspace
from app.models.workspace_memory import WorkspaceMemory
from app.services.embedding import current_model_tag, embedding_service
from app.services.topic import topic_service
from app.services.topology import topology_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def _reembed_cards(db: AsyncSession) -> int:
    cards = (await db.execute(select(Card).where(Card.embedding.isnot(None)))).scalars().all()
    for card in cards:
        text = embedding_service.card_to_text(
            card.title, card.content, card.keywords, card.emotion_tag
        )
        card.embedding = await embedding_service.embed(text)
        card.embedding_model = current_model_tag()
    await db.flush()
    return len(cards)


async def _reembed_chunks(db: AsyncSession) -> int:
    chunks = (await db.execute(select(CardChunk))).scalars().all()
    for chunk in chunks:
        chunk.embedding = await embedding_service.embed(chunk.chunk_text)
        chunk.embedding_model = current_model_tag()
    await db.flush()
    return len(chunks)


async def _reembed_entities(db: AsyncSession) -> int:
    entities = (
        await db.execute(select(GraphEntity).where(GraphEntity.embedding.isnot(None)))
    ).scalars().all()
    for entity in entities:
        entity.embedding = await embedding_service.embed(entity.name)
        entity.embedding_model = current_model_tag()
    await db.flush()
    return len(entities)


async def _reembed_memories(db: AsyncSession) -> int:
    memories = (
        await db.execute(
            select(WorkspaceMemory).where(WorkspaceMemory.embedding.isnot(None))
        )
    ).scalars().all()
    for memory in memories:
        memory.embedding = await embedding_service.embed(memory.body)
        memory.embedding_model = current_model_tag()
    await db.flush()
    return len(memories)


async def _reembed_reports(db: AsyncSession) -> int:
    reports = (
        await db.execute(select(CommunityReport).where(CommunityReport.embedding.isnot(None)))
    ).scalars().all()
    for report in reports:
        report.embedding = await embedding_service.embed(f"{report.title}: {report.summary}")
        report.embedding_model = current_model_tag()
    await db.flush()
    return len(reports)


async def _rebuild_aggregates(db: AsyncSession) -> int:
    """Rebuild topic centroids and tree-node embeddings per workspace.

    Both services delete-and-rebuild in place and return None, so we count
    the workspaces processed instead.
    """
    workspace_ids = (await db.execute(select(Workspace.id))).scalars().all()
    for ws_id in workspace_ids:
        await topic_service.rebuild_topics(db, ws_id)
        await topology_service.rebuild_node_embeddings(db, ws_id)
        await db.flush()
    return len(workspace_ids)


async def main() -> None:
    tag = current_model_tag()
    logger.info("Re-embedding all vectors with model: %s", tag)

    async with async_session() as db:
        n_cards = await _reembed_cards(db)
        n_chunks = await _reembed_chunks(db)
        n_entities = await _reembed_entities(db)
        n_memories = await _reembed_memories(db)
        n_reports = await _reembed_reports(db)
        n_workspaces = await _rebuild_aggregates(db)
        await db.commit()

    logger.info(
        "Re-embedding complete: cards=%d chunks=%d entities=%d "
        "memories=%d reports=%d (aggregates rebuilt in %d workspaces, tag=%s)",
        n_cards, n_chunks, n_entities, n_memories, n_reports, n_workspaces, tag,
    )
    await embedding_service.close()


if __name__ == "__main__":
    asyncio.run(main())

"""Re-embed all vectors using Ollama bge-m3 (768->1024 migration).

Run AFTER the Alembic migration has altered the vector columns to 1024.

Usage:
    cd server
    uv run python -m scripts.re_embed_ollama
"""

import asyncio
import logging
import sys

import httpx
import numpy as np
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

# Add parent to path so app imports work
sys.path.insert(0, ".")

from app.config import settings
from app.database import async_session
from app.models.card import Card
from app.models.graph import GraphEntity
from app.models.topic import Topic, TopicCard
from app.models.topology import TreeNode

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

OLLAMA_URL = f"{settings.ollama_base_url}/api/embed"
MODEL = settings.embedding_model
BATCH = 64


async def embed_texts(client: httpx.AsyncClient, texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts via Ollama."""
    if not texts:
        return []
    all_embs: list[list[float]] = []
    for i in range(0, len(texts), BATCH):
        chunk = texts[i : i + BATCH]
        resp = await client.post(OLLAMA_URL, json={"model": MODEL, "input": chunk})
        resp.raise_for_status()
        all_embs.extend(resp.json()["embeddings"])
    return all_embs


def card_to_text(title: str, content: str, keywords: list[str], emotion_tag: str = "") -> str:
    parts = []
    if title:
        parts.append(title)
    parts.append(content)
    if keywords:
        parts.append(" ".join(keywords))
    if emotion_tag:
        parts.append(emotion_tag)
    return " ".join(parts)


async def re_embed_cards(client: httpx.AsyncClient, db: AsyncSession) -> int:
    """Re-embed all cards."""
    result = await db.execute(
        select(Card.id, Card.title, Card.content, Card.keywords, Card.emotion_tag)
        .where(Card.content.isnot(None))
        .where(Card.content != "")
    )
    rows = result.all()
    if not rows:
        logger.info("No cards to re-embed")
        return 0

    logger.info("Re-embedding %d cards...", len(rows))
    texts = [card_to_text(r.title or "", r.content or "", r.keywords or [], r.emotion_tag or "") for r in rows]
    embeddings = await embed_texts(client, texts)

    for row, emb in zip(rows, embeddings):
        await db.execute(
            text("UPDATE cards SET embedding = :emb WHERE id = :id"),
            {"emb": str(emb), "id": str(row.id)},
        )
    await db.commit()
    logger.info("Re-embedded %d cards", len(rows))
    return len(rows)


async def re_embed_graph_entities(client: httpx.AsyncClient, db: AsyncSession) -> int:
    """Re-embed all graph entities."""
    result = await db.execute(
        select(GraphEntity.id, GraphEntity.name).where(GraphEntity.name.isnot(None))
    )
    rows = result.all()
    if not rows:
        logger.info("No graph entities to re-embed")
        return 0

    logger.info("Re-embedding %d graph entities...", len(rows))
    texts = [r.name or "" for r in rows]
    embeddings = await embed_texts(client, texts)

    for row, emb in zip(rows, embeddings):
        await db.execute(
            text("UPDATE graph_entities SET embedding = :emb WHERE id = :id"),
            {"emb": str(emb), "id": str(row.id)},
        )
    await db.commit()
    logger.info("Re-embedded %d graph entities", len(rows))
    return len(rows)


async def re_embed_tree_nodes(client: httpx.AsyncClient, db: AsyncSession) -> int:
    """Re-embed all topology tree nodes."""
    result = await db.execute(
        select(TreeNode.id, TreeNode.title, TreeNode.description)
        .where(TreeNode.title.isnot(None))
        .where(TreeNode.title != "")
    )
    rows = result.all()
    if not rows:
        logger.info("No tree nodes to re-embed")
        return 0

    logger.info("Re-embedding %d tree nodes...", len(rows))
    texts = [(r.title or "") + " " + (r.description or "") for r in rows]
    embeddings = await embed_texts(client, texts)

    for row, emb in zip(rows, embeddings):
        await db.execute(
            text("UPDATE tree_nodes SET embedding = :emb WHERE id = :id"),
            {"emb": str(emb), "id": str(row.id)},
        )
    await db.commit()
    logger.info("Re-embedded %d tree nodes", len(rows))
    return len(rows)


async def rebuild_topic_centroids(db: AsyncSession) -> int:
    """Recompute topic centroids as L2-normalized mean of member card embeddings."""
    result = await db.execute(select(Topic.id))
    topic_ids = [row[0] for row in result.all()]
    if not topic_ids:
        logger.info("No topics to rebuild")
        return 0

    logger.info("Rebuilding %d topic centroids...", len(topic_ids))
    updated = 0
    for tid in topic_ids:
        emb_result = await db.execute(
            select(Card.embedding)
            .join(TopicCard, TopicCard.card_id == Card.id)
            .where(TopicCard.topic_id == tid)
            .where(Card.embedding.isnot(None))
        )
        embeddings = [row[0] for row in emb_result.all()]
        if not embeddings:
            continue
        arr = np.array(embeddings, dtype=np.float32)
        mean = arr.mean(axis=0)
        norm = np.linalg.norm(mean)
        if norm > 0:
            mean = mean / norm
        await db.execute(
            text("UPDATE topics SET centroid = :centroid WHERE id = :id"),
            {"centroid": str(mean.tolist()), "id": str(tid)},
        )
        updated += 1

    await db.commit()
    logger.info("Rebuilt %d topic centroids", updated)
    return updated


async def main():
    logger.info("Starting re-embedding with Ollama model=%s dim=%d", MODEL, settings.embedding_dim)

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
        # Quick health check
        try:
            resp = await client.get(f"{settings.ollama_base_url}/api/tags")
            resp.raise_for_status()
            models = [m["name"] for m in resp.json().get("models", [])]
            if not any(MODEL in m for m in models):
                logger.warning("Model %s not found in Ollama. Available: %s", MODEL, models)
                logger.warning("Run: ollama pull %s", MODEL)
                return
            logger.info("Ollama OK, model %s available", MODEL)
        except Exception as e:
            logger.error("Cannot reach Ollama at %s: %s", settings.ollama_base_url, e)
            return

        async with async_session() as db:
            n_cards = await re_embed_cards(client, db)
            n_entities = await re_embed_graph_entities(client, db)
            n_nodes = await re_embed_tree_nodes(client, db)
            n_topics = await rebuild_topic_centroids(db)

    logger.info(
        "Done! Re-embedded: %d cards, %d entities, %d nodes, %d topic centroids",
        n_cards, n_entities, n_nodes, n_topics,
    )


if __name__ == "__main__":
    asyncio.run(main())

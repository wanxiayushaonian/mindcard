"""Shared background task helpers for card processing pipeline."""

import asyncio
import logging
import uuid
from typing import Any

from sqlalchemy import select

logger = logging.getLogger(__name__)

# Limit concurrent card processing tasks to avoid overwhelming LLM API and DB pool.
# Each task does: embedding → topic → topology → triple extraction (multiple LLM calls).
_EXTRACTION_CONCURRENCY = 2
_extraction_semaphore = asyncio.Semaphore(_EXTRACTION_CONCURRENCY)

# Max attempts for a persisted job before it is left failed.
MAX_ATTEMPTS = 3

# Per-workspace semaphore for Fork claim extraction. Limits each workspace to
# one concurrent claim extraction to avoid LLM API contention. Does not occupy
# the card _extraction_semaphore — claim extraction is independent of card pipeline.
_claim_semaphores: dict[str, asyncio.Semaphore] = {}


def _get_claim_semaphore(ws_key: str) -> asyncio.Semaphore:
    if ws_key not in _claim_semaphores:
        _claim_semaphores[ws_key] = asyncio.Semaphore(1)
    return _claim_semaphores[ws_key]


# Per-workspace queue: cards in the same workspace are processed one at a time
# to avoid topology lock contention and ensure consistent ordering.
_workspace_queues: dict[str, asyncio.Queue] = {}
_workspace_workers: dict[str, bool] = {}


async def enqueue_card_task(
    card_id: uuid.UUID,
    default_chat_id: uuid.UUID | None = None,
    extraction_language: str = "zh",
) -> None:
    """Persist a card-processing job, then schedule it for processing.

    The job is written to ``card_processing_jobs`` first so the work is not
    lost on a process restart. Idempotent: an existing pending/running job
    for the same card is not duplicated.
    """
    from app.database import async_session
    from app.models.card import Card
    from app.models.card_processing_job import CardProcessingJob

    async with async_session() as db:
        card = await db.get(Card, card_id)
        if not card:
            logger.warning("Card %s not found, skipping", card_id)
            return
        ws_key = str(card.workspace_id)

        # Idempotency: skip if an active job already exists for this card
        existing = await db.execute(
            select(CardProcessingJob).where(
                CardProcessingJob.card_id == card_id,
                CardProcessingJob.status.in_(["pending", "running"]),
            )
        )
        if existing.scalar_one_or_none():
            logger.info("Card %s already queued, skipping duplicate enqueue", card_id)
            return

        job = CardProcessingJob(
            card_id=card_id,
            workspace_id=card.workspace_id,
            default_chat_id=default_chat_id,
            extraction_language=extraction_language,
            status="pending",
        )
        db.add(job)
        await db.commit()
        job_id = job.id

    await _schedule_for_workspace(
        ws_key, (job_id, card_id, default_chat_id, extraction_language)
    )


async def _schedule_for_workspace(ws_key: str, item: tuple) -> None:
    """Put an item on the workspace queue and start its worker if needed."""
    if ws_key not in _workspace_queues:
        _workspace_queues[ws_key] = asyncio.Queue()
    queue = _workspace_queues[ws_key]

    await queue.put(item)
    logger.info(
        "Card job scheduled for workspace %s (queue size: %d)", ws_key, queue.qsize()
    )

    if ws_key not in _workspace_workers or not _workspace_workers[ws_key]:
        _workspace_workers[ws_key] = True
        asyncio.create_task(_workspace_worker(ws_key))


async def _workspace_worker(ws_key: str) -> None:
    """Worker that processes cards from a workspace queue one at a time."""
    queue = _workspace_queues.get(ws_key)
    if not queue:
        return

    while True:
        try:
            # Wait for next task with timeout — exit if queue is idle
            try:
                job_id, card_id, default_chat_id, lang = await asyncio.wait_for(
                    queue.get(), timeout=60.0
                )
            except TimeoutError:
                logger.info("Workspace %s queue idle, worker exiting", ws_key)
                break

            # Acquire global semaphore (limits total concurrency across all workspaces)
            async with _extraction_semaphore:
                logger.info(
                    "Processing job %s (card %s, queue remaining: %d)",
                    job_id, card_id, queue.qsize(),
                )
                await _run_job(job_id, card_id, default_chat_id, lang)

            queue.task_done()

        except Exception as e:
            logger.error("Workspace worker error for %s: %s", ws_key, e, exc_info=True)

    _workspace_workers[ws_key] = False


async def _run_job(
    job_id: uuid.UUID,
    card_id: uuid.UUID,
    default_chat_id: uuid.UUID | None,
    extraction_language: str,
) -> None:
    """Execute one persisted job, tracking status and attempt count."""
    from app.database import async_session
    from app.models.card_processing_job import CardProcessingJob

    # Mark running (attempts is incremented here, not at enqueue time)
    async with async_session() as db:
        job = await db.get(CardProcessingJob, job_id)
        if job is None:
            logger.warning("Job %s not found, skipping", job_id)
            return
        job.status = "running"
        job.attempts += 1
        await db.commit()

    try:
        await _process_card(card_id, default_chat_id, extraction_language)
    except Exception as e:
        logger.error(
            "Card %s processing failed (job %s): %s", card_id, job_id, e, exc_info=True
        )
        async with async_session() as db:
            job = await db.get(CardProcessingJob, job_id)
            if job is not None:
                job.status = "failed"
                job.last_error = str(e)[:1000]
                await db.commit()
        return

    async with async_session() as db:
        job = await db.get(CardProcessingJob, job_id)
        if job is not None:
            job.status = "done"
            job.last_error = None
            await db.commit()
    logger.info("Card %s processing complete (job %s)", card_id, job_id)


async def recover_pending_jobs() -> int:
    """Re-schedule pending and retryable failed jobs (call on startup).

    Pending jobs (killed mid-flight or never picked up) are re-queued
    immediately. Failed jobs below ``MAX_ATTEMPTS`` are retried; a restart
    is treated as the retry backoff. Returns the number recovered.
    """
    from app.database import async_session
    from app.models.card_processing_job import CardProcessingJob

    async with async_session() as db:
        pending = (
            await db.execute(
                select(CardProcessingJob).where(CardProcessingJob.status == "pending")
            )
        ).scalars().all()
        retryable = (
            await db.execute(
                select(CardProcessingJob).where(
                    CardProcessingJob.status == "failed",
                    CardProcessingJob.attempts < MAX_ATTEMPTS,
                )
            )
        ).scalars().all()

    recovered = 0
    for job in list(pending) + list(retryable):
        await _schedule_for_workspace(
            str(job.workspace_id),
            (job.id, job.card_id, job.default_chat_id, job.extraction_language),
        )
        recovered += 1

    if recovered:
        logger.info("Recovered %d pending/retryable jobs after restart", recovered)
    return recovered


async def _process_card(
    card_id: uuid.UUID,
    default_chat_id: uuid.UUID | None = None,
    extraction_language: str = "zh",
) -> None:
    """Full background pipeline: embedding → topic → topology → triple extraction."""
    from app.database import async_session

    async with async_session() as db:
        from app.models.card import Card
        from app.services.embedding import current_model_tag, embedding_service

        db_card = await db.get(Card, card_id)
        if not db_card:
            logger.warning("Card %s not found for processing", card_id)
            return

        # Gate: temporary cards are not yet promoted into the knowledge index
        if db_card.is_temp:
            logger.info("Card %s is temporary, skipping pipeline", card_id)
            return

        # 1. Generate embedding
        text = embedding_service.card_to_text(
            db_card.title, db_card.content, db_card.keywords, db_card.emotion_tag
        )
        logger.info("Embedding card %s: text length=%d", card_id, len(text))
        embedding = await embedding_service.embed(text)
        db_card.embedding = embedding
        db_card.embedding_model = current_model_tag()
        await db.commit()
        logger.info("Embedding saved for card %s (dim=%d)", card_id, len(embedding))

        # 1b. Store per-chunk embeddings for long cards
        from app.models.card_chunk import CardChunk
        from sqlalchemy import delete

        try:
            chunks = embedding_service.split_text_into_chunks(
                db_card.title, db_card.content, db_card.keywords, db_card.emotion_tag
            )
            # Always delete stale chunks first (handles content edits)
            await db.execute(delete(CardChunk).where(CardChunk.card_id == db_card.id))
            is_chunked = len(chunks) > 1
            if is_chunked:
                chunk_embeddings = await embedding_service.embed_batch(chunks)
                if len(chunk_embeddings) != len(chunks):
                    raise ValueError(
                        f"embed_batch returned {len(chunk_embeddings)} vectors for {len(chunks)} chunks"
                    )
                for idx, (chunk_text, chunk_emb) in enumerate(zip(chunks, chunk_embeddings)):
                    db.add(CardChunk(
                        card_id=db_card.id,
                        chunk_index=idx,
                        chunk_text=chunk_text,
                        embedding=chunk_emb,
                        embedding_model=current_model_tag(),
                    ))
            await db.commit()
            logger.info("Chunk storage: card %s → %d chunks stored", card_id, len(chunks) if is_chunked else 0)
        except Exception as e:
            await db.rollback()
            logger.warning("Chunk embedding failed for card %s, continuing pipeline: %s", card_id, e)

        # 2. Assign to topic
        from app.services.topic import topic_service

        await topic_service.assign_card_to_topic(db, db_card)
        await db.commit()

        # 3. Auto-classify into topology tree
        from app.services.topology import topology_service

        await topology_service.assign_card_to_node(db, db_card, default_chat_id)
        await db.commit()

        # 4. Extract knowledge graph triples
        try:
            from app.services.triple_extractor import triple_extractor
            from app.services.entity_linker import EntityLinker

            logger.info(
                "Triple extraction starting for card %s (lang=%s, content_len=%d)",
                card_id,
                extraction_language,
                len(db_card.content),
            )
            entities, triples = await triple_extractor.extract(
                db_card.content, db_card.workspace_id, extraction_language
            )
            logger.info(
                "Triple extraction result for card %s: %d entities, %d triples",
                card_id,
                len(entities),
                len(triples),
            )
            if entities or triples:
                linker = EntityLinker(db)
                await linker.link_triples(
                    entities, triples, db_card.id, db_card.workspace_id
                )
                await db.commit()
                logger.info("Graph triples persisted for card %s", card_id)
            else:
                logger.warning(
                    "Card %s: no graph triples extracted (entities=%d, triples=%d)",
                    card_id,
                    len(entities),
                    len(triples),
                )
        except Exception as e:
            logger.warning(
                "Triple extraction failed for card %s: %s", card_id, e, exc_info=True
            )


# Legacy entry point — kept for backward compatibility but now routes through the queue
async def generate_card_embedding(
    card_id: uuid.UUID,
    default_chat_id: uuid.UUID | None = None,
    extraction_language: str = "zh",
) -> None:
    """Enqueue card for background processing (legacy API)."""
    await enqueue_card_task(card_id, default_chat_id, extraction_language)


# ── Fork claim extraction ──────────────────────────────────────────────


def enqueue_claim_extraction_task(
    parent_chat_id: str,
    workspace_id: str,
    child_chat_id: str,
    messages: list[dict[str, Any]],
) -> None:
    """Fire-and-forget claim extraction for a freshly forked conversation.

    Schedules extraction as an asyncio task; per-workspace semaphore prevents
    concurrent extractions in the same workspace. Returns immediately — Fork
    main flow is never blocked by this.

    Must be called from within an event loop (FastAPI handler context).
    """
    asyncio.create_task(_process_claim_extraction(
        parent_chat_id=parent_chat_id,
        workspace_id=workspace_id,
        child_chat_id=child_chat_id,
        messages=messages,
    ))


async def _process_claim_extraction(
    parent_chat_id: str,
    workspace_id: str,
    child_chat_id: str,
    messages: list[dict[str, Any]],
) -> None:
    """Extract claims from parent conversation, store as workspace memory."""
    ws_key = workspace_id
    sem = _get_claim_semaphore(ws_key)
    async with sem:
        try:
            from app.database import async_session

            from app.services.claim_extractor import claim_extractor

            claims = await claim_extractor.extract(messages)
            if not claims:
                logger.info(
                    "No claims extracted for parent_chat=%s (msg_count=%d)",
                    parent_chat_id, len(messages),
                )
                return

            async with async_session() as db:
                stored = await claim_extractor.store_claims(
                    claims=claims,
                    parent_chat_id=parent_chat_id,
                    workspace_id=workspace_id,
                    child_chat_id=child_chat_id,
                    db=db,
                )
                logger.info(
                    "Claim extraction done: parent=%s child=%s stored=%d",
                    parent_chat_id, child_chat_id, stored,
                )
        except Exception as e:
            logger.error(
                "Claim extraction failed for parent_chat=%s: %s",
                parent_chat_id, e, exc_info=True,
            )

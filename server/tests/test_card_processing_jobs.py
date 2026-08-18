"""Unit tests for the persisted card-processing job pipeline."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.utils import card_tasks
from app.utils.card_tasks import MAX_ATTEMPTS


def _make_card(workspace_id: uuid.UUID | None = None) -> MagicMock:
    card = MagicMock()
    card.id = uuid.uuid4()
    card.workspace_id = workspace_id or uuid.uuid4()
    card.is_temp = False
    return card


def _make_job(status: str = "pending", attempts: int = 0) -> MagicMock:
    job = MagicMock()
    job.id = uuid.uuid4()
    job.card_id = uuid.uuid4()
    job.workspace_id = uuid.uuid4()
    job.default_chat_id = None
    job.extraction_language = "zh"
    job.status = status
    job.attempts = attempts
    job.last_error = None
    return job


def _patch_db(db: AsyncMock) -> MagicMock:
    """Patch the async_session source so `async with async_session() as db` yields db.

    card_tasks imports async_session lazily inside functions via
    ``from app.database import async_session``, so the patch targets the
    real source module.
    """
    session = AsyncMock()
    session.__aenter__.return_value = db
    return patch("app.database.async_session", return_value=session)


# ── enqueue_card_task ────────────────────────────────────────────────


class TestEnqueue:
    @pytest.mark.asyncio
    async def test_creates_pending_job(self):
        card = _make_card()
        db = AsyncMock()
        db.get = AsyncMock(return_value=card)
        result = MagicMock()
        result.scalar_one_or_none.return_value = None  # no active job
        db.execute = AsyncMock(return_value=result)

        with _patch_db(db):
            with patch("app.utils.card_tasks._schedule_for_workspace", new=AsyncMock()) as sched:
                await card_tasks.enqueue_card_task(card.id, extraction_language="en")

        db.add.assert_called_once()
        job = db.add.call_args[0][0]
        assert job.card_id == card.id
        assert job.status == "pending"
        assert job.extraction_language == "en"
        sched.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_skips_when_active_job_exists(self):
        card = _make_card()
        db = AsyncMock()
        db.get = AsyncMock(return_value=card)
        result = MagicMock()
        result.scalar_one_or_none.return_value = _make_job(status="running")
        db.execute = AsyncMock(return_value=result)

        with _patch_db(db):
            with patch("app.utils.card_tasks._schedule_for_workspace", new=AsyncMock()) as sched:
                await card_tasks.enqueue_card_task(card.id)

        db.add.assert_not_called()
        sched.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_skips_missing_card(self):
        db = AsyncMock()
        db.get = AsyncMock(return_value=None)

        with _patch_db(db):
            with patch("app.utils.card_tasks._schedule_for_workspace", new=AsyncMock()) as sched:
                await card_tasks.enqueue_card_task(uuid.uuid4())

        db.add.assert_not_called()
        sched.assert_not_awaited()


# ── _run_job ─────────────────────────────────────────────────────────


class TestRunJob:
    @pytest.mark.asyncio
    async def test_success_marks_done(self):
        job = _make_job()
        db = AsyncMock()
        db.get = AsyncMock(return_value=job)

        with _patch_db(db):
            with patch("app.utils.card_tasks._process_card", new=AsyncMock()) as proc:
                await card_tasks._run_job(job.id, job.card_id, None, "zh")

        assert job.status == "done"
        assert job.attempts == 1
        proc.assert_awaited_once_with(job.card_id, None, "zh")

    @pytest.mark.asyncio
    async def test_failure_marks_failed_with_error(self):
        job = _make_job()
        db = AsyncMock()
        db.get = AsyncMock(return_value=job)

        with _patch_db(db):
            with patch(
                "app.utils.card_tasks._process_card",
                new=AsyncMock(side_effect=RuntimeError("embedding down")),
            ):
                await card_tasks._run_job(job.id, job.card_id, None, "zh")

        assert job.status == "failed"
        assert "embedding down" in job.last_error
        assert job.attempts == 1

    @pytest.mark.asyncio
    async def test_missing_job_is_skipped(self):
        db = AsyncMock()
        db.get = AsyncMock(return_value=None)

        with _patch_db(db):
            with patch("app.utils.card_tasks._process_card", new=AsyncMock()) as proc:
                await card_tasks._run_job(uuid.uuid4(), uuid.uuid4(), None, "zh")

        proc.assert_not_awaited()


# ── recover_pending_jobs ─────────────────────────────────────────────


class TestRecover:
    @pytest.mark.asyncio
    async def test_recovered_pending_and_retryable(self):
        pending = _make_job(status="pending")
        retryable = _make_job(status="failed", attempts=1)
        # A job with attempts >= MAX is excluded by the SQL filter (attempts < MAX),
        # so the mock's second execute only returns the retryable one.
        _make_job(status="failed", attempts=MAX_ATTEMPTS)

        def _result(*jobs):
            r = MagicMock()
            r.scalars.return_value.all.return_value = list(jobs)
            return r

        db = AsyncMock()
        db.execute = AsyncMock(side_effect=[_result(pending), _result(retryable)])

        with _patch_db(db):
            with patch("app.utils.card_tasks._schedule_for_workspace", new=AsyncMock()) as sched:
                count = await card_tasks.recover_pending_jobs()

        # pending + retryable recovered; exhausted (attempts >= MAX) excluded by SQL
        assert count == 2
        assert sched.await_count == 2

    @pytest.mark.asyncio
    async def test_returns_zero_when_nothing_to_recover(self):
        def _empty_result():
            r = MagicMock()
            r.scalars.return_value.all.return_value = []
            return r

        db = AsyncMock()
        db.execute = AsyncMock(return_value=_empty_result())

        with _patch_db(db):
            count = await card_tasks.recover_pending_jobs()

        assert count == 0

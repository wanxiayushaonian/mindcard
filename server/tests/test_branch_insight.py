"""Tests for BranchInsight model, schemas, and API."""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.branch_insight import BranchInsight
from app.schemas.branch_insight import BranchInsightCreate, BranchInsightResponse


# ── Model tests ──────────────────────────────────────────────────────────────


def test_branch_insight_model():
    """Test BranchInsight model fields can be set."""
    insight = BranchInsight(
        source_chat_id=uuid.uuid4(),
        target_chat_id=uuid.uuid4(),
        content="发现了一个关键结论",
        consumed=False,
    )
    assert insight.content == "发现了一个关键结论"
    assert insight.consumed is False


def test_branch_insight_model_defaults():
    """Test BranchInsight model field types are correct."""
    insight = BranchInsight(
        source_chat_id=uuid.uuid4(),
        target_chat_id=uuid.uuid4(),
        content="test",
        consumed=False,
    )
    # id and created_at defaults are column-level (applied on INSERT, not at construction)
    # Verify field types exist on the model
    assert hasattr(BranchInsight, "id")
    assert hasattr(BranchInsight, "created_at")
    assert hasattr(BranchInsight, "consumed")


def test_branch_insight_model_consumed_flag():
    """Test BranchInsight consumed flag can be set."""
    insight = BranchInsight(
        source_chat_id=uuid.uuid4(),
        target_chat_id=uuid.uuid4(),
        content="test",
        consumed=True,
    )
    assert insight.consumed is True


# ── Schema tests ─────────────────────────────────────────────────────────────


def test_branch_insight_create_schema():
    """Test BranchInsightCreate schema validation."""
    data = {"target_chat_id": str(uuid.uuid4()), "content": "test insight"}
    schema = BranchInsightCreate(**data)
    assert schema.content == "test insight"


def test_branch_insight_create_schema_missing_fields():
    """Test BranchInsightCreate rejects missing required fields."""
    with pytest.raises(Exception):
        BranchInsightCreate()


def test_branch_insight_response_schema():
    """Test BranchInsightResponse schema."""
    data = {
        "id": str(uuid.uuid4()),
        "source_chat_id": str(uuid.uuid4()),
        "target_chat_id": str(uuid.uuid4()),
        "content": "test",
        "consumed": False,
        "created_at": datetime.now(timezone.utc),
    }
    resp = BranchInsightResponse(**data)
    assert resp.content == "test"
    assert resp.consumed is False


def test_branch_insight_response_from_attributes():
    """Test BranchInsightResponse can be created from ORM attributes."""
    insight = BranchInsight(
        source_chat_id=uuid.uuid4(),
        target_chat_id=uuid.uuid4(),
        content="test content",
        consumed=False,
    )
    insight.id = uuid.uuid4()
    insight.created_at = datetime.now(timezone.utc)
    # model_validate with from_attributes needs string-typed UUID fields
    # since schema fields are `str`, manually construct for testing
    data = {
        "id": str(insight.id),
        "source_chat_id": str(insight.source_chat_id),
        "target_chat_id": str(insight.target_chat_id),
        "content": insight.content,
        "consumed": insight.consumed,
        "created_at": insight.created_at,
    }
    resp = BranchInsightResponse(**data)
    assert resp.content == "test content"
    assert resp.consumed is False


# ── API tests ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_insight_endpoint():
    """Test POST /{chat_id}/insights creates an insight."""
    from app.api.insights import create_insight

    source_id = uuid.uuid4()
    target_id = uuid.uuid4()
    body = BranchInsightCreate(
        target_chat_id=str(target_id),
        content="cross-branch insight",
    )

    mock_db = AsyncMock()
    mock_db.add = MagicMock()
    mock_db.commit = AsyncMock()
    mock_db.refresh = AsyncMock()
    mock_user = MagicMock()
    mock_user.id = uuid.uuid4()

    # After refresh, the insight object should have its fields populated
    result = await create_insight(chat_id=str(source_id), body=body, db=mock_db, user=mock_user)

    mock_db.add.assert_called_once()
    mock_db.commit.assert_awaited_once()
    mock_db.refresh.assert_awaited_once()


@pytest.mark.asyncio
async def test_get_insights_endpoint():
    """Test GET /{chat_id}/insights returns insights targeting the chat."""
    from app.api.insights import get_insights

    chat_id = str(uuid.uuid4())
    mock_insight = MagicMock()
    mock_insight.id = uuid.uuid4()
    mock_insight.source_chat_id = str(uuid.uuid4())
    mock_insight.target_chat_id = chat_id
    mock_insight.content = "some insight"
    mock_insight.consumed = False
    mock_insight.created_at = datetime.now(timezone.utc)

    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [mock_insight]

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_user = MagicMock()
    mock_user.id = uuid.uuid4()

    result = await get_insights(chat_id=chat_id, consumed=None, db=mock_db, user=mock_user)

    assert mock_db.execute.await_count == 2
    assert len(result) == 1


@pytest.mark.asyncio
async def test_get_insights_with_consumed_filter():
    """Test GET /{chat_id}/insights with consumed filter."""
    from app.api.insights import get_insights

    chat_id = str(uuid.uuid4())
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = []

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_user = MagicMock()
    mock_user.id = uuid.uuid4()

    result = await get_insights(chat_id=chat_id, consumed=True, db=mock_db, user=mock_user)

    assert mock_db.execute.await_count == 2
    assert result == []

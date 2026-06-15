"""Tests for SplitGuard — fork frequency and duplicate label guard."""

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.services.split_guard import SplitGuard


@pytest.fixture
def guard():
    return SplitGuard(min_messages_between_forks=5)


@pytest.mark.asyncio
async def test_can_fork_first_fork(guard):
    """First fork in a conversation should always be allowed."""
    with patch("app.services.split_guard.get_last_fork_message", new_callable=AsyncMock, return_value=None):
        with patch("app.services.split_guard.get_message_count_since", new_callable=AsyncMock, return_value=100):
            with patch("app.services.split_guard.get_sibling_fork_labels", new_callable=AsyncMock, return_value=[]):
                with patch("app.services.split_guard.get_global_messages_since_last_fork", new_callable=AsyncMock, return_value=9999):
                    result = await guard.can_fork(AsyncMock(), str(uuid.uuid4()), None, "新话题")
                    assert result is True


@pytest.mark.asyncio
async def test_cannot_fork_too_soon(guard):
    """Should block fork if too few messages since last fork."""
    with patch("app.services.split_guard.get_last_fork_message", new_callable=AsyncMock, return_value={"id": "msg1"}):
        with patch("app.services.split_guard.get_message_count_since", new_callable=AsyncMock, return_value=2):
            result = await guard.can_fork(AsyncMock(), str(uuid.uuid4()), None, "新话题")
            assert result is False


@pytest.mark.asyncio
async def test_cannot_fork_duplicate_label(guard):
    """Should block fork with duplicate sibling label."""
    fork_id = str(uuid.uuid4())
    with patch("app.services.split_guard.get_last_fork_message", new_callable=AsyncMock, return_value=None):
        with patch("app.services.split_guard.get_message_count_since", new_callable=AsyncMock, return_value=100):
            with patch("app.services.split_guard.get_sibling_fork_labels", new_callable=AsyncMock, return_value=["新话题", "其他话题"]):
                result = await guard.can_fork(AsyncMock(), str(uuid.uuid4()), fork_id, "新话题")
                assert result is False


@pytest.mark.asyncio
async def test_can_fork_unique_label(guard):
    """Should allow fork when label is unique among siblings."""
    fork_id = str(uuid.uuid4())
    with patch("app.services.split_guard.get_last_fork_message", new_callable=AsyncMock, return_value=None):
        with patch("app.services.split_guard.get_message_count_since", new_callable=AsyncMock, return_value=100):
            with patch("app.services.split_guard.get_sibling_fork_labels", new_callable=AsyncMock, return_value=["其他话题"]):
                with patch("app.services.split_guard.get_global_messages_since_last_fork", new_callable=AsyncMock, return_value=9999):
                    result = await guard.can_fork(AsyncMock(), str(uuid.uuid4()), fork_id, "新话题")
                    assert result is True


@pytest.mark.asyncio
async def test_can_fork_exact_min_messages(guard):
    """Should allow fork when exactly at minimum message count."""
    with patch("app.services.split_guard.get_last_fork_message", new_callable=AsyncMock, return_value={"id": "msg1"}):
        with patch("app.services.split_guard.get_message_count_since", new_callable=AsyncMock, return_value=5):
            with patch("app.services.split_guard.get_sibling_fork_labels", new_callable=AsyncMock, return_value=[]):
                with patch("app.services.split_guard.get_global_messages_since_last_fork", new_callable=AsyncMock, return_value=9999):
                    result = await guard.can_fork(AsyncMock(), str(uuid.uuid4()), None, "新话题")
                    assert result is True


@pytest.mark.asyncio
async def test_can_fork_one_below_min(guard):
    """Should block fork when one message below minimum."""
    with patch("app.services.split_guard.get_last_fork_message", new_callable=AsyncMock, return_value={"id": "msg1"}):
        with patch("app.services.split_guard.get_message_count_since", new_callable=AsyncMock, return_value=4):
            result = await guard.can_fork(AsyncMock(), str(uuid.uuid4()), None, "新话题")
            assert result is False

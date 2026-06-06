"""Shared fixtures for API integration tests."""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.database import get_db
from app.utils.auth import get_current_user


@pytest.fixture
def test_user():
    """A mock User object."""
    user = MagicMock()
    user.id = uuid.uuid4()
    user.nickname = "测试用户"
    user.wechat_openid = "test_openid"
    return user


@pytest.fixture
def test_workspace():
    """A mock Workspace object."""
    ws = MagicMock()
    ws.id = uuid.uuid4()
    ws.local_id = f"ws_{uuid.uuid4().hex[:8]}"
    ws.name = "测试工作区"
    ws.icon = "📚"
    ws.color = "#3b82f6"
    ws.invite_code = "ABC123"
    ws.owner_id = uuid.uuid4()
    ws.created_at = datetime.now(timezone.utc)
    return ws


@pytest.fixture
def test_membership(test_workspace, test_user):
    """A mock WorkspaceMember with owner role."""
    m = MagicMock()
    m.workspace_id = test_workspace.id
    m.user_id = test_user.id
    m.role = "owner"
    m.joined_at = datetime.now(timezone.utc)
    return m


@pytest.fixture
def mock_db():
    """An AsyncMock database session with standard methods."""
    db = AsyncMock()
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    return db


@pytest_asyncio.fixture
async def client(test_user, mock_db):
    """An httpx AsyncClient wired to the FastAPI app with mocked auth/db."""
    from app.main import app

    async def _override_get_db():
        yield mock_db

    async def _override_get_user():
        return test_user

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_get_user

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()


def make_mock_card(card_id=None, workspace_id=None, creator_id=None, **kwargs):
    """Create a mock Card object with all required fields."""
    card = MagicMock()
    card.id = card_id or uuid.uuid4()
    card.local_id = kwargs.get("local_id", f"card_{uuid.uuid4().hex[:8]}")
    card.workspace_id = workspace_id or uuid.uuid4()
    card.title = kwargs.get("title", "测试卡片")
    card.content = kwargs.get("content", "测试内容")
    card.keywords = kwargs.get("keywords", ["测试"])
    card.color = kwargs.get("color", "#B8D4E3")
    card.emotion_tag = kwargs.get("emotion_tag", "")
    card.is_favorite = kwargs.get("is_favorite", False)
    card.is_temp = kwargs.get("is_temp", True)
    card.parent_card_ids = kwargs.get("parent_card_ids", [])
    card.creator_id = creator_id or uuid.uuid4()
    card.created_at = datetime.now(timezone.utc)
    card.updated_at = None
    return card


def make_mock_chat(chat_id=None, workspace_id=None, user_id=None, **kwargs):
    """Create a mock AiChat object."""
    chat = MagicMock()
    chat.id = chat_id or uuid.uuid4()
    chat.local_id = kwargs.get("local_id", f"chat_{uuid.uuid4().hex[:8]}")
    chat.workspace_id = workspace_id or uuid.uuid4()
    chat.user_id = user_id or uuid.uuid4()
    chat.mode = kwargs.get("mode", "rag")
    chat.title = kwargs.get("title", "测试对话")
    chat.description = kwargs.get("description", "")
    chat.summary = kwargs.get("summary", "")
    chat.chat_status = kwargs.get("chat_status", "active")
    chat.node_type = kwargs.get("node_type", "branch")
    chat.parent_id = kwargs.get("parent_id", None)
    chat.card_id = kwargs.get("card_id", None)
    chat.sort_order = kwargs.get("sort_order", 0)
    chat.created_at = datetime.now(timezone.utc)
    chat.updated_at = None
    chat.completed_at = None
    return chat


def make_mock_msg(msg_id=None, chat_id=None, **kwargs):
    """Create a mock ChatMessage object."""
    msg = MagicMock()
    msg.id = msg_id or uuid.uuid4()
    msg.chat_id = chat_id or uuid.uuid4()
    msg.role = kwargs.get("role", "user")
    msg.content = kwargs.get("content", "测试消息")
    msg.web_search_results = kwargs.get("web_search_results", None)
    msg.fork_id = kwargs.get("fork_id", None)
    msg.metadata_ = kwargs.get("metadata_", None)
    msg.created_at = datetime.now(timezone.utc)
    return msg


_UNSET = object()


def mock_execute_result(*items, scalar_one=_UNSET, scalar_val=_UNSET):
    """Build a mock result for db.execute().

    Usage:
        mock_execute_result(card1, card2)  → scalars().all() returns [card1, card2]
        mock_execute_result(scalar_one=membership) → scalar_one_or_none() returns membership
        mock_execute_result(scalar_one=None) → scalar_one_or_none() returns None
        mock_execute_result(scalar_val=42) → scalar() returns 42
    """
    result = MagicMock()
    if scalar_one is not _UNSET:
        result.scalar_one_or_none.return_value = scalar_one
    elif scalar_val is not _UNSET:
        result.scalar.return_value = scalar_val
    else:
        result.scalars.return_value.all.return_value = list(items)
        result.all.return_value = [(item,) for item in items]
    return result

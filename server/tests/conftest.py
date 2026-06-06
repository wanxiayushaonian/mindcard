"""Shared test fixtures and utilities for MindCard server tests."""

import math
import random
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_db():
    """AsyncMock database session."""
    return AsyncMock()


# ---------------------------------------------------------------------------
# Integration test cleanup
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
async def _cleanup_httpx_client():
    """Close the embedding_service httpx client after each test to avoid event loop errors."""
    yield
    from app.services.embedding import embedding_service

    if embedding_service._client and not embedding_service._client.is_closed:
        await embedding_service._client.aclose()
        embedding_service._client = None


# ---------------------------------------------------------------------------
# Embedding helpers
# ---------------------------------------------------------------------------


def sample_embedding(dim: int = 1024, seed: int | None = None) -> list[float]:
    """Generate a random L2-normalized vector."""
    rng = random.Random(seed)
    vec = [rng.gauss(0, 1) for _ in range(dim)]
    norm = math.sqrt(sum(x * x for x in vec))
    return [x / norm for x in vec]


@pytest.fixture
def sample_embedding_fn():
    """Fixture providing the sample_embedding helper."""
    return sample_embedding


# ---------------------------------------------------------------------------
# Model factories (return MagicMock with specified attributes)
# ---------------------------------------------------------------------------


def make_card(
    card_id: uuid.UUID | None = None,
    workspace_id: uuid.UUID | None = None,
    title: str = "Test Card",
    content: str = "Test content",
    keywords: list[str] | None = None,
    embedding: list[float] | None = None,
    **kwargs,
) -> MagicMock:
    """Create a mock Card object."""
    card = MagicMock()
    card.id = card_id or uuid.uuid4()
    card.workspace_id = workspace_id or uuid.uuid4()
    card.title = title
    card.content = content
    card.keywords = keywords or ["test"]
    card.embedding = embedding
    card.emotion_tag = kwargs.get("emotion_tag", "")
    card.is_favorite = kwargs.get("is_favorite", False)
    card.is_temp = kwargs.get("is_temp", False)
    card.creator_id = kwargs.get("creator_id", uuid.uuid4())
    card.parent_card_ids = kwargs.get("parent_card_ids", [])
    for k, v in kwargs.items():
        if not hasattr(card, k):
            setattr(card, k, v)
    return card


def make_tree_node(
    node_id: uuid.UUID | None = None,
    workspace_id: uuid.UUID | None = None,
    parent_id: uuid.UUID | None = None,
    node_type: str = "branch",
    title: str = "Test Node",
    embedding: list[float] | None = None,
    status: str = "active",
    **kwargs,
) -> MagicMock:
    """Create a mock AiChat used as a topology node (backward-compat helper)."""
    node = MagicMock()
    node.id = node_id or uuid.uuid4()
    node.workspace_id = workspace_id or uuid.uuid4()
    node.parent_id = parent_id
    node.node_type = node_type
    node.title = title
    node.embedding = embedding
    node.chat_status = status
    node.description = kwargs.get("description", "")
    node.summary = kwargs.get("summary", "")
    node.core_entity_ids = kwargs.get("core_entity_ids", [])
    node.sort_order = kwargs.get("sort_order", 0)
    for k, v in kwargs.items():
        if not hasattr(node, k):
            setattr(node, k, v)
    return node


def make_chat(
    chat_id: uuid.UUID | None = None,
    workspace_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    title: str = "Test Chat",
    mode: str = "rag",
    **kwargs,
) -> MagicMock:
    """Create a mock AiChat object."""
    chat = MagicMock()
    chat.id = chat_id or uuid.uuid4()
    chat.workspace_id = workspace_id or uuid.uuid4()
    chat.user_id = user_id or uuid.uuid4()
    chat.title = title
    chat.mode = mode
    chat.parent_id = kwargs.get("parent_id", None)
    chat.card_id = kwargs.get("card_id", None)
    chat.local_id = kwargs.get("local_id", f"local_{uuid.uuid4().hex[:8]}")
    chat.node_type = kwargs.get("node_type", "branch")
    chat.description = kwargs.get("description", "")
    chat.summary = kwargs.get("summary", "")
    chat.chat_status = kwargs.get("chat_status", "active")
    chat.sort_order = kwargs.get("sort_order", 0)
    chat.embedding = kwargs.get("embedding", None)
    for k, v in kwargs.items():
        if not hasattr(chat, k):
            setattr(chat, k, v)
    return chat


def make_chat_message(
    message_id: uuid.UUID | None = None,
    chat_id: uuid.UUID | None = None,
    role: str = "user",
    content: str = "Test message",
    **kwargs,
) -> MagicMock:
    """Create a mock ChatMessage object."""
    msg = MagicMock()
    msg.id = message_id or uuid.uuid4()
    msg.chat_id = chat_id or uuid.uuid4()
    msg.role = role
    msg.content = content
    msg.web_search_results = kwargs.get("web_search_results", None)
    msg.fork_id = kwargs.get("fork_id", None)
    for k, v in kwargs.items():
        if not hasattr(msg, k):
            setattr(msg, k, v)
    return msg


def make_topic(
    topic_id: uuid.UUID | None = None,
    workspace_id: uuid.UUID | None = None,
    name: str = "Test Topic",
    centroid: list[float] | None = None,
    card_count: int = 0,
    **kwargs,
) -> MagicMock:
    """Create a mock Topic object."""
    topic = MagicMock()
    topic.id = topic_id or uuid.uuid4()
    topic.workspace_id = workspace_id or uuid.uuid4()
    topic.name = name
    topic.centroid = centroid or sample_embedding(seed=42)
    topic.card_count = card_count
    for k, v in kwargs.items():
        if not hasattr(topic, k):
            setattr(topic, k, v)
    return topic


def make_graph_entity(
    entity_id: uuid.UUID | None = None,
    workspace_id: uuid.UUID | None = None,
    name: str = "TestEntity",
    entity_type: str = "concept",
    embedding: list[float] | None = None,
    access_count: int = 0,
    **kwargs,
) -> MagicMock:
    """Create a mock GraphEntity object."""
    entity = MagicMock()
    entity.id = entity_id or uuid.uuid4()
    entity.workspace_id = workspace_id or uuid.uuid4()
    entity.name = name
    entity.entity_type = entity_type
    entity.embedding = embedding or sample_embedding(seed=99)
    entity.access_count = access_count
    for k, v in kwargs.items():
        if not hasattr(entity, k):
            setattr(entity, k, v)
    return entity


# ---------------------------------------------------------------------------
# Mock result helpers
# ---------------------------------------------------------------------------


def mock_scalars(items: list) -> MagicMock:
    """Create a mock result with .scalars().all() returning items."""
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def mock_scalar_one_or_none(item=None) -> MagicMock:
    """Create a mock result with .scalar_one_or_none() returning item."""
    result = MagicMock()
    result.scalar_one_or_none.return_value = item
    return result


def mock_scalar_first(item=None) -> MagicMock:
    """Create a mock result with .scalar_first() returning item."""
    result = MagicMock()
    result.scalar_first.return_value = item
    return result

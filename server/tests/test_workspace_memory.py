"""Tests for WorkspaceMemory model and API."""
import uuid
from datetime import datetime, timezone

import pytest

from app.models.workspace_memory import WorkspaceMemory
from app.schemas.workspace_memory import WorkspaceMemoryCreate, WorkspaceMemoryResponse


def test_workspace_memory_model():
    """Test WorkspaceMemory model fields."""
    mem = WorkspaceMemory(
        workspace_id=uuid.uuid4(),
        slug="project-context",
        title="项目背景",
        body="这是一个知识管理平台",
    )
    assert mem.slug == "project-context"
    assert mem.title == "项目背景"
    assert mem.body == "这是一个知识管理平台"
    assert mem.source_chat_id is None


def test_workspace_memory_model_with_source_chat():
    """Test WorkspaceMemory model with optional source_chat_id."""
    chat_id = uuid.uuid4()
    mem = WorkspaceMemory(
        workspace_id=uuid.uuid4(),
        slug="summary",
        title="Summary",
        body="Some content",
        source_chat_id=chat_id,
    )
    assert mem.source_chat_id == chat_id


def test_workspace_memory_unique_constraint():
    """Test that UniqueConstraint is defined on (workspace_id, slug)."""
    constraint_names = [c.name for c in WorkspaceMemory.__table_args__]
    assert "uq_workspace_memory_slug" in constraint_names


def test_workspace_memory_create_schema():
    """Test WorkspaceMemoryCreate schema validation."""
    data = {"slug": "test-slug", "title": "Test Title", "body": "content here"}
    schema = WorkspaceMemoryCreate(**data)
    assert schema.slug == "test-slug"
    assert schema.title == "Test Title"
    assert schema.body == "content here"
    assert schema.source_chat_id is None


def test_workspace_memory_create_schema_with_source_chat():
    """Test WorkspaceMemoryCreate schema with source_chat_id."""
    data = {
        "slug": "test",
        "title": "Test",
        "body": "content",
        "source_chat_id": str(uuid.uuid4()),
    }
    schema = WorkspaceMemoryCreate(**data)
    assert schema.source_chat_id is not None


def test_workspace_memory_response_schema():
    """Test WorkspaceMemoryResponse schema."""
    data = {
        "id": str(uuid.uuid4()),
        "workspace_id": str(uuid.uuid4()),
        "slug": "test",
        "title": "Test",
        "body": "content",
        "source_chat_id": None,
        "updated_at": None,
        "created_at": datetime.now(timezone.utc),
    }
    resp = WorkspaceMemoryResponse(**data)
    assert resp.slug == "test"
    assert resp.title == "Test"
    assert resp.source_chat_id is None


def test_workspace_memory_response_schema_with_all_fields():
    """Test WorkspaceMemoryResponse schema with all fields populated."""
    now = datetime.now(timezone.utc)
    data = {
        "id": str(uuid.uuid4()),
        "workspace_id": str(uuid.uuid4()),
        "slug": "full-test",
        "title": "Full Test",
        "body": "full body",
        "source_chat_id": str(uuid.uuid4()),
        "updated_at": now,
        "created_at": now,
    }
    resp = WorkspaceMemoryResponse(**data)
    assert resp.slug == "full-test"
    assert resp.updated_at is not None
    assert resp.source_chat_id is not None

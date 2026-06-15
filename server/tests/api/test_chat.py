"""Integration tests for chat API endpoints."""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from tests.api.conftest import make_mock_chat, make_mock_msg, mock_execute_result


@pytest.mark.asyncio
class TestCreateChat:
    async def test_create_chat_success(self, client, mock_db, test_user, test_workspace, test_membership):
        chat = make_mock_chat(workspace_id=test_workspace.id, user_id=test_user.id)

        mock_db.get = AsyncMock(return_value=test_workspace)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership check
            mock_execute_result(scalar_one=None),             # existing local_id check
        ])

        async def refresh(obj):
            obj.id = uuid.uuid4()
            obj.local_id = f"chat_{uuid.uuid4().hex[:8]}"
            obj.workspace_id = test_workspace.id
            obj.user_id = test_user.id
            obj.mode = "rag"
            obj.title = "新对话"
            obj.description = ""
            obj.summary = ""
            obj.chat_status = "active"
            obj.node_type = "branch"
            obj.parent_id = None
            obj.card_id = None
            obj.created_at = datetime.now(timezone.utc)
        mock_db.refresh = refresh

        with patch("app.services.topology.topology_service") as mock_topo:
            mock_topo.auto_bind_chat_to_node = AsyncMock()
            resp = await client.post("/api/chats/", json={
                "workspace_id": str(test_workspace.id),
                "title": "新对话",
                "mode": "rag",
            })

        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "新对话"

    async def test_create_chat_duplicate_local_id(self, client, mock_db, test_user, test_workspace, test_membership):
        existing = make_mock_chat(workspace_id=test_workspace.id, user_id=test_user.id)

        mock_db.get = AsyncMock(return_value=test_workspace)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership
            mock_execute_result(scalar_one=existing),          # existing chat found
        ])

        resp = await client.post("/api/chats/", json={
            "workspace_id": str(test_workspace.id),
            "local_id": existing.local_id,
        })

        assert resp.status_code == 200
        assert resp.json()["id"] == str(existing.id)


@pytest.mark.asyncio
class TestGetChat:
    async def test_get_chat_success(self, client, mock_db, test_user):
        chat = make_mock_chat(user_id=test_user.id)
        messages = [make_mock_msg(chat_id=chat.id) for _ in range(3)]

        mock_db.get = AsyncMock(return_value=chat)
        mock_db.execute = AsyncMock(return_value=mock_execute_result(*messages))

        resp = await client.get(f"/api/chats/{chat.id}")

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(chat.id)
        assert len(data["messages"]) == 3

    async def test_get_chat_not_found(self, client, mock_db):
        mock_db.get = AsyncMock(return_value=None)

        resp = await client.get(f"/api/chats/{uuid.uuid4()}")

        assert resp.status_code == 404

    async def test_get_chat_forbidden(self, client, mock_db, test_user):
        chat = make_mock_chat(user_id=uuid.uuid4())  # different user
        chat.workspace_id = None  # no workspace → direct 403 without membership check

        mock_db.get = AsyncMock(return_value=chat)

        resp = await client.get(f"/api/chats/{chat.id}")

        assert resp.status_code == 403


@pytest.mark.asyncio
class TestListChats:
    async def test_list_chats(self, client, mock_db, test_user, test_workspace, test_membership):
        chats = [make_mock_chat(workspace_id=test_workspace.id, user_id=test_user.id) for _ in range(2)]

        mock_db.get = AsyncMock(return_value=test_workspace)
        # list_chats: 1 execute for membership, 1 for chats, 1 for counts, 1 for last messages
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),
            mock_execute_result(*chats),
            mock_execute_result(),  # count query
            mock_execute_result(),  # last message query
        ])

        resp = await client.get(f"/api/chats/?workspace_id={test_workspace.id}")

        assert resp.status_code == 200
        assert len(resp.json()) == 2


@pytest.mark.asyncio
class TestAddMessage:
    async def test_add_message_success(self, client, mock_db, test_user):
        chat = make_mock_chat(user_id=test_user.id)
        msg = make_mock_msg(chat_id=chat.id, role="user", content="你好")

        mock_db.get = AsyncMock(return_value=chat)

        async def refresh(obj):
            obj.id = msg.id
            obj.created_at = msg.created_at
        mock_db.refresh = refresh

        resp = await client.post(f"/api/chats/{chat.id}/messages", json={
            "role": "user",
            "content": "你好",
        })

        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "user"
        assert data["content"] == "你好"

    async def test_add_message_chat_not_found(self, client, mock_db):
        mock_db.get = AsyncMock(return_value=None)

        resp = await client.post(f"/api/chats/{uuid.uuid4()}/messages", json={
            "role": "user",
            "content": "你好",
        })

        assert resp.status_code == 404


@pytest.mark.asyncio
class TestDeleteChat:
    async def test_delete_chat_success(self, client, mock_db, test_user):
        chat = make_mock_chat(user_id=test_user.id)

        mock_db.get = AsyncMock(return_value=chat)
        mock_db.execute = AsyncMock(return_value=mock_execute_result())

        resp = await client.delete(f"/api/chats/{chat.id}")

        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    async def test_delete_chat_not_found(self, client, mock_db):
        mock_db.get = AsyncMock(return_value=None)

        resp = await client.delete(f"/api/chats/{uuid.uuid4()}")

        assert resp.status_code == 404


@pytest.mark.asyncio
class TestDeleteChatPreview:
    async def test_delete_preview(self, client, mock_db, test_user):
        chat = make_mock_chat(user_id=test_user.id)

        mock_db.get = AsyncMock(return_value=chat)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_val=5),  # message count
            mock_execute_result(scalar_val=2),  # child count
        ])

        resp = await client.get(f"/api/chats/{chat.id}/delete-preview")

        assert resp.status_code == 200
        data = resp.json()
        assert data["messages"] == 5
        assert data["child_chats"] == 2


@pytest.mark.asyncio
class TestForkChat:
    async def test_fork_chat_success(self, client, mock_db, test_user):
        parent = make_mock_chat(user_id=test_user.id)
        messages = [make_mock_msg(role="user", content="你好"), make_mock_msg(role="assistant", content="你好！")]

        mock_db.get = AsyncMock(return_value=parent)
        mock_db.execute = AsyncMock(return_value=mock_execute_result(*messages))

        async def refresh(obj):
            obj.id = uuid.uuid4()
        mock_db.refresh = refresh

        with patch("app.services.fork_compress.fork_compressor") as mock_compressor:
            mock_compressor.compress = AsyncMock(return_value="上下文摘要")
            resp = await client.post(f"/api/chats/{parent.id}/fork", json={
                "topic": "深入讨论",
                "mode": "rag",
            })

        assert resp.status_code == 200
        data = resp.json()
        assert "chat_id" in data
        assert data["context_summary"] == "上下文摘要"

    async def test_fork_chat_not_found(self, client, mock_db):
        mock_db.get = AsyncMock(return_value=None)

        resp = await client.post(f"/api/chats/{uuid.uuid4()}/fork", json={})

        assert resp.status_code == 404


@pytest.mark.asyncio
class TestChatPath:
    async def test_get_chat_path(self, client, mock_db, test_user):
        root = make_mock_chat(user_id=test_user.id, node_type="root", title="主线")
        child = make_mock_chat(user_id=test_user.id, parent_id=root.id, node_type="branch")

        # get_chat_path: first query for the chat itself, then walks parent chain
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=child),  # initial chat lookup
            mock_execute_result(scalar_one=child),  # first iteration (current node)
            mock_execute_result(scalar_one=root),    # second iteration (parent)
            mock_execute_result(scalar_one=None),    # third iteration (root has no parent)
        ])

        resp = await client.get(f"/api/chats/{child.id}/path")

        assert resp.status_code == 200
        data = resp.json()
        assert "path" in data


@pytest.mark.asyncio
class TestBatchMessages:
    async def test_batch_replace_messages(self, client, mock_db, test_user):
        chat = make_mock_chat(user_id=test_user.id)

        mock_db.get = AsyncMock(return_value=chat)

        resp = await client.post(f"/api/chats/{chat.id}/messages/batch", json=[
            {"role": "user", "content": "消息1"},
            {"role": "assistant", "content": "回复1"},
        ])

        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert resp.json()["count"] == 2


@pytest.mark.asyncio
class TestSummarizeChat:
    async def test_summarize_too_few_messages(self, client, mock_db, test_user):
        chat = make_mock_chat(user_id=test_user.id)
        messages = [make_mock_msg(role="user", content="你好")]

        mock_db.get = AsyncMock(return_value=chat)
        mock_db.execute = AsyncMock(return_value=mock_execute_result(*messages))

        resp = await client.post(f"/api/chats/{chat.id}/summarize", json={})

        assert resp.status_code == 400
        assert "太少" in resp.json()["detail"]

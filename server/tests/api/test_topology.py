"""Integration tests for topology API endpoints."""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from tests.api.conftest import make_mock_chat, mock_execute_result


def _make_node_response(node):
    """Build expected TreeNodeResponse-like dict from a mock AiChat."""
    return {
        "id": str(node.id),
        "workspace_id": str(node.workspace_id),
        "parent_id": str(node.parent_id) if node.parent_id else None,
        "chat_id": str(node.id),
        "node_type": node.node_type,
        "title": node.title,
        "description": node.description or "",
        "summary": node.summary or "",
        "status": node.chat_status or "active",
        "sort_order": node.sort_order or 0,
        "card_ids": [],
        "card_count": 0,
        "child_ids": [],
        "ref_ids": [],
    }


@pytest.mark.asyncio
class TestListNodes:
    async def test_list_nodes(self, client, mock_db, test_user, test_workspace, test_membership):
        node = make_mock_chat(
            workspace_id=test_workspace.id, node_type="root", title="主线"
        )

        mock_db.get = AsyncMock(return_value=test_workspace)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership
            mock_execute_result(node),                         # nodes query
            mock_execute_result(),                             # card_ids
            mock_execute_result(),                             # child_ids
            mock_execute_result(),                             # ref_ids
        ])

        resp = await client.get(f"/api/topology/?workspace_id={test_workspace.id}")

        assert resp.status_code == 200
        data = resp.json()
        assert "nodes" in data

    async def test_list_nodes_auto_create_root(
        self, client, mock_db, test_user, test_workspace, test_membership
    ):
        mock_db.get = AsyncMock(return_value=test_workspace)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership
            mock_execute_result(),                             # empty nodes
            mock_execute_result(),                             # card_ids for root
            mock_execute_result(),                             # child_ids for root
            mock_execute_result(),                             # ref_ids for root
        ])

        async def refresh(obj):
            obj.id = uuid.uuid4()
            obj.workspace_id = test_workspace.id
            obj.parent_id = None
            obj.node_type = "root"
            obj.title = "主线"
            obj.description = ""
            obj.summary = ""
            obj.chat_status = "active"
            obj.sort_order = 0
            obj.mode = "rag"
            obj.local_id = f"root-{test_workspace.id}"
            obj.user_id = test_user.id
            obj.created_at = datetime.now(timezone.utc)
            obj.updated_at = None
            obj.completed_at = None
        mock_db.refresh = refresh

        resp = await client.get(f"/api/topology/?workspace_id={test_workspace.id}")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["nodes"]) == 1
        assert data["nodes"][0]["node_type"] == "root"


@pytest.mark.asyncio
class TestCreateNode:
    async def test_create_node_success(
        self, client, mock_db, test_user, test_workspace, test_membership
    ):
        node = make_mock_chat(
            workspace_id=test_workspace.id, node_type="branch", title="新分支"
        )

        mock_db.get = AsyncMock(return_value=test_workspace)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership
            mock_execute_result(),                             # card_ids
            mock_execute_result(),                             # child_ids
            mock_execute_result(),                             # ref_ids
        ])

        async def refresh(obj):
            for attr in ("id", "workspace_id", "parent_id", "node_type", "title",
                         "description", "summary", "chat_status", "sort_order",
                         "created_at", "updated_at", "completed_at"):
                if hasattr(node, attr):
                    setattr(obj, attr, getattr(node, attr))
        mock_db.refresh = refresh

        resp = await client.post("/api/topology/", json={
            "workspace_id": str(test_workspace.id),
            "node_type": "branch",
            "title": "新分支",
        })

        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "新分支"
        assert data["node_type"] == "branch"


@pytest.mark.asyncio
class TestGetNode:
    async def test_get_node_success(self, client, mock_db, test_user, test_workspace, test_membership):
        node = make_mock_chat(workspace_id=test_workspace.id, node_type="root", title="主线")

        mock_db.get = AsyncMock(return_value=node)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership
            mock_execute_result(),                             # card_ids
            mock_execute_result(),                             # child_ids
            mock_execute_result(),                             # ref_ids
        ])

        resp = await client.get(f"/api/topology/{node.id}")

        assert resp.status_code == 200
        assert resp.json()["title"] == "主线"

    async def test_get_node_not_found(self, client, mock_db):
        mock_db.get = AsyncMock(return_value=None)

        resp = await client.get(f"/api/topology/{uuid.uuid4()}")

        assert resp.status_code == 404


@pytest.mark.asyncio
class TestUpdateNode:
    async def test_update_node_title(
        self, client, mock_db, test_user, test_workspace, test_membership
    ):
        node = make_mock_chat(workspace_id=test_workspace.id, node_type="branch")

        mock_db.get = AsyncMock(return_value=node)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership
            mock_execute_result(),                             # card_ids
            mock_execute_result(),                             # child_ids
            mock_execute_result(),                             # ref_ids
        ])

        async def refresh(obj):
            pass
        mock_db.refresh = refresh

        resp = await client.put(f"/api/topology/{node.id}", json={
            "title": "新标题",
        })

        assert resp.status_code == 200

    async def test_update_node_not_found(self, client, mock_db):
        mock_db.get = AsyncMock(return_value=None)

        resp = await client.put(f"/api/topology/{uuid.uuid4()}", json={"title": "x"})

        assert resp.status_code == 404


@pytest.mark.asyncio
class TestDeleteNode:
    async def test_delete_node_success(
        self, client, mock_db, test_user, test_workspace, test_membership
    ):
        node = make_mock_chat(workspace_id=test_workspace.id)

        mock_db.get = AsyncMock(return_value=node)
        mock_db.execute = AsyncMock(return_value=mock_execute_result(scalar_one=test_membership))

        resp = await client.delete(f"/api/topology/{node.id}")

        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    async def test_delete_node_not_found(self, client, mock_db):
        mock_db.get = AsyncMock(return_value=None)

        resp = await client.delete(f"/api/topology/{uuid.uuid4()}")

        assert resp.status_code == 404


@pytest.mark.asyncio
class TestNodeCards:
    async def test_add_card_to_node(
        self, client, mock_db, test_user, test_workspace, test_membership
    ):
        node = make_mock_chat(workspace_id=test_workspace.id)
        card = MagicMock()
        card.id = uuid.uuid4()

        # db.get is called for both AiChat(node_id) and Card(card_id)
        call_count = [0]
        async def get_side_effect(model, id_val):
            call_count[0] += 1
            if call_count[0] == 1:
                return node
            return card
        mock_db.get = AsyncMock(side_effect=get_side_effect)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership
            mock_execute_result(scalar_one=None),             # duplicate check
            mock_execute_result(),                             # card_ids
            mock_execute_result(),                             # child_ids
            mock_execute_result(),                             # ref_ids
        ])

        resp = await client.post(f"/api/topology/{node.id}/cards", json={
            "card_id": str(card.id),
        })

        assert resp.status_code == 200

    async def test_remove_card_from_node(
        self, client, mock_db, test_user, test_workspace, test_membership
    ):
        node = make_mock_chat(workspace_id=test_workspace.id)
        card_id = str(uuid.uuid4())
        nc = MagicMock()

        mock_db.get = AsyncMock(return_value=node)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership
            mock_execute_result(scalar_one=nc),               # NodeCard found
        ])

        resp = await client.delete(f"/api/topology/{node.id}/cards/{card_id}")

        assert resp.status_code == 200
        assert resp.json()["ok"] is True


@pytest.mark.asyncio
class TestNodeRefs:
    async def test_create_ref(
        self, client, mock_db, test_user, test_workspace, test_membership
    ):
        source = make_mock_chat(workspace_id=test_workspace.id)
        target = make_mock_chat(workspace_id=test_workspace.id)

        call_count = [0]
        async def get_side_effect(model, id_val):
            call_count[0] += 1
            if call_count[0] == 1:
                return source
            return target
        mock_db.get = AsyncMock(side_effect=get_side_effect)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership
            mock_execute_result(scalar_one=None),             # duplicate check
            mock_execute_result(),                             # card_ids
            mock_execute_result(),                             # child_ids
            mock_execute_result(),                             # ref_ids
        ])

        resp = await client.post(f"/api/topology/{source.id}/refs", json={
            "target_chat_id": str(target.id),
            "ref_type": "related",
        })

        assert resp.status_code == 200

    async def test_create_ref_self(
        self, client, mock_db, test_user, test_workspace, test_membership
    ):
        node = make_mock_chat(workspace_id=test_workspace.id)

        mock_db.get = AsyncMock(return_value=node)
        mock_db.execute = AsyncMock(return_value=mock_execute_result(scalar_one=test_membership))

        resp = await client.post(f"/api/topology/{node.id}/refs", json={
            "target_chat_id": str(node.id),
        })

        assert resp.status_code == 400
        assert "自身" in resp.json()["detail"]

    async def test_remove_ref(
        self, client, mock_db, test_user, test_workspace, test_membership
    ):
        node = make_mock_chat(workspace_id=test_workspace.id)
        target_id = str(uuid.uuid4())
        ref = MagicMock()

        mock_db.get = AsyncMock(return_value=node)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership
            mock_execute_result(scalar_one=ref),              # ref found
        ])

        resp = await client.delete(f"/api/topology/{node.id}/refs/{target_id}")

        assert resp.status_code == 200
        assert resp.json()["ok"] is True

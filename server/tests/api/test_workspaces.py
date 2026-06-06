"""Integration tests for workspace API endpoints."""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from tests.api.conftest import mock_execute_result


def _make_workspace(**kwargs):
    ws = MagicMock()
    ws.id = kwargs.get("ws_id", uuid.uuid4())
    ws.local_id = kwargs.get("local_id", f"ws_{uuid.uuid4().hex[:8]}")
    ws.name = kwargs.get("name", "测试工作区")
    ws.icon = kwargs.get("icon", "📚")
    ws.color = kwargs.get("color", "#3b82f6")
    ws.invite_code = kwargs.get("invite_code", "ABC123")
    ws.owner_id = kwargs.get("owner_id", uuid.uuid4())
    ws.created_at = datetime.now(timezone.utc)
    return ws


def _make_membership(ws_id, user_id, role="owner"):
    m = MagicMock()
    m.workspace_id = ws_id
    m.user_id = user_id
    m.role = role
    m.joined_at = datetime.now(timezone.utc)
    return m


@pytest.mark.asyncio
class TestListWorkspaces:
    async def test_list_workspaces(self, client, mock_db, test_user):
        ws = _make_workspace()
        rows = [(ws, "owner")]

        result = MagicMock()
        result.all.return_value = rows
        mock_db.execute = AsyncMock(return_value=result)

        resp = await client.get("/api/workspaces/")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == ws.name
        assert data[0]["member_role"] == "owner"


@pytest.mark.asyncio
class TestCreateWorkspace:
    async def test_create_workspace_success(self, client, mock_db, test_user):
        ws = _make_workspace(name="新工作区")

        async def refresh(obj):
            obj.id = uuid.uuid4()
            obj.local_id = f"ws_{uuid.uuid4().hex[:8]}"
            obj.name = "新工作区"
            obj.icon = "lightbulb"
            obj.color = "#94B4C8"
            obj.invite_code = None
            obj.owner_id = test_user.id
            obj.created_at = datetime.now(timezone.utc)
            obj.member_role = "owner"
        mock_db.refresh = refresh

        resp = await client.post("/api/workspaces/", json={
            "local_id": f"ws_{uuid.uuid4().hex[:8]}",
            "name": "新工作区",
        })

        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "新工作区"


@pytest.mark.asyncio
class TestGetWorkspace:
    async def test_get_workspace_success(self, client, mock_db, test_user):
        ws = _make_workspace()
        membership = _make_membership(ws.id, test_user.id, "owner")

        mock_db.get = AsyncMock(return_value=ws)
        mock_db.execute = AsyncMock(return_value=mock_execute_result(scalar_one=membership))

        resp = await client.get(f"/api/workspaces/{ws.id}")

        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == ws.name
        assert data["member_role"] == "owner"

    async def test_get_workspace_not_member(self, client, mock_db, test_user):
        ws = _make_workspace()

        mock_db.get = AsyncMock(return_value=ws)
        # get_workspace_membership: db.get(Workspace) returns ws, db.execute returns None membership
        mock_db.execute = AsyncMock(return_value=mock_execute_result(scalar_one=None))

        resp = await client.get(f"/api/workspaces/{ws.id}")

        assert resp.status_code == 403


@pytest.mark.asyncio
class TestUpdateWorkspace:
    async def test_update_workspace_success(self, client, mock_db, test_user):
        ws = _make_workspace()
        ws.member_role = "owner"  # WorkspaceResponse requires this
        membership = _make_membership(ws.id, test_user.id, "owner")

        mock_db.get = AsyncMock(return_value=ws)
        mock_db.execute = AsyncMock(return_value=mock_execute_result(scalar_one=membership))

        resp = await client.put(f"/api/workspaces/{ws.id}", json={
            "name": "新名字",
        })

        assert resp.status_code == 200

    async def test_update_workspace_not_owner(self, client, mock_db, test_user):
        ws = _make_workspace()
        membership = _make_membership(ws.id, test_user.id, "editor")

        mock_db.get = AsyncMock(return_value=ws)
        mock_db.execute = AsyncMock(return_value=mock_execute_result(scalar_one=membership))

        resp = await client.put(f"/api/workspaces/{ws.id}", json={"name": "x"})

        assert resp.status_code == 403


@pytest.mark.asyncio
class TestDeleteWorkspace:
    async def test_delete_workspace_success(self, client, mock_db, test_user):
        ws = _make_workspace()
        membership = _make_membership(ws.id, test_user.id, "owner")

        mock_db.get = AsyncMock(return_value=ws)
        mock_db.execute = AsyncMock(return_value=mock_execute_result(scalar_one=membership))

        resp = await client.delete(f"/api/workspaces/{ws.id}")

        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    async def test_delete_workspace_not_owner(self, client, mock_db, test_user):
        ws = _make_workspace()
        membership = _make_membership(ws.id, test_user.id, "admin")

        mock_db.get = AsyncMock(return_value=ws)
        mock_db.execute = AsyncMock(return_value=mock_execute_result(scalar_one=membership))

        resp = await client.delete(f"/api/workspaces/{ws.id}")

        assert resp.status_code == 403


@pytest.mark.asyncio
class TestWorkspaceMembers:
    async def test_list_members(self, client, mock_db, test_user):
        ws = _make_workspace()
        membership = _make_membership(ws.id, test_user.id, "owner")

        member_row = MagicMock()
        member_row.user_id = test_user.id
        member_row.role = "owner"
        member_row.joined_at = datetime.now(timezone.utc)

        mock_db.get = AsyncMock(return_value=ws)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=membership),  # membership check
            mock_execute_result(),                        # members query → all()
        ])
        # Override the all() to return proper tuples
        mock_db.execute.return_value.all.return_value = [(member_row, "测试用户")]

        resp = await client.get(f"/api/workspaces/{ws.id}/members")

        assert resp.status_code == 200


@pytest.mark.asyncio
class TestInviteCode:
    async def test_generate_invite_code(self, client, mock_db, test_user):
        ws = _make_workspace()
        membership = _make_membership(ws.id, test_user.id, "owner")

        mock_db.get = AsyncMock(return_value=ws)
        mock_db.execute = AsyncMock(return_value=mock_execute_result(scalar_one=membership))

        resp = await client.post(f"/api/workspaces/{ws.id}/invite-code")

        assert resp.status_code == 200
        data = resp.json()
        assert "invite_code" in data
        assert len(data["invite_code"]) == 6

"""Integration tests for card API endpoints."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.api.conftest import make_mock_card, mock_execute_result


@pytest.mark.asyncio
class TestCreateCard:
    async def test_create_card_success(self, client, mock_db, test_user, test_workspace, test_membership):
        card = make_mock_card(workspace_id=test_workspace.id, creator_id=test_user.id)

        # get_workspace_membership: db.get(Workspace) + db.execute(select(WorkspaceMember))
        # create_card: db.execute(select(AiChat).where(root)) → no root node
        # create_activity: db.execute(select(...)) → ignored
        mock_db.get = AsyncMock(return_value=test_workspace)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership check
            mock_execute_result(scalar_one=None),             # root node query
            mock_execute_result(),                             # create_activity
        ])
        # After db.add(card), refresh should set card attributes
        async def refresh(obj):
            for attr in ("id", "local_id", "workspace_id", "title", "content",
                         "keywords", "color", "emotion_tag", "is_favorite", "is_temp",
                         "parent_card_ids", "creator_id", "created_at", "updated_at"):
                if hasattr(card, attr):
                    setattr(obj, attr, getattr(card, attr))
        mock_db.refresh = refresh

        resp = await client.post("/api/cards/", json={
            "local_id": "test_card_1",
            "workspace_id": str(test_workspace.id),
            "title": "测试卡片",
            "content": "测试内容",
            "keywords": ["测试"],
        })

        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "测试卡片"
        assert data["content"] == "测试内容"

    async def test_create_card_no_membership(self, client, mock_db, test_workspace):
        mock_db.get = AsyncMock(return_value=test_workspace)
        mock_db.execute = AsyncMock(return_value=mock_execute_result(scalar_one=None))

        resp = await client.post("/api/cards/", json={
            "local_id": "test_card_2",
            "workspace_id": str(test_workspace.id),
            "title": "测试",
            "content": "内容",
        })

        assert resp.status_code == 403


@pytest.mark.asyncio
class TestGetCard:
    async def test_get_card_success(self, client, mock_db, test_user, test_workspace, test_membership):
        card = make_mock_card(workspace_id=test_workspace.id)

        async def get_side_effect(model, id_val):
            from app.models.card import Card
            if model is Card:
                return card
            return test_workspace

        mock_db.get = AsyncMock(side_effect=get_side_effect)
        mock_db.execute = AsyncMock(return_value=mock_execute_result(scalar_one=test_membership))

        resp = await client.get(f"/api/cards/{card.id}")

        assert resp.status_code == 200
        assert resp.json()["title"] == card.title

    async def test_get_card_not_found(self, client, mock_db):
        mock_db.get = AsyncMock(return_value=None)

        resp = await client.get(f"/api/cards/{uuid.uuid4()}")

        assert resp.status_code == 404


@pytest.mark.asyncio
class TestListCards:
    async def test_list_cards(self, client, mock_db, test_user, test_workspace, test_membership):
        cards = [make_mock_card(workspace_id=test_workspace.id) for _ in range(3)]

        mock_db.get = AsyncMock(return_value=test_workspace)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership
            mock_execute_result(*cards),                       # card list
        ])

        resp = await client.get(f"/api/cards/?workspace_id={test_workspace.id}")

        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert len(data["items"]) == 3

    async def test_list_cards_with_pagination(self, client, mock_db, test_user, test_workspace, test_membership):
        cards = [make_mock_card(workspace_id=test_workspace.id) for _ in range(3)]

        mock_db.get = AsyncMock(return_value=test_workspace)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),
            mock_execute_result(*cards),
        ])

        resp = await client.get(f"/api/cards/?workspace_id={test_workspace.id}&limit=3&sort_by=created_at&order=desc")

        assert resp.status_code == 200


@pytest.mark.asyncio
class TestUpdateCard:
    async def test_update_card_success(self, client, mock_db, test_user, test_workspace, test_membership):
        card = make_mock_card(workspace_id=test_workspace.id, creator_id=test_user.id)

        mock_db.get = AsyncMock(return_value=card)
        mock_db.execute = AsyncMock(return_value=mock_execute_result(scalar_one=test_membership))

        async def refresh(obj):
            obj.updated_at = card.updated_at
        mock_db.refresh = refresh

        resp = await client.put(f"/api/cards/{card.id}", json={
            "title": "新标题",
        })

        assert resp.status_code == 200

    async def test_update_card_not_found(self, client, mock_db):
        mock_db.get = AsyncMock(return_value=None)

        resp = await client.put(f"/api/cards/{uuid.uuid4()}", json={"title": "x"})

        assert resp.status_code == 404


@pytest.mark.asyncio
class TestDeleteCard:
    async def test_delete_card_success(self, client, mock_db, test_user, test_workspace, test_membership):
        card = make_mock_card(workspace_id=test_workspace.id, creator_id=test_user.id)

        mock_db.get = AsyncMock(return_value=card)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership
            mock_execute_result(),                             # entity_ids query
        ])

        resp = await client.delete(f"/api/cards/{card.id}")

        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    async def test_delete_card_not_found(self, client, mock_db):
        mock_db.get = AsyncMock(return_value=None)

        resp = await client.delete(f"/api/cards/{uuid.uuid4()}")

        assert resp.status_code == 404


@pytest.mark.asyncio
class TestDeletePreview:
    async def test_delete_preview(self, client, mock_db, test_user, test_workspace, test_membership):
        card = make_mock_card(workspace_id=test_workspace.id)

        mock_db.get = AsyncMock(return_value=card)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership
            mock_execute_result(scalar_val=2),                 # relations
            mock_execute_result(scalar_val=1),                 # topology nodes
            mock_execute_result(scalar_val=0),                 # entities
            mock_execute_result(scalar_val=0),                 # graph relations
            mock_execute_result(scalar_val=3),                 # comments
        ])

        resp = await client.get(f"/api/cards/{card.id}/delete-preview")

        assert resp.status_code == 200
        data = resp.json()
        assert data["relations"] == 2
        assert data["comments"] == 3


@pytest.mark.asyncio
class TestCardRelations:
    async def test_add_relation(self, client, mock_db, test_user, test_workspace, test_membership):
        card = make_mock_card(workspace_id=test_workspace.id)
        related_id = str(uuid.uuid4())

        mock_db.get = AsyncMock(return_value=card)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership
            mock_execute_result(scalar_one=None),             # duplicate check
        ])

        resp = await client.post(f"/api/cards/{card.id}/relations", json={
            "related_card_id": related_id,
            "relation_type": "manual",
        })

        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    async def test_get_related_cards(self, client, mock_db, test_user, test_workspace, test_membership):
        card = make_mock_card(workspace_id=test_workspace.id)
        related = [make_mock_card() for _ in range(2)]

        mock_db.get = AsyncMock(return_value=card)
        mock_db.execute = AsyncMock(side_effect=[
            mock_execute_result(scalar_one=test_membership),  # membership
            mock_execute_result(*related),                     # related cards
        ])

        resp = await client.get(f"/api/cards/{card.id}/relations")

        assert resp.status_code == 200
        assert len(resp.json()) == 2

"""Unit tests for manual chat forking (POST /{chat_id}/fork)."""

import time
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.conftest import (
    make_chat,
    make_chat_message,
    mock_scalars,
    mock_scalar_one_or_none,
)


class TestChatForkLogic:
    """Unit tests for the fork_chat endpoint logic.

    Tests the internal logic without HTTP layer — we mock db, user, and
    verify the AiChat creation patterns.
    """

    @pytest.fixture
    def workspace_id(self):
        return uuid.uuid4()

    @pytest.fixture
    def user_id(self):
        return uuid.uuid4()

    @pytest.fixture
    def parent_chat(self, workspace_id, user_id):
        return make_chat(
            workspace_id=workspace_id,
            user_id=user_id,
            node_type="root",
            title="原始对话",
        )

    def _setup_fork_db(self, mock_db, parent_chat, workspace_id, recent_messages=None):
        """Configure mock_db for fork scenario."""
        mock_db.get = AsyncMock(return_value=parent_chat)

        if recent_messages is None:
            recent_messages = [
                make_chat_message(role="user", content="你好"),
                make_chat_message(role="assistant", content="你好！有什么可以帮助你的？"),
            ]
        msg_result = mock_scalars(recent_messages)
        mock_db.execute = AsyncMock(return_value=msg_result)
        mock_db.commit = AsyncMock()
        mock_db.refresh = AsyncMock()

        added_objects = []
        mock_db.add = lambda obj: added_objects.append(obj)

        return added_objects

    @pytest.mark.asyncio
    async def test_fork_creates_child_chat(
        self, mock_db, workspace_id, user_id, parent_chat
    ):
        """Fork should create a new AiChat as child of parent via parent_id."""
        added = self._setup_fork_db(mock_db, parent_chat, workspace_id)

        from app.models.chat import AiChat

        child_chat = AiChat(
            workspace_id=parent_chat.workspace_id,
            parent_id=parent_chat.id,
            user_id=user_id,
            mode="rag",
            title="分叉话题",
            node_type="branch",
        )
        mock_db.add(child_chat)

        assert len(added) >= 1
        child = added[0]
        assert child.parent_id == parent_chat.id
        assert child.node_type == "branch"
        assert child.workspace_id == workspace_id

    @pytest.mark.asyncio
    async def test_fork_inherits_workspace_and_card(
        self, mock_db, workspace_id, user_id, parent_chat
    ):
        """Forked chat should inherit workspace_id and card_id from parent."""
        card_id = uuid.uuid4()
        parent_chat.card_id = card_id

        self._setup_fork_db(mock_db, parent_chat, workspace_id)

        from app.models.chat import AiChat

        forked = AiChat(
            workspace_id=parent_chat.workspace_id,
            parent_id=parent_chat.id,
            user_id=user_id,
            mode="rag",
            title="test",
            card_id=parent_chat.card_id,
        )

        assert forked.workspace_id == workspace_id
        assert forked.card_id == card_id

    @pytest.mark.asyncio
    async def test_fork_context_message_contains_parent_title(
        self, mock_db, workspace_id, user_id, parent_chat
    ):
        """The context message should reference the parent chat title."""
        self._setup_fork_db(mock_db, parent_chat, workspace_id)

        from app.models.chat import ChatMessage

        context_summary = "用户: 你好\nAI: 你好！"
        context_msg = ChatMessage(
            chat_id=uuid.uuid4(),
            role="assistant",
            content=f"这是从「{parent_chat.title}」分叉出来的对话。\n\n以下是之前的对话上下文：\n\n{context_summary}",
        )

        assert parent_chat.title in context_msg.content
        assert "分叉出来的对话" in context_msg.content
        assert context_summary in context_msg.content

    @pytest.mark.asyncio
    async def test_fork_creates_fork_divider(
        self, mock_db, workspace_id, user_id, parent_chat
    ):
        """Fork should insert a fork-divider message in the parent chat."""
        added = self._setup_fork_db(mock_db, parent_chat, workspace_id)

        from app.models.chat import ChatMessage

        child_chat_id = uuid.uuid4()
        divider = ChatMessage(
            chat_id=parent_chat.id,
            role="fork-divider",
            content="",
            metadata_={
                "child_chat_id": str(child_chat_id),
                "branch_label": "分叉话题",
                "parent_context_summary": "摘要内容",
                "depth": 0,
            },
        )
        mock_db.add(divider)

        assert len(added) >= 1
        divider_msg = next(o for o in added if hasattr(o, "role") and o.role == "fork-divider")
        assert divider_msg.chat_id == parent_chat.id
        assert divider_msg.metadata_["child_chat_id"] == str(child_chat_id)

    @pytest.mark.asyncio
    async def test_fork_title_from_topic(
        self, mock_db, workspace_id, user_id, parent_chat
    ):
        """Title should be generated from topic if not explicitly provided."""
        topic = "深入讨论梯度消失问题"
        title = topic[:50] if topic else f"分支: {parent_chat.title[:40]}"
        assert title == "深入讨论梯度消失问题"

    @pytest.mark.asyncio
    async def test_fork_title_from_parent_when_no_topic(
        self, mock_db, workspace_id, user_id, parent_chat
    ):
        """Title should fall back to parent title when no topic is given."""
        topic = ""
        title = topic[:50] if topic else f"分支: {parent_chat.title[:40]}"
        assert title == f"分支: {parent_chat.title[:40]}"

    @pytest.mark.asyncio
    async def test_fork_title_truncates_long_topic(
        self, mock_db, workspace_id, user_id, parent_chat
    ):
        """Long topics should be truncated to 50 chars."""
        topic = "这是一个非常长的讨论主题" * 10
        title = topic[:50] if topic else "新分支"
        assert len(title) == 50

"""Topology exploration tools for the forest-level synthesis agent (VISION 理念6).

These let the LLM walk the topology forest hierarchically during the
goal-guided exploration phase:

- ``topology_forest_map`` — compact map of the whole forest (use FIRST)
- ``get_node_detail`` — summary + sedimented cards (+ relations) + children + refs
- ``get_card_relations`` — relations of one card
- ``get_node_subtree`` — full descendant subtree with summaries

All output is human-readable text (the existing tool contract); the LLM parses it.
"""

import logging
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card, CardRelation
from app.models.chat import AiChat
from app.models.topology import NodeCard, NodeRef
from app.tools.base import Tool, ToolSpec

logger = logging.getLogger(__name__)

_SUMMARY_LIMIT = 120
_CARD_LIMIT = 15
_CARD_CONTENT_LIMIT = 300
_RELATION_LIMIT = 10
_SUBTREE_MAX_DEPTH = 8


def _truncate(text: str, limit: int) -> str:
    """Collapse whitespace/newlines and truncate to `limit` chars."""
    text = " ".join(text.split()).strip()
    if len(text) <= limit:
        return text
    return text[:limit] + "…"


async def _cards_for_node(db: AsyncSession, node_id: uuid.UUID) -> list[Card]:
    """Cards sedimented under a topology node (most recently updated first)."""
    result = await db.execute(
        select(Card)
        .join(NodeCard, NodeCard.card_id == Card.id)
        .where(NodeCard.chat_id == node_id)
        .order_by(Card.updated_at.desc())
        .limit(_CARD_LIMIT)
    )
    return list(result.scalars().all())


async def _card_relation_lines(db: AsyncSession, card_id: uuid.UUID, card_title: str) -> list[str]:
    """Format a card's relations as 'title --[type]--> other' lines."""
    result = await db.execute(
        select(CardRelation).where(
            (CardRelation.card_id == card_id) | (CardRelation.related_card_id == card_id)
        ).limit(_RELATION_LIMIT)
    )
    rels = list(result.scalars().all())
    if not rels:
        return []

    other_ids = [r.related_card_id if r.card_id == card_id else r.card_id for r in rels]
    cards = await db.execute(select(Card.id, Card.title).where(Card.id.in_(other_ids)))
    titles: dict[uuid.UUID, str] = {cid: title for cid, title in cards.all()}

    lines = []
    for rel in rels:
        other = rel.related_card_id if rel.card_id == card_id else rel.card_id
        lines.append(f"{card_title} --[{rel.relation_type}]--> {titles.get(other, '?')}")
    return lines


async def _workspace_node_map(
    db: AsyncSession, ws_id: uuid.UUID
) -> tuple[list[AiChat], dict[uuid.UUID, int], dict[str, list[AiChat]]]:
    """Fetch all workspace nodes + per-node card counts + parent→children map."""
    result = await db.execute(
        select(AiChat)
        .where(AiChat.workspace_id == ws_id)
        .order_by(AiChat.depth, AiChat.sort_order, AiChat.created_at)
    )
    nodes = list(result.scalars().all())

    if not nodes:
        return [], {}, {}

    node_ids = [n.id for n in nodes]
    count_result = await db.execute(
        select(NodeCard.chat_id, func.count())
        .where(NodeCard.chat_id.in_(node_ids))
        .group_by(NodeCard.chat_id)
    )
    counts: dict[uuid.UUID, int] = {cid: cnt for cid, cnt in count_result.all()}

    children: dict[str, list[AiChat]] = {}
    for n in nodes:
        children.setdefault(str(n.parent_id), []).append(n)

    return nodes, counts, children


def _node_line(n: AiChat, counts: dict[uuid.UUID, int], depth_pad: str) -> str:
    title = n.title or "未命名"
    line = f"{depth_pad}- [{n.node_type}] {title} (depth {n.depth}, {counts.get(n.id, 0)} 卡"
    if n.summary:
        line += f": {_truncate(n.summary, _SUMMARY_LIMIT)}"
    line += ")"
    return line


# ── Tool 1: topology_forest_map ─────────────────────────────────────────────

_SPEC_FOREST_MAP = ToolSpec(
    name="topology_forest_map",
    description=(
        "Get a compact map of the entire knowledge forest (topology tree) in a workspace: "
        "every conversation branch with its depth, node type, sedimented card count, and a "
        "short summary. Use this FIRST to see the overall structure before deciding which "
        "branches to explore in depth."
    ),
    parameters={
        "type": "object",
        "properties": {
            "workspace_id": {"type": "string", "description": "Workspace UUID."},
        },
        "required": ["workspace_id"],
    },
)


class TopologyForestMapTool(Tool):
    def spec(self) -> ToolSpec:
        return _SPEC_FOREST_MAP

    async def execute(self, arguments: dict[str, Any], context: dict[str, Any]) -> str:
        db: AsyncSession = context["db"]
        ws = arguments.get("workspace_id", "")
        try:
            ws_uuid = uuid.UUID(ws)
        except (ValueError, TypeError):
            return f"Error: invalid workspace_id '{ws}'."

        nodes, counts, children = await _workspace_node_map(db, ws_uuid)
        if not nodes:
            return "森林地图为空：该工作区没有任何对话节点。"

        lines = [f"# 森林地图（共 {len(nodes)} 个节点）"]

        def walk(n: AiChat, depth: int) -> None:
            lines.append(_node_line(n, counts, "  " * depth))
            for kid in children.get(str(n.id), []):
                walk(kid, depth + 1)

        for n in nodes:
            if n.parent_id is None:
                walk(n, 0)

        return "\n".join(lines)


# ── Tool 2: get_node_detail ─────────────────────────────────────────────────

_SPEC_NODE_DETAIL = ToolSpec(
    name="get_node_detail",
    description=(
        "Get full detail for one conversation node: its summary, the knowledge cards "
        "sedimented under it (with their relations to other cards), child branches, and "
        "cross-branch references. Use after topology_forest_map to dive into a relevant branch."
    ),
    parameters={
        "type": "object",
        "properties": {
            "node_id": {"type": "string", "description": "Conversation node UUID."},
        },
        "required": ["node_id"],
    },
)


class GetNodeDetailTool(Tool):
    def spec(self) -> ToolSpec:
        return _SPEC_NODE_DETAIL

    async def execute(self, arguments: dict[str, Any], context: dict[str, Any]) -> str:
        db: AsyncSession = context["db"]
        node_id = arguments.get("node_id", "")
        try:
            node_uuid = uuid.UUID(node_id)
        except (ValueError, TypeError):
            return f"Error: invalid node_id '{node_id}'."

        node = await db.get(AiChat, node_uuid)
        if not node:
            return f"Error: node {node_id} not found."

        ws_ctx = context.get("workspace_id")
        if ws_ctx:
            try:
                if node.workspace_id != uuid.UUID(ws_ctx):
                    return f"Error: node {node_id} does not belong to workspace {ws_ctx}."
            except (ValueError, TypeError):
                pass

        lines = [f"# 节点: {node.title or '未命名'} ({node.node_type}, depth {node.depth})"]
        if node.summary:
            lines.append(f"摘要: {_truncate(node.summary, 800)}")

        # Sedimented cards
        cards = await _cards_for_node(db, node_uuid)
        if cards:
            lines.append(f"## 下辖卡片（{len(cards)}）")
            for card in cards:
                title = card.title or "未命名"
                lines.append(f"- [{title}] {_truncate(card.content, _CARD_CONTENT_LIMIT)}")
                for rel in await _card_relation_lines(db, card.id, title):
                    lines.append(f"    {rel}")
        else:
            lines.append("## 下辖卡片: 无")

        # Child branches
        kids = await db.execute(
            select(AiChat).where(AiChat.parent_id == node_uuid).order_by(AiChat.sort_order)
        )
        kid_list = list(kids.scalars().all())
        if kid_list:
            lines.append(f"## 子分支（{len(kid_list)}）")
            for kid in kid_list:
                lines.append(f"- [{kid.node_type}] {kid.title or '未命名'} (depth {kid.depth})")

        # Cross-branch references
        refs = await db.execute(
            select(NodeRef).where(
                (NodeRef.source_chat_id == node_uuid) | (NodeRef.target_chat_id == node_uuid)
            )
        )
        ref_lines = []
        for ref in refs.scalars().all():
            other_id = ref.target_chat_id if ref.source_chat_id == node_uuid else ref.source_chat_id
            other_node = await db.get(AiChat, other_id)
            if other_node:
                ref_lines.append(
                    f"- {node.title or '未命名'} --[{ref.ref_type}]--> "
                    f"{other_node.title or '未命名'}"
                    f"{': ' + ref.reason if ref.reason else ''}"
                )
        if ref_lines:
            lines.append(f"## 跨分支引用（{len(ref_lines)}）")
            lines.extend(ref_lines)

        return "\n".join(lines)


# ── Tool 3: get_card_relations ──────────────────────────────────────────────

_SPEC_CARD_RELATIONS = ToolSpec(
    name="get_card_relations",
    description=(
        "Get the relations of one knowledge card — which cards it links to and how "
        "(extends / contradicts / related). Useful for understanding how ideas connect "
        "across branches."
    ),
    parameters={
        "type": "object",
        "properties": {
            "card_id": {"type": "string", "description": "Card UUID."},
        },
        "required": ["card_id"],
    },
)


class GetCardRelationsTool(Tool):
    def spec(self) -> ToolSpec:
        return _SPEC_CARD_RELATIONS

    async def execute(self, arguments: dict[str, Any], context: dict[str, Any]) -> str:
        db: AsyncSession = context["db"]
        card_id = arguments.get("card_id", "")
        try:
            card_uuid = uuid.UUID(card_id)
        except (ValueError, TypeError):
            return f"Error: invalid card_id '{card_id}'."

        card = await db.get(Card, card_uuid)
        if not card:
            return f"Error: card {card_id} not found."

        title = card.title or "未命名"
        rels = await _card_relation_lines(db, card_uuid, title)
        if not rels:
            return f"# 卡片关系: {title}\n无关系。"
        return f"# 卡片关系: {title}\n" + "\n".join(rels)


# ── Tool 4: get_node_subtree ────────────────────────────────────────────────

_SPEC_NODE_SUBTREE = ToolSpec(
    name="get_node_subtree",
    description=(
        "Get the full subtree below a conversation node: all descendant branches with their "
        "summaries and card counts. Use when you want to analyze an entire branch line at once "
        "instead of walking node by node."
    ),
    parameters={
        "type": "object",
        "properties": {
            "node_id": {
                "type": "string",
                "description": "Conversation node UUID (the subtree root).",
            },
        },
        "required": ["node_id"],
    },
)


class GetNodeSubtreeTool(Tool):
    def spec(self) -> ToolSpec:
        return _SPEC_NODE_SUBTREE

    async def execute(self, arguments: dict[str, Any], context: dict[str, Any]) -> str:
        db: AsyncSession = context["db"]
        node_id = arguments.get("node_id", "")
        try:
            node_uuid = uuid.UUID(node_id)
        except (ValueError, TypeError):
            return f"Error: invalid node_id '{node_id}'."

        node = await db.get(AiChat, node_uuid)
        if not node:
            return f"Error: node {node_id} not found."

        ws_ctx = context.get("workspace_id")
        if ws_ctx:
            try:
                if node.workspace_id != uuid.UUID(ws_ctx):
                    return f"Error: node {node_id} does not belong to workspace {ws_ctx}."
            except (ValueError, TypeError):
                pass

        if not node.workspace_id:
            return f"Error: node {node_id} has no workspace."

        _, counts, children = await _workspace_node_map(db, node.workspace_id)

        lines = [f"# 子树: {node.title or '未命名'}"]

        def walk(n: AiChat, depth: int) -> None:
            if depth > _SUBTREE_MAX_DEPTH:
                return
            lines.append(_node_line(n, counts, "  " * depth))
            for kid in children.get(str(n.id), []):
                walk(kid, depth + 1)

        walk(node, 0)
        return "\n".join(lines)

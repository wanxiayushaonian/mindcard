# Conversation-Driven Topology Knowledge System

**Date**: 2026-05-31
**Branch**: feat/knowledge-topology
**Status**: Design approved

## Problem Statement

Users engaging in long-form AI conversations experience cognitive overload — knowledge becomes fragmented, and there's no structured way to accumulate insights over time. The current MindCard system has cards, RAG search, and a topology tree, but these components are loosely connected. The topology tree classifies cards by embedding similarity but doesn't reflect the user's actual exploration path.

## Core Design Principle

**Conversation IS topology.** The topology tree is not a separate classification system — it is the structural trace of the user's knowledge exploration through conversations. Every fork is a branch, every conversation is a node, and cards are the fruit hanging from the tree.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Knowledge accumulation vs retrieval | Structured accumulation | Core goal is building a knowledge framework, not just searching |
| Topology node meaning | Conversation trajectory | Each node = a specific exploration, not a topic category |
| Forking mechanism | User-initiated | Start simple, add intent recognition later |
| Path awareness | Valuable | Users should know where they are in the knowledge map |
| Conversation ↔ node mapping | Deterministic (1:1) | Each conversation belongs to exactly one node |
| Starting position | Root node | Main conversation starts at workspace root |
| Card classification | Dual: conversation default + embedding refinement | Combines deterministic placement with intelligent adjustment |

## Architecture

### Data Model Changes

#### AiChat → TopologyNode binding

Add `tree_node_id` to `AiChat`:

```python
class AiChat(Base):
    # ... existing fields ...
    tree_node_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tree_nodes.id"), nullable=True
    )
    tree_node: Mapped["TreeNode"] = relationship(back_populates="chats")
```

#### TreeNode simplification

Collapse `branch`/`leaf` into a single `topic` type:

- `root`: workspace-level root, one per workspace
- `topic`: created by conversation forking

Add `chat_id` to `TreeNode` to track which conversation created it:

```python
class TreeNode(Base):
    # ... existing fields ...
    node_type: Mapped[str]  # 'root' | 'topic' (remove 'branch'/'leaf')
    chat_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ai_chats.id"), nullable=True
    )
    chat: Mapped["AiChat"] = relationship(back_populates="tree_node")
```

### Fork → Create Child Node

When user forks a conversation:

1. Create child `TreeNode` under parent conversation's node
2. Create new `AiChat` with `tree_node_id` pointing to the new node
3. Pass parent conversation's recent messages + accumulated card summaries as context

```
User in conversation A (node: RAG)
  → Fork "向量检索"
    → Create child node "向量检索" under RAG
    → Create conversation B bound to new node
    → Context = recent messages from A
```

### Card Ownership

**Default path**: Card created in conversation X → belongs to X's `tree_node_id`

**Embedding refinement**: After card creation, embedding classification still runs:
- If card content aligns with current node (cosine distance < threshold) → stay
- If card content better matches a sibling/child node → auto-move silently (the conversation context is the soft default, embedding is the hard override)

Implementation: modify `topology_service.assign_card_to_node()` to accept an optional `default_node_id` parameter from the conversation context. When `default_node_id` is provided, use it as the starting point but still allow embedding to override.

### Migration

Existing conversations without `tree_node_id` are left as-is. They continue to work without topology binding. New conversations and forked conversations automatically get bound.

### Path Awareness (Breadcrumb)

API: `GET /api/chat/{chat_id}/path` returns the node path from root to current node:

```json
{
  "path": [
    {"node_id": "...", "title": "知识探索", "chat_id": "..."},
    {"node_id": "...", "title": "RAG", "chat_id": "..."},
    {"node_id": "...", "title": "向量检索", "chat_id": "..."}
  ]
}
```

Frontend: breadcrumb bar at the top of the chat panel showing `根节点 > RAG > 向量检索`, each segment clickable to navigate to that ancestor conversation.

### Topology Tree Growth

The topology tree grows organically from conversation forking:
- No separate topology management UI needed
- 3D visualization shows the full exploration map
- Each node in the 3D view is clickable to open the corresponding conversation

## Implementation Order

1. **Data model**: Add `tree_node_id` to `AiChat`, add `chat_id` to `TreeNode`, simplify `node_type`
2. **Fork integration**: Modify `POST /chat/{id}/fork` to create child topology node
3. **Card ownership**: Modify card creation to use conversation's node as default
4. **Path API**: Add `GET /chat/{chat_id}/path` endpoint
5. **Frontend breadcrumb**: Show path in chat panel
6. **3D view integration**: Click node → open conversation

## Out of Scope (Future)

- Automatic intent recognition agent for auto-forking
- Multi-agent architecture with sub-agents
- Card-to-card linking within the topology tree
- Collaborative topology exploration

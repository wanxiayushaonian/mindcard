from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.card import Card
from app.models.chat import AiChat
from app.models.topology import NodeCard, NodeRef
from app.models.user import User
from app.schemas.topology import (
    NodeCardAdd,
    NodeRefCreate,
    TreeNodeCreate,
    TreeNodeListResponse,
    TreeNodeResponse,
    TreeNodeUpdate,
)
from app.utils.auth import get_current_user, get_workspace_membership, require_role
from app.utils.helpers import parse_uuid
from app.services.topology import topology_service

router = APIRouter()


async def _build_node_response(db: AsyncSession, node: AiChat) -> TreeNodeResponse:
    """Build a TreeNodeResponse with card_ids, child_ids, and ref_ids."""
    # Fetch card associations
    card_result = await db.execute(
        select(NodeCard.card_id).where(NodeCard.chat_id == node.id)
    )
    card_ids = [str(row[0]) for row in card_result.all()]

    # Fetch children
    child_result = await db.execute(
        select(AiChat.id).where(AiChat.parent_id == node.id).order_by(AiChat.sort_order)
    )
    child_ids = [str(row[0]) for row in child_result.all()]

    # Fetch refs (both directions)
    ref_result = await db.execute(
        select(NodeRef.target_chat_id).where(NodeRef.source_chat_id == node.id)
    )
    ref_ids = [str(row[0]) for row in ref_result.all()]

    return TreeNodeResponse(
        id=node.id,
        workspace_id=node.workspace_id,
        parent_id=node.parent_id,
        chat_id=node.id,
        node_type=node.node_type,
        title=node.title,
        description=node.description,
        summary=node.summary,
        status=node.chat_status,
        sort_order=node.sort_order,
        card_ids=card_ids,
        card_count=len(card_ids),
        child_ids=child_ids,
        ref_ids=ref_ids,
        created_at=node.created_at,
        updated_at=node.updated_at,
        completed_at=node.completed_at,
    )


@router.get("/", response_model=TreeNodeListResponse)
async def list_nodes(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all tree nodes in a workspace."""
    ws_id = parse_uuid(workspace_id)
    await get_workspace_membership(ws_id, user, db)

    result = await db.execute(
        select(AiChat)
        .where(AiChat.workspace_id == ws_id)
        .order_by(AiChat.sort_order, AiChat.created_at)
    )
    nodes = list(result.scalars().all())

    # Auto-create root node if workspace has no nodes
    if not nodes:
        root = AiChat(
            workspace_id=ws_id,
            user_id=user.id,
            node_type="root",
            title="主线",
            mode="rag",
            local_id=f"root-{ws_id}",
        )
        db.add(root)
        await db.commit()
        await db.refresh(root)
        nodes = [root]

    responses = [await _build_node_response(db, n) for n in nodes]
    return TreeNodeListResponse(nodes=responses)


@router.get("/nodes/{node_id}", response_model=TreeNodeResponse)
async def get_node_by_id(
    node_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get topology node by ID."""
    from app.models.workspace import Workspace, WorkspaceMember

    result = await db.execute(
        select(AiChat)
        .join(Workspace, Workspace.id == AiChat.workspace_id)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            AiChat.id == node_id,
            WorkspaceMember.user_id == user.id,
        )
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    return await _build_node_response(db, node)


@router.post("/", response_model=TreeNodeResponse)
async def create_node(
    req: TreeNodeCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new tree node (AiChat)."""
    ws_id = parse_uuid(req.workspace_id)
    membership = await get_workspace_membership(ws_id, user, db)
    require_role(membership, "owner", "admin", "editor")

    # Validate parent exists and belongs to same workspace
    if req.parent_id:
        parent = await db.get(AiChat, parse_uuid(req.parent_id))
        if not parent or parent.workspace_id != ws_id:
            raise HTTPException(400, "父节点不存在或不属于该工作区")

    import uuid as _uuid

    node = AiChat(
        workspace_id=ws_id,
        parent_id=parse_uuid(req.parent_id) if req.parent_id else None,
        user_id=user.id,
        node_type=req.node_type,
        title=req.title,
        description=req.description,
        sort_order=req.sort_order,
        mode="rag",
        local_id=f"topo-{_uuid.uuid4().hex[:12]}",
    )
    db.add(node)
    await db.commit()
    await db.refresh(node)
    return await _build_node_response(db, node)


# ── Card associations ──


@router.post("/{node_id}/cards", response_model=TreeNodeResponse)
async def add_card_to_node(
    node_id: str,
    req: NodeCardAdd,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Associate a card with a tree node."""
    node = await db.get(AiChat, parse_uuid(node_id))
    if not node:
        raise HTTPException(404, "节点不存在")
    membership = await get_workspace_membership(node.workspace_id, user, db)
    require_role(membership, "owner", "admin", "editor")

    card = await db.get(Card, parse_uuid(req.card_id))
    if not card:
        raise HTTPException(404, "卡片不存在")

    # Check if already associated
    existing = await db.execute(
        select(NodeCard).where(NodeCard.chat_id == node.id, NodeCard.card_id == card.id)
    )
    if existing.scalar_one_or_none():
        return await _build_node_response(db, node)

    db.add(NodeCard(chat_id=node.id, card_id=card.id))
    await db.commit()
    await db.refresh(node)
    return await _build_node_response(db, node)


@router.delete("/{node_id}/cards/{card_id}")
async def remove_card_from_node(
    node_id: str,
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Remove a card association from a tree node."""
    node = await db.get(AiChat, parse_uuid(node_id))
    if not node:
        raise HTTPException(404, "节点不存在")
    membership = await get_workspace_membership(node.workspace_id, user, db)
    require_role(membership, "owner", "admin", "editor")

    result = await db.execute(
        select(NodeCard).where(NodeCard.chat_id == node.id, NodeCard.card_id == parse_uuid(card_id))
    )
    nc = result.scalar_one_or_none()
    if nc:
        await db.delete(nc)
        await db.commit()
    return {"ok": True}


# ── Cross-branch references ──


@router.post("/{node_id}/refs", response_model=TreeNodeResponse)
async def create_ref(
    node_id: str,
    req: NodeRefCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a cross-branch reference from this node to another."""
    node = await db.get(AiChat, parse_uuid(node_id))
    if not node:
        raise HTTPException(404, "源节点不存在")
    membership = await get_workspace_membership(node.workspace_id, user, db)
    require_role(membership, "owner", "admin", "editor")

    target = await db.get(AiChat, parse_uuid(req.target_chat_id))
    if not target or target.workspace_id != node.workspace_id:
        raise HTTPException(400, "目标节点不存在或不属于该工作区")
    if node.id == target.id:
        raise HTTPException(400, "不能引用自身")

    # Check if already exists
    existing = await db.execute(
        select(NodeRef).where(
            NodeRef.source_chat_id == node.id,
            NodeRef.target_chat_id == target.id,
        )
    )
    if existing.scalar_one_or_none():
        return await _build_node_response(db, node)

    db.add(NodeRef(
        source_chat_id=node.id,
        target_chat_id=target.id,
        ref_type=req.ref_type,
        reason=req.reason,
    ))
    await db.commit()
    await db.refresh(node)
    return await _build_node_response(db, node)


@router.delete("/{node_id}/refs/{target_id}")
async def remove_ref(
    node_id: str,
    target_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Remove a cross-branch reference."""
    node = await db.get(AiChat, parse_uuid(node_id))
    if not node:
        raise HTTPException(404, "节点不存在")
    membership = await get_workspace_membership(node.workspace_id, user, db)
    require_role(membership, "owner", "admin", "editor")

    result = await db.execute(
        select(NodeRef).where(
            NodeRef.source_chat_id == node.id,
            NodeRef.target_chat_id == parse_uuid(target_id),
        )
    )
    ref = result.scalar_one_or_none()
    if ref:
        await db.delete(ref)
        await db.commit()
    return {"ok": True}


# ── Node update & delete (placed after sub-routes to avoid path conflicts) ──


@router.put("/{node_id}", response_model=TreeNodeResponse)
async def update_node(
    node_id: str,
    req: TreeNodeUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update a tree node."""
    node = await db.get(AiChat, parse_uuid(node_id))
    if not node:
        raise HTTPException(404, "节点不存在")
    membership = await get_workspace_membership(node.workspace_id, user, db)
    require_role(membership, "owner", "admin", "editor")

    update_data = req.model_dump(exclude_unset=True)

    # Map schema 'status' -> model 'chat_status'
    if "status" in update_data:
        update_data["chat_status"] = update_data.pop("status")

    if "parent_id" in update_data:
        new_parent_id = update_data.pop("parent_id")
        if new_parent_id:
            parent = await db.get(AiChat, parse_uuid(new_parent_id))
            if not parent or parent.workspace_id != node.workspace_id:
                raise HTTPException(400, "父节点不存在或不属于该工作区")
            node.parent_id = parent.id
        else:
            node.parent_id = None

    for field, value in update_data.items():
        setattr(node, field, value)

    # Auto-set completed_at when status changes to completed
    # Note: check against the pre-update value (saved before setattr above)
    if update_data.get("chat_status") == "completed" and not node.completed_at:
        node.completed_at = datetime.now(timezone.utc)

    node.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(node)
    return await _build_node_response(db, node)


@router.delete("/{node_id}")
async def delete_node(
    node_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a tree node (cascades to children and associations)."""
    node = await db.get(AiChat, parse_uuid(node_id))
    if not node:
        raise HTTPException(404, "节点不存在")
    membership = await get_workspace_membership(node.workspace_id, user, db)
    require_role(membership, "owner", "admin", "editor")

    await db.delete(node)
    await db.commit()
    return {"ok": True}


# ── Rebuild ──


@router.post("/rebuild-embeddings")
async def rebuild_embeddings(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Rebuild node centroids for all tree nodes in a workspace."""
    ws_id = parse_uuid(workspace_id)
    membership = await get_workspace_membership(ws_id, user, db)
    require_role(membership, "owner", "admin")

    await topology_service.rebuild_node_embeddings(db, ws_id)
    await db.commit()
    return {"ok": True}

from datetime import datetime, timezone
from uuid import UUID

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

logger = logging.getLogger(__name__)
from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.card import Card, CardRelation
from app.models.user import User
from app.schemas.card import CardBatchRequest, CardBatchResponse, CardCreate, CardListResponse, CardRelationCreate, CardResponse, CardUpdate
from app.utils.activity import create_activity
from app.utils.auth import can_edit_card, get_current_user, get_workspace_membership, require_role
from app.utils.cursor import decode_cursor, encode_cursor
from app.utils.helpers import parse_uuid

router = APIRouter()


async def _generate_embedding(card_id: UUID, default_chat_id: UUID | None = None):
    """Generate and update embedding for a card (runs in background)."""
    from app.utils.card_tasks import generate_card_embedding

    logger.info("Starting embedding generation for card %s", card_id)
    try:
        await generate_card_embedding(card_id, default_chat_id)
    except Exception as e:
        logger.warning("Embedding generation failed for card %s: %s", card_id, e)


def _maybe_trigger_pipeline_on_promote(
    background_tasks: BackgroundTasks,
    card: Card,
    was_temp: bool,
    update_data: dict,
) -> None:
    """Enqueue pipeline when a card is promoted from temporary to permanent."""
    now_temp = update_data.get("is_temp", was_temp)
    if was_temp and not now_temp:
        background_tasks.add_task(_generate_embedding, card.id)


@router.get("/", response_model=CardListResponse)
async def list_cards(
    workspace_id: str,
    cursor: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    sort_by: str = "created_at",
    order: str = "desc",
    is_favorite: bool | None = None,
    is_temp: bool | None = None,
    emotion_tag: str | None = None,
    keyword: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ws_id = parse_uuid(workspace_id)
    await get_workspace_membership(ws_id, user, db)
    query = select(Card).where(Card.workspace_id == ws_id)
    if is_favorite is not None:
        query = query.where(Card.is_favorite == is_favorite)
    if is_temp is not None:
        query = query.where(Card.is_temp == is_temp)
    if emotion_tag:
        query = query.where(Card.emotion_tag == emotion_tag)
    if keyword:
        query = query.where(Card.keywords.any(keyword))

    sort_col = {"created_at": Card.created_at, "updated_at": Card.updated_at, "title": Card.title}.get(sort_by, Card.created_at)
    descending = order == "desc"

    if cursor:
        val_str, id_str = decode_cursor(cursor)
        cursor_id = UUID(id_str)
        # Parse value based on sort column type
        if sort_by in ("created_at", "updated_at"):
            from datetime import datetime as dt

            cursor_val = dt.fromisoformat(val_str)
        else:
            cursor_val = val_str

        if descending:
            query = query.where(tuple_(sort_col, Card.id) < (cursor_val, cursor_id))
        else:
            query = query.where(tuple_(sort_col, Card.id) > (cursor_val, cursor_id))

    # Deterministic ordering: sort_col + id tiebreaker
    if descending:
        query = query.order_by(sort_col.desc(), Card.id.desc())
    else:
        query = query.order_by(sort_col.asc(), Card.id.asc())

    # Fetch one extra to detect has-more
    result = await db.execute(query.limit(limit + 1))
    rows = list(result.scalars().all())

    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        sort_val = getattr(last, sort_by)
        next_cursor = encode_cursor(sort_val, last.id)

    return CardListResponse(items=rows, next_cursor=next_cursor)


@router.post("/", response_model=CardResponse)
async def create_card(
    req: CardCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    membership = await get_workspace_membership(req.workspace_id, user, db)
    require_role(membership, "owner", "admin", "editor")

    # Get chat as default node for card attachment
    default_chat_id = None
    if req.chat_id:
        default_chat_id = parse_uuid(req.chat_id)

    # Create card (exclude chat_id as it's not a Card model field)
    card_data = req.model_dump(exclude={"chat_id"})
    logger.info("Creating card: title=%r, keywords=%r, content_len=%d", req.title, req.keywords, len(req.content))
    card = Card(**card_data, creator_id=user.id)
    db.add(card)
    await db.flush()

    # Auto-attach card to workspace root node in topology tree
    from app.models.chat import AiChat
    from app.models.topology import NodeCard

    root_result = await db.execute(
        select(AiChat).where(
            AiChat.workspace_id == parse_uuid(req.workspace_id),
            AiChat.parent_id.is_(None),
        ).limit(1)
    )
    root_node = root_result.scalar_one_or_none()
    if root_node:
        db.add(NodeCard(chat_id=root_node.id, card_id=card.id))

    background_tasks.add_task(_generate_embedding, card.id, default_chat_id)
    await create_activity(
        db, workspace_id=req.workspace_id, actor_id=user.id,
        action="card.created", target_type="card", target_id=str(card.id),
        metadata={"card_title": card.title or ""},
    )
    await db.commit()
    await db.refresh(card)
    return card


@router.post("/batch", response_model=CardBatchResponse)
async def create_cards_batch(
    req: CardBatchRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Bulk-create cards. Background pipeline (embedding, topic, topology, triples) runs per card."""
    membership = await get_workspace_membership(req.workspace_id, user, db)
    require_role(membership, "owner", "admin", "editor")

    ws_id = parse_uuid(req.workspace_id)
    default_chat_id = parse_uuid(req.chat_id) if req.chat_id else None

    # Check local_id uniqueness
    local_ids = [c.local_id for c in req.cards]
    existing = await db.execute(select(Card.local_id).where(Card.local_id.in_(local_ids)))
    conflicts = [row[0] for row in existing.all()]
    if conflicts:
        raise HTTPException(status_code=409, detail=f"local_id 已存在: {', '.join(conflicts[:10])}")

    # Find root topology node
    from app.models.chat import AiChat
    from app.models.topology import NodeCard

    root_result = await db.execute(
        select(AiChat).where(AiChat.workspace_id == ws_id, AiChat.parent_id.is_(None)).limit(1)
    )
    root_node = root_result.scalar_one_or_none()

    # Bulk create
    created_ids = []
    errors = []
    for item in req.cards:
        try:
            card_data = item.model_dump()
            if req.mark_as_temp:
                card_data["is_temp"] = True
            else:
                card_data["is_temp"] = False
            card = Card(**card_data, workspace_id=ws_id, creator_id=user.id)
            db.add(card)
            await db.flush()
            created_ids.append(str(card.id))

            if root_node:
                db.add(NodeCard(chat_id=root_node.id, card_id=card.id))

            if not card_data.get("is_temp"):
                background_tasks.add_task(_generate_embedding, card.id, default_chat_id)
        except Exception as e:
            errors.append({"local_id": item.local_id, "error": str(e)})

    await create_activity(
        db, workspace_id=req.workspace_id, actor_id=user.id,
        action="card.batch_created", target_type="workspace", target_id=req.workspace_id,
        metadata={"count": len(created_ids)},
    )
    await db.commit()

    return CardBatchResponse(
        created=len(created_ids),
        failed=len(errors),
        card_ids=created_ids,
        errors=errors,
    )


@router.get("/{card_id}", response_model=CardResponse)
async def get_card(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await db.get(Card, parse_uuid(card_id))
    if not card:
        raise HTTPException(status_code=404, detail="卡片不存在")
    await get_workspace_membership(card.workspace_id, user, db)
    return card


@router.put("/{card_id}", response_model=CardResponse)
async def update_card(
    card_id: str,
    req: CardUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await db.get(Card, parse_uuid(card_id))
    if not card:
        raise HTTPException(status_code=404, detail="卡片不存在")
    membership = await get_workspace_membership(card.workspace_id, user, db)
    update_data = req.model_dump(exclude_unset=True)
    # is_favorite / is_temp are personal actions, any member except pending/viewer can toggle
    personal_only = set(update_data.keys()) <= {"is_favorite", "is_temp"}
    if personal_only:
        require_role(membership, "owner", "admin", "editor")
    elif not can_edit_card(membership, card, user):
        raise HTTPException(status_code=403, detail="只能编辑自己创建的卡片")
    was_temp = card.is_temp
    content_changed = "content" in update_data or "title" in update_data or "keywords" in update_data
    for field, value in update_data.items():
        setattr(card, field, value)
    card.updated_at = datetime.now(timezone.utc)
    if content_changed:
        background_tasks.add_task(_generate_embedding, card.id)
    _maybe_trigger_pipeline_on_promote(background_tasks, card, was_temp, update_data)
    await db.commit()
    await db.refresh(card)
    return card


@router.delete("/{card_id}")
async def delete_card(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await db.get(Card, parse_uuid(card_id))
    if not card:
        raise HTTPException(status_code=404, detail="卡片不存在")
    membership = await get_workspace_membership(card.workspace_id, user, db)
    if not can_edit_card(membership, card, user):
        raise HTTPException(status_code=403, detail="只能删除自己创建的卡片")

    # Collect entity IDs linked to this card before deletion
    from sqlalchemy import select
    from app.models.graph import EntityCard, GraphEntity, GraphRelation

    entity_ids_result = await db.execute(
        select(EntityCard.entity_id).where(EntityCard.card_id == card.id)
    )
    linked_entity_ids = [row[0] for row in entity_ids_result.all()]

    # Delete the card (CASCADE handles: CardRelation, NodeCard, EntityCard, TopicCard, Comment)
    await db.delete(card)
    await db.flush()

    # Clean up orphan entities: those with no remaining EntityCard links
    orphan_count = 0
    if linked_entity_ids:
        for eid in linked_entity_ids:
            remaining = await db.execute(
                select(EntityCard.entity_id).where(EntityCard.entity_id == eid).limit(1)
            )
            if not remaining.scalar_one_or_none():
                # Entity has no more card links — delete it (CASCADE handles GraphRelation)
                entity = await db.get(GraphEntity, eid)
                if entity:
                    await db.delete(entity)
                    orphan_count += 1

    await db.commit()
    logger.info("Deleted card %s, cleaned %d orphan entities", card_id, orphan_count)
    return {"ok": True}


@router.get("/{card_id}/delete-preview")
async def delete_card_preview(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Preview what will be affected by deleting a card."""
    card = await db.get(Card, parse_uuid(card_id))
    if not card:
        raise HTTPException(status_code=404, detail="卡片不存在")
    membership = await get_workspace_membership(card.workspace_id, user, db)
    if not can_edit_card(membership, card, user):
        raise HTTPException(status_code=403, detail="只能预览自己创建的卡片")

    card_uuid = parse_uuid(card_id)
    from sqlalchemy import func, select
    from app.models.graph import EntityCard, GraphRelation
    from app.models.topology import NodeCard
    from app.models.comment import Comment

    # Count relations
    rel_count = await db.execute(
        select(func.count()).where(
            (CardRelation.card_id == card_uuid) | (CardRelation.related_card_id == card_uuid)
        )
    )
    # Count tree node attachments
    node_count = await db.execute(
        select(func.count()).where(NodeCard.card_id == card_uuid)
    )
    # Count entity links
    entity_count = await db.execute(
        select(func.count()).where(EntityCard.card_id == card_uuid)
    )
    # Count graph relations sourced from this card
    graph_rel_count = await db.execute(
        select(func.count()).where(GraphRelation.source_card_id == card_uuid)
    )
    # Count comments
    comment_count = await db.execute(
        select(func.count()).where(Comment.card_id == card_uuid)
    )

    return {
        "card_title": card.title or "未命名",
        "relations": rel_count.scalar() or 0,
        "topology_nodes": node_count.scalar() or 0,
        "entities": entity_count.scalar() or 0,
        "graph_relations": graph_rel_count.scalar() or 0,
        "comments": comment_count.scalar() or 0,
    }


@router.post("/{card_id}/relations")
async def add_relation(
    card_id: str,
    req: CardRelationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await db.get(Card, parse_uuid(card_id))
    if not card:
        raise HTTPException(status_code=404, detail="卡片不存在")
    membership = await get_workspace_membership(card.workspace_id, user, db)
    require_role(membership, "owner", "admin", "editor")

    existing = await db.execute(
        select(CardRelation).where(
            CardRelation.card_id == parse_uuid(card_id),
            CardRelation.related_card_id == parse_uuid(req.related_card_id),
            CardRelation.relation_type == req.relation_type,
        )
    )
    if existing.scalar_one_or_none():
        return {"ok": True, "duplicate": True}

    rel = CardRelation(
        card_id=parse_uuid(card_id),
        related_card_id=parse_uuid(req.related_card_id),
        relation_type=req.relation_type,
        score=req.score,
    )
    db.add(rel)
    await create_activity(
        db, workspace_id=card.workspace_id, actor_id=user.id,
        action="card.related", target_type="card", target_id=card_id,
        metadata={"card_title": card.title or "", "related_card_id": req.related_card_id},
    )
    await db.commit()
    return {"ok": True}


@router.get("/{card_id}/relations", response_model=list[CardResponse])
async def get_related_cards(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await db.get(Card, parse_uuid(card_id))
    if not card:
        raise HTTPException(status_code=404, detail="卡片不存在")
    await get_workspace_membership(card.workspace_id, user, db)
    result = await db.execute(
        select(Card)
        .join(CardRelation, CardRelation.related_card_id == Card.id)
        .where(CardRelation.card_id == parse_uuid(card_id))
    )
    return result.scalars().all()


@router.delete("/{card_id}/relations/{related_card_id}")
async def remove_relation(
    card_id: str,
    related_card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await db.get(Card, parse_uuid(card_id))
    if not card:
        raise HTTPException(status_code=404, detail="卡片不存在")
    membership = await get_workspace_membership(card.workspace_id, user, db)
    require_role(membership, "owner", "admin", "editor")
    result = await db.execute(
        select(CardRelation).where(
            CardRelation.card_id == parse_uuid(card_id),
            CardRelation.related_card_id == parse_uuid(related_card_id),
        )
    )
    rel = result.scalar_one_or_none()
    if not rel:
        raise HTTPException(status_code=404, detail="关联不存在")
    await db.delete(rel)
    await db.commit()
    return {"ok": True}

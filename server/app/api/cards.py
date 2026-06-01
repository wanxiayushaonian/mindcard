from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.card import Card, CardRelation
from app.models.chat import AiChat
from app.models.user import User
from app.schemas.card import CardCreate, CardListResponse, CardRelationCreate, CardResponse, CardUpdate
from app.services.embedding import embedding_service
from app.utils.activity import create_activity
from app.utils.auth import can_edit_card, get_current_user, get_workspace_membership, require_role
from app.utils.cursor import decode_cursor, encode_cursor
from app.utils.helpers import parse_uuid

router = APIRouter()


async def _generate_embedding(card_id: UUID, default_node_id: UUID | None = None):
    """Generate and update embedding for a card (runs in background)."""
    import logging

    logger = logging.getLogger(__name__)
    try:
        from app.database import async_session

        async with async_session() as db:
            db_card = await db.get(Card, card_id)
            if not db_card:
                logger.warning("Card %s not found for embedding generation", card_id)
                return
            text = embedding_service.card_to_text(db_card.title, db_card.content, db_card.keywords, db_card.emotion_tag)
            embedding = await embedding_service.embed(text)
            db_card.embedding = embedding
            await db.commit()
            # Assign to topic
            from app.services.topic import topic_service
            await topic_service.assign_card_to_topic(db, db_card)
            await db.commit()
            # Auto-classify into topology tree
            from app.services.topology import topology_service
            await topology_service.assign_card_to_node(db, db_card, default_node_id)
            await db.commit()
            # Extract knowledge graph triples
            try:
                from app.services.triple_extractor import triple_extractor
                from app.services.entity_linker import EntityLinker

                entities, triples = await triple_extractor.extract(
                    db_card.content, db_card.workspace_id
                )
                if entities and triples:
                    linker = EntityLinker(db)
                    await linker.link_triples(
                        entities, triples, db_card.id, db_card.workspace_id
                    )
                    await db.commit()
            except Exception as e:
                logger.warning("Triple extraction failed for card %s: %s", card_id, e)
    except Exception as e:
        logger.warning("Embedding generation failed for card %s: %s", card_id, e)


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
    desc = order == "desc"

    if cursor:
        val_str, id_str = decode_cursor(cursor)
        cursor_id = UUID(id_str)
        # Parse value based on sort column type
        if sort_by in ("created_at", "updated_at"):
            from datetime import datetime as dt

            cursor_val = dt.fromisoformat(val_str)
        else:
            cursor_val = val_str

        if desc:
            query = query.where(tuple_(sort_col, Card.id) < (cursor_val, cursor_id))
        else:
            query = query.where(tuple_(sort_col, Card.id) > (cursor_val, cursor_id))

    # Deterministic ordering: sort_col + id tiebreaker
    if desc:
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

    # Get chat's topology node as default
    chat_node_id = None
    if req.chat_id:
        chat_result = await db.execute(
            select(AiChat.tree_node_id).where(AiChat.id == parse_uuid(req.chat_id))
        )
        chat_node_id = chat_result.scalar_one_or_none()

    # Create card (exclude chat_id as it's not a Card model field)
    card_data = req.model_dump(exclude={"chat_id"})
    card = Card(**card_data, creator_id=user.id)
    db.add(card)
    await db.flush()

    # Auto-attach card to workspace root node in topology tree
    from app.models.topology import NodeCard, TreeNode as TopoNode

    root_result = await db.execute(
        select(TopoNode).where(
            TopoNode.workspace_id == parse_uuid(req.workspace_id),
            TopoNode.parent_id.is_(None),
        ).limit(1)
    )
    root_node = root_result.scalar_one_or_none()
    if root_node:
        db.add(NodeCard(node_id=root_node.id, card_id=card.id))

    background_tasks.add_task(_generate_embedding, card.id, chat_node_id)
    await create_activity(
        db, workspace_id=req.workspace_id, actor_id=user.id,
        action="card.created", target_type="card", target_id=str(card.id),
        metadata={"card_title": card.title or ""},
    )
    await db.commit()
    await db.refresh(card)
    return card


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
    content_changed = "content" in update_data or "title" in update_data or "keywords" in update_data
    for field, value in update_data.items():
        setattr(card, field, value)
    card.updated_at = datetime.now(timezone.utc)
    if content_changed:
        background_tasks.add_task(_generate_embedding, card.id)
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
    await db.delete(card)
    await db.commit()
    return {"ok": True}


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

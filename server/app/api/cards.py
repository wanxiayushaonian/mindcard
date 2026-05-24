from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.card import Card, CardRelation
from app.models.user import User
from app.schemas.card import CardCreate, CardRelationCreate, CardResponse, CardUpdate
from app.services.embedding import embedding_service
from app.utils.auth import get_current_user, get_workspace_membership, require_owner
from app.utils.helpers import parse_uuid

router = APIRouter()


async def _generate_embedding(card: Card):
    """Generate and update embedding for a card (runs in background)."""
    try:
        text = embedding_service.card_to_text(card.title, card.content, card.keywords)
        embedding = await embedding_service.embed(text)
        from app.database import async_session

        async with async_session() as db:
            db_card = await db.get(Card, card.id)
            if db_card:
                db_card.embedding = embedding
                await db.commit()
    except Exception as e:
        import logging

        logging.getLogger(__name__).warning("Embedding generation failed for card %s: %s", card.id, e)


@router.get("/", response_model=list[CardResponse])
async def list_cards(
    workspace_id: str,
    skip: int = 0,
    limit: int = 50,
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
    query = query.order_by(sort_col.desc() if order == "desc" else sort_col.asc())
    result = await db.execute(query.offset(skip).limit(limit))
    return result.scalars().all()


@router.post("/", response_model=CardResponse)
async def create_card(
    req: CardCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await get_workspace_membership(req.workspace_id, user, db)
    card = Card(**req.model_dump(), creator_id=user.id)
    db.add(card)
    await db.flush()
    background_tasks.add_task(_generate_embedding, card)
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
    # is_favorite / is_temp are personal actions, any member can toggle
    personal_only = set(update_data.keys()) <= {"is_favorite", "is_temp"}
    if not personal_only and membership.role != "owner" and card.creator_id != user.id:
        raise HTTPException(status_code=403, detail="只能编辑自己创建的卡片")
    content_changed = "content" in update_data or "title" in update_data or "keywords" in update_data
    for field, value in update_data.items():
        setattr(card, field, value)
    card.updated_at = datetime.now(timezone.utc)
    if content_changed:
        background_tasks.add_task(_generate_embedding, card)
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
    if membership.role != "owner" and card.creator_id != user.id:
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
    await get_workspace_membership(card.workspace_id, user, db)

    from sqlalchemy import select as sa_select

    existing = await db.execute(
        sa_select(CardRelation).where(
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
    await get_workspace_membership(card.workspace_id, user, db)
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

import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.card import Card, CardRelation
from app.models.user import User
from app.schemas.card import CardCreate, CardRelationCreate, CardResponse, CardUpdate
from app.services.embedding import embedding_service
from app.utils.auth import get_current_user

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
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Card)
        .where(Card.workspace_id == uuid.UUID(workspace_id))
        .order_by(Card.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()


@router.post("/", response_model=CardResponse)
async def create_card(
    req: CardCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = Card(**req.model_dump(), creator_id=user.id)
    db.add(card)
    await db.flush()
    background_tasks.add_task(_generate_embedding, card)
    await db.commit()
    await db.refresh(card)
    return card


@router.get("/{card_id}", response_model=CardResponse)
async def get_card(card_id: str, db: AsyncSession = Depends(get_db)):
    card = await db.get(Card, uuid.UUID(card_id))
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


@router.put("/{card_id}", response_model=CardResponse)
async def update_card(
    card_id: str,
    req: CardUpdate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    card = await db.get(Card, uuid.UUID(card_id))
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    update_data = req.model_dump(exclude_unset=True)
    content_changed = "content" in update_data or "title" in update_data or "keywords" in update_data
    for field, value in update_data.items():
        setattr(card, field, value)
    card.updated_at = datetime.utcnow()
    if content_changed:
        background_tasks.add_task(_generate_embedding, card)
    await db.commit()
    await db.refresh(card)
    return card


@router.delete("/{card_id}")
async def delete_card(card_id: str, db: AsyncSession = Depends(get_db)):
    card = await db.get(Card, uuid.UUID(card_id))
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    await db.delete(card)
    await db.commit()
    return {"ok": True}


@router.post("/{card_id}/relations")
async def add_relation(card_id: str, req: CardRelationCreate, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select as sa_select

    existing = await db.execute(
        sa_select(CardRelation).where(
            CardRelation.card_id == uuid.UUID(card_id),
            CardRelation.related_card_id == uuid.UUID(req.related_card_id),
            CardRelation.relation_type == req.relation_type,
        )
    )
    if existing.scalar_one_or_none():
        return {"ok": True, "duplicate": True}

    rel = CardRelation(
        card_id=uuid.UUID(card_id),
        related_card_id=uuid.UUID(req.related_card_id),
        relation_type=req.relation_type,
        score=req.score,
    )
    db.add(rel)
    await db.commit()
    return {"ok": True}


@router.get("/{card_id}/relations", response_model=list[CardResponse])
async def get_related_cards(card_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Card)
        .join(CardRelation, CardRelation.related_card_id == Card.id)
        .where(CardRelation.card_id == uuid.UUID(card_id))
    )
    return result.scalars().all()

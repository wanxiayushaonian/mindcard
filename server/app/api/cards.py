import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.card import Card, CardRelation
from app.schemas.card import CardCreate, CardRelationCreate, CardResponse, CardUpdate

router = APIRouter()


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
async def create_card(req: CardCreate, db: AsyncSession = Depends(get_db)):
    card = Card(**req.model_dump())
    db.add(card)
    await db.flush()
    # TODO: trigger async embedding generation
    await db.commit()
    return card


@router.get("/{card_id}", response_model=CardResponse)
async def get_card(card_id: str, db: AsyncSession = Depends(get_db)):
    card = await db.get(Card, uuid.UUID(card_id))
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


@router.put("/{card_id}", response_model=CardResponse)
async def update_card(card_id: str, req: CardUpdate, db: AsyncSession = Depends(get_db)):
    card = await db.get(Card, uuid.UUID(card_id))
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    update_data = req.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(card, field, value)
    card.updated_at = datetime.utcnow()
    # TODO: re-embed if content changed
    await db.commit()
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

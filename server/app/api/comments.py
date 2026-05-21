import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.comment import Comment

router = APIRouter()


class CommentCreate(BaseModel):
    content: str
    author_id: str | None = None


class CommentResponse(BaseModel):
    id: uuid.UUID
    card_id: uuid.UUID
    author_id: uuid.UUID | None
    content: str
    created_at: str

    model_config = {"from_attributes": True}


@router.get("/{card_id}/comments", response_model=list[CommentResponse])
async def list_comments(card_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Comment)
        .where(Comment.card_id == uuid.UUID(card_id))
        .order_by(Comment.created_at.desc())
    )
    comments = result.scalars().all()
    return [
        CommentResponse(
            id=c.id,
            card_id=c.card_id,
            author_id=c.author_id,
            content=c.content,
            created_at=c.created_at.isoformat(),
        )
        for c in comments
    ]


@router.post("/{card_id}/comments", response_model=CommentResponse)
async def add_comment(card_id: str, req: CommentCreate, db: AsyncSession = Depends(get_db)):
    comment = Comment(
        card_id=uuid.UUID(card_id),
        author_id=uuid.UUID(req.author_id) if req.author_id else None,
        content=req.content,
    )
    db.add(comment)
    await db.flush()
    await db.commit()
    return CommentResponse(
        id=comment.id,
        card_id=comment.card_id,
        author_id=comment.author_id,
        content=comment.content,
        created_at=comment.created_at.isoformat(),
    )


@router.delete("/{card_id}/comments/{comment_id}")
async def delete_comment(
    card_id: str, comment_id: str, db: AsyncSession = Depends(get_db)
):
    comment = await db.get(Comment, uuid.UUID(comment_id))
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    await db.delete(comment)
    await db.commit()
    return {"ok": True}

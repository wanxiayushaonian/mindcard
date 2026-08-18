import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.user import User as UserModel

from app.database import get_db
from app.models.card import Card
from app.models.comment import Comment
from app.models.user import User
from app.utils.activity import create_activity, create_notification
from app.utils.auth import get_current_user, get_workspace_membership, require_role
from app.utils.helpers import parse_uuid

router = APIRouter()


class CommentCreate(BaseModel):
    content: str


class CommentResponse(BaseModel):
    id: uuid.UUID
    card_id: uuid.UUID
    author_id: uuid.UUID | None
    author_nickname: str = ""
    content: str
    created_at: str

    model_config = {"from_attributes": True}


@router.get("/{card_id}/comments", response_model=list[CommentResponse])
async def list_comments(
    card_id: str,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await db.get(Card, parse_uuid(card_id))
    if not card:
        raise HTTPException(status_code=404, detail="卡片不存在")
    await get_workspace_membership(card.workspace_id, user, db)
    result = await db.execute(
        select(Comment, UserModel.nickname)
        .outerjoin(UserModel, Comment.author_id == UserModel.id)
        .where(Comment.card_id == parse_uuid(card_id))
        .order_by(Comment.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = result.all()
    return [
        CommentResponse(
            id=c.id,
            card_id=c.card_id,
            author_id=c.author_id,
            author_nickname=nickname or "",
            content=c.content,
            created_at=c.created_at.isoformat(),
        )
        for c, nickname in rows
    ]


@router.post("/{card_id}/comments", response_model=CommentResponse)
async def add_comment(
    card_id: str,
    req: CommentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await db.get(Card, parse_uuid(card_id))
    if not card:
        raise HTTPException(status_code=404, detail="卡片不存在")
    membership = await get_workspace_membership(card.workspace_id, user, db)
    require_role(membership, "owner", "admin", "editor")
    comment = Comment(
        card_id=parse_uuid(card_id),
        author_id=user.id,
        content=req.content,
    )
    db.add(comment)
    await db.flush()

    # Notify card creator (if not self-commenting)
    if card.creator_id != user.id:
        card_title = card.title or "未命名卡片"
        await create_notification(
            db,
            user_id=card.creator_id,
            notif_type="comment",
            content=f"{user.nickname or '有人'} 评论了你的卡片「{card_title}」",
            link=f"/workspaces/{card.workspace_id}/card/{card_id}",
        )

    # Activity log
    await create_activity(
        db,
        workspace_id=card.workspace_id,
        actor_id=user.id,
        action="card.commented",
        target_type="card",
        target_id=card_id,
        metadata={"card_title": card.title or "", "comment_preview": req.content[:100]},
    )

    await db.commit()
    return CommentResponse(
        id=comment.id,
        card_id=comment.card_id,
        author_id=comment.author_id,
        author_nickname=user.nickname or "",
        content=comment.content,
        created_at=comment.created_at.isoformat(),
    )


@router.delete("/{card_id}/comments/{comment_id}")
async def delete_comment(
    card_id: str,
    comment_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card = await db.get(Card, parse_uuid(card_id))
    if not card:
        raise HTTPException(status_code=404, detail="卡片不存在")
    membership = await get_workspace_membership(card.workspace_id, user, db)
    comment = await db.get(Comment, parse_uuid(comment_id))
    if not comment or comment.card_id != card.id:
        raise HTTPException(status_code=404, detail="评论不存在")
    if membership.role not in ("owner", "admin") and comment.author_id != user.id:
        raise HTTPException(status_code=403, detail="只能删除自己发布的评论")
    await db.delete(comment)
    await db.commit()
    return {"ok": True}

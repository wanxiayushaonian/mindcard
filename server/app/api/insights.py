import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.branch_insight import BranchInsight
from app.models.chat import AiChat
from app.models.user import User
from app.schemas.branch_insight import BranchInsightCreate, BranchInsightResponse
from app.utils.auth import get_current_user, get_workspace_membership

router = APIRouter()


async def _get_chat_workspace_id(db: AsyncSession, chat_id: str) -> uuid.UUID:
    """Look up the workspace_id for a chat, raising 404 if not found."""
    chat = await db.get(AiChat, uuid.UUID(chat_id))
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    return chat.workspace_id


@router.post("/{chat_id}/insights", response_model=BranchInsightResponse)
async def create_insight(
    chat_id: str,
    body: BranchInsightCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ws_id = await _get_chat_workspace_id(db, chat_id)
    await get_workspace_membership(ws_id, user, db)

    insight = BranchInsight(
        source_chat_id=chat_id,
        target_chat_id=body.target_chat_id,
        content=body.content,
    )
    db.add(insight)
    await db.commit()
    await db.refresh(insight)
    return insight


@router.get("/{chat_id}/insights", response_model=list[BranchInsightResponse])
async def get_insights(
    chat_id: str,
    consumed: bool | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ws_id = await _get_chat_workspace_id(db, chat_id)
    await get_workspace_membership(ws_id, user, db)

    query = select(BranchInsight).where(BranchInsight.target_chat_id == chat_id)
    if consumed is not None:
        query = query.where(BranchInsight.consumed == consumed)
    result = await db.execute(query.order_by(BranchInsight.created_at.desc()))
    return result.scalars().all()

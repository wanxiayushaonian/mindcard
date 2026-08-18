import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.workspace_memory import WorkspaceMemory
from app.schemas.workspace_memory import (
    WorkspaceMemoryCreate,
    WorkspaceMemoryResponse,
    WorkspaceMemoryUpdate,
)
from app.utils.auth import get_current_user, get_workspace_membership, require_role

router = APIRouter()


@router.get("/{workspace_id}/memories", response_model=list[WorkspaceMemoryResponse])
async def list_memories(
    workspace_id: str,
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ws_id = uuid.UUID(workspace_id)
    await get_workspace_membership(ws_id, user, db)

    stmt = select(WorkspaceMemory).where(WorkspaceMemory.workspace_id == ws_id)
    if not include_archived:
        stmt = stmt.where(WorkspaceMemory.memory_type != "archived")
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/{workspace_id}/memories/maintenance")
async def run_memory_maintenance(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Run memory archive pass: physically mark low-value aged memories as archived.

    Memories qualify for archival when:
      decayed_importance < 0.1 AND age > 90 days.

    Archived memories are excluded from RAG injection and from default list responses.
    """
    ws_id = uuid.UUID(workspace_id)
    membership = await get_workspace_membership(ws_id, user, db)
    require_role(membership, "owner", "admin")

    from app.services.memory_decay import run_archive_pass

    archived_count = await run_archive_pass(workspace_id, db)
    return {"archived_count": archived_count}


@router.post("/{workspace_id}/memories", response_model=WorkspaceMemoryResponse)
async def upsert_memory(
    workspace_id: str,
    body: WorkspaceMemoryCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ws_id = uuid.UUID(workspace_id)
    membership = await get_workspace_membership(ws_id, user, db)
    require_role(membership, "owner", "admin", "editor")

    # Upsert: update if exists, create if not
    result = await db.execute(
        select(WorkspaceMemory).where(
            WorkspaceMemory.workspace_id == ws_id,
            WorkspaceMemory.slug == body.slug,
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.title = body.title
        existing.body = body.body
        # Only clear source_chat_id when the client explicitly sends null
        if "source_chat_id" in body.model_dump(exclude_unset=True):
            existing.source_chat_id = body.source_chat_id
        existing.memory_type = body.memory_type
        existing.confidence = body.confidence
        existing.importance = body.importance
        existing.source_card_ids = [uuid.UUID(cid) for cid in body.source_card_ids]
        await db.commit()
        await db.refresh(existing)
        return existing

    memory = WorkspaceMemory(
        workspace_id=ws_id,
        slug=body.slug,
        title=body.title,
        body=body.body,
        source_chat_id=body.source_chat_id,
        memory_type=body.memory_type,
        confidence=body.confidence,
        importance=body.importance,
        source_card_ids=[uuid.UUID(cid) for cid in body.source_card_ids],
    )
    db.add(memory)
    await db.commit()
    await db.refresh(memory)
    return memory


@router.patch("/{workspace_id}/memories/{slug}", response_model=WorkspaceMemoryResponse)
async def update_memory(
    workspace_id: str,
    slug: str,
    body: WorkspaceMemoryUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ws_id = uuid.UUID(workspace_id)
    membership = await get_workspace_membership(ws_id, user, db)
    require_role(membership, "owner", "admin", "editor")

    result = await db.execute(
        select(WorkspaceMemory).where(
            WorkspaceMemory.workspace_id == ws_id,
            WorkspaceMemory.slug == slug,
        )
    )
    memory = result.scalar_one_or_none()
    if not memory:
        raise HTTPException(status_code=404, detail="Memory not found")

    update_data = body.model_dump(exclude_unset=True)
    if "source_card_ids" in update_data and update_data["source_card_ids"] is not None:
        update_data["source_card_ids"] = [uuid.UUID(cid) for cid in update_data["source_card_ids"]]
    for field, value in update_data.items():
        setattr(memory, field, value)

    await db.commit()
    await db.refresh(memory)
    return memory


@router.delete("/{workspace_id}/memories/{slug}")
async def delete_memory(
    workspace_id: str,
    slug: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ws_id = uuid.UUID(workspace_id)
    membership = await get_workspace_membership(ws_id, user, db)
    require_role(membership, "owner", "admin")

    result = await db.execute(
        select(WorkspaceMemory).where(
            WorkspaceMemory.workspace_id == ws_id,
            WorkspaceMemory.slug == slug,
        )
    )
    memory = result.scalar_one_or_none()
    if not memory:
        raise HTTPException(status_code=404, detail="Memory not found")
    await db.delete(memory)
    await db.commit()
    return {"ok": True}

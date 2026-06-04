from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.workspace_memory import WorkspaceMemory
from app.schemas.workspace_memory import WorkspaceMemoryCreate, WorkspaceMemoryResponse

router = APIRouter()


@router.get("/{workspace_id}/memories", response_model=list[WorkspaceMemoryResponse])
async def list_memories(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WorkspaceMemory).where(WorkspaceMemory.workspace_id == workspace_id)
    )
    return result.scalars().all()


@router.post("/{workspace_id}/memories", response_model=WorkspaceMemoryResponse)
async def upsert_memory(
    workspace_id: str,
    body: WorkspaceMemoryCreate,
    db: AsyncSession = Depends(get_db),
):
    # Upsert: update if exists, create if not
    result = await db.execute(
        select(WorkspaceMemory).where(
            WorkspaceMemory.workspace_id == workspace_id,
            WorkspaceMemory.slug == body.slug,
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.title = body.title
        existing.body = body.body
        if body.source_chat_id:
            existing.source_chat_id = body.source_chat_id
        await db.commit()
        await db.refresh(existing)
        return existing

    memory = WorkspaceMemory(
        workspace_id=workspace_id,
        slug=body.slug,
        title=body.title,
        body=body.body,
        source_chat_id=body.source_chat_id,
    )
    db.add(memory)
    await db.commit()
    await db.refresh(memory)
    return memory


@router.delete("/{workspace_id}/memories/{slug}")
async def delete_memory(
    workspace_id: str,
    slug: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WorkspaceMemory).where(
            WorkspaceMemory.workspace_id == workspace_id,
            WorkspaceMemory.slug == slug,
        )
    )
    memory = result.scalar_one_or_none()
    if not memory:
        raise HTTPException(status_code=404, detail="Memory not found")
    await db.delete(memory)
    await db.commit()
    return {"ok": True}

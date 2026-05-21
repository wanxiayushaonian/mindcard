import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.workspace import (
    WorkspaceCreate,
    WorkspaceMemberResponse,
    WorkspaceResponse,
    WorkspaceUpdate,
)

router = APIRouter()


@router.get("/", response_model=list[WorkspaceResponse])
async def list_workspaces(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Workspace).order_by(Workspace.created_at.desc()))
    return result.scalars().all()


@router.post("/", response_model=WorkspaceResponse)
async def create_workspace(req: WorkspaceCreate, db: AsyncSession = Depends(get_db)):
    ws = Workspace(**req.model_dump())
    db.add(ws)
    await db.flush()
    await db.commit()
    return ws


@router.get("/{workspace_id}", response_model=WorkspaceResponse)
async def get_workspace(workspace_id: str, db: AsyncSession = Depends(get_db)):
    ws = await db.get(Workspace, uuid.UUID(workspace_id))
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return ws


@router.put("/{workspace_id}", response_model=WorkspaceResponse)
async def update_workspace(
    workspace_id: str, req: WorkspaceUpdate, db: AsyncSession = Depends(get_db)
):
    ws = await db.get(Workspace, uuid.UUID(workspace_id))
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(ws, field, value)
    await db.commit()
    return ws


@router.delete("/{workspace_id}")
async def delete_workspace(workspace_id: str, db: AsyncSession = Depends(get_db)):
    ws = await db.get(Workspace, uuid.UUID(workspace_id))
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    await db.delete(ws)
    await db.commit()
    return {"ok": True}


@router.get("/{workspace_id}/members", response_model=list[WorkspaceMemberResponse])
async def list_members(workspace_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(WorkspaceMember).where(WorkspaceMember.workspace_id == uuid.UUID(workspace_id))
    )
    return result.scalars().all()

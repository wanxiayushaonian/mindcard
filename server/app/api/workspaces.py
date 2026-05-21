import random
import string
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.workspace import (
    JoinWorkspaceRequest,
    WorkspaceCreate,
    WorkspaceMemberResponse,
    WorkspaceResponse,
    WorkspaceUpdate,
)
from app.utils.auth import get_current_user

router = APIRouter()


@router.get("/", response_model=list[WorkspaceResponse])
async def list_workspaces(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Workspace)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == user.id)
        .order_by(Workspace.created_at.desc())
    )
    return result.scalars().all()


@router.post("/", response_model=WorkspaceResponse)
async def create_workspace(
    req: WorkspaceCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ws = Workspace(**req.model_dump(), owner_id=user.id)
    db.add(ws)
    await db.flush()
    member = WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner")
    db.add(member)
    await db.commit()
    await db.refresh(ws)
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
    from app.models.user import User

    result = await db.execute(
        select(WorkspaceMember, User.nickname)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == uuid.UUID(workspace_id))
    )
    rows = result.all()
    return [
        WorkspaceMemberResponse(
            user_id=member.user_id,
            nickname=nickname,
            role=member.role,
            joined_at=member.joined_at,
        )
        for member, nickname in rows
    ]


@router.post("/{workspace_id}/invite-code")
async def generate_invite_code(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Generate a 6-char invite code. Only workspace owner can do this."""
    ws = await db.get(Workspace, uuid.UUID(workspace_id))
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if ws.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Only owner can generate invite code")

    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    code = "".join(random.choice(chars) for _ in range(6))
    ws.invite_code = code
    await db.commit()
    return {"invite_code": code}


@router.post("/join")
async def join_workspace(
    req: JoinWorkspaceRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Join a workspace using an invite code."""
    result = await db.execute(
        select(Workspace).where(Workspace.invite_code == req.invite_code)
    )
    ws = result.scalar_one_or_none()
    if not ws:
        raise HTTPException(status_code=404, detail="Invalid invite code")

    # Check if already a member
    existing = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == ws.id,
            WorkspaceMember.user_id == user.id,
        )
    )
    if existing.scalar_one_or_none():
        return {"ok": True, "workspace_id": str(ws.id), "message": "Already a member"}

    member = WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="editor")
    db.add(member)
    await db.commit()
    return {"ok": True, "workspace_id": str(ws.id), "workspace_name": ws.name}


@router.delete("/{workspace_id}/members/{user_id}")
async def remove_member(
    workspace_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Remove a member from workspace. Only owner can do this."""
    ws = await db.get(Workspace, uuid.UUID(workspace_id))
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if ws.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Only owner can remove members")
    if str(user.id) == user_id:
        raise HTTPException(status_code=400, detail="Cannot remove yourself")

    target = await db.get(WorkspaceMember, (uuid.UUID(workspace_id), uuid.UUID(user_id)))
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")

    await db.delete(target)
    await db.commit()
    return {"ok": True}

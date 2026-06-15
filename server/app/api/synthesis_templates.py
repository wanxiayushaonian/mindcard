from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.synthesis_template import SynthesisTemplate
from app.models.user import User
from app.schemas.synthesis_template import (
    SynthesisTemplateCreate,
    SynthesisTemplateListResponse,
    SynthesisTemplateResponse,
    SynthesisTemplateUpdate,
)
from app.utils.auth import get_current_user, get_workspace_membership, require_role
from app.utils.helpers import parse_uuid

router = APIRouter()


@router.get("/{ws_id}/synthesis-templates", response_model=SynthesisTemplateListResponse)
async def list_templates(
    ws_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    workspace_id = parse_uuid(ws_id)
    await get_workspace_membership(workspace_id, user, db)
    result = await db.execute(
        select(SynthesisTemplate)
        .where(SynthesisTemplate.workspace_id == workspace_id)
        .order_by(SynthesisTemplate.created_at.desc())
    )
    templates = result.scalars().all()
    return SynthesisTemplateListResponse(templates=templates)


@router.post("/{ws_id}/synthesis-templates", response_model=SynthesisTemplateResponse)
async def create_template(
    ws_id: str,
    req: SynthesisTemplateCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    workspace_id = parse_uuid(ws_id)
    membership = await get_workspace_membership(workspace_id, user, db)
    require_role(membership, "owner", "admin", "editor")

    template = SynthesisTemplate(
        workspace_id=workspace_id,
        name=req.name,
        prompt=req.prompt,
        description=req.description,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return template


@router.get("/{ws_id}/synthesis-templates/{template_id}", response_model=SynthesisTemplateResponse)
async def get_template(
    ws_id: str,
    template_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    workspace_id = parse_uuid(ws_id)
    await get_workspace_membership(workspace_id, user, db)

    tid = parse_uuid(template_id)
    template = await db.get(SynthesisTemplate, tid)
    if not template or template.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="模板不存在")
    return template


@router.put("/{ws_id}/synthesis-templates/{template_id}", response_model=SynthesisTemplateResponse)
async def update_template(
    ws_id: str,
    template_id: str,
    req: SynthesisTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    workspace_id = parse_uuid(ws_id)
    membership = await get_workspace_membership(workspace_id, user, db)
    require_role(membership, "owner", "admin", "editor")

    tid = parse_uuid(template_id)
    template = await db.get(SynthesisTemplate, tid)
    if not template or template.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="模板不存在")

    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(template, field, value)

    await db.commit()
    await db.refresh(template)
    return template


@router.delete("/{ws_id}/synthesis-templates/{template_id}")
async def delete_template(
    ws_id: str,
    template_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    workspace_id = parse_uuid(ws_id)
    membership = await get_workspace_membership(workspace_id, user, db)
    require_role(membership, "owner", "admin", "editor")

    tid = parse_uuid(template_id)
    template = await db.get(SynthesisTemplate, tid)
    if not template or template.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="模板不存在")

    await db.delete(template)
    await db.commit()
    return {"ok": True}

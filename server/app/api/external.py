"""External API for browser extension / web clipper. Authenticated via API Key."""

import logging
import re
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.card import Card
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.card import CardResponse
from app.services.llm import llm_service
from app.utils.activity import create_activity
from app.utils.auth import get_current_user_from_api_key, get_workspace_membership, require_role
from app.utils.helpers import parse_uuid

logger = logging.getLogger(__name__)
router = APIRouter()


async def _ai_generate_title(content: str) -> str:
    """Use AI to generate a short title from content."""
    try:
        raw = await llm_service.complete_simple(
            "请用不超过20个字概括以下内容的主题，作为标题。只输出标题文字本身，绝对不要加引号、书名号、序号或其他任何符号。",
            content,
            max_tokens=32,
        )
        title = re.sub(r'["""\'\'《》【】「」]', '', raw.strip())
        if len(title) > 30:
            title = title[:30]
        return title
    except Exception as e:
        logger.warning("AI title generation failed: %s", e)
        # Fallback: use first line
        first_line = next((line.strip() for line in content.split('\n') if line.strip()), "")
        return first_line[:50] + ("..." if len(first_line) > 50 else "")


async def _ai_extract_keywords(content: str, max_keywords: int = 5) -> list[str]:
    """Use AI to extract keywords from content."""
    try:
        raw = await llm_service.complete_simple(
            "从以下内容中提取3-5个核心关键字。每个关键字2-6个字，用逗号分隔，不要加序号、解释或其他符号。",
            content,
            max_tokens=64,
        )
        keywords = []
        for kw in re.split(r'[,，、]', raw):
            kw = re.sub(r'["""\'\'《》【】「」\s]', '', kw.strip())
            if len(kw) > 10:
                kw = kw[:10]
            if kw:
                keywords.append(kw)
        return keywords[:max_keywords]
    except Exception as e:
        logger.warning("AI keyword extraction failed: %s", e)
        return []


class ExternalCardCreate(BaseModel):
    workspace_id: str
    title: str = ""
    content: str = Field(..., min_length=1, max_length=50000)
    keywords: list[str] = Field(default=[], max_length=5)
    source_platform: str = Field("", max_length=32)  # "chatgpt" / "claude" / "deepseek"
    source_url: str = Field("", max_length=1024)


async def _generate_embedding(card: Card):
    """Generate and update embedding for a card (runs in background)."""
    try:
        logger.info("Starting embedding generation for card %s", card.id)
        from app.services.embedding import embedding_service
        text = embedding_service.card_to_text(card.title, card.content, card.keywords, card.emotion_tag)
        embedding = await embedding_service.embed(text)
        from app.database import async_session

        async with async_session() as db:
            db_card = await db.get(Card, card.id)
            if db_card:
                db_card.embedding = embedding
                await db.commit()
                logger.info("Embedding saved for card %s (dim=%d)", card.id, len(embedding))
            else:
                logger.warning("Card %s not found when saving embedding", card.id)
    except Exception as e:
        logger.error("Embedding generation failed for card %s: %s", card.id, e, exc_info=True)


@router.get("/workspaces")
async def list_workspaces(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user_from_api_key),
):
    """List workspaces the API key owner belongs to."""
    result = await db.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == user.id)
        .order_by(Workspace.created_at.desc())
    )
    rows = result.all()
    return [
        {
            "id": str(ws.id),
            "name": ws.name,
            "icon": ws.icon,
            "color": ws.color,
            "member_role": role,
        }
        for ws, role in rows
    ]


@router.post("/cards", response_model=CardResponse)
async def create_card(
    req: ExternalCardCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user_from_api_key),
):
    """Create a card via API Key (from browser extension)."""
    ws_id = parse_uuid(req.workspace_id)
    membership = await get_workspace_membership(ws_id, user, db)
    require_role(membership, "owner", "admin", "editor")

    # Clean content: remove source info if present (we'll add it back properly)
    content = req.content.strip()
    # Remove any existing "来源:" lines that might be embedded in selection
    content_lines = content.split('\n')
    content_lines = [l for l in content_lines if not l.strip().startswith('来源:') and not l.strip().startswith('---')]
    content = '\n'.join(content_lines).strip()

    # Add source info as metadata-like footer (separated from main content)
    source_info_parts = []
    if req.source_platform:
        source_info_parts.append(req.source_platform)
    if req.source_url:
        source_info_parts.append(req.source_url)
    if source_info_parts:
        content += f"\n\n---\n📎 {' | '.join(source_info_parts)}"

    # Generate title using AI if not provided
    title = req.title.strip()
    if not title:
        logger.info("No title provided, generating with AI...")
        title = await _ai_generate_title(content)
        logger.info("AI generated title: %s", title)

    # Extract keywords using AI if not provided
    keywords = req.keywords
    if not keywords:
        logger.info("No keywords provided, extracting with AI...")
        keywords = await _ai_extract_keywords(content)
        logger.info("AI extracted keywords: %s", keywords)

    card = Card(
        local_id=f"ext_{uuid.uuid4().hex[:16]}",
        workspace_id=ws_id,
        creator_id=user.id,
        title=title,
        content=content,
        keywords=keywords,
        is_temp=False,
    )
    db.add(card)
    await db.flush()
    logger.info("Card created (id=%s), scheduling embedding generation", card.id)
    background_tasks.add_task(_generate_embedding, card)
    await create_activity(
        db, workspace_id=ws_id, actor_id=user.id,
        action="card.created", target_type="card", target_id=str(card.id),
        metadata={"card_title": card.title or "", "via": "extension"},
    )
    await db.commit()
    await db.refresh(card)
    return card

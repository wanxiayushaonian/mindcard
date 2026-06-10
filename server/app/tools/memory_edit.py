"""memory_edit tool — lets the LLM write/delete workspace shared memory."""

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.workspace_memory import WorkspaceMemory
from app.tools.base import Tool, ToolSpec

logger = logging.getLogger(__name__)

_SPEC = ToolSpec(
    name="memory_edit",
    description=(
        "Create, update, or delete a workspace shared memory entry. "
        "Use this to persist important facts, decisions, or knowledge "
        "that should be available in future conversations within this workspace."
    ),
    parameters={
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["upsert", "delete"],
                "description": "upsert creates or updates; delete removes.",
            },
            "slug": {
                "type": "string",
                "description": "Short identifier for the memory (e.g. 'project-goals').",
            },
            "title": {
                "type": "string",
                "description": "Display title (required for upsert).",
            },
            "body": {
                "type": "string",
                "description": "Full content in Markdown (required for upsert).",
            },
        },
        "required": ["action", "slug"],
    },
)


class MemoryEditTool(Tool):
    def spec(self) -> ToolSpec:
        return _SPEC

    async def execute(self, arguments: dict, context: dict) -> str:
        db: AsyncSession = context["db"]
        workspace_id = context.get("workspace_id")
        if not workspace_id:
            return "Error: no workspace context available."

        action = arguments.get("action", "upsert")
        slug = arguments.get("slug", "").strip()
        if not slug:
            return "Error: slug is required."

        ws_uuid = uuid.UUID(workspace_id)

        if action == "delete":
            result = await db.execute(
                select(WorkspaceMemory).where(
                    WorkspaceMemory.workspace_id == ws_uuid,
                    WorkspaceMemory.slug == slug,
                )
            )
            mem = result.scalar_one_or_none()
            if mem:
                await db.delete(mem)
                await db.flush()
                return f"Deleted memory '{slug}'."
            return f"Memory '{slug}' not found."

        # upsert
        title = arguments.get("title", "").strip()
        body = arguments.get("body", "").strip()
        if not title or not body:
            return "Error: title and body are required for upsert."

        result = await db.execute(
            select(WorkspaceMemory).where(
                WorkspaceMemory.workspace_id == ws_uuid,
                WorkspaceMemory.slug == slug,
            )
        )
        mem = result.scalar_one_or_none()

        if mem:
            mem.title = title
            mem.body = body
            await db.flush()
            return f"Updated memory '{slug}'."
        else:
            mem = WorkspaceMemory(
                workspace_id=ws_uuid,
                slug=slug,
                title=title,
                body=body,
            )
            db.add(mem)
            await db.flush()
            return f"Created memory '{slug}'."

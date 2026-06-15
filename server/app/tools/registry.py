"""Tool registry — register, lookup, and serialize tools for LLM consumption."""

from typing import Any

from app.tools.base import Tool

TOOLS: dict[str, Tool] = {}


def register_tool(tool: Tool) -> None:
    TOOLS[tool.spec().name] = tool


def get_tool(name: str) -> Tool | None:
    return TOOLS.get(name)


def get_all_tool_specs() -> list[dict[str, Any]]:
    """Return OpenAI-format tool definitions for all registered tools."""
    specs: list[dict[str, Any]] = []
    for tool in TOOLS.values():
        s = tool.spec()
        specs.append(
            {
                "type": "function",
                "function": {
                    "name": s.name,
                    "description": s.description,
                    "parameters": s.parameters,
                },
            }
        )
    return specs

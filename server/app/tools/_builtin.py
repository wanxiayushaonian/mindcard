"""Register all built-in tools."""

from app.tools.create_fork import CreateForkTool
from app.tools.memory_edit import MemoryEditTool
from app.tools.registry import register_tool
from app.tools.topology_tools import (
    GetCardRelationsTool,
    GetNodeDetailTool,
    GetNodeSubtreeTool,
    TopologyForestMapTool,
)


def register_builtin_tools() -> None:
    register_tool(MemoryEditTool())
    register_tool(CreateForkTool())
    register_tool(TopologyForestMapTool())
    register_tool(GetNodeDetailTool())
    register_tool(GetCardRelationsTool())
    register_tool(GetNodeSubtreeTool())

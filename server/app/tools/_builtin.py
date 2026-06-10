"""Register all built-in tools."""

from app.tools.create_fork import CreateForkTool
from app.tools.memory_edit import MemoryEditTool
from app.tools.registry import register_tool


def register_builtin_tools() -> None:
    register_tool(MemoryEditTool())
    register_tool(CreateForkTool())

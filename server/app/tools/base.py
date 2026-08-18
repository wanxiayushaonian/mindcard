"""Tool use abstractions — ToolSpec, ToolCall, ToolResult, Tool ABC."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ToolSpec:
    """Declarative metadata for a tool (mirrors ProviderSpec pattern)."""

    name: str
    description: str
    parameters: dict[str, Any]


@dataclass
class ToolCall:
    """Parsed tool call from LLM response."""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class ToolResult:
    """Result of executing a tool call."""

    tool_call_id: str
    content: str
    is_error: bool = False


@dataclass
class ChatResponse:
    """Unified response from chat() — supports both text and tool calls.

    ``usage`` (when provided by the provider) carries token counts in a
    normalized shape: ``{"input_tokens", "output_tokens", "total_tokens"}``.
    """

    content: str = ""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    usage: dict[str, int] | None = None

    @property
    def has_tool_calls(self) -> bool:
        return len(self.tool_calls) > 0


class Tool(ABC):
    """Base class for all LLM-callable tools."""

    @abstractmethod
    def spec(self) -> ToolSpec:
        """Return the tool's specification."""

    @abstractmethod
    async def execute(self, arguments: dict[str, Any], context: dict[str, Any]) -> str:
        """Execute the tool.

        Args:
            arguments: Parsed tool arguments from LLM.
            context: Keys: db, chat_id, workspace_id, user_id.

        Returns:
            Human-readable result string.
        """

"""Unit tests for the topology exploration tools (VISION 理念6).

Locks the registration contract and tool specs — the tools themselves query the
DB heavily and are verified against a real database in dev.
"""

from app.tools._builtin import register_builtin_tools
from app.tools.registry import TOOLS


def _reset_registry() -> None:
    TOOLS.clear()


def test_topology_tools_are_registered() -> None:
    _reset_registry()
    register_builtin_tools()

    expected = {
        "topology_forest_map": {"workspace_id"},
        "get_node_detail": {"node_id"},
        "get_card_relations": {"card_id"},
        "get_node_subtree": {"node_id"},
    }

    for name, required in expected.items():
        tool = TOOLS.get(name)
        assert tool is not None, f"tool {name} not registered"
        spec = tool.spec()
        assert spec.name == name
        assert set(spec.parameters.get("required", [])) == required


def test_tool_specs_are_llm_parseable() -> None:
    """Specs must be valid JSON-schema-shaped objects the LLM can call."""
    _reset_registry()
    register_builtin_tools()

    for name in ("topology_forest_map", "get_node_detail", "get_card_relations", "get_node_subtree"):
        spec = TOOLS[name].spec()
        assert spec.parameters["type"] == "object"
        assert isinstance(spec.parameters["properties"], dict)
        assert spec.description

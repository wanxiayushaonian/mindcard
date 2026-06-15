from dataclasses import dataclass, field
from enum import IntEnum


class RetrievalLevel(IntEnum):
    CHAT = 0       # No retrieval, pure LLM + history
    SEARCH = 1     # Hybrid search (vector + fulltext RRF)
    EXPLORE = 2    # Graph traversal (entity match → 1/2-hop → card scoring)
    CONTEXT = 3    # Graph + topology path context
    INSIGHT = 4    # Map-Reduce over community reports


@dataclass
class EntityContext:
    """A matched entity with its relations and linked cards."""
    entity_id: str
    name: str
    entity_type: str | None = None
    relations: list[dict] = field(default_factory=list)
    linked_card_titles: list[str] = field(default_factory=list)


@dataclass
class ReasoningPathItem:
    """A graph reasoning path (entity chain with relations)."""
    entities: list[str]
    relations: list[str]
    score: float


@dataclass
class RetrievalResult:
    """Unified result from RetrievalDispatcher."""
    cards: list = field(default_factory=list)
    card_scores: list[float] = field(default_factory=list)
    entities: list[EntityContext] = field(default_factory=list)
    reasoning_paths: list[ReasoningPathItem] = field(default_factory=list)
    topology_path: list[dict] | None = None
    node_card_titles: list[str] = field(default_factory=list)
    cross_refs: list[dict] = field(default_factory=list)
    community_context: str | None = None
    level_used: RetrievalLevel = RetrievalLevel.CHAT

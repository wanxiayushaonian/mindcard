from dataclasses import dataclass, field
from enum import IntEnum


class RetrievalLevel(IntEnum):
    FREE = 0       # No retrieval, pure LLM + history
    CARD = 1       # Hybrid search (vector + fulltext RRF)
    GRAPH = 2      # Card retrieval + entity/relation context
    FULL = 3       # Graph + topology path + topic context


@dataclass
class EntityContext:
    """A matched entity with its relations and linked cards."""
    entity_id: str
    name: str
    entity_type: str | None = None
    relations: list[dict] = field(default_factory=list)  # [{head_name, relation, tail_name, weight}]
    linked_card_titles: list[str] = field(default_factory=list)


@dataclass
class RetrievalResult:
    """Unified result from RetrievalDispatcher."""
    cards: list = field(default_factory=list)              # list[Card] objects
    card_scores: list[float] = field(default_factory=list) # parallel scores
    entities: list[EntityContext] = field(default_factory=list)
    topology_path: list[dict] | None = None                # [{node_id, title, summary}]
    node_card_titles: list[str] = field(default_factory=list)
    cross_refs: list[dict] = field(default_factory=list)   # [{target_title, ref_type, reason}]
    level_used: RetrievalLevel = RetrievalLevel.FREE

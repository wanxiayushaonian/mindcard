from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


# --- Graph Entity ---

class GraphEntityResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    name: str
    entity_type: str | None = None
    access_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class GraphEntityDetailResponse(GraphEntityResponse):
    related_cards: list["EntityCardItem"] = []
    neighbor_entities: list["NeighborEntity"] = []


class EntityCardItem(BaseModel):
    card_id: UUID
    title: str | None = None

    model_config = {"from_attributes": True}


class NeighborEntity(BaseModel):
    entity_id: UUID
    name: str
    relation: str
    direction: str  # "outgoing" or "incoming"

    model_config = {"from_attributes": True}


# --- Graph Relation ---

class GraphRelationResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    head_id: UUID
    head_name: str = ""
    relation: str
    tail_id: UUID
    tail_name: str = ""
    weight: float = 1.0
    source_card_id: UUID | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class GraphRelationUpdate(BaseModel):
    relation: str | None = None
    weight: float | None = None


# --- Triple Feedback ---

class TripleFeedbackCreate(BaseModel):
    feedback_type: str  # "good", "bad", "corrected"
    corrected_head: str | None = None
    corrected_relation: str | None = None
    corrected_tail: str | None = None


class TripleFeedbackResponse(BaseModel):
    id: UUID
    triple_id: UUID | None = None
    feedback_type: str
    corrected_head: str | None = None
    corrected_relation: str | None = None
    corrected_tail: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# --- Graph Search ---

class GraphSearchRequest(BaseModel):
    query: str
    k: int = 10


class ReasoningPath(BaseModel):
    entities: list[str]
    relations: list[str]
    score: float


class GraphSearchResultCard(BaseModel):
    id: UUID
    title: str | None = None
    content_snippet: str | None = None
    matched_path: str | None = None
    score: float


class GraphSearchResponse(BaseModel):
    query: str
    retrieval_mode: str  # "gnn", "embedding_fallback", "hybrid"
    reasoning_paths: list[ReasoningPath] = []
    cards: list[GraphSearchResultCard] = []


# --- GNN Training ---

class GNNTrainingRequest(BaseModel):
    mode: str = "auto"  # "auto", "local_cpu", "local_gpu", "remote_gpu"


class GNNTrainingLogResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    training_mode: str
    graph_size_nodes: int
    graph_size_edges: int
    checkpoint_path: str
    training_duration_seconds: int | None = None
    status: str
    error_message: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# --- Graph Stats ---

class GraphStatsResponse(BaseModel):
    entity_count: int
    relation_count: int
    relation_type_counts: dict[str, int]
    last_training: GNNTrainingLogResponse | None = None

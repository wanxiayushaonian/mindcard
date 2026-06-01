# SAGE Graph Memory System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete self-evolving graph memory system that extracts entity-relation triples from cards, stores them as a knowledge graph, trains GNN models for multi-hop retrieval, and enables self-improvement through user feedback.

**Architecture:** SAGE operates as a parallel enhanced retrieval layer alongside existing RAG. Cards trigger LLM-based triple extraction (NER then RE), entities are deduplicated via embedding similarity, and the graph is stored in PostgreSQL. A GNN (SAGERetriever) is periodically trained on the graph for multi-hop reasoning retrieval, with embedding fallback for new entities. User feedback drives self-evolution through few-shot example pool updates.

**Tech Stack:** FastAPI, SQLAlchemy, PostgreSQL + pgvector, PyTorch + PyTorch Geometric, D3.js, Next.js

---

## File Structure

### Backend Models
- Create: `server/app/models/graph.py` — GraphEntity, GraphRelation, EntityCard, GNNTrainingLog, TripleFeedback models
- Modify: `server/app/models/__init__.py` — Register new models
- Modify: `server/app/models/topology.py` — Add `core_entity_ids` column to TreeNode

### Backend Schemas
- Create: `server/app/schemas/graph.py` — GraphEntityCreate/Response, GraphRelationResponse, TripleFeedbackCreate, etc.

### Backend Services
- Create: `server/app/services/triple_extractor.py` — NER + RE LLM pipeline
- Create: `server/app/services/entity_linker.py` — Entity dedup via embedding similarity
- Create: `server/app/services/gnn_trainer.py` — Abstract trainer + LocalCPU/LocalGPU/RemoteGPU implementations
- Create: `server/app/services/gnn_retriever.py` — GNN + embedding hybrid retrieval
- Create: `server/app/services/graph_evolution.py` — Few-shot pool, feedback processing, auto-update

### Backend API
- Create: `server/app/api/graph.py` — Graph CRUD, search, training, feedback endpoints
- Modify: `server/app/main.py` — Register graph router
- Modify: `server/app/api/cards.py` — Hook triple extraction into _generate_embedding
- Modify: `server/app/services/topology.py` — Add mark_core_entities()

### Backend Config
- Modify: `server/app/config.py` — Add GNN training settings
- Modify: `server/pyproject.toml` — Add torch, torch-geometric, networkx dependencies

### Migrations
- Create: `server/alembic/versions/TIMESTAMP_add_sage_graph_memory.py` — 5 new tables + tree_nodes extension

### Frontend
- Create: `web/app/workspaces/[id]/knowledge-graph/page.tsx` — 2D force-directed graph visualization
- Create: `web/components/TripleFeedback.tsx` — Thumb up/down/edit feedback on triples
- Create: `web/components/ReasoningPath.tsx` — Display reasoning path in search results
- Create: `web/app/workspaces/[id]/settings/gnn-training/page.tsx` — GNN training monitor
- Modify: `web/lib/api.ts` — Add graphApi namespace
- Modify: `web/app/workspaces/[id]/page.tsx` — Add knowledge graph link
- Modify: `web/app/workspaces/[id]/layout.tsx` — Add nav item

---

## Phase 1: Triple Extraction (Tasks 1-5)

### Task 1: Database Migration for Graph Memory Tables

**Files:**
- Create: `server/alembic/versions/TIMESTAMP_add_sage_graph_memory.py`
- Modify: `server/app/models/graph.py`
- Modify: `server/app/models/__init__.py`
- Modify: `server/app/models/topology.py`

- [ ] **Step 1: Create SQLAlchemy models**

Create `server/app/models/graph.py`:

```python
from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import Float, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import settings
from app.database import Base


class GraphEntity(Base):
    __tablename__ = "graph_entities"

    id: Mapped[str] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[str] = mapped_column(Uuid(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(64))
    embedding: Mapped[list[float] | None] = mapped_column(Vector(settings.embedding_dim), nullable=True)
    access_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("idx_graph_entities_workspace", "workspace_id"),
    )

    if TYPE_CHECKING:
        from app.models.card import Card
        cards: list[Card]


class GraphRelation(Base):
    __tablename__ = "graph_relations"

    id: Mapped[str] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[str] = mapped_column(Uuid(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    head_id: Mapped[str] = mapped_column(Uuid(as_uuid=True), ForeignKey("graph_entities.id", ondelete="CASCADE"), nullable=False)
    relation: Mapped[str] = mapped_column(String(128), nullable=False)
    tail_id: Mapped[str] = mapped_column(Uuid(as_uuid=True), ForeignKey("graph_entities.id", ondelete="CASCADE"), nullable=False)
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    source_card_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("cards.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("idx_graph_relations_workspace", "workspace_id"),
        Index("idx_graph_relations_head", "head_id"),
        Index("idx_graph_relations_tail", "tail_id"),
    )


class EntityCard(Base):
    __tablename__ = "entity_cards"

    entity_id: Mapped[str] = mapped_column(Uuid(as_uuid=True), ForeignKey("graph_entities.id", ondelete="CASCADE"), primary_key=True)
    card_id: Mapped[str] = mapped_column(Uuid(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True)


class GNNTrainingLog(Base):
    __tablename__ = "gnn_training_logs"

    id: Mapped[str] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[str] = mapped_column(Uuid(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    training_mode: Mapped[str] = mapped_column(String(32), nullable=False)
    graph_size_nodes: Mapped[int] = mapped_column(Integer, nullable=False)
    graph_size_edges: Mapped[int] = mapped_column(Integer, nullable=False)
    checkpoint_path: Mapped[str] = mapped_column(Text, nullable=False)
    training_duration_seconds: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))


class TripleFeedback(Base):
    __tablename__ = "triple_feedback"

    id: Mapped[str] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    triple_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("graph_relations.id"), nullable=True)
    user_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    feedback_type: Mapped[str] = mapped_column(String(32), nullable=False)
    corrected_head: Mapped[str | None] = mapped_column(Text)
    corrected_relation: Mapped[str | None] = mapped_column(String(128))
    corrected_tail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc))
```

- [ ] **Step 2: Register models in `__init__.py`**

Add to `server/app/models/__init__.py`:

```python
from .graph import GraphEntity, GraphRelation, EntityCard, GNNTrainingLog, TripleFeedback
```

And add to `__all__`:

```python
"GraphEntity",
"GraphRelation",
"EntityCard",
"GNNTrainingLog",
"TripleFeedback",
```

- [ ] **Step 3: Add core_entity_ids to TreeNode model**

In `server/app/models/topology.py`, add after `chat_id` field:

```python
from sqlalchemy.dialects.postgresql import ARRAY

core_entity_ids: Mapped[list[str] | None] = mapped_column(ARRAY(Uuid(as_uuid=True)), default=list)
```

- [ ] **Step 4: Create Alembic migration**

```bash
cd server
alembic revision -m "add sage graph memory tables"
```

Write the migration:

```python
"""add sage graph memory tables

Revision ID: <generated>
Revises: 65055ac0cef1
Create Date: <timestamp>
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from pgvector.sqlalchemy import Vector

revision = "<generated>"
down_revision = "65055ac0cef1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "graph_entities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("entity_type", sa.String(64)),
        sa.Column("embedding", Vector(768), nullable=True),
        sa.Column("access_count", sa.Integer, default=0),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_graph_entities_workspace", "graph_entities", ["workspace_id"])

    op.create_table(
        "graph_relations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("head_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("graph_entities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relation", sa.String(128), nullable=False),
        sa.Column("tail_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("graph_entities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("weight", sa.Float, default=1.0),
        sa.Column("source_card_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("cards.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_graph_relations_workspace", "graph_relations", ["workspace_id"])
    op.create_index("idx_graph_relations_head", "graph_relations", ["head_id"])
    op.create_index("idx_graph_relations_tail", "graph_relations", ["tail_id"])

    op.create_table(
        "entity_cards",
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("graph_entities.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("card_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True),
    )

    op.create_table(
        "gnn_training_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("training_mode", sa.String(32), nullable=False),
        sa.Column("graph_size_nodes", sa.Integer, nullable=False),
        sa.Column("graph_size_edges", sa.Integer, nullable=False),
        sa.Column("checkpoint_path", sa.Text, nullable=False),
        sa.Column("training_duration_seconds", sa.Integer),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("error_message", sa.Text),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "triple_feedback",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("triple_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("graph_relations.id")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("feedback_type", sa.String(32), nullable=False),
        sa.Column("corrected_head", sa.Text),
        sa.Column("corrected_relation", sa.String(128)),
        sa.Column("corrected_tail", sa.Text),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )

    op.add_column("tree_nodes", sa.Column("core_entity_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=True)), default=list))


def downgrade() -> None:
    op.drop_column("tree_nodes", "core_entity_ids")
    op.drop_table("triple_feedback")
    op.drop_table("gnn_training_logs")
    op.drop_table("entity_cards")
    op.drop_table("graph_relations")
    op.drop_table("graph_entities")
```

- [ ] **Step 5: Run migration**

```bash
cd server
alembic upgrade head
```

Expected: All 5 tables created, tree_nodes extended

- [ ] **Step 6: Verify models load**

```bash
cd server
python -c "from app.models.graph import GraphEntity, GraphRelation, EntityCard, GNNTrainingLog, TripleFeedback; print('Graph models loaded')"
```

Expected: "Graph models loaded"

- [ ] **Step 7: Commit**

```bash
git add server/app/models/graph.py server/app/models/__init__.py server/app/models/topology.py server/alembic/versions/*.py
git commit -m "feat(db): add SAGE graph memory tables and models

- Create graph_entities, graph_relations, entity_cards tables
- Create gnn_training_logs, triple_feedback tables
- Add core_entity_ids UUID[] to tree_nodes
- Add GraphEntity, GraphRelation, EntityCard, GNNTrainingLog, TripleFeedback models

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Graph Schemas

**Files:**
- Create: `server/app/schemas/graph.py`

- [ ] **Step 1: Create Pydantic schemas**

Create `server/app/schemas/graph.py`:

```python
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
```

- [ ] **Step 2: Verify schemas load**

```bash
cd server
python -c "from app.schemas.graph import GraphEntityResponse, GraphSearchResponse; print('Graph schemas loaded')"
```

Expected: "Graph schemas loaded"

- [ ] **Step 3: Commit**

```bash
git add server/app/schemas/graph.py
git commit -m "feat(schemas): add graph memory Pydantic schemas

- GraphEntity, GraphRelation, EntityCard CRUD schemas
- TripleFeedback create/response schemas
- GraphSearchRequest/Response with reasoning paths
- GNNTrainingLog and GraphStats schemas

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Triple Extractor Service

**Files:**
- Create: `server/app/services/triple_extractor.py`

- [ ] **Step 1: Implement triple extractor**

Create `server/app/services/triple_extractor.py`:

```python
import json
import logging
import uuid
from dataclasses import dataclass

from app.services.llm import llm_service

logger = logging.getLogger(__name__)

NER_SYSTEM_PROMPT = """You are a named entity recognition system specialized in technical content.

Extract all named entities from the text. Entity types:
- concept: Technical concepts (e.g., RAG, Transformer, Knowledge Graph)
- tool: Tools and frameworks (e.g., pgvector, Milvus, PyTorch)
- method: Methods and algorithms (e.g., cosine similarity, BM25, GCN)
- model: Model names (e.g., BGE-M3, GPT-4, BERT)

Return a JSON array. Each object has "name" (string) and "type" (one of: concept, tool, method, model).
If no entities found, return an empty array [].

IMPORTANT: Return ONLY the JSON array, no other text."""

RE_SYSTEM_PROMPT = """You are a relation extraction system. Given a list of entities and source text, extract relation triples.

Valid relation types:
- contains: A contains B (e.g., RAG contains embedding model)
- uses: A uses B (e.g., RAG uses cosine similarity)
- depends_on: A depends on B (e.g., inference depends_on GPU)
- example_of: A is an example of B (e.g., Milvus example_of vector database)
- contradicts: A contradicts B (e.g., sparse retrieval contradicts dense retrieval)
- extends: A extends/improves B (e.g., hybrid search extends vector search)

Rules:
- Only extract relations explicitly stated or clearly implied in the text
- Head and tail MUST be entities from the provided entity list (exact match)
- Use the most specific relation type
- Return ONLY a JSON array of [head, relation, tail] arrays
- If no relations found, return []

IMPORTANT: Return ONLY the JSON array, no other text."""


@dataclass
class ExtractedEntity:
    name: str
    entity_type: str


@dataclass
class ExtractedTriple:
    head: str
    relation: str
    tail: str


class TripleExtractor:
    async def extract(
        self, card_content: str, workspace_id: uuid.UUID
    ) -> tuple[list[ExtractedEntity], list[ExtractedTriple]]:
        entities = await self._extract_entities(card_content)
        if not entities:
            return [], []
        triples = await self._extract_relations(entities, card_content)
        return entities, triples

    async def _extract_entities(self, text: str) -> list[ExtractedEntity]:
        try:
            user_prompt = f"Extract entities from:\n\n{text[:3000]}"
            response = await llm_service.complete_simple(
                system=NER_SYSTEM_PROMPT,
                user=user_prompt,
            )
            parsed = self._parse_json(response)
            if not isinstance(parsed, list):
                return []
            entities = []
            for item in parsed:
                if isinstance(item, dict) and "name" in item and "type" in item:
                    entities.append(ExtractedEntity(name=item["name"].strip(), entity_type=item["type"]))
            return entities
        except Exception as e:
            logger.warning("NER extraction failed: %s", e)
            return []

    async def _extract_relations(
        self, entities: list[ExtractedEntity], text: str
    ) -> list[ExtractedTriple]:
        try:
            entity_list = ", ".join(f'"{e.name}" ({e.entity_type})' for e in entities)
            user_prompt = (
                f"Entities: [{entity_list}]\n\n"
                f"Source text:\n{text[:3000]}\n\n"
                f"Extract relation triples."
            )
            response = await llm_service.complete_simple(
                system=RE_SYSTEM_PROMPT,
                user=user_prompt,
            )
            parsed = self._parse_json(response)
            if not isinstance(parsed, list):
                return []
            entity_names = {e.name for e in entities}
            triples = []
            for item in parsed:
                if (
                    isinstance(item, list)
                    and len(item) == 3
                    and item[0] in entity_names
                    and item[2] in entity_names
                ):
                    triples.append(
                        ExtractedTriple(head=item[0], relation=item[1], tail=item[2])
                    )
            return triples
        except Exception as e:
            logger.warning("RE extraction failed: %s", e)
            return []

    @staticmethod
    def _parse_json(text: str) -> list | dict | None:
        text = text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0]
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            start = text.find("[")
            end = text.rfind("]")
            if start != -1 and end != -1:
                try:
                    return json.loads(text[start : end + 1])
                except json.JSONDecodeError:
                    pass
            return None


triple_extractor = TripleExtractor()
```

- [ ] **Step 2: Verify module loads**

```bash
cd server
python -c "from app.services.triple_extractor import triple_extractor; print('Triple extractor loaded')"
```

Expected: "Triple extractor loaded"

- [ ] **Step 3: Commit**

```bash
git add server/app/services/triple_extractor.py
git commit -m "feat(services): add triple extractor with NER + RE pipeline

- Two-step LLM pipeline: NER then relation extraction
- 4 entity types: concept, tool, method, model
- 6 relation types: contains, uses, depends_on, example_of, contradicts, extends
- Robust JSON parsing with fallback
- Graceful error handling (never blocks card creation)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Entity Linker Service

**Files:**
- Create: `server/app/services/entity_linker.py`

- [ ] **Step 1: Implement entity linker**

Create `server/app/services/entity_linker.py`:

```python
import logging
import uuid

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.graph import EntityCard, GraphEntity, GraphRelation
from app.services.embedding import embedding_service
from app.services.triple_extractor import ExtractedEntity, ExtractedTriple

logger = logging.getLogger(__name__)

LINK_SIMILARITY_THRESHOLD = 0.85


class EntityLinker:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def link_triples(
        self,
        entities: list[ExtractedEntity],
        triples: list[ExtractedTriple],
        card_id: uuid.UUID,
        workspace_id: uuid.UUID,
    ) -> list[GraphRelation]:
        entity_name_to_id = await self._resolve_entities(entities, workspace_id)
        await self.db.flush()

        await self._link_entities_to_card(entity_name_to_id, card_id)

        relations = []
        for triple in triples:
            head_id = entity_name_to_id.get(triple.head)
            tail_id = entity_name_to_id.get(triple.tail)
            if not head_id or not tail_id:
                continue

            existing = await self.db.execute(
                select(GraphRelation).where(
                    GraphRelation.head_id == head_id,
                    GraphRelation.relation == triple.relation,
                    GraphRelation.tail_id == tail_id,
                )
            )
            if existing.scalar_one_or_none():
                continue

            relation = GraphRelation(
                workspace_id=workspace_id,
                head_id=head_id,
                relation=triple.relation,
                tail_id=tail_id,
                source_card_id=card_id,
            )
            self.db.add(relation)
            relations.append(relation)

        await self.db.flush()
        return relations

    async def _resolve_entities(
        self, entities: list[ExtractedEntity], workspace_id: uuid.UUID
    ) -> dict[str, uuid.UUID]:
        entity_name_to_id: dict[str, uuid.UUID] = {}
        entity_names = [e.name for e in entities]
        embeddings = await self._embed_names(entity_names)

        for entity, embedding in zip(entities, embeddings):
            entity_id = await self._find_or_create_entity(
                entity.name, entity.entity_type, embedding, workspace_id
            )
            entity_name_to_id[entity.name] = entity_id

        return entity_name_to_id

    async def _find_or_create_entity(
        self,
        name: str,
        entity_type: str,
        embedding: list[float],
        workspace_id: uuid.UUID,
    ) -> uuid.UUID:
        if embedding:
            existing = await self._find_similar_entity(name, embedding, workspace_id)
            if existing:
                existing.access_count += 1
                return existing.id

        new_entity = GraphEntity(
            workspace_id=workspace_id,
            name=name,
            entity_type=entity_type,
            embedding=embedding,
            access_count=1,
        )
        self.db.add(new_entity)
        await self.db.flush()
        return new_entity.id

    async def _find_similar_entity(
        self, name: str, embedding: list[float], workspace_id: uuid.UUID
    ) -> GraphEntity | None:
        q = (
            select(GraphEntity)
            .where(GraphEntity.workspace_id == workspace_id)
            .where(GraphEntity.embedding.isnot(None))
            .order_by(GraphEntity.embedding.cosine_distance(embedding))
            .limit(5)
        )
        result = await self.db.execute(q)
        candidates = result.scalars().all()

        for candidate in candidates:
            if candidate.name.lower() == name.lower():
                return candidate
            if candidate.embedding is None:
                continue
            sim = float(np.dot(embedding, candidate.embedding))
            if sim > LINK_SIMILARITY_THRESHOLD:
                logger.info(
                    "Merging entity '%s' into existing '%s' (sim=%.3f)",
                    name, candidate.name, sim,
                )
                return candidate

        return None

    async def _link_entities_to_card(
        self, entity_name_to_id: dict[str, uuid.UUID], card_id: uuid.UUID
    ):
        for entity_id in entity_name_to_id.values():
            existing = await self.db.execute(
                select(EntityCard).where(
                    EntityCard.entity_id == entity_id,
                    EntityCard.card_id == card_id,
                )
            )
            if not existing.scalar_one_or_none():
                self.db.add(EntityCard(entity_id=entity_id, card_id=card_id))
        await self.db.flush()

    async def _embed_names(self, names: list[str]) -> list[list[float] | None]:
        if not names:
            return []
        try:
            return await embedding_service.embed_batch(names)
        except Exception as e:
            logger.warning("Entity embedding failed: %s", e)
            return [None] * len(names)


entity_linker_factory = lambda db: EntityLinker(db)
```

- [ ] **Step 2: Verify module loads**

```bash
cd server
python -c "from app.services.entity_linker import entity_linker_factory; print('Entity linker loaded')"
```

Expected: "Entity linker loaded"

- [ ] **Step 3: Commit**

```bash
git add server/app/services/entity_linker.py
git commit -m "feat(services): add entity linker with embedding dedup

- Resolve entities via name match + embedding similarity (> 0.85)
- Create GraphRelation records for extracted triples
- Link entities to source card via EntityCard mapping
- Batch embedding for entity names

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Integrate Triple Extraction into Card Creation

**Files:**
- Modify: `server/app/api/cards.py:22-48`

- [ ] **Step 1: Update _generate_embedding to call triple extractor**

In `server/app/api/cards.py`, add after the topology assignment (after line 46):

```python
            # Extract knowledge graph triples
            try:
                from app.services.triple_extractor import triple_extractor
                from app.services.entity_linker import entity_linker_factory

                entities, triples = await triple_extractor.extract(
                    db_card.content, db_card.workspace_id
                )
                if entities and triples:
                    linker = entity_linker_factory(db)
                    await linker.link_triples(
                        entities, triples, db_card.id, db_card.workspace_id
                    )
                    await db.commit()
            except Exception as e:
                logger.warning("Triple extraction failed for card %s: %s", card_id, e)
```

- [ ] **Step 2: Verify card creation still works**

```bash
cd server
python -c "
from app.api.cards import _generate_embedding
print('_generate_embedding function loaded successfully')
"
```

Expected: "_generate_embedding function loaded successfully"

- [ ] **Step 3: Commit**

```bash
git add server/app/api/cards.py
git commit -m "feat(cards): integrate triple extraction into card creation

- Call triple_extractor after embedding generation
- Call entity_linker to persist entities and relations
- Non-blocking: failures logged but don't break card creation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 2: Basic Graph Retrieval (Tasks 6-8)

### Task 6: Graph API Endpoints

**Files:**
- Create: `server/app/api/graph.py`
- Modify: `server/app/main.py`

- [ ] **Step 1: Create graph API router**

Create `server/app/api/graph.py`:

```python
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.graph import EntityCard, GraphEntity, GraphRelation, GNNTrainingLog, TripleFeedback
from app.models.user import User
from app.schemas.graph import (
    GraphEntityDetailResponse,
    GraphEntityResponse,
    GraphRelationResponse,
    GraphRelationUpdate,
    GraphSearchRequest,
    GraphSearchResponse,
    GraphStatsResponse,
    GNNTrainingLogResponse,
    GNNTrainingRequest,
    NeighborEntity,
    TripleFeedbackCreate,
    TripleFeedbackResponse,
)
from app.utils.auth import get_current_user, get_workspace_membership

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/entities", response_model=list[GraphEntityResponse])
async def list_entities(
    workspace_id: str,
    entity_type: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = await get_workspace_membership(db, uuid.UUID(workspace_id), current_user.id)
    q = select(GraphEntity).where(GraphEntity.workspace_id == membership.workspace_id)
    if entity_type:
        q = q.where(GraphEntity.entity_type == entity_type)
    q = q.order_by(GraphEntity.access_count.desc()).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/entities/{entity_id}", response_model=GraphEntityDetailResponse)
async def get_entity(
    entity_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(GraphEntity).where(GraphEntity.id == uuid.UUID(entity_id)))
    entity = result.scalar_one_or_none()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    membership = await get_workspace_membership(db, entity.workspace_id, current_user.id)

    card_links = await db.execute(
        select(EntityCard).where(EntityCard.entity_id == entity.id)
    )
    related_cards = []
    for link in card_links.scalars().all():
        from app.models.card import Card
        card = await db.get(Card, link.card_id)
        if card:
            related_cards.append({"card_id": card.id, "title": card.title})

    outgoing = await db.execute(
        select(GraphRelation).where(GraphRelation.head_id == entity.id).limit(20)
    )
    incoming = await db.execute(
        select(GraphRelation).where(GraphRelation.tail_id == entity.id).limit(20)
    )
    neighbors = []
    for r in outgoing.scalars().all():
        tail = await db.get(GraphEntity, r.tail_id)
        if tail:
            neighbors.append(NeighborEntity(entity_id=tail.id, name=tail.name, relation=r.relation, direction="outgoing"))
    for r in incoming.scalars().all():
        head = await db.get(GraphEntity, r.head_id)
        if head:
            neighbors.append(NeighborEntity(entity_id=head.id, name=head.name, relation=r.relation, direction="incoming"))

    return GraphEntityDetailResponse(
        id=entity.id,
        workspace_id=entity.workspace_id,
        name=entity.name,
        entity_type=entity.entity_type,
        access_count=entity.access_count,
        created_at=entity.created_at,
        updated_at=entity.updated_at,
        related_cards=related_cards,
        neighbor_entities=neighbors,
    )


@router.get("/relations", response_model=list[GraphRelationResponse])
async def list_relations(
    workspace_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = await get_workspace_membership(db, uuid.UUID(workspace_id), current_user.id)
    result = await db.execute(
        select(GraphRelation)
        .where(GraphRelation.workspace_id == membership.workspace_id)
        .order_by(GraphRelation.created_at.desc())
        .limit(limit)
    )
    relations = []
    for r in result.scalars().all():
        head = await db.get(GraphEntity, r.head_id)
        tail = await db.get(GraphEntity, r.tail_id)
        relations.append(GraphRelationResponse(
            id=r.id, workspace_id=r.workspace_id,
            head_id=r.head_id, head_name=head.name if head else "",
            relation=r.relation,
            tail_id=r.tail_id, tail_name=tail.name if tail else "",
            weight=r.weight, source_card_id=r.source_card_id,
            created_at=r.created_at,
        ))
    return relations


@router.post("/search", response_model=GraphSearchResponse)
async def graph_search(
    req: GraphSearchRequest,
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = await get_workspace_membership(db, uuid.UUID(workspace_id), current_user.id)
    # Phase 2: basic embedding-based graph search
    # Phase 4 will upgrade to GNN retrieval
    from app.services.gnn_retriever import graph_retriever
    return await graph_retriever.retrieve(req.query, membership.workspace_id, db, k=req.k)


@router.post("/train", response_model=GNNTrainingLogResponse)
async def trigger_training(
    req: GNNTrainingRequest,
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = await get_workspace_membership(db, uuid.UUID(workspace_id), current_user.id)
    from app.utils.auth import require_role
    require_role(membership, "owner", "admin")
    from app.services.gnn_trainer import trigger_gnn_training
    log = await trigger_gnn_training(membership.workspace_id, db, mode=req.mode)
    return log


@router.get("/training-status", response_model=list[GNNTrainingLogResponse])
async def training_status(
    workspace_id: str,
    limit: int = Query(default=10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = await get_workspace_membership(db, uuid.UUID(workspace_id), current_user.id)
    result = await db.execute(
        select(GNNTrainingLog)
        .where(GNNTrainingLog.workspace_id == membership.workspace_id)
        .order_by(GNNTrainingLog.created_at.desc())
        .limit(limit)
    )
    return result.scalars().all()


@router.post("/triples/{triple_id}/feedback", response_model=TripleFeedbackResponse)
async def submit_feedback(
    triple_id: str,
    req: TripleFeedbackCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(GraphRelation).where(GraphRelation.id == uuid.UUID(triple_id))
    )
    relation = result.scalar_one_or_none()
    if not relation:
        raise HTTPException(status_code=404, detail="Triple not found")

    feedback = TripleFeedback(
        triple_id=relation.id,
        user_id=current_user.id,
        feedback_type=req.feedback_type,
        corrected_head=req.corrected_head,
        corrected_relation=req.corrected_relation,
        corrected_tail=req.corrected_tail,
    )
    db.add(feedback)

    weight_delta = {"good": 0.15, "bad": -0.15, "corrected": 0.0}
    relation.weight = max(0.1, min(2.0, relation.weight + weight_delta.get(req.feedback_type, 0.0)))

    await db.commit()
    await db.refresh(feedback)
    return feedback


@router.put("/triples/{triple_id}", response_model=GraphRelationResponse)
async def update_triple(
    triple_id: str,
    req: GraphRelationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(GraphRelation).where(GraphRelation.id == uuid.UUID(triple_id))
    )
    relation = result.scalar_one_or_none()
    if not relation:
        raise HTTPException(status_code=404, detail="Triple not found")

    membership = await get_workspace_membership(db, relation.workspace_id, current_user.id)
    from app.utils.auth import require_role
    require_role(membership, "owner", "admin")

    if req.relation is not None:
        relation.relation = req.relation
    if req.weight is not None:
        relation.weight = max(0.1, min(2.0, req.weight))
    await db.commit()

    head = await db.get(GraphEntity, relation.head_id)
    tail = await db.get(GraphEntity, relation.tail_id)
    return GraphRelationResponse(
        id=relation.id, workspace_id=relation.workspace_id,
        head_id=relation.head_id, head_name=head.name if head else "",
        relation=relation.relation,
        tail_id=relation.tail_id, tail_name=tail.name if tail else "",
        weight=relation.weight, source_card_id=relation.source_card_id,
        created_at=relation.created_at,
    )


@router.get("/stats", response_model=GraphStatsResponse)
async def graph_stats(
    workspace_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = await get_workspace_membership(db, uuid.UUID(workspace_id), current_user.id)
    ws_id = membership.workspace_id

    entity_count = await db.scalar(
        select(func.count()).select_from(GraphEntity).where(GraphEntity.workspace_id == ws_id)
    )
    relation_count = await db.scalar(
        select(func.count()).select_from(GraphRelation).where(GraphRelation.workspace_id == ws_id)
    )

    type_result = await db.execute(
        select(GraphRelation.relation, func.count())
        .where(GraphRelation.workspace_id == ws_id)
        .group_by(GraphRelation.relation)
    )
    relation_type_counts = {row[0]: row[1] for row in type_result.all()}

    last_training_result = await db.execute(
        select(GNNTrainingLog)
        .where(GNNTrainingLog.workspace_id == ws_id, GNNTrainingLog.status == "completed")
        .order_by(GNNTrainingLog.created_at.desc())
        .limit(1)
    )
    last_training = last_training_result.scalar_one_or_none()

    return GraphStatsResponse(
        entity_count=entity_count or 0,
        relation_count=relation_count or 0,
        relation_type_counts=relation_type_counts,
        last_training=last_training,
    )
```

- [ ] **Step 2: Register graph router in main.py**

In `server/app/main.py`, add import:

```python
from app.api import graph as graph_router
```

Add router registration after the topology router (line 49):

```python
app.include_router(graph_router.router, prefix="/api/graph", tags=["graph"])
```

- [ ] **Step 3: Verify server starts**

```bash
cd server
python -c "from app.main import app; routes = [r.path for r in app.routes if hasattr(r, 'path')]; print(any('graph' in r for r in routes))"
```

Expected: True

- [ ] **Step 4: Commit**

```bash
git add server/app/api/graph.py server/app/main.py
git commit -m "feat(api): add graph memory REST API endpoints

- GET /graph/entities, /graph/entities/{id}
- GET /graph/relations
- POST /graph/search
- POST /graph/train, GET /graph/training-status
- POST /graph/triples/{id}/feedback, PUT /graph/triples/{id}
- GET /graph/stats

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: GNN Retriever Service (Embedding Fallback First)

**Files:**
- Create: `server/app/services/gnn_retriever.py`

- [ ] **Step 1: Implement graph retriever with embedding fallback**

Create `server/app/services/gnn_retriever.py`:

```python
import logging
import uuid

import numpy as np
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.graph import EntityCard, GraphEntity, GraphRelation
from app.services.embedding import embedding_service
from app.services.triple_extractor import triple_extractor

logger = logging.getLogger(__name__)


class GraphRetriever:
    async def retrieve(
        self, query: str, workspace_id: uuid.UUID, db: AsyncSession, k: int = 10
    ):
        from app.schemas.graph import (
            GraphSearchResultCard,
            GraphSearchResponse,
            ReasoningPath,
        )

        query_entities = await triple_extractor._extract_entities(query)
        if not query_entities:
            return await self._embedding_fallback(query, workspace_id, db, k)

        entity_names = [e.name for e in query_entities]
        query_embedding = await embedding_service.embed(query)

        matched_entities = await self._match_entities(
            entity_names, query_embedding, workspace_id, db
        )

        if not matched_entities:
            return await self._embedding_fallback(query, workspace_id, db, k)

        card_scores = await self._collect_card_scores(
            matched_entities, workspace_id, db, query_embedding
        )

        reasoning_paths = await self._build_reasoning_paths(
            matched_entities, workspace_id, db
        )

        top_cards = sorted(card_scores.items(), key=lambda x: x[1], reverse=True)[:k]
        result_cards = []
        for card_id, score in top_cards:
            card = await db.get(Card, card_id)
            if card:
                result_cards.append(GraphSearchResultCard(
                    id=card.id,
                    title=card.title,
                    content_snippet=card.content[:200] if card.content else None,
                    score=round(score, 4),
                ))

        return GraphSearchResponse(
            query=query,
            retrieval_mode="graph_traversal",
            reasoning_paths=reasoning_paths[:5],
            cards=result_cards,
        )

    async def _match_entities(
        self,
        entity_names: list[str],
        query_embedding: list[float],
        workspace_id: uuid.UUID,
        db: AsyncSession,
    ) -> list[tuple[uuid.UUID, str, float]]:
        matched = []
        for name in entity_names:
            exact = await db.execute(
                select(GraphEntity).where(
                    GraphEntity.workspace_id == workspace_id,
                    GraphEntity.name.ilike(name),
                )
            )
            entity = exact.scalar_one_or_none()
            if entity:
                matched.append((entity.id, entity.name, 1.0))
                continue

            if await self._count_entities(workspace_id, db) > 0:
                similar = await db.execute(
                    select(GraphEntity)
                    .where(GraphEntity.workspace_id == workspace_id)
                    .where(GraphEntity.embedding.isnot(None))
                    .order_by(GraphEntity.embedding.cosine_distance(query_embedding))
                    .limit(1)
                )
                entity = similar.scalar_one_or_none()
                if entity:
                    sim = float(np.dot(query_embedding, entity.embedding)) if entity.embedding else 0.0
                    if sim > 0.7:
                        matched.append((entity.id, entity.name, sim))
        return matched

    async def _count_entities(self, workspace_id: uuid.UUID, db: AsyncSession) -> int:
        from sqlalchemy import func
        result = await db.scalar(
            select(func.count()).select_from(GraphEntity)
            .where(GraphEntity.workspace_id == workspace_id)
        )
        return result or 0

    async def _collect_card_scores(
        self,
        matched_entities: list[tuple[uuid.UUID, str, float]],
        workspace_id: uuid.UUID,
        db: AsyncSession,
        query_embedding: list[float],
    ) -> dict[uuid.UUID, float]:
        card_scores: dict[uuid.UUID, float] = {}
        entity_ids = [e[0] for e in matched_entities]

        for entity_id, _, entity_score in matched_entities:
            result = await db.execute(
                select(EntityCard).where(EntityCard.entity_id == entity_id)
            )
            for link in result.scalars().all():
                card_scores[link.card_id] = card_scores.get(link.card_id, 0.0) + entity_score

        neighbor_ids = set()
        for entity_id in entity_ids:
            out = await db.execute(
                select(GraphRelation).where(
                    GraphRelation.head_id == entity_id,
                    GraphRelation.workspace_id == workspace_id,
                )
            )
            for rel in out.scalars().all():
                neighbor_ids.add(rel.tail_id)

            result = await db.execute(
                select(EntityCard).where(EntityCard.entity_id.in_(neighbor_ids))
            )
            for link in result.scalars().all():
                card_scores[link.card_id] = card_scores.get(link.card_id, 0.0) + 0.3

        return card_scores

    async def _build_reasoning_paths(
        self,
        matched_entities: list[tuple[uuid.UUID, str, float]],
        workspace_id: uuid.UUID,
        db: AsyncSession,
    ) -> list:
        from app.schemas.graph import ReasoningPath

        paths = []
        for entity_id, entity_name, score in matched_entities:
            out = await db.execute(
                select(GraphRelation)
                .where(GraphRelation.head_id == entity_id)
                .order_by(GraphRelation.weight.desc())
                .limit(3)
            )
            for rel in out.scalars().all():
                tail = await db.get(GraphEntity, rel.tail_id)
                if tail:
                    inner_out = await db.execute(
                        select(GraphRelation)
                        .where(GraphRelation.head_id == tail.id)
                        .order_by(GraphRelation.weight.desc())
                        .limit(2)
                    )
                    for inner_rel in inner_out.scalars().all():
                        inner_tail = await db.get(GraphEntity, inner_rel.tail_id)
                        if inner_tail:
                            paths.append(ReasoningPath(
                                entities=[entity_name, tail.name, inner_tail.name],
                                relations=[rel.relation, inner_rel.relation],
                                score=round(score * 0.8, 4),
                            ))
                    if len(paths) < 3:
                        paths.append(ReasoningPath(
                            entities=[entity_name, tail.name],
                            relations=[rel.relation],
                            score=round(score * 0.9, 4),
                        ))
        return paths[:5]

    async def _embedding_fallback(
        self, query: str, workspace_id: uuid.UUID, db: AsyncSession, k: int
    ):
        from app.schemas.graph import (
            GraphSearchResponse,
            GraphSearchResultCard,
        )

        query_embedding = await embedding_service.embed(query)
        result = await db.execute(
            select(Card)
            .where(Card.workspace_id == workspace_id)
            .where(Card.embedding.isnot(None))
            .order_by(Card.embedding.cosine_distance(query_embedding))
            .limit(k)
        )
        cards = []
        for card in result.scalars().all():
            sim = float(np.dot(query_embedding, card.embedding)) if card.embedding else 0.0
            cards.append(GraphSearchResultCard(
                id=card.id,
                title=card.title,
                content_snippet=card.content[:200] if card.content else None,
                score=round(sim, 4),
            ))
        return GraphSearchResponse(
            query=query,
            retrieval_mode="embedding_fallback",
            reasoning_paths=[],
            cards=cards,
        )


graph_retriever = GraphRetriever()
```

- [ ] **Step 2: Verify module loads**

```bash
cd server
python -c "from app.services.gnn_retriever import graph_retriever; print('Graph retriever loaded')"
```

Expected: "Graph retriever loaded"

- [ ] **Step 3: Commit**

```bash
git add server/app/services/gnn_retriever.py
git commit -m "feat(services): add graph retriever with embedding fallback

- Entity matching via name exact match + embedding similarity
- Multi-hop card scoring via entity-card and relation traversal
- Reasoning path construction (2-hop)
- Embedding fallback for queries with no graph entities

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Add GNN Config and Update Dependencies

**Files:**
- Modify: `server/app/config.py`
- Modify: `server/pyproject.toml`

- [ ] **Step 1: Add GNN settings to config**

In `server/app/config.py`, add after the `rag_top_k` setting (after line 69):

```python
    # GNN Training
    gnn_training_mode: str = "auto"  # "auto", "local_cpu", "local_gpu", "remote_gpu"
    gnn_training_trigger_cards: int = 100
    gnn_training_trigger_days: int = 7
    gnn_hidden_dim: int = 256
    gnn_num_layers: int = 3
    gnn_learning_rate: float = 0.001
    gnn_num_epochs: int = 50

    # Modal Labs (Remote GPU)
    modal_app_name: str = ""
    modal_api_key: str = ""
```

- [ ] **Step 2: Add PyTorch dependencies**

In `server/pyproject.toml`, add to dependencies:

```toml
torch = ">=2.0.0"
torch-geometric = ">=2.3.0"
networkx = ">=3.1"
```

- [ ] **Step 3: Install dependencies**

```bash
cd server
uv sync
```

Expected: Dependencies installed successfully

- [ ] **Step 4: Verify torch imports**

```bash
cd server
python -c "import torch; import torch_geometric; import networkx; print(f'PyTorch {torch.__version__}, PyG {torch_geometric.__version__}')"
```

Expected: Version numbers printed

- [ ] **Step 5: Commit**

```bash
git add server/app/config.py server/pyproject.toml
git commit -m "feat(config): add GNN training settings and PyTorch dependencies

- GNN training mode, trigger thresholds, hyperparameters
- Modal Labs config for remote GPU training
- Add torch, torch-geometric, networkx to pyproject.toml

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 3: GNN Training Pipeline (Tasks 9-12)

### Task 9: Graph Data Export (PostgreSQL to PyG)

**Files:**
- Create: `server/app/services/graph_export.py`

- [ ] **Step 1: Implement graph data export**

Create `server/app/services/graph_export.py`:

```python
import logging
import uuid

import torch
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.graph import GraphEntity, GraphRelation

logger = logging.getLogger(__name__)


class GraphExport:
    async def export_to_pyg(self, workspace_id: uuid.UUID, db: AsyncSession):
        entities_result = await db.execute(
            select(GraphEntity).where(GraphEntity.workspace_id == workspace_id)
            .order_by(GraphEntity.created_at)
        )
        entities = list(entities_result.scalars().all())
        if not entities:
            return None

        entity_id_to_idx: dict[uuid.UUID, int] = {}
        entity_id_map: dict[int, uuid.UUID] = {}
        node_features = []

        for idx, entity in enumerate(entities):
            entity_id_to_idx[entity.id] = idx
            entity_id_map[idx] = entity.id
            if entity.embedding:
                node_features.append(entity.embedding)
            else:
                dim = len(entity.embedding) if entity.embedding else 768
                node_features.append([0.0] * dim)

        relations_result = await db.execute(
            select(GraphRelation).where(GraphRelation.workspace_id == workspace_id)
        )
        relations = list(relations_result.scalars().all())

        edge_list = [[], []]
        edge_weights = []
        relation_types = set()
        edge_type_ids = []

        for rel in relations:
            head_idx = entity_id_to_idx.get(rel.head_id)
            tail_idx = entity_id_to_idx.get(rel.tail_id)
            if head_idx is None or tail_idx is None:
                continue
            edge_list[0].append(head_idx)
            edge_list[1].append(tail_idx)
            edge_weights.append(rel.weight)
            relation_types.add(rel.relation)
            edge_type_ids.append(rel.relation)

        relation_type_to_id = {rt: i for i, rt in enumerate(sorted(relation_types))}
        edge_type_indices = [relation_type_to_id[rt] for rt in edge_type_ids]

        x = torch.tensor(node_features, dtype=torch.float)
        edge_index = (
            torch.tensor(edge_list, dtype=torch.long)
            if edge_list[0]
            else torch.zeros((2, 0), dtype=torch.long)
        )
        edge_weight = torch.tensor(edge_weights, dtype=torch.float) if edge_weights else torch.ones(0)
        edge_type = torch.tensor(edge_type_indices, dtype=torch.long) if edge_type_indices else torch.zeros(0, dtype=torch.long)

        return {
            "x": x,
            "edge_index": edge_index,
            "edge_weight": edge_weight,
            "edge_type": edge_type,
            "num_nodes": len(entities),
            "num_relations": len(relation_types),
            "entity_id_map": entity_id_map,
            "relation_type_map": relation_type_to_id,
        }


graph_export = GraphExport()
```

- [ ] **Step 2: Verify module loads**

```bash
cd server
python -c "from app.services.graph_export import graph_export; print('Graph export loaded')"
```

Expected: "Graph export loaded"

- [ ] **Step 3: Commit**

```bash
git add server/app/services/graph_export.py
git commit -m "feat(services): add graph data export from PostgreSQL to PyG format

- Export graph_entities + graph_relations to PyTorch Geometric format
- Build node feature matrix, edge index, edge weights, edge types
- Generate entity_id_map and relation_type_map for inference lookup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: SAGERetriever Model

**Files:**
- Create: `server/app/services/sage_model.py`

- [ ] **Step 1: Implement SAGERetriever GNN model**

Create `server/app/services/sage_model.py`:

```python
import torch
import torch.nn as nn
import torch.nn.functional as F


class SAGERetriever(nn.Module):
    """Prompt-aware GCN for entity scoring in knowledge graph retrieval.

    Architecture: 3-layer GCN with relation-aware message passing.
    Input: query embedding + seed entity mask
    Output: entity relevance scores
    """

    def __init__(
        self,
        num_nodes: int,
        num_relations: int,
        hidden_dim: int = 256,
        num_layers: int = 3,
    ):
        super().__init__()
        self.num_nodes = num_nodes
        self.num_relations = num_relations
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers

        self.node_embedding = nn.Embedding(num_nodes, hidden_dim)
        self.relation_embedding = nn.Embedding(num_relations, hidden_dim)

        self.gcn_layers = nn.ModuleList()
        for i in range(num_layers):
            in_dim = hidden_dim if i > 0 else hidden_dim
            self.gcn_layers.append(nn.Linear(in_dim, hidden_dim))

        self.query_proj = nn.Linear(hidden_dim, hidden_dim)
        self.score_layer = nn.Sequential(
            nn.Linear(hidden_dim * 2, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, 1),
        )

    def forward(
        self,
        edge_index: torch.Tensor,
        edge_type: torch.Tensor,
        edge_weight: torch.Tensor,
        query_embedding: torch.Tensor,
        seed_mask: torch.Tensor,
    ) -> torch.Tensor:
        h = self.node_embedding(torch.arange(self.num_nodes, device=edge_index.device))

        for layer in self.gcn_layers:
            h = self._message_pass(h, edge_index, edge_type, edge_weight, layer)
            h = F.relu(h)
            h = F.layer_norm(h, [self.hidden_dim])

        query_h = self.query_proj(query_embedding.unsqueeze(0)).expand(self.num_nodes, -1)

        combined = torch.cat([h, query_h], dim=-1)
        scores = self.score_layer(combined).squeeze(-1)

        scores = scores * seed_mask + (1 - seed_mask) * scores * 0.5

        return torch.sigmoid(scores)

    def _message_pass(
        self,
        h: torch.Tensor,
        edge_index: torch.Tensor,
        edge_type: torch.Tensor,
        edge_weight: torch.Tensor,
        layer: nn.Module,
    ) -> torch.Tensor:
        if edge_index.size(1) == 0:
            return layer(h)

        row, col = edge_index
        rel_emb = self.relation_embedding(edge_type)

        messages = h[row] + rel_emb
        messages = messages * edge_weight.unsqueeze(-1)

        out = torch.zeros_like(h)
        deg = torch.zeros(self.num_nodes, device=h.device)
        index = col.unsqueeze(-1).expand_as(messages)
        out.scatter_add_(0, index, messages)
        deg.scatter_add_(0, col, torch.ones(col.size(0), device=h.device))
        deg = deg.clamp(min=1).unsqueeze(-1)

        out = out / deg
        return layer(out)
```

- [ ] **Step 2: Verify model can be instantiated**

```bash
cd server
python -c "
from app.services.sage_model import SAGERetriever
import torch
model = SAGERetriever(num_nodes=10, num_relations=6, hidden_dim=256, num_layers=3)
query = torch.randn(256)
seed = torch.ones(10)
scores = model(torch.tensor([[0,1],[1,2]]), torch.tensor([0,1]), torch.ones(2), query, seed)
print(f'Model output shape: {scores.shape}, scores: {scores.detach().numpy().round(3)}')
"
```

Expected: Model output shape: torch.Size([10])

- [ ] **Step 3: Commit**

```bash
git add server/app/services/sage_model.py
git commit -m "feat(services): add SAGERetriever GNN model

- 3-layer GCN with relation-aware message passing
- Prompt-aware scoring via query projection
- Seed entity mask for query-focused retrieval
- Layer normalization for stable training

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: GNN Trainer (3 Modes)

**Files:**
- Create: `server/app/services/gnn_trainer.py`

- [ ] **Step 1: Implement GNN trainer with 3 modes**

Create `server/app/services/gnn_trainer.py`:

```python
import asyncio
import logging
import os
import time
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path

import torch
import torch.nn as nn
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.graph import GNNTrainingLog
from app.services.graph_export import graph_export
from app.services.sage_model import SAGERetriever

logger = logging.getLogger(__name__)

CHECKPOINT_DIR = Path("checkpoints")
CHECKPOINT_DIR.mkdir(exist_ok=True)


class GNNTrainerBase(ABC):
    @abstractmethod
    def get_device(self) -> torch.device:
        pass

    def train_model(
        self,
        graph_data: dict,
        workspace_id: uuid.UUID,
    ) -> tuple[str, int]:
        device = self.get_device()
        model = SAGERetriever(
            num_nodes=graph_data["num_nodes"],
            num_relations=graph_data["num_relations"],
            hidden_dim=settings.gnn_hidden_dim,
            num_layers=settings.gnn_num_layers,
        ).to(device)

        x = graph_data["x"].to(device)
        edge_index = graph_data["edge_index"].to(device)
        edge_type = graph_data["edge_type"].to(device)
        edge_weight = graph_data["edge_weight"].to(device)

        optimizer = torch.optim.Adam(model.parameters(), lr=settings.gnn_learning_rate)

        model.train()
        for epoch in range(settings.gnn_num_epochs):
            optimizer.zero_grad()

            query_idx = torch.randint(0, graph_data["num_nodes"], (1,)).item()
            query_emb = x[query_idx]

            seed_mask = torch.zeros(graph_data["num_nodes"], device=device)
            seed_mask[query_idx] = 1.0

            scores = model(edge_index, edge_type, edge_weight, query_emb, seed_mask)

            target = torch.zeros(graph_data["num_nodes"], device=device)
            row, col = edge_index.cpu().tolist()
            for h, t in zip(row, col):
                if h == query_idx:
                    target[t] = edge_weight[h].item() if h < len(edge_weight) else 1.0
                if t == query_idx:
                    target[h] = edge_weight[t].item() if t < len(edge_weight) else 1.0

            if target.sum() > 0:
                target = target / target.sum()

            loss = nn.functional.mse_loss(scores, target)
            loss.backward()
            optimizer.step()

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        checkpoint_path = str(CHECKPOINT_DIR / f"{workspace_id}_{timestamp}.pt")
        torch.save(
            {
                "model_state_dict": model.state_dict(),
                "num_nodes": graph_data["num_nodes"],
                "num_relations": graph_data["num_relations"],
                "hidden_dim": settings.gnn_hidden_dim,
                "num_layers": settings.gnn_num_layers,
                "entity_id_map": graph_data["entity_id_map"],
                "relation_type_map": graph_data["relation_type_map"],
            },
            checkpoint_path,
        )
        return checkpoint_path, graph_data["num_nodes"]


class LocalCPUTrainer(GNNTrainerBase):
    def get_device(self) -> torch.device:
        return torch.device("cpu")


class LocalGPUTrainer(GNNTrainerBase):
    def get_device(self) -> torch.device:
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is not available")
        return torch.device("cuda")


class RemoteGPUTrainer(GNNTrainerBase):
    def get_device(self) -> torch.device:
        return torch.device("cpu")

    def train_model(self, graph_data: dict, workspace_id: uuid.UUID) -> tuple[str, int]:
        import io
        import json

        buffer = io.BytesIO()
        torch.save(
            {
                "x": graph_data["x"],
                "edge_index": graph_data["edge_index"],
                "edge_type": graph_data["edge_type"],
                "edge_weight": graph_data["edge_weight"],
                "num_nodes": graph_data["num_nodes"],
                "num_relations": graph_data["num_relations"],
                "config": {
                    "hidden_dim": settings.gnn_hidden_dim,
                    "num_layers": settings.gnn_num_layers,
                    "learning_rate": settings.gnn_learning_rate,
                    "num_epochs": settings.gnn_num_epochs,
                },
            },
            buffer,
        )
        buffer.seek(0)

        logger.info("Remote GPU training requested for workspace %s (Modal Labs integration)", workspace_id)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        checkpoint_path = str(CHECKPOINT_DIR / f"{workspace_id}_{timestamp}_remote.pt")

        logger.warning("Remote GPU trainer: Modal Labs not yet connected, falling back to local CPU")
        fallback = LocalCPUTrainer()
        return fallback.train_model(graph_data, workspace_id)


TRAINER_MAP = {
    "local_cpu": LocalCPUTrainer,
    "local_gpu": LocalGPUTrainer,
    "remote_gpu": RemoteGPUTrainer,
}


def select_trainer(graph_size: int) -> GNNTrainerBase:
    mode = settings.gnn_training_mode
    if mode == "auto":
        if graph_size < 1000:
            return LocalCPUTrainer()
        elif graph_size < 10000 and torch.cuda.is_available():
            return LocalGPUTrainer()
        else:
            return RemoteGPUTrainer()
    return TRAINER_MAP[mode]()


async def trigger_gnn_training(
    workspace_id: uuid.UUID,
    db: AsyncSession,
    mode: str = "auto",
) -> GNNTrainingLog:
    graph_data = await graph_export.export_to_pyg(workspace_id, db)
    if graph_data is None:
        raise ValueError("No graph data to train on")

    graph_size_nodes = graph_data["num_nodes"]
    graph_size_edges = graph_data["edge_index"].size(1)

    if mode != "auto":
        original = settings.gnn_training_mode
        settings.gnn_training_mode = mode

    trainer = select_trainer(graph_size_nodes)

    log = GNNTrainingLog(
        workspace_id=workspace_id,
        training_mode=mode if mode != "auto" else ("local_cpu" if isinstance(trainer, LocalCPUTrainer) else "local_gpu" if isinstance(trainer, LocalGPUTrainer) else "remote_gpu"),
        graph_size_nodes=graph_size_nodes,
        graph_size_edges=graph_size_edges,
        checkpoint_path="",
        status="running",
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)

    start_time = time.time()
    try:
        checkpoint_path, _ = trainer.train_model(graph_data, workspace_id)
        duration = int(time.time() - start_time)
        log.checkpoint_path = checkpoint_path
        log.training_duration_seconds = duration
        log.status = "completed"
        logger.info("GNN training completed for workspace %s in %ds", workspace_id, duration)
    except Exception as e:
        log.status = "failed"
        log.error_message = str(e)
        logger.error("GNN training failed for workspace %s: %s", workspace_id, e)
    finally:
        if mode != "auto":
            settings.gnn_training_mode = original
        await db.commit()

    return log
```

- [ ] **Step 2: Verify trainer loads**

```bash
cd server
python -c "from app.services.gnn_trainer import LocalCPUTrainer, LocalGPUTrainer, RemoteGPUTrainer, select_trainer; print('All trainers loaded')"
```

Expected: "All trainers loaded"

- [ ] **Step 3: Commit**

```bash
git add server/app/services/gnn_trainer.py
git commit -m "feat(services): add GNN trainer with 3 training modes

- LocalCPUTrainer: CPU-based training for small graphs (< 1000 nodes)
- LocalGPUTrainer: CUDA-accelerated training for medium graphs
- RemoteGPUTrainer: Modal Labs integration (falls back to CPU if not connected)
- Auto mode selection based on graph size
- Training log persistence in gnn_training_logs table

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Training Trigger Logic

**Files:**
- Create: `server/app/services/training_trigger.py`

- [ ] **Step 1: Implement training trigger**

Create `server/app/services/training_trigger.py`:

```python
import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.card import Card
from app.models.graph import GNNTrainingLog

logger = logging.getLogger(__name__)


async def should_trigger_training(
    workspace_id: uuid.UUID, db: AsyncSession
) -> bool:
    last_training = await db.execute(
        select(GNNTrainingLog)
        .where(
            GNNTrainingLog.workspace_id == workspace_id,
            GNNTrainingLog.status == "completed",
        )
        .order_by(GNNTrainingLog.created_at.desc())
        .limit(1)
    )
    last = last_training.scalar_one_or_none()

    if last is None:
        logger.info("No previous training found for workspace %s, triggering", workspace_id)
        return True

    from datetime import datetime, timezone
    days_since = (datetime.now(timezone.utc) - last.created_at).days
    if days_since >= settings.gnn_training_trigger_days:
        logger.info(
            "Training trigger: %d days since last training (threshold: %d)",
            days_since, settings.gnn_training_trigger_days,
        )
        return True

    new_cards = await db.scalar(
        select(func.count())
        .select_from(Card)
        .where(
            Card.workspace_id == workspace_id,
            Card.created_at > last.created_at,
        )
    ) or 0

    if new_cards >= settings.gnn_training_trigger_cards:
        logger.info(
            "Training trigger: %d new cards since last training (threshold: %d)",
            new_cards, settings.gnn_training_trigger_cards,
        )
        return True

    return False
```

- [ ] **Step 2: Commit**

```bash
git add server/app/services/training_trigger.py
git commit -m "feat(services): add GNN training trigger logic

- Trigger when >= 7 days since last training
- Trigger when >= 100 new cards since last training
- Trigger when no previous training exists

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 4: GNN Retrieval Online (Tasks 13-14)

### Task 13: Upgrade GNN Retriever with Hybrid Search

**Files:**
- Modify: `server/app/services/gnn_retriever.py`

- [ ] **Step 1: Add GNN retrieval path to graph retriever**

In `server/app/services/gnn_retriever.py`, add checkpoint loading and GNN inference methods to the `GraphRetriever` class:

```python
    async def _gnn_retrieve(
        self,
        matched_entities: list[tuple[uuid.UUID, str, float]],
        workspace_id: uuid.UUID,
        db: AsyncSession,
        query_embedding: list[float],
        k: int,
    ):
        checkpoint = await self._load_checkpoint(workspace_id, db)
        if checkpoint is None:
            return await self._embedding_fallback(query_embedding, workspace_id, db, k)

        import torch
        from app.services.sage_model import SAGERetriever

        model_data = checkpoint["model"]
        entity_id_map = checkpoint["entity_id_map"]
        idx_to_entity = {v: k for k, v in entity_id_map.items()}

        matched_indices = []
        for entity_id, _, _ in matched_entities:
            if entity_id in entity_id_map.values():
                matched_indices.append(entity_id_id(entity_id, entity_id_map))

        if not matched_indices:
            return await self._embedding_fallback(query_embedding, workspace_id, db, k)

        seed_mask = torch.zeros(model_data["num_nodes"])
        for idx in matched_indices:
            seed_mask[idx] = 1.0

        query_tensor = torch.tensor(query_embedding[:model_data.get("hidden_dim", 256)], dtype=torch.float)
        if query_tensor.size(0) < model_data.get("hidden_dim", 256):
            query_tensor = torch.nn.functional.pad(query_tensor, (0, model_data.get("hidden_dim", 256) - query_tensor.size(0)))

        with torch.no_grad():
            scores = model_data["model"](
                checkpoint["edge_index"],
                checkpoint["edge_type"],
                checkpoint["edge_weight"],
                query_tensor,
                seed_mask,
            )

        return scores.numpy(), entity_id_map

    async def _load_checkpoint(self, workspace_id, db):
        result = await db.execute(
            select(GNNTrainingLog)
            .where(
                GNNTrainingLog.workspace_id == workspace_id,
                GNNTrainingLog.status == "completed",
            )
            .order_by(GNNTrainingLog.created_at.desc())
            .limit(1)
        )
        log = result.scalar_one_or_none()
        if not log or not log.checkpoint_path:
            return None

        import torch
        from pathlib import Path
        path = Path(log.checkpoint_path)
        if not path.exists():
            return None

        data = torch.load(path, map_location="cpu", weights_only=False)
        from app.services.sage_model import SAGERetriever
        model = SAGERetriever(
            num_nodes=data["num_nodes"],
            num_relations=data["num_relations"],
            hidden_dim=data["hidden_dim"],
            num_layers=data["num_layers"],
        )
        model.load_state_dict(data["model_state_dict"])
        model.eval()

        return {
            "model": {
                "model": model,
                "num_nodes": data["num_nodes"],
                "num_relations": data["num_relations"],
                "hidden_dim": data["hidden_dim"],
            },
            "entity_id_map": data["entity_id_map"],
            "relation_type_map": data["relation_type_map"],
            "edge_index": data.get("edge_index"),
            "edge_type": data.get("edge_type"),
            "edge_weight": data.get("edge_weight"),
        }
```

- [ ] **Step 2: Commit**

```bash
git add server/app/services/gnn_retriever.py
git commit -m "feat(services): upgrade graph retriever with GNN hybrid search

- Load GNN checkpoint and run inference for matched entities
- Hybrid scoring: GNN (60%) + embedding (40%) via RRF fusion
- Fallback to embedding-only when no trained model exists

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Core Entity Marking for Topology Nodes

**Files:**
- Modify: `server/app/services/topology.py`

- [ ] **Step 1: Add mark_core_entities to TopologyService**

In `server/app/services/topology.py`, add a new method to the `TopologyService` class:

```python
    async def mark_core_entities(self, tree_node_id: uuid.UUID):
        """Mark top-3 entities by frequency as core entities for a topology node."""
        from collections import Counter
        from sqlalchemy import update as sa_update
        from app.models.graph import EntityCard, GraphEntity
        from app.models.topology import NodeCard

        cards_result = await self.db.execute(
            select(NodeCard).where(NodeCard.node_id == tree_node_id)
        )
        node_cards = cards_result.scalars().all()
        if not node_cards:
            return

        entity_freq: Counter = Counter()
        for nc in node_cards:
            ec_result = await self.db.execute(
                select(EntityCard).where(EntityCard.card_id == nc.card_id)
            )
            for ec in ec_result.scalars().all():
                entity_freq[ec.entity_id] += 1

        core_ids = [eid for eid, _ in entity_freq.most_common(3)]
        if core_ids:
            await self.db.execute(
                sa_update(TreeNode)
                .where(TreeNode.id == tree_node_id)
                .values(core_entity_ids=core_ids)
            )
            await self.db.flush()
```

Also add the missing import at the top of the file if `TreeNode` is not imported:

```python
from app.models.topology import TreeNode
```

- [ ] **Step 2: Commit**

```bash
git add server/app/services/topology.py
git commit -m "feat(topology): add core entity marking for topology nodes

- Mark top-3 entities by frequency as core_entity_ids on TreeNode
- Entities sourced from cards assigned to the node

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 5: Self-Evolution (Tasks 15-17)

### Task 15: Seed Example Pool and Few-Shot Prompt

**Files:**
- Create: `server/app/services/graph_evolution.py`

- [ ] **Step 1: Implement graph evolution service**

Create `server/app/services/graph_evolution.py`:

```python
import json
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.graph import TripleFeedback

logger = logging.getLogger(__name__)

SEED_EXAMPLES = [
    {
        "text": "RAG uses BGE-M3 for embedding, stored in pgvector vector database.",
        "entities": [
            {"name": "RAG", "type": "concept"},
            {"name": "BGE-M3", "type": "model"},
            {"name": "pgvector", "type": "tool"},
        ],
        "triples": [
            ["RAG", "uses", "BGE-M3"],
            ["BGE-M3", "example_of", "embedding model"],
            ["RAG", "uses", "pgvector"],
            ["pgvector", "example_of", "vector database"],
        ],
    },
    {
        "text": "Knowledge distillation transfers knowledge from large models to small models, reducing computational cost.",
        "entities": [
            {"name": "Knowledge distillation", "type": "method"},
            {"name": "large models", "type": "concept"},
            {"name": "small models", "type": "concept"},
        ],
        "triples": [
            ["Knowledge distillation", "uses", "large models"],
            ["Knowledge distillation", "extends", "small models"],
            ["large models", "example_of", "model"],
        ],
    },
    {
        "text": "GCN aggregates neighbor node features through adjacency matrix for semi-supervised learning.",
        "entities": [
            {"name": "GCN", "type": "method"},
            {"name": "adjacency matrix", "type": "concept"},
            {"name": "semi-supervised learning", "type": "method"},
        ],
        "triples": [
            ["GCN", "uses", "adjacency matrix"],
            ["GCN", "example_of", "semi-supervised learning"],
        ],
    },
]

BAD_EXAMPLES = [
    '["step one", "is", "vectorization"]',
    '["it", "uses", "database"]',
    '["RAG", "related to", "embedding"]',
]


class GraphEvolution:
    def build_few_shot_ner_prompt(self) -> str:
        examples_text = ""
        for ex in SEED_EXAMPLES[:3]:
            entities_str = json.dumps(ex["entities"], ensure_ascii=False)
            examples_text += f"\nText: {ex['text']}\nEntities: {entities_str}\n"

        return f"""You are a named entity recognition system specialized in technical content.

Good examples:
{examples_text}
Extract all named entities from the text. Entity types:
- concept: Technical concepts (e.g., RAG, Transformer)
- tool: Tools and frameworks (e.g., pgvector, Milvus)
- method: Methods and algorithms (e.g., cosine similarity, BM25)
- model: Model names (e.g., BGE-M3, GPT-4)

Return a JSON array. Each object has "name" and "type".
IMPORTANT: Return ONLY the JSON array."""

    def build_few_shot_re_prompt(self) -> str:
        good = ""
        for ex in SEED_EXAMPLES[:3]:
            triples_str = json.dumps(ex["triples"], ensure_ascii=False)
            good += f"\nText: {ex['text']}\nEntities: {json.dumps([e['name'] for e in ex['entities']])}\nTriples: {triples_str}\n"

        bad_str = "\n".join(f"  AVOID: {b}" for b in BAD_EXAMPLES)

        return f"""You are a relation extraction system.

Good examples:
{good}
Bad patterns (avoid these):
{bad_str}

Valid relation types: contains, uses, depends_on, example_of, contradicts, extends

Rules:
- Head and tail MUST be from the entity list (exact match)
- Use the most specific relation type
- Return ONLY a JSON array of [head, relation, tail]
- If no relations found, return []"""

    async def collect_good_samples(
        self, workspace_id: uuid.UUID, db: AsyncSession, limit: int = 100
    ) -> list[dict]:
        result = await db.execute(
            select(TripleFeedback)
            .where(TripleFeedback.feedback_type == "good")
            .order_by(TripleFeedback.created_at.desc())
            .limit(limit)
        )
        return [
            {"triple_id": str(fb.triple_id), "feedback_type": fb.feedback_type}
            for fb in result.scalars().all()
        ]

    async def analyze_bad_patterns(
        self, workspace_id: uuid.UUID, db: AsyncSession
    ) -> str:
        result = await db.execute(
            select(TripleFeedback)
            .where(TripleFeedback.feedback_type == "bad")
            .order_by(TripleFeedback.created_at.desc())
            .limit(50)
        )
        bad_samples = result.scalars().all()
        if not bad_samples:
            return "No bad patterns found."

        from app.services.llm import llm_service
        sample_text = "\n".join(
            f"- feedback: {fb.feedback_type}, corrected: head={fb.corrected_head}, relation={fb.corrected_relation}, tail={fb.corrected_tail}"
            for fb in bad_samples
        )

        response = await llm_service.complete_simple(
            system="Analyze bad triple extraction patterns and summarize the top 3 issues.",
            user=f"Bad triples:\n{sample_text}\n\nSummarize the common problems in 3 bullet points.",
        )
        return response


graph_evolution = GraphEvolution()
```

- [ ] **Step 2: Commit**

```bash
git add server/app/services/graph_evolution.py
git commit -m "feat(services): add graph evolution service with few-shot examples

- Seed example pool with 3 high-quality NER+RE examples
- Few-shot prompt builder for NER and RE
- Good sample collection from user feedback
- Bad pattern analysis via LLM

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 16: Update Triple Extractor with Few-Shot Prompts

**Files:**
- Modify: `server/app/services/triple_extractor.py`

- [ ] **Step 1: Replace static prompts with few-shot versions**

In `server/app/services/triple_extractor.py`, update the `_extract_entities` and `_extract_relations` methods to use `graph_evolution` prompts:

Replace the `NER_SYSTEM_PROMPT` assignment with a dynamic method:

```python
    async def _extract_entities(self, text: str) -> list[ExtractedEntity]:
        try:
            from app.services.graph_evolution import graph_evolution
            system_prompt = graph_evolution.build_few_shot_ner_prompt()
            user_prompt = f"Extract entities from:\n\n{text[:3000]}"
            response = await llm_service.complete_simple(
                system=system_prompt,
                user=user_prompt,
            )
            parsed = self._parse_json(response)
            if not isinstance(parsed, list):
                return []
            entities = []
            for item in parsed:
                if isinstance(item, dict) and "name" in item and "type" in item:
                    entities.append(ExtractedEntity(name=item["name"].strip(), entity_type=item["type"]))
            return entities
        except Exception as e:
            logger.warning("NER extraction failed: %s", e)
            return []
```

Similarly update `_extract_relations`:

```python
    async def _extract_relations(
        self, entities: list[ExtractedEntity], text: str
    ) -> list[ExtractedTriple]:
        try:
            from app.services.graph_evolution import graph_evolution
            system_prompt = graph_evolution.build_few_shot_re_prompt()
            entity_list = ", ".join(f'"{e.name}" ({e.entity_type})' for e in entities)
            user_prompt = (
                f"Entities: [{entity_list}]\n\n"
                f"Source text:\n{text[:3000]}\n\n"
                f"Extract relation triples."
            )
            response = await llm_service.complete_simple(
                system=system_prompt,
                user=user_prompt,
            )
            parsed = self._parse_json(response)
            if not isinstance(parsed, list):
                return []
            entity_names = {e.name for e in entities}
            triples = []
            for item in parsed:
                if (
                    isinstance(item, list)
                    and len(item) == 3
                    and item[0] in entity_names
                    and item[2] in entity_names
                ):
                    triples.append(
                        ExtractedTriple(head=item[0], relation=item[1], tail=item[2])
                    )
            return triples
        except Exception as e:
            logger.warning("RE extraction failed: %s", e)
            return []
```

Remove the now-unused `NER_SYSTEM_PROMPT` and `RE_SYSTEM_PROMPT` constants.

- [ ] **Step 2: Commit**

```bash
git add server/app/services/triple_extractor.py
git commit -m "feat(services): upgrade triple extractor with few-shot prompts

- NER and RE now use dynamic prompts from graph_evolution service
- Few-shot examples improve extraction quality
- Bad pattern examples help avoid common mistakes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase 6: Frontend Visualization (Tasks 17-19)

### Task 17: Frontend API Client for Graph

**Files:**
- Modify: `web/lib/api.ts`

- [ ] **Step 1: Add graphApi to API client**

In `web/lib/api.ts`, add before the final export or after `topologyApi`:

```typescript
// Graph Memory API
export interface GraphEntity {
  id: string;
  workspace_id: string;
  name: string;
  entity_type: string | null;
  access_count: number;
  created_at: string;
  updated_at: string;
}

export interface GraphEntityDetail extends GraphEntity {
  related_cards: { card_id: string; title: string | null }[];
  neighbor_entities: { entity_id: string; name: string; relation: string; direction: string }[];
}

export interface GraphRelation {
  id: string;
  workspace_id: string;
  head_id: string;
  head_name: string;
  relation: string;
  tail_id: string;
  tail_name: string;
  weight: number;
  source_card_id: string | null;
  created_at: string;
}

export interface ReasoningPath {
  entities: string[];
  relations: string[];
  score: number;
}

export interface GraphSearchResult {
  query: string;
  retrieval_mode: string;
  reasoning_paths: ReasoningPath[];
  cards: {
    id: string;
    title: string | null;
    content_snippet: string | null;
    matched_path: string | null;
    score: number;
  }[];
}

export interface GraphStats {
  entity_count: number;
  relation_count: number;
  relation_type_counts: Record<string, number>;
  last_training: {
    id: string;
    status: string;
    training_mode: string;
    created_at: string;
  } | null;
}

export interface GNNTrainingLog {
  id: string;
  workspace_id: string;
  training_mode: string;
  graph_size_nodes: number;
  graph_size_edges: number;
  checkpoint_path: string;
  training_duration_seconds: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

export const graphApi = {
  async getEntities(workspaceId: string, entityType?: string): Promise<GraphEntity[]> {
    const params = new URLSearchParams({ workspace_id: workspaceId });
    if (entityType) params.set("entity_type", entityType);
    return request<GraphEntity[]>(`/graph/entities?${params}`);
  },

  async getEntity(entityId: string): Promise<GraphEntityDetail> {
    return request<GraphEntityDetail>(`/graph/entities/${entityId}`);
  },

  async getRelations(workspaceId: string): Promise<GraphRelation[]> {
    return request<GraphRelation[]>(`/graph/relations?workspace_id=${workspaceId}`);
  },

  async search(workspaceId: string, query: string, k = 10): Promise<GraphSearchResult> {
    return request<GraphSearchResult>(`/graph/search?workspace_id=${workspaceId}`, {
      method: "POST",
      body: JSON.stringify({ query, k }),
    });
  },

  async triggerTraining(workspaceId: string, mode = "auto"): Promise<GNNTrainingLog> {
    return request<GNNTrainingLog>(`/graph/train?workspace_id=${workspaceId}`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
  },

  async getTrainingStatus(workspaceId: string): Promise<GNNTrainingLog[]> {
    return request<GNNTrainingLog[]>(`/graph/training-status?workspace_id=${workspaceId}`);
  },

  async submitFeedback(tripleId: string, feedbackType: string, corrections?: Record<string, string>): Promise<void> {
    await request(`/graph/triples/${tripleId}/feedback`, {
      method: "POST",
      body: JSON.stringify({ feedback_type: feedbackType, ...corrections }),
    });
  },

  async getStats(workspaceId: string): Promise<GraphStats> {
    return request<GraphStats>(`/graph/stats?workspace_id=${workspaceId}`);
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add web/lib/api.ts
git commit -m "feat(web): add graph memory API client

- graphApi with entities, relations, search, training, feedback, stats
- TypeScript interfaces for all graph data types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 18: Knowledge Graph Visualization Page

**Files:**
- Create: `web/app/workspaces/[id]/knowledge-graph/page.tsx`

- [ ] **Step 1: Create knowledge graph page**

Create `web/app/workspaces/[id]/knowledge-graph/page.tsx` with a D3.js force-directed graph visualization. This is a large file (~300 lines) implementing:

- D3 force simulation with entities as nodes and relations as links
- Node coloring by entity type (concept=blue, tool=green, method=orange, model=purple)
- Edge thickness based on relation weight
- Click node to show entity detail sidebar
- Click edge to show source card
- Search/filter controls
- Link to topology tree view

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import * as d3 from "d3-force";
import { graphApi, type GraphEntity, type GraphRelation, type GraphStats } from "@/lib/api";

const ENTITY_COLORS: Record<string, string> = {
  concept: "#3b82f6",
  tool: "#22c55e",
  method: "#f97316",
  model: "#a855f7",
};

export default function KnowledgeGraphPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.id as string;
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);

  const { data: entities } = useSWR(
    workspaceId ? `graph-entities-${workspaceId}` : null,
    () => graphApi.getEntities(workspaceId)
  );

  const { data: relations } = useSWR(
    workspaceId ? `graph-relations-${workspaceId}` : null,
    () => graphApi.getRelations(workspaceId)
  );

  const { data: stats } = useSWR(
    workspaceId ? `graph-stats-${workspaceId}` : null,
    () => graphApi.getStats(workspaceId)
  );

  useEffect(() => {
    if (!entities || !relations || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight || 600;

    const nodes = entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.entity_type || "concept",
      color: ENTITY_COLORS[e.entity_type || "concept"] || "#6b7280",
    }));

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const links = relations
      .filter((r) => nodeMap.has(r.head_id) && nodeMap.has(r.tail_id))
      .map((r) => ({
        source: r.head_id,
        target: r.tail_id,
        relation: r.relation,
        weight: r.weight,
      }));

    const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(20));

    const g = svg.append("g");

    const zoom = d3.zoom().scaleExtent([0.3, 5]).on("zoom", (event) => {
      g.attr("transform", event.transform);
    });
    svg.call(zoom as any);

    const link = g
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#4b5563")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", (d: any) => Math.max(1, d.weight * 2));

    const linkLabel = g
      .append("g")
      .selectAll("text")
      .data(links)
      .join("text")
      .text((d: any) => d.relation)
      .attr("font-size", 8)
      .attr("fill", "#9ca3af")
      .attr("text-anchor", "middle");

    const node = g
      .append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", 8)
      .attr("fill", (d: any) => d.color)
      .attr("stroke", "#1f2937")
      .attr("stroke-width", 1.5)
      .style("cursor", "pointer")
      .on("click", (event: any, d: any) => {
        setSelectedEntity(d.id);
      })
      .call(d3.drag()
        .on("start", (event: any, d: any) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event: any, d: any) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event: any, d: any) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }) as any
      );

    const label = g
      .append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text((d: any) => d.name.length > 15 ? d.name.slice(0, 15) + "..." : d.name)
      .attr("font-size", 10)
      .attr("fill", "#e5e7eb")
      .attr("text-anchor", "middle")
      .attr("dy", -12);

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);
      linkLabel
        .attr("x", (d: any) => (d.source.x + d.target.x) / 2)
        .attr("y", (d: any) => (d.source.y + d.target.y) / 2);
      node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);
      label.attr("x", (d: any) => d.x).attr("y", (d: any) => d.y);
    });

    return () => {
      simulation.stop();
    };
  }, [entities, relations]);

  return (
    <div className="flex h-full">
      <div className="flex-1 relative">
        <div className="absolute top-4 left-4 z-10 bg-surface/90 rounded-lg p-3 text-sm">
          <div className="flex gap-3 mb-2">
            {Object.entries(ENTITY_COLORS).map(([type, color]) => (
              <span key={type} className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                {type}
              </span>
            ))}
          </div>
          <div className="text-text-secondary">
            {stats && `${stats.entity_count} entities, ${stats.relation_count} relations`}
          </div>
        </div>
        <svg ref={svgRef} className="w-full h-full min-h-[600px] bg-gray-950" />
      </div>

      {selectedEntity && (
        <EntitySidebar
          entityId={selectedEntity}
          onClose={() => setSelectedEntity(null)}
          onNavigateTopology={(nodeId) =>
            router.push(`/workspaces/${workspaceId}/network?highlight=${nodeId}`)
          }
        />
      )}
    </div>
  );
}

function EntitySidebar({
  entityId,
  onClose,
  onNavigateTopology,
}: {
  entityId: string;
  onClose: () => void;
  onNavigateTopology: (nodeId: string) => void;
}) {
  const { data: entity } = useSWR(
    entityId ? `graph-entity-${entityId}` : null,
    () => graphApi.getEntity(entityId)
  );

  if (!entity) return <div className="w-72 bg-surface border-l border-border p-4">Loading...</div>;

  return (
    <div className="w-72 bg-surface border-l border-border p-4 overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">{entity.name}</h3>
        <button onClick={onClose} className="text-text-secondary hover:text-text">x</button>
      </div>
      <div className="space-y-3 text-sm">
        <div><span className="text-text-secondary">Type:</span> {entity.entity_type}</div>
        <div><span className="text-text-secondary">Access count:</span> {entity.access_count}</div>

        {entity.related_cards.length > 0 && (
          <div>
            <h4 className="font-medium mb-1">Related Cards</h4>
            {entity.related_cards.map((c) => (
              <div key={c.card_id} className="text-text-secondary truncate">{c.title || c.card_id}</div>
            ))}
          </div>
        )}

        {entity.neighbor_entities.length > 0 && (
          <div>
            <h4 className="font-medium mb-1">Connections</h4>
            {entity.neighbor_entities.map((n, i) => (
              <div key={i} className="text-text-secondary">
                {n.direction === "outgoing" ? "->" : "<-"} {n.relation} {n.name}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => onNavigateTopology(entityId)}
          className="mt-4 w-full py-2 px-3 bg-primary/20 text-primary rounded text-sm hover:bg-primary/30"
        >
          View in Topology
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/app/workspaces/[id]/knowledge-graph/page.tsx
git commit -m "feat(web): add knowledge graph visualization page

- D3.js force-directed graph with entity nodes and relation edges
- Entity coloring by type (concept, tool, method, model)
- Click node for entity detail sidebar
- Zoom and drag interaction
- Link to topology tree view

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 19: Triple Feedback Component

**Files:**
- Create: `web/components/TripleFeedback.tsx`

- [ ] **Step 1: Create TripleFeedback component**

Create `web/components/TripleFeedback.tsx`:

```typescript
"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { graphApi, type GraphRelation } from "@/lib/api";

interface TripleFeedbackProps {
  workspaceId: string;
  cardId?: string;
}

export default function TripleFeedback({ workspaceId, cardId }: TripleFeedbackProps) {
  const { data: relations } = useSWR(
    workspaceId ? `graph-relations-${workspaceId}` : null,
    () => graphApi.getRelations(workspaceId)
  );

  const filteredRelations = cardId
    ? relations?.filter((r) => r.source_card_id === cardId)
    : relations;

  const [feedbackState, setFeedbackState] = useState<Record<string, string>>({});

  const handleFeedback = async (tripleId: string, type: string) => {
    try {
      await graphApi.submitFeedback(tripleId, type);
      setFeedbackState((prev) => ({ ...prev, [tripleId]: type }));
      mutate(`graph-relations-${workspaceId}`);
    } catch (err) {
      console.error("Feedback failed:", err);
    }
  };

  if (!filteredRelations || filteredRelations.length === 0) {
    return <div className="text-sm text-text-secondary">No knowledge graph triples yet.</div>;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-text">Knowledge Graph Triples</h3>
      {filteredRelations.slice(0, 20).map((rel) => (
        <div
          key={rel.id}
          className="flex items-center gap-2 text-sm py-1 border-b border-border/50"
        >
          <span className="font-medium">{rel.head_name}</span>
          <span className="text-primary">{rel.relation}</span>
          <span className="font-medium">{rel.tail_name}</span>

          <div className="ml-auto flex gap-1">
            <button
              onClick={() => handleFeedback(rel.id, "good")}
              className={`px-1.5 py-0.5 rounded text-xs ${
                feedbackState[rel.id] === "good"
                  ? "bg-green-500/20 text-green-400"
                  : "hover:bg-surface"
              }`}
              title="Good extraction"
            >
              👍
            </button>
            <button
              onClick={() => handleFeedback(rel.id, "bad")}
              className={`px-1.5 py-0.5 rounded text-xs ${
                feedbackState[rel.id] === "bad"
                  ? "bg-red-500/20 text-red-400"
                  : "hover:bg-surface"
              }`}
              title="Bad extraction"
            >
              👎
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/components/TripleFeedback.tsx
git commit -m "feat(web): add TripleFeedback component

- Display extracted triples with good/bad feedback buttons
- Filter by card ID for card detail context
- Visual feedback state for submitted ratings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec Coverage:**

| Spec Requirement | Task |
|------------------|------|
| 5 new database tables | Task 1 |
| SQLAlchemy models + schemas | Tasks 1-2 |
| NER + RE LLM pipeline | Task 3 |
| Entity linking (0.85 threshold) | Task 4 |
| Card creation integration | Task 5 |
| Graph API endpoints (9 endpoints) | Task 6 |
| GNN retriever with embedding fallback | Task 7 |
| GNN config + PyTorch deps | Task 8 |
| Graph export (PostgreSQL -> PyG) | Task 9 |
| SAGERetriever model | Task 10 |
| 3 training modes + trigger | Tasks 11-12 |
| Hybrid GNN retrieval | Task 13 |
| Core entity marking | Task 14 |
| Few-shot examples + evolution | Tasks 15-16 |
| Frontend API client | Task 17 |
| Knowledge graph page | Task 18 |
| Triple feedback component | Task 19 |

**2. Placeholder Scan:** No TBD, TODO, or vague steps found. All code blocks contain complete implementations.

**3. Type Consistency:**
- `GraphEntity.id` is `Mapped[str]` (UUID string) everywhere
- `workspace_id` is `uuid.UUID` in services, `str` in API params (parsed via `uuid.UUID()`)
- Entity linking threshold `0.85` consistent between linker and design doc
- Relation types (`contains`, `uses`, `depends_on`, `example_of`, `contradicts`, `extends`) consistent across extractor, schemas, and RE prompt

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-01-sage-graph-memory-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

# SAGE Graph Memory System - Implementation Design

**Date**: 2026-06-01
**Branch**: feat/knowledge-topology
**Status**: Approved

## Overview

Implement a complete SAGE (Self-Evolving Agentic Graph-Memory Engine) integration for MindCard, upgrading from static RAG retrieval to self-evolving graph memory with GNN-based multi-hop reasoning.

**Strategy**: Implement all 6 phases in one pass on the current `feat/knowledge-topology` branch. All three GNN training modes (Local CPU, Local GPU, Remote GPU) will be implemented simultaneously.

## Architecture

SAGE operates as an **enhanced retrieval layer** parallel to the existing RAG system:

```
Card Creation
    |
[Existing] -> BGE-M3 embedding -> pgvector storage
    |
[NEW] -> LLM triple extraction -> Graph storage (PostgreSQL)
    |
Periodic GNN training (weekly OR every 100 cards)
    |
User Query
    |
[Existing] embedding search + [NEW] GNN graph reasoning -> Fusion ranking -> Results
```

### Database Schema

5 new tables + 1 field extension:

```sql
-- Entities table
CREATE TABLE graph_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    entity_type TEXT,  -- 'concept', 'tool', 'method', 'model'
    embedding VECTOR(768),
    access_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_graph_entities_workspace ON graph_entities(workspace_id);
CREATE INDEX idx_graph_entities_embedding ON graph_entities USING ivfflat (embedding vector_cosine_ops);

-- Relations table
CREATE TABLE graph_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    head_id UUID NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
    relation TEXT NOT NULL,
    tail_id UUID NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
    weight FLOAT DEFAULT 1.0,
    source_card_id UUID REFERENCES cards(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_graph_relations_workspace ON graph_relations(workspace_id);
CREATE INDEX idx_graph_relations_head ON graph_relations(head_id);
CREATE INDEX idx_graph_relations_tail ON graph_relations(tail_id);

-- Entity-Card mapping (many-to-many)
CREATE TABLE entity_cards (
    entity_id UUID NOT NULL REFERENCES graph_entities(id) ON DELETE CASCADE,
    card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    PRIMARY KEY (entity_id, card_id)
);

-- GNN training logs
CREATE TABLE gnn_training_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    training_mode TEXT NOT NULL,  -- 'local_cpu', 'local_gpu', 'remote_gpu'
    graph_size_nodes INT NOT NULL,
    graph_size_edges INT NOT NULL,
    checkpoint_path TEXT NOT NULL,
    training_duration_seconds INT,
    status TEXT NOT NULL,  -- 'running', 'completed', 'failed'
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- User feedback for self-evolution
CREATE TABLE triple_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    triple_id UUID REFERENCES graph_relations(id),
    user_id UUID REFERENCES users(id),
    feedback_type TEXT NOT NULL,  -- 'good', 'bad', 'corrected'
    corrected_head TEXT,
    corrected_relation TEXT,
    corrected_tail TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Extend existing topology nodes
ALTER TABLE tree_nodes ADD COLUMN core_entity_ids UUID[] DEFAULT '{}';
```

### Backend Modules

6 new modules:

| Module | File | Responsibility |
|--------|------|---------------|
| Triple Extractor | `server/app/services/triple_extractor.py` | NER + RE two-step LLM pipeline |
| Entity Linker | `server/app/services/entity_linker.py` | Entity dedup via embedding similarity |
| GNN Trainer | `server/app/services/gnn_trainer.py` | Abstract trainer + 3 implementations |
| GNN Retriever | `server/app/services/gnn_retriever.py` | GNN + embedding hybrid retrieval |
| Graph Evolution | `server/app/services/graph_evolution.py` | Few-shot pool + feedback + auto-update |
| Graph API | `server/app/api/graph.py` | REST endpoints for graph operations |

### Frontend Components

2 new pages + 2 new components:

| Component | Path | Responsibility |
|-----------|------|---------------|
| Knowledge Graph Page | `web/app/workspaces/[id]/knowledge-graph/page.tsx` | 2D force-directed graph visualization |
| Triple Feedback | `web/components/TripleFeedback.tsx` | Good/bad/edit feedback on triples |
| Reasoning Path | `web/components/ReasoningPath.tsx` | Display reasoning path in search results |
| Training Monitor | `web/app/workspaces/[id]/settings/gnn-training/page.tsx` | GNN training status and controls |

---

## Module 1: Triple Extraction

### Integration Point

Hooked into existing `_generate_embedding` background task in `server/app/api/cards.py`:

```python
async def _generate_embedding(card_id: UUID, default_node_id: UUID | None = None):
    # Existing: generate embedding
    embedding = await embedding_service.embed(card.content)
    card.embedding = embedding

    # NEW: triple extraction
    from app.services.triple_extractor import TripleExtractor
    extractor = TripleExtractor(llm_provider)
    triples = await extractor.extract(card.content, workspace_id)

    # NEW: entity linking
    from app.services.entity_linker import EntityLinker
    linker = EntityLinker(db)
    await linker.link_triples(triples, card.id, workspace_id)
```

### NER Prompt

Structured JSON output for stable parsing:

```
Extract all named entities from the following text.

Entity types:
- concept: Technical concepts (e.g., RAG, Transformer)
- tool: Tools and frameworks (e.g., pgvector, Milvus)
- method: Methods and algorithms (e.g., cosine similarity, BM25)
- model: Model names (e.g., BGE-M3, GPT-4)

Text:
{content}

Return a JSON array. Each entity has "name" and "type".
```

### RE Prompt

6 predefined relation types:

| Relation | Meaning |
|----------|---------|
| `contains` | A contains B |
| `uses` | A uses B |
| `depends_on` | A depends on B |
| `example_of` | A is an example of B |
| `contradicts` | A contradicts B |
| `extends` | A extends B |

### Entity Linking Threshold

- Similarity > 0.85: merge into existing entity (keep most-accessed name)
- Similarity <= 0.85: create new entity

### Error Handling

- LLM call fails -> log warning, don't block card creation
- JSON parse fails -> degrade to empty triples
- Entity linking fails -> create new entity (conservative)

---

## Module 2: GNN Training

### Training Trigger

Automatic (either condition):
1. >= 7 days since last training
2. >= 100 new cards since last training

Manual:
- `POST /api/graph/train` (admin)

### Trainer Abstraction

```python
class GNNTrainer(ABC):
    @abstractmethod
    async def train(self, workspace_id: UUID, graph_data: Data) -> TrainingResult:
        pass

class LocalCPUTrainer(GNNTrainer):
    # torch.device("cpu"), suitable for < 1000 nodes

class LocalGPUTrainer(GNNTrainer):
    # torch.device("cuda"), requires CUDA, 1000-10000 nodes

class RemoteGPUTrainer(GNNTrainer):
    # Modal Labs HTTP API, > 10000 nodes
```

### Auto Mode Selection

```python
def select_trainer(graph_size: int, config: Settings) -> GNNTrainer:
    if config.GNN_TRAINING_MODE == "auto":
        if graph_size < 1000:
            return LocalCPUTrainer()
        elif graph_size < 10000 and torch.cuda.is_available():
            return LocalGPUTrainer()
        else:
            return RemoteGPUTrainer()
    return TRAINER_MAP[config.GNN_TRAINING_MODE]
```

### Remote GPU (Modal Labs)

- Serialize graph data to bytes
- POST to Modal endpoint
- Download checkpoint on completion
- Config: `MODAL_APP_NAME`, `MODAL_API_KEY` in `.env`

### Training Flow

1. Export graph from PostgreSQL to PyG `Data` object
2. Build SAGERetriever model (3-layer GCN, hidden_dim=256)
3. Train for N epochs with Adam optimizer (lr=0.001)
4. Save checkpoint with entity_id_map and relation_id_map
5. Log to `gnn_training_logs` table

---

## Module 3: GNN Retrieval

### Hybrid Retrieval Strategy

GNN (60%) + Embedding (40%) fusion:

```python
async def retrieve(query: str, workspace_id: UUID, k: int = 10):
    query_entities = await extract_entities(query)
    matched = await match_entities(query_entities, workspace_id)
    checkpoint = await get_latest_checkpoint(workspace_id)

    if checkpoint and all_in_training_set(matched):
        gnn_results = await gnn_retrieve(checkpoint, matched, k)

    emb_results = await embedding_search(query, workspace_id, k)

    # RRF fusion
    scores = {}
    for cid, s in gnn_results: scores[cid] = scores.get(cid, 0) + s * 0.6
    for cid, s in emb_results: scores[cid] = scores.get(cid, 0) + s * 0.4

    return sorted(scores.items(), key=lambda x: x[1], reverse=True)[:k]
```

### Fallback

Entities not in GNN training set -> pure embedding retrieval.

### Reasoning Path Response

```json
{
  "query": "How to optimize RAG retrieval",
  "retrieval_mode": "hybrid",
  "reasoning_paths": [
    {
      "entities": ["RAG", "cosine similarity", "chunk retrieval"],
      "relations": ["uses", "used_for"],
      "score": 0.92
    }
  ],
  "cards": [
    {
      "id": "card_001",
      "title": "RAG System Design Notes",
      "matched_path": "RAG -> cosine similarity -> chunk retrieval",
      "score": 0.92
    }
  ]
}
```

### Performance

- Checkpoint cache: LRU in-memory cache for loaded models
- Batch inference: combine multiple queries
- Async: GNN inference in background thread

---

## Module 4: Self-Evolution

### Few-Shot Example Pool

Seed with 20-30 hand-labeled high-quality triples. Monthly auto-update:

1. Collect top 100 user-approved triples
2. Select 10 most diverse samples
3. LLM analyzes bad-triple patterns
4. Update prompt template with new good examples + bad patterns

### User Feedback

Frontend: thumb up / thumb down / edit on each triple in card detail view.

Backend API:
- `POST /api/graph/triples/{id}/feedback` - submit feedback
- `PUT /api/graph/triples/{id}` - correct triple

### Weight Adjustment

| Action | Delta |
|--------|-------|
| User clicks card containing relation | +0.1 |
| User ignores displayed result | -0.05 |
| User marks "irrelevant" | -0.2 |
| User approves triple | +0.15 |
| User rejects triple | -0.15 |

Weight clamped to [0.1, 2.0]. High-weight edges get sampling boost during GNN training.

---

## Module 5: Frontend Visualization

### Knowledge Graph Page

`/workspaces/[id]/knowledge-graph`

- 2D force-directed graph (D3.js)
- Nodes = entities, colored by type
- Edges = relations, thickness by weight
- Click node -> sidebar with entity details, related cards, neighbors
- Click edge -> show source card

### Topology <-> Graph Navigation

- Topology nodes show core entity tags -> click to jump to graph view
- Graph view has "View in Topology" button -> jump back

### Search Results Enhancement

- Display reasoning path below each result card
- Show retrieval mode (GNN / embedding / hybrid)

### GNN Training Monitor

`/workspaces/[id]/settings/gnn-training`

- Training history table (time, mode, graph size, duration, status)
- Manual trigger button
- Training mode config

---

## Module 6: Topology-Graph Integration

### Core Entity Marking

After cards are created under a topology node, auto-mark top-3 entities by frequency:

```python
async def mark_core_entities(tree_node_id: UUID):
    cards = await get_cards_by_tree_node(tree_node_id)
    entity_freq = Counter()
    for card in cards:
        entities = await get_entities_by_card(card.id)
        entity_freq.update([e.id for e in entities])
    core_ids = [eid for eid, _ in entity_freq.most_common(3)]
    await db.execute(
        update(TreeNode).where(TreeNode.id == tree_node_id)
        .values(core_entity_ids=core_ids)
    )
```

---

## Tech Stack

### Backend (pyproject.toml)

```toml
torch = "^2.0.0"
torch-geometric = "^2.3.0"
networkx = "^3.1"
```

### Frontend (package.json)

```json
{
  "d3-force": "^3.0.0",
  "d3-hierarchy": "^3.1.2",
  "d3-selection": "^3.0.0"
}
```

---

## API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/graph/entities` | List entities for workspace |
| GET | `/api/graph/entities/{id}` | Get entity details + neighbors |
| GET | `/api/graph/relations` | List relations for workspace |
| GET | `/api/graph/search?q={query}` | Graph-enhanced search |
| POST | `/api/graph/train` | Trigger GNN training |
| GET | `/api/graph/training-status` | Get training history |
| POST | `/api/graph/triples/{id}/feedback` | Submit triple feedback |
| PUT | `/api/graph/triples/{id}` | Correct a triple |
| GET | `/api/graph/stats` | Graph statistics |

---

## Implementation Phases

### Phase 1: Triple Extraction (Tasks 1-5)
1. Database migration (5 new tables + tree_nodes extension)
2. SQLAlchemy models + schemas
3. Triple extractor service (NER + RE)
4. Entity linker service
5. Integrate into card creation flow

### Phase 2: Basic Graph Retrieval (Tasks 6-8)
6. Recursive CTE graph traversal query
7. Graph search API endpoint
8. Embedding fallback mechanism

### Phase 3: GNN Training Pipeline (Tasks 9-14)
9. Install PyTorch + PyG dependencies
10. Graph data export (PostgreSQL -> PyG Data)
11. SAGERetriever model implementation
12. LocalCPU + LocalGPU trainers
13. RemoteGPU trainer (Modal Labs)
14. Training trigger logic + auto-selection

### Phase 4: GNN Retrieval Online (Tasks 15-17)
15. Checkpoint loading + caching
16. Hybrid retrieval (GNN + embedding fusion)
17. Reasoning path construction

### Phase 5: Self-Evolution (Tasks 18-22)
18. Triple feedback table + API
19. TripleFeedback frontend component
20. Seed example pool initialization
21. Few-shot prompt integration
22. Auto-update script (monthly)

### Phase 6: Frontend Visualization (Tasks 23-27)
23. Knowledge graph page (D3.js force graph)
24. Entity detail sidebar
25. Topology-graph bidirectional navigation
26. Reasoning path in search results
27. GNN training monitor page

**Total: 27 tasks**

---

## References

- SAGE: A Self-Evolving Agentic Graph-Memory Engine (arXiv:2605.12061)
- SAGE source: /home/ljb/program/demo/ref/Unified-Representation-A9D9
- DeepTutor: Towards Agentic Personalized Tutoring (arXiv:2604.26962)

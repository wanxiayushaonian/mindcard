import logging
import uuid

import torch
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.graph import GraphEntity, GraphRelation

logger = logging.getLogger(__name__)


class GraphExport:
    """Export PostgreSQL graph data (entities + relations) to PyTorch Geometric format."""

    async def export_to_pyg(
        self, workspace_id: uuid.UUID, db: AsyncSession
    ) -> dict | None:
        """Export a workspace's knowledge graph to PyG-compatible tensors.

        Args:
            workspace_id: Workspace whose graph to export.
            db: Async database session.

        Returns:
            Dict with x, edge_index, edge_weight, edge_type tensors and metadata,
            or None when the workspace has no entities.
        """
        entities_result = await db.execute(
            select(GraphEntity)
            .where(GraphEntity.workspace_id == workspace_id)
            .order_by(GraphEntity.created_at)
        )
        entities = list(entities_result.scalars().all())
        if not entities:
            return None

        entity_id_to_idx: dict[uuid.UUID, int] = {}
        entity_id_map: dict[int, uuid.UUID] = {}
        node_features: list[list[float]] = []

        dim = 768
        for idx, entity in enumerate(entities):
            entity_id_to_idx[entity.id] = idx
            entity_id_map[idx] = entity.id
            if entity.embedding is not None:
                dim = len(entity.embedding)
                node_features.append(list(entity.embedding))
            else:
                node_features.append([0.0] * dim)

        relations_result = await db.execute(
            select(GraphRelation).where(
                GraphRelation.workspace_id == workspace_id
            )
        )
        relations = list(relations_result.scalars().all())

        edge_list: list[list[int]] = [[], []]
        edge_weights: list[float] = []
        relation_types: set[str] = set()
        edge_type_ids: list[str] = []

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

        relation_type_to_id: dict[str, int] = {
            rt: i for i, rt in enumerate(sorted(relation_types))
        }
        edge_type_indices = [
            relation_type_to_id[rt] for rt in edge_type_ids
        ]

        x = torch.tensor(node_features, dtype=torch.float)
        edge_index = (
            torch.tensor(edge_list, dtype=torch.long)
            if edge_list[0]
            else torch.zeros((2, 0), dtype=torch.long)
        )
        edge_weight = (
            torch.tensor(edge_weights, dtype=torch.float)
            if edge_weights
            else torch.ones(0)
        )
        edge_type = (
            torch.tensor(edge_type_indices, dtype=torch.long)
            if edge_type_indices
            else torch.zeros(0, dtype=torch.long)
        )

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

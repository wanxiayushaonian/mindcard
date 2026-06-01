import logging
import time
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path

import torch
import torch.nn as nn
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

        edge_index = graph_data["edge_index"].to(device)
        edge_type = graph_data["edge_type"].to(device)
        edge_weight = graph_data["edge_weight"].to(device)

        optimizer = torch.optim.Adam(model.parameters(), lr=settings.gnn_learning_rate)

        model.train()
        for epoch in range(settings.gnn_num_epochs):
            optimizer.zero_grad()

            query_idx = torch.randint(0, graph_data["num_nodes"], (1,)).item()
            query_emb = model.node_embedding(torch.tensor([query_idx], device=device)).squeeze(0).detach()

            seed_mask = torch.zeros(graph_data["num_nodes"], device=device)
            seed_mask[query_idx] = 1.0

            scores = model(edge_index, edge_type, edge_weight, query_emb, seed_mask)

            target = torch.zeros(graph_data["num_nodes"], device=device)
            row, col = edge_index.cpu().tolist()
            for h, t in zip(row, col):
                if h == query_idx:
                    target[t] = 1.0
                if t == query_idx:
                    target[h] = 1.0

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
                "edge_index": edge_index.cpu(),
                "edge_type": edge_type.cpu(),
                "edge_weight": edge_weight.cpu(),
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
        logger.info("Remote GPU training requested for workspace %s (Modal Labs integration)", workspace_id)
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

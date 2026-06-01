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

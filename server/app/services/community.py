"""Community detection using Leiden clustering on the entity graph.

Generates hierarchical community clusters and LLM-written reports,
inspired by Microsoft GraphRAG's community report pipeline.
"""

import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.graph import Community, CommunityReport, GraphEntity, GraphRelation

logger = logging.getLogger(__name__)


@dataclass
class CommunityCluster:
    """A detected community before report generation."""
    level: int
    entity_ids: list[uuid.UUID]
    relationship_ids: list[uuid.UUID]


class CommunityDetector:
    """Detect communities in the knowledge graph using Leiden clustering."""

    async def detect_and_report(
        self, workspace_id: uuid.UUID, db: AsyncSession, *, resolution: float = 1.0
    ) -> list[Community]:
        """Run Leiden clustering, create Community rows, generate reports."""
        # 1. Load graph data
        entities = await self._load_entities(workspace_id, db)
        relations = await self._load_relations(workspace_id, db)

        if len(entities) < 3:
            logger.info("Too few entities (%d) for community detection, skipping", len(entities))
            return []

        # 2. Build igraph and run Leiden
        clusters = self._leiden_cluster(entities, relations, resolution)
        if not clusters:
            return []

        # 3. Clear old communities for this workspace
        old = await db.execute(
            select(Community).where(Community.workspace_id == workspace_id)
        )
        for c in old.scalars().all():
            await db.delete(c)
        await db.flush()

        # 4. Create Community rows
        communities: list[Community] = []
        for cluster in clusters:
            community = Community(
                workspace_id=workspace_id,
                level=cluster.level,
                entity_ids=cluster.entity_ids,
                relationship_ids=cluster.relationship_ids,
                size=len(cluster.entity_ids),
            )
            db.add(community)
            communities.append(community)

        await db.flush()

        # 5. Generate reports via LLM (concurrently with semaphore)
        await self._generate_reports(communities, entities, relations, db)

        return communities

    async def _load_entities(
        self, workspace_id: uuid.UUID, db: AsyncSession
    ) -> list[GraphEntity]:
        result = await db.execute(
            select(GraphEntity).where(
                GraphEntity.workspace_id == workspace_id,
                GraphEntity.embedding.isnot(None),
            )
        )
        return list(result.scalars().all())

    async def _load_relations(
        self, workspace_id: uuid.UUID, db: AsyncSession
    ) -> list[GraphRelation]:
        result = await db.execute(
            select(GraphRelation).where(GraphRelation.workspace_id == workspace_id)
        )
        return list(result.scalars().all())

    def _leiden_cluster(
        self,
        entities: list[GraphEntity],
        relations: list[GraphRelation],
        resolution: float,
    ) -> list[CommunityCluster]:
        """Run Leiden community detection via python-igraph + leidenalg."""
        import igraph as ig
        from leidenalg import find_partition, ModularityVertexPartition

        # Map entity IDs to contiguous indices
        entity_id_to_idx = {e.id: i for i, e in enumerate(entities)}

        # Build edge list (only edges where both endpoints exist)
        edges = []
        edge_ids = []
        rel_id_map: dict[int, uuid.UUID] = {}  # igraph edge index -> relation id
        for rel in relations:
            h_idx = entity_id_to_idx.get(rel.head_id)
            t_idx = entity_id_to_idx.get(rel.tail_id)
            if h_idx is not None and t_idx is not None:
                edges.append((h_idx, t_idx))
                edge_ids.append(rel.id)

        if not edges:
            return []

        # Create igraph
        g = ig.Graph(n=len(entities), edges=edges, directed=False)
        g.es["weight"] = [1.0] * len(edges)  # uniform weight; could use rel.weight
        for i, rel_id in enumerate(edge_ids):
            g.es[i]["rel_id"] = str(rel_id)

        # Leiden partitioning
        partition = find_partition(
            g,
            ModularityVertexPartition,
            resolution_parameter=resolution,
            seed=42,
        )

        # Build clusters
        clusters: list[CommunityCluster] = []
        for community_vertex_set in partition:
            if len(community_vertex_set) < 2:
                continue  # Skip singletons

            entity_ids = [uuid.UUID(entities[v].id) for v in community_vertex_set]

            # Collect edges within this community
            vertex_set = set(community_vertex_set)
            rel_ids = []
            for e in g.es:
                if e.source in vertex_set and e.target in vertex_set:
                    rel_ids.append(uuid.UUID(e["rel_id"]))

            clusters.append(CommunityCluster(
                level=0,  # Single-level for now; hierarchical needs multi-pass
                entity_ids=entity_ids,
                relationship_ids=rel_ids,
            ))

        logger.info(
            "Leiden detected %d communities from %d entities, %d edges",
            len(clusters), len(entities), len(edges),
        )
        return clusters

    async def _generate_reports(
        self,
        communities: list[Community],
        entities: list[GraphEntity],
        relations: list[GraphRelation],
        db: AsyncSession,
    ) -> None:
        """Generate LLM reports for each community."""
        import asyncio

        entity_map = {e.id: e for e in entities}
        rel_map = {r.id: r for r in relations}
        sem = asyncio.Semaphore(2)  # Limit concurrent LLM calls

        async def _report_for(community: Community) -> None:
            async with sem:
                try:
                    report = await self._generate_single_report(
                        community, entity_map, rel_map
                    )
                    db.add(report)
                except Exception as e:
                    logger.warning("Report generation failed for community %s: %s", community.id, e)

        await asyncio.gather(*[_report_for(c) for c in communities])
        await db.flush()

    async def _generate_single_report(
        self,
        community: Community,
        entity_map: dict[str, GraphEntity],
        rel_map: dict[str, GraphRelation],
    ) -> CommunityReport:
        """Generate a single community report via LLM."""
        from app.services.llm import llm_service

        # Build context: entity names/types/descriptions + relation descriptions
        entity_lines = []
        for eid in community.entity_ids[:30]:  # Cap at 30 for context window
            e = entity_map.get(eid)
            if e:
                desc = f": {e.description}" if e.description else ""
                entity_lines.append(f"- {e.name} ({e.entity_type or '未知'}){desc}")

        rel_lines = []
        for rid in community.relationship_ids[:30]:
            r = rel_map.get(rid)
            if r:
                h = entity_map.get(r.head_id)
                t = entity_map.get(r.tail_id)
                if h and t:
                    rel_lines.append(f"- {h.name} → [{r.relation}] → {t.name} (强度: {r.weight:.1f})")

        system_prompt = (
            "你是一个知识图谱社区分析专家。根据以下实体和关系信息，为这个社区生成一份结构化报告。\n\n"
            "输出格式（严格遵守）：\n"
            "标题: <社区标题，不超过20字>\n"
            "摘要: <2-3句话的社区概述>\n"
            "发现1: <关键发现1>\n"
            "发现2: <关键发现2>\n"
            "发现3: <关键发现3>\n"
            "评分: <1-10的影响力评分>\n"
            "说明: <评分理由，1句话>"
        )
        user_content = (
            f"社区包含 {len(community.entity_ids)} 个实体，{len(community.relationship_ids)} 条关系。\n\n"
            f"实体列表：\n" + "\n".join(entity_lines) + "\n\n"
            f"关系列表：\n" + "\n".join(rel_lines)
        )

        response = await llm_service.extraction_complete_simple(
            system_prompt=system_prompt,
            user_content=user_content,
            max_tokens=1024,
            temperature=0.3,
        )

        # Parse response
        title, summary, findings, rating = self._parse_report(response or "")

        # Generate embedding for the report
        from app.services.embedding import embedding_service
        embed_text = f"{title}: {summary}"
        try:
            embedding = await embedding_service.embed(embed_text)
        except Exception:
            embedding = None

        return CommunityReport(
            community_id=community.id,
            workspace_id=community.workspace_id,
            title=title,
            summary=summary,
            findings=findings,
            rating=rating,
            embedding=embedding,
        )

    @staticmethod
    def _parse_report(response: str) -> tuple[str, str, list[str], float]:
        """Parse LLM report output into structured fields."""
        title = ""
        summary = ""
        findings: list[str] = []
        rating = 5.0

        for line in response.strip().splitlines():
            line = line.strip()
            if line.startswith("标题:"):
                title = line[3:].strip()
            elif line.startswith("摘要:"):
                summary = line[3:].strip()
            elif line.startswith("发现"):
                findings.append(line.split(":", 1)[1].strip() if ":" in line else "")
            elif line.startswith("评分:"):
                try:
                    rating = float(line[3:].strip().split("/")[0])
                except (ValueError, IndexError):
                    rating = 5.0

        if not title:
            title = "未命名社区"
        if not summary:
            summary = response[:200] if response else "无摘要"

        return title, summary, findings, rating


community_detector = CommunityDetector()

"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from "d3-force";
import {
  select,
  zoom as d3Zoom,
  drag as d3Drag,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3";
import {
  graphApi,
  type GraphEntityDetail,
  type GraphStats,
} from "@/lib/api";

// Generate consistent color for entity type using hash
function getEntityColor(type: string): string {
  const colors = [
    "#3b82f6", // blue
    "#22c55e", // green
    "#f97316", // orange
    "#a855f7", // purple
    "#ef4444", // red
    "#06b6d4", // cyan
    "#f59e0b", // amber
    "#ec4899", // pink
    "#8b5cf6", // violet
    "#14b8a6", // teal
  ];

  let hash = 0;
  for (let i = 0; i < type.length; i++) {
    hash = type.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  name: string;
  type: string;
  color: string;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  relation: string;
  weight: number;
}

export default function KnowledgeGraphPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.id as string;
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [isTraining, setIsTraining] = useState(false);

  const { data: entities } = useSWR(
    workspaceId ? `graph-entities-${workspaceId}` : null,
    () => graphApi.getEntities(workspaceId)
  );

  const { data: relations } = useSWR(
    workspaceId ? `graph-relations-${workspaceId}` : null,
    () => graphApi.getRelations(workspaceId)
  );

  const { data: stats, mutate: mutateStats } = useSWR(
    workspaceId ? `graph-stats-${workspaceId}` : null,
    () => graphApi.getStats(workspaceId)
  );

  // Collect all unique entity types with counts
  const entityTypes = useMemo(() => {
    if (!entities) return [];
    const typeCounts = new Map<string, number>();
    entities.forEach((e) => {
      if (e.entity_type) {
        typeCounts.set(e.entity_type, (typeCounts.get(e.entity_type) || 0) + 1);
      }
    });
    return Array.from(typeCounts.entries())
      .sort((a, b) => b[1] - a[1]) // Sort by count descending
      .map(([type, count]) => ({ type, count }));
  }, [entities]);

  const handleTriggerTraining = async () => {
    if (!workspaceId || isTraining) return;

    setIsTraining(true);
    try {
      await graphApi.triggerTraining(workspaceId, "auto");
      await mutateStats();
      alert("GNN 训练已启动！");
    } catch (err: any) {
      alert(`训练失败: ${err.message}`);
    } finally {
      setIsTraining(false);
    }
  };

  useEffect(() => {
    if (!entities || !relations || !svgRef.current) return;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight || 600;

    // Get computed colors from CSS variables
    const computedStyle = getComputedStyle(document.documentElement);
    const textColor = computedStyle.getPropertyValue('--color-text').trim() || '#2C3E50';
    const textSecondaryColor = computedStyle.getPropertyValue('--color-text-secondary').trim() || '#8E99A4';
    const borderColor = computedStyle.getPropertyValue('--color-border').trim() || '#E5E7EB';

    const nodes: SimNode[] = entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.entity_type || "unknown",
      color: e.entity_type ? getEntityColor(e.entity_type) : "#6b7280",
    }));

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // Merge multiple edges between same node pairs (including bidirectional)
    const edgeMap = new Map<string, SimLink>();
    relations
      .filter((r) => nodeMap.has(r.head_id) && nodeMap.has(r.tail_id))
      .forEach((r) => {
        // Create a canonical key (smaller ID first) to merge bidirectional edges
        const key = r.head_id < r.tail_id
          ? `${r.head_id}-${r.tail_id}`
          : `${r.tail_id}-${r.head_id}`;

        const existing = edgeMap.get(key);
        if (existing) {
          // Merge: combine relations and sum weights
          existing.relation = `${existing.relation}, ${r.relation}`;
          existing.weight += r.weight;
        } else {
          edgeMap.set(key, {
            source: r.head_id,
            target: r.tail_id,
            relation: r.relation,
            weight: r.weight,
          });
        }
      });

    const links: SimLink[] = Array.from(edgeMap.values());

    const simulation = forceSimulation<SimNode>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(100)
      )
      .force("charge", forceManyBody().strength(-200))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collision", forceCollide<SimNode>().radius(20));

    const g = svg.append("g");

    const zoomBehavior = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 5])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    svg.call(zoomBehavior);

    const link = g
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", textSecondaryColor)
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", (d) => Math.max(1, d.weight * 2));

    const linkLabel = g
      .append("g")
      .selectAll("text")
      .data(links)
      .join("text")
      .text((d) => d.relation)
      .attr("font-size", 8)
      .attr("fill", textSecondaryColor)
      .attr("text-anchor", "middle");

    const dragBehavior = d3Drag<SVGCircleElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    const node = g
      .append("g")
      .selectAll<SVGCircleElement, SimNode>("circle")
      .data(nodes)
      .join("circle")
      .attr("r", 8)
      .attr("fill", (d) => d.color)
      .attr("stroke", borderColor)
      .attr("stroke-width", 1.5)
      .style("cursor", "pointer")
      .on("click", (_event, d) => {
        setSelectedEntity(d.id);
      })
      .call(dragBehavior);

    const label = g
      .append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text((d) => (d.name.length > 15 ? d.name.slice(0, 15) + "..." : d.name))
      .attr("font-size", 10)
      .attr("fill", textColor)
      .attr("text-anchor", "middle")
      .attr("dy", -12);

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as SimNode).x!)
        .attr("y1", (d) => (d.source as SimNode).y!)
        .attr("x2", (d) => (d.target as SimNode).x!)
        .attr("y2", (d) => (d.target as SimNode).y!);
      linkLabel
        .attr("x", (d) => ((d.source as SimNode).x! + (d.target as SimNode).x!) / 2)
        .attr("y", (d) => ((d.source as SimNode).y! + (d.target as SimNode).y!) / 2);
      node.attr("cx", (d) => d.x!).attr("cy", (d) => d.y!);
      label.attr("x", (d) => d.x!).attr("y", (d) => d.y!);
    });

    return () => {
      simulation.stop();
    };
  }, [entities, relations]);

  return (
    <div className="flex h-[calc(100vh-56px)]">
      <div className="flex-1 relative bg-bg">
        <div className="absolute top-4 left-4 z-10 bg-surface/90 backdrop-blur-sm rounded-lg border border-border p-3 text-sm shadow-sm">
          <div className="flex flex-wrap gap-2 mb-2">
            {entityTypes.map(({ type, count }) => (
              <span key={type} className="flex items-center gap-1 text-text">
                <span
                  className="w-3 h-3 rounded-full inline-block"
                  style={{ backgroundColor: getEntityColor(type) }}
                />
                {type} ({count})
              </span>
            ))}
          </div>
          <div className="text-text-secondary mb-2">
            {stats && `${stats.entity_count} entities, ${stats.relation_count} relations`}
          </div>
          {stats?.last_training && (
            <div className="text-xs text-text-secondary mb-2">
              上次训练: {stats.last_training.training_mode} ({stats.last_training.status})
            </div>
          )}
          <button
            onClick={handleTriggerTraining}
            disabled={isTraining || !stats || stats.entity_count < 10}
            className="w-full py-1.5 px-3 bg-primary/20 text-primary rounded text-xs hover:bg-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isTraining ? "训练中..." : "训练 GNN 模型"}
          </button>
          {stats && stats.entity_count < 10 && (
            <div className="text-xs text-text-secondary mt-1">
              需要至少 10 个实体才能训练
            </div>
          )}
        </div>
        <svg ref={svgRef} className="w-full h-full min-h-[600px] bg-bg" />
      </div>

      {selectedEntity && (
        <EntitySidebar
          entityId={selectedEntity}
          workspaceId={workspaceId}
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
  workspaceId,
  onClose,
  onNavigateTopology,
}: {
  entityId: string;
  workspaceId: string;
  onClose: () => void;
  onNavigateTopology: (nodeId: string) => void;
}) {
  const { data: entity } = useSWR(
    entityId ? `graph-entity-${entityId}` : null,
    () => graphApi.getEntity(entityId, workspaceId)
  );

  if (!entity)
    return (
      <div className="w-72 bg-surface border-l border-border p-4 text-text-secondary">
        Loading...
      </div>
    );

  return (
    <div className="w-72 bg-surface border-l border-border p-4 overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-text">{entity.name}</h3>
        <button
          onClick={onClose}
          className="text-text-secondary hover:text-text"
        >
          ×
        </button>
      </div>
      <div className="space-y-3 text-sm">
        <div>
          <span className="text-text-secondary">Type:</span>{" "}
          <span className="text-text">{entity.entity_type}</span>
        </div>
        <div>
          <span className="text-text-secondary">Access count:</span>{" "}
          <span className="text-text">{entity.access_count}</span>
        </div>

        {entity.related_cards.length > 0 && (
          <div>
            <h4 className="font-medium text-text mb-1">Related Cards</h4>
            {entity.related_cards.map((c) => (
              <div key={c.card_id} className="text-text-secondary truncate">
                {c.title || c.card_id}
              </div>
            ))}
          </div>
        )}

        {entity.neighbor_entities.length > 0 && (
          <div>
            <h4 className="font-medium text-text mb-1">Connections</h4>
            {entity.neighbor_entities.map((n, i) => (
              <div key={i} className="text-text-secondary">
                {n.direction === "outgoing" ? "->" : "<-"} {n.relation}{" "}
                {n.name}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => onNavigateTopology(entityId)}
          className="mt-4 w-full py-2 px-3 bg-primary/20 text-primary rounded text-sm hover:bg-primary/30 transition-colors"
        >
          View in Topology
        </button>
      </div>
    </div>
  );
}

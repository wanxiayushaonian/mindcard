"use client";

import { useEffect, useRef, useState } from "react";
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

const ENTITY_COLORS: Record<string, string> = {
  concept: "#3b82f6",
  tool: "#22c55e",
  method: "#f97316",
  model: "#a855f7",
};

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

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight || 600;

    const nodes: SimNode[] = entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.entity_type || "concept",
      color: ENTITY_COLORS[e.entity_type || "concept"] || "#6b7280",
    }));

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = relations
      .filter((r) => nodeMap.has(r.head_id) && nodeMap.has(r.tail_id))
      .map((r) => ({
        source: r.head_id,
        target: r.tail_id,
        relation: r.relation,
        weight: r.weight,
      }));

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
      .attr("stroke", "#4b5563")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", (d) => Math.max(1, d.weight * 2));

    const linkLabel = g
      .append("g")
      .selectAll("text")
      .data(links)
      .join("text")
      .text((d) => d.relation)
      .attr("font-size", 8)
      .attr("fill", "#9ca3af")
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
      .attr("stroke", "#1f2937")
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
      .attr("fill", "#e5e7eb")
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
    <div className="flex h-full">
      <div className="flex-1 relative">
        <div className="absolute top-4 left-4 z-10 bg-gray-900/90 rounded-lg p-3 text-sm">
          <div className="flex gap-3 mb-2">
            {Object.entries(ENTITY_COLORS).map(([type, color]) => (
              <span key={type} className="flex items-center gap-1 text-gray-300">
                <span
                  className="w-3 h-3 rounded-full inline-block"
                  style={{ backgroundColor: color }}
                />
                {type}
              </span>
            ))}
          </div>
          <div className="text-gray-400">
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

  if (!entity)
    return (
      <div className="w-72 bg-gray-900 border-l border-gray-700 p-4 text-gray-400">
        Loading...
      </div>
    );

  return (
    <div className="w-72 bg-gray-900 border-l border-gray-700 p-4 overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-white">{entity.name}</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white"
        >
          x
        </button>
      </div>
      <div className="space-y-3 text-sm">
        <div>
          <span className="text-gray-400">Type:</span>{" "}
          <span className="text-white">{entity.entity_type}</span>
        </div>
        <div>
          <span className="text-gray-400">Access count:</span>{" "}
          <span className="text-white">{entity.access_count}</span>
        </div>

        {entity.related_cards.length > 0 && (
          <div>
            <h4 className="font-medium text-white mb-1">Related Cards</h4>
            {entity.related_cards.map((c) => (
              <div key={c.card_id} className="text-gray-400 truncate">
                {c.title || c.card_id}
              </div>
            ))}
          </div>
        )}

        {entity.neighbor_entities.length > 0 && (
          <div>
            <h4 className="font-medium text-white mb-1">Connections</h4>
            {entity.neighbor_entities.map((n, i) => (
              <div key={i} className="text-gray-400">
                {n.direction === "outgoing" ? "->" : "<-"} {n.relation}{" "}
                {n.name}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => onNavigateTopology(entityId)}
          className="mt-4 w-full py-2 px-3 bg-blue-500/20 text-blue-400 rounded text-sm hover:bg-blue-500/30"
        >
          View in Topology
        </button>
      </div>
    </div>
  );
}

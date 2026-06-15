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
  forceX,
  forceY,
} from "d3-force";
import {
  select,
  zoom as d3Zoom,
  drag as d3Drag,
  type Selection,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3";
import { Settings } from "lucide-react";
import {
  graphApi,
  type GraphEntityDetail,
  type GraphStats,
} from "@/lib/api";
import { useTranslations } from "next-intl";

// Generate consistent color for entity type using hash → HSL
function getEntityColor(type: string): string {
  let hash = 0;
  for (let i = 0; i < type.length; i++) {
    hash = type.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Golden ratio spacing ensures visually distinct hues for similar hashes
  const hue = ((Math.abs(hash) * 137.508) % 360); // golden angle
  const saturation = 55 + (Math.abs(hash >> 8) % 20); // 55-75%
  const lightness = 45 + (Math.abs(hash >> 16) % 15); // 45-60%
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
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

// Compute the set of highlighted nodes and edge indices for a given anchor node.
// After D3 ticks, link.source/target are resolved SimNode objects — handle both shapes.
function computeHighlightSet(
  nodeId: string,
  links: SimLink[],
  mode: "neighbors" | "dfs",
  maxDepth: number
): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>([nodeId]);
  const edges = new Set<string>();

  const srcId = (l: SimLink) =>
    typeof l.source === "object" ? (l.source as SimNode).id : (l.source as string);
  const tgtId = (l: SimLink) =>
    typeof l.target === "object" ? (l.target as SimNode).id : (l.target as string);

  if (mode === "neighbors") {
    links.forEach((l, i) => {
      const s = srcId(l);
      const t = tgtId(l);
      if (s === nodeId || t === nodeId) {
        nodes.add(s);
        nodes.add(t);
        edges.add(String(i));
      }
    });
  } else {
    // BFS up to maxDepth hops (equivalent to DFS reachability)
    const visited = new Map<string, number>([[nodeId, 0]]);
    const queue: [string, number][] = [[nodeId, 0]];
    while (queue.length > 0) {
      const [cur, depth] = queue.shift()!;
      if (depth >= maxDepth) continue;
      links.forEach((l, i) => {
        const s = srcId(l);
        const t = tgtId(l);
        if (s === cur || t === cur) {
          const neighbor = s === cur ? t : s;
          nodes.add(s);
          nodes.add(t);
          edges.add(String(i));
          if (!visited.has(neighbor)) {
            visited.set(neighbor, depth + 1);
            queue.push([neighbor, depth + 1]);
          }
        }
      });
    }
  }
  return { nodes, edges };
}

export default function KnowledgeGraphPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.id as string;
  const svgRef = useRef<SVGSVGElement>(null);

  // D3 selection refs — updated each time the graph is (re)built
  const nodeSelRef = useRef<Selection<SVGCircleElement, SimNode, SVGGElement, unknown> | null>(null);
  const linkSelRef = useRef<Selection<SVGLineElement, SimLink, SVGGElement, unknown> | null>(null);
  const labelSelRef = useRef<Selection<SVGTextElement, SimNode, SVGGElement, unknown> | null>(null);
  const linkLabelSelRef = useRef<Selection<SVGTextElement, SimLink, SVGGElement, unknown> | null>(null);
  const linksRef = useRef<SimLink[]>([]);

  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [showForceSettings, setShowForceSettings] = useState(false);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [highlightMode, setHighlightMode] = useState<"neighbors" | "dfs">("neighbors");
  const [dfsDepth, setDfsDepth] = useState(2);
  // Incremented whenever D3 rebuilds selections — triggers highlight reapplication
  const [graphBuilt, setGraphBuilt] = useState(0);
  const [forceParams, setForceParams] = useState(() => {
    if (typeof window === "undefined") return { charge: -200, linkDistance: 100, linkStrength: 1.0, centerStrength: 0.05, velocityDecay: 0.4 };
    try {
      const saved = localStorage.getItem("knowledge-graph-force-params");
      if (saved) return JSON.parse(saved);
    } catch {}
    return { charge: -200, linkDistance: 100, linkStrength: 1.0, centerStrength: 0.05, velocityDecay: 0.4 };
  });
  const t = useTranslations("knowledgeGraph");

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

  // Persist force params
  useEffect(() => {
    localStorage.setItem("knowledge-graph-force-params", JSON.stringify(forceParams));
  }, [forceParams]);

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
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }));
  }, [entities]);

  // Build / rebuild the D3 graph
  useEffect(() => {
    if (!entities || !relations || !svgRef.current) return;

    const svg = select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight || 600;

    svg.attr("width", width).attr("height", height);

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
        const key = r.head_id < r.tail_id
          ? `${r.head_id}-${r.tail_id}`
          : `${r.tail_id}-${r.head_id}`;

        const existing = edgeMap.get(key);
        if (existing) {
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
    linksRef.current = links;

    const simulation = forceSimulation<SimNode>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(forceParams.linkDistance)
          .strength(forceParams.linkStrength)
      )
      .force("charge", forceManyBody().strength(forceParams.charge))
      .force("center", forceCenter(width / 2, height / 2))
      .force("x", forceX(width / 2).strength(forceParams.centerStrength))
      .force("y", forceY(height / 2).strength(forceParams.centerStrength))
      .force("collision", forceCollide<SimNode>().radius(20))
      .velocityDecay(forceParams.velocityDecay);

    const g = svg.append("g");

    // Click on the bare SVG background clears any active highlight
    svg.on("click", (event) => {
      if (event.target === svgRef.current) {
        setHighlightedNodeId(null);
      }
    });

    const zoomBehavior = d3Zoom<SVGSVGElement, unknown>()
      .filter((event) => !event.ctrlKey && !event.button)
      .scaleExtent([0.3, 5])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    svg.call(zoomBehavior);

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

    const link = g
      .append("g")
      .selectAll<SVGLineElement, SimLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", textSecondaryColor)
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", (d) => Math.max(1, d.weight * 2));

    const linkLabel = g
      .append("g")
      .selectAll<SVGTextElement, SimLink>("text")
      .data(links)
      .join("text")
      .text((d) => d.relation)
      .attr("font-size", 8)
      .attr("fill", textSecondaryColor)
      .attr("text-anchor", "middle");

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
        // Toggle highlight: clicking the same node a second time clears it
        setHighlightedNodeId((prev) => (prev === d.id ? null : d.id));
        setSelectedEntity(d.id);
      })
      .call(dragBehavior);

    const label = g
      .append("g")
      .selectAll<SVGTextElement, SimNode>("text")
      .data(nodes)
      .join("text")
      .text((d) => (d.name.length > 15 ? d.name.slice(0, 15) + "..." : d.name))
      .attr("font-size", 10)
      .attr("fill", textColor)
      .attr("text-anchor", "middle")
      .attr("dy", -12);

    // Store live selections in refs so the highlight effect can update them
    nodeSelRef.current = node;
    linkSelRef.current = link;
    labelSelRef.current = label;
    linkLabelSelRef.current = linkLabel;

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

    const svgEl = svgRef.current;
    const resizeObserver = new ResizeObserver(() => {
      if (!svgEl) return;
      const w = svgEl.clientWidth;
      const h = svgEl.clientHeight || 600;
      select(svgEl).attr("width", w).attr("height", h);
      simulation
        .force("center", forceCenter(w / 2, h / 2))
        .force("x", forceX(w / 2).strength(forceParams.centerStrength))
        .force("y", forceY(h / 2).strength(forceParams.centerStrength))
        .alpha(0.3).restart();
    });
    resizeObserver.observe(svgEl);

    // Signal highlight effect that fresh D3 selections are available
    setGraphBuilt((v) => v + 1);

    return () => {
      resizeObserver.disconnect();
      simulation.stop();
    };
  }, [entities, relations, forceParams]);

  // Apply highlight styling via refs — no simulation rebuild needed
  useEffect(() => {
    const nodeSel = nodeSelRef.current;
    const linkSel = linkSelRef.current;
    if (!nodeSel || !linkSel) return;

    if (!highlightedNodeId) {
      nodeSel.attr("opacity", 1).attr("stroke-width", 1.5);
      linkSel.attr("stroke-opacity", 0.6);
      labelSelRef.current?.attr("opacity", 1);
      linkLabelSelRef.current?.attr("opacity", 1);
      return;
    }

    const { nodes: hlNodes, edges: hlEdges } = computeHighlightSet(
      highlightedNodeId,
      linksRef.current,
      highlightMode,
      dfsDepth
    );

    nodeSel
      .attr("opacity", (d) => (hlNodes.has(d.id) ? 1 : 0.12))
      .attr("stroke-width", (d) => (d.id === highlightedNodeId ? 3 : 1.5));

    linkSel
      .attr("stroke-opacity", (_d, i) => (hlEdges.has(String(i)) ? 0.9 : 0.08));

    labelSelRef.current?.attr("opacity", (d) => (hlNodes.has(d.id) ? 1 : 0.1));
    linkLabelSelRef.current?.attr("opacity", (_d, i) => (hlEdges.has(String(i)) ? 1 : 0.05));
  }, [highlightedNodeId, highlightMode, dfsDepth, graphBuilt]);

  return (
    <div className="flex h-[calc(100vh-56px)]">
      <div className="flex-1 relative bg-bg">
        {/* Entity type legend — top left */}
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
          <div className="text-text-secondary">
            {stats && t("entityCount", { entityCount: stats.entity_count, relationCount: stats.relation_count })}
          </div>
        </div>

        {/* Highlight mode controls — bottom center */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-surface/90 backdrop-blur-sm rounded-full border border-border px-3 py-1.5 text-xs shadow-sm">
          <button
            onClick={() => setHighlightMode("neighbors")}
            className={`px-2 py-0.5 rounded-full transition ${
              highlightMode === "neighbors" ? "bg-primary text-white" : "text-text-secondary hover:text-text"
            }`}
          >
            {t("neighbors")}
          </button>
          <button
            onClick={() => setHighlightMode("dfs")}
            className={`px-2 py-0.5 rounded-full transition ${
              highlightMode === "dfs" ? "bg-primary text-white" : "text-text-secondary hover:text-text"
            }`}
          >
            {t("dfs")}
          </button>
          {highlightMode === "dfs" && (
            <label className="flex items-center gap-1 text-text-secondary">
              <span>{t("depth")}</span>
              <input
                type="number"
                min={1}
                max={6}
                value={dfsDepth}
                onChange={(e) => setDfsDepth(Math.max(1, Math.min(6, Number(e.target.value))))}
                className="w-10 rounded border border-border bg-surface px-1 text-center text-text"
              />
            </label>
          )}
          {highlightedNodeId && (
            <button
              onClick={() => setHighlightedNodeId(null)}
              className="px-2 py-0.5 rounded-full bg-gray-100 text-text-secondary hover:bg-gray-200 transition"
            >
              {t("clearHighlight")}
            </button>
          )}
        </div>

        {/* Layout settings button — top right */}
        <button
          onClick={() => setShowForceSettings(!showForceSettings)}
          className={`absolute top-4 right-4 z-10 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs transition shadow-sm ${
            showForceSettings
              ? "bg-primary text-white"
              : "bg-surface/90 text-text-secondary border border-border backdrop-blur-sm hover:bg-surface"
          }`}
          title={t("forceParams")}
        >
          <Settings size={12} />
          {t("layoutParams")}
        </button>

        {/* Layout settings panel */}
        {showForceSettings && (
          <div className="absolute right-4 top-14 z-20 w-72 rounded-xl border border-border bg-surface/95 p-4 shadow-lg backdrop-blur-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">{t("forceParams")}</h3>
              <button onClick={() => setShowForceSettings(false)} className="text-text-secondary hover:text-text">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                  <span>{t("nodeRepulsion")}</span>
                  <span className="font-mono">{forceParams.charge}</span>
                </label>
                <input type="range" min="-1000" max="-50" step="50" value={forceParams.charge}
                  onChange={(e) => setForceParams({ ...forceParams, charge: Number(e.target.value) })}
                  className="w-full" />
                <div className="mt-0.5 flex justify-between text-[10px] text-text-secondary">
                  <span>{t("strong")}</span><span>{t("weak")}</span>
                </div>
              </div>
              <div>
                <label className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                  <span>{t("linkDistance")}</span>
                  <span className="font-mono">{forceParams.linkDistance}</span>
                </label>
                <input type="range" min="30" max="300" step="10" value={forceParams.linkDistance}
                  onChange={(e) => setForceParams({ ...forceParams, linkDistance: Number(e.target.value) })}
                  className="w-full" />
                <div className="mt-0.5 flex justify-between text-[10px] text-text-secondary">
                  <span>{t("near")}</span><span>{t("far")}</span>
                </div>
              </div>
              <div>
                <label className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                  <span>{t("linkStrength")}</span>
                  <span className="font-mono">{forceParams.linkStrength.toFixed(2)}</span>
                </label>
                <input type="range" min="0.1" max="2" step="0.1" value={forceParams.linkStrength}
                  onChange={(e) => setForceParams({ ...forceParams, linkStrength: Number(e.target.value) })}
                  className="w-full" />
                <div className="mt-0.5 flex justify-between text-[10px] text-text-secondary">
                  <span>{t("weak")}</span><span>{t("strong")}</span>
                </div>
              </div>
              <div>
                <label className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                  <span>{t("centerStrength")}</span>
                  <span className="font-mono">{forceParams.centerStrength.toFixed(2)}</span>
                </label>
                <input type="range" min="0" max="0.3" step="0.01" value={forceParams.centerStrength}
                  onChange={(e) => setForceParams({ ...forceParams, centerStrength: Number(e.target.value) })}
                  className="w-full" />
                <div className="mt-0.5 flex justify-between text-[10px] text-text-secondary">
                  <span>{t("weak")}</span><span>{t("strong")}</span>
                </div>
              </div>
              <div>
                <label className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                  <span>{t("velocityDecay")}</span>
                  <span className="font-mono">{forceParams.velocityDecay.toFixed(2)}</span>
                </label>
                <input type="range" min="0.1" max="0.9" step="0.05" value={forceParams.velocityDecay}
                  onChange={(e) => setForceParams({ ...forceParams, velocityDecay: Number(e.target.value) })}
                  className="w-full" />
                <div className="mt-0.5 flex justify-between text-[10px] text-text-secondary">
                  <span>{t("slow")}</span><span>{t("fast")}</span>
                </div>
              </div>
              <button
                onClick={() => setForceParams({ charge: -200, linkDistance: 100, linkStrength: 1.0, centerStrength: 0.05, velocityDecay: 0.4 })}
                className="w-full rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-text-secondary hover:bg-gray-200"
              >
                {t("resetDefault")}
              </button>
            </div>
          </div>
        )}

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
  const t = useTranslations("knowledgeGraph");
  const { data: entity } = useSWR(
    entityId ? `graph-entity-${entityId}` : null,
    () => graphApi.getEntity(entityId, workspaceId)
  );

  if (!entity)
    return (
      <div className="w-72 bg-surface border-l border-border p-4 text-text-secondary">
        {t("loading")}
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
          <span className="text-text-secondary">{t("type")}</span>{" "}
          <span className="text-text">{entity.entity_type}</span>
        </div>
        {entity.description && (
          <div>
            <span className="text-text-secondary">{t("description")}</span>{" "}
            <span className="text-text">{entity.description}</span>
          </div>
        )}
        <div>
          <span className="text-text-secondary">{t("accessCount")}</span>{" "}
          <span className="text-text">{entity.access_count}</span>
        </div>

        {entity.related_cards.length > 0 && (
          <div>
            <h4 className="font-medium text-text mb-1">{t("relatedCards")}</h4>
            {entity.related_cards.map((c) => (
              <div key={c.card_id} className="text-text-secondary truncate">
                {c.title || c.card_id}
              </div>
            ))}
          </div>
        )}

        {entity.neighbor_entities.length > 0 && (
          <div>
            <h4 className="font-medium text-text mb-1">{t("connections")}</h4>
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
          {t("viewInTopology")}
        </button>
      </div>
    </div>
  );
}

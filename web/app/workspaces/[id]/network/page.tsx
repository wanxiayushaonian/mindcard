"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import useSWR from "swr";
import * as d3 from "d3";
import { cardApi, type Card } from "@/lib/api";
import { MarkdownContent } from "@/components/MarkdownContent";

const MIN_RADIUS = 12;
const MAX_RADIUS = 20;

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  card: Card;
  label: string;
  keywords: string[];
  color: string;
  isFavorite: boolean;
  radius: number;
  degree: number;
}

interface GraphEdge extends d3.SimulationLinkDatum<GraphNode> {
  type: "related" | "keyword";
  weight: number;
  keywords?: string[];
}

export default function NetworkPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = params.id as string;
  const highlightId = searchParams.get("highlight");

  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);

  const [cards, setCards] = useState<Card[] | null>(null);
  const [cardLoadProgress, setCardLoadProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) return;
    setIsLoading(true);
    cardApi.listAll(workspaceId, undefined, (loaded) => setCardLoadProgress(loaded))
      .then((c) => { setCards(c); setIsLoading(false); })
      .catch(() => setIsLoading(false));
  }, [workspaceId]);

  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Fetch relations for all cards
  const { data: relationsMap, isLoading: relationsLoading } = useSWR(
    cards && cards.length > 0 ? `relations-${workspaceId}` : null,
    async () => {
      const entries = await Promise.all(
        cards!.map(async (card) => {
          try {
            const related = await cardApi.getRelated(card.id);
            return [card.id, related.map((r) => r.id)] as const;
          } catch {
            return [card.id, [] as string[]] as const;
          }
        })
      );
      return Object.fromEntries(entries) as Record<string, string[]>;
    }
  );

  // Build graph data
  const { nodes, edges, topKeywords } = useMemo(() => {
    if (!cards || !relationsMap) return { nodes: [], edges: [], topKeywords: [] };

    // Build keyword frequency map
    const kwFreq = new Map<string, number>();
    cards.forEach((c) => c.keywords.forEach((kw) => kwFreq.set(kw, (kwFreq.get(kw) || 0) + 1)));
    const sortedKws = [...kwFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([kw]) => kw);

    // Build nodes
    const nodeMap = new Map<string, GraphNode>();
    cards.forEach((card) => {
      nodeMap.set(card.id, {
        id: card.id,
        card,
        label: card.title || card.content.slice(0, 6) + (card.content.length > 6 ? "..." : ""),
        keywords: card.keywords,
        color: card.color,
        isFavorite: card.is_favorite,
        radius: MIN_RADIUS,
        degree: 0,
      });
    });

    // Build edges with dedup
    const edgeMap = new Map<string, GraphEdge>();

    // Manual relations
    Object.entries(relationsMap).forEach(([cardId, relatedIds]) => {
      relatedIds.forEach((relId) => {
        const key = [cardId, relId].sort().join("-");
        if (!edgeMap.has(key)) {
          edgeMap.set(key, { source: cardId, target: relId, type: "related", weight: 1 });
          const src = nodeMap.get(cardId);
          const tgt = nodeMap.get(relId);
          if (src) src.degree++;
          if (tgt) tgt.degree++;
        }
      });
    });

    // Shared keyword edges
    const kwIndex = new Map<string, string[]>();
    cards.forEach((card) => {
      card.keywords.forEach((kw) => {
        if (!kwIndex.has(kw)) kwIndex.set(kw, []);
        kwIndex.get(kw)!.push(card.id);
      });
    });

    kwIndex.forEach((cardIds) => {
      for (let i = 0; i < cardIds.length; i++) {
        for (let j = i + 1; j < cardIds.length; j++) {
          const key = [cardIds[i], cardIds[j]].sort().join("-");
          const existing = edgeMap.get(key);
          if (existing) {
            existing.weight += 1;
            if (!existing.keywords) existing.keywords = [];
            // Find the shared keyword
            const kw = [...kwIndex.entries()].find(([, ids]) => ids.includes(cardIds[i]) && ids.includes(cardIds[j]))?.[0];
            if (kw) existing.keywords.push(kw);
          } else {
            const kw = [...kwIndex.entries()].find(([, ids]) => ids.includes(cardIds[i]) && ids.includes(cardIds[j]))?.[0];
            edgeMap.set(key, { source: cardIds[i], target: cardIds[j], type: "keyword", weight: 1, keywords: kw ? [kw] : [] });
            const src = nodeMap.get(cardIds[i]);
            const tgt = nodeMap.get(cardIds[j]);
            if (src) src.degree++;
            if (tgt) tgt.degree++;
          }
        }
      }
    });

    // Scale radius by degree
    nodeMap.forEach((node) => {
      node.radius = MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.min(node.degree / 6, 1);
    });

    return {
      nodes: [...nodeMap.values()],
      edges: [...edgeMap.values()],
      topKeywords: sortedKws,
    };
  }, [cards, relationsMap]);

  // Toggle keyword selection
  const toggleTag = (kw: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw);
      else next.add(kw);
      return next;
    });
  };

  // Compute visible node IDs based on keyword filter
  const visibleIds = useMemo(() => {
    if (selectedTags.size === 0) return new Set(nodes.map((n) => n.id));
    const matchingIds = new Set(nodes.filter((n) => n.keywords.some((kw) => selectedTags.has(kw))).map((n) => n.id));
    // Expand to neighbors
    const neighborIds = new Set(matchingIds);
    edges.forEach((e) => {
      const srcId = typeof e.source === "string" ? e.source : (e.source as GraphNode).id;
      const tgtId = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
      if (matchingIds.has(srcId)) neighborIds.add(tgtId);
      if (matchingIds.has(tgtId)) neighborIds.add(srcId);
    });
    return neighborIds;
  }, [nodes, edges, selectedTags]);

  // Shared keywords for tooltip
  const getSharedKeywords = useCallback(
    (nodeId: string) => {
      const kws = new Set<string>();
      edges.forEach((e) => {
        if (e.type !== "keyword" || !e.keywords) return;
        const srcId = typeof e.source === "string" ? e.source : (e.source as GraphNode).id;
        const tgtId = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
        if (srcId === nodeId || tgtId === nodeId) {
          e.keywords.forEach((kw) => kws.add(kw));
        }
      });
      return [...kws];
    },
    [edges]
  );

  // D3 force simulation
  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    svg.selectAll("*").remove();

    // Defs for glow filter
    const defs = svg.append("defs");
    const filter = defs.append("filter").attr("id", "glow");
    filter.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "blur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "blur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // Zoom group
    const g = svg.append("g");
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    // Simulation
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force("charge", d3.forceManyBody<GraphNode>().strength(-800))
      .force(
        "link",
        d3.forceLink<GraphNode, GraphEdge>(edges).id((d) => d.id).distance(120).strength((d) => 0.005 * (d.weight || 1))
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("x", d3.forceX<GraphNode>(width / 2).strength(0.01))
      .force("y", d3.forceY<GraphNode>(height / 2).strength(0.01))
      .velocityDecay(0.15)
      .stop();

    // Pre-tick
    for (let i = 0; i < 200; i++) simulation.tick();

    simulationRef.current = simulation;

    // Draw edges
    const edgeGroup = g.append("g").attr("class", "edges");
    const link = edgeGroup
      .selectAll("line")
      .data(edges)
      .join("line")
      .attr("stroke", (d) => (d.type === "related" ? "rgba(148, 180, 200, 0.5)" : "rgba(184, 169, 212, 0.3)"))
      .attr("stroke-width", (d) => (d.type === "related" ? 2 : 1 + d.weight * 0.5))
      .attr("stroke-dasharray", (d) => (d.type === "keyword" ? "5,4" : "none"))
      .attr("x1", (d) => (d.source as GraphNode).x!)
      .attr("y1", (d) => (d.source as GraphNode).y!)
      .attr("x2", (d) => (d.target as GraphNode).x!)
      .attr("y2", (d) => (d.target as GraphNode).y!)
      .style("display", (d) => {
        const srcId = (d.source as GraphNode).id;
        const tgtId = (d.target as GraphNode).id;
        return visibleIds.has(srcId) && visibleIds.has(tgtId) ? "block" : "none";
      });

    // Draw nodes
    const nodeGroup = g.append("g").attr("class", "nodes");
    const node = nodeGroup
      .selectAll("g")
      .data(nodes)
      .join("g")
      .style("display", (d) => (visibleIds.has(d.id) ? "block" : "none"))
      .style("cursor", "pointer");

    // Highlight glow
    node
      .filter((d) => d.id === highlightId)
      .append("circle")
      .attr("r", (d) => d.radius + 8)
      .attr("fill", "rgba(148, 180, 200, 0.25)")
      .attr("filter", "url(#glow)");

    // Node circle
    node
      .append("circle")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => d.color)
      .attr("fill-opacity", 0.85)
      .attr("stroke", (d) => (d.id === highlightId ? d.color : getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim()))
      .attr("stroke-width", (d) => (d.id === highlightId ? 3 : 1.5));

    // Favorite star
    node
      .filter((d) => d.isFavorite)
      .append("path")
      .attr("d", "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z")
      .attr("transform", (d) => `translate(${d.radius * 0.2}, ${-d.radius * 0.9}) scale(0.5)`)
      .attr("fill", "#f59e0b")
      .attr("stroke", "none");

    // Label
    node
      .append("text")
      .attr("dy", (d) => d.radius + 14)
      .attr("text-anchor", "middle")
      .attr("font-size", "11px")
      .attr("fill", getComputedStyle(document.documentElement).getPropertyValue("--color-text").trim())
      .text((d) => d.label);

    // Highlight keyword label above
    node
      .filter((d) => d.id === highlightId && d.keywords.length > 0)
      .append("text")
      .attr("dy", (d) => -d.radius - 6)
      .attr("text-anchor", "middle")
      .attr("font-size", "10px")
      .attr("fill", (d) => d.color)
      .text((d) => d.keywords[0]);

    // Drag
    const drag = d3
      .drag<SVGGElement, GraphNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.15).restart();
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
    (node as d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>).call(drag);

    // Click on node — show tooltip
    node.on("click", (event, d) => {
      event.stopPropagation();
      const svgEl = svgRef.current!;
      const container = svgEl.parentElement!;
      const containerRect = container.getBoundingClientRect();
      const transform = d3.zoomTransform(svgEl);
      const sx = transform.applyX(d.x!) - containerRect.left;
      const sy = transform.applyY(d.y!) - containerRect.top;
      setSelectedNode(d);
      setTooltipPos({ x: sx, y: sy });
    });

    // Click on background — close tooltip
    svg.on("click", () => {
      setSelectedNode(null);
      setTooltipPos(null);
    });

    // Tick update
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as GraphNode).x!)
        .attr("y1", (d) => (d.source as GraphNode).y!)
        .attr("x2", (d) => (d.target as GraphNode).x!)
        .attr("y2", (d) => (d.target as GraphNode).y!);
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    // Slow alpha decay loop
    simulation.alpha(0.3).restart();
    const decay = () => {
      if (simulation.alpha() > 0.001) {
        simulation.alpha(simulation.alpha() * 0.995);
        requestAnimationFrame(decay);
      }
    };
    requestAnimationFrame(decay);

    return () => {
      simulation.stop();
    };
  }, [nodes, edges, visibleIds, highlightId]);

  if (isLoading || relationsLoading) {
    return (
      <div className="flex h-[calc(100vh-56px)] flex-col items-center justify-center gap-3 text-text-secondary">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm">
          {isLoading
            ? `正在加载卡片${cardLoadProgress > 0 ? `（已加载 ${cardLoadProgress} 张）` : "..."}`
            : "正在加载关联数据..."}
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100vh-56px)] overflow-hidden bg-bg">
      {/* Keyword filter bar */}
      <div className="absolute left-0 right-0 top-0 z-10 flex gap-2 overflow-x-auto border-b border-border bg-surface/80 px-4 py-2 backdrop-blur-sm">
        <button
          onClick={() => setSelectedTags(new Set())}
          className={`flex-shrink-0 rounded-full px-3 py-1 text-xs transition ${
            selectedTags.size === 0
              ? "bg-primary text-white"
              : "bg-gray-100 text-text-secondary hover:bg-gray-200"
          }`}
        >
          全部
        </button>
        {topKeywords.map((kw) => (
          <button
            key={kw}
            onClick={() => toggleTag(kw)}
            className={`flex-shrink-0 rounded-full px-3 py-1 text-xs transition ${
              selectedTags.has(kw)
                ? "bg-primary text-white"
                : "bg-gray-100 text-text-secondary hover:bg-gray-200"
            }`}
          >
            {kw}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 rounded-xl border border-border bg-surface/90 p-3 text-xs shadow-sm backdrop-blur-sm">
        <div className="mb-1 flex items-center gap-2">
          <span className="inline-block h-0.5 w-4 bg-[rgba(148,180,200,0.5)]" />
          <span className="text-text-secondary">手动关联</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-4 border-t border-dashed border-[rgba(184,169,212,0.6)]" />
          <span className="text-text-secondary">关键词关联</span>
        </div>
      </div>

      {/* SVG canvas */}
      <svg ref={svgRef} className="h-full w-full" />

      {/* Tooltip */}
      {selectedNode && tooltipPos && (
        <div
          ref={tooltipRef}
          className="absolute z-20 w-64 rounded-xl border border-border bg-surface p-4 shadow-lg"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y - 12,
            transform: "translate(-50%, -100%)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex flex-wrap gap-1">
            {selectedNode.keywords.map((kw) => (
              <span
                key={kw}
                className="rounded-md px-1.5 py-0.5 text-xs text-white"
                style={{ background: selectedNode.color }}
              >
                {kw}
              </span>
            ))}
          </div>
          <div className="mb-2 max-h-40 overflow-y-auto text-sm">
            <MarkdownContent content={selectedNode.card.content} />
          </div>
          {getSharedKeywords(selectedNode.id).length > 0 && (
            <p className="mb-2 text-xs text-text-secondary">
              关联关键词: {getSharedKeywords(selectedNode.id).join(", ")}
            </p>
          )}
          <button
            onClick={() =>
              router.push(`/workspaces/${workspaceId}/card/${selectedNode.id}`)
            }
            className="w-full rounded-lg bg-primary px-3 py-1.5 text-xs text-white transition hover:bg-primary-dark"
          >
            查看详情
          </button>
        </div>
      )}
    </div>
  );
}

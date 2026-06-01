"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import useSWR from "swr";
import * as d3 from "d3";
import { cardApi, topicApi, topologyApi, type Card, type Topic } from "@/lib/api";
import { MarkdownContent } from "@/components/MarkdownContent";
import { TopologyTreeView } from "@/components/TopologyTreeView";
import { Settings } from "lucide-react";

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
  topicId?: string;
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
  const linkRef = useRef<d3.Selection<d3.BaseType, GraphEdge, SVGGElement, unknown> | null>(null);
  const nodeRef = useRef<d3.Selection<d3.BaseType, GraphNode, SVGGElement, unknown> | null>(null);
  const topicCircleRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const topicLabelRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);

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
  const [timeRange, setTimeRange] = useState<[number, number]>([0, 0]); // [start, end] timestamps, 0 = no filter
  const [sliderMode, setSliderMode] = useState<"all" | "time" | "event">("all");
  const [eventEnd, setEventEnd] = useState(0); // 1-based index, 0 = show all
  const [isPlaying, setIsPlaying] = useState(false);
  const [viewMode, setViewMode] = useState<"graph" | "tree">("graph");
  const [showForceSettings, setShowForceSettings] = useState(false);
  const [forceParams, setForceParams] = useState({
    charge: -800,
    linkDistance: 120,
    linkStrength: 0.005,
    centerStrength: 0.01,
    velocityDecay: 0.15,
  });
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup playback on unmount
  useEffect(() => {
    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, []);

  // Fetch topics
  const { data: topics } = useSWR(
    cards ? `topics-${workspaceId}` : null,
    () => topicApi.list(workspaceId)
  );

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

  // Build topic map: card_id -> topic
  const topicMap = useMemo(() => {
    if (!topics) return new Map<string, Topic>();
    const map = new Map<string, Topic>();
    topics.forEach((t) => t.card_ids.forEach((cid) => map.set(cid, t)));
    return map;
  }, [topics]);

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
        topicId: topicMap.get(card.id)?.id,
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
  }, [cards, relationsMap, topicMap]);

  // Toggle keyword selection
  const toggleTag = (kw: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw);
      else next.add(kw);
      return next;
    });
  };

  // Compute visible node IDs based on keyword filter + slider mode
  const { visibleIds } = useMemo(() => {
    // Keyword filter
    let keywordFiltered: Set<string>;
    if (selectedTags.size === 0) {
      keywordFiltered = new Set(nodes.map((n) => n.id));
    } else {
      const matchingIds = new Set(nodes.filter((n) => n.keywords.some((kw) => selectedTags.has(kw))).map((n) => n.id));
      keywordFiltered = new Set(matchingIds);
      edges.forEach((e) => {
        const srcId = typeof e.source === "string" ? e.source : (e.source as GraphNode).id;
        const tgtId = typeof e.target === "string" ? e.target : (e.target as GraphNode).id;
        if (matchingIds.has(srcId)) keywordFiltered.add(tgtId);
        if (matchingIds.has(tgtId)) keywordFiltered.add(srcId);
      });
    }

    // Slider filter
    if (sliderMode === "all") {
      return { visibleIds: keywordFiltered };
    }

    if (sliderMode === "time") {
      const timeActive = timeRange[0] > 0 || timeRange[1] > 0;
      if (!timeActive) return { visibleIds: keywordFiltered };
      const visible = new Set([...keywordFiltered].filter((id) => {
        const n = nodes.find((nn) => nn.id === id);
        if (!n) return false;
        const ts = new Date(n.card.created_at).getTime();
        if (timeRange[0] > 0 && ts < timeRange[0]) return false;
        if (timeRange[1] > 0 && ts > timeRange[1]) return false;
        return true;
      }));
      return { visibleIds: visible };
    }

    // Event mode
    if (eventEnd === 0) return { visibleIds: keywordFiltered };
    const sorted = [...nodes].sort((a, b) => new Date(a.card.created_at).getTime() - new Date(b.card.created_at).getTime());
    const eventVisible = new Set(sorted.slice(0, eventEnd).map((n) => n.id));
    return { visibleIds: new Set([...keywordFiltered].filter((id) => eventVisible.has(id))) };
  }, [nodes, edges, selectedTags, timeRange, sliderMode, eventEnd]);

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
      .force("charge", d3.forceManyBody<GraphNode>().strength(forceParams.charge))
      .force(
        "link",
        d3.forceLink<GraphNode, GraphEdge>(edges).id((d) => d.id).distance(forceParams.linkDistance).strength((d) => forceParams.linkStrength * (d.weight || 1))
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("x", d3.forceX<GraphNode>(width / 2).strength(forceParams.centerStrength))
      .force("y", d3.forceY<GraphNode>(height / 2).strength(forceParams.centerStrength))
      .velocityDecay(forceParams.velocityDecay)
      .stop();

    // Build topic data for circles
    const topicData = new Map<string, { id: string; name: string; nodeIds: string[]; color: string; active: boolean }>();
    if (topics) {
      topics.forEach((t) => {
        const nodeIds = t.card_ids.filter((cid) => nodes.some((n) => n.id === cid));
        if (nodeIds.length >= 2) {
          const colorCounts = new Map<string, number>();
          nodeIds.forEach((cid) => {
            const n = nodes.find((nn) => nn.id === cid);
            if (n) colorCounts.set(n.color, (colorCounts.get(n.color) || 0) + 1);
          });
          const dominantColor = [...colorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "#94B4C8";
          const recentThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
          const active = nodeIds.some((cid) => {
            const n = nodes.find((nn) => nn.id === cid);
            return n && new Date(n.card.created_at).getTime() > recentThreshold;
          });
          topicData.set(t.id, { id: t.id, name: t.name, nodeIds, color: dominantColor, active });
        }
      });
    }

    // Custom force: repel non-member nodes from topic circles
    const memberSetByTopic = new Map<string, Set<string>>();
    topicData.forEach((td) => memberSetByTopic.set(td.id, new Set(td.nodeIds)));
    const allMemberIds = new Set([...topicData.values()].flatMap((td) => td.nodeIds));

    // Helper: get centroid + radius for a topic
    const topicEntries = [...topicData.values()];
    function getTopicCircle(td: (typeof topicEntries)[number]) {
      const memberNodes = td.nodeIds
        .map((nid) => nodes.find((n) => n.id === nid))
        .filter((n): n is GraphNode => !!n && n.x !== undefined && n.y !== undefined);
      if (memberNodes.length < 2) return null;
      const cx = memberNodes.reduce((s, n) => s + n.x!, 0) / memberNodes.length;
      const cy = memberNodes.reduce((s, n) => s + n.y!, 0) / memberNodes.length;
      const maxDist = Math.max(...memberNodes.map((n) => Math.hypot(n.x! - cx, n.y! - cy)));
      return { cx, cy, radius: Math.max(maxDist + 30, 60), memberNodes };
    }

    function topicRepelForce(alpha: number) {
      const PAD = 35;
      // 1) Repel non-member nodes out of each topic circle
      for (const node of nodes) {
        if (!node.x || !node.y) continue;
        let fx = 0, fy = 0;
        topicEntries.forEach((td) => {
          if (memberSetByTopic.get(td.id)!.has(node.id)) return;
          const circle = getTopicCircle(td);
          if (!circle) return;
          const totalRadius = circle.radius + PAD;
          const dx = node.x! - circle.cx;
          const dy = node.y! - circle.cy;
          const dist = Math.hypot(dx, dy);
          if (dist < totalRadius && dist > 0.1) {
            const overlap = totalRadius - dist;
            const strength = 0.3 * alpha * (overlap / totalRadius);
            fx += (dx / dist) * overlap * strength;
            fy += (dy / dist) * overlap * strength;
          }
        });
        node.vx = (node.vx || 0) + fx;
        node.vy = (node.vy || 0) + fy;
      }

      // 2) Repel topic circles from each other
      for (let i = 0; i < topicEntries.length; i++) {
        for (let j = i + 1; j < topicEntries.length; j++) {
          const a = getTopicCircle(topicEntries[i]);
          const b = getTopicCircle(topicEntries[j]);
          if (!a || !b) continue;
          const dx = b.cx - a.cx;
          const dy = b.cy - a.cy;
          const dist = Math.hypot(dx, dy);
          const minDist = a.radius + b.radius + 40; // 40px gap between circles
          if (dist < minDist && dist > 0.1) {
            const overlap = minDist - dist;
            const strength = 0.15 * alpha * (overlap / minDist);
            const fx = (dx / dist) * overlap * strength;
            const fy = (dy / dist) * overlap * strength;
            // Push member nodes of each topic apart
            a.memberNodes.forEach((n) => {
              n.vx = (n.vx || 0) - fx;
              n.vy = (n.vy || 0) - fy;
            });
            b.memberNodes.forEach((n) => {
              n.vx = (n.vx || 0) + fx;
              n.vy = (n.vy || 0) + fy;
            });
          }
        }
      }
    }

    // Add repel force to simulation
    simulation.force("topicRepel", topicRepelForce);

    // Pre-tick
    for (let i = 0; i < 200; i++) simulation.tick();

    simulationRef.current = simulation;

    // Draw topic circles (behind edges)
    const topicCircleGroup = g.append("g").attr("class", "topics");
    const topicLabelGroup = g.append("g").attr("class", "topic-labels");
    topicCircleRef.current = topicCircleGroup;
    topicLabelRef.current = topicLabelGroup;

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
      .attr("y2", (d) => (d.target as GraphNode).y!);
    linkRef.current = link;

    // Draw nodes
    const nodeGroup = g.append("g").attr("class", "nodes");
    const node = nodeGroup
      .selectAll("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer");
    nodeRef.current = node;

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

      // Update topic circles
      topicCircleGroup
        .selectAll("circle")
        .data(topicEntries, (d: any) => d.id)
        .join("circle")
        .each(function (d) {
          const circle = getTopicCircle(d);
          if (!circle) return;
          d3.select(this)
            .attr("cx", circle.cx)
            .attr("cy", circle.cy)
            .attr("r", circle.radius)
            .attr("fill", d.color)
            .attr("fill-opacity", d.active ? 0.10 : 0.03)
            .attr("stroke", d.color)
            .attr("stroke-opacity", d.active ? 0.3 : 0.1)
            .attr("stroke-dasharray", "6,3")
            .attr("stroke-width", 1.5);
        });

      topicLabelGroup
        .selectAll("text")
        .data(topicEntries, (d: any) => d.id)
        .join("text")
        .each(function (d) {
          const circle = getTopicCircle(d);
          if (!circle) return;
          d3.select(this)
            .attr("x", circle.cx)
            .attr("y", circle.cy - circle.radius - 6)
            .attr("text-anchor", "middle")
            .attr("font-size", "11px")
            .attr("font-weight", "500")
            .attr("fill", d.color)
            .attr("opacity", d.active ? 0.8 : 0.4)
            .text(d.name);
        });
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
  }, [nodes, edges, highlightId, topics, viewMode, forceParams]);

  // Update visibility without re-creating SVG (preserves zoom)
  useEffect(() => {
    const link = linkRef.current;
    const node = nodeRef.current;
    if (!link || !node) return;

    link.style("display", (d) => {
      const srcId = (d.source as GraphNode).id;
      const tgtId = (d.target as GraphNode).id;
      return visibleIds.has(srcId) && visibleIds.has(tgtId) ? "block" : "none";
    });

    node.each(function (d) {
      const g = d3.select(this);
      const isVisible = visibleIds.has(d.id);
      g.style("display", isVisible ? "block" : "none");
    });

    // Update topic circle visibility
    const topicCircleGroup = topicCircleRef.current;
    const topicLabelGroup = topicLabelRef.current;
    if (topicCircleGroup) {
      topicCircleGroup.selectAll("circle")
        .style("display", (d: any) => (d.nodeIds.some((id: string) => visibleIds.has(id)) ? null : "none"));
    }
    if (topicLabelGroup) {
      topicLabelGroup.selectAll("text")
        .style("display", (d: any) => (d.nodeIds.some((id: string) => visibleIds.has(id)) ? null : "none"));
    }
  }, [visibleIds]);

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
      {/* View mode toggle + filter bar */}
      <div className="absolute left-0 right-0 top-0 z-10 flex gap-2 overflow-x-auto border-b border-border bg-surface/80 px-4 py-2 backdrop-blur-sm">
        {/* View mode toggle */}
        <div className="flex rounded-md border border-border overflow-hidden flex-shrink-0">
          <button
            onClick={() => setViewMode("graph")}
            className={`px-3 py-1 text-xs transition-colors ${
              viewMode === "graph" ? "bg-primary text-white" : "bg-surface text-text-secondary hover:bg-gray-100"
            }`}
          >
            关系图
          </button>
          <button
            onClick={() => setViewMode("tree")}
            className={`px-3 py-1 text-xs transition-colors ${
              viewMode === "tree" ? "bg-primary text-white" : "bg-surface text-text-secondary hover:bg-gray-100"
            }`}
          >
            拓扑树
          </button>
        </div>

        {viewMode === "graph" && (
          <>
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
            <button
              onClick={async () => {
                try {
                  await topicApi.rebuild(workspaceId);
                  window.location.reload();
                } catch (e: any) {
                  alert("重建失败: " + e.message);
                }
              }}
              className="flex-shrink-0 rounded-full bg-gray-100 px-3 py-1 text-xs text-text-secondary hover:bg-gray-200"
              title="重建话题聚类"
            >
              重建话题
            </button>
            <button
              onClick={() => setShowForceSettings(!showForceSettings)}
              className={`flex-shrink-0 rounded-full px-3 py-1 text-xs transition ${
                showForceSettings
                  ? "bg-primary text-white"
                  : "bg-gray-100 text-text-secondary hover:bg-gray-200"
              }`}
              title="力导向参数设置"
            >
              <Settings size={12} className="inline mr-1" />
              布局参数
            </button>
          </>
        )}
      </div>

      {/* Content based on view mode */}
      {viewMode === "tree" ? (
        <TopologyTreeView
          workspaceId={workspaceId}
          highlightId={highlightId}
          onNodeClick={async (nodeId) => {
            if (!nodeId) return;

            // Fetch node to get chat_id
            try {
              const node = await topologyApi.get(nodeId);

              if (node.chat_id) {
                // Open conversation
                router.push(`/workspaces/${workspaceId}/chat/${node.chat_id}`);
              } else {
                // No conversation, just highlight node
                router.push(`/workspaces/${workspaceId}/network?highlight=${nodeId}`);
              }
            } catch (error) {
              console.error('Failed to fetch node:', error);
            }
          }}
        />
      ) : (
      <>
      {/* Force settings panel */}
      {showForceSettings && (
        <div className="absolute right-4 top-16 z-20 w-72 rounded-xl border border-border bg-surface/95 p-4 shadow-lg backdrop-blur-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">力导向参数</h3>
            <button
              onClick={() => setShowForceSettings(false)}
              className="text-text-secondary hover:text-text"
            >
              ×
            </button>
          </div>

          <div className="space-y-3">
            {/* Charge strength */}
            <div>
              <label className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                <span>节点斥力</span>
                <span className="font-mono">{forceParams.charge}</span>
              </label>
              <input
                type="range"
                min="-2000"
                max="-100"
                step="50"
                value={forceParams.charge}
                onChange={(e) => setForceParams({ ...forceParams, charge: Number(e.target.value) })}
                className="w-full"
              />
              <div className="mt-0.5 flex justify-between text-[10px] text-text-secondary">
                <span>强</span>
                <span>弱</span>
              </div>
            </div>

            {/* Link distance */}
            <div>
              <label className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                <span>连接距离</span>
                <span className="font-mono">{forceParams.linkDistance}</span>
              </label>
              <input
                type="range"
                min="50"
                max="300"
                step="10"
                value={forceParams.linkDistance}
                onChange={(e) => setForceParams({ ...forceParams, linkDistance: Number(e.target.value) })}
                className="w-full"
              />
              <div className="mt-0.5 flex justify-between text-[10px] text-text-secondary">
                <span>近</span>
                <span>远</span>
              </div>
            </div>

            {/* Link strength */}
            <div>
              <label className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                <span>连接强度</span>
                <span className="font-mono">{forceParams.linkStrength.toFixed(3)}</span>
              </label>
              <input
                type="range"
                min="0.001"
                max="0.02"
                step="0.001"
                value={forceParams.linkStrength}
                onChange={(e) => setForceParams({ ...forceParams, linkStrength: Number(e.target.value) })}
                className="w-full"
              />
              <div className="mt-0.5 flex justify-between text-[10px] text-text-secondary">
                <span>弱</span>
                <span>强</span>
              </div>
            </div>

            {/* Center strength */}
            <div>
              <label className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                <span>中心引力</span>
                <span className="font-mono">{forceParams.centerStrength.toFixed(3)}</span>
              </label>
              <input
                type="range"
                min="0"
                max="0.1"
                step="0.005"
                value={forceParams.centerStrength}
                onChange={(e) => setForceParams({ ...forceParams, centerStrength: Number(e.target.value) })}
                className="w-full"
              />
              <div className="mt-0.5 flex justify-between text-[10px] text-text-secondary">
                <span>弱</span>
                <span>强</span>
              </div>
            </div>

            {/* Velocity decay */}
            <div>
              <label className="mb-1 flex items-center justify-between text-xs text-text-secondary">
                <span>速度衰减</span>
                <span className="font-mono">{forceParams.velocityDecay.toFixed(2)}</span>
              </label>
              <input
                type="range"
                min="0.05"
                max="0.5"
                step="0.05"
                value={forceParams.velocityDecay}
                onChange={(e) => setForceParams({ ...forceParams, velocityDecay: Number(e.target.value) })}
                className="w-full"
              />
              <div className="mt-0.5 flex justify-between text-[10px] text-text-secondary">
                <span>慢</span>
                <span>快</span>
              </div>
            </div>

            {/* Reset button */}
            <button
              onClick={() => setForceParams({
                charge: -800,
                linkDistance: 120,
                linkStrength: 0.005,
                centerStrength: 0.01,
                velocityDecay: 0.15,
              })}
              className="w-full rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-text-secondary hover:bg-gray-200"
            >
              重置为默认值
            </button>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-14 left-4 z-10 rounded-xl border border-border bg-surface/90 p-3 text-xs shadow-sm backdrop-blur-sm">
        <div className="mb-1 flex items-center gap-2">
          <span className="inline-block h-0.5 w-4 bg-[rgba(148,180,200,0.5)]" />
          <span className="text-text-secondary">手动关联</span>
        </div>
        <div className="mb-1 flex items-center gap-2">
          <span className="inline-block h-0.5 w-4 border-t border-dashed border-[rgba(184,169,212,0.6)]" />
          <span className="text-text-secondary">关键词关联</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full border border-dashed border-[rgba(148,180,200,0.5)] bg-[rgba(148,180,200,0.1)]" />
          <span className="text-text-secondary">话题聚类</span>
        </div>
      </div>

      {/* Timeline slider */}
      {cards && cards.length > 1 && (() => {
        const sorted = [...nodes].sort((a, b) => new Date(a.card.created_at).getTime() - new Date(b.card.created_at).getTime());
        const totalEvents = sorted.length;

        // Time mode helpers
        const timestamps = cards.map((c) => new Date(c.created_at).getTime());
        const minTs = Math.min(...timestamps);
        const maxTs = Math.max(...timestamps);
        const step = 86400000;
        const alignedMin = Math.floor(minTs / step) * step;
        const alignedMax = Math.ceil(maxTs / step) * step;
        const fmtDate = (ts: number) => {
          const d = new Date(ts);
          return `${d.getMonth() + 1}/${d.getDate()}`;
        };

        const stopPlayback = () => {
          if (playTimerRef.current) clearInterval(playTimerRef.current);
          playTimerRef.current = null;
          setIsPlaying(false);
        };

        const startPlayback = () => {
          setIsPlaying(true);
          if (sliderMode === "time") {
            const start = timeRange[0] || alignedMin;
            setTimeRange([start, start]);
            playTimerRef.current = setInterval(() => {
              setTimeRange((prev) => {
                const s = prev[0] || alignedMin;
                const next = prev[1] + step;
                if (next >= alignedMax) {
                  stopPlayback();
                  return [s, 0];
                }
                return [s, next];
              });
            }, 200);
          } else {
            // Event mode
            setSliderMode("event");
            setEventEnd(1);
            playTimerRef.current = setInterval(() => {
              setEventEnd((prev) => {
                const next = prev + 1;
                if (next > totalEvents) {
                  stopPlayback();
                  return 0;
                }
                return next;
              });
            }, 250);
          }
        };

        return (
          <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2.5 rounded-xl border border-border bg-surface/90 px-3.5 py-2 text-xs shadow-sm backdrop-blur-sm">
            {/* Mode toggle */}
            <div className="flex rounded-md border border-border overflow-hidden">
              {(["all", "time", "event"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    stopPlayback();
                    setSliderMode(m);
                    if (m === "all") {
                      setTimeRange([0, 0]);
                      setEventEnd(0);
                    }
                  }}
                  className={`px-2 py-0.5 text-[10px] transition-colors ${
                    sliderMode === m ? "bg-primary text-white" : "bg-surface text-text-secondary hover:bg-gray-100"
                  }`}
                >
                  {m === "all" ? "全部" : m === "time" ? "时间" : "事件"}
                </button>
              ))}
            </div>

            {/* Slider track */}
            {sliderMode === "time" && (() => {
              const startVal = timeRange[0] || alignedMin;
              const endVal = timeRange[1] || alignedMax;
              const range = alignedMax - alignedMin;
              return (
                <>
                  <span className="text-text-secondary whitespace-nowrap">{fmtDate(startVal)}</span>
                  <div className="relative h-1 w-44">
                    <div className="absolute inset-0 rounded bg-gray-200" />
                    <div className="absolute inset-y-0 rounded bg-primary" style={{ left: `${((startVal - alignedMin) / range) * 100}%`, width: `${((endVal - startVal) / range) * 100}%` }} />
                    <input type="range" min={alignedMin} max={alignedMax} step={step} value={startVal}
                      onChange={(e) => { stopPlayback(); const v = Number(e.target.value); setTimeRange([v, Math.max(v, endVal)]); }}
                      style={{ zIndex: 3 }} className="slider-thumb absolute left-0 top-1/2 w-full -translate-y-1/2" />
                    <input type="range" min={alignedMin} max={alignedMax} step={step} value={endVal}
                      onChange={(e) => { stopPlayback(); const v = Number(e.target.value); setTimeRange([Math.min(v, startVal), v]); }}
                      style={{ zIndex: 4 }} className="slider-thumb absolute left-0 top-1/2 w-full -translate-y-1/2" />
                  </div>
                  <span className="text-text-secondary whitespace-nowrap">{fmtDate(endVal)}</span>
                </>
              );
            })()}

            {sliderMode === "event" && (() => {
              const endVal = eventEnd || totalEvents;
              return (
                <>
                  <span className="text-text-secondary whitespace-nowrap w-12 text-right">第 {endVal}</span>
                  <div className="relative h-1 w-44">
                    <div className="absolute inset-0 rounded bg-gray-200" />
                    <div className="absolute inset-y-0 rounded bg-primary" style={{ width: `${(endVal / totalEvents) * 100}%` }} />
                    <input type="range" min={1} max={totalEvents} step={1} value={endVal}
                      onChange={(e) => { stopPlayback(); setEventEnd(Number(e.target.value)); }}
                      className="slider-thumb absolute left-0 top-1/2 w-full -translate-y-1/2" />
                  </div>
                  <span className="text-text-secondary whitespace-nowrap">/ {totalEvents} 张</span>
                </>
              );
            })()}

            {/* Play/Stop */}
            <button onClick={isPlaying ? stopPlayback : startPlayback}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-primary hover:bg-primary/30"
              title={isPlaying ? "停止" : "播放"}>
              {isPlaying ? (
                <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="3" height="8" rx="0.5" fill="currentColor"/><rect x="6" y="1" width="3" height="8" rx="0.5" fill="currentColor"/></svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1l7 4-7 4V1z" fill="currentColor"/></svg>
              )}
            </button>

            {/* Reset */}
            {(sliderMode !== "all") && !isPlaying && (
              <button onClick={() => { setSliderMode("all"); setTimeRange([0, 0]); setEventEnd(0); }}
                className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-text-secondary hover:bg-gray-200">
                重置
              </button>
            )}
          </div>
        );
      })()}

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
      </>
      )}
    </div>
  );
}

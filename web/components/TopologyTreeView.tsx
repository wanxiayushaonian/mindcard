"use client";

import { useEffect, useRef, useState, useMemo, useCallback, forwardRef, useImperativeHandle } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import {
  select,
  zoom as d3Zoom,
  drag as d3Drag,
} from "d3";
import { topologyApi, type TreeNode } from "@/lib/api";

interface Props {
  workspaceId: string;
  highlightId?: string | null;
  onNodeClick?: (nodeId: string) => void;
}

const NODE_COLORS: Record<string, string> = {
  root: "#4F46E5",
  branch: "#0EA5E9",
  leaf: "#10B981",
};

const REF_COLORS: Record<string, string> = {
  related: "#94B4C8",
  contradicts: "#EF4444",
  extends: "#8B5CF6",
};

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  nodeType: string;
  status: string;
  cardCount: number;
  depth: number;
  radius: number;
  color: string;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  type: "tree" | "ref";
  refType?: string;
  color?: string;
}

export const TopologyTreeView = forwardRef<any, Props>(
  function TopologyTreeView({ workspaceId, highlightId, onNodeClick }, ref) {
    const svgRef = useRef<SVGSVGElement>(null);
    const simRef = useRef<ReturnType<typeof forceSimulation> | null>(null);
    const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);

    useImperativeHandle(ref, () => ({
      getGraph: () => simRef.current,
    }));

    // Fetch tree nodes
    useEffect(() => {
      if (!workspaceId) return;
      setIsLoading(true);
      topologyApi
        .list(workspaceId)
        .then((nodes) => {
          setTreeNodes(nodes);
          setIsLoading(false);
        })
        .catch(() => setIsLoading(false));
    }, [workspaceId]);

    // Build graph data (supports multiple roots = forest)
    const { nodes, links } = useMemo(() => {
      if (treeNodes.length === 0) return { nodes: [] as SimNode[], links: [] as SimLink[] };

      const nodeMap = new Map<string, TreeNode>();
      treeNodes.forEach((n) => nodeMap.set(n.id, n));

      // BFS for depth (handle forest: multiple roots)
      const depthMap = new Map<string, number>();
      const roots = treeNodes.filter((n) => n.node_type === "root");
      const queue: [string, number][] = roots.map((r) => [r.id, 0]);
      roots.forEach((r) => depthMap.set(r.id, 0));

      while (queue.length > 0) {
        const [nid, depth] = queue.shift()!;
        const node = nodeMap.get(nid)!;
        (node.child_ids || []).forEach((cid) => {
          if (!depthMap.has(cid)) {
            depthMap.set(cid, depth + 1);
            queue.push([cid, depth + 1]);
          }
        });
      }

      // Nodes (only those reachable from a root)
      const gNodes: SimNode[] = treeNodes
        .filter((n) => depthMap.has(n.id))
        .map((n) => ({
          id: n.id,
          label: n.title || (n.node_type === "root" ? "主线" : "未命名"),
          nodeType: n.node_type,
          status: n.status,
          cardCount: n.card_count ?? 0,
          depth: depthMap.get(n.id) ?? 0,
          radius: n.node_type === "root" ? 14 : n.node_type === "branch" ? 10 : 7,
          color: NODE_COLORS[n.node_type] || NODE_COLORS.leaf,
        }));

      // Edges
      const gLinks: SimLink[] = [];
      treeNodes.forEach((n) => {
        (n.child_ids || []).forEach((cid) => {
          if (depthMap.has(cid)) {
            gLinks.push({ source: n.id, target: cid, type: "tree" });
          }
        });
        (n.ref_ids || []).forEach((tid) => {
          if (depthMap.has(tid)) {
            gLinks.push({
              source: n.id,
              target: tid,
              type: "ref",
              refType: "related",
              color: REF_COLORS.related,
            });
          }
        });
      });

      return { nodes: gNodes, links: gLinks };
    }, [treeNodes]);

    // Render D3 force graph
    useEffect(() => {
      if (!svgRef.current || nodes.length === 0) return;

      const svg = select(svgRef.current);
      svg.selectAll("*").remove();

      const width = svgRef.current.clientWidth;
      const height = svgRef.current.clientHeight || 600;

      const computedStyle = getComputedStyle(document.documentElement);
      const textSecondaryColor = computedStyle.getPropertyValue("--color-text-secondary").trim() || "#8E99A4";
      const borderColor = computedStyle.getPropertyValue("--color-border").trim() || "#E5E7EB";

      const simulation = forceSimulation<SimNode>(nodes)
        .force(
          "link",
          forceLink<SimNode, SimLink>(links)
            .id((d) => d.id)
            .distance(80)
            .strength(0.6),
        )
        .force("charge", forceManyBody().strength(-300))
        .force("center", forceCenter(width / 2, height / 2))
        .force("collision", forceCollide<SimNode>().radius((d) => d.radius + 6))
        // Gentle radial pull: root nodes gravitate toward center
        .force("x", forceX(width / 2).strength(0.03))
        .force("y", forceY(height / 2).strength(0.03));

      simRef.current = simulation;

      const g = svg.append("g");

      // Zoom
      const zoomBehavior = d3Zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 5])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        });
      svg.call(zoomBehavior);

      // Tree links
      const linkSel = g
        .append("g")
        .selectAll("line")
        .data(links.filter((l) => l.type === "tree"))
        .join("line")
        .attr("stroke", "rgba(148, 180, 200, 0.35)")
        .attr("stroke-width", 1.2);

      // Ref links (dashed)
      const refSel = g
        .append("g")
        .selectAll("line")
        .data(links.filter((l) => l.type === "ref"))
        .join("line")
        .attr("stroke", (d) => d.color || REF_COLORS.related)
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4 3")
        .attr("stroke-opacity", 0.5);

      // Drag
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

      // Node circles
      const nodeSel = g
        .append("g")
        .selectAll<SVGCircleElement, SimNode>("circle")
        .data(nodes)
        .join("circle")
        .attr("r", (d) => d.radius)
        .attr("fill", (d) => d.color)
        .attr("stroke", borderColor)
        .attr("stroke-width", 1.5)
        .attr("opacity", 0.9)
        .style("cursor", "pointer")
        .on("click", (_event, d) => {
          if (onNodeClick) onNodeClick(d.id);
        })
        .on("mouseenter", (_event, d) => setHoveredNode(d))
        .on("mouseleave", () => setHoveredNode(null))
        .call(dragBehavior);

      // Highlight
      if (highlightId) {
        nodeSel.attr("fill", (d) => (d.id === highlightId ? "#F59E0B" : d.color));
      }

      // Labels
      const labelSel = g
        .append("g")
        .selectAll<SVGTextElement, SimNode>("text")
        .data(nodes)
        .join("text")
        .text((d) => (d.label.length > 12 ? d.label.slice(0, 12) + "…" : d.label))
        .attr("font-size", 10)
        .attr("fill", textSecondaryColor)
        .attr("text-anchor", "middle")
        .attr("dy", (d) => -d.radius - 4)
        .style("pointer-events", "none");

      // Tick
      simulation.on("tick", () => {
        linkSel
          .attr("x1", (d) => (d.source as SimNode).x!)
          .attr("y1", (d) => (d.source as SimNode).y!)
          .attr("x2", (d) => (d.target as SimNode).x!)
          .attr("y2", (d) => (d.target as SimNode).y!);
        refSel
          .attr("x1", (d) => (d.source as SimNode).x!)
          .attr("y1", (d) => (d.source as SimNode).y!)
          .attr("x2", (d) => (d.target as SimNode).x!)
          .attr("y2", (d) => (d.target as SimNode).y!);
        nodeSel.attr("cx", (d) => d.x!).attr("cy", (d) => d.y!);
        labelSel.attr("x", (d) => d.x!).attr("y", (d) => d.y!);
      });

      return () => {
        simulation.stop();
        simRef.current = null;
      };
    }, [nodes, links, highlightId, onNodeClick]);

    if (isLoading) {
      return (
        <div className="flex h-full items-center justify-center text-text-secondary">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      );
    }

    if (nodes.length === 0) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-text-secondary">
          <p className="text-sm">暂无拓扑树数据</p>
          <p className="text-xs">创建卡片后将自动归类到知识拓扑树</p>
        </div>
      );
    }

    return (
      <div className="relative h-full w-full">
        <svg ref={svgRef} className="h-full w-full bg-bg" />

        {/* Tooltip */}
        {hoveredNode && (
          <div
            className="pointer-events-none absolute z-20 rounded-lg border border-border bg-surface/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm"
            style={{
              left: (hoveredNode.x ?? 0) + 20,
              top: (hoveredNode.y ?? 0) - 10,
            }}
          >
            <div className="font-medium text-text">{hoveredNode.label}</div>
            <div className="text-text-secondary">
              {{ root: "根节点", branch: "分支", leaf: "叶子" }[hoveredNode.nodeType]} ·{" "}
              {{ active: "活跃", completed: "已完成", archived: "已归档" }[hoveredNode.status]} ·{" "}
              {hoveredNode.cardCount} 张卡片
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-4 left-4 z-10 rounded-xl border border-border bg-surface/90 p-3 text-xs shadow-sm backdrop-blur-sm">
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: NODE_COLORS.root }} />
            <span className="text-text-secondary">根节点</span>
          </div>
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: NODE_COLORS.branch }} />
            <span className="text-text-secondary">分支</span>
          </div>
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: NODE_COLORS.leaf }} />
            <span className="text-text-secondary">叶子</span>
          </div>
          <hr className="my-1.5 border-border" />
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-block h-0.5 w-4" style={{ background: "rgba(148, 180, 200, 0.35)" }} />
            <span className="text-text-secondary">父子关系</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-4 border-t border-dashed" style={{ borderColor: REF_COLORS.related }} />
            <span className="text-text-secondary">跨分支引用</span>
          </div>
        </div>

        {/* Controls hint */}
        <div className="absolute right-4 top-4 z-10 rounded-lg bg-surface/70 px-2.5 py-1.5 text-[10px] text-text-secondary backdrop-blur-sm">
          拖拽平移 · 滚轮缩放 · 拖动节点
        </div>
      </div>
    );
  }
);

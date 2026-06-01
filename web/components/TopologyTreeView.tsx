"use client";

import { useEffect, useRef, useState, useMemo, useCallback, forwardRef, useImperativeHandle } from "react";
import { topologyApi, type TreeNode } from "@/lib/api";

// 3d-force-graph has no TS types, import dynamically
let ForceGraph3D: any = null;

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

interface GraphNode {
  id: string;
  label: string;
  nodeType: string;
  status: string;
  cardCount: number;
  depth: number;
  val: number; // node size
  color: string;
  // Position set by 3d-force-graph at runtime
  x?: number;
  y?: number;
  z?: number;
}

interface GraphLink {
  source: string;
  target: string;
  type: "tree" | "ref";
  refType?: string;
  color?: string;
}

export const TopologyTreeView = forwardRef<any, Props>(
  function TopologyTreeView({ workspaceId, highlightId, onNodeClick }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const graphRef = useRef<any>(null);
    const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Expose graph instance
    useImperativeHandle(ref, () => ({
      getGraph: () => graphRef.current,
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

    // Build graph data
    const { nodes, links } = useMemo(() => {
      if (treeNodes.length === 0) return { nodes: [], links: [] };

      const nodeMap = new Map<string, TreeNode>();
      treeNodes.forEach((n) => nodeMap.set(n.id, n));

      const root = treeNodes.find((n) => n.node_type === "root");
      if (!root) return { nodes: [], links: [] };

      // BFS for depth
      const depthMap = new Map<string, number>();
      const queue: [string, number][] = [[root.id, 0]];
      depthMap.set(root.id, 0);
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

      // Nodes
      const gNodes: GraphNode[] = treeNodes.map((n) => ({
        id: n.id,
        label: n.title || (n.node_type === "root" ? "主线" : "未命名"),
        nodeType: n.node_type,
        status: n.status,
        cardCount: n.card_count ?? 0,
        depth: depthMap.get(n.id) ?? 0,
        val: n.node_type === "root" ? 8 : n.node_type === "branch" ? 5 : 3,
        color: NODE_COLORS[n.node_type] || NODE_COLORS.leaf,
      }));

      // Tree edges (parent → child)
      const gLinks: GraphLink[] = [];
      treeNodes.forEach((n) => {
        (n.child_ids || []).forEach((cid) => {
          gLinks.push({ source: n.id, target: cid, type: "tree" });
        });
        // Cross-branch refs
        (n.ref_ids || []).forEach((tid) => {
          gLinks.push({
            source: n.id,
            target: tid,
            type: "ref",
            refType: "related",
            color: REF_COLORS.related,
          });
        });
      });

      return { nodes: gNodes, links: gLinks };
    }, [treeNodes]);

    // Initialize 3D graph
    useEffect(() => {
      if (!containerRef.current || nodes.length === 0) return;
      if (typeof window === "undefined") return;

      // Dynamic import for SSR safety
      Promise.all([import("3d-force-graph"), import("three")]).then(([mod, THREE]) => {
        ForceGraph3D = mod.default;

        // Cleanup previous
        if (graphRef.current) {
          graphRef.current = null;
        }
        containerRef.current!.innerHTML = "";

        const Graph = ForceGraph3D({ controlType: "orbit" })(containerRef.current!)
          .graphData({ nodes, links })
          // Layout: radial tree
          .dagMode("radial")
          .dagLevelDistance(80)
          // Node appearance
          .nodeVal("val")
          .nodeColor("color")
          .nodeOpacity(0.9)
          .nodeResolution(16)
          // Node label (hover tooltip)
          .nodeLabel((n: GraphNode) => {
            const typeLabel = { root: "根节点", branch: "分支", leaf: "叶子" }[n.nodeType] || "";
            const statusLabel = { active: "活跃", completed: "已完成", archived: "已归档" }[n.status] || "";
            return `<div style="background:rgba(0,0,0,0.85);color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;line-height:1.4">
              <b>${n.label}</b><br/>
              ${typeLabel} · ${statusLabel} · ${n.cardCount} 张卡片
            </div>`;
          })
          // Link appearance
          .linkColor((l: GraphLink) =>
            l.type === "ref" ? (l.color || "#94B4C8") : "rgba(148, 180, 200, 0.3)"
          )
          .linkWidth((l: GraphLink) => (l.type === "ref" ? 1.5 : 1))
          .linkDirectionalParticles((l: GraphLink) => (l.type === "ref" ? 2 : 0))
          .linkDirectionalParticleWidth(2)
          .linkDirectionalParticleColor((l: GraphLink) => l.color || "#94B4C8")
          // Camera
          .cameraPosition({ x: 0, y: 0, z: 300 })
          // Controls
          .enableNavigationControls(true)
          .showNavInfo(false)
          // Background
          .backgroundColor("rgba(0,0,0,0)");

        // Click handler
        Graph.onNodeClick((node: GraphNode) => {
          if (onNodeClick) onNodeClick(node.id);
          // Focus camera on node
          const distance = 120;
          const distRatio = 1 + distance / Math.hypot(node.x || 0, node.y || 0, node.z || 0);
          Graph.cameraPosition(
            { x: (node.x || 0) * distRatio, y: (node.y || 0) * distRatio, z: (node.z || 0) * distRatio },
            node as any,
            1500
          );
        });

        Graph.onBackgroundClick(() => {
          if (onNodeClick) onNodeClick("");
        });

        // Highlight node
        if (highlightId) {
          Graph.nodeColor((n: GraphNode) =>
            n.id === highlightId ? "#F59E0B" : n.color
          );
        }

        // Add 3D coordinate axes
        const scene = Graph.scene();
        const axesLen = 120;
        const axes = new THREE.AxesHelper(axesLen);
        axes.position.set(-200, -150, 0);
        scene.add(axes);

        // Text labels for each axis
        function makeTextSprite(text: string, color: string, pos: { x: number; y: number; z: number }) {
          const canvas = document.createElement("canvas");
          canvas.width = 64;
          canvas.height = 32;
          const ctx = canvas.getContext("2d")!;
          ctx.font = "bold 24px monospace";
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(text, 32, 16);
          const texture = new THREE.CanvasTexture(canvas);
          const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
          const sprite = new THREE.Sprite(material);
          sprite.position.copy(pos);
          sprite.scale.set(16, 8, 1);
          scene.add(sprite);
        }

        const origin = new THREE.Vector3(-200, -150, 0);
        makeTextSprite("X", "#EF4444", origin.clone().add(new THREE.Vector3(axesLen + 12, 0, 0)));
        makeTextSprite("Y", "#22C55E", origin.clone().add(new THREE.Vector3(0, axesLen + 12, 0)));
        makeTextSprite("Z", "#3B82F6", origin.clone().add(new THREE.Vector3(0, 0, axesLen + 12)));

        graphRef.current = Graph;
      });

      return () => {
        graphRef.current = null;
      };
    }, [nodes, links, highlightId, onNodeClick]);

    // Growth animation: progressively reveal nodes by depth
    const [animStep, setAnimStep] = useState(0);
    const [isAnimating, setIsAnimating] = useState(false);
    const animTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const maxDepth = useMemo(() => {
      if (nodes.length === 0) return 0;
      return Math.max(...nodes.map((n) => n.depth), 0);
    }, [nodes]);

    const startAnimation = useCallback(() => {
      if (animTimerRef.current) clearInterval(animTimerRef.current);
      setIsAnimating(true);
      setAnimStep(0);

      let step = 0;
      animTimerRef.current = setInterval(() => {
        step++;
        setAnimStep(step);

        // Update graph visibility
        if (graphRef.current) {
          const visibleIds = new Set(
            nodes.filter((n) => n.depth <= step).map((n) => n.id)
          );
          graphRef.current
            .nodeVisibility((n: GraphNode) => visibleIds.has(n.id))
            .linkVisibility((l: any) => {
              const srcId = typeof l.source === "object" ? l.source.id : l.source;
              const tgtId = typeof l.target === "object" ? l.target.id : l.target;
              return visibleIds.has(srcId) && visibleIds.has(tgtId);
            });
        }

        if (step >= maxDepth) {
          if (animTimerRef.current) clearInterval(animTimerRef.current);
          // Reset visibility to all
          if (graphRef.current) {
            graphRef.current.nodeVisibility(true).linkVisibility(true);
          }
          setTimeout(() => {
            setIsAnimating(false);
            setAnimStep(0);
          }, 500);
        }
      }, 1000);
    }, [nodes, maxDepth]);

    useEffect(() => {
      return () => {
        if (animTimerRef.current) clearInterval(animTimerRef.current);
      };
    }, []);

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
        {/* 3D canvas container */}
        <div ref={containerRef} className="h-full w-full" />

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
            <span className="inline-block h-0.5 w-4" style={{ background: "rgba(148, 180, 200, 0.3)" }} />
            <span className="text-text-secondary">父子关系</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-4 border-t border-dashed" style={{ borderColor: REF_COLORS.related }} />
            <span className="text-text-secondary">跨分支引用</span>
          </div>
          <hr className="my-1.5 border-border" />
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-block h-0.5 w-4" style={{ background: "#EF4444" }} />
            <span className="text-text-secondary">X 轴</span>
          </div>
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-block h-0.5 w-4" style={{ background: "#22C55E" }} />
            <span className="text-text-secondary">Y 轴</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-4" style={{ background: "#3B82F6" }} />
            <span className="text-text-secondary">Z 轴</span>
          </div>
        </div>

        {/* Growth animation */}
        <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">
          {isAnimating && (
            <span className="rounded-lg bg-surface/90 px-3 py-1.5 text-xs text-text-secondary backdrop-blur-sm">
              深度 {animStep} / {maxDepth}
            </span>
          )}
          <button
            onClick={startAnimation}
            disabled={isAnimating}
            className="rounded-lg bg-primary/90 px-3 py-1.5 text-xs text-white shadow-sm transition hover:bg-primary disabled:opacity-50"
          >
            {isAnimating ? "生长中..." : "知识生长动画"}
          </button>
        </div>

        {/* Controls hint */}
        <div className="absolute right-4 top-4 z-10 rounded-lg bg-surface/70 px-2.5 py-1.5 text-[10px] text-text-secondary backdrop-blur-sm">
          鼠标拖拽旋转 · 滚轮缩放 · 点击节点聚焦
        </div>
      </div>
    );
  }
);

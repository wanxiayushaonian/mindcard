"use client";

import { useMemo } from "react";
import type { TreeNode } from "@/lib/api";
import { ChevronRight, MapPin } from "lucide-react";

interface TreeBreadcrumbProps {
  nodes: TreeNode[];
  currentNodeId: string | null;
  onNavigate: (nodeId: string | null) => void;
  cardCountMap?: Map<string, number>;
}

export function TreeBreadcrumb({ nodes, currentNodeId, onNavigate, cardCountMap }: TreeBreadcrumbProps) {
  const path = useMemo(() => {
    if (!currentNodeId) return [];
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const trail: TreeNode[] = [];
    let current = nodeMap.get(currentNodeId);
    while (current) {
      trail.unshift(current);
      current = current.parent_id ? nodeMap.get(current.parent_id) : undefined;
    }
    return trail;
  }, [nodes, currentNodeId]);

  return (
    <div className="flex items-center gap-1 text-xs text-text-secondary overflow-x-auto">
      <button
        onClick={() => onNavigate(null)}
        className={`flex items-center gap-1 shrink-0 rounded px-1.5 py-0.5 transition hover:bg-gray-100 ${
          !currentNodeId ? "font-medium text-text" : ""
        }`}
      >
        <MapPin size={12} />
        全部
      </button>
      {path.map((node) => (
        <div key={node.id} className="flex items-center gap-1 shrink-0">
          <ChevronRight size={10} className="text-gray-400" />
          <button
            onClick={() => onNavigate(node.id)}
            className={`rounded px-1.5 py-0.5 transition hover:bg-gray-100 ${
              node.id === currentNodeId ? "font-medium text-text" : ""
            }`}
          >
            {node.title || "未命名"}
            {cardCountMap && cardCountMap.has(node.id) && (
              <span className="ml-0.5 text-[10px] text-gray-400">({cardCountMap.get(node.id)})</span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}

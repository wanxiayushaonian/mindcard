"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, ChevronDown, GitBranch, MapPin } from "lucide-react";
import type { TopologyNode } from "@/lib/api";
import { useTranslations } from "next-intl";

const DEPTH_COLORS = [
  "#6b7280",
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#f97316",
];

interface TreeBreadcrumbProps {
  nodes: TopologyNode[];
  currentNodeId: string | null;
  onNavigate: (nodeId: string | null) => void;
  cardCountMap?: Map<string, number>;
}

export function TreeBreadcrumb({ nodes, currentNodeId, onNavigate, cardCountMap }: TreeBreadcrumbProps) {
  const t = useTranslations("common");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const menuRef = useRef<HTMLDivElement | null>(null);

  const nodeMap = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes]
  );

  const rootNodes = useMemo(
    () => nodes.filter((n) => !n.parent_id).sort((a, b) => a.sort_order - b.sort_order),
    [nodes]
  );

  const path = useMemo(() => {
    if (!currentNodeId) return [];
    const trail: TopologyNode[] = [];
    let cur = nodeMap.get(currentNodeId);
    while (cur) {
      trail.unshift(cur);
      cur = cur.parent_id ? nodeMap.get(cur.parent_id) : undefined;
    }
    return trail;
  }, [currentNodeId, nodeMap]);

  const getChildren = useCallback(
    (nodeId: string): TopologyNode[] => {
      const node = nodeMap.get(nodeId);
      if (!node?.child_ids) return [];
      return node.child_ids
        .map((cid) => nodeMap.get(cid))
        .filter((n): n is TopologyNode => !!n)
        .sort((a, b) => a.sort_order - b.sort_order);
    },
    [nodeMap]
  );

  const openMenuFor = useCallback((key: string) => {
    const btn = triggerRefs.current.get(key);
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const menuW = 220;
    let top = rect.bottom + 6;
    let left = rect.left;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    if (left < 8) left = 8;
    setMenuPos({ top, left });
    setOpenMenu(key);
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const btn = triggerRefs.current.get(openMenu);
      if (btn && btn.contains(target)) return;
      if (menuRef.current && menuRef.current.contains(target)) return;
      setOpenMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu]);

  useEffect(() => {
    if (!openMenu) return;
    const handler = () => setOpenMenu(null);
    window.addEventListener("scroll", handler, true);
    return () => window.removeEventListener("scroll", handler, true);
  }, [openMenu]);

  // Children of the last node, or root nodes when no node is selected
  const lastNode = path.length > 0 ? path[path.length - 1] : null;
  const lastChildren = lastNode ? getChildren(lastNode.id) : rootNodes;

  // Build dropdown items
  let dropdownItems: { id: string | null; label: string; childCount: number; isActive: boolean }[] = [];
  let dropdownDepth = 0;

  if (openMenu === "__children__") {
    dropdownDepth = lastNode ? path.length : 0;
    dropdownItems = lastChildren.map((c) => ({
      id: c.id,
      label: c.title || t("unnamed"),
      childCount: (c.child_ids || []).length,
      isActive: c.id === currentNodeId,
    }));
  } else if (openMenu && path.length > 0) {
    const d = path.findIndex((p) => p.id === openMenu);
    if (d >= 0) {
      dropdownDepth = d + 1;
      const menuNode = path[d];
      const parentNode = d > 0 ? nodeMap.get(path[d - 1].id) : null;
      const siblings = d === 0
        ? rootNodes
        : parentNode ? getChildren(parentNode.id) : [];
      dropdownItems = siblings
        .filter((s) => s.id !== menuNode.id)
        .map((s) => ({
          id: s.id,
          label: s.title || t("unnamed"),
          childCount: (s.child_ids || []).length,
          isActive: s.id === currentNodeId,
        }));
    }
  }

  const dropdownColor = DEPTH_COLORS[dropdownDepth % DEPTH_COLORS.length];
  const isAllActive = !currentNodeId;

  return (
    <div className="flex items-center overflow-x-auto border-b border-border/60 bg-surface/95 px-3 py-2 backdrop-blur-sm [scrollbar-width:none]">

      {/* "全部" pill */}
      <span
        className={`inline-flex shrink-0 items-center overflow-hidden rounded-full transition-all ${
          isAllActive ? "shadow-sm" : "border border-border/50 hover:border-border/80"
        }`}
        style={isAllActive ? { backgroundColor: DEPTH_COLORS[0] } : {}}
      >
        <button
          type="button"
          className={`inline-flex items-center gap-1 px-2.5 py-[3px] text-[11px] font-medium transition-colors ${
            isAllActive ? "cursor-default text-white" : "text-text-secondary hover:text-text"
          }`}
          onClick={() => { if (!isAllActive) onNavigate(null); }}
        >
          <MapPin size={9} className={isAllActive ? "opacity-80" : "opacity-60"} style={isAllActive ? {} : { color: DEPTH_COLORS[0] }} />
          <span>{t("all")}</span>
        </button>
      </span>

      {/* Path nodes */}
      {path.map((node, depth) => {
        const isLast = depth === path.length - 1;
        const colorIdx = (depth + 1) % DEPTH_COLORS.length;
        const color = DEPTH_COLORS[colorIdx];

        const parentNode = depth > 0 ? nodeMap.get(path[depth - 1].id) : null;
        const siblings = depth === 0
          ? rootNodes
          : parentNode ? getChildren(parentNode.id) : [];
        const hasSiblings = siblings.filter((s) => s.id !== node.id).length > 0;

        return (
          <div key={node.id} className="flex shrink-0 items-center">
            <ChevronRight size={11} className="mx-1 shrink-0 text-border/50" />
            <span
              className={`inline-flex items-center overflow-hidden rounded-full transition-all ${
                isLast ? "shadow-sm" : "border border-border/50 hover:border-border/80"
              }`}
              style={isLast ? { backgroundColor: color } : {}}
            >
              <button
                type="button"
                className={`inline-flex items-center gap-1.5 px-2.5 py-[3px] text-[11px] font-medium transition-colors ${
                  isLast ? "cursor-default text-white" : "text-text-secondary hover:text-text"
                }`}
                onClick={() => { if (!isLast) onNavigate(node.id); }}
              >
                {!isLast && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full opacity-80"
                    style={{ backgroundColor: color }}
                  />
                )}
                <span className="max-w-[100px] truncate">{node.title || t("unnamed")}</span>
              </button>

              {hasSiblings && (
                <button
                  type="button"
                  ref={(el) => { if (el) triggerRefs.current.set(node.id, el); }}
                  className={`flex items-center border-l px-1.5 py-[5px] transition-colors ${
                    isLast
                      ? "border-white/20 text-white/60 hover:bg-white/15 hover:text-white"
                      : "border-border/40 text-text-secondary/40 hover:bg-muted/50 hover:text-text-secondary"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (openMenu === node.id) setOpenMenu(null);
                    else openMenuFor(node.id);
                  }}
                >
                  <ChevronDown size={10} />
                </button>
              )}
            </span>
          </div>
        );
      })}

      {/* Children / root-nodes indicator */}
      {lastChildren.length > 0 && (
        <div className="flex shrink-0 items-center">
          <ChevronRight size={11} className="mx-1 shrink-0 text-border/50" />
          <button
            type="button"
            ref={(el) => { if (el) triggerRefs.current.set("__children__", el); }}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border/50 px-2 py-[3px] text-[11px] text-text-secondary/70 transition-colors hover:border-border hover:text-text-secondary"
            onClick={(e) => {
              e.stopPropagation();
              if (openMenu === "__children__") setOpenMenu(null);
              else openMenuFor("__children__");
            }}
          >
            <GitBranch size={10} />
            <span>{lastChildren.length}</span>
          </button>
        </div>
      )}

      {/* Dropdown portal */}
      {openMenu && dropdownItems.length > 0 && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[10000] min-w-[180px] max-w-[260px] overflow-hidden rounded-xl border border-border/70 bg-surface py-1 shadow-xl dark:shadow-black/30"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {dropdownItems.map((item) => (
            <button
              key={item.id ?? "__null__"}
              type="button"
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/60 ${
                item.isActive ? "bg-muted/40 font-medium text-text" : "text-text-secondary"
              }`}
              onClick={() => { onNavigate(item.id); setOpenMenu(null); }}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dropdownColor }} />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.childCount > 0 && (
                <span className="ml-auto shrink-0 rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] text-text-secondary">
                  {item.childCount}
                </span>
              )}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

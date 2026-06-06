"use client";

import { useMemo, useState, useRef, useEffect, useCallback, forwardRef } from "react";
import { createPortal } from "react-dom";
import type { ChatPathNode, TopologyNode } from "@/lib/api";

const DEPTH_COLORS = [
  "#9ca3af",
  "#60a5fa",
  "#4ade80",
  "#c084fc",
  "#fb923c",
];

interface ForkBreadcrumbProps {
  path: ChatPathNode[];
  activeChatId: string | null;
  onNavigate: (chatId: string) => void;
  topologyNodes?: TopologyNode[];
}

export function ForkBreadcrumb({ path, activeChatId, onNavigate, topologyNodes }: ForkBreadcrumbProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const menuRef = useRef<HTMLDivElement | null>(null);

  const nodeMap = useMemo(() => {
    if (!topologyNodes) return new Map<string, TopologyNode>();
    return new Map(topologyNodes.map((n) => [n.id, n]));
  }, [topologyNodes]);

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
    let top = rect.bottom + 4;
    let left = rect.left;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    if (left < 8) left = 8;
    setMenuPos({ top, left });
    setOpenMenu(key);
  }, []);

  // Close on outside click
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

  // Close on scroll
  useEffect(() => {
    if (!openMenu) return;
    const handler = () => setOpenMenu(null);
    window.addEventListener("scroll", handler, true);
    return () => window.removeEventListener("scroll", handler, true);
  }, [openMenu]);

  if (path.length === 0) return null;

  const lastNode = path[path.length - 1];
  const lastChildren = getChildren(lastNode.node_id);

  // Collect dropdown items for the currently open menu
  let dropdownItems: { id: string; label: string; childCount: number; isActive: boolean }[] = [];
  if (openMenu === "__children__") {
    dropdownItems = lastChildren.map((c) => ({
      id: c.id,
      label: c.title,
      childCount: (c.child_ids || []).length,
      isActive: c.id === activeChatId,
    }));
  } else if (openMenu) {
    // Find the node for this menu
    const menuNode = path.find((p) => p.node_id === openMenu);
    if (menuNode) {
      const depth = path.findIndex((p) => p.node_id === openMenu);
      const parentNode = depth > 0 ? nodeMap.get(path[depth - 1].node_id) : null;
      const siblings = depth === 0
        ? (topologyNodes || []).filter((n) => !n.parent_id).sort((a, b) => a.sort_order - b.sort_order)
        : parentNode ? getChildren(parentNode.id!) : [];
      dropdownItems = siblings
        .filter((s) => s.id !== menuNode.node_id)
        .map((s) => ({
          id: s.id,
          label: s.title,
          childCount: (s.child_ids || []).length,
          isActive: s.id === activeChatId,
        }));
    }
  }

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto border-b border-gray-100 bg-surface/95 px-3 py-2 text-sm backdrop-blur-sm dark:border-gray-800">
      {path.map((node, depth) => {
        const isActive = node.chat_id === activeChatId;
        const isLast = depth === path.length - 1;
        const color = DEPTH_COLORS[depth % DEPTH_COLORS.length];

        // Siblings at this level
        const parentNode = depth > 0 ? nodeMap.get(path[depth - 1].node_id) : null;
        const siblings = depth === 0
          ? (topologyNodes || []).filter((n) => !n.parent_id).sort((a, b) => a.sort_order - b.sort_order)
          : parentNode ? getChildren(parentNode.id!) : [];
        const otherSiblings = siblings.filter((s) => s.id !== node.node_id);
        const hasSiblings = otherSiblings.length > 0;

        return (
          <div key={node.node_id} className="flex shrink-0 items-center">
            {depth > 0 && <span className="mx-1 text-gray-300">/</span>}

            <button
              type="button"
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
                isLast
                  ? "bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900"
                  : "cursor-pointer border border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              }`}
              onClick={() => {
                if (!isLast && node.chat_id) onNavigate(node.chat_id);
              }}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: isLast ? "#fff" : color, opacity: isLast ? 0.8 : 1 }}
              />
              {node.title}
            </button>

            {hasSiblings && (
              <button
                type="button"
                ref={(el) => { if (el) triggerRefs.current.set(node.node_id, el); }}
                className="ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-xs font-bold text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
                onClick={(e) => {
                  e.stopPropagation();
                  if (openMenu === node.node_id) setOpenMenu(null);
                  else openMenuFor(node.node_id);
                }}
              >
                ›
              </button>
            )}
          </div>
        );
      })}

      {/* Trailing children dropdown */}
      {lastChildren.length > 0 && (
        <div className="flex shrink-0 items-center">
          <span className="mx-1 text-gray-300">/</span>
          <button
            type="button"
            ref={(el) => { if (el) triggerRefs.current.set("__children__", el); }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-xs font-bold text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
            onClick={(e) => {
              e.stopPropagation();
              if (openMenu === "__children__") setOpenMenu(null);
              else openMenuFor("__children__");
            }}
          >
            ›
          </button>
        </div>
      )}

      {/* Dropdown rendered via portal */}
      {openMenu && dropdownItems.length > 0 && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[10000] min-w-[180px] max-w-[280px] overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {dropdownItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition hover:bg-blue-50 dark:hover:bg-blue-900/20 ${
                item.isActive
                  ? "border-l-2 border-blue-500 bg-blue-50 font-medium dark:bg-blue-900/20"
                  : "text-gray-700 dark:text-gray-300"
              }`}
              onClick={() => {
                onNavigate(item.id);
                setOpenMenu(null);
              }}
            >
              <span>{item.label}</span>
              {item.childCount > 0 && (
                <span className="ml-2 shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400 dark:bg-gray-800 dark:text-gray-500">
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

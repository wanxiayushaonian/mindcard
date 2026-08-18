"use client";

import { useState, useEffect, useMemo } from "react";
import { GitMerge, X, Check, GitBranch, AlertTriangle, ArrowRight } from "lucide-react";
import { topologyApi, type TopologyNode } from "@/lib/api";
import { useTranslations } from "next-intl";
import { toast } from "@/lib/toast";

interface MergeBranchDialogProps {
  sourceChatId: string;
  sourceTitle: string;
  workspaceId: string;
  onClose: () => void;
  onMerged?: (newChatId: string) => void;
}

/**
 * Compute the depth of a chat by walking the parent_id chain.
 * TopologyNode has no depth field, so we count ancestors.
 */
function computeDepth(nodes: TopologyNode[], chatId: string | null): number {
  if (!chatId) return 0;
  const nodeById = new Map<string, TopologyNode>();
  const nodeByChat = new Map<string, TopologyNode>();
  for (const n of nodes) {
    nodeById.set(n.id, n);
    if (n.chat_id) nodeByChat.set(n.chat_id, n);
  }
  let depth = 0;
  let current = nodeByChat.get(chatId);
  const seen = new Set<string>();
  while (current?.parent_id && !seen.has(current.id)) {
    seen.add(current.id);
    depth++;
    current = nodeById.get(current.parent_id);
  }
  return depth;
}

/**
 * Check if `ancestorId` is an ancestor of `descendantId` by walking parent_id up.
 */
function isAncestor(
  nodes: TopologyNode[],
  descendantChatId: string,
  ancestorChatId: string,
): boolean {
  if (descendantChatId === ancestorChatId) return false;
  const nodeById = new Map<string, TopologyNode>();
  const nodeByChat = new Map<string, TopologyNode>();
  for (const n of nodes) {
    nodeById.set(n.id, n);
    if (n.chat_id) nodeByChat.set(n.chat_id, n);
  }
  let current = nodeByChat.get(descendantChatId);
  const seen = new Set<string>();
  while (current?.parent_id && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.parent_id === ancestorChatId) return true;
    // Also check chat_id match (parent_id might be the node id)
    const parentNode = nodeById.get(current.parent_id);
    if (parentNode?.chat_id === ancestorChatId) return true;
    current = parentNode;
  }
  return false;
}

export function MergeBranchDialog({
  sourceChatId,
  sourceTitle,
  workspaceId,
  onClose,
  onMerged,
}: MergeBranchDialogProps) {
  const t = useTranslations("mergeBranch");
  const [nodes, setNodes] = useState<TopologyNode[]>([]);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [mountOn, setMountOn] = useState<"source" | "target">("source");
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    topologyApi.list(workspaceId).then(setNodes).catch(() => {});
  }, [workspaceId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !merging) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, merging]);

  const candidates = nodes.filter(
    (n) => n.chat_id && n.chat_id !== sourceChatId
  );

  const targetNode = candidates.find((n) => n.chat_id === targetId);
  const targetTitle = targetNode?.title || "";

  // Ancestor/descendant detection (any direction)
  const ancestorWarning = useMemo(() => {
    if (!targetId) return null;
    const sourceIsAncestor = isAncestor(nodes, targetId, sourceChatId);
    const targetIsAncestor = isAncestor(nodes, sourceChatId, targetId);
    if (sourceIsAncestor) return t("sourceIsAncestor");
    if (targetIsAncestor) return t("targetIsAncestor");
    return null;
  }, [nodes, targetId, sourceChatId, t]);

  // Primary = where the merged chat will be mounted; secondary = the other
  const primaryChatId = mountOn === "source" ? sourceChatId : targetId;
  const primaryTitle = mountOn === "source" ? sourceTitle : targetTitle;
  const newDepth = useMemo(
    () => computeDepth(nodes, primaryChatId) + 1,
    [nodes, primaryChatId],
  );

  const handleSubmit = async () => {
    if (!targetId) return;
    setMerging(true);
    try {
      // Swap source/target based on mount selection — the backend treats
      // source_chat_id as the parent (mount point).
      const actualSource = mountOn === "source" ? sourceChatId : targetId;
      const actualTarget = mountOn === "source" ? targetId : sourceChatId;
      const result = await topologyApi.mergeBranches(actualSource, actualTarget);
      toast(
        t("mergeSuccess", { title: `${sourceTitle} + ${targetTitle}` }),
        "success",
      );
      onMerged?.(result.chat_id);
      onClose();
    } catch (e: any) {
      toast(t("mergeFailed") + ": " + (e?.message ?? ""), "error");
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border border-border bg-surface shadow-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <GitMerge className="h-4 w-4 text-primary" />
          <span className="flex-1 text-sm font-medium">{t("title")}</span>
          <button
            type="button"
            onClick={onClose}
            disabled={merging}
            className="rounded p-1 text-text-secondary hover:bg-gray-100 disabled:opacity-50"
            title={t("close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Source info */}
        <div className="shrink-0 border-b border-border px-4 py-2 text-xs">
          <span className="text-text-secondary">{t("source")}: </span>
          <span className="font-medium text-text">{sourceTitle}</span>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {/* Warning banner */}
          <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t("warning")}</span>
          </div>

          {/* Ancestor relationship warning */}
          {ancestorWarning && (
            <div className="flex items-start gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{ancestorWarning}</span>
            </div>
          )}

          {/* Target selection */}
          <div className="space-y-1">
            <label className="text-xs text-text-secondary">{t("targetBranch")}</label>
            {candidates.length === 0 ? (
              <p className="rounded bg-gray-50 px-3 py-2 text-xs text-text-secondary">
                {t("noCandidates")}
              </p>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-border p-1.5">
                {candidates.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => setTargetId(n.chat_id!)}
                    disabled={merging}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition disabled:opacity-50 ${
                      targetId === n.chat_id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    <GitBranch className="h-3 w-3 shrink-0" />
                    <span className="flex-1 truncate">{n.title}</span>
                    {targetId === n.chat_id && <Check className="h-3 w-3" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Mount point selection (only when target selected) */}
          {targetId && (
            <div className="space-y-1.5">
              <label className="text-xs text-text-secondary">{t("mountPoint")}</label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setMountOn("source")}
                  disabled={merging}
                  className={`flex-1 rounded border px-2 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                    mountOn === "source"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-text-secondary hover:bg-gray-50"
                  }`}
                >
                  {t("mountOn", { title: sourceTitle.slice(0, 12) })}
                </button>
                <button
                  type="button"
                  onClick={() => setMountOn("target")}
                  disabled={merging}
                  className={`flex-1 rounded border px-2 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                    mountOn === "target"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-text-secondary hover:bg-gray-50"
                  }`}
                >
                  {t("mountOn", { title: targetTitle.slice(0, 12) })}
                </button>
              </div>

              {/* Depth preview */}
              <div className="flex items-center gap-1.5 rounded bg-blue-50 px-2 py-1.5 text-[11px] text-blue-800">
                <ArrowRight className="h-3 w-3 shrink-0" />
                <span>
                  {t("depthPreview", {
                    parent: primaryTitle.slice(0, 16),
                    depth: newDepth,
                  })}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={merging}
            className="rounded px-3 py-1.5 text-xs text-text-secondary hover:bg-gray-100 disabled:opacity-50"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!targetId || merging}
            className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            {merging ? <span className="animate-spin">⟳</span> : <GitMerge className="h-3 w-3" />}
            {merging ? t("merging") : t("merge")}
          </button>
        </div>
      </div>
    </div>
  );
}

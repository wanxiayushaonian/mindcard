"use client";

import { useState, useEffect } from "react";
import { GitMerge, X, Check, GitBranch, AlertTriangle } from "lucide-react";
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
  const targetTitle =
    candidates.find((n) => n.chat_id === targetId)?.title || "";

  const handleSubmit = async () => {
    if (!targetId) return;
    setMerging(true);
    try {
      const result = await topologyApi.mergeBranches(sourceChatId, targetId);
      toast(t("mergeSuccess", { title: `${sourceTitle} + ${targetTitle}` }), "success");
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
            className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            {merging ? <span className="animate-spin">⟳</span> : <GitMerge className="h-3 w-3" />}
            {merging ? t("merging") : t("merge")}
          </button>
        </div>
      </div>
    </div>
  );
}

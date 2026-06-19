"use client";

import { useState, useEffect } from "react";
import { Link2, X, Check, GitBranch } from "lucide-react";
import { topologyApi, type TopologyNode } from "@/lib/api";
import { useTranslations } from "next-intl";
import { toast } from "@/lib/toast";

const REF_TYPES = [
  { value: "related", color: "bg-blue-100 text-blue-700 border-blue-300" },
  { value: "contradicts", color: "bg-red-100 text-red-700 border-red-300" },
  { value: "extends", color: "bg-purple-100 text-purple-700 border-purple-300" },
] as const;

interface LinkBranchDialogProps {
  sourceChatId: string;
  sourceTitle: string;
  workspaceId: string;
  existingTargets: Set<string>;
  onClose: () => void;
  onLinked?: () => void;
}

export function LinkBranchDialog({
  sourceChatId,
  sourceTitle,
  workspaceId,
  existingTargets,
  onClose,
  onLinked,
}: LinkBranchDialogProps) {
  const t = useTranslations("linkBranch");
  const [nodes, setNodes] = useState<TopologyNode[]>([]);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [refType, setRefType] = useState<string>("related");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    topologyApi.list(workspaceId).then(setNodes).catch(() => {});
  }, [workspaceId]);

  const candidates = nodes.filter(
    (n) => n.chat_id && n.chat_id !== sourceChatId && !existingTargets.has(n.chat_id)
  );

  const handleSubmit = async () => {
    if (!targetId) return;
    setSubmitting(true);
    try {
      await topologyApi.createRef(sourceChatId, targetId, refType, reason);
      toast(t("linkSuccess"), "success");
      onLinked?.();
      onClose();
    } catch (e: any) {
      toast(t("linkFailed") + ": " + (e?.message ?? ""), "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Link2 className="h-4 w-4 text-primary" />
          <span className="flex-1 text-sm font-medium">{t("title")}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-secondary hover:bg-gray-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Source info */}
        <div className="border-b border-border px-4 py-2 text-xs">
          <span className="text-text-secondary">{t("source")}: </span>
          <span className="font-medium text-text">{sourceTitle}</span>
        </div>

        {/* Body */}
        <div className="space-y-3 px-4 py-3">
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
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition ${
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

          {/* ref_type selection */}
          <div className="space-y-1">
            <label className="text-xs text-text-secondary">{t("refType")}</label>
            <div className="flex gap-1.5">
              {REF_TYPES.map((rt) => (
                <button
                  key={rt.value}
                  type="button"
                  onClick={() => setRefType(rt.value)}
                  className={`flex-1 rounded border px-2 py-1.5 text-xs font-medium transition ${
                    refType === rt.value
                      ? rt.color
                      : "border-border text-text-secondary hover:bg-gray-50"
                  }`}
                >
                  {t(`type_${rt.value}`)}
                </button>
              ))}
            </div>
          </div>

          {/* reason */}
          <div className="space-y-1">
            <label className="text-xs text-text-secondary">{t("reason")}</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              rows={2}
              className="w-full resize-none rounded border border-border bg-surface px-2 py-1.5 text-xs"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-text-secondary hover:bg-gray-100"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!targetId || submitting}
            className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            {submitting ? <span className="animate-spin">⟳</span> : <Link2 className="h-3 w-3" />}
            {t("create")}
          </button>
        </div>
      </div>
    </div>
  );
}

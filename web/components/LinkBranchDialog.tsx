"use client";

import { useState, useEffect, useMemo } from "react";
import { Link2, X, Check, GitBranch, Trash2 } from "lucide-react";
import { topologyApi, type TopologyNode, type RefDetail, type IncomingRefDetail } from "@/lib/api";
import { useTranslations } from "next-intl";
import { toast } from "@/lib/toast";

const REF_TYPES = [
  { value: "related", color: "bg-blue-100 text-blue-700 border-blue-300" },
  { value: "contradicts", color: "bg-red-100 text-red-700 border-red-300" },
  { value: "extends", color: "bg-purple-100 text-purple-700 border-purple-300" },
] as const;

const REF_TYPE_BADGE: Record<string, string> = {
  related: "bg-blue-100 text-blue-700",
  contradicts: "bg-red-100 text-red-700",
  extends: "bg-purple-100 text-purple-700",
};

const HIGHLIGHT_DURATION_MS = 2000;

interface LinkBranchDialogProps {
  sourceChatId: string;
  sourceTitle: string;
  workspaceId: string;
  onClose: () => void;
}

export function LinkBranchDialog({
  sourceChatId,
  sourceTitle,
  workspaceId,
  onClose,
}: LinkBranchDialogProps) {
  const t = useTranslations("linkBranch");
  const [nodes, setNodes] = useState<TopologyNode[]>([]);
  const [linkedRefs, setLinkedRefs] = useState<RefDetail[]>([]);
  const [incomingRefs, setIncomingRefs] = useState<IncomingRefDetail[]>([]);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [refType, setRefType] = useState<string>("related");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null);
  const [recentlyLinked, setRecentlyLinked] = useState<Set<string>>(new Set());

  useEffect(() => {
    topologyApi
      .list(workspaceId)
      .then((list) => {
        setNodes(list);
        const source = list.find((n) => n.chat_id === sourceChatId);
        if (source?.ref_details) {
          setLinkedRefs(source.ref_details);
        } else if (source) {
          // Fallback for older backends without ref_details
          setLinkedRefs(
            source.ref_ids.map((id) => ({
              target_chat_id: id,
              ref_type: "related" as const,
              reason: "",
            }))
          );
        }
        if (source?.incoming_ref_details) {
          setIncomingRefs(source.incoming_ref_details);
        }
      })
      .catch(() => {});
  }, [workspaceId, sourceChatId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const titleByChatId = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) {
      if (n.chat_id) m.set(n.chat_id, n.title);
    }
    return m;
  }, [nodes]);

  const linkedChatIds = useMemo(() => new Set(linkedRefs.map((r) => r.target_chat_id)), [linkedRefs]);

  const candidates = nodes.filter(
    (n) =>
      n.chat_id &&
      n.chat_id !== sourceChatId &&
      !linkedChatIds.has(n.chat_id)
  );

  const handleSubmit = async () => {
    if (!targetId) return;
    setSubmitting(true);
    try {
      await topologyApi.createRef(sourceChatId, targetId, refType, reason);
      toast(t("linkSuccess"), "success");
      const newRef: RefDetail = {
        target_chat_id: targetId,
        ref_type: refType as RefDetail["ref_type"],
        reason,
      };
      setLinkedRefs((prev) => [...prev, newRef]);
      setRecentlyLinked((prev) => new Set(prev).add(targetId));
      setTimeout(() => {
        setRecentlyLinked((prev) => {
          const next = new Set(prev);
          next.delete(targetId);
          return next;
        });
      }, HIGHLIGHT_DURATION_MS);
      setTargetId(null);
      setReason("");
    } catch (e: any) {
      toast(t("linkFailed") + ": " + (e?.message ?? ""), "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (targetChatId: string) => {
    setRemoving(targetChatId);
    setConfirmingRemoval(null);
    try {
      await topologyApi.removeRef(sourceChatId, targetChatId);
      setLinkedRefs((prev) => prev.filter((r) => r.target_chat_id !== targetChatId));
      toast(t("unlinkSuccess"), "success");
    } catch (e: any) {
      toast(t("unlinkFailed") + ": " + (e?.message ?? ""), "error");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border border-border bg-surface shadow-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <Link2 className="h-4 w-4 text-primary" />
          <span className="flex-1 text-sm font-medium">{t("title")}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-secondary hover:bg-gray-100"
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
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {/* Existing refs */}
          {linkedRefs.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs text-text-secondary">
                {t("existing")} ({linkedRefs.length})
              </label>
              <div className="space-y-1">
                {linkedRefs.map((ref) => {
                  const cid = ref.target_chat_id;
                  const isConfirming = confirmingRemoval === cid;
                  const isRemoving = removing === cid;
                  const isRecent = recentlyLinked.has(cid);
                  return (
                    <div
                      key={cid}
                      className={`rounded border px-2 py-1.5 text-xs transition-colors ${
                        isRecent
                          ? "border-emerald-300 bg-emerald-50"
                          : "border-border/60 bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <GitBranch className="h-3 w-3 shrink-0 text-text-secondary" />
                        <span className="flex-1 truncate text-text">
                          {titleByChatId.get(cid) || cid.slice(0, 8)}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ${
                            REF_TYPE_BADGE[ref.ref_type] || "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {t(`type_${ref.ref_type}`)}
                        </span>
                        {isConfirming ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleRemove(cid)}
                              disabled={isRemoving}
                              className="shrink-0 rounded bg-red-500 px-1.5 py-0.5 text-[10px] text-white hover:bg-red-600 disabled:opacity-50"
                            >
                              {t("confirmRemove")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingRemoval(null)}
                              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-gray-100"
                            >
                              {t("cancel")}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingRemoval(cid)}
                            disabled={isRemoving}
                            className="shrink-0 rounded p-1 text-text-secondary transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                            title={t("unlink")}
                          >
                            {isRemoving ? (
                              <span className="animate-spin text-[10px]">⟳</span>
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </button>
                        )}
                      </div>
                      {ref.reason && (
                        <p className="mt-0.5 pl-5 text-[10px] text-text-secondary/80">
                          {ref.reason}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Incoming refs (others → this branch) */}
          {incomingRefs.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs text-text-secondary">
                {t("incoming")} ({incomingRefs.length})
              </label>
              <div className="space-y-1">
                {incomingRefs.map((ref) => (
                  <div
                    key={ref.source_chat_id}
                    className="rounded border border-dashed border-border/60 bg-amber-50/40 px-2 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-3 w-3 shrink-0 text-amber-700/70" />
                      <span className="flex-1 truncate text-text">
                        {titleByChatId.get(ref.source_chat_id) || ref.source_chat_id.slice(0, 8)}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ${
                          REF_TYPE_BADGE[ref.ref_type] || "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {t(`type_${ref.ref_type}`)}
                      </span>
                    </div>
                    {ref.reason && (
                      <p className="mt-0.5 pl-5 text-[10px] text-text-secondary/80">
                        {ref.reason}
                      </p>
                    )}
                  </div>
                ))}
              </div>
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
              <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-border p-1.5">
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
        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
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

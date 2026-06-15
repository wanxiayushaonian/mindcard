"use client";

import { Brain, ChevronDown, ChevronRight, ExternalLink, Pencil, Plus, Trash2, X, Check } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { memoryApi, type Memory } from "@/lib/api";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";

function relativeTime(dateStr: string | undefined, locale: string): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return locale === "zh" ? "刚刚" : "just now";
  if (mins < 60) return locale === "zh" ? `${mins}分钟前` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return locale === "zh" ? `${hours}小时前` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return locale === "zh" ? `${days}天前` : `${days}d ago`;
}

interface MemoryItemProps {
  memory: Memory;
  onDelete: (slug: string) => void;
  onEdit: (memory: Memory) => void;
}

function MemoryItem({ memory, onDelete, onEdit }: MemoryItemProps) {
  const [expanded, setExpanded] = useState(false);
  const locale = useLocale();

  return (
    <div className="rounded-lg border border-border bg-surface p-3 transition-colors hover:border-primary/30">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-0.5 shrink-0 text-text-secondary hover:text-text"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium text-text">{memory.title}</span>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
              {memory.slug}
            </span>
            {memory.updated_at && (
              <span className="text-[10px] text-text-secondary">
                {relativeTime(memory.updated_at, locale)}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onEdit(memory)}
            className="rounded p-1 text-text-secondary transition hover:bg-gray-100 hover:text-text"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(memory.slug)}
            className="rounded p-1 text-text-secondary transition hover:bg-red-50 hover:text-danger"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 pl-5">
          <pre className="whitespace-pre-wrap rounded bg-gray-50 p-2 text-[11px] leading-relaxed text-text">
            {memory.body}
          </pre>
          {memory.source_chat_id && (
            <a
              href={`#chat-${memory.source_chat_id}`}
              className="mt-1.5 flex items-center gap-1 text-[10px] text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Source chat
            </a>
          )}
        </div>
      )}
    </div>
  );
}

interface EditFormProps {
  initial?: Memory;
  workspaceId: string;
  onDone: () => void;
  mutate: () => void;
}

function EditForm({ initial, workspaceId, onDone, mutate }: EditFormProps) {
  const t = useTranslations("memory");
  const tc = useTranslations("common");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!slug.trim() || !title.trim() || !body.trim()) return;
    setSaving(true);
    try {
      await memoryApi.upsert(workspaceId, { slug: slug.trim(), title: title.trim(), body: body.trim() });
      mutate();
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <input
        placeholder={t("slugPlaceholder")}
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        disabled={!!initial}
        className="w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-text placeholder:text-text-secondary disabled:opacity-50"
      />
      <input
        placeholder={t("titlePlaceholder")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full rounded border border-border bg-bg px-2 py-1.5 text-xs text-text placeholder:text-text-secondary"
      />
      <textarea
        placeholder={t("bodyPlaceholder")}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        className="w-full resize-none rounded border border-border bg-bg px-2 py-1.5 text-xs text-text placeholder:text-text-secondary"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded px-2.5 py-1 text-xs text-text-secondary hover:bg-gray-100"
        >
          {tc("cancel")}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !slug.trim() || !title.trim() || !body.trim()}
          className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs text-white disabled:opacity-50"
        >
          {saving ? <span className="animate-spin">⟳</span> : <Check className="h-3 w-3" />}
          {tc("save")}
        </button>
      </div>
    </div>
  );
}

interface MemoryPanelProps {
  workspaceId: string;
  onClose: () => void;
}

export function MemoryPanel({ workspaceId, onClose }: MemoryPanelProps) {
  const t = useTranslations("memory");
  const { data: memories, mutate, isLoading } = useSWR(
    workspaceId ? ["memories", workspaceId] : null,
    () => memoryApi.list(workspaceId),
  );
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Memory | null>(null);

  const handleDelete = async (slug: string) => {
    await memoryApi.delete(workspaceId, slug);
    mutate();
  };

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-bg">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-text-secondary hover:bg-gray-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <Brain className="h-3.5 w-3.5 text-primary" />
        <span className="flex-1 text-xs font-medium text-text">{t("showMemory")}</span>
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-text-secondary">
          {memories?.length ?? 0}
        </span>
        <button
          type="button"
          onClick={() => { setShowAdd(true); setEditTarget(null); }}
          className="rounded-lg p-1 text-text-secondary transition hover:bg-gray-100 hover:text-text"
          title={t("addMemory")}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {showAdd && !editTarget && (
          <EditForm
            workspaceId={workspaceId}
            onDone={() => setShowAdd(false)}
            mutate={() => mutate()}
          />
        )}

        {isLoading && !memories && (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />
            ))}
          </div>
        )}

        {!isLoading && memories?.length === 0 && !showAdd && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Brain className="mb-2 h-8 w-8 text-text-secondary/30" />
            <p className="text-xs text-text-secondary">{t("emptyState")}</p>
          </div>
        )}

        {editTarget && (
          <EditForm
            initial={editTarget}
            workspaceId={workspaceId}
            onDone={() => setEditTarget(null)}
            mutate={() => mutate()}
          />
        )}

        {memories?.map((m) =>
          editTarget?.slug === m.slug ? null : (
            <MemoryItem
              key={m.slug}
              memory={m}
              onDelete={handleDelete}
              onEdit={(mem) => { setEditTarget(mem); setShowAdd(false); }}
            />
          )
        )}
      </div>
    </div>
  );
}

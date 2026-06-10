"use client";

import { Database, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { memoryApi } from "@/lib/api";
import { useTranslations } from "next-intl";

interface MemoryPanelProps {
  workspaceId: string;
}

export function MemoryPanel({ workspaceId }: MemoryPanelProps) {
  const t = useTranslations("memory");
  const tc = useTranslations("common");
  const { data: memories, mutate } = useSWR(
    workspaceId ? ["memories", workspaceId] : null,
    () => memoryApi.list(workspaceId),
  );
  const [showAdd, setShowAdd] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");

  const handleAdd = async () => {
    if (!newSlug || !newTitle || !newBody) return;
    await memoryApi.upsert(workspaceId, {
      slug: newSlug,
      title: newTitle,
      body: newBody,
    });
    setNewSlug("");
    setNewTitle("");
    setNewBody("");
    setShowAdd(false);
    mutate();
  };

  const handleDelete = async (slug: string) => {
    await memoryApi.delete(workspaceId, slug);
    mutate();
  };

  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Database className="h-4 w-4" />
          {t("title")}
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-gray-400 hover:text-gray-600"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {showAdd && (
        <div className="space-y-1">
          <input
            placeholder={t("slugPlaceholder")}
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value)}
            className="w-full rounded border px-2 py-1 text-xs"
          />
          <input
            placeholder={t("titlePlaceholder")}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="w-full rounded border px-2 py-1 text-xs"
          />
          <textarea
            placeholder={t("bodyPlaceholder")}
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            className="w-full rounded border px-2 py-1 text-xs"
            rows={3}
          />
          <button onClick={handleAdd} className="text-xs text-blue-500">
            {tc("save")}
          </button>
        </div>
      )}
      {memories?.map((m) => (
        <div key={m.slug} className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium">{m.title}</p>
            <p className="line-clamp-2 text-xs text-gray-400">{m.body}</p>
          </div>
          <button
            onClick={() => handleDelete(m.slug)}
            className="text-gray-300 hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

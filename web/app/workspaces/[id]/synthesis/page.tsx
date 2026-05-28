"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { useState, useRef, useCallback, Suspense } from "react";
import { cardApi, topicApi, type Card, type Topic } from "@/lib/api";
import { MarkdownContent } from "@/components/MarkdownContent";
import { toast } from "@/lib/toast";
import { LoadingState } from "@/components/LoadingState";
import {
  ArrowLeft,
  Sparkles,
  Save,
  Eye,
  Edit3,
  ChevronRight,
} from "lucide-react";

const MODES = [
  { value: "free", label: "自由组织" },
  { value: "timeline", label: "时间线" },
  { value: "argument", label: "论点-论据" },
  { value: "comparison", label: "对比分类" },
];

function SynthesisContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = params.id as string;
  const topicId = searchParams.get("topic_id");

  const { data: topics } = useSWR(
    workspaceId ? `topics-${workspaceId}` : null,
    () => topicApi.list(workspaceId),
    { revalidateOnFocus: false }
  );

  const topic = topics?.find((t) => t.id === topicId);

  // Fetch source cards
  const { data: sourceCards, isLoading: cardsLoading } = useSWR(
    topic ? `synthesis-cards-${topicId}` : null,
    async () => {
      if (!topic) return [];
      const cards = await Promise.all(
        topic.card_ids.map((id) => cardApi.get(id).catch(() => null))
      );
      return cards.filter(Boolean) as Card[];
    }
  );

  const [mode, setMode] = useState("free");
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [saving, setSaving] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);

  const handleSynthesize = useCallback(() => {
    if (!topicId || synthesizing) return;
    setSynthesizing(true);
    setContent("");
    setPreview(false);

    const abort = topicApi.synthesize(
      topicId,
      mode,
      (chunk) => setContent((prev) => prev + chunk),
      () => setSynthesizing(false),
      (err) => {
        toast("AI 整理失败: " + err.message, "error");
        setSynthesizing(false);
      }
    );
    abortRef.current = abort;
  }, [topicId, mode, synthesizing]);

  const handleStop = useCallback(() => {
    abortRef.current?.();
    setSynthesizing(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!content.trim() || saving) return;
    setSaving(true);
    try {
      const newCard = await cardApi.create({
        local_id: "card_" + Date.now(),
        workspace_id: workspaceId,
        title: topic?.name ? `话题梳理: ${topic.name}` : "话题梳理",
        content: content.trim(),
        keywords: topic?.name?.split(/\s*\/\s*/) ?? [],
        parent_card_ids: topic?.card_ids ?? [],
      });
      toast("保存成功", "success");
      router.push(`/workspaces/${workspaceId}/card/${newCard.id}`);
    } catch (e: any) {
      toast("保存失败: " + e.message, "error");
    } finally {
      setSaving(false);
    }
  }, [content, workspaceId, topic, saving, router]);

  if (!topicId) {
    return (
      <div className="flex h-screen items-center justify-center text-text-secondary">
        缺少话题参数
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-bg">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1 text-xs text-text-secondary transition hover:text-text"
          >
            <ArrowLeft size={16} />
            返回
          </button>
          <div className="h-4 w-px bg-border" />
          <h1 className="text-sm font-semibold text-text truncate max-w-[300px]">
            {topic?.name ?? "话题梳理"}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            disabled={synthesizing}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text outline-none disabled:opacity-50"
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          {synthesizing ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-600 transition hover:bg-red-100"
            >
              停止生成
            </button>
          ) : (
            <button
              onClick={handleSynthesize}
              disabled={!topic || !sourceCards?.length}
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs text-white transition hover:bg-primary-dark disabled:opacity-50"
            >
              <Sparkles size={14} />
              AI 整理
            </button>
          )}

          <div className="h-4 w-px bg-border" />

          <button
            onClick={() => setPreview(!preview)}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition ${
              preview
                ? "bg-primary/10 text-primary"
                : "text-text-secondary hover:bg-gray-100"
            }`}
          >
            {preview ? <Edit3 size={14} /> : <Eye size={14} />}
            {preview ? "编辑" : "预览"}
          </button>

          <button
            onClick={handleSave}
            disabled={!content.trim() || saving}
            className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs text-white transition hover:bg-green-700 disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? "保存中..." : "保存为卡片"}
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: source cards */}
        <div className="w-64 shrink-0 overflow-y-auto border-r border-border bg-surface">
          <div className="p-3">
            <h2 className="mb-2 text-xs font-medium text-text-secondary uppercase tracking-wider">
              源卡片 ({sourceCards?.length ?? 0})
            </h2>
          </div>
          {cardsLoading ? (
            <div className="px-3 py-6 text-center text-xs text-text-secondary">加载中...</div>
          ) : sourceCards?.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-text-secondary">无关联卡片</div>
          ) : (
            <div className="space-y-1 px-2 pb-3">
              {sourceCards?.map((card) => (
                <button
                  key={card.id}
                  onClick={() => setSelectedCard(selectedCard?.id === card.id ? null : card)}
                  className={`w-full rounded-lg p-2.5 text-left transition ${
                    selectedCard?.id === card.id
                      ? "bg-primary/10 border border-primary/20"
                      : "hover:bg-gray-50 border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: card.color }}
                    />
                    <span className="text-xs font-medium text-text truncate">
                      {card.title || "无标题"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-text-secondary line-clamp-2 leading-relaxed">
                    {card.content.slice(0, 100)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: editor / preview */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Selected card preview (expandable) */}
          {selectedCard && (
            <div className="shrink-0 border-b border-border bg-gray-50 p-4 max-h-[30vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-text">{selectedCard.title || "无标题"}</h3>
                <button
                  onClick={() => setSelectedCard(null)}
                  className="text-xs text-text-secondary hover:text-text"
                >
                  关闭
                </button>
              </div>
              <div className="text-sm">
                <MarkdownContent content={selectedCard.content} />
              </div>
            </div>
          )}

          {/* Editor area */}
          <div className="flex-1 overflow-hidden">
            {preview ? (
              <div className="h-full overflow-y-auto p-6 prose prose-sm max-w-none">
                {content ? (
                  <MarkdownContent content={content} />
                ) : (
                  <p className="text-text-secondary text-sm">
                    点击"AI 整理"生成内容，或直接在编辑模式下输入...
                  </p>
                )}
              </div>
            ) : (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={
                  synthesizing
                    ? "AI 正在整理中..."
                    : "点击「AI 整理」自动生成，或直接输入内容..."
                }
                disabled={synthesizing}
                className="h-full w-full resize-none bg-surface p-6 text-sm text-text outline-none placeholder:text-text-secondary leading-relaxed disabled:opacity-70"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SynthesisPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SynthesisContent />
    </Suspense>
  );
}

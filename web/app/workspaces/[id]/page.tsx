"use client";

import { useParams, useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { useState } from "react";
import { cardApi, type Card } from "@/lib/api";

const COLORS = ["#B8D4E3", "#E8A87C", "#D4A5A5", "#7EC8B0", "#B8A9C9", "#F0C987", "#87CEEB", "#DDA0DD"];

export default function WorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.id as string;

  const { data: cards, isLoading } = useSWR(
    workspaceId ? `cards-${workspaceId}` : null,
    () => cardApi.list(workspaceId)
  );

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [keywords, setKeywords] = useState("");
  const [color, setColor] = useState("#B8D4E3");
  const [emotionTag, setEmotionTag] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!content.trim() || creating) return;
    setCreating(true);
    try {
      const kw = keywords
        .split(/[,，、\s]+/)
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 5);
      await cardApi.create({
        local_id: "card_" + Date.now(),
        workspace_id: workspaceId,
        title: title.trim(),
        content: content.trim(),
        keywords: kw,
        color,
        emotion_tag: emotionTag,
      });
      setTitle("");
      setContent("");
      setKeywords("");
      setColor("#B8D4E3");
      setEmotionTag("");
      setShowCreate(false);
      mutate(`cards-${workspaceId}`);
    } catch (e: any) {
      alert("创建失败: " + e.message);
    } finally {
      setCreating(false);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center text-text-secondary">加载中...</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* Create button */}
      <div className="mb-6 flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-dark"
        >
          + 新建卡片
        </button>
      </div>

      <div className="columns-2 gap-4 sm:columns-3">
        {cards?.map((card) => (
          <CardItem
            key={card.id}
            card={card}
            onClick={() => router.push(`/workspaces/${workspaceId}/card/${card.id}`)}
          />
        ))}
      </div>

      {cards?.length === 0 && (
        <div className="py-20 text-center text-text-secondary">
          <p className="text-lg">还没有灵感卡片</p>
          <p className="mt-2 text-sm">点击上方按钮创建第一张卡片</p>
        </div>
      )}

      {/* Create card modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-text">新建灵感卡片</h2>

            <label className="mb-3 block">
              <span className="mb-1 block text-sm text-text-secondary">标题（可选）</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="给灵感起个标题..."
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
            </label>

            <label className="mb-3 block">
              <span className="mb-1 block text-sm text-text-secondary">内容 *</span>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="记录你的灵感..."
                rows={5}
                autoFocus
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary resize-none"
              />
            </label>

            <label className="mb-3 block">
              <span className="mb-1 block text-sm text-text-secondary">关键词（逗号分隔，最多5个）</span>
              <input
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="关键词1, 关键词2, ..."
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
            </label>

            <div className="mb-3 flex gap-4">
              <label className="flex-1">
                <span className="mb-1 block text-sm text-text-secondary">情绪标签</span>
                <input
                  value={emotionTag}
                  onChange={(e) => setEmotionTag(e.target.value)}
                  placeholder="如: 兴奋、好奇"
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary"
                />
              </label>
            </div>

            <label className="mb-5 block">
              <span className="mb-1 block text-sm text-text-secondary">配色</span>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`h-8 w-8 rounded-full ${
                      color === c ? "ring-2 ring-primary ring-offset-2" : ""
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </label>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-xl px-4 py-2 text-sm text-text-secondary hover:bg-gray-100"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!content.trim() || creating}
                className="rounded-xl bg-primary px-6 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {creating ? "创建中..." : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CardItem({ card, onClick }: { card: Card; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="mb-4 cursor-pointer break-inside-avoid rounded-card bg-surface p-4 shadow-sm transition hover:shadow-md"
      style={{ borderLeft: `4px solid ${card.color}` }}
    >
      {card.emotion_tag && (
        <span
          className="mb-2 inline-block rounded-md px-2 py-0.5 text-xs text-white"
          style={{ background: card.color }}
        >
          {card.emotion_tag}
        </span>
      )}
      {card.title && <h3 className="mb-1 font-semibold text-text">{card.title}</h3>}
      <p className="text-sm leading-relaxed text-text line-clamp-6">{card.content}</p>
      {card.keywords.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.keywords.slice(0, 3).map((kw) => (
            <span
              key={kw}
              className="rounded-md px-1.5 py-0.5 text-xs text-white"
              style={{ background: card.color }}
            >
              {kw}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

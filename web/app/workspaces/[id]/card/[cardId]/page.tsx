"use client";

import { useParams, useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { useState } from "react";
import { cardApi, commentApi, ragApi, type Card, type Comment } from "@/lib/api";

const COLORS = ["#B8D4E3", "#E8A87C", "#D4A5A5", "#7EC8B0", "#B8A9C9", "#F0C987", "#87CEEB", "#DDA0DD"];

export default function CardDetailPage() {
  const params = useParams();
  const router = useRouter();
  const cardId = params.cardId as string;
  const workspaceId = params.id as string;

  const { data: card } = useSWR(cardId ? `card-${cardId}` : null, () => cardApi.get(cardId));
  const { data: comments } = useSWR(
    cardId ? `comments-${cardId}` : null,
    () => commentApi.list(cardId)
  );
  const { data: relatedCards } = useSWR(
    cardId ? `related-${cardId}` : null,
    () => cardApi.getRelated(cardId)
  );
  const { data: similarCards } = useSWR(
    cardId ? `similar-${cardId}` : null,
    () => ragApi.similar(cardId, 5)
  );

  const [commentText, setCommentText] = useState("");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editKeywords, setEditKeywords] = useState("");
  const [editColor, setEditColor] = useState("#B8D4E3");
  const [editEmotionTag, setEditEmotionTag] = useState("");
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    if (!card) return;
    setEditTitle(card.title);
    setEditContent(card.content);
    setEditKeywords(card.keywords.join(", "));
    setEditColor(card.color);
    setEditEmotionTag(card.emotion_tag);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!editContent.trim() || saving) return;
    setSaving(true);
    try {
      const kw = editKeywords
        .split(/[,，、\s]+/)
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 5);
      await cardApi.update(cardId, {
        title: editTitle.trim(),
        content: editContent.trim(),
        keywords: kw,
        color: editColor,
        emotion_tag: editEmotionTag,
      });
      setEditing(false);
      mutate(`card-${cardId}`);
    } catch (e: any) {
      alert("保存失败: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("确定删除这张卡片？")) return;
    try {
      await cardApi.delete(cardId);
      router.push(`/workspaces/${workspaceId}`);
    } catch (e: any) {
      alert("删除失败: " + e.message);
    }
  };

  const handleToggleFavorite = async () => {
    if (!card) return;
    try {
      await cardApi.update(cardId, { is_favorite: !card.is_favorite });
      mutate(`card-${cardId}`);
    } catch {}
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    await commentApi.add(cardId, commentText.trim());
    setCommentText("");
    mutate(`comments-${cardId}`);
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm("确定删除这条评论？")) return;
    await commentApi.delete(cardId, commentId);
    mutate(`comments-${cardId}`);
  };

  if (!card) {
    return <div className="p-8 text-center text-text-secondary">加载中...</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Card content */}
      <div
        className="mb-6 rounded-card bg-surface p-6 shadow-sm"
        style={{ borderLeft: `6px solid ${card.color}` }}
      >
        {card.emotion_tag && (
          <span
            className="mb-3 inline-block rounded-md px-2 py-0.5 text-xs text-white"
            style={{ background: card.color }}
          >
            {card.emotion_tag}
          </span>
        )}
        {card.keywords.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {card.keywords.map((kw) => (
              <span
                key={kw}
                className="rounded-md px-2 py-0.5 text-xs text-white"
                style={{ background: card.color }}
              >
                {kw}
              </span>
            ))}
          </div>
        )}
        {card.title && <h1 className="mb-2 text-xl font-bold text-text">{card.title}</h1>}
        <p className="whitespace-pre-wrap leading-relaxed text-text">{card.content}</p>
        <div className="mt-4 flex gap-4 text-xs text-text-secondary">
          <span>创建于 {new Date(card.created_at).toLocaleString("zh-CN")}</span>
          {card.updated_at && (
            <span>更新于 {new Date(card.updated_at).toLocaleString("zh-CN")}</span>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="mb-6 flex justify-around rounded-card bg-surface p-4 shadow-sm">
        <ActionButton
          icon={card.is_favorite ? "★" : "☆"}
          label={card.is_favorite ? "已收藏" : "收藏"}
          onClick={handleToggleFavorite}
        />
        <ActionButton icon="✎" label="编辑" onClick={startEdit} />
        <ActionButton icon="AI" label="AI问答" onClick={() => router.push(`/rag?workspaceId=${workspaceId}&cardId=${cardId}`)} />
        <ActionButton icon="🗑" label="删除" onClick={handleDelete} />
      </div>

      {/* Related cards */}
      {relatedCards && relatedCards.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-text-secondary">
            关联卡片 ({relatedCards.length})
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {relatedCards.map((rc) => (
              <div
                key={rc.id}
                onClick={() => router.push(`/workspaces/${workspaceId}/card/${rc.id}`)}
                className="flex-shrink-0 cursor-pointer rounded-card bg-surface p-3 shadow-sm"
                style={{ borderLeft: `3px solid ${rc.color}`, width: 200 }}
              >
                <p className="line-clamp-3 text-sm text-text">{rc.content}</p>
                {rc.keywords[0] && (
                  <span className="mt-2 inline-block text-xs" style={{ color: rc.color }}>
                    {rc.keywords[0]}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* AI Similar cards */}
      {similarCards && similarCards.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-text-secondary">AI 推荐关联</h2>
          <div className="flex flex-col gap-3">
            {similarCards.map((sc) => (
              <div
                key={sc.id}
                className="flex items-center gap-3 rounded-card bg-surface p-3 shadow-sm"
              >
                <div className="flex-1 border-l-2 pl-3" style={{ borderColor: sc.color }}>
                  <p className="line-clamp-2 text-sm text-text">{sc.content}</p>
                  <span className="text-xs" style={{ color: sc.color }}>
                    {sc.keywords[0] || ""}
                  </span>
                </div>
                <button
                  onClick={() => router.push(`/workspaces/${workspaceId}/card/${sc.id}`)}
                  className="rounded-lg bg-primary px-3 py-1 text-xs text-white"
                >
                  查看
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Comments */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-text-secondary">
          评论 {comments?.length ? `(${comments.length})` : ""}
        </h2>

        {comments && comments.length > 0 && (
          <div className="mb-4 flex flex-col gap-3">
            {comments.map((c) => (
              <div key={c.id} className="rounded-lg bg-gray-50 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-text">匿名</span>
                  <span className="text-xs text-text-secondary">
                    {new Date(c.created_at).toLocaleString("zh-CN")}
                  </span>
                </div>
                <p className="text-sm text-text">{c.content}</p>
                <div className="mt-1 text-right">
                  <button
                    onClick={() => handleDeleteComment(c.id)}
                    className="text-xs text-text-secondary hover:text-danger"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {(!comments || comments.length === 0) && (
          <p className="mb-4 text-center text-sm text-text-secondary">暂无评论</p>
        )}

        <div className="flex gap-2">
          <input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
            placeholder="写评论..."
            className="flex-1 rounded-2xl bg-gray-100 px-4 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            onClick={handleAddComment}
            disabled={!commentText.trim()}
            className="rounded-2xl bg-primary px-4 py-2 text-sm text-white disabled:bg-gray-300"
          >
            发送
          </button>
        </div>
      </section>

      {/* Edit card modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-text">编辑卡片</h2>

            <label className="mb-3 block">
              <span className="mb-1 block text-sm text-text-secondary">标题</span>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
            </label>

            <label className="mb-3 block">
              <span className="mb-1 block text-sm text-text-secondary">内容</span>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={5}
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary resize-none"
              />
            </label>

            <label className="mb-3 block">
              <span className="mb-1 block text-sm text-text-secondary">关键词</span>
              <input
                value={editKeywords}
                onChange={(e) => setEditKeywords(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
            </label>

            <div className="mb-3 flex gap-4">
              <label className="flex-1">
                <span className="mb-1 block text-sm text-text-secondary">情绪标签</span>
                <input
                  value={editEmotionTag}
                  onChange={(e) => setEditEmotionTag(e.target.value)}
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
                    onClick={() => setEditColor(c)}
                    className={`h-8 w-8 rounded-full ${
                      editColor === c ? "ring-2 ring-primary ring-offset-2" : ""
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </label>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setEditing(false)}
                className="rounded-xl px-4 py-2 text-sm text-text-secondary hover:bg-gray-100"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={!editContent.trim() || saving}
                className="rounded-xl bg-primary px-6 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({ icon, label, onClick }: { icon: string; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary-dark">
        {icon}
      </span>
      <span className="text-xs text-text-secondary">{label}</span>
    </button>
  );
}

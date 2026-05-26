"use client";

import { useParams, useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { useState } from "react";
import { cardApi, commentApi, ragApi, authApi, workspaceApi, type Card, type Comment } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/Modal";
import { FormField } from "@/components/FormField";
import { ColorPicker } from "@/components/ColorPicker";
import { AiActionButtons } from "@/components/AiActionButtons";
import { ActionButton } from "@/components/ActionButton";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { ConfirmModal } from "@/components/ConfirmModal";
import { MarkdownContent } from "@/components/MarkdownContent";
import { TagChip } from "@/components/TagChip";
import { Star, Pencil, Pin, PinOff, Trash2, X, MessageSquare, Download } from "lucide-react";

export default function CardDetailPage() {
  const params = useParams();
  const router = useRouter();
  const cardId = params.cardId as string;
  const workspaceId = params.id as string;

  const { data: card, error: cardError, mutate: revalidateCard } = useSWR(cardId ? `card-${cardId}` : null, () => cardApi.get(cardId));
  const { data: comments } = useSWR(
    cardId ? `comments-${cardId}` : null,
    () => commentApi.list(cardId)
  );
  const { data: relatedCards } = useSWR(
    cardId ? `related-${cardId}` : null,
    () => cardApi.getRelated(cardId)
  );
  const { data: similarCards, isLoading: similarLoading } = useSWR(
    cardId ? `similar-${cardId}` : null,
    () => ragApi.similar(cardId, 5)
  );
  const { data: user } = useSWR("me", () => authApi.me());
  const { data: workspace } = useSWR(
    workspaceId ? `workspace-${workspaceId}` : null,
    () => workspaceApi.get(workspaceId)
  );

  const [commentText, setCommentText] = useState("");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editKeywords, setEditKeywords] = useState("");
  const [editColor, setEditColor] = useState("#B8D4E3");
  const [saving, setSaving] = useState(false);
  const [addedRelations, setAddedRelations] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; action: () => void } | null>(null);

  // Permission: owner can do everything, creator can edit/delete own cards
  const isOwner = workspace?.member_role === "owner";
  const isCreator = user && card && card.creator_id === user.id;
  const canEdit = isOwner || isCreator;

  const relatedIds = new Set([
    ...(relatedCards?.map((c) => c.id) || []),
    ...addedRelations,
  ]);

  const requireEditPermission = () => {
    if (!canEdit) {
      toast("仅空间创建者或卡片创建者可执行此操作", "error");
      return false;
    }
    return true;
  };

  const startEdit = () => {
    if (!card || !requireEditPermission()) return;
    setEditTitle(card.title);
    setEditContent(card.content);
    setEditKeywords(card.keywords.join(", "));
    setEditColor(card.color);
    setEditing(true);
  };

  const handleSave = async () => {
    if (!editContent.trim() || saving || !requireEditPermission()) return;
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
      });
      setEditing(false);
      mutate(`card-${cardId}`);
    } catch (e: any) {
      toast("保存失败: " + e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!requireEditPermission()) return;
    setConfirmAction({
      title: "删除卡片",
      message: "确定删除这张卡片？删除后无法恢复。",
      action: async () => {
        try {
          await cardApi.delete(cardId);
          router.push(`/workspaces/${workspaceId}`);
        } catch (e: any) {
          toast("删除失败: " + e.message, "error");
        }
      },
    });
  };

  const handleToggleFavorite = async () => {
    if (!card) return;
    try {
      await cardApi.update(cardId, { is_favorite: !card.is_favorite });
      mutate(`card-${cardId}`);
    } catch (e: any) {
      toast(e.message || "操作失败", "error");
    }
  };

  const handleToggleTemp = async () => {
    if (!card) return;
    try {
      await cardApi.update(cardId, { is_temp: !card.is_temp });
      mutate(`card-${cardId}`);
      toast(card.is_temp ? "已永久保存" : "已移至临时", "success");
    } catch (e: any) {
      toast(e.message || "操作失败", "error");
    }
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    try {
      await commentApi.add(cardId, commentText.trim());
      setCommentText("");
      mutate(`comments-${cardId}`);
    } catch (e: any) {
      toast(e.message || "评论失败", "error");
    }
  };

  const handleDeleteComment = (commentId: string) => {
    setConfirmAction({
      title: "删除评论",
      message: "确定删除这条评论？删除后无法恢复。",
      action: async () => {
        try {
          await commentApi.delete(cardId, commentId);
          mutate(`comments-${cardId}`);
        } catch (e: any) {
          toast(e.message || "删除失败", "error");
        }
      },
    });
  };

  const handleExport = () => {
    if (!card) return;
    const parts = [`# ${card.title || "未命名卡片"}`, "", card.content];
    if (card.keywords.length > 0) parts.push("", `关键词: ${card.keywords.join(", ")}`);
    const blob = new Blob([parts.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${card.title || "卡片"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAddRelation = async (relatedCardId: string) => {
    try {
      await cardApi.addRelation(cardId, relatedCardId);
      setAddedRelations((prev) => new Set(prev).add(relatedCardId));
      mutate(`related-${cardId}`);
    } catch (e: any) {
      toast("添加关联失败: " + e.message, "error");
    }
  };

  const handleRemoveRelation = async (relatedCardId: string) => {
    try {
      await cardApi.removeRelation(cardId, relatedCardId);
      mutate(`related-${cardId}`);
      toast("已取消关联", "success");
    } catch (e: any) {
      toast("取消关联失败: " + e.message, "error");
    }
  };

  if (cardError) return <ErrorState message={cardError.message} onRetry={revalidateCard} />;
  if (!card) return <LoadingState />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Card content */}
      <div
        className="mb-6 rounded-card border border-border bg-surface p-6 shadow-sm"
        style={{ borderLeft: `6px solid ${card.color}` }}
      >
        {card.keywords.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {card.keywords.map((kw) => (
              <TagChip key={kw} label={kw} color={card.color} />
            ))}
          </div>
        )}
        {card.title && <h1 className="mb-2 text-xl font-bold text-text">{card.title}</h1>}
        <MarkdownContent content={card.content} />
        <div className="mt-4 flex gap-4 text-xs text-text-secondary">
          <span>创建于 {new Date(card.created_at).toLocaleString("zh-CN")}</span>
          {card.updated_at && (
            <span>更新于 {new Date(card.updated_at).toLocaleString("zh-CN")}</span>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="mb-6 flex justify-around rounded-card border border-border bg-surface p-4 shadow-sm">
        <ActionButton icon={<Star size={20} fill={card.is_favorite ? "currentColor" : "none"} />} label={card.is_favorite ? "已收藏" : "收藏"} onClick={handleToggleFavorite} />
        <ActionButton icon={<Pencil size={20} />} label="编辑" onClick={startEdit} disabled={!canEdit} />
        <ActionButton icon={card.is_temp ? <PinOff size={20} /> : <Pin size={20} />} label={card.is_temp ? "永久保存" : "移至临时"} onClick={handleToggleTemp} />
        <ActionButton icon={<Download size={20} />} label="导出" onClick={handleExport} />
        <ActionButton icon={<Trash2 size={20} />} label="删除" onClick={handleDelete} disabled={!canEdit} />
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
                className="relative flex-shrink-0 rounded-card border border-border bg-surface p-3 shadow-sm"
                style={{ borderLeft: `3px solid ${rc.color}`, width: 200 }}
              >
                {canEdit && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemoveRelation(rc.id); }}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-xs text-text-secondary hover:bg-red-50 hover:text-danger"
                    title="取消关联"
                  >
                    <X size={12} />
                  </button>
                )}
                <div
                  onClick={() => router.push(`/workspaces/${workspaceId}/card/${rc.id}`)}
                  className="cursor-pointer"
                >
                  <p className="line-clamp-3 text-sm text-text">{rc.content}</p>
                  {rc.keywords[0] && (
                    <span className="mt-2 inline-block text-xs" style={{ color: rc.color }}>
                      {rc.keywords[0]}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* AI Similar cards */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold text-text-secondary">AI 推荐关联</h2>
        {similarLoading ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-card border border-border bg-gray-100" />
            ))}
          </div>
        ) : similarCards && similarCards.length > 0 ? (
          <div className="flex flex-col gap-3">
            {similarCards.map((sc) => (
              <div
                key={sc.id}
                className="flex items-center gap-3 rounded-card border border-border bg-surface p-3 shadow-sm"
              >
                <div className="flex-1 border-l-2 pl-3" style={{ borderColor: sc.color }}>
                  <p className="line-clamp-2 text-sm text-text">{sc.content}</p>
                  <span className="text-xs" style={{ color: sc.color }}>
                    {sc.keywords[0] || ""}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => router.push(`/workspaces/${workspaceId}/card/${sc.id}`)}
                    className="rounded-lg bg-primary px-3 py-1 text-xs text-white"
                  >
                    查看
                  </button>
                  {!relatedIds.has(sc.id) ? (
                    <button
                      onClick={() => handleAddRelation(sc.id)}
                      className="rounded-lg bg-primary/10 px-3 py-1 text-xs text-primary-dark"
                    >
                      关联
                    </button>
                  ) : (
                    <span className="rounded-lg bg-green-50 px-3 py-1 text-center text-xs text-green-600">
                      已关联
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* Comments */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-text-secondary">
          评论 {comments?.length ? `(${comments.length})` : ""}
        </h2>

        {comments && comments.length > 0 && (
          <div className="mb-4 flex flex-col gap-3">
            {comments.map((c) => {
              const canDeleteComment = isOwner || (user && c.author_id === user.id);
              return (
                <div key={c.id} className="rounded-lg border border-border bg-gray-50 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-semibold text-text">{c.author_nickname || "匿名"}</span>
                    <span className="text-xs text-text-secondary">
                      {new Date(c.created_at).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <p className="text-sm text-text">{c.content}</p>
                  {canDeleteComment && (
                    <div className="mt-1 text-right">
                      <button
                        onClick={() => handleDeleteComment(c.id)}
                        className="text-xs text-text-secondary hover:text-danger"
                      >
                        删除
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
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
        <Modal
          title="编辑卡片"
          onClose={() => setEditing(false)}
          onConfirm={handleSave}
          confirmText="保存"
          confirmDisabled={!editContent.trim()}
          loading={saving}
          size="lg"
        >
          <FormField label="标题">
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary"
            />
          </FormField>

          <FormField label="内容">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={5}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary resize-none"
            />
          </FormField>

          <AiActionButtons
            content={editContent}
            onPolish={(text) => setEditContent(text)}
            onSupplement={(text) => setEditContent(editContent + "\n\n" + text)}
            onTitle={(t) => setEditTitle(t)}
            onKeywords={(kws) => setEditKeywords(kws.join(", "))}
          />

          <FormField label="关键词">
            <input
              value={editKeywords}
              onChange={(e) => setEditKeywords(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary"
            />
          </FormField>

          <FormField label="配色">
            <ColorPicker value={editColor} onChange={setEditColor} />
          </FormField>
        </Modal>
      )}

      {/* Confirm modal */}
      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmText="删除"
          danger
          onConfirm={() => {
            confirmAction.action();
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}

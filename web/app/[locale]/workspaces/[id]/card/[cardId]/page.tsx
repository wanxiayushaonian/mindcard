"use client";

import { useParams, useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { useState, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
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
import { translateBackendError } from "@/lib/backend-errors";
import { formatDateTime } from "@/lib/format";
import { Star, Pencil, Pin, PinOff, Trash2, X, MessageSquare, Download } from "lucide-react";

export default function CardDetailPage() {
  const params = useParams();
  const router = useRouter();
  const cardId = params.cardId as string;
  const workspaceId = params.id as string;

  const t = useTranslations("card");
  const tCommon = useTranslations("common");
  const tEmotion = useTranslations("emotion");
  const tBackend = useTranslations("backendError");
  const tWorkspace = useTranslations("workspace");
  const locale = useLocale();

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
  const [editEmotionTag, setEditEmotionTag] = useState("");
  const [saving, setSaving] = useState(false);
  const [addedRelations, setAddedRelations] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; action: () => void } | null>(null);

  // Emotion map: translation key -> Chinese value (used as DB value)
  const emotionMap: Record<string, string> = useMemo(() => ({
    happy: "开心",
    anxious: "焦虑",
    calm: "平静",
    excited: "兴奋",
    confused: "困惑",
    touched: "感动",
    down: "沮丧",
    expectant: "期待",
  }), []);

  // Permission: owner/admin can do everything, editor can edit own cards, viewer/pending are read-only
  const role = workspace?.member_role;
  const isOwner = role === "owner";
  const isAdmin = role === "admin";
  const isEditor = role === "editor";
  const isViewer = role === "viewer";
  const isPending = role === "pending";
  const isCreator = user && card && card.creator_id === user.id;
  const canEditContent = isOwner || isAdmin || (isEditor && isCreator);
  const canCreate = isOwner || isAdmin || isEditor;

  const relatedIds = new Set([
    ...(relatedCards?.map((c) => c.id) || []),
    ...addedRelations,
  ]);

  const requireEditPermission = () => {
    if (!canEditContent) {
      toast(t("noEditPermission"), "error");
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
    setEditEmotionTag(card.emotion_tag || "");
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
        emotion_tag: editEmotionTag.trim(),
      });
      setEditing(false);
      mutate(`card-${cardId}`);
    } catch (e: any) {
      toast(t("saveFailed", { error: translateBackendError(e.message, tBackend) }), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!requireEditPermission()) return;
    try {
      const preview = await cardApi.deletePreview(cardId);
      const impacts: string[] = [];
      if (preview.relations > 0) impacts.push(t("impactRelations", { count: preview.relations }));
      if (preview.entities > 0) impacts.push(t("impactEntities", { count: preview.entities }));
      if (preview.graph_relations > 0) impacts.push(t("impactGraphRelations", { count: preview.graph_relations }));
      if (preview.comments > 0) impacts.push(t("impactComments", { count: preview.comments }));
      const impactText = impacts.length > 0 ? "\n" + t("deletePreviewImpact", { impacts: impacts.join(", ") }) : "";
      setConfirmAction({
        title: t("deleteCard"),
        message: t("deletePreviewConfirm", { title: preview.card_title }) + impactText,
        action: async () => {
          try {
            await cardApi.delete(cardId);
            router.push(`/workspaces/${workspaceId}`);
          } catch (e: any) {
            toast(t("deleteFailed", { error: translateBackendError(e.message, tBackend) }), "error");
          }
        },
      });
    } catch {
      // Preview failed, fall back to simple confirm
      setConfirmAction({
        title: t("deleteCard"),
        message: t("deleteSimpleConfirm"),
        action: async () => {
          try {
            await cardApi.delete(cardId);
            router.push(`/workspaces/${workspaceId}`);
          } catch (e: any) {
            toast(t("deleteFailed", { error: translateBackendError(e.message, tBackend) }), "error");
          }
        },
      });
    }
  };

  const handleToggleFavorite = async () => {
    if (!card) return;
    try {
      await cardApi.update(cardId, { is_favorite: !card.is_favorite });
      mutate(`card-${cardId}`);
    } catch (e: any) {
      toast(translateBackendError(e.message, tBackend) || t("operationFailed"), "error");
    }
  };

  const handleToggleTemp = async () => {
    if (!card) return;
    try {
      await cardApi.update(cardId, { is_temp: !card.is_temp });
      mutate(`card-${cardId}`);
      toast(card.is_temp ? t("permanentlySaved") : t("movedToTemp"), "success");
    } catch (e: any) {
      toast(translateBackendError(e.message, tBackend) || t("operationFailed"), "error");
    }
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    try {
      await commentApi.add(cardId, commentText.trim());
      setCommentText("");
      mutate(`comments-${cardId}`);
    } catch (e: any) {
      toast(translateBackendError(e.message, tBackend) || t("commentFailed"), "error");
    }
  };

  const handleDeleteComment = (commentId: string) => {
    setConfirmAction({
      title: t("deleteComment"),
      message: t("deleteCommentConfirm"),
      action: async () => {
        try {
          await commentApi.delete(cardId, commentId);
          mutate(`comments-${cardId}`);
        } catch (e: any) {
          toast(translateBackendError(e.message, tBackend) || t("deleteFailed", { error: "" }), "error");
        }
      },
    });
  };

  const handleExport = () => {
    if (!card) return;
    const parts = [`# ${card.title || t("unnamedCard")}`, "", card.content];
    if (card.keywords.length > 0) parts.push("", `${t("keywords")}: ${card.keywords.join(", ")}`);
    const blob = new Blob([parts.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${card.title || t("unnamedCard")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAddRelation = async (relatedCardId: string) => {
    try {
      await cardApi.addRelation(cardId, relatedCardId);
      setAddedRelations((prev) => new Set(prev).add(relatedCardId));
      mutate(`related-${cardId}`);
    } catch (e: any) {
      toast(t("addRelationFailed", { error: translateBackendError(e.message, tBackend) }), "error");
    }
  };

  const handleRemoveRelation = async (relatedCardId: string) => {
    try {
      await cardApi.removeRelation(cardId, relatedCardId);
      mutate(`related-${cardId}`);
      toast(t("relationRemoved"), "success");
    } catch (e: any) {
      toast(t("removeRelationFailed", { error: translateBackendError(e.message, tBackend) }), "error");
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
        <div className="mb-3 flex flex-wrap items-center gap-1">
          {card.keywords.map((kw) => (
            <TagChip key={kw} label={kw} color={card.color} />
          ))}
          {card.emotion_tag && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-text-secondary">
              {card.emotion_tag}
            </span>
          )}
        </div>
        {card.title && <h1 className="mb-2 text-xl font-bold text-text">{card.title}</h1>}
        <MarkdownContent content={card.content} />
        <div className="mt-4 flex gap-4 text-xs text-text-secondary">
          <span>{t("createdOn", { date: formatDateTime(card.created_at, locale) })}</span>
          {card.updated_at && (
            <span>{t("updatedOn", { date: formatDateTime(card.updated_at, locale) })}</span>
          )}
        </div>
      </div>

      {/* Pending banner */}
      {isPending && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {tWorkspace("pendingHint")}
        </div>
      )}

      {/* Action bar */}
      <div className="mb-6 flex justify-around rounded-card border border-border bg-surface p-4 shadow-sm">
        <ActionButton icon={<Star size={20} fill={card.is_favorite ? "currentColor" : "none"} />} label={card.is_favorite ? t("favorited") : tCommon("favorite")} onClick={handleToggleFavorite} disabled={!canCreate} />
        <ActionButton icon={<Pencil size={20} />} label={t("edit")} onClick={startEdit} disabled={!canEditContent} />
        <ActionButton icon={card.is_temp ? <PinOff size={20} /> : <Pin size={20} />} label={card.is_temp ? t("permanentSave") : t("moveToTemp")} onClick={handleToggleTemp} disabled={!canCreate} />
        <ActionButton icon={<Download size={20} />} label={tCommon("export")} onClick={handleExport} />
        <ActionButton icon={<Trash2 size={20} />} label={tCommon("delete")} onClick={handleDelete} disabled={!canEditContent} />
      </div>

      {/* Related cards */}
      {relatedCards && relatedCards.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-text-secondary">
            {t("relatedCards")} ({relatedCards.length})
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {relatedCards.map((rc) => (
              <div
                key={rc.id}
                className="relative flex-shrink-0 rounded-card border border-border bg-surface p-3 shadow-sm"
                style={{ borderLeft: `3px solid ${rc.color}`, width: 200 }}
              >
                {canCreate && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemoveRelation(rc.id); }}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-xs text-text-secondary hover:bg-red-50 hover:text-danger"
                    title={t("removeRelation")}
                  >
                    <X size={12} />
                  </button>
                )}
                <div
                  onClick={() => router.push(`/workspaces/${workspaceId}/card/${rc.id}`)}
                  className="cursor-pointer"
                >
                   <div className="line-clamp-3 overflow-hidden [&_img]:hidden [&_*]:!text-sm [&_*]:!leading-relaxed">
                     <MarkdownContent content={rc.content} />
                   </div>
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
        <h2 className="mb-3 text-sm font-semibold text-text-secondary">{t("aiRelated")}</h2>
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
                   <div className="line-clamp-2 overflow-hidden [&_img]:hidden [&_*]:!text-sm [&_*]:!leading-relaxed">
                     <MarkdownContent content={sc.content} />
                   </div>
                  <span className="text-xs" style={{ color: sc.color }}>
                    {sc.keywords[0] || ""}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => router.push(`/workspaces/${workspaceId}/card/${sc.id}`)}
                    className="rounded-lg bg-primary px-3 py-1 text-xs text-white"
                  >
                    {tCommon("view")}
                  </button>
                  {canCreate && !relatedIds.has(sc.id) ? (
                    <button
                      onClick={() => handleAddRelation(sc.id)}
                      className="rounded-lg bg-primary/10 px-3 py-1 text-xs text-primary-dark"
                    >
                      {t("addRelation")}
                    </button>
                  ) : relatedIds.has(sc.id) ? (
                    <span className="rounded-lg bg-green-50 px-3 py-1 text-center text-xs text-green-600">
                      {tCommon("linked")}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* Comments */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-text-secondary">
          {t("comments")} {comments?.length ? `(${comments.length})` : ""}
        </h2>

        {comments && comments.length > 0 && (
          <div className="mb-4 flex flex-col gap-3">
            {comments.map((c) => {
              const canDeleteComment = isOwner || isAdmin || (user && c.author_id === user.id);
              return (
                <div key={c.id} className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-semibold text-text">{c.author_nickname || tCommon("anonymous")}</span>
                    <span className="text-xs text-text-secondary">
                      {formatDateTime(c.created_at, locale)}
                    </span>
                  </div>
                  <p className="text-sm text-text">{c.content}</p>
                  {canDeleteComment && (
                    <div className="mt-1 text-right">
                      <button
                        onClick={() => handleDeleteComment(c.id)}
                        className="text-xs text-text-secondary hover:text-danger"
                      >
                        {tCommon("delete")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {(!comments || comments.length === 0) && (
          <p className="mb-4 text-center text-sm text-text-secondary">{t("noComments")}</p>
        )}

        {canCreate ? (
          <div className="flex gap-2">
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
              placeholder={t("commentPlaceholder")}
              className="flex-1 rounded-2xl bg-muted px-4 py-2 text-sm text-text outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              onClick={handleAddComment}
              disabled={!commentText.trim()}
              className="rounded-2xl bg-primary px-4 py-2 text-sm text-white disabled:bg-gray-300"
            >
              {tCommon("send")}
            </button>
          </div>
        ) : (
          <p className="text-center text-xs text-text-secondary">{t("commentPermissionHint")}</p>
        )}
      </section>

      {/* Edit card modal */}
      {editing && (
        <Modal
          title={t("editCard")}
          onClose={() => setEditing(false)}
          onConfirm={handleSave}
          confirmText={tCommon("save")}
          confirmDisabled={!editContent.trim()}
          loading={saving}
          size="lg"
        >
          <FormField label={t("title")}>
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text outline-none focus:border-primary"
            />
          </FormField>

          <FormField label={t("content")}>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={5}
              className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text outline-none focus:border-primary resize-none"
            />
          </FormField>

          <AiActionButtons
            content={editContent}
            onPolish={(text) => setEditContent(text)}
            onSupplement={(text) => setEditContent(editContent + "\n\n" + text)}
            onTitle={(t) => setEditTitle(t)}
            onKeywords={(kws) => setEditKeywords(kws.join(", "))}
          />

          <FormField label={t("keywords")}>
            <input
              value={editKeywords}
              onChange={(e) => setEditKeywords(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text outline-none focus:border-primary"
            />
          </FormField>

          <FormField label={t("emotionTag")}>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(emotionMap).map(([key, zhValue]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setEditEmotionTag(editEmotionTag === zhValue ? "" : zhValue)}
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    editEmotionTag === zhValue
                      ? "bg-primary text-white"
                      : "bg-muted text-text-secondary hover:bg-muted/80"
                  }`}
                >
                  {tEmotion(key as "happy" | "anxious" | "calm" | "excited" | "confused" | "touched" | "down" | "expectant")}
                </button>
              ))}
            </div>
          </FormField>

          <FormField label={t("color")}>
            <ColorPicker value={editColor} onChange={setEditColor} />
          </FormField>
        </Modal>
      )}

      {/* Confirm modal */}
      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmText={tCommon("delete")}
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

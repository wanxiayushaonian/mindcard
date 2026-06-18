"use client";

import { useParams, useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { cardApi, workspaceApi, topicApi, topologyApi, aiApi, type Card, type CardFilters, type Topic, type TreeNode } from "@/lib/api";
import { MarkdownContent } from "@/components/MarkdownContent";
import { RichEditor } from "@/components/editor";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/Modal";
import { FormField } from "@/components/FormField";
import { ColorPicker } from "@/components/ColorPicker";
import { AiActionButtons } from "@/components/AiActionButtons";
import { CardItem } from "@/components/CardItem";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { ConfirmModal } from "@/components/ConfirmModal";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { TreeBreadcrumb } from "@/components/TreeBreadcrumb";
import { usePanelStore } from "@/lib/workspace-layout-store";
import { translateBackendError } from "@/lib/backend-errors";
import { Plus, Upload, Package, Search, Sparkles, GitBranch, LayoutGrid, Star, Clock, Bookmark, Trash2, Copy, Pin, PinOff } from "lucide-react";

// Stable topic colors derived from topic ID
const TOPIC_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6",
];

function topicColor(topicId: string): string {
  let hash = 0;
  for (let i = 0; i < topicId.length; i++) {
    hash = ((hash << 5) - hash + topicId.charCodeAt(i)) | 0;
  }
  return TOPIC_COLORS[Math.abs(hash) % TOPIC_COLORS.length];
}

const PAGE_SIZE = 20;

export default function WorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.id as string;

  const t = useTranslations("card");
  const tCommon = useTranslations("common");
  const tEmotion = useTranslations("emotion");
  const tBackend = useTranslations("backendError");
  const tWorkspace = useTranslations("workspace");

  const { data: workspace } = useSWR(
    workspaceId ? `workspace-${workspaceId}` : null,
    () => workspaceApi.get(workspaceId)
  );
  const role = workspace?.member_role;
  const canCreate = role === "owner" || role === "admin" || role === "editor";

  // Fetch topics for visual indicators and context menu
  const { data: topics } = useSWR(
    workspaceId ? `topics-${workspaceId}` : null,
    () => topicApi.list(workspaceId),
    { revalidateOnFocus: false }
  );

  // Build card_id -> topic mapping
  const cardTopicMap = useMemo(() => {
    const map = new Map<string, Topic>();
    if (!topics) return map;
    for (const topic of topics) {
      for (const cid of topic.card_ids) {
        map.set(cid, topic);
      }
    }
    return map;
  }, [topics]);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; card: Card } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; action: () => void } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, card: Card) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, card });
  }, []);

  // Topology tree state
  const { data: treeNodes } = useSWR(
    workspaceId ? `topology-${workspaceId}` : null,
    () => topologyApi.list(workspaceId),
    { revalidateOnFocus: false }
  );
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const currentNodeIdRef = useRef<string | null>(null);
  currentNodeIdRef.current = currentNodeId;

  // Cards associated with current tree node
  const nodeCardIds = useMemo(() => {
    if (!currentNodeId || !treeNodes) return null;
    const node = treeNodes.find((n) => n.id === currentNodeId);
    return node ? new Set(node.card_ids) : null;
  }, [currentNodeId, treeNodes]);

  // Card count per node for breadcrumb display
  const cardCountMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!treeNodes) return map;
    for (const node of treeNodes) {
      map.set(node.id, node.card_count);
    }
    return map;
  }, [treeNodes]);

  const [filters, setFilters] = useState<CardFilters>({ sort_by: "created_at", order: "desc" });
  const filterKey = JSON.stringify(filters);

  const { data: listResp, isLoading, error, mutate: revalidate } = useSWR(
    workspaceId ? `cards-${workspaceId}-${filterKey}` : null,
    () => cardApi.list(workspaceId, { limit: PAGE_SIZE, ...filters }),
    { keepPreviousData: true }
  );

  const [allCards, setAllCards] = useState<Card[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filter displayed cards by current node
  const displayCards = useMemo(() => {
    if (!currentNodeId || !nodeCardIds) return allCards;
    return allCards?.filter((card) => nodeCardIds.has(card.id)) ?? allCards;
  }, [allCards, currentNodeId, nodeCardIds]);

  // Sync SWR data to local state
  useEffect(() => {
    if (listResp) {
      setAllCards(listResp.items);
      setNextCursor(listResp.next_cursor);
    }
  }, [listResp]);

  // Refresh card list when a card is precipitated from AI chat panel
  // and associate it with the current topology node if one is selected
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { cardId?: string } | undefined;
      if (detail?.cardId && currentNodeIdRef.current) {
        try {
          await topologyApi.addCard(currentNodeIdRef.current, detail.cardId);
          // Refresh topology cache so nodeCardIds includes the new card
          mutate(`topology-${workspaceId}`);
        } catch (err) {
          console.error("Failed to associate card with node:", err);
        }
      }
      revalidate();
    };
    window.addEventListener("card-precipitated", handler);
    return () => window.removeEventListener("card-precipitated", handler);
  }, [revalidate, workspaceId]);

  // Fork creation is now handled directly by AiChatPanel via chatApi.fork().

  const handleLoadMore = async () => {
    if (!allCards || loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const resp = await cardApi.list(workspaceId, { cursor: nextCursor, limit: PAGE_SIZE, ...filters });
      setAllCards((prev) => [...(prev || []), ...resp.items]);
      setNextCursor(resp.next_cursor);
    } catch (e: any) {
      toast(tCommon("loadFailed") + ": " + translateBackendError(e.message, tBackend), "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const [keywordInput, setKeywordInput] = useState(filters.keyword || "");
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => {
        const next = { ...prev };
        if (keywordInput.trim()) next.keyword = keywordInput.trim();
        else delete next.keyword;
        return next;
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [keywordInput]);

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [keywords, setKeywords] = useState("");
  const [color, setColor] = useState("#B8D4E3");
  const [emotionTag, setEmotionTag] = useState("");
  const [creating, setCreating] = useState(false);

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
        emotion_tag: emotionTag.trim(),
      });
      setTitle("");
      setContent("");
      setKeywords("");
      setColor("#B8D4E3");
      setEmotionTag("");
      setShowCreate(false);
      mutate(`cards-${workspaceId}-${filterKey}`);
    } catch (e: any) {
      toast(t("createFailed", { error: translateBackendError(e.message, tBackend) }), "error");
    } finally {
      setCreating(false);
    }
  };

  // --- Import / Export ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<{ title: string; content: string; keywords: string[] }[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [importAsTemp, setImportAsTemp] = useState(true);

  function parseMarkdownFiles(text: string, filename: string): { title: string; content: string; keywords: string[] }[] {
    // Strip YAML frontmatter
    const body = text.replace(/^---[\s\S]*?---\n?/, "").trim();
    if (!body) return [];
    // Split by ## headings
    const sections = body.split(/\n(?=## )/);
    const parsed = sections.length <= 1
      ? [{ title: filename.replace(/\.md$/i, ""), content: body }]
      : sections
          .map((s) => {
            const match = s.match(/^## (.+)\n([\s\S]*)/);
            if (match) return { title: match[1].trim(), content: match[2].trim() };
            return { title: "", content: s.trim() };
          })
          .filter((s) => s.content);
    // Extract keywords from content lines like "关键词: a, b, c" or "keywords: a, b, c"
    return parsed.map((item) => {
      const lines = item.content.split("\n");
      const kwLineIdx = lines.findIndex((l) => /^关键词[：:]\s*/.test(l.trim()) || /^keywords[：:]\s*/i.test(l.trim()));
      let keywords: string[] = [];
      if (kwLineIdx >= 0) {
        const kwText = lines[kwLineIdx].replace(/^关键词[：:]\s*/i, "").replace(/^keywords[：:]\s*/i, "");
        keywords = kwText.split(/[,，、]+/).map((k) => k.trim()).filter(Boolean).slice(0, 5);
        lines.splice(kwLineIdx, 1);
      }
      return { title: item.title, content: lines.join("\n").trim(), keywords };
    });
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const allParsed: { title: string; content: string; keywords: string[] }[] = [];
    for (const file of Array.from(files)) {
      const text = await file.text();
      allParsed.push(...parseMarkdownFiles(text, file.name));
    }
    if (allParsed.length === 0) {
      toast(t("noValidContent"), "error");
      return;
    }
    setImportPreview(allParsed);
    // Reset file input so the same file can be re-selected
    e.target.value = "";
  };

  const handleConfirmImport = async () => {
    if (!importPreview || importing) return;
    setImporting(true);
    try {
      const resp = await cardApi.createBatch({
        workspace_id: workspaceId,
        mark_as_temp: importAsTemp,
        cards: importPreview.map((item, i) => ({
          local_id: "card_" + Date.now() + "_" + i,
          title: item.title,
          content: item.content,
          keywords: item.keywords,
        })),
      });
      toast(t("importComplete", { success: resp.created, total: importPreview.length }), "success");
      setImportPreview(null);
      mutate(`cards-${workspaceId}-${filterKey}`);
    } catch (e: any) {
      toast(translateBackendError(e.message, tBackend) || t("importFailed"), "error");
    } finally {
      setImporting(false);
    }
  };

  const handleBatchExport = async () => {
    toast(t("exporting"), "info");
    try {
      const JSZip = (await import("jszip")).default;
      const cards = await cardApi.listAll(workspaceId, filters);
      const zip = new JSZip();
      const nameCount = new Map<string, number>();
      cards.forEach((card) => {
        let name = (card.title || t("unnamedCard")).replace(/[\\/:*?"<>|]/g, "_");
        const count = nameCount.get(name) || 0;
        nameCount.set(name, count + 1);
        if (count > 0) name += `_${count}`;
        const parts = [`# ${card.title || t("unnamedCard")}`, "", card.content];
        if (card.keywords.length > 0) parts.push("", `${t("keywords")}: ${card.keywords.join(", ")}`);
        zip.file(`${name}.md`, parts.join("\n"));
      });
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mindcard-export-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast(t("exportComplete", { count: cards.length }), "success");
    } catch (e: any) {
      toast(t("exportFailed", { error: translateBackendError(e.message, tBackend) }), "error");
    }
  };

  const leftCollapsed = usePanelStore((s) => s.leftCollapsed);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} onRetry={revalidate} />;

  return (
    <div className={`${leftCollapsed ? "px-2 py-3" : "mx-auto max-w-5xl px-4 py-6"}`}>
      {/* Row 1: status filters + create button */}
      <div className={`mb-3 flex items-center ${leftCollapsed ? "justify-around" : "justify-between gap-3"}`}>
        {leftCollapsed ? (
          /* Collapsed: icon-only buttons in a single row */
          <>
            {canCreate && (
              <button
                onClick={() => setShowCreate(true)}
                title={t("newCard")}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white shadow-sm transition hover:bg-primary-dark"
              >
                <Plus size={13} />
              </button>
            )}
            {[
              { label: tCommon("all"), value: undefined as string | undefined, icon: <LayoutGrid size={13} /> },
              { label: tCommon("favorite"), value: "favorite", icon: <Star size={13} /> },
              { label: tCommon("temporary"), value: "temp", icon: <Clock size={13} /> },
              { label: tCommon("permanent"), value: "permanent", icon: <Bookmark size={13} /> },
            ].map(({ label, value, icon }) => {
              const active =
                (value === undefined && filters.is_favorite === undefined && filters.is_temp === undefined) ||
                (value === "favorite" && filters.is_favorite === true) ||
                (value === "temp" && filters.is_temp === true) ||
                (value === "permanent" && filters.is_temp === false);
              return (
                <button
                  key={label}
                  title={label}
                  onClick={() => {
                    const next: CardFilters = { ...filters };
                    delete next.is_favorite;
                    delete next.is_temp;
                    if (value === "favorite") next.is_favorite = true;
                    else if (value === "temp") next.is_temp = true;
                    else if (value === "permanent") next.is_temp = false;
                    setFilters(next);
                  }}
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
                    active
                      ? "bg-primary text-white shadow-sm"
                      : "text-text-secondary/60 hover:bg-muted hover:text-text-secondary"
                  }`}
                >
                  {icon}
                </button>
              );
            })}
          </>
        ) : (
          /* Expanded: labeled pill row */
          <>
            <div className="flex gap-1.5">
              {[
                { label: tCommon("all"), value: undefined as string | undefined },
                { label: tCommon("favorite"), value: "favorite" },
                { label: tCommon("temporary"), value: "temp" },
                { label: tCommon("permanent"), value: "permanent" },
              ].map(({ label, value }) => {
                const active =
                  (value === undefined && filters.is_favorite === undefined && filters.is_temp === undefined) ||
                  (value === "favorite" && filters.is_favorite === true) ||
                  (value === "temp" && filters.is_temp === true) ||
                  (value === "permanent" && filters.is_temp === false);
                return (
                  <button
                    key={label}
                    onClick={() => {
                      const next: CardFilters = { ...filters };
                      delete next.is_favorite;
                      delete next.is_temp;
                      if (value === "favorite") next.is_favorite = true;
                      else if (value === "temp") next.is_temp = true;
                      else if (value === "permanent") next.is_temp = false;
                      setFilters(next);
                    }}
                    className={`rounded-full px-3 py-1 text-xs transition ${
                      active ? "bg-primary text-white" : "bg-muted text-text-secondary hover:bg-muted/80"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {canCreate && (
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1 rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-primary-dark"
              >
                <Plus size={16} /> {t("newCard")}
              </button>
            )}
          </>
        )}
      </div>

      {/* Rows 2 & 3: search / sort / tags — hidden when collapsed */}
      {!leftCollapsed && (
        <>
          {/* Row 2: search, sort, data ops */}
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input
                type="text"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                placeholder={t("filterByKeyword")}
                className="w-full rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-xs text-text outline-none placeholder:text-text-secondary focus:border-primary/40"
              />
            </div>
            <select
              value={`${filters.sort_by}-${filters.order}`}
              onChange={(e) => {
                const [sort_by, order] = e.target.value.split("-") as [string, string];
                setFilters({ ...filters, sort_by: sort_by as CardFilters["sort_by"], order: order as CardFilters["order"] });
              }}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none"
            >
              <option value="created_at-desc">{t("newestCreated")}</option>
              <option value="updated_at-desc">{t("newestUpdated")}</option>
              <option value="title-asc">{t("titleAZ")}</option>
              <option value="title-desc">{t("titleZA")}</option>
            </select>
            {canCreate && (
              <>
                <div className="h-4 w-px bg-border" />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  title={t("importMarkdown")}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-text-secondary transition hover:bg-muted"
                >
                  <Upload size={14} />
                </button>
                <button
                  onClick={handleBatchExport}
                  title={t("batchExportZip")}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-text-secondary transition hover:bg-muted"
                >
                  <Package size={14} />
                </button>
              </>
            )}
          </div>

          {/* Row 3: emotion tag filters */}
          <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
            <button
              onClick={() => setFilters((prev) => { const next = { ...prev }; delete next.emotion_tag; return next; })}
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] transition ${
                !filters.emotion_tag
                  ? "bg-primary text-white"
                  : "bg-muted/40 text-text-secondary hover:bg-muted border border-border"
              }`}
            >
              {tCommon("all")}
            </button>
            {Object.entries(emotionMap).slice(0, 6).map(([key, zhValue]) => (
              <button
                key={key}
                onClick={() => {
                  setFilters((prev) => {
                    const next = { ...prev };
                    if (next.emotion_tag === zhValue) delete next.emotion_tag;
                    else next.emotion_tag = zhValue;
                    return next;
                  });
                }}
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] transition ${
                  filters.emotion_tag === zhValue
                    ? "bg-primary text-white"
                    : "bg-muted/40 text-text-secondary hover:bg-muted border border-border"
                }`}
              >
                {tEmotion(key as "happy" | "anxious" | "calm" | "excited" | "confused" | "touched")}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Topology tree breadcrumb */}
      {treeNodes && treeNodes.length > 0 && (
        <div className="mb-3">
          <TreeBreadcrumb
            nodes={treeNodes}
            currentNodeId={currentNodeId}
            onNavigate={setCurrentNodeId}
            cardCountMap={cardCountMap}
          />
        </div>
      )}

      {/* Pending role banner — hidden when panel is collapsed */}
      {!leftCollapsed && role === "pending" && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {tWorkspace("pendingHint")}
        </div>
      )}

      <div className={leftCollapsed ? "columns-1 gap-2" : "columns-2 gap-4 sm:columns-3"}>
        {displayCards?.map((card) => {
          const topic = cardTopicMap.get(card.id);
          return (
            <CardItem
              key={card.id}
              card={card}
              onClick={() => router.push(`/workspaces/${workspaceId}/card/${card.id}`)}
              topicName={topic?.name}
              topicColor={topic ? topicColor(topic.id) : undefined}
              onContextMenu={(e) => handleContextMenu(e, card)}
              onMention={(detail) => window.dispatchEvent(new CustomEvent("card-mention-request", { detail }))}
              compact={leftCollapsed}
            />
          );
        })}
      </div>

      {displayCards && displayCards.length > 0 && nextCursor && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className={`rounded-xl border border-border bg-surface text-text-secondary transition hover:bg-muted/40 disabled:opacity-50 ${
              leftCollapsed ? "w-full py-1.5 text-[10px]" : "px-6 py-2.5 text-sm"
            }`}
          >
            {loadingMore ? "..." : leftCollapsed ? tCommon("more") : tCommon("loadMore")}
          </button>
        </div>
      )}

      {displayCards?.length === 0 && (
        leftCollapsed ? (
          <div className="py-8 text-center text-[10px] text-text-secondary/60">
            <p>{currentNodeId ? tCommon("noData") : t("noCards")}</p>
          </div>
        ) : (
          <div className="py-20 text-center text-text-secondary">
            <p className="text-lg">{currentNodeId ? tWorkspace("noCardsInNode") : tWorkspace("noCardsYet")}</p>
            {canCreate && !currentNodeId && <p className="mt-2 text-sm">{tWorkspace("createFirstCard")}</p>}
          </div>
        )
      )}

      {showCreate && (
        <Modal
          title={t("newCard")}
          onClose={() => setShowCreate(false)}
          onConfirm={handleCreate}
          confirmText={tCommon("create")}
          confirmDisabled={!content.trim()}
          loading={creating}
          size="lg"
        >
          <FormField label={t("titleOptional")}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("titlePlaceholder")}
              className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text outline-none focus:border-primary"
            />
          </FormField>

          <FormField label={t("contentRequired")}>
            <RichEditor
              content={content}
              onChange={setContent}
              workspaceId={workspaceId}
              placeholder={t("contentPlaceholder")}
              className="rounded-xl border border-border"
              showToolbar={true}
              minHeight="120px"
            />
          </FormField>

          <AiActionButtons
            content={content}
            onPolish={(text) => setContent(text)}
            onSupplement={(text) => setContent(content + "\n\n" + text)}
            onTitle={(t) => setTitle(t)}
            onKeywords={(kws) => setKeywords(kws.join(", "))}
          />

          <FormField label={t("keywordsHint")}>
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder={t("keywordsPlaceholder")}
              className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text outline-none focus:border-primary"
            />
          </FormField>

          <FormField label={t("emotionTag")}>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(emotionMap).map(([key, zhValue]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setEmotionTag(emotionTag === zhValue ? "" : zhValue)}
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    emotionTag === zhValue
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
            <ColorPicker value={color} onChange={setColor} />
          </FormField>
        </Modal>
      )}

      {/* Import preview modal */}
      {importPreview && (
        <Modal
          title={t("importPreview")}
          onClose={() => setImportPreview(null)}
          onConfirm={handleConfirmImport}
          confirmText={t("importCards", { count: importPreview.length })}
          loading={importing}
          size="lg"
        >
          <p className="mb-3 text-sm text-text-secondary">
            {t("importParsedConfirm", { count: importPreview.length })}
          </p>
          <label className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            <input type="checkbox" checked={importAsTemp} onChange={(e) => setImportAsTemp(e.target.checked)} />
            {t("importAsTemp")}
          </label>
          <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {importPreview.map((item, i) => (
              <div key={i} className="rounded-lg border border-border bg-surface p-3">
                {item.title && (
                  <p className="mb-1 text-sm font-semibold text-text">{item.title}</p>
                )}
                {item.keywords.length > 0 && (
                  <div className="mb-1 flex flex-wrap gap-1">
                    {item.keywords.map((kw) => (
                      <span key={kw} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary-dark">{kw}</span>
                    ))}
                  </div>
                )}
                <div className="max-h-32 overflow-y-auto text-xs">
                  <MarkdownContent content={item.content} />
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* Context menu for cards */}
      {ctxMenu && (() => {
        const ctxCard = ctxMenu.card;
        const topic = cardTopicMap.get(ctxCard.id);
        const isInCurrentNode = nodeCardIds?.has(ctxCard.id);
        const menuItems: ContextMenuItem[] = [];

        // 查看详情
        menuItems.push({
          label: t("viewDetails"),
          onClick: () => router.push(`/workspaces/${workspaceId}/card/${ctxCard.id}`),
        });

        // ── 基本操作 ──
        menuItems.push({ label: "", separator: true });

        // 收藏/取消收藏
        menuItems.push({
          label: ctxCard.is_favorite ? tCommon("unfavorite") : tCommon("favorite"),
          icon: <Star size={14} fill={ctxCard.is_favorite ? "currentColor" : "none"} />,
          onClick: async () => {
            try {
              await cardApi.update(ctxCard.id, { is_favorite: !ctxCard.is_favorite });
              mutate(`cards-${workspaceId}-${filterKey}`);
            } catch { /* silent */ }
          },
        });

        // 永久保存/移至临时
        if (canCreate) {
          menuItems.push({
            label: ctxCard.is_temp ? t("permanentSave") : t("moveToTemp"),
            icon: ctxCard.is_temp ? <PinOff size={14} /> : <Pin size={14} />,
            onClick: async () => {
              try {
                await cardApi.update(ctxCard.id, { is_temp: !ctxCard.is_temp });
                mutate(`cards-${workspaceId}-${filterKey}`);
                toast(ctxCard.is_temp ? t("promoteSuccess") : t("demoteSuccess"), "success");
              } catch (e: any) {
                toast(translateBackendError(e.message, tBackend) || t("operationFailed"), "error");
              }
            },
          });
        }

        // ── 主题与拓扑 ──
        if (topic || currentNodeId) {
          menuItems.push({ label: "", separator: true });
          if (topic) {
            menuItems.push({
              label: t("topicSynthesis"),
              icon: <Sparkles size={14} />,
              onClick: () => router.push(`/workspaces/${workspaceId}/synthesis?topic_id=${topic.id}`),
            });
          }
          if (currentNodeId && !isInCurrentNode) {
            menuItems.push({
              label: t("mountToCurrentNode"),
              icon: <GitBranch size={14} />,
              onClick: async () => {
                await topologyApi.addCard(currentNodeId, ctxMenu.card.id);
                mutate(`topology-${workspaceId}`);
                toast(t("mountedToNode"), "success");
              },
            });
          }
          if (currentNodeId && isInCurrentNode) {
            menuItems.push({
              label: t("removeFromCurrentNode"),
              icon: <GitBranch size={14} />,
              onClick: async () => {
                await topologyApi.removeCard(currentNodeId, ctxMenu.card.id);
                mutate(`topology-${workspaceId}`);
                toast(t("removedFromNode"), "success");
              },
            });
          }
        }

        // ── 工具 ──
        menuItems.push({ label: "", separator: true });
        menuItems.push({
          label: tCommon("copyTitle"),
          icon: <Copy size={14} />,
          onClick: () => {
            navigator.clipboard.writeText(ctxCard.title || "").catch(() => {});
            toast(tCommon("copied"), "success");
          },
        });

        // ── 危险操作 ──
        if (canCreate) {
          menuItems.push({ label: "", separator: true });
          menuItems.push({
            label: t("deleteCard"),
            icon: <Trash2 size={14} />,
            danger: true,
            onClick: () => {
              setConfirmAction({
                title: t("deleteCard"),
                message: t("deleteSimpleConfirm", { title: ctxCard.title || t("unnamedCard") }),
                action: async () => {
                  try {
                    await cardApi.delete(ctxCard.id);
                    mutate(`cards-${workspaceId}-${filterKey}`);
                    toast(t("deleteSuccess"), "success");
                  } catch (e: any) {
                    toast(translateBackendError(e.message, tBackend) || t("deleteFailed", { error: "" }), "error");
                  }
                },
              });
            },
          });
        }

        return (
          <ContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            items={menuItems}
            onClose={() => setCtxMenu(null)}
          />
        );
      })()}

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

"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { useState, useRef, useCallback, useEffect, useMemo, Suspense } from "react";
import {
  cardApi,
  topicApi,
  topologyApi,
  synthesisTemplateApi,
  type Card,
  type Topic,
  type TopologyNode,
  type SynthesisTemplate,
} from "@/lib/api";
import SimpleMarkdownRenderer from "@/components/SimpleMarkdownRenderer";
import { RichEditor } from "@/components/editor";
import { toast } from "@/lib/toast";
import { LoadingState } from "@/components/LoadingState";
import { ConfirmModal } from "@/components/ConfirmModal";
import { useTranslations } from "next-intl";
import {
  getDraftKey,
  loadDraft,
  saveDraft,
  clearDraft,
  type SynthesisDraft,
} from "@/lib/synthesis-draft";
import {
  ArrowLeft,
  Sparkles,
  Save,
  Eye,
  Edit3,
  FileText,
  AlertTriangle,
  X,
  Search,
  ChevronUp,
  ChevronDown,
  Check,
  Download,
  Copy,
  FileDown,
  Package,
} from "lucide-react";

const MODES = [
  { value: "free", labelKey: "modeFree" },
  { value: "timeline", labelKey: "modeTimeline" },
  { value: "argument", labelKey: "modeArgument" },
  { value: "comparison", labelKey: "modeComparison" },
];

function SynthesisContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = params.id as string;
  const topicId = searchParams.get("topic_id");
  const nodeId = searchParams.get("node_id");
  const t = useTranslations("synthesis");
  const tCommon = useTranslations("common");
  const tSettings = useTranslations("settings");

  // ── Topic mode ──
  const { data: topics } = useSWR(
    topicId && workspaceId ? `topics-${workspaceId}` : null,
    () => topicApi.list(workspaceId),
    { revalidateOnFocus: false }
  );
  const topic = topics?.find((t) => t.id === topicId);

  // ── Node mode ──
  const { data: nodes } = useSWR(
    nodeId && workspaceId ? `topology-${workspaceId}` : null,
    () => topologyApi.list(workspaceId),
    { revalidateOnFocus: false }
  );
  const node = nodes?.find((n) => n.id === nodeId);

  // Fetch source cards — topic mode
  const { data: topicCards, isLoading: topicCardsLoading } = useSWR(
    topic ? `synthesis-cards-${topicId}` : null,
    async () => {
      if (!topic) return [];
      const cards = await Promise.all(
        topic.card_ids.map((id) => cardApi.get(id).catch(() => null))
      );
      return cards.filter(Boolean) as Card[];
    }
  );

  // Fetch source cards — node mode
  const { data: subtreeData, isLoading: subtreeLoading } = useSWR(
    nodeId && !topicId ? `subtree-cards-${nodeId}` : null,
    () => topologyApi.subtreeCards(nodeId!)
  );
  const nodeCards = subtreeData?.cards ?? [];

  // Unified source
  const sourceCards = topicId ? topicCards : nodeCards;
  const cardsLoading = topicId ? topicCardsLoading : subtreeLoading;

  // ── Templates ──
  const { data: templates, mutate: revalidateTemplates } = useSWR(
    workspaceId ? `synthesis-templates-${workspaceId}` : null,
    () => synthesisTemplateApi.list(workspaceId),
    { revalidateOnFocus: false }
  );
  const templateList = templates?.templates ?? [];

  const [mode, setMode] = useState("free");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [saving, setSaving] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);

  // ── Source card enhancements ──
  const [cardFilter, setCardFilter] = useState("");
  const [cardSort, setCardSort] = useState<"manual" | "newest" | "oldest" | "title-asc" | "title-desc">("manual");
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [cardOrder, setCardOrder] = useState<string[]>([]);

  // Refs to track latest values for auto-save (avoids stale closures in setTimeout)
  const modeRef = useRef(mode);
  const templateIdRef = useRef(selectedTemplateId);
  const sourceCardsRef = useRef(sourceCards);
  const synthesizingRef = useRef(synthesizing);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { templateIdRef.current = selectedTemplateId; }, [selectedTemplateId]);
  useEffect(() => { sourceCardsRef.current = sourceCards; }, [sourceCards]);
  useEffect(() => { synthesizingRef.current = synthesizing; }, [synthesizing]);

  // ── Export dropdown ──
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExportOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [exportOpen]);

  // Sync cardOrder when source cards load or change:
  // - initialize on first load
  // - append newly added cards, remove cards that no longer exist
  useEffect(() => {
    if (!sourceCards || sourceCards.length === 0) return;
    const newIds = sourceCards.map((c) => c.id);
    setCardOrder((prev) => {
      if (prev.length === 0) return newIds;
      const currentSet = new Set(newIds);
      const filtered = prev.filter((id) => currentSet.has(id));
      const existingSet = new Set(prev);
      const additions = newIds.filter((id) => !existingSet.has(id));
      if (additions.length === 0 && filtered.length === prev.length) return prev;
      return [...filtered, ...additions];
    });
  }, [sourceCards]);

  // Filtered, sorted, ordered card list
  const displayCards = useMemo(() => {
    let cards = sourceCards ?? [];

    // Apply custom order
    if (cardOrder.length > 0) {
      const orderMap = new Map(cardOrder.map((id, i) => [id, i]));
      cards = [...cards].sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
    }

    // Filter
    if (cardFilter.trim()) {
      const q = cardFilter.toLowerCase();
      cards = cards.filter(
        (c) => c.title.toLowerCase().includes(q) || c.content.toLowerCase().includes(q)
      );
    }

    // Sort (manual = keep custom order, others override)
    if (cardSort === "title-asc") cards = [...cards].sort((a, b) => a.title.localeCompare(b.title));
    else if (cardSort === "title-desc") cards = [...cards].sort((a, b) => b.title.localeCompare(a.title));
    else if (cardSort === "newest") cards = [...cards].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    else if (cardSort === "oldest") cards = [...cards].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));

    return cards;
  }, [sourceCards, cardOrder, cardFilter, cardSort]);

  const toggleCardSelection = useCallback((cardId: string) => {
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedCardIds.size === displayCards.length) {
      setSelectedCardIds(new Set());
    } else {
      setSelectedCardIds(new Set(displayCards.map((c) => c.id)));
    }
  }, [selectedCardIds.size, displayCards]);

  const moveCard = useCallback((cardId: string, direction: "up" | "down") => {
    setCardSort("manual"); // Switch to manual order when user reorders
    setCardOrder((prev) => {
      const idx = prev.indexOf(cardId);
      if (idx === -1) return prev;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  // ── Template management modal ──
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<SynthesisTemplate | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateDesc, setTemplateDesc] = useState("");
  const [templatePrompt, setTemplatePrompt] = useState("");
  const [templateSaving, setTemplateSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SynthesisTemplate | null>(null);

  // Escape key to close template modal
  useEffect(() => {
    if (!showTemplateModal) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowTemplateModal(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [showTemplateModal]);

  // ── Draft state ──
  const draftKey = getDraftKey(workspaceId, topicId ?? undefined, nodeId ?? undefined);
  const [draftBanner, setDraftBanner] = useState<"none" | "restore" | "stale">("none");
  const [loadedDraft, setLoadedDraft] = useState<SynthesisDraft | null>(null);
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout>>();

  // Abort in-flight stream and pending draft timer on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.();
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load draft on mount ──
  useEffect(() => {
    const draft = loadDraft(draftKey);
    if (draft && draft.content) {
      setLoadedDraft(draft);
      setDraftBanner("restore");
    }
  }, [draftKey]);

  // ── Check staleness when source cards load ──
  useEffect(() => {
    if (!loadedDraft || !sourceCards || sourceCards.length === 0) return;
    const stale = sourceCards.some((card) => {
      const draftTs = loadedDraft.sourceCardTimestamps[card.id];
      return draftTs && (card.updated_at ?? "") > draftTs;
    });
    if (stale) {
      setDraftBanner("stale");
    }
  }, [loadedDraft, sourceCards]);

  // ── Warn before leaving with unsaved content ──
  useEffect(() => {
    if (!content.trim()) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [content]);

  // ── Auto-save content ──
  const scheduleAutoSave = useCallback(
    (newContent: string) => {
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
      if (!newContent.trim() || synthesizingRef.current) return;

      draftSaveTimer.current = setTimeout(() => {
        const cards = sourceCardsRef.current;
        const timestamps: Record<string, string> = {};
        cards?.forEach((c) => {
          timestamps[c.id] = c.updated_at ?? "";
        });
        saveDraft(draftKey, {
          content: newContent,
          mode: modeRef.current,
          templateId: templateIdRef.current ?? undefined,
          sourceCardIds: cards?.map((c) => c.id) ?? [],
          sourceCardTimestamps: timestamps,
          savedAt: Date.now(),
        });
      }, 2000);
    },
    [draftKey]
  );

  // ── Restore draft ──
  const handleRestoreDraft = useCallback(() => {
    if (!loadedDraft) return;
    setContent(loadedDraft.content);
    if (loadedDraft.mode) setMode(loadedDraft.mode);
    if (loadedDraft.templateId) setSelectedTemplateId(loadedDraft.templateId);
    if (loadedDraft.sourceCardIds?.length) setSelectedCardIds(new Set(loadedDraft.sourceCardIds));
    setDraftBanner("none");
    toast(t("draftRestored"), "success");
  }, [loadedDraft, t]);

  // ── Dismiss draft ──
  const handleDismissDraft = useCallback(() => {
    setDraftBanner("none");
    setLoadedDraft(null);
    clearDraft(draftKey);
  }, [draftKey]);

  // ── Handle mode/template selection ──
  const handleModeChange = useCallback((value: string) => {
    if (value.startsWith("template:")) {
      const tid = value.slice("template:".length);
      setSelectedTemplateId(tid);
      setMode("free"); // fallback mode
    } else {
      setSelectedTemplateId(null);
      setMode(value);
    }
  }, []);

  const handleSynthesize = useCallback(() => {
    if ((!topicId && !nodeId) || synthesizing) return;
    setSynthesizing(true);
    setContent("");
    setPreview(false);

    // Use selected cards if any, otherwise use all
    const effectiveCardIds = selectedCardIds.size > 0
      ? displayCards.filter((c) => selectedCardIds.has(c.id)).map((c) => c.id)
      : undefined;

    const abort = topicId
      ? topicApi.synthesize(
          topicId,
          mode,
          (chunk) => setContent((prev) => prev + chunk),
          () => setSynthesizing(false),
          (err) => {
            toast(t("synthesizeFailed", { error: err.message }), "error");
            setSynthesizing(false);
          },
          effectiveCardIds,
          selectedTemplateId ?? undefined
        )
      : topologyApi.synthesize(
          nodeId!,
          mode,
          (chunk) => setContent((prev) => prev + chunk),
          () => setSynthesizing(false),
          (err) => {
            toast(t("synthesizeFailed", { error: err.message }), "error");
            setSynthesizing(false);
          },
          effectiveCardIds,
          selectedTemplateId ?? undefined
        );
    abortRef.current = abort;
  }, [topicId, nodeId, mode, selectedTemplateId, selectedCardIds, displayCards, synthesizing, t]);

  const handleStop = useCallback(() => {
    abortRef.current?.();
    setSynthesizing(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!content.trim() || saving) return;
    setSaving(true);
    try {
      const titlePrefix = topicId
        ? (topic?.name ? t("synthesisPrefix", { name: topic.name }) : t("topicSynthesis"))
        : (node?.title ? t("synthesisPrefix", { name: node.title }) : t("nodeSynthesis"));
      const parentIds = topicId
        ? (topic?.card_ids ?? [])
        : (sourceCards?.map((c) => c.id) ?? []);

      const newCard = await cardApi.create({
        local_id: "card_" + Date.now(),
        workspace_id: workspaceId,
        title: titlePrefix,
        content: content.trim(),
        keywords: topicId
          ? (topic?.name?.split(/\s*\/\s*/) ?? [])
          : (node?.title?.split(/\s*\/\s*/) ?? []),
        parent_card_ids: parentIds,
      });
      clearDraft(draftKey);
      toast(t("saved"), "success");
      router.push(`/workspaces/${workspaceId}/card/${newCard.id}`);
    } catch (e: unknown) {
      toast(t("saveFailed", { error: e instanceof Error ? e.message : String(e) }), "error");
    } finally {
      setSaving(false);
    }
  }, [content, workspaceId, topicId, nodeId, topic, node, sourceCards, saving, router, draftKey, t]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (content.trim() && !saving) handleSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (!synthesizing) handleSynthesize();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [content, saving, synthesizing, handleSave, handleSynthesize]);

  // ── Export handlers ──
  const getSynthesisTitle = useCallback(() => {
    return topicId
      ? (topic?.name ?? t("topicSynthesis"))
      : (node?.title ?? t("nodeSynthesis"));
  }, [topicId, topic, node, t]);

  const handleCopy = useCallback(async () => {
    if (!content.trim()) return;
    await navigator.clipboard.writeText(content.trim());
    toast(t("copied"), "success");
    setExportOpen(false);
  }, [content, t]);

  const handleExportMarkdown = useCallback(() => {
    if (!content.trim()) return;
    const title = getSynthesisTitle();
    const safeName = title.replace(/[\\/:*?"<>|]/g, "_");
    const parts = [`# ${title}`, "", content.trim()];
    if (sourceCards && sourceCards.length > 0) {
      parts.push("", "---", "", "## Source Cards", "");
      sourceCards.forEach((c) => parts.push(`- ${c.title}`));
    }
    const blob = new Blob([parts.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast(t("exported"), "success");
    setExportOpen(false);
  }, [content, getSynthesisTitle, sourceCards, t]);

  const handleExportPDF = useCallback(async () => {
    if (!content.trim()) return;
    toast(t("exportingPdf"), "info");
    setExportOpen(false);

    // Temporarily switch to preview mode so the target element exists in DOM
    const wasPreview = preview;
    if (!wasPreview) setPreview(true);

    // Wait for React to render the preview DOM
    await new Promise((resolve) => setTimeout(resolve, 150));

    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);
      const el = document.getElementById("synthesis-preview");
      if (!el) {
        toast(t("exportPdfFailed", { error: t("previewNotFound") }), "error");
        return;
      }
      const canvas = await html2canvas(el, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pdfWidth - 20;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let yOffset = 0;
      pdf.addImage(imgData, "PNG", 10, 10 - yOffset, imgWidth, imgHeight);
      yOffset += pdfHeight - 20;
      while (yOffset < imgHeight) {
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 10, 10 - yOffset, imgWidth, imgHeight);
        yOffset += pdfHeight - 20;
      }
      const title = getSynthesisTitle();
      const safeName = title.replace(/[\\/:*?"<>|]/g, "_");
      pdf.save(`${safeName}-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast(t("exportedPdf"), "success");
    } catch (e: unknown) {
      toast(t("exportPdfFailed", { error: e instanceof Error ? e.message : String(e) }), "error");
    } finally {
      // Restore previous view mode
      if (!wasPreview) setPreview(false);
    }
  }, [content, preview, getSynthesisTitle, t]);

  const handleExportBundle = useCallback(async () => {
    if (!content.trim()) return;
    toast(t("exporting"), "info");
    setExportOpen(false);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const title = getSynthesisTitle();
      const safeName = title.replace(/[\\/:*?"<>|]/g, "_");
      zip.file(`${safeName}.md`, content.trim());
      const bundleCards = selectedCardIds.size > 0
        ? (sourceCards ?? []).filter((c) => selectedCardIds.has(c.id))
        : (sourceCards ?? []);
      if (bundleCards.length > 0) {
        const folder = zip.folder("source-cards")!;
        const nameCount = new Map<string, number>();
        bundleCards.forEach((card) => {
          let name = (card.title || t("unnamedCard")).replace(/[\\/:*?"<>|]/g, "_");
          const count = nameCount.get(name) || 0;
          nameCount.set(name, count + 1);
          if (count > 0) name += `_${count}`;
          folder.file(`${name}.md`, `# ${card.title}\n\n${card.content}`);
        });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}-bundle-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast(t("exportComplete"), "success");
    } catch (e: unknown) {
      toast(t("exportFailed", { error: e instanceof Error ? e.message : String(e) }), "error");
    }
  }, [content, getSynthesisTitle, sourceCards, t]);

  // ── Template CRUD ──
  const openCreateTemplate = useCallback(() => {
    setEditingTemplate(null);
    setTemplateName("");
    setTemplateDesc("");
    setTemplatePrompt("");
    setShowTemplateModal(true);
  }, []);

  const openEditTemplate = useCallback((tpl: SynthesisTemplate) => {
    setEditingTemplate(tpl);
    setTemplateName(tpl.name);
    setTemplateDesc(tpl.description ?? "");
    setTemplatePrompt(tpl.prompt);
    setShowTemplateModal(true);
  }, []);

  const handleSaveTemplate = useCallback(async () => {
    if (!templateName.trim() || !templatePrompt.trim() || templateSaving) return;
    setTemplateSaving(true);
    try {
      if (editingTemplate) {
        await synthesisTemplateApi.update(workspaceId, editingTemplate.id, {
          name: templateName.trim(),
          prompt: templatePrompt.trim(),
          description: templateDesc.trim() || undefined,
        });
      } else {
        await synthesisTemplateApi.create(workspaceId, {
          name: templateName.trim(),
          prompt: templatePrompt.trim(),
          description: templateDesc.trim() || undefined,
        });
      }
      revalidateTemplates();
      setShowTemplateModal(false);
      toast(t("templateSaved"), "success");
    } catch (e: unknown) {
      toast(t("templateSaveFailed", { error: e instanceof Error ? e.message : String(e) }), "error");
    } finally {
      setTemplateSaving(false);
    }
  }, [workspaceId, editingTemplate, templateName, templatePrompt, templateDesc, templateSaving, revalidateTemplates, t]);

  const handleDeleteTemplate = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await synthesisTemplateApi.delete(workspaceId, deleteTarget.id);
      revalidateTemplates();
      if (selectedTemplateId === deleteTarget.id) {
        setSelectedTemplateId(null);
        setMode("free");
      }
    } catch (e: unknown) {
      toast(t("templateDeleteFailed", { error: e instanceof Error ? e.message : String(e) }), "error");
    }
    setDeleteTarget(null);
  }, [workspaceId, deleteTarget, selectedTemplateId, revalidateTemplates, t]);

  // ── Content change handler with auto-save ──
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      scheduleAutoSave(newContent);
    },
    [scheduleAutoSave]
  );

  if (!topicId && !nodeId) {
    return (
      <div className="flex h-screen items-center justify-center text-text-secondary">
        {t("missingParam")}
      </div>
    );
  }

  const currentModeDisplay = selectedTemplateId
    ? templateList.find((tpl) => tpl.id === selectedTemplateId)?.name ?? t("customTemplates")
    : t(MODES.find((m) => m.value === mode)?.labelKey ?? "modeFree");

  return (
    <div className="flex h-screen flex-col bg-bg">
      {/* Draft / Staleness banner */}
      {draftBanner === "restore" && (
        <div className="flex shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2">
          <FileText size={16} className="shrink-0 text-amber-600" />
          <span className="text-sm text-amber-800">{t("draftAvailable")}</span>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={handleRestoreDraft}
              className="rounded-lg bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-700"
            >
              {t("restoreDraft")}
            </button>
            <button
              onClick={handleDismissDraft}
              className="rounded-lg px-3 py-1 text-xs text-amber-700 hover:bg-amber-100"
            >
              {t("dismiss")}
            </button>
          </div>
        </div>
      )}
      {draftBanner === "stale" && (
        <div className="flex shrink-0 items-center gap-3 border-b border-orange-200 bg-orange-50 px-4 py-2">
          <AlertTriangle size={16} className="shrink-0 text-orange-600" />
          <span className="text-sm text-orange-800">{t("staleWarning")}</span>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => { setDraftBanner("none"); handleSynthesize(); }}
              className="rounded-lg bg-orange-600 px-3 py-1 text-xs text-white hover:bg-orange-700"
            >
              {t("reSynthesize")}
            </button>
            <button
              onClick={handleDismissDraft}
              className="rounded-lg px-3 py-1 text-xs text-orange-700 hover:bg-orange-100"
            >
              {t("dismiss")}
            </button>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1 text-xs text-text-secondary transition hover:text-text"
          >
            <ArrowLeft size={16} />
            {t("back")}
          </button>
          <div className="h-4 w-px bg-border" />
          <h1 className="text-sm font-semibold text-text truncate max-w-[300px]">
            {topicId ? (topic?.name ?? t("topicSynthesis")) : (node?.title ?? t("nodeSynthesis"))}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Mode / Template selector */}
          <select
            value={selectedTemplateId ? `template:${selectedTemplateId}` : mode}
            onChange={(e) => handleModeChange(e.target.value)}
            disabled={synthesizing}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text outline-none disabled:opacity-50 max-w-[180px]"
          >
            <optgroup label={t("builtinModes")}>
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {t(m.labelKey)}
                </option>
              ))}
            </optgroup>
            {templateList.length > 0 && (
              <optgroup label={t("customTemplates")}>
                {templateList.map((tpl) => (
                  <option key={tpl.id} value={`template:${tpl.id}`}>
                    {tpl.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          {/* Manage templates button */}
          <button
            onClick={openCreateTemplate}
            disabled={synthesizing}
            aria-label={t("saveAsTemplate")}
            className="rounded-lg border border-border px-2 py-1 text-xs text-text-secondary transition hover:bg-gray-50 disabled:opacity-50"
            title={t("saveAsTemplate")}
          >
            <FileText size={14} />
          </button>

          {synthesizing ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-600 transition hover:bg-red-100"
            >
              {t("stopGeneration")}
            </button>
          ) : (
            <button
              onClick={handleSynthesize}
              disabled={topicId ? (!topic || !sourceCards?.length) : (!node || !sourceCards?.length)}
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs text-white transition hover:bg-primary-dark disabled:opacity-50"
            >
              <Sparkles size={14} />
              {t("aiSynthesize")}
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
            {preview ? t("edit") : t("preview")}
          </button>

          <button
            onClick={handleSave}
            disabled={!content.trim() || saving}
            className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs text-white transition hover:bg-green-700 disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? t("saving") : t("saveAsCard")}
          </button>

          {/* Export dropdown */}
          <div ref={exportRef} className="relative">
            <button
              onClick={() => setExportOpen(!exportOpen)}
              disabled={!content.trim()}
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-secondary transition hover:bg-gray-100 disabled:opacity-50"
            >
              <Download size={14} />
              {tCommon("export")}
              <ChevronDown size={12} />
            </button>
            {exportOpen && (
              <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-surface shadow-lg">
                <button
                  role="menuitem"
                  onClick={handleCopy}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text transition hover:bg-gray-50 first:rounded-t-lg"
                >
                  <Copy size={14} className="text-text-secondary" />
                  {t("copyToClipboard")}
                </button>
                <button
                  role="menuitem"
                  onClick={handleExportMarkdown}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text transition hover:bg-gray-50"
                >
                  <FileDown size={14} className="text-text-secondary" />
                  {t("exportMarkdown")}
                </button>
                <button
                  role="menuitem"
                  onClick={handleExportPDF}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text transition hover:bg-gray-50"
                >
                  <FileText size={14} className="text-text-secondary" />
                  {t("exportPdf")}
                </button>
                <button
                  role="menuitem"
                  onClick={handleExportBundle}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text transition hover:bg-gray-50 last:rounded-b-lg"
                >
                  <Package size={14} className="text-text-secondary" />
                  {t("exportBundle")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: source cards */}
        <div className="w-64 shrink-0 flex flex-col border-r border-border bg-surface">
          {/* Header */}
          <div className="shrink-0 p-3 pb-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                {t("sourceCards", { count: sourceCards?.length ?? 0 })}
              </h2>
              {selectedCardIds.size > 0 && (
                <span className="text-[10px] text-primary font-medium">
                  {t("selectedCount", { count: selectedCardIds.size })}
                </span>
              )}
            </div>

            {/* Filter + Sort */}
            {sourceCards && sourceCards.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary" />
                    <input
                      value={cardFilter}
                      onChange={(e) => setCardFilter(e.target.value)}
                      placeholder={t("filterCards")}
                      className="w-full rounded-md border border-border bg-bg py-1 pl-6 pr-2 text-[11px] outline-none focus:border-primary"
                    />
                  </div>
                  <button
                    onClick={toggleSelectAll}
                    className="shrink-0 flex items-center gap-1 rounded-md border border-border px-1.5 py-1 text-[10px] text-text-secondary hover:bg-gray-50"
                    title={selectedCardIds.size === displayCards.length ? t("deselectAll") : t("selectAll")}
                  >
                    <div className={`w-3 h-3 rounded border flex items-center justify-center ${
                      selectedCardIds.size === displayCards.length && displayCards.length > 0
                        ? "bg-primary border-primary"
                        : selectedCardIds.size > 0
                        ? "bg-primary/40 border-primary"
                        : "border-gray-300"
                    }`}>
                      {(selectedCardIds.size === displayCards.length && displayCards.length > 0) && (
                        <Check size={8} className="text-white" />
                      )}
                      {(selectedCardIds.size > 0 && selectedCardIds.size < displayCards.length) && (
                        <div className="w-1.5 h-0.5 bg-white rounded" />
                      )}
                    </div>
                  </button>
                </div>
                <select
                  value={cardSort}
                  onChange={(e) => setCardSort(e.target.value as typeof cardSort)}
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 text-[11px] text-text outline-none"
                >
                  <option value="manual">{t("sortManual")}</option>
                  <option value="newest">{t("sortNewest")}</option>
                  <option value="oldest">{t("sortOldest")}</option>
                  <option value="title-asc">{t("sortTitleAsc")}</option>
                  <option value="title-desc">{t("sortTitleDesc")}</option>
                </select>
              </div>
            )}
          </div>

          {/* Card list */}
          <div className="flex-1 overflow-y-auto">
            {cardsLoading ? (
              <div className="px-3 py-6 text-center text-xs text-text-secondary">{tCommon("loading")}</div>
            ) : sourceCards?.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-text-secondary">{t("noRelatedCards")}</div>
            ) : displayCards.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-text-secondary">{t("noMatch")}</div>
            ) : (
              <div className="space-y-0.5 px-2 pb-3">
                {displayCards.map((card, idx) => (
                  <div
                    key={card.id}
                    className={`group relative rounded-lg border transition ${
                      selectedCard?.id === card.id
                        ? "bg-primary/10 border-primary/20"
                        : "hover:bg-gray-50 border-transparent"
                    }`}
                  >
                    <div className="flex items-start gap-1.5 p-2">
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={selectedCardIds.has(card.id)}
                        onChange={() => toggleCardSelection(card.id)}
                        className="mt-1 h-3.5 w-3.5 shrink-0 accent-primary rounded cursor-pointer"
                      />
                      {/* Card content (click to preview) */}
                      <button
                        onClick={() => setSelectedCard(selectedCard?.id === card.id ? null : card)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: card.color }}
                          />
                          <span className="text-xs font-medium text-text truncate">
                            {card.title || t("noTitle")}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-text-secondary line-clamp-2 leading-relaxed">
                          {card.content.slice(0, 100)}
                        </p>
                      </button>
                      {/* Reorder arrows */}
                      <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => moveCard(card.id, "up")}
                          disabled={cardOrder.indexOf(card.id) === 0}
                          className="rounded p-0.5 text-text-secondary hover:bg-gray-200 disabled:opacity-30 disabled:cursor-default"
                          title={t("moveUp")}
                        >
                          <ChevronUp size={12} />
                        </button>
                        <button
                          onClick={() => moveCard(card.id, "down")}
                          disabled={cardOrder.indexOf(card.id) === cardOrder.length - 1}
                          className="rounded p-0.5 text-text-secondary hover:bg-gray-200 disabled:opacity-30 disabled:cursor-default"
                          title={t("moveDown")}
                        >
                          <ChevronDown size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: editor / preview */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Selected card preview (expandable) */}
          {selectedCard && (
            <div className="shrink-0 border-b border-border bg-gray-50 p-4 max-h-[30vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-text">{selectedCard.title || t("noTitle")}</h3>
                <button
                  onClick={() => setSelectedCard(null)}
                  className="text-xs text-text-secondary hover:text-text"
                >
                  {t("close")}
                </button>
              </div>
              <div className="text-sm">
                <SimpleMarkdownRenderer content={selectedCard.content} variant="compact" />
              </div>
            </div>
          )}

          {/* Editor area */}
          <div className="flex-1 overflow-hidden">
            {preview ? (
              <div id="synthesis-preview" className="h-full overflow-y-auto p-6 prose prose-sm max-w-none">
                {content ? (
                  <SimpleMarkdownRenderer content={content} variant="prose" streaming={synthesizing} />
                ) : (
                  <p className="text-text-secondary text-sm">
                    {t("aiContentPlaceholder")}
                  </p>
                )}
              </div>
            ) : (
              <RichEditor
                content={content}
                onChange={handleContentChange}
                workspaceId={workspaceId}
                placeholder={synthesizing ? t("textareaSynthesizing") : t("textareaPlaceholder")}
                readOnly={synthesizing}
                showToolbar={!synthesizing}
                className="h-full border-0 rounded-none"
                minHeight="100%"
              />
            )}
          </div>
        </div>
      </div>

      {/* Template management modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={editingTemplate ? tSettings("editTemplate") : tSettings("createTemplate")}>
          <div className="w-full max-w-lg rounded-xl bg-surface shadow-xl border border-border">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold text-text">
                {editingTemplate ? tSettings("editTemplate") : tSettings("createTemplate")}
              </h2>
              <button onClick={() => setShowTemplateModal(false)} aria-label={tCommon("close")} className="text-text-secondary hover:text-text">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* Template list */}
              {!editingTemplate && templateList.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-text-secondary mb-2">{t("customTemplates")}</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {templateList.map((tpl) => (
                      <div
                        key={tpl.id}
                        className="flex items-center justify-between rounded-lg border border-border px-3 py-2 hover:bg-gray-50"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-text truncate">{tpl.name}</p>
                          {tpl.description && (
                            <p className="text-[11px] text-text-secondary truncate">{tpl.description}</p>
                          )}
                        </div>
                        <div className="flex gap-1 ml-2">
                          <button
                            onClick={() => openEditTemplate(tpl)}
                            className="rounded px-2 py-1 text-xs text-primary hover:bg-primary/10"
                          >
                            {tCommon("edit")}
                          </button>
                          <button
                            onClick={() => setDeleteTarget(tpl)}
                            className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                          >
                            {tCommon("delete")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 border-t border-border pt-3">
                    <button
                      onClick={() => {
                        setEditingTemplate(null);
                        setTemplateName("");
                        setTemplateDesc("");
                        setTemplatePrompt("");
                      }}
                      className="text-xs text-primary hover:underline"
                    >
                      + {tSettings("createTemplate")}
                    </button>
                  </div>
                </div>
              )}

              {/* Name */}
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">
                  {tSettings("templateName")}
                </label>
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder={t("templateNamePlaceholder")}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">
                  {tSettings("templateDescription")}
                </label>
                <input
                  value={templateDesc}
                  onChange={(e) => setTemplateDesc(e.target.value)}
                  placeholder={tSettings("templateDescPlaceholder")}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>

              {/* Prompt */}
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">
                  {tSettings("templatePrompt")}
                </label>
                <textarea
                  value={templatePrompt}
                  onChange={(e) => setTemplatePrompt(e.target.value)}
                  placeholder={tSettings("templatePromptPlaceholder")}
                  rows={6}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button
                onClick={() => setShowTemplateModal(false)}
                className="rounded-lg px-4 py-1.5 text-xs text-text-secondary hover:bg-gray-100"
              >
                {tCommon("cancel")}
              </button>
              <button
                onClick={handleSaveTemplate}
                disabled={!templateName.trim() || !templatePrompt.trim() || templateSaving}
                className="rounded-lg bg-primary px-4 py-1.5 text-xs text-white disabled:opacity-50"
              >
                {templateSaving ? t("saving") : tCommon("save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <ConfirmModal
          title={tSettings("deleteTemplate")}
          message={tSettings("deleteTemplateConfirm", { name: deleteTarget.name })}
          confirmText={tCommon("delete")}
          danger
          onConfirm={handleDeleteTemplate}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
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

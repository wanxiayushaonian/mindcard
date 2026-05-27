"use client";

import { useParams, useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { useState, useEffect, useRef } from "react";
import { cardApi, workspaceApi, type Card, type CardFilters } from "@/lib/api";
import { MarkdownContent } from "@/components/MarkdownContent";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/Modal";
import { FormField } from "@/components/FormField";
import { ColorPicker } from "@/components/ColorPicker";
import { AiActionButtons } from "@/components/AiActionButtons";
import { CardItem } from "@/components/CardItem";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { Plus, Upload, Package, Search } from "lucide-react";

const PAGE_SIZE = 20;

export default function WorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.id as string;

  const { data: workspace } = useSWR(
    workspaceId ? `workspace-${workspaceId}` : null,
    () => workspaceApi.get(workspaceId)
  );
  const role = workspace?.member_role;
  const canCreate = role === "owner" || role === "admin" || role === "editor";

  const [filters, setFilters] = useState<CardFilters>({ sort_by: "created_at", order: "desc" });
  const filterKey = JSON.stringify(filters);

  const { data: listResp, isLoading, error, mutate: revalidate } = useSWR(
    workspaceId ? `cards-${workspaceId}-${filterKey}` : null,
    () => cardApi.list(workspaceId, { limit: PAGE_SIZE, ...filters })
  );

  const [allCards, setAllCards] = useState<Card[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Sync SWR data to local state
  useEffect(() => {
    if (listResp) {
      setAllCards(listResp.items);
      setNextCursor(listResp.next_cursor);
    }
  }, [listResp]);

  // Refresh card list when a card is precipitated from AI chat panel
  useEffect(() => {
    const handler = () => revalidate();
    window.addEventListener("card-precipitated", handler);
    return () => window.removeEventListener("card-precipitated", handler);
  }, [revalidate]);

  const handleLoadMore = async () => {
    if (!allCards || loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const resp = await cardApi.list(workspaceId, { cursor: nextCursor, limit: PAGE_SIZE, ...filters });
      setAllCards((prev) => [...(prev || []), ...resp.items]);
      setNextCursor(resp.next_cursor);
    } catch (e: any) {
      toast("加载失败: " + e.message, "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const [keywordInput, setKeywordInput] = useState(filters.keyword || "");
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((prev) => {
        const next = { ...prev };
        if (keywordInput.trim()) next.keyword = keywordInput.trim();
        else delete next.keyword;
        return next;
      });
    }, 400);
    return () => clearTimeout(t);
  }, [keywordInput]);

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
      toast("创建失败: " + e.message, "error");
    } finally {
      setCreating(false);
    }
  };

  // --- Import / Export ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<{ title: string; content: string; keywords: string[] }[] | null>(null);
  const [importing, setImporting] = useState(false);

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
      toast("未解析到有效内容", "error");
      return;
    }
    setImportPreview(allParsed);
    // Reset file input so the same file can be re-selected
    e.target.value = "";
  };

  const handleConfirmImport = async () => {
    if (!importPreview || importing) return;
    setImporting(true);
    let success = 0;
    for (let i = 0; i < importPreview.length; i++) {
      const item = importPreview[i];
      toast(`正在导入 (${i + 1}/${importPreview.length})...`, "info");
      try {
        await cardApi.create({
          local_id: "card_" + Date.now() + "_" + i,
          workspace_id: workspaceId,
          title: item.title,
          content: item.content,
          keywords: item.keywords,
        });
        success++;
      } catch {
        // Continue with remaining cards
      }
    }
    toast(`导入完成：${success}/${importPreview.length} 张卡片`, "success");
    setImportPreview(null);
    setImporting(false);
    mutate(`cards-${workspaceId}-${filterKey}`);
  };

  const handleBatchExport = async () => {
    toast("正在导出...", "info");
    try {
      const JSZip = (await import("jszip")).default;
      const cards = await cardApi.listAll(workspaceId, filters);
      const zip = new JSZip();
      const nameCount = new Map<string, number>();
      cards.forEach((card) => {
        let name = (card.title || "未命名").replace(/[\\/:*?"<>|]/g, "_");
        const count = nameCount.get(name) || 0;
        nameCount.set(name, count + 1);
        if (count > 0) name += `_${count}`;
        const parts = [`# ${card.title || "未命名卡片"}`, "", card.content];
        if (card.keywords.length > 0) parts.push("", `关键词: ${card.keywords.join(", ")}`);
        zip.file(`${name}.md`, parts.join("\n"));
      });
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mindcard-export-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`导出完成：${cards.length} 张卡片`, "success");
    } catch (e: any) {
      toast("导出失败: " + e.message, "error");
    }
  };

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} onRetry={revalidate} />;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* Row 1: status filters + create button */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {[
            { label: "全部", value: undefined },
            { label: "收藏", value: "favorite" },
            { label: "临时", value: "temp" },
            { label: "永久", value: "permanent" },
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
                  active ? "bg-primary text-white" : "bg-gray-100 text-text-secondary hover:bg-gray-200"
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
            <Plus size={16} /> 新建卡片
          </button>
        )}
      </div>

      {/* Row 2: search, sort, data ops */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            placeholder="按关键词筛选..."
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
          <option value="created_at-desc">最新创建</option>
          <option value="updated_at-desc">最近更新</option>
          <option value="title-asc">标题 A-Z</option>
          <option value="title-desc">标题 Z-A</option>
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
              title="导入 Markdown 文件"
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-text-secondary transition hover:bg-gray-100"
            >
              <Upload size={14} />
            </button>
            <button
              onClick={handleBatchExport}
              title="批量导出为 ZIP"
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-text-secondary transition hover:bg-gray-100"
            >
              <Package size={14} />
            </button>
          </>
        )}
      </div>

      {/* Row 3: emotion tag filters */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {["开心", "焦虑", "平静", "兴奋", "困惑", "感动"].map((emo) => (
          <button
            key={emo}
            onClick={() => {
              setFilters((prev) => {
                const next = { ...prev };
                if (next.emotion_tag === emo) delete next.emotion_tag;
                else next.emotion_tag = emo;
                return next;
              });
            }}
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] transition ${
              filters.emotion_tag === emo
                ? "bg-primary text-white"
                : "bg-gray-50 text-text-secondary hover:bg-gray-100 border border-border"
            }`}
          >
            {emo}
          </button>
        ))}
      </div>

      {/* Pending role banner */}
      {role === "pending" && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          你正在等待管理员分配权限，目前仅可浏览卡片。
        </div>
      )}

      <div className="columns-2 gap-4 sm:columns-3">
        {allCards?.map((card) => (
          <CardItem
            key={card.id}
            card={card}
            onClick={() => router.push(`/workspaces/${workspaceId}/card/${card.id}`)}
          />
        ))}
      </div>

      {allCards && allCards.length > 0 && nextCursor && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="rounded-xl border border-border bg-surface px-6 py-2.5 text-sm text-text-secondary transition hover:bg-gray-50 disabled:opacity-50"
          >
            {loadingMore ? "加载中..." : "加载更多"}
          </button>
        </div>
      )}

      {allCards?.length === 0 && (
        <div className="py-20 text-center text-text-secondary">
          <p className="text-lg">还没有灵感卡片</p>
          {canCreate && <p className="mt-2 text-sm">点击上方按钮创建第一张卡片</p>}
        </div>
      )}

      {showCreate && (
        <Modal
          title="新建灵感卡片"
          onClose={() => setShowCreate(false)}
          onConfirm={handleCreate}
          confirmText="创建"
          confirmDisabled={!content.trim()}
          loading={creating}
          size="lg"
        >
          <FormField label="标题（可选）">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="给灵感起个标题..."
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary"
            />
          </FormField>

          <FormField label="内容 *">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="记录你的灵感..."
              rows={5}
              autoFocus
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary resize-none"
            />
          </FormField>

          <AiActionButtons
            content={content}
            onPolish={(text) => setContent(text)}
            onSupplement={(text) => setContent(content + "\n\n" + text)}
            onTitle={(t) => setTitle(t)}
            onKeywords={(kws) => setKeywords(kws.join(", "))}
          />

          <FormField label="关键词（逗号分隔，最多5个）">
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="关键词1, 关键词2, ..."
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary"
            />
          </FormField>

          <FormField label="情绪标签（可选）">
            <div className="flex flex-wrap gap-1.5">
              {["开心", "焦虑", "平静", "兴奋", "困惑", "感动", "沮丧", "期待"].map((emo) => (
                <button
                  key={emo}
                  type="button"
                  onClick={() => setEmotionTag(emotionTag === emo ? "" : emo)}
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    emotionTag === emo
                      ? "bg-primary text-white"
                      : "bg-gray-100 text-text-secondary hover:bg-gray-200"
                  }`}
                >
                  {emo}
                </button>
              ))}
            </div>
          </FormField>

          <FormField label="配色">
            <ColorPicker value={color} onChange={setColor} />
          </FormField>
        </Modal>
      )}

      {/* Import preview modal */}
      {importPreview && (
        <Modal
          title="导入预览"
          onClose={() => setImportPreview(null)}
          onConfirm={handleConfirmImport}
          confirmText={`导入 ${importPreview.length} 张卡片`}
          loading={importing}
          size="lg"
        >
          <p className="mb-3 text-sm text-text-secondary">
            解析到 {importPreview.length} 张卡片，确认导入？
          </p>
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
    </div>
  );
}

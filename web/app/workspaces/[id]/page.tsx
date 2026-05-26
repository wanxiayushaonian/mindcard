"use client";

import { useParams, useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { useState, useEffect } from "react";
import { cardApi, type Card, type CardFilters } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/Modal";
import { FormField } from "@/components/FormField";
import { ColorPicker } from "@/components/ColorPicker";
import { AiActionButtons } from "@/components/AiActionButtons";
import { CardItem } from "@/components/CardItem";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { Plus } from "lucide-react";

const PAGE_SIZE = 20;

export default function WorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.id as string;

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

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [keywords, setKeywords] = useState("");
  const [color, setColor] = useState("#B8D4E3");
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
      });
      setTitle("");
      setContent("");
      setKeywords("");
      setColor("#B8D4E3");
      setShowCreate(false);
      mutate(`cards-${workspaceId}-${filterKey}`);
    } catch (e: any) {
      toast("创建失败: " + e.message, "error");
    } finally {
      setCreating(false);
    }
  };

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} onRetry={revalidate} />;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
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
        <div className="flex items-center gap-2">
          <select
            value={`${filters.sort_by}-${filters.order}`}
            onChange={(e) => {
              const [sort_by, order] = e.target.value.split("-") as [string, string];
              setFilters({ ...filters, sort_by: sort_by as CardFilters["sort_by"], order: order as CardFilters["order"] });
            }}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text outline-none"
          >
            <option value="created_at-desc">最新创建</option>
            <option value="updated_at-desc">最近更新</option>
            <option value="title-asc">标题 A-Z</option>
            <option value="title-desc">标题 Z-A</option>
          </select>
          <input
            type="text"
            value={filters.keyword || ""}
            onChange={(e) => {
              const next = { ...filters };
              if (e.target.value.trim()) next.keyword = e.target.value.trim();
              else delete next.keyword;
              setFilters(next);
            }}
            placeholder="关键词筛选"
            className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text outline-none placeholder:text-text-secondary"
          />
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-primary-dark"
          >
            <Plus size={16} /> 新建卡片
          </button>
        </div>
      </div>

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
          <p className="mt-2 text-sm">点击上方按钮创建第一张卡片</p>
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

          <FormField label="配色">
            <ColorPicker value={color} onChange={setColor} />
          </FormField>
        </Modal>
      )}
    </div>
  );
}

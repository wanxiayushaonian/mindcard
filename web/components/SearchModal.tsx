"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchApi, type SearchResult } from "@/lib/api";
import { Search, X, ArrowRight } from "lucide-react";

type SearchMode = "semantic" | "fulltext" | "hybrid";

export function SearchModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const doSearch = async (q: string, m: SearchMode) => {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setError("");
    setSearched(true);
    try {
      const searchFn = { semantic: searchApi.semantic, fulltext: searchApi.fulltext, hybrid: searchApi.hybrid }[m];
      const res = await searchFn(q, workspaceId);
      setResults(res.results);
    } catch (e: any) {
      setResults([]);
      setError(e.message || "搜索失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query, mode), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, mode]);

  const handleSelect = (cardId: string) => {
    onClose();
    router.push(`/workspaces/${workspaceId}/card/${cardId}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl rounded-2xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search size={20} className="shrink-0 text-text-secondary" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doSearch(query, mode);
              if (e.key === "Escape") onClose();
            }}
            placeholder="搜索灵感卡片..."
            className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-secondary"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-text-secondary hover:text-text">
              <X size={16} />
            </button>
          )}
          <button onClick={onClose} className="shrink-0 text-xs text-text-secondary hover:text-text">
            ESC
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 border-b border-border px-4 py-2">
          {(["hybrid", "semantic", "fulltext"] as SearchMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                mode === m
                  ? "bg-primary text-white"
                  : "text-text-secondary hover:bg-gray-100"
              }`}
            >
              {{ hybrid: "混合", semantic: "语义", fulltext: "全文" }[m]}
            </button>
          ))}
          {loading && <span className="ml-auto text-xs text-text-secondary">搜索中...</span>}
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {error && (
            <div className="mx-2 my-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
          )}

          {!searched && !loading && (
            <div className="py-10 text-center text-text-secondary">
              <Search size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">输入关键词搜索灵感卡片</p>
            </div>
          )}

          {searched && results.length === 0 && !loading && !error && (
            <div className="py-10 text-center text-sm text-text-secondary">未找到相关卡片</div>
          )}

          {results.map(({ card, score }) => (
            <div
              key={card.id}
              onClick={() => handleSelect(card.id)}
              className="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3 transition hover:bg-gray-50"
            >
              <div className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: card.color }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {card.title && <span className="text-sm font-medium text-text">{card.title}</span>}
                  <span className="text-xs text-text-secondary">{(score * 100).toFixed(0)}%</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{card.content}</p>
                {card.keywords.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {card.keywords.slice(0, 3).map((kw) => (
                      <span key={kw} className="rounded px-1 py-0.5 text-[10px] text-white" style={{ background: card.color }}>
                        {kw}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <ArrowRight size={14} className="mt-1 shrink-0 text-text-secondary/50" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

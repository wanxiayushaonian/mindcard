"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { searchApi, type SearchResult } from "@/lib/api";
import { MarkdownContent } from "@/components/MarkdownContent";
import { useTranslations } from "next-intl";

type SearchMode = "semantic" | "fulltext" | "hybrid";

export default function SearchPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.id as string;
  const t = useTranslations("search");

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setSearched(true);
    try {
      const searchFn = { semantic: searchApi.semantic, fulltext: searchApi.fulltext, hybrid: searchApi.hybrid }[mode];
      const res = await searchFn(query, workspaceId);
      setResults(res.results);
    } catch (e: any) {
      setResults([]);
      setError(e.message || t("searchFailed"));
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
    debounceRef.current = setTimeout(() => {
      handleSearch();
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, mode]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder={t("placeholder")}
            className="flex-1 rounded-xl border border-gray-200 bg-surface px-4 py-3 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="rounded-xl bg-accent px-6 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? t("searching") : t("searchButton")}
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          {(["hybrid", "semantic", "fulltext"] as SearchMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-1 text-xs ${
                mode === m
                  ? "bg-accent text-white"
                  : "bg-gray-100 text-text-secondary hover:bg-gray-200"
              }`}
            >
              {{ hybrid: t("hybrid"), semantic: t("semantic"), fulltext: t("fulltext") }[m]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {!searched && !loading && (
        <div className="py-16 text-center text-text-secondary">
          <div className="mb-3 text-4xl">&#128269;</div>
          <p className="text-lg font-medium">{t("title")}</p>
          <p className="mt-2 text-sm">{t("subtitle")}</p>
        </div>
      )}

      {searched && results.length > 0 && (
        <div className="flex flex-col gap-3">
          {results.map(({ card, score }) => (
            <div
              key={card.id}
              onClick={() => router.push(`/workspaces/${workspaceId}/card/${card.id}`)}
              className="cursor-pointer rounded-card border border-border bg-surface p-4 shadow-sm transition hover:shadow-md"
              style={{ borderLeft: `4px solid ${card.color}` }}
            >
              <div className="mb-1 flex items-start justify-between">
                <div className="flex flex-wrap gap-1">
                  {card.keywords.slice(0, 3).map((kw) => (
                    <span
                      key={kw}
                      className="rounded px-1.5 py-0.5 text-xs text-white"
                      style={{ background: card.color }}
                    >
                      {kw}
                    </span>
                  ))}
                </div>
                <span className="text-xs text-text-secondary">
                  {(score * 100).toFixed(0)}%
                </span>
              </div>
              {card.title && <h3 className="mb-1 font-semibold text-text">{card.title}</h3>}
              <div className="mt-1 line-clamp-3 overflow-hidden [&_img]:hidden [&_*]:!text-sm [&_*]:!leading-relaxed">
                <MarkdownContent content={card.content} />
              </div>
            </div>
          ))}
        </div>
      )}

      {searched && results.length === 0 && !loading && !error && (
        <p className="py-12 text-center text-sm text-text-secondary">{t("noResults")}</p>
      )}
    </div>
  );
}

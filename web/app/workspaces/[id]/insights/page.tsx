"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ragApi } from "@/lib/api";

interface Insights {
  themes: string[];
  trends: string;
  unexplored: string[];
  suggestions: string[];
}

export default function InsightsPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.id as string;

  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await ragApi.insights(workspaceId);
      setInsights(result);
    } catch (e: any) {
      setError(e.message || "生成洞察失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-text">空间洞察</h1>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-dark disabled:opacity-50"
        >
          {loading ? "分析中..." : "生成洞察"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-600">{error}</div>
      )}

      {!insights && !loading && !error && (
        <div className="py-20 text-center text-text-secondary">
          <div className="mb-4 text-5xl">🔍</div>
          <p className="text-lg font-medium">AI 空间洞察</p>
          <p className="mt-2 text-sm">基于你的灵感卡片，AI 将分析主题趋势、发现未探索领域并提供建议</p>
        </div>
      )}

      {insights && (
        <div className="flex flex-col gap-5">
          {/* Themes */}
          {insights.themes.length > 0 && (
            <section className="rounded-card bg-surface p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-text-secondary">核心主题</h2>
              <div className="flex flex-wrap gap-2">
                {insights.themes.map((theme, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary-dark"
                  >
                    {theme}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Trends */}
          {insights.trends && (
            <section className="rounded-card bg-surface p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-text-secondary">趋势分析</h2>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">
                {insights.trends}
              </p>
            </section>
          )}

          {/* Unexplored */}
          {insights.unexplored.length > 0 && (
            <section className="rounded-card bg-surface p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-text-secondary">未探索领域</h2>
              <ul className="flex flex-col gap-2">
                {insights.unexplored.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text">
                    <span className="mt-0.5 text-yellow-500">💡</span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Suggestions */}
          {insights.suggestions.length > 0 && (
            <section className="rounded-card bg-surface p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-text-secondary">AI 建议</h2>
              <ul className="flex flex-col gap-2">
                {insights.suggestions.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text">
                    <span className="mt-0.5 text-green-500">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

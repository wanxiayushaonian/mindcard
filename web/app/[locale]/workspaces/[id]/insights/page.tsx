"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ragApi } from "@/lib/api";
import { Lightbulb } from "lucide-react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("insight");

  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    handleGenerate();
  }, []);

  const handleGenerate = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await ragApi.insights(workspaceId);
      setInsights(result);
    } catch (e: any) {
      setError(e.message || t("generateFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-text">{t("title")}</h1>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-accent-dark disabled:opacity-50"
        >
          {loading ? t("analyzing") : t("generate")}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-600">{error}</div>
      )}

      {!insights && !loading && !error && (
        <div className="py-20 text-center text-text-secondary">
          <div className="mb-4 text-5xl">🔍</div>
          <p className="text-lg font-medium">{t("aiInsight")}</p>
          <p className="mt-2 text-sm">{t("aiInsightDesc")}</p>
        </div>
      )}

      {insights && (
        <div className="flex flex-col gap-5">
          {/* Themes */}
          {insights.themes.length > 0 && (
            <section className="rounded-card bg-surface p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-text-secondary">{t("themes")}</h2>
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
              <h2 className="mb-3 text-sm font-semibold text-text-secondary">{t("trends")}</h2>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-text">
                {insights.trends}
              </p>
            </section>
          )}

          {/* Unexplored */}
          {insights.unexplored.length > 0 && (
            <section className="rounded-card bg-surface p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-text-secondary">{t("unexplored")}</h2>
              <ul className="flex flex-col gap-2">
                {insights.unexplored.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text">
                    <Lightbulb size={16} className="mt-0.5 text-yellow-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Suggestions */}
          {insights.suggestions.length > 0 && (
            <section className="rounded-card bg-surface p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-text-secondary">{t("suggestions")}</h2>
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

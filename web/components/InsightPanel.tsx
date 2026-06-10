"use client";

import { Lightbulb } from "lucide-react";
import useSWR from "swr";
import { insightApi } from "@/lib/api";
import { useTranslations } from "next-intl";

interface InsightPanelProps {
  chatId: string;
}

export function InsightPanel({ chatId }: InsightPanelProps) {
  const t = useTranslations("insight");
  const { data: insights } = useSWR(
    chatId ? ["insights", chatId] : null,
    () => insightApi.list(chatId, false),
    { refreshInterval: 10000 },
  );

  if (!insights || insights.length === 0) return null;

  return (
    <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
      <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
        <Lightbulb className="h-4 w-4" />
        <span className="font-medium">{t("crossBranchInsights", { count: insights.length })}</span>
      </div>
      <div className="mt-2 space-y-1">
        {insights.map((insight) => (
          <p key={insight.id} className="pl-6 text-xs text-gray-500">
            {insight.content}
          </p>
        ))}
      </div>
    </div>
  );
}

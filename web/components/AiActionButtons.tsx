"use client";

import { useState } from "react";
import { aiApi } from "@/lib/api";
import { toast } from "@/lib/toast";

interface AiActionButtonsProps {
  content: string;
  onPolish: (text: string) => void;
  onSupplement: (text: string) => void;
  onTitle: (title: string) => void;
  onKeywords: (keywords: string[]) => void;
}

export function AiActionButtons({
  content,
  onPolish,
  onSupplement,
  onTitle,
  onKeywords,
}: AiActionButtonsProps) {
  const [loading, setLoading] = useState<string | null>(null);

  const handle = async (action: "polish" | "supplement" | "title" | "keywords") => {
    if (!content.trim()) {
      toast("请先输入内容", "error");
      return;
    }
    setLoading(action);
    try {
      if (action === "polish") {
        const res = await aiApi.polish(content);
        onPolish(res.text);
        toast("AI润色完成", "success");
      } else if (action === "supplement") {
        const res = await aiApi.supplement(content);
        onSupplement(res.text);
        toast("AI补充完成", "success");
      } else if (action === "title") {
        const res = await aiApi.generateTitle(content);
        onTitle(res.title);
        toast("标题已生成", "success");
      } else if (action === "keywords") {
        const res = await aiApi.extractKeywords(content);
        onKeywords(res.keywords);
        toast("关键词已提取", "success");
      }
    } catch (e: any) {
      toast("AI处理失败: " + e.message, "error");
    } finally {
      setLoading(null);
    }
  };

  const btn = (action: "polish" | "supplement" | "title" | "keywords", label: string) => (
    <button
      key={action}
      onClick={() => handle(action)}
      disabled={!!loading}
      className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary-dark disabled:opacity-50"
    >
      {loading === action
        ? { polish: "润色中...", supplement: "补充中...", title: "生成中...", keywords: "提取中..." }[action]
        : label}
    </button>
  );

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {btn("polish", "AI 润色")}
      {btn("supplement", "AI 补充")}
      {btn("title", "AI 提炼标题")}
      {btn("keywords", "AI 提取关键词")}
    </div>
  );
}

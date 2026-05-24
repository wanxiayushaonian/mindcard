"use client";

import { useState } from "react";
import { aiApi } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Wand2, Plus, Tag, Heading } from "lucide-react";

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

  const actions: { key: "polish" | "supplement" | "title" | "keywords"; label: string; loadingLabel: string; icon: React.ReactNode }[] = [
    { key: "polish", label: "AI 润色", loadingLabel: "润色中...", icon: <Wand2 size={14} /> },
    { key: "supplement", label: "AI 补充", loadingLabel: "补充中...", icon: <Plus size={14} /> },
    { key: "title", label: "AI 提炼标题", loadingLabel: "生成中...", icon: <Heading size={14} /> },
    { key: "keywords", label: "AI 提取关键词", loadingLabel: "提取中...", icon: <Tag size={14} /> },
  ];

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {actions.map((a) => (
        <button
          key={a.key}
          onClick={() => handle(a.key)}
          disabled={!!loading}
          className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary-dark disabled:opacity-50"
        >
          {loading === a.key ? a.loadingLabel : <>{a.icon} {a.label}</>}
        </button>
      ))}
    </div>
  );
}

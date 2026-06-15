"use client";

import { useState } from "react";
import { aiApi } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Wand2, Plus, Tag, Heading } from "lucide-react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("chat");
  const tc = useTranslations("card");
  const [loading, setLoading] = useState<string | null>(null);

  const handle = async (action: "polish" | "supplement" | "title" | "keywords") => {
    if (!content.trim()) {
      toast(tc("noSelection"), "error");
      return;
    }
    setLoading(action);
    try {
      if (action === "polish") {
        const res = await aiApi.polish(content);
        onPolish(res.text);
      } else if (action === "supplement") {
        const res = await aiApi.supplement(content);
        onSupplement(res.text);
      } else if (action === "title") {
        const res = await aiApi.generateTitle(content);
        onTitle(res.title);
      } else if (action === "keywords") {
        const res = await aiApi.extractKeywords(content);
        onKeywords(res.keywords);
      }
    } catch (e: any) {
      toast(t("aiProcessFailed", { error: e.message }), "error");
    } finally {
      setLoading(null);
    }
  };

  const actions: { key: "polish" | "supplement" | "title" | "keywords"; label: string; loadingLabel: string; icon: React.ReactNode }[] = [
    { key: "polish", label: tc("aiPolish"), loadingLabel: tc("aiPolishing"), icon: <Wand2 size={14} /> },
    { key: "supplement", label: tc("aiSupplement"), loadingLabel: tc("aiSupplementing"), icon: <Plus size={14} /> },
    { key: "title", label: tc("aiExtractTitle"), loadingLabel: tc("aiGenerating"), icon: <Heading size={14} /> },
    { key: "keywords", label: tc("aiExtractKeywords"), loadingLabel: tc("aiExtracting"), icon: <Tag size={14} /> },
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

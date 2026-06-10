"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { cardApi, aiApi } from "@/lib/api";
import { MarkdownContent } from "@/components/MarkdownContent";
import { usePanelStore } from "@/lib/workspace-layout-store";
import { toast } from "@/lib/toast";
import { FileText, Eye, PenLine, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

interface EditorPanelProps {
  workspaceId: string;
}

export function EditorPanel({ workspaceId }: EditorPanelProps) {
  const t = useTranslations("editor");
  const tc = useTranslations("card");
  const { editorContent, setEditorContent } = usePanelStore();
  const [mode, setMode] = useState<"edit" | "preview" | "split">("split");
  const [precipitating, setPrecipitating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);

  const handlePrecipitateSelection = useCallback(async () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selected = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd).trim();
    if (!selected) {
      toast(tc("noSelection"), "info");
      return;
    }
    setPrecipitating(true);
    try {
      const [titleRes, kwRes] = await Promise.allSettled([
        aiApi.generateTitle(selected),
        aiApi.extractKeywords(selected),
      ]);
      const title = titleRes.status === "fulfilled" ? titleRes.value.title : selected.slice(0, 50);
      const keywords = kwRes.status === "fulfilled" ? kwRes.value.keywords : [];
      await cardApi.create({
        local_id: "card_" + Date.now(),
        workspace_id: workspaceId,
        title,
        content: selected,
        keywords,
      });
      window.dispatchEvent(new CustomEvent("card-precipitated"));
      toast(tc("precipitated", { title: title || tc("unnamedCard") }), "success");
    } catch (e: any) {
      toast(tc("precipitateFailed", { error: e.message }), "error");
    } finally {
      setPrecipitating(false);
    }
  }, [workspaceId, tc]);

  const charCount = editorContent.length;
  const lineCount = editorContent ? editorContent.split("\n").length : 0;

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <FileText size={14} className="text-text-secondary" />
          <span className="text-xs font-medium text-text">{t("title")}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode(mode === "edit" ? "split" : "edit")}
            className={`rounded p-1 transition ${mode === "edit" ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-gray-100"}`}
            title={t("editMode")}
          >
            <PenLine size={13} />
          </button>
          <button
            onClick={() => setMode(mode === "preview" ? "split" : "preview")}
            className={`rounded p-1 transition ${mode === "preview" ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-gray-100"}`}
            title={t("previewMode")}
          >
            <Eye size={13} />
          </button>
          <button
            onClick={handlePrecipitateSelection}
            disabled={precipitating}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-text-secondary transition hover:bg-gray-100 disabled:opacity-50"
            title={t("precipitateTooltip")}
          >
            <Sparkles size={11} />
            {t("precipitate")}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {(mode === "edit" || mode === "split") && (
          <div className={`${mode === "split" ? "w-1/2 border-r border-border" : "w-full"} flex flex-col`}>
            <textarea
              ref={textareaRef}
              value={editorContent}
              onChange={(e) => setEditorContent(e.target.value)}
              onKeyDown={(e) => {
                // Tab key inserts tab
                if (e.key === "Tab") {
                  e.preventDefault();
                  const textarea = e.currentTarget;
                  const start = textarea.selectionStart;
                  const end = textarea.selectionEnd;
                  const next = editorContent.substring(0, start) + "  " + editorContent.substring(end);
                  setEditorContent(next);
                  requestAnimationFrame(() => {
                    textarea.selectionStart = textarea.selectionEnd = start + 2;
                  });
                }
              }}
              onCompositionStart={() => { isComposingRef.current = true; }}
              onCompositionEnd={() => { setTimeout(() => { isComposingRef.current = false; }, 0); }}
              placeholder={t("placeholder")}
              className="flex-1 resize-none bg-transparent p-3 font-mono text-[13px] leading-relaxed text-foreground outline-none placeholder:text-text-secondary/50"
              spellCheck={false}
            />
          </div>
        )}
        {(mode === "preview" || mode === "split") && (
          <div className={`${mode === "split" ? "w-1/2" : "w-full"} overflow-y-auto p-3`}>
            {editorContent ? (
              <div className="text-[13px] leading-relaxed">
                <MarkdownContent content={editorContent} />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-text-secondary/50">
                {t("previewArea")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border px-3 py-1.5 text-[10px] text-text-secondary">
        {t("charLineCount", { chars: charCount, lines: lineCount })}
      </div>
    </div>
  );
}

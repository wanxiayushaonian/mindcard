"use client";

import { useState, useRef, useCallback } from "react";
import { cardApi, aiApi } from "@/lib/api";
import { RichEditor, type RichEditorHandle } from "@/components/editor";
import { usePanelStore } from "@/lib/workspace-layout-store";
import { toast } from "@/lib/toast";
import { FileText, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

interface EditorPanelProps {
  workspaceId: string;
}

export function EditorPanel({ workspaceId }: EditorPanelProps) {
  const t = useTranslations("editor");
  const tc = useTranslations("card");
  const { editorContent, setEditorContent, chatContext } = usePanelStore();
  const [precipitating, setPrecipitating] = useState(false);
  const editorRef = useRef<RichEditorHandle>(null);

  const handlePrecipitateSelection = useCallback(async () => {
    const selected = editorRef.current?.getSelection()?.trim() || "";
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
        // Source-mount the card under the conversation that is currently open
        // (VISION 理念4) so it hangs where the idea was born, not where the
        // embedding classifier thinks it fits.
        chat_id: chatContext.forkId || chatContext.chatId || undefined,
      });
      window.dispatchEvent(new CustomEvent("card-precipitated"));
      toast(tc("precipitated", { title: title || tc("unnamedCard") }), "success");
    } catch (e: any) {
      toast(tc("precipitateFailed", { error: e.message }), "error");
    } finally {
      setPrecipitating(false);
    }
  }, [workspaceId, tc, chatContext]);

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
        <RichEditor
          ref={editorRef}
          content={editorContent}
          onChange={setEditorContent}
          workspaceId={workspaceId}
          placeholder={t("placeholder")}
          className="flex-1 border-0"
          showToolbar
          minHeight="100%"
        />
      </div>

      {/* Footer */}
      <div className="border-t border-border px-3 py-1.5 text-[10px] text-text-secondary">
        {t("charLineCount", { chars: charCount, lines: lineCount })}
      </div>
    </div>
  );
}

"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { cardApi, aiApi } from "@/lib/api";
import { MarkdownContent } from "@/components/MarkdownContent";
import { usePanelStore } from "@/lib/workspace-layout-store";
import { toast } from "@/lib/toast";
import { FileText, Eye, PenLine, Sparkles } from "lucide-react";

interface EditorPanelProps {
  workspaceId: string;
}

export function EditorPanel({ workspaceId }: EditorPanelProps) {
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
      toast("请先选中要沉淀的文本", "info");
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
      toast("已沉淀为卡片: " + (title || "未命名"), "success");
    } catch (e: any) {
      toast("沉淀失败: " + e.message, "error");
    } finally {
      setPrecipitating(false);
    }
  }, [workspaceId]);

  const charCount = editorContent.length;
  const lineCount = editorContent ? editorContent.split("\n").length : 0;

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <FileText size={14} className="text-text-secondary" />
          <span className="text-xs font-medium text-text">编辑器</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode(mode === "edit" ? "split" : "edit")}
            className={`rounded p-1 transition ${mode === "edit" ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-gray-100"}`}
            title="编辑模式"
          >
            <PenLine size={13} />
          </button>
          <button
            onClick={() => setMode(mode === "preview" ? "split" : "preview")}
            className={`rounded p-1 transition ${mode === "preview" ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-gray-100"}`}
            title="预览模式"
          >
            <Eye size={13} />
          </button>
          <button
            onClick={handlePrecipitateSelection}
            disabled={precipitating}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-text-secondary transition hover:bg-gray-100 disabled:opacity-50"
            title="沉淀选中文本为卡片"
          >
            <Sparkles size={11} />
            沉淀
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
              placeholder="在此编辑内容...&#10;&#10;支持 Markdown 格式&#10;选中文本后点击「沉淀」可创建为卡片"
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
                预览区域
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border px-3 py-1.5 text-[10px] text-text-secondary">
        {charCount} 字符 · {lineCount} 行
      </div>
    </div>
  );
}

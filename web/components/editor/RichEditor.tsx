"use client";

import { forwardRef, useImperativeHandle, useCallback, useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TiptapLink from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Markdown, type MarkdownStorage } from "tiptap-markdown";
import { common, createLowlight } from "lowlight";
import { WikiLink } from "./WikiLink";
import { EditorToolbar } from "./EditorToolbar";
import { cn } from "@/lib/utils";
import "./editor-styles.css";

const lowlight = createLowlight(common);

// Helper to get markdown content from editor
function getMarkdown(ed: any): string {
  const storage = ed.storage as { markdown?: MarkdownStorage };
  return storage.markdown?.getMarkdown() ?? "";
}

export interface RichEditorHandle {
  getContent: () => string;
  setContent: (md: string) => void;
  focus: () => void;
  getSelection: () => string;
  getHTML: () => string;
}

interface RichEditorProps {
  content: string;
  onChange: (content: string) => void;
  workspaceId?: string;
  placeholder?: string;
  className?: string;
  showToolbar?: boolean;
  minHeight?: string;
  readOnly?: boolean;
}

export const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(
  (
    {
      content,
      onChange,
      workspaceId = "",
      placeholder = "开始输入...",
      className,
      showToolbar = true,
      minHeight = "200px",
      readOnly = false,
    },
    ref
  ) => {
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    // Debounce timer for content sync
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          codeBlock: false, // replaced by CodeBlockLowlight
        }),
        Placeholder.configure({ placeholder }),
        TiptapLink.configure({
          openOnClick: false,
          HTMLAttributes: { class: "editor-link" },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        CodeBlockLowlight.configure({ lowlight }),
        Highlight.configure({ multicolor: false }),
        Typography,
        Image.configure({ inline: false, allowBase64: true }),
        TableKit.configure({ table: { resizable: true } }),
        WikiLink.configure({ workspaceId }),
        Markdown.configure({
          html: false,
          transformPastedText: true,
          transformCopiedText: true,
          bulletListMarker: "-",
          linkify: true,
          breaks: false,
        }),
      ],
      content,
      editable: !readOnly,
      editorProps: {
        attributes: {
          class: "tiptap",
          style: `min-height: ${minHeight}`,
        },
      },
      onUpdate: ({ editor: ed }) => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          const md = getMarkdown(ed);
          onChangeRef.current(md);
        }, 200);
      },
    });

    // Sync external content changes into the editor
    const lastExternalContent = useRef(content);
    useEffect(() => {
      if (!editor) return;
      if (content === lastExternalContent.current) return;
      lastExternalContent.current = content;
      // Only update if the editor's content actually differs
      const currentMd = getMarkdown(editor);
      if (currentMd !== content) {
        editor.commands.setContent(content, { emitUpdate: false });
      }
    }, [content, editor]);

    // Toggle read-only mode
    useEffect(() => {
      if (!editor) return;
      editor.setEditable(!readOnly);
    }, [editor, readOnly]);

    // Expose imperative methods
    useImperativeHandle(ref, () => ({
      getContent: () => {
        if (!editor) return content;
        return getMarkdown(editor);
      },
      setContent: (md: string) => {
        if (!editor) return;
        lastExternalContent.current = md;
        editor.commands.setContent(md, { emitUpdate: false });
      },
      focus: () => {
        editor?.commands.focus();
      },
      getSelection: () => {
        if (!editor) return "";
        const { from, to } = editor.state.selection;
        return editor.state.doc.textBetween(from, to, " ");
      },
      getHTML: () => {
        if (!editor) return "";
        return editor.getHTML();
      },
    }));

    return (
      <div className={cn("flex flex-col overflow-hidden rounded-md", className)}>
        {showToolbar && <EditorToolbar editor={editor} />}
        <div className="flex-1 overflow-y-auto">
          <EditorContent editor={editor} />
        </div>
      </div>
    );
  }
);

RichEditor.displayName = "RichEditor";

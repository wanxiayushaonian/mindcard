"use client";

import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Link,
  Minus,
  Undo2,
  Redo2,
  Braces,
  Highlighter,
  ImageIcon,
  TableIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

interface EditorToolbarProps {
  editor: Editor | null;
}

interface ToolbarButtonProps {
  icon: React.ReactNode;
  title: string;
  isActive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function ToolbarButton({ icon, title, isActive, disabled, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded p-1 transition hover:bg-[var(--color-gray-100)] disabled:opacity-30 ${
        isActive ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]" : "text-[var(--color-text-secondary)]"
      }`}
    >
      {icon}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-4 w-px bg-[var(--color-border)]" />;
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  const t = useTranslations("editor.toolbar");

  if (!editor) return null;

  const insertImage = () => {
    const url = window.prompt(t("imageUrlPrompt"));
    if (!url) return;
    editor.chain().focus().setImage({ src: url }).run();
  };

  const insertTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  const setLink = () => {
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("URL", previousUrl);
    if (url === null) return; // cancelled
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-[var(--color-border)] px-2 py-1">
      {/* Inline formatting */}
      <ToolbarButton
        icon={<Bold size={14} />}
        title={t("bold")}
        isActive={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        icon={<Italic size={14} />}
        title={t("italic")}
        isActive={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        icon={<Strikethrough size={14} />}
        title={t("strikethrough")}
        isActive={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <ToolbarButton
        icon={<Code size={14} />}
        title={t("code")}
        isActive={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <ToolbarButton
        icon={<Braces size={14} />}
        title={t("codeBlock")}
        isActive={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />

      <ToolbarButton
        icon={<Highlighter size={14} />}
        title={t("highlight")}
        isActive={editor.isActive("highlight")}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
      />

      <Divider />

      {/* Headings */}
      <ToolbarButton
        icon={<Heading1 size={14} />}
        title={t("heading1")}
        isActive={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <ToolbarButton
        icon={<Heading2 size={14} />}
        title={t("heading2")}
        isActive={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <ToolbarButton
        icon={<Heading3 size={14} />}
        title={t("heading3")}
        isActive={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      />

      <Divider />

      {/* Lists */}
      <ToolbarButton
        icon={<List size={14} />}
        title={t("bulletList")}
        isActive={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        icon={<ListOrdered size={14} />}
        title={t("orderedList")}
        isActive={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarButton
        icon={<ListChecks size={14} />}
        title={t("taskList")}
        isActive={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      />

      <Divider />

      {/* Block elements */}
      <ToolbarButton
        icon={<Quote size={14} />}
        title={t("blockquote")}
        isActive={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <ToolbarButton
        icon={<Link size={14} />}
        title={t("link")}
        isActive={editor.isActive("link")}
        onClick={setLink}
      />
      <ToolbarButton
        icon={<Minus size={14} />}
        title={t("horizontalRule")}
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      />
      <ToolbarButton
        icon={<ImageIcon size={14} />}
        title={t("image")}
        onClick={insertImage}
      />
      <ToolbarButton
        icon={<TableIcon size={14} />}
        title={t("table")}
        onClick={insertTable}
      />

      <Divider />

      {/* History */}
      <ToolbarButton
        icon={<Undo2 size={14} />}
        title={t("undo")}
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      />
      <ToolbarButton
        icon={<Redo2 size={14} />}
        title={t("redo")}
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      />
    </div>
  );
}

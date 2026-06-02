import { create } from "zustand";

interface PanelState {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  showAiChat: boolean;
  editorContent: string;
  toggleLeft: () => void;
  toggleRight: () => void;
  setShowAiChat: (show: boolean) => void;
  setEditorContent: (content: string) => void;
  appendToEditor: (content: string) => void;
}

const STORAGE_KEY = "mindcard-editor-content";

function loadEditorContent(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STORAGE_KEY) || "";
}

function saveEditorContent(content: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, content);
}

export const usePanelStore = create<PanelState>((set, get) => ({
  leftCollapsed: false,
  rightCollapsed: false,
  showAiChat: true,
  editorContent: "",
  toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),
  setShowAiChat: (show) => set({ showAiChat: show }),
  setEditorContent: (content) => {
    saveEditorContent(content);
    set({ editorContent: content });
  },
  appendToEditor: (content) => {
    const current = get().editorContent || loadEditorContent();
    const separator = current ? "\n\n---\n\n" : "";
    const next = current + separator + content;
    saveEditorContent(next);
    set({ editorContent: next });
    // Auto-collapse left if editor not visible
    const { leftCollapsed, rightCollapsed } = get();
    if (!leftCollapsed && !rightCollapsed) {
      set({ leftCollapsed: true });
    }
  },
}));

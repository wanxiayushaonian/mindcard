import { create } from "zustand";

interface PanelState {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  showAiChat: boolean;
  editorContent: string;
  _hydrated: boolean;
  toggleLeft: () => void;
  toggleRight: () => void;
  setShowAiChat: (show: boolean) => void;
  setEditorContent: (content: string) => void;
  appendToEditor: (content: string) => void;
  hydrate: () => void;
}

// --- localStorage helpers (SSR-safe) ---

function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded — silently ignore
  }
}

const STORAGE_KEYS = {
  editorContent: "mindcard-editor-content",
  leftCollapsed: "mindcard-left-collapsed",
  rightCollapsed: "mindcard-right-collapsed",
  showAiChat: "mindcard-show-ai-chat",
} as const;

function loadEditorContent(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STORAGE_KEYS.editorContent) || "";
}

function saveEditorContent(content: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEYS.editorContent, content);
}

// Always use the same defaults on server and client to avoid hydration mismatch.
// The `hydrate()` function is called once in a useEffect to load persisted state.
export const usePanelStore = create<PanelState>((set, get) => ({
  leftCollapsed: false,
  rightCollapsed: false,
  showAiChat: true,
  editorContent: "",
  _hydrated: false,

  hydrate: () => {
    if (get()._hydrated) return;
    set({
      leftCollapsed: loadJSON(STORAGE_KEYS.leftCollapsed, false),
      rightCollapsed: loadJSON(STORAGE_KEYS.rightCollapsed, false),
      showAiChat: loadJSON(STORAGE_KEYS.showAiChat, true),
      editorContent: loadEditorContent(),
      _hydrated: true,
    });
  },

  toggleLeft: () =>
    set((s) => {
      const next = !s.leftCollapsed;
      saveJSON(STORAGE_KEYS.leftCollapsed, next);
      return { leftCollapsed: next };
    }),

  toggleRight: () =>
    set((s) => {
      const next = !s.rightCollapsed;
      saveJSON(STORAGE_KEYS.rightCollapsed, next);
      return { rightCollapsed: next };
    }),

  setShowAiChat: (show) => {
    saveJSON(STORAGE_KEYS.showAiChat, show);
    set({ showAiChat: show });
  },

  setEditorContent: (content) => {
    saveEditorContent(content);
    set({ editorContent: content });
  },

  appendToEditor: (content) => {
    const current = get().editorContent;
    const separator = current ? "\n\n---\n\n" : "";
    const next = current + separator + content;
    saveEditorContent(next);
    set({ editorContent: next });

    // Auto-collapse left panel ONLY if editor is not yet visible.
    const { leftCollapsed, rightCollapsed } = get();
    if (!leftCollapsed && !rightCollapsed) {
      saveJSON(STORAGE_KEYS.leftCollapsed, true);
      set({ leftCollapsed: true });
    }
  },
}));

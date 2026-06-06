import { describe, it, expect, beforeEach } from "vitest";
import { usePanelStore } from "@/lib/workspace-layout-store";

beforeEach(() => {
  localStorage.clear();
  usePanelStore.setState({
    leftCollapsed: false,
    rightCollapsed: false,
    showAiChat: true,
    editorContent: "",
    _hydrated: false,
  });
});

describe("usePanelStore", () => {
  describe("toggleLeft", () => {
    it("toggles leftCollapsed from false to true", () => {
      usePanelStore.getState().toggleLeft();
      expect(usePanelStore.getState().leftCollapsed).toBe(true);
    });

    it("toggles leftCollapsed back to false", () => {
      usePanelStore.getState().toggleLeft();
      usePanelStore.getState().toggleLeft();
      expect(usePanelStore.getState().leftCollapsed).toBe(false);
    });

    it("persists to localStorage", () => {
      usePanelStore.getState().toggleLeft();
      expect(JSON.parse(localStorage.getItem("mindcard-left-collapsed")!)).toBe(true);
    });
  });

  describe("toggleRight", () => {
    it("toggles rightCollapsed", () => {
      usePanelStore.getState().toggleRight();
      expect(usePanelStore.getState().rightCollapsed).toBe(true);
    });
  });

  describe("setShowAiChat", () => {
    it("sets showAiChat and persists", () => {
      usePanelStore.getState().setShowAiChat(false);
      expect(usePanelStore.getState().showAiChat).toBe(false);
      expect(JSON.parse(localStorage.getItem("mindcard-show-ai-chat")!)).toBe(false);
    });
  });

  describe("setEditorContent", () => {
    it("sets content and persists", () => {
      usePanelStore.getState().setEditorContent("hello");
      expect(usePanelStore.getState().editorContent).toBe("hello");
      expect(localStorage.getItem("mindcard-editor-content")).toBe("hello");
    });
  });

  describe("appendToEditor", () => {
    it("appends content with separator when editor has content", () => {
      usePanelStore.setState({ editorContent: "existing" });
      usePanelStore.getState().appendToEditor("new");
      expect(usePanelStore.getState().editorContent).toBe("existing\n\n---\n\nnew");
    });

    it("appends without separator when editor is empty", () => {
      usePanelStore.setState({ editorContent: "" });
      usePanelStore.getState().appendToEditor("new");
      expect(usePanelStore.getState().editorContent).toBe("new");
    });

    it("auto-collapses left panel when both panels visible", () => {
      usePanelStore.setState({ leftCollapsed: false, rightCollapsed: false });
      usePanelStore.getState().appendToEditor("content");
      expect(usePanelStore.getState().leftCollapsed).toBe(true);
    });

    it("does not collapse left panel when already collapsed", () => {
      usePanelStore.setState({ leftCollapsed: true, rightCollapsed: false });
      usePanelStore.getState().appendToEditor("content");
      expect(usePanelStore.getState().leftCollapsed).toBe(true);
    });
  });

  describe("hydrate", () => {
    it("loads persisted state from localStorage", () => {
      localStorage.setItem("mindcard-left-collapsed", "true");
      localStorage.setItem("mindcard-right-collapsed", "true");
      localStorage.setItem("mindcard-show-ai-chat", "false");
      localStorage.setItem("mindcard-editor-content", '"saved content"');

      usePanelStore.getState().hydrate();

      expect(usePanelStore.getState().leftCollapsed).toBe(true);
      expect(usePanelStore.getState().rightCollapsed).toBe(true);
      expect(usePanelStore.getState().showAiChat).toBe(false);
      expect(usePanelStore.getState()._hydrated).toBe(true);
    });

    it("only hydrates once", () => {
      localStorage.setItem("mindcard-left-collapsed", "true");
      usePanelStore.getState().hydrate();

      localStorage.setItem("mindcard-left-collapsed", "false");
      usePanelStore.getState().hydrate();

      // Second hydrate should be a no-op
      expect(usePanelStore.getState().leftCollapsed).toBe(true);
    });
  });
});

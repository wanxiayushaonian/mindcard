import { Node, mergeAttributes } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { SuggestionPluginKey } from "@tiptap/suggestion";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import type { Card } from "@/lib/api";

export interface WikiLinkOptions {
  HTMLAttributes: Record<string, unknown>;
  workspaceId: string;
  suggestion: Partial<SuggestionOptions>;
}

// Extend Commands interface
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wikiLink: {
      insertWikiLink: (attrs: { cardId: string; label: string }) => ReturnType;
    };
  }
}

export const WikiLink = Node.create<WikiLinkOptions>({
  name: "wikiLink",

  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      workspaceId: "",
      suggestion: {
        char: "[[",
        allowSpaces: true,
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const label = node.attrs.label || "Untitled";
          state.write(`[[${label}]]`);
        },
      },
    };
  },

  addAttributes() {
    return {
      cardId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-card-id"),
        renderHTML: (attrs: Record<string, unknown>) => ({
          "data-card-id": attrs.cardId,
        }),
      },
      label: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-label"),
        renderHTML: (attrs: Record<string, unknown>) => ({
          "data-label": attrs.label,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="wiki-link"]' }];
  },

  renderHTML({
    HTMLAttributes,
  }: {
    HTMLAttributes: Record<string, unknown>;
  }) {
    return [
      "span",
      mergeAttributes(
        { "data-type": "wiki-link", class: "wiki-link" },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      `[[${HTMLAttributes.label}]]`,
    ];
  },

  renderText({ node }: { node: any }) {
    return `[[${node.attrs.label}]]`;
  },

  addCommands() {
    return {
      insertWikiLink:
        (attrs: { cardId: string; label: string }) =>
        ({ commands }: { commands: any }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          });
        },
    };
  },

  addProseMirrorPlugins() {
    const workspaceId = this.options.workspaceId;

    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        items: async ({ query }: { query: string }) => {
          try {
            const { cardApi } = await import("@/lib/api");
            const res = await cardApi.list(workspaceId, { limit: 100, sort_by: "updated_at", order: "desc" });
            const cards = res.items;
            if (!query.trim()) return cards;
            const q = query.toLowerCase();
            return cards.filter(
              (c) =>
                c.title.toLowerCase().includes(q) ||
                c.keywords.some((k) => k.toLowerCase().includes(q))
            );
          } catch {
            return [];
          }
        },
        command: ({ editor, range, props }) => {
          // Fallback — should not normally be called since React component handles insertion directly
          const card = props as any;
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({
              type: "wikiLink",
              attrs: { cardId: card?.id ?? "", label: card?.title || "Untitled" },
            })
            .run();
        },
        render: () => {
          let component: ReactRenderer | null = null;
          let popup: TippyInstance[] | null = null;

          return {
            onStart: (props: SuggestionProps) => {
              component = new ReactRenderer(WikiLinkPopupReact, {
                props: {
                  ...props,
                  workspaceId,
                },
                editor: props.editor,
              });

              if (!props.clientRect) return;

              popup = tippy("body", {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
              });
            },

            onUpdate(props: SuggestionProps) {
              component?.updateProps({
                ...props,
                workspaceId,
              });

              if (!props.clientRect) return;

              popup?.[0]?.setProps({
                getReferenceClientRect: props.clientRect as () => DOMRect,
              });
            },

            onKeyDown(props: { event: KeyboardEvent }) {
              if (props.event.key === "Escape") {
                popup?.[0]?.hide();
                return true;
              }
              return (component?.ref as any)?.onKeyDown?.(props) ?? false;
            },

            onExit() {
              popup?.[0]?.destroy();
              component?.destroy();
            },
          };
        },
      }),
    ];
  },
});

// React wrapper for the suggestion popup
import {
  useCallback,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { WikiLinkPopup } from "./WikiLinkPopup";

interface WikiLinkPopupReactProps {
  items: Card[];
  command: (item: Card) => void;
  editor: any;
  query: string;
  workspaceId: string;
}

const WikiLinkPopupReact = forwardRef<any, WikiLinkPopupReactProps>(
  ({ command, items, editor, query: initialQuery }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const cards = items || [];

    useEffect(() => {
      setSelectedIndex(0);
    }, [initialQuery]);

    const selectCard = useCallback(
      (card: Card) => {
        const pluginState = SuggestionPluginKey.getState(editor.state);
        const range = pluginState?.range;
        if (range) {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({
              type: "wikiLink",
              attrs: { cardId: card.id, label: card.title || "Untitled" },
            })
            .run();
        }
      },
      [editor]
    );

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, cards.length - 1));
          return true;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return true;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          if (cards[selectedIndex]) {
            selectCard(cards[selectedIndex]);
          }
          return true;
        }
        return false;
      },
    }));

    return (
      <WikiLinkPopup
        query={initialQuery}
        cards={cards}
        loading={false}
        selectedIndex={selectedIndex}
        onSelect={selectCard}
        onSelectedIndexChange={setSelectedIndex}
      />
    );
  }
);

WikiLinkPopupReact.displayName = "WikiLinkPopupReact";

"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { chatApi, aiApi, cardApi, workspaceApi, topologyApi, type RAGResponse, type WebSearchResult, type ChatSession, type ChatPathNode, type TopologyNode } from "@/lib/api";
import { UnifiedWSClient, createWSUrl, type StreamEvent, type ContextDebugData, type ToolCall } from "@/lib/unified-ws";
import { ModelSelector } from "@/components/ModelSelector";
import { toast } from "@/lib/toast";
import AssistantResponse from "@/components/AssistantResponse";
import { ConfirmModal } from "@/components/ConfirmModal";
import { ForkDivider } from "@/components/ForkDivider";
import { ForkBreadcrumb } from "@/components/ForkBreadcrumb";
import { ContextDebugPanel } from "@/components/ContextDebugPanel";
import { MemoryPanel } from "@/components/MemoryPanel";
import { ThinkingBlock } from "@/components/ThinkingBlock";
import { ToolCallsBlock } from "@/components/ToolCallsBlock";
import { CardMentionPopup } from "@/components/CardMentionPopup";
import { usePanelStore } from "@/lib/workspace-layout-store";
import { useTranslations, useLocale } from "next-intl";
import { X, History, MessageSquarePlus, Send, Square, ArrowLeft, Trash2, Globe, ChevronDown, ChevronUp, GitBranch, Copy, Sparkles, Loader2, Brain } from "lucide-react";
import { formatTimeShort } from "@/lib/format";

const FORK_PREFIX = "__FORK__";

interface ForkMetaEntry {
  title: string;
  nodeId: string;
  collapsed: boolean;
  completed: boolean;
  msgId?: string;
  auto?: boolean;
  depth?: number;
  messageCount?: number;
  profile?: string;
}

function encodeForkContent(meta: Omit<ForkMetaEntry, "msgId">): string {
  return FORK_PREFIX + JSON.stringify(meta);
}

const FORK_PROFILES_UI = [
  { key: "deep_dive", labelKey: "deepDive" as const, descKey: "deepDiveDesc" as const },
  { key: "explore", labelKey: "explore" as const, descKey: "exploreDesc" as const },
  { key: "summarize", labelKey: "summarize" as const, descKey: "summarizeDesc" as const },
  { key: "challenge", labelKey: "challenge" as const, descKey: "challengeDesc" as const },
];

function decodeForkContent(content: string): Omit<ForkMetaEntry, "msgId"> | null {
  if (!content.startsWith(FORK_PREFIX)) return null;
  try {
    return JSON.parse(content.slice(FORK_PREFIX.length));
  } catch {
    return null;
  }
}

interface Message {
  role: "user" | "assistant" | "fork-divider";
  content: string;
  status?: "done" | "error";
  sources?: RAGResponse["source_cards"];
  webSearchResults?: WebSearchResult[];
  contextDebug?: ContextDebugData;
  thinking?: string;
  toolCalls?: ToolCall[];
  childChatId?: string;
  createdAt?: string;
  _isStreaming?: boolean;
  _isSearching?: boolean;
  _key?: string;
}

interface AiChatPanelProps {
  workspaceId: string;
  cardId?: string;
  onClose: () => void;
}

export function AiChatPanel({ workspaceId, cardId, onClose }: AiChatPanelProps) {
  const t = useTranslations('chat');
  const tCommon = useTranslations('common');
  const tCard = useTranslations('card');
  const tFork = useTranslations('fork');
  const locale = useLocale();
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatId, setChatIdRaw] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatSession[]>([]);
  const [mentionedCards, setMentionedCards] = useState<Array<{ cardId: string; title: string; color: string }>>([]);

  // Persist active chatId per workspace
  const chatStorageKey = `mindcard-active-chat-${workspaceId || "global"}`;
  const setChatId = (id: string | null) => {
    setChatIdRaw(id);
    if (id) {
      localStorage.setItem(chatStorageKey, id);
    } else {
      localStorage.removeItem(chatStorageKey);
    }
  };
  const [showHistory, setShowHistory] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const { mutate: swrMutate } = useSWRConfig();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(Math.max(el.scrollHeight, 28), 160);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > 160 ? "auto" : "hidden";
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    setCursorPosition(e.target.selectionStart ?? e.target.value.length);
    requestAnimationFrame(adjustTextareaHeight);
  }, [adjustTextareaHeight]);

  // Reset height when input is cleared programmatically (e.g. after sending)
  useEffect(() => {
    if (input === "" && textareaRef.current) {
      textareaRef.current.style.height = "28px";
      textareaRef.current.style.overflowY = "hidden";
    }
  }, [input]);
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null);
  const [deletePreview, setDeletePreview] = useState<{
    chat_title: string; messages: number; child_chats: number;
    node_title: string | null; node_will_archive: boolean;
  } | null>(null);

  // Fetch preview when delete target changes
  useEffect(() => {
    if (!deleteTarget) { setDeletePreview(null); return; }
    chatApi.deletePreview(deleteTarget.id).then(setDeletePreview).catch(() => setDeletePreview(null));
  }, [deleteTarget]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollTargetForkRef = useRef<string | null>(null);
  const activeStreamForkRef = useRef<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const wsClientRef = useRef<UnifiedWSClient | null>(null);
  const streamContentRef = useRef("");
  const webSearchResultsRef = useRef<WebSearchResult[] | undefined>(undefined);
  const sourceCardsRef = useRef<RAGResponse["source_cards"] | undefined>(undefined);
  const streamThinkingRef = useRef("");
  const streamToolCallsRef = useRef<ToolCall[]>([]);
  const streamContextDebugRef = useRef<ContextDebugData | undefined>(undefined);
  const [precipitatedBlocks, setPrecipitatedBlocks] = useState<Set<string>>(new Set());
  const precipitatedBlocksRef = useRef(precipitatedBlocks);
  precipitatedBlocksRef.current = precipitatedBlocks;
  const [precipitatingBlock, setPrecipitatingBlock] = useState<string | null>(null);
  const [webSearch, setWebSearch] = useState(false);
  const [expandedSearchResults, setExpandedSearchResults] = useState<Set<number>>(new Set());
  const [forkMode, setForkMode] = useState(false);
  const [isCreatingFork, setIsCreatingFork] = useState(false);
  const [forkPickerMsgIdx, setForkPickerMsgIdx] = useState<number | null>(null);
  const [forkMeta, setForkMeta] = useState<Record<string, ForkMetaEntry>>({});
  const [retrievalLevel, setRetrievalLevel] = useState<number | undefined>(undefined);
  const lastRagLevelRef = useRef<number | undefined>(undefined);
  const pendingForkRef = useRef<{ insertAt: number; syntheticId: string } | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const [expandedForks, setExpandedForks] = useState<Set<string>>(new Set());
  const [activeForkId, setActiveForkId] = useState<string | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const [chatPath, setChatPath] = useState<ChatPathNode[]>([]);
  const isComposingRef = useRef(false);
  const streamingForkIdRef = useRef<string | null>(null);
  const streamingChatIdRef = useRef<string | null>(null);
  const forkChildIdRef = useRef<string | null>(null);  // child chat to switch to after stream
  const loadChatRef = useRef<(id: string) => Promise<boolean>>(() => Promise.resolve(false));
  const forkMetaRef = useRef<Record<string, ForkMetaEntry>>({});

  const expandedForksRef = useRef<Set<string>>(new Set());
  // Sync wrapper: updates both state AND ref atomically
  const syncExpandedForks = useCallback((updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    const next = typeof updater === "function" ? updater(expandedForksRef.current) : updater;
    expandedForksRef.current = next;
    setExpandedForks(next);
  }, []);
  useEffect(() => { chatIdRef.current = chatId; }, [chatId]);
  // expandedForksRef is kept in sync by syncExpandedForks — no useEffect needed
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { forkMetaRef.current = forkMeta; }, [forkMeta]);

  const { data: workspace } = useSWR(
    workspaceId ? `workspace-${workspaceId}` : null,
    () => workspaceApi.get(workspaceId)
  );
  const canPrecipitate = workspace?.member_role && ["owner", "admin", "editor"].includes(workspace.member_role);

  const { data: topologyNodes } = useSWR(
    workspaceId ? `topology-${workspaceId}` : null,
    () => topologyApi.list(workspaceId)
  );

  useEffect(() => {
    if (scrollTargetForkRef.current) {
      const forkId = scrollTargetForkRef.current;
      scrollTargetForkRef.current = null;
      const elements = document.querySelectorAll(`[data-fork-child="${forkId}"]`);
      const last = elements[elements.length - 1] as HTMLElement | undefined;
      last?.scrollIntoView({ behavior: "smooth", block: "end" });
    } else if (activeStreamForkRef.current) {
      // Streaming inside a fork — follow the latest content; clear after streaming ends
      const forkId = activeStreamForkRef.current;
      if (!isStreaming) activeStreamForkRef.current = null;
      const elements = document.querySelectorAll(`[data-fork-child="${forkId}"]`);
      const last = elements[elements.length - 1] as HTMLElement | undefined;
      last?.scrollIntoView({ block: "end" });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isStreaming]);

  // Toggle fork expansion (for ForkDivider clicks)
  const toggleFork = useCallback((forkId: string) => {
    syncExpandedForks((prev) => {
      const next = new Set(prev);
      if (next.has(forkId)) {
        // Already expanded → collapse it and all deeper children
        const collapseDepth = forkMetaRef.current[forkId]?.depth ?? 0;
        next.delete(forkId);
        for (const [cid, m] of Object.entries(forkMetaRef.current)) {
          if ((m.depth ?? 0) > collapseDepth) {
            next.delete(cid);
          }
        }
        // Reset active fork if it was this fork or any descendant
        const activeId = activeChatIdRef.current;
        if (activeId) {
          const activeDepth = forkMetaRef.current[activeId]?.depth ?? 0;
          if (activeId === forkId || activeDepth > collapseDepth) {
            setActiveForkId(null);
            activeChatIdRef.current = null;
          }
        }
      } else {
        // Collapsed → expand it, collapse siblings and all deeper forks
        const meta = forkMetaRef.current[forkId];
        const depth = meta?.depth ?? 0;
        for (const [cid, m] of Object.entries(forkMetaRef.current)) {
          if (cid !== forkId && (m.depth ?? 0) >= depth) {
            next.delete(cid);
          }
        }
        next.add(forkId);
        // Also expand parent forks
        for (const [cid, m] of Object.entries(forkMetaRef.current)) {
          if (cid !== forkId && (m.depth ?? 0) < depth) {
            next.add(cid);
          }
        }
        setActiveForkId(forkId);
        activeChatIdRef.current = forkId;
        // Load fork messages from child chat
        const rootId = chatIdRef.current;
        const isReal = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(forkId);
        if (rootId && isReal) {
          chatApi.get(forkId).then((detail) => {
            if (detail.messages.length > 0) {
              const realMsgCount = detail.messages.filter((m) => m.role !== "fork-divider").length;
              const nestedForkMeta: Record<string, ForkMetaEntry> = {};
              const forkMsgs: Message[] = detail.messages.map((m) => {
                if (m.role === "fork-divider" || m.content.startsWith(FORK_PREFIX)) {
                  const parsed = decodeForkContent(m.content);
                  const nestedId = m.metadata_?.child_chat_id || `fork-loaded-${m.id}`;
                  nestedForkMeta[nestedId] = parsed
                    ? { ...parsed, msgId: m.id, messageCount: m.metadata_?.child_message_count, profile: m.metadata_?.fork_profile }
                    : { title: m.metadata_?.branch_label || m.content || t('newBranch'), nodeId: "", collapsed: false, completed: true, msgId: m.id, depth: m.metadata_?.depth || 0, messageCount: m.metadata_?.child_message_count, profile: m.metadata_?.fork_profile };
                  return { role: "fork-divider" as const, content: m.metadata_?.branch_label || parsed?.title || m.content || t('newBranch'), childChatId: nestedId };
                }
                return { role: m.role as "user" | "assistant", content: m.content, childChatId: forkId, webSearchResults: m.web_search_results || undefined, sources: m.source_cards || undefined, createdAt: m.created_at, thinking: m.metadata_?.thinking || undefined, toolCalls: m.metadata_?.tool_calls || undefined, contextDebug: m.metadata_?.context_debug || undefined };
              });
              // Update the live message count for this fork
              setForkMeta((prev) => ({ ...prev, [forkId]: { ...prev[forkId], messageCount: realMsgCount }, ...nestedForkMeta }));
              forkMetaRef.current = { ...forkMetaRef.current, [forkId]: { ...forkMetaRef.current[forkId], messageCount: realMsgCount }, ...nestedForkMeta };
              scrollTargetForkRef.current = forkId;
              setMessages((prev) => {
                const idx = prev.findIndex((m) => m.role === "fork-divider" && m.childChatId === forkId);
                if (idx === -1) return prev;
                const subForkIds = new Set(forkMsgs.filter((m) => m.role === "fork-divider").map((m) => m.childChatId!));
                const filtered = prev.filter((m) => {
                  if (m.role === "fork-divider" && m.childChatId === forkId) return true;
                  if (m.childChatId === forkId) return false;
                  if (m.childChatId && subForkIds.has(m.childChatId)) return false;
                  return true;
                });
                const result = [...filtered];
                result.splice(idx + 1, 0, ...forkMsgs);
                return result;
              });
            }
          }).catch(() => {});
        }
      }
      return next;
    });
  }, []);

  const handleCreateFork = useCallback((topic: string, profile: string) => {
    const parentId = activeChatIdRef.current || chatIdRef.current;
    if (!parentId) return;
    setForkPickerMsgIdx(null);
    setIsCreatingFork(true);
    chatApi.fork(parentId, { topic: topic.slice(0, 50), profile })
      .then((res) => {
        setIsCreatingFork(false);
        const realId = res.node_id || res.chat_id;
        const title = topic.slice(0, 30) || t('newBranch');
        const depth = res.depth || 0;
        const meta: ForkMetaEntry = { title, nodeId: realId, collapsed: false, completed: true, depth, profile };
        setForkMeta((prev) => ({ ...prev, [realId]: meta }));
        setMessages((prev) => [...prev, { role: "fork-divider" as const, content: encodeForkContent(meta), childChatId: realId }]);
        syncExpandedForks((prev) => new Set([...prev, realId]));
        if (res.divider_msg_id && chatIdRef.current) {
          chatApi.updateMessage(chatIdRef.current, res.divider_msg_id, "fork-divider", encodeForkContent(meta))
            .then(() => setForkMeta((p) => ({ ...p, [realId]: { ...p[realId], msgId: res.divider_msg_id } })))
            .catch(() => {});
        }
        toast(t('forkCreated', { title }), "success");
      })
      .catch((err) => { setIsCreatingFork(false); toast(t('forkFailed', { error: err.message }), "error"); });
  }, [t, syncExpandedForks]);

  // Navigate breadcrumb — always expand target (for breadcrumb clicks)
  const handleForkNavigate = useCallback(async (targetChatId: string) => {
    const rootChatId = chatIdRef.current;

    // Clicking root: collapse all forks, set active to root
    if (!targetChatId || targetChatId === rootChatId) {
      syncExpandedForks(new Set());
      setActiveForkId(null);
      activeChatIdRef.current = null;
      return;
    }

    // Clicking a fork: expand it, collapse siblings at same depth, load its messages
    const meta = forkMetaRef.current[targetChatId];
    const targetDepth = meta?.depth ?? 0;

    syncExpandedForks((prev) => {
      const next = new Set(prev);
      // Collapse everything deeper than the target
      for (const [cid, m] of Object.entries(forkMetaRef.current)) {
        if ((m.depth ?? 0) > targetDepth) {
          next.delete(cid);
        }
      }
      // Collapse siblings at the same depth
      for (const [cid, m] of Object.entries(forkMetaRef.current)) {
        if (cid !== targetChatId && (m.depth ?? 0) === targetDepth) {
          next.delete(cid);
        }
      }
      // Expand the target and all its ancestors
      next.add(targetChatId);
      for (const [cid, m] of Object.entries(forkMetaRef.current)) {
        if (cid !== targetChatId && (m.depth ?? 0) < targetDepth) {
          next.add(cid);
        }
      }
      return next;
    });

    setActiveForkId(targetChatId);
    activeChatIdRef.current = targetChatId;

    // Load fork messages from child chat for display (skip synthetic IDs)
    const isRealId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetChatId);
    if (rootChatId && isRealId) {
      try {
        const childDetail = await chatApi.get(targetChatId);
        if (childDetail.messages.length > 0) {
          const realMsgCount = childDetail.messages.filter((m) => m.role !== "fork-divider").length;
          const nestedForkMeta: Record<string, ForkMetaEntry> = {};
          const forkMsgs: Message[] = childDetail.messages.map((m) => {
            if (m.role === "fork-divider" || m.content.startsWith(FORK_PREFIX)) {
              const parsed = decodeForkContent(m.content);
              const nestedId = m.metadata_?.child_chat_id || `fork-loaded-${m.id}`;
              nestedForkMeta[nestedId] = parsed
                ? { ...parsed, msgId: m.id, messageCount: m.metadata_?.child_message_count, profile: m.metadata_?.fork_profile }
                : { title: m.metadata_?.branch_label || m.content || t('newBranch'), nodeId: "", collapsed: false, completed: true, msgId: m.id, depth: m.metadata_?.depth || 0, messageCount: m.metadata_?.child_message_count, profile: m.metadata_?.fork_profile };
              return { role: "fork-divider" as const, content: m.metadata_?.branch_label || parsed?.title || m.content || t('newBranch'), childChatId: nestedId };
            }
            return { role: m.role as "user" | "assistant", content: m.content, childChatId: targetChatId, webSearchResults: m.web_search_results || undefined, sources: m.source_cards || undefined, createdAt: m.created_at, thinking: m.metadata_?.thinking || undefined, toolCalls: m.metadata_?.tool_calls || undefined, contextDebug: m.metadata_?.context_debug || undefined };
          });
          setForkMeta((prev) => ({ ...prev, [targetChatId]: { ...prev[targetChatId], messageCount: realMsgCount }, ...nestedForkMeta }));
          forkMetaRef.current = { ...forkMetaRef.current, [targetChatId]: { ...forkMetaRef.current[targetChatId], messageCount: realMsgCount }, ...nestedForkMeta };
          scrollTargetForkRef.current = targetChatId;
          setMessages((prev) => {
            const dividerIdx = prev.findIndex((m) => m.role === "fork-divider" && m.childChatId === targetChatId);
            if (dividerIdx === -1) return prev;
            const subForkIds = new Set(forkMsgs.filter((m) => m.role === "fork-divider").map((m) => m.childChatId!));
            const withoutOld = prev.filter((m) => {
              if (m.role === "fork-divider" && m.childChatId === targetChatId) return true;
              if (m.childChatId === targetChatId) return false;
              if (m.childChatId && subForkIds.has(m.childChatId)) return false;
              return true;
            });
            const result = [...withoutOld];
            result.splice(dividerIdx + 1, 0, ...forkMsgs);
            return result;
          });
        }
      } catch (e) {
        console.error("Failed to load fork messages:", e);
      }
    }
  }, []);

  // Initialize WebSocket client
  useEffect(() => {
    // Find the active streaming assistant placeholder — works even when it's not the last element
    const streamIdx = (msgs: Message[]) => {
      for (let j = msgs.length - 1; j >= 0; j--) {
        if (msgs[j]._isStreaming) return j;
      }
      return -1;  // not found — callers must guard with si >= 0
    };

    const handleEvent = (event: StreamEvent) => {
      // Stream-scoped events: only process if we're actively streaming
      const isStreamEvent = ["content", "web_search_results", "sources", "context_debug", "thinking", "content_replace", "tool_executing", "tool_executed", "done", "error"].includes(event.type);
      if (isStreamEvent && !streamingChatIdRef.current) return;

      if (event.type === "content" && event.content) {
        // Accumulate content
        streamContentRef.current += event.content;
        const content = streamContentRef.current;
        setMessages((prev) => {
          const updated = [...prev];
          const si = streamIdx(updated);
          updated[si] = { ...updated[si], content };
          return updated;
        });
      } else if (event.type === "web_search_results" && event.results) {
        // Web search results
        streamContentRef.current = "";
        webSearchResultsRef.current = event.results;
        setMessages((prev) => {
          const updated = [...prev];
          const si = streamIdx(updated);
          updated[si] = { ...updated[si], webSearchResults: event.results, content: "", _isSearching: undefined };
          setExpandedSearchResults((s) => new Set(s).add(si));
          return updated;
        });
      } else if (event.type === "sources" && event.source_cards) {
        // RAG sources
        sourceCardsRef.current = event.source_cards;
        setMessages((prev) => {
          const updated = [...prev];
          const si = streamIdx(updated);
          updated[si] = { ...updated[si], sources: event.source_cards };
          return updated;
        });
      } else if (event.type === "context_debug" && event.context_debug) {
        // Context debug metadata — capture in ref for persistence on done
        streamContextDebugRef.current = event.context_debug;
        setMessages((prev) => {
          const updated = [...prev];
          const si = streamIdx(updated);
          updated[si] = { ...updated[si], contextDebug: event.context_debug };
          return updated;
        });
      } else if (event.type === "thinking" && event.content) {
        // AI thinking content
        streamThinkingRef.current += event.content;
        setMessages((prev) => {
          const updated = [...prev];
          const si = streamIdx(updated);
          if (si >= 0 && updated[si].role === "assistant") {
            const existing = updated[si].thinking || "";
            updated[si] = { ...updated[si], thinking: existing + event.content };
          }
          return updated;
        });
      } else if (event.type === "tool_executing" && event.tool_name) {
        // Tool is executing — show pending state
        const pendingCall: ToolCall = {
          name: event.tool_name,
          arguments: event.arguments || {},
          result: "",
          status: "pending",
        };
        setMessages((prev) => {
          const updated = [...prev];
          const si = streamIdx(updated);
          if (si >= 0 && updated[si].role === "assistant") {
            const existing = updated[si].toolCalls || [];
            updated[si] = { ...updated[si], toolCalls: [...existing, pendingCall] };
          }
          return updated;
        });
      } else if (event.type === "tool_executed" && event.tool_name) {
        // Tool execution complete — replace pending or append
        if (event.tool_name === "memory_edit") {
          swrMutate(["memories", workspaceId]);
        }
        const toolCall: ToolCall = {
          name: event.tool_name,
          arguments: event.arguments || {},
          result: event.result || "",
          status: "done",
        };
        streamToolCallsRef.current = [
          ...streamToolCallsRef.current.filter(tc => !(tc.name === event.tool_name && tc.status === "pending")),
          toolCall,
        ];
        setMessages((prev) => {
          const updated = [...prev];
          const si = streamIdx(updated);
          if (si >= 0 && updated[si].role === "assistant") {
            const existing = updated[si].toolCalls || [];
            // Replace the last pending tool call with same name, or append
            const pendingIdx = [...existing].reverse().findIndex(
              (tc) => tc.name === event.tool_name && tc.status === "pending"
            );
            if (pendingIdx >= 0) {
              const actualIdx = existing.length - 1 - pendingIdx;
              updated[si] = {
                ...updated[si],
                toolCalls: existing.map((tc, j) => j === actualIdx ? toolCall : tc),
              };
            } else {
              updated[si] = { ...updated[si], toolCalls: [...existing, toolCall] };
            }
          }
          return updated;
        });
      } else if (event.type === "auto_fork" && event.node_id) {
        // Auto-detected topic drift — insert lightweight fork divider
        const childChatId = `auto-${Date.now()}`;
        const title = event.title || t('topicDrift');
        const autoForkDepth = activeForkId ? ((forkMetaRef.current[activeForkId]?.depth ?? 0) + 1) : 0;
        const meta: Omit<ForkMetaEntry, "msgId"> = {
          title,
          nodeId: event.node_id,
          collapsed: false,
          completed: false,
          auto: true,
          depth: autoForkDepth,
        };
        setMessages((prev) => [
          ...prev,
          { role: "fork-divider" as const, content: encodeForkContent(meta), childChatId },
          { role: "assistant" as const, content: "" },
        ]);
        setForkMeta((prev) => ({ ...prev, [childChatId]: { ...meta, completed: false } }));
        // Don't auto-expand — user clicks fork divider to expand
        // Note: auto_fork is a lightweight frontend placeholder.
        // The backend will create the real divider and send fork_created with divider_msg_id.
        // The fork_created handler will update this placeholder or use the backend divider.
      } else if (event.type === "fork_created" && event.chat_id) {
        // Server-created fork — child AiChat (auto-fork via [BRANCH: ...] marker)
        const childChatId = event.chat_id;
        const title = event.branch_label || t('newBranch');
        const depth = event.depth || 0;
        const meta: Omit<ForkMetaEntry, "msgId"> = {
          title,
          nodeId: event.node_id || childChatId || "",
          collapsed: false,
          completed: true,
          depth,
          profile: event.profile,
        };
        const encoded = encodeForkContent(meta);
        // Check if an auto_fork placeholder already exists for this child
        const existingIdx = messagesRef.current.findIndex(
          (m) => m.role === "fork-divider" && m.childChatId === childChatId
        );
        if (existingIdx >= 0) {
          // Update existing placeholder with real data
          setMessages((prev) => {
            const updated = [...prev];
            updated[existingIdx] = { ...updated[existingIdx], content: encoded };
            return updated;
          });
          setForkMeta((prev) => ({ ...prev, [childChatId]: { ...meta, completed: true } }));
          // Update backend divider content
          const existingMsgId = forkMetaRef.current[childChatId]?.msgId;
          if (existingMsgId && chatIdRef.current) {
            chatApi.updateMessage(chatIdRef.current, existingMsgId, "fork-divider", encoded).catch(() => {});
          }
        } else {
          // No placeholder — insert fork-divider before the (user, assistant) pair
          // and move both into the fork's scope.
          setMessages((prev) => {
            const updated = [...prev];
            const si = streamIdx(updated);
            if (si >= 0 && updated[si].role === "assistant") {
              // Move streaming assistant to fork context, clear any pre-fork content
              updated[si] = { ...updated[si], childChatId, content: "" };
              // Also move the preceding root-context user message into the fork.
              // Without this, that user message becomes an orphan in root history
              // (no assistant reply in root), causing the LLM to see two consecutive
              // user messages and answer both questions simultaneously.
              let dividerAt = si;
              if (si > 0 && updated[si - 1].role === "user" && !updated[si - 1].childChatId) {
                updated[si - 1] = { ...updated[si - 1], childChatId };
                dividerAt = si - 1;
              }
              updated.splice(dividerAt, 0, { role: "fork-divider" as const, content: encoded, childChatId });
              return updated;
            }
            // Fallback: streaming message not found, append divider at end
            return [...prev, { role: "fork-divider" as const, content: encoded, childChatId }];
          });
          setForkMeta((prev) => ({ ...prev, [childChatId]: { ...meta, completed: false, msgId: event.divider_msg_id } }));
          // Update backend divider with encoded content
          if (event.divider_msg_id && chatIdRef.current) {
            chatApi.updateMessage(chatIdRef.current, event.divider_msg_id, "fork-divider", encoded).catch(() => {});
          }
        }
        // Auto-expand the new fork so streaming content is immediately visible
        syncExpandedForks((prev) => new Set([...prev, childChatId]));
        // Switch in-flight stream context to fork
        forkChildIdRef.current = childChatId;
        streamingForkIdRef.current = childChatId;
        streamContentRef.current = "";
        toast.success(t('topicDrifted', { title }));
      } else if (event.type === "content_replace" && event.content) {
        // Server replaced the streamed content (e.g., stripped [BRANCH: ...] marker)
        setMessages((prev) => {
          const updated = [...prev];
          const si = streamIdx(updated);
          if (si >= 0 && updated[si].role === "assistant") {
            updated[si] = { ...updated[si], content: event.content! };
          }
          return updated;
        });
        streamContentRef.current = event.content;
      } else if (event.type === "ws_reconnected") {
        // WS reconnected mid-stream — backend task was cancelled, clean up stuck state
        setMessages((prev) => {
          const si = streamIdx(prev);
          if (si < 0) return prev;
          const updated = [...prev];
          const last = updated[si];
          if (!last._isStreaming) return prev;
          updated[si] = {
            ...last,
            content: last.content || t('connectionInterrupted'),
            status: "error",
            _isStreaming: undefined,
          };
          return updated;
        });
        setIsStreaming(false);
        streamingChatIdRef.current = null;
        streamingForkIdRef.current = null;
      } else if (event.type === "done") {
        // Stream completed — verify this done belongs to the current stream
        if (event.chat_id && streamingChatIdRef.current && event.chat_id !== streamingChatIdRef.current) {
          return; // Stale done from a previous stream, ignore
        }
        setMessages((prev) => {
          const updated = [...prev];
          const si = streamIdx(updated);
          const last = updated[si];
          const finalContent = last.content || t('modelNoResponse');
          updated[si] = { ...last, content: finalContent, status: last.content ? "done" : "error", _isStreaming: undefined };
          return updated;
        });
        setIsStreaming(false);
        // Identify which fork this stream belonged to (before clearing ref)
        const completedForkId = streamingForkIdRef.current;
        streamingForkIdRef.current = null;
        streamingChatIdRef.current = null;
        if (chatIdRef.current && streamContentRef.current && !completedForkId) {
          // Only save root assistant responses to root chat
          const streamMeta: Record<string, any> = {};
          if (streamThinkingRef.current) streamMeta.thinking = streamThinkingRef.current;
          if (streamToolCallsRef.current.length > 0) streamMeta.tool_calls = streamToolCallsRef.current;
          if (streamContextDebugRef.current) streamMeta.context_debug = streamContextDebugRef.current;
          saveMessage(chatIdRef.current, "assistant", streamContentRef.current, webSearchResultsRef.current, Object.keys(streamMeta).length > 0 ? streamMeta : undefined, sourceCardsRef.current);
        }
        // Mark the correct fork as completed (collapsible)
        // Keep activeForkId pointing to the fork — breadcrumb and message tagging depend on it
        if (completedForkId) {
          setForkMeta((prev) => {
            const entry = prev[completedForkId];
            if (entry && !entry.completed) {
              const updatedEntry = { ...entry, completed: true };
              // Persist completion to backend
              if (entry.msgId && chatIdRef.current) {
                chatApi.updateMessage(chatIdRef.current, entry.msgId, "fork-divider", encodeForkContent(updatedEntry)).catch((e) =>
                  console.error("Failed to persist fork completion:", e)
                );
              }
              return { ...prev, [completedForkId]: updatedEntry };
            }
            return prev;
          });
        }
        // Save this turn's assistant response to the child chat
        const childId = forkChildIdRef.current || completedForkId;
        if (childId) {
          forkChildIdRef.current = null;
          const contentToSave = streamContentRef.current;
          if (contentToSave) {
            const childMeta: Record<string, any> = {};
            if (streamThinkingRef.current) childMeta.thinking = streamThinkingRef.current;
            if (streamToolCallsRef.current.length > 0) childMeta.tool_calls = streamToolCallsRef.current;
            if (streamContextDebugRef.current) childMeta.context_debug = streamContextDebugRef.current;
            chatApi.addMessage(childId, "assistant", contentToSave, undefined, undefined, Object.keys(childMeta).length > 0 ? childMeta : undefined, sourceCardsRef.current).catch(() => {});
          }
        } else {
          forkChildIdRef.current = null;
        }
        loadHistory();
      } else if (event.type === "error") {
        // Error occurred — verify this error belongs to the current stream
        if (event.chat_id && streamingChatIdRef.current && event.chat_id !== streamingChatIdRef.current) {
          return; // Stale error from a previous stream, ignore
        }
        console.error("WebSocket stream error:", event.content);
        setMessages((prev) => {
          const updated = [...prev];
          const si = streamIdx(updated);
          const last = updated[si];
          updated[si] = {
            ...last,
            content: last.content || t('errorOccurred'),
            status: "error",
            _isStreaming: undefined,
          };
          return updated;
        });
        setIsStreaming(false);
        streamingChatIdRef.current = null;
        streamingForkIdRef.current = null;
      }
    };

    const handleClose = () => {
      console.log("WebSocket connection closed");
      toast.error(t('connectionLost'));
    };

    const wsUrl = createWSUrl("/api/ws");
    wsClientRef.current = new UnifiedWSClient(wsUrl, handleEvent, handleClose);
    wsClientRef.current.connect();

    return () => {
      wsClientRef.current?.disconnect();
      abortRef.current?.();
    };
  }, []);

  const loadHistory = useCallback(() => {
    chatApi.list(workspaceId || undefined).then(setHistory).catch((err) => {
      console.error("Failed to load chat history:", err);
    });
  }, [workspaceId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Listen for card mention requests from the card list
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.cardId) {
        setMentionedCards((prev) => {
          if (prev.some((c) => c.cardId === detail.cardId)) return prev;
          return [...prev, detail];
        });
      }
    };
    window.addEventListener("card-mention-request", handler);
    return () => window.removeEventListener("card-mention-request", handler);
  }, []);

  // Fetch chat path — prefer active fork, fall back to root chat
  useEffect(() => {
    const targetId = activeForkId || chatId;
    if (!targetId) {
      setChatPath([]);
      return;
    }
    // Skip path fetch for synthetic fork IDs
    const isRealUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId);
    if (!isRealUuid) {
      setChatPath([]);
      return;
    }
    chatApi.getChatPath(targetId)
      .then((res) => setChatPath(res.path))
      .catch((err) => {
        console.error("Failed to fetch chat path:", err);
        setChatPath([]);
      });
  }, [chatId, activeForkId]);

  // Note: Manual fork creation now goes through chatApi.fork() directly.
  // The topology-fork-request / topology-fork-complete CustomEvent chain has been removed.
  // Server-side auto-fork (fork_created WS event) is still handled below.

  const loadChat = async (id: string): Promise<boolean> => {
    stopStream();
    try {
      const detail = await chatApi.get(id);
      setChatId(detail.id);
      // Reconstruct fork dividers from stored messages
      const newForkMeta: Record<string, ForkMetaEntry> = {};
      const msgs: Message[] = detail.messages.map((m) => {
        if (m.role === "fork-divider" || m.content.startsWith(FORK_PREFIX)) {
          const parsed = decodeForkContent(m.content);
          const childChatId = m.metadata_?.child_chat_id || `fork-loaded-${m.id}`;
          if (parsed) {
            newForkMeta[childChatId] = { ...parsed, msgId: m.id, messageCount: m.metadata_?.child_message_count, profile: m.metadata_?.fork_profile };
          } else {
            newForkMeta[childChatId] = {
              title: m.metadata_?.branch_label || m.content || t('newBranch'),
              nodeId: "",
              collapsed: false,
              completed: true,
              msgId: m.id,
              depth: m.metadata_?.depth || 0,
              messageCount: m.metadata_?.child_message_count,
              profile: m.metadata_?.fork_profile,
            };
          }
          return { role: "fork-divider" as const, content: m.metadata_?.branch_label || parsed?.title || m.content || t('newBranch'), childChatId };
        }
        return {
          role: m.role as "user" | "assistant",
          content: m.content,
          childChatId: m.metadata_?.child_chat_id || undefined,
          webSearchResults: m.web_search_results || undefined,
          sources: m.source_cards || undefined,
          createdAt: m.created_at,
          thinking: m.metadata_?.thinking || undefined,
          toolCalls: m.metadata_?.tool_calls || undefined,
          contextDebug: m.metadata_?.context_debug || undefined,
        };
      });

      setMessages(msgs);
      setForkMeta(newForkMeta);
      setInput("");
      setShowHistory(false);
      setForkMode(false);
      setRetrievalLevel(undefined);
      // Forks start collapsed; user clicks to expand
      syncExpandedForks(new Set());
      setActiveForkId(null);
      activeChatIdRef.current = null;
      return true;
    } catch {
      return false;
    }
  };
  loadChatRef.current = loadChat;

  // Find root ancestor by walking up parent_id chain in history
  const getRootAncestor = useCallback((id: string): string => {
    const parentMap = new Map<string, string | null>();
    for (const c of history) {
      parentMap.set(c.id, c.parent_id);
    }
    let current = id;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const pid = parentMap.get(current);
      if (!pid) return current;
      current = pid;
    }
    return id;
  }, [history]);

  // Load root conversation and expand path to target fork
  const loadChatAndFocusFork = useCallback(async (targetId: string) => {
    const rootId = getRootAncestor(targetId);
    const isRoot = rootId === targetId;

    // Load root conversation (or reload if switching)
    if (chatId !== rootId) {
      const ok = await loadChat(rootId);
      if (!ok) return;
    } else {
      // Already on the root — just close history panel
      setShowHistory(false);
    }

    if (isRoot) {
      // Target is the root itself — collapse all forks
      syncExpandedForks(new Set());
      setActiveForkId(null);
      activeChatIdRef.current = null;
      return;
    }

    // Navigate to the target fork after a tick (allow state to settle)
    setTimeout(() => {
      handleForkNavigate(targetId);
    }, 50);
  }, [history, chatId, getRootAncestor, loadChat, handleForkNavigate]);

  // Restore last active chat on mount
  useEffect(() => {
    if (!workspaceId) return;
    const savedId = localStorage.getItem(chatStorageKey);
    if (savedId && !chatId) {
      loadChatAndFocusFork(savedId).catch(() => {
        // Chat was deleted or invalid — clear stale localStorage entry
        localStorage.removeItem(chatStorageKey);
      });
    }
  }, [workspaceId]);

  const startNewChat = () => {
    stopStream();
    setChatId(null);
    setMessages([]);
    setInput("");
    setShowHistory(false);
    setForkMeta({});
    setForkMode(false);
    setRetrievalLevel(undefined);
    setWebSearch(false);
    activeChatIdRef.current = null;
    syncExpandedForks(new Set());
    setActiveForkId(null);
    pendingForkRef.current = null;
  };

  const stopStream = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setIsStreaming(false);
    // Clear all streaming-scoped refs to prevent cross-chat contamination
    streamingChatIdRef.current = null;
    streamingForkIdRef.current = null;
    streamContentRef.current = "";
    webSearchResultsRef.current = undefined;
    sourceCardsRef.current = undefined;
    streamThinkingRef.current = "";
    streamToolCallsRef.current = [];
    streamContextDebugRef.current = undefined;
    forkChildIdRef.current = null;
  }, []);

  const saveMessage = async (cid: string, role: string, content: string, webSearchResults?: WebSearchResult[], metadata?: Record<string, any>, sourceCards?: RAGResponse["source_cards"]) => {
    try {
      await chatApi.addMessage(cid, role, content, webSearchResults, undefined, metadata, sourceCards);
    } catch (e) {
      console.error("Failed to save message:", e);
    }
  };

  const handlePrecipitateBlock = useCallback(async (blockText: string) => {
    if (!workspaceId) {
      toast(tCard('precipitateNeedWorkspace'), "error");
      return;
    }
    // Strip leading whitespace that would render as code blocks
    const lines = blockText.split("\n");
    const indented = lines.filter((l) => /^\s{4,}\S/.test(l));
    if (indented.length >= 2 && indented.length >= lines.filter((l) => l.trim().length > 0).length * 0.6) {
      const minIndent = Math.min(...indented.map((l) => l.match(/^(\s*)/)?.[1]?.length ?? 0));
      blockText = lines.map((l) => (/^\s{4,}\S/.test(l) ? l.slice(minIndent) : l)).join("\n");
    }
    const key = blockText.slice(0, 50);
    if (precipitatedBlocksRef.current.has(key)) return;
    setPrecipitatingBlock(key);
    try {
      let title = "";
      let keywords: string[] = [];
      // Run independently so one failure doesn't kill the other
      const [titleRes, kwRes] = await Promise.allSettled([
        aiApi.generateTitle(blockText),
        aiApi.extractKeywords(blockText),
      ]);
      if (titleRes.status === "fulfilled") title = titleRes.value.title || "";
      if (kwRes.status === "fulfilled") keywords = kwRes.value.keywords || [];
      // Fallback if API returned empty
      if (!title) {
        const firstLine = blockText.split("\n").find((l) => l.trim()) || "";
        title = firstLine.replace(/^#+\s*/, "").slice(0, 30) || tCommon('unnamed');
      }
      const created = await cardApi.create({
        local_id: "card_" + Date.now(),
        workspace_id: workspaceId,
        title,
        content: blockText,
        keywords,
      });
      setPrecipitatedBlocks((prev) => new Set(prev).add(key));
	      toast(
	        tCard('precipitatedAsTemp', { title: created.title || tCommon('unnamed') }),
	        "success",
	        { label: tCard('promoteNow'), onClick: () => router.push(`/workspaces/${workspaceId}/card/${created.id}`) }
	      );
      window.dispatchEvent(new CustomEvent("card-precipitated", { detail: { cardId: created.id } }));
    } catch (e: any) {
      toast(tCard('precipitateFailed', { error: e.message }), "error");
    } finally {
      setPrecipitatingBlock(null);
    }
  }, [workspaceId]);

  // Compute the deepest expanded fork — messages route here automatically
  const getDeepestExpandedFork = useCallback((): string | null => {
    let deepest: string | null = null;
    let maxDepth = -1;
    for (const forkId of expandedForksRef.current) {
      const depth = forkMetaRef.current[forkId]?.depth ?? 0;
      if (depth > maxDepth) {
        maxDepth = depth;
        deepest = forkId;
      }
    }
    return deepest;
  }, []);

  const doSend = async (question: string, force = false) => {
    if (!question.trim() || (!force && isStreaming)) return;

    setIsStreaming(true);

    const activeChildChatId = getDeepestExpandedFork();  // route to deepest non-collapsed fork
    streamingForkIdRef.current = activeChildChatId;  // track which fork this stream belongs to
    if (activeChildChatId) activeStreamForkRef.current = activeChildChatId;
    const nowIso = new Date().toISOString();
    const rand = Math.random().toString(36).slice(2);
    const userKey = `u-${nowIso}-${rand}`;
    const asstKey = `a-${nowIso}-${rand}`;
    const loadingHint = webSearch ? t('searchingWeb') : "";
    const userMsg: Message = { role: "user", content: question, childChatId: activeChildChatId || undefined, createdAt: nowIso, _key: userKey };
    const asstMsg: Message = { role: "assistant", content: loadingHint, childChatId: activeChildChatId || undefined, createdAt: nowIso, _isStreaming: true, _isSearching: webSearch ? true : undefined, _key: asstKey };
    setMessages((prev) => {
      if (!activeChildChatId) return [...prev, userMsg, asstMsg];
      // Insert after the last message belonging to this fork so renderBlock finds them inside the fork block
      for (let j = prev.length - 1; j >= 0; j--) {
        if (prev[j].childChatId === activeChildChatId || (prev[j].role === "fork-divider" && prev[j].childChatId === activeChildChatId)) {
          return [...prev.slice(0, j + 1), userMsg, asstMsg, ...prev.slice(j + 1)];
        }
      }
      return [...prev, userMsg, asstMsg];
    });

    let currentChatId = chatIdRef.current;
    if (!currentChatId) {
      try {
        const chat = await chatApi.create({
          mode: "rag",
          workspace_id: workspaceId || undefined,
          card_id: cardId,
          title: question.slice(0, 50),
        });
        currentChatId = chat.id;
        setChatId(chat.id);
        chatIdRef.current = chat.id;  // ref must be set immediately for the WS done handler
        loadHistory();
      } catch (e) {
        console.error("Failed to create chat:", e);
      }
    }

    if (currentChatId) {
      const saveTarget = activeChildChatId || currentChatId;
      saveMessage(saveTarget, "user", question);
    }

    // Track which chat this stream belongs to (for scoping WS events)
    streamingChatIdRef.current = currentChatId;

    // Reset stream state
    streamContentRef.current = "";
    webSearchResultsRef.current = undefined;
    sourceCardsRef.current = undefined;
    streamThinkingRef.current = "";
    streamToolCallsRef.current = [];
    streamContextDebugRef.current = undefined;

    // Build history — only include root messages + messages from the active fork
    // This prevents sibling fork messages from leaking into the current branch's context
    const hist = messagesRef.current
      .filter((m) => {
        if (!m.content || m.role === "fork-divider") return false;
        if (!activeChildChatId) return !m.childChatId;
        return !m.childChatId || m.childChatId === activeChildChatId;
      })
      .map((m) => ({ role: m.role, content: m.content }));

    // Send via WebSocket — wait up to 3s in case WS reconnected during async ops above
    const wsReady = await new Promise<boolean>((resolve) => {
      if (wsClientRef.current?.connected) { resolve(true); return; }
      const deadline = Date.now() + 3000;
      const poll = setInterval(() => {
        if (wsClientRef.current?.connected) { clearInterval(poll); resolve(true); }
        else if (Date.now() >= deadline) { clearInterval(poll); resolve(false); }
      }, 100);
    });
    if (!wsReady) {
      toast.error(t('wsNotConnected'));
      // Remove the user + assistant placeholders by key — they may not be at the end of the array
      // when inserted inside a fork block
      setMessages((prev) => prev.filter((m) => m._key !== userKey && m._key !== asstKey));
      setIsStreaming(false);
      return;
    }

    wsClientRef.current?.send({
      type: "rag",
      question: question,
      workspace_ids: [workspaceId],
      card_id: cardId,
      top_k: 5,
      web_search: webSearch,
      history: hist,
      retrieval_level: retrievalLevel,
      chat_id: currentChatId || undefined,
      current_fork_id: activeChildChatId || undefined,
      context_card_ids: mentionedCards.length > 0 ? mentionedCards.map(c => c.cardId) : undefined,
    });
    setMentionedCards([]);

    // Set abort function to cancel via WebSocket
    abortRef.current = () => {
      wsClientRef.current?.send({ type: "cancel" });
    };
  };

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    const question = input.trim();
    setInput("");
    setForkPickerMsgIdx(null);
    if (forkMode) {
      setForkMode(false);
      const parentChatId = activeForkId || chatIdRef.current;
      if (parentChatId) {
        // Prevent double-send during async fork creation
        setIsStreaming(true);
        setIsCreatingFork(true);
        chatApi.fork(parentChatId, { topic: question.slice(0, 50) })
          .then((res) => {
            setIsCreatingFork(false);
            const realId = res.node_id || res.chat_id;
            const title = question.slice(0, 30) || t('newBranch');
            const depth = res.depth || 0;
            const meta: ForkMetaEntry = { title, nodeId: realId, collapsed: false, completed: false, depth };
            setForkMeta((prev) => ({ ...prev, [realId]: meta }));
            forkMetaRef.current = { ...forkMetaRef.current, [realId]: meta };
            setMessages((prev) => [...prev, { role: "fork-divider" as const, content: encodeForkContent(meta), childChatId: realId }]);
            activeChatIdRef.current = realId;
            setActiveForkId(realId);
            syncExpandedForks((prev) => new Set([...prev, realId]));
            forkChildIdRef.current = realId;
            // Backend already created a fork-divider — update its content with encoded meta
            if (res.divider_msg_id && chatIdRef.current) {
              chatApi.updateMessage(chatIdRef.current, res.divider_msg_id, "fork-divider", encodeForkContent(meta))
                .then(() => setForkMeta((p) => ({ ...p, [realId]: { ...p[realId], msgId: res.divider_msg_id } })))
                .catch((e) => console.error("Failed to update fork divider:", e));
            }
            // doSend takes over the isStreaming=true guard from here,
            // passing force=true so it doesn't re-check the stale state value
            doSend(question, true);
          })
          .catch((err) => {
            console.error("Fork creation failed:", err);
            toast(t('forkFailed', { error: err.message }), "error");
            setIsCreatingFork(false);
            setIsStreaming(false);
          });
      } else {
        doSend(question);
      }
    } else {
      doSend(question);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await chatApi.delete(deleteTarget.id);
      setHistory((prev) => prev.filter((c) => c.id !== deleteTarget.id));

      // Remove fork-divider and all fork messages from parent chat in DB
      const parentId = chatIdRef.current;
      if (parentId) {
        try {
          const parentDetail = await chatApi.get(parentId);
          for (const m of parentDetail.messages) {
            const isForkDivider = m.role === "fork-divider" && m.metadata_?.child_chat_id === deleteTarget.id;
            const isForkMessage = m.metadata_?.child_chat_id === deleteTarget.id;
            if (isForkDivider || isForkMessage) {
              await chatApi.deleteMessage(parentId, m.id).catch(() => {});
            }
          }
        } catch (e) {
          console.error("Failed to clean fork messages from parent:", e);
        }
      }

      // Remove from frontend state
      setMessages((prev) => prev.filter((m) => m.childChatId !== deleteTarget.id));
      setForkMeta((prev) => {
        const next = { ...prev };
        delete next[deleteTarget.id];
        return next;
      });
      if (activeChatIdRef.current === deleteTarget.id) {
        activeChatIdRef.current = null;
        setActiveForkId(null);
      }
      if (chatId === deleteTarget.id) {
        setChatId(null);
        setMessages([]);
      }
    } catch {}
    setDeleteTarget(null);
  };

  const rightCollapsed = usePanelStore((s) => s.rightCollapsed);

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-bg">
      {/* Header */}
      <div className="relative z-20 flex items-center gap-2 border-b border-border bg-surface/80 px-3 py-2 backdrop-blur-sm">
        {/* Left: fork status indicators */}
        {!rightCollapsed ? (
          <>
            <div className="flex items-center gap-1.5">
              <Sparkles size={14} className="text-primary" />
              <span className="text-xs font-medium text-text">{t('knowledgeQA')}</span>
            </div>

            {Object.keys(forkMeta).length > 0 && (
              <div className="flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] text-green-700">
                <GitBranch size={10} />
                {t('branchCount', { count: Object.keys(forkMeta).length })}
              </div>
            )}

            {forkMode && (
              <div className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 animate-pulse">
                <GitBranch size={10} />
                {t('forkMode')}
                <button onClick={() => setForkMode(false)} className="ml-0.5 text-amber-400 hover:text-amber-600">×</button>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-1">
            <Sparkles size={14} className="text-primary" />
            <span className="text-[11px] font-medium">{t('knowledgeQA')}</span>
          </div>
        )}

        {/* Right: action buttons */}
        <div className="ml-auto flex items-center gap-1">
          {!rightCollapsed && (
            <>
              <button
                onClick={() => { setShowMemory(!showMemory); setShowHistory(false); }}
                className={`rounded-lg p-1.5 transition ${
                  showMemory ? "bg-primary/10 text-primary-dark" : "text-text-secondary hover:bg-muted"
                }`}
                title={t('showMemory')}
              >
                <Brain size={15} />
              </button>
              <button
                onClick={() => { setShowHistory(!showHistory); setShowMemory(false); }}
                className={`rounded-lg p-1.5 transition ${
                  showHistory ? "bg-primary/10 text-primary-dark" : "text-text-secondary hover:bg-muted"
                }`}
                title={t('historyChat')}
              >
                <History size={15} />
              </button>
              <button
                onClick={startNewChat}
                className="rounded-lg p-1.5 text-text-secondary transition hover:bg-muted"
                title={t('newChat')}
              >
                <MessageSquarePlus size={15} />
              </button>
            </>
          )}
          {!rightCollapsed && (
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-text-secondary transition hover:bg-muted"
              title={t('closePanel')}
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Memory sub-panel */}
        {showMemory && (
          <MemoryPanel workspaceId={workspaceId} onClose={() => setShowMemory(false)} />
        )}

        {/* History sub-panel */}
        {showHistory && (
          <div className="absolute inset-0 z-10 flex flex-col bg-bg">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <button
                onClick={() => setShowHistory(false)}
                className="rounded-lg p-1 text-text-secondary hover:bg-muted"
              >
                <ArrowLeft size={15} />
              </button>
              <span className="text-xs font-medium text-text">{t('chatHistory')}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {history.length === 0 && (
                <p className="px-2 py-4 text-center text-xs text-text-secondary">{t('noHistory')}</p>
              )}
              {(() => {
                const parents = history.filter((c) => !c.parent_id);
                const childrenMap = new Map<string, ChatSession[]>();
                for (const c of history) {
                  if (c.parent_id) {
                    const arr = childrenMap.get(c.parent_id) || [];
                    arr.push(c);
                    childrenMap.set(c.parent_id, arr);
                  }
                }
                const historyDepthColors = ["text-green-600", "text-purple-600", "text-orange-600", "text-blue-600", "text-red-600"];
                const historyBgColors = ["bg-green-50", "bg-purple-50", "bg-orange-50", "bg-blue-50", "bg-red-50"];
                function renderChatItem(chat: ChatSession, depth: number): React.ReactNode {
                  const children = childrenMap.get(chat.id) || [];
                  const colorCls = depth === 0 ? "" : historyDepthColors[(depth - 1) % historyDepthColors.length];
                  const bgCls = depth === 0 ? (chatId === chat.id ? "bg-primary/10 text-primary-dark" : "text-text") : (chatId === chat.id ? `${historyBgColors[(depth - 1) % historyBgColors.length]} ${colorCls}` : "text-text-secondary");
                  return (
                    <div key={chat.id}>
                      <div
                        onClick={() => loadChatAndFocusFork(chat.id)}
                        className={`group mb-1 flex cursor-pointer items-center gap-2 rounded-lg ${depth === 0 ? "py-2 text-sm" : "py-1.5 text-xs"} transition hover:bg-muted ${bgCls}`}
                        style={{ paddingLeft: `${12 + depth * 16}px`, paddingRight: "12px" }}
                      >
                        {depth > 0 && <GitBranch size={10} className={`shrink-0 ${colorCls || "text-green-400"}`} />}
                        <span className="line-clamp-1 flex-1">{chat.title || (depth === 0 ? t('newChat') : t('newBranch'))}</span>
                        {depth === 0 && children.length > 0 && (
                          <span className="flex-shrink-0 rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] text-green-600">
                            {t('branchCount', { count: children.length })}
                          </span>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(chat); }}
                          className="hidden text-text-secondary hover:text-danger group-hover:block"
                        >
                          <Trash2 size={depth === 0 ? 13 : 11} />
                        </button>
                      </div>
                      {children.map((child) => renderChatItem(child, depth + 1))}
                    </div>
                  );
                }
                return parents.map((chat) => renderChatItem(chat, 0));
              })()}
            </div>
          </div>
        )}

        {/* Chat area — flex layout so breadcrumb stays pinned */}
        {!rightCollapsed && chatPath.length > 0 && (
          <ForkBreadcrumb
            path={chatPath}
            activeChatId={activeForkId || chatId}
            onNavigate={loadChatAndFocusFork}
            topologyNodes={topologyNodes}
          />
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center text-text-secondary">
                <div className="mb-3 text-3xl font-bold text-primary/30">AI</div>
                <p className="text-sm font-medium">{t('basedOnCards')}</p>
                <p className="mt-1 text-xs">{t('basedOnCardsHint')}</p>
              </div>
            )}

            {(() => {
              const depthColorMap = ["#60a5fa", "#4ade80", "#c084fc", "#fb923c", "#f87171"];

              // Recursive renderer: collect messages for a fork block.
              // parentDepth = depth of the owning fork (-1 at root level).
              // Stops when it hits a fork-divider whose depth <= parentDepth (i.e. a sibling).
              function renderBlock(startIdx: number, parentDepth: number, parentForkId?: string): [React.ReactNode[], number] {
                const out: React.ReactNode[] = [];
                let i = startIdx;

                while (i < messages.length) {
                  const msg = messages[i];

                  // ── Fork divider ──
                  if (msg.role === "fork-divider" && msg.childChatId) {
                    const forkId = msg.childChatId;
                    const meta = forkMeta[forkId];
                    if (!meta) { i++; continue; }
                    const forkDepthLevel = meta.depth ?? 0;

                    // Sibling or parent-level fork → stop, let caller handle it
                    if (forkDepthLevel <= parentDepth) break;

                    const isExpanded = expandedForks.has(forkId);
                    const forkColor = depthColorMap[forkDepthLevel % depthColorMap.length];

                    // Recursively collect children inside this fork
                    const [children, nextIdx] = renderBlock(i + 1, forkDepthLevel, forkId);

                    out.push(
                      <div key={`fork-${i}`} id={`fork-divider-${forkId}`} className="my-2">
                        <ForkDivider
                          childChatId={forkId}
                          label={meta.title}
                          depth={forkDepthLevel}
                        messageCount={meta.messageCount ?? children.length}
                          collapsed={!isExpanded}
                          profile={meta.profile}
                          onToggle={(cid) => toggleFork(cid)}
                        />
                        {isExpanded && (
                          <div className="ml-3 mt-2 space-y-3 rounded-lg bg-gray-50/60 p-3 dark:bg-gray-900/30" style={{ borderLeft: `3px solid ${forkColor}` }}>
                            {children.length === 0 ? (
                              <p className="text-xs text-text-secondary italic py-2">{tFork('emptyHint')}</p>
                            ) : children}
                            <div id={`fork-end-${forkId}`} />
                          </div>
                        )}
                      </div>
                    );
                    i = nextIdx;
                    continue;
                  }

                // If inside a fork block and this message belongs to a different context, stop
                if (parentForkId !== undefined && (msg.childChatId ?? null) !== (parentForkId ?? null)) break;
                // ── Root message: render normally ──
                out.push(
                  <div key={msg._key || `msg-${i}`} data-fork-child={msg.childChatId || ""} className={`group/msg mb-3 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 backdrop-blur-sm ${msg.role === "user" ? "bg-primary/20 text-foreground border border-primary/30 shadow-sm" : "bg-surface text-text shadow-sm"}`}>
                      {msg.role === "assistant" ? (
                        msg._isSearching ? (
                          <div className="flex items-center gap-2 text-sm text-text-secondary"><Globe size={14} className="animate-pulse" /><span className="animate-pulse">{t('searchingWeb')}</span></div>
                        ) : msg._isStreaming && !msg.content && !msg.thinking ? (
                          <div className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={14} className="animate-spin text-primary" /><span className="animate-pulse">{t('thinking')}</span></div>
                        ) : (
                          <>
                            {msg.thinking && (
                              <ThinkingBlock
                                content={msg.thinking}
                                isStreaming={!!msg._isStreaming}
                                hasContent={!!(msg.content && msg.content.trim())}
                              />
                            )}
                            {msg.toolCalls && msg.toolCalls.length > 0 && <ToolCallsBlock calls={msg.toolCalls} />}
                            <AssistantResponse content={msg.content || " "} className="text-[14px] leading-[1.75]" />
                            {msg.status === "error" && <p className="mt-1 text-xs text-amber-600">{t('responseInterrupted')}</p>}
                            {msg.content && msg.content.trim() && (
                              <>
                                {forkPickerMsgIdx === i && (
                                  <div className="mt-2 rounded-lg border border-border bg-surface p-2 shadow-sm">
                                    <p className="mb-1.5 text-[10px] font-medium text-text-secondary">{t('selectForkProfile')}</p>
                                    <div className="grid grid-cols-2 gap-1">
                                      {FORK_PROFILES_UI.map((fp) => (
                                        <button
                                          key={fp.key}
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const pi = i > 0 ? messages[i - 1] : null;
                                            const topic = pi?.content || t('continueExplore');
                                            handleCreateFork(topic, fp.key);
                                          }}
                                          className="flex flex-col items-start rounded p-1.5 text-left transition-colors hover:bg-green-50"
                                        >
                                          <span className="text-[11px] font-medium text-text">{tFork(fp.labelKey)}</span>
                                          <span className="text-[10px] text-text-secondary">{tFork(fp.descKey)}</span>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                <div className="mt-2 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isCreatingFork) return;
                                      setForkPickerMsgIdx(forkPickerMsgIdx === i ? null : i);
                                    }}
                                    disabled={isCreatingFork}
                                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-green-50 hover:text-green-600 disabled:cursor-not-allowed disabled:opacity-50"
                                    title={t('forkFromHere')}
                                  >
                                    {isCreatingFork ? <Loader2 size={10} className="animate-spin" /> : <GitBranch size={10} />}
                                    {t('fork')}
                                  </button>
                                  <button onClick={(e) => { e.stopPropagation(); usePanelStore.getState().appendToEditor(msg.content); toast(t('copyToEditor'), "success"); }} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-secondary hover:bg-muted hover:text-foreground" title={t('copyToEditor')}><Copy size={10} />{t('copyToEditor')}</button>
                                </div>
                              </>
                            )}
                          </>
                        )
                      ) : (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                      )}
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-2 border-t border-border pt-2">
                          <p className="mb-1.5 text-[10px] text-text-secondary">{t('sourceLabel')}</p>
                          <div className="flex flex-col gap-1">
                            {msg.sources.map((s) => (
                              <button key={s.id} onClick={() => { onClose(); router.push(`/workspaces/${workspaceId}/card/${s.id}`); }} className="flex items-start gap-2 rounded-lg border border-border/50 bg-gray-50/80 px-2.5 py-1.5 text-left text-[11px] hover:border-primary/30 hover:bg-primary/5">
                                <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: s.color || "#B8D4E3" }} />
                                <div className="min-w-0 flex-1">{s.title && <span className="block font-medium text-text">{s.title}</span>}<span className="line-clamp-1 text-text-secondary">{s.content}</span></div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {msg.webSearchResults && msg.webSearchResults.length > 0 && (
                        <div className="mt-2 border-t border-border pt-2">
                          <button onClick={() => setExpandedSearchResults(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })} className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700">
                            <Globe size={10} />{t('searchResultCount', { count: msg.webSearchResults.length })}{expandedSearchResults.has(i) ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                          </button>
                          {expandedSearchResults.has(i) && (
                            <div className="mt-1">{msg.webSearchResults.map((r, j) => (
                              <div key={j} className="mb-1 rounded bg-blue-50 px-2 py-1 text-[10px]"><a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline">{r.title}</a><p className="mt-0.5 line-clamp-2 text-text-secondary">{r.snippet}</p></div>
                            ))}</div>
                          )}
                        </div>
                      )}
                      {msg.contextDebug && (
                        <ContextDebugPanel data={msg.contextDebug} />
                      )}
                      {msg.createdAt && (
                        <p className={`mt-1.5 text-[10px] text-text-secondary/50 ${msg.role === "user" ? "text-right" : "text-left"}`}>
                          {formatTimeShort(msg.createdAt, locale)}
                        </p>
                      )}
                    </div>
                  </div>
                );
                i++;
              }
              return [out, i];
              }

              const [blocks] = renderBlock(0, -1);
              return blocks;
            })()}

            <div ref={messagesEndRef} />
          </div>

          {/* Input - DeepTutor-style composer */}
          <div className="border-t border-border bg-surface px-3 py-2.5">
            {isCreatingFork && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400">
                <Loader2 size={12} className="animate-spin" />
                <span>{t('creatingBranch')}</span>
              </div>
            )}
            <div className="relative rounded-2xl border border-border bg-card shadow-sm">
              {/* Card mention popup */}
              <CardMentionPopup
                workspaceId={workspaceId || ""}
                inputValue={input}
                cursorPosition={cursorPosition}
                mentionedCards={mentionedCards}
                onAdd={(card) => setMentionedCards((prev) => [...prev, card])}
                onRemove={(cardId) => setMentionedCards((prev) => prev.filter((c) => c.cardId !== cardId))}
              />
              {/* Textarea area */}
              <div className="px-3 pt-2.5 pb-1">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInputChange}
                  onSelect={(e) => setCursorPosition((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !isComposingRef.current) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  onCompositionStart={() => { isComposingRef.current = true; }}
                  onCompositionEnd={() => {
                    setTimeout(() => { isComposingRef.current = false; }, 0);
                  }}
                  placeholder={
                    forkMode
                      ? t('forkPlaceholder')
                      : t('chatPlaceholder')
                  }
                  className="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-text-secondary"
                  style={{ minHeight: 28, maxHeight: 160, transition: "height 0.15s ease-out" }}
                  rows={1}
                  disabled={isStreaming}
                />
              </div>

              {/* Toolbar */}
              <div className="border-t border-border/35 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5">
                  {!rightCollapsed && (
                    <>
                      {/* Web search toggle */}
                      <button
                        onClick={() => setWebSearch(!webSearch)}
                        className={`inline-flex shrink-0 items-center gap-1 py-1 px-1.5 text-[11px] font-medium transition-colors ${
                          webSearch ? "text-primary" : "text-text-secondary hover:text-foreground"
                        }`}
                        title={webSearch ? t('webSearch') : t('webSearch')}
                      >
                        <Globe size={12} />
                        {t('webSearch')}
                      </button>

                      <div className="h-3.5 w-px bg-border/30" />

                      {/* Fork toggle */}
                      <button
                        onClick={() => setForkMode(!forkMode)}
                        className={`inline-flex shrink-0 items-center gap-1 py-1 px-1.5 text-[11px] font-medium transition-colors ${
                          forkMode
                            ? "text-green-600"
                            : "text-text-secondary hover:text-foreground"
                        }`}
                        title={t('fork')}
                      >
                        <GitBranch size={12} />
                        {t('fork')}
                      </button>

                      <div className="h-3.5 w-px bg-border/30" />

                      {/* Retrieval depth selector */}
                      {[
                        { label: t('modeChat'), value: undefined },
                        { label: t('modeSearch'), value: 1 },
                        { label: t('modeGraph'), value: 2 },
                        { label: t('modeContext'), value: 3 },
                        { label: t('modeInsight'), value: 4 },
                      ].map((opt, idx) => (
                        <span key={opt.label} className="flex items-center">
                          {idx > 0 && <div className="h-3.5 w-px bg-border/30" />}
                          <button
                            onClick={() => {
                              setRetrievalLevel(opt.value);
                              lastRagLevelRef.current = opt.value;
                            }}
                            className={`inline-flex shrink-0 items-center gap-1 py-1 px-1.5 text-[11px] font-medium transition-colors ${
                              retrievalLevel === opt.value
                                ? "text-primary"
                                : "text-text-secondary hover:text-foreground"
                            }`}
                            title={t('searchDepth')}
                          >
                            {opt.label}
                          </button>
                        </span>
                      ))}
                    </>
                  )}

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Model Selector - hidden when collapsed */}
                  {!rightCollapsed && <ModelSelector compact />}

                  {/* Send / Stop button */}
                  {isStreaming ? (
                    <button
                      onClick={stopStream}
                      className="group relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-sm transition hover:bg-primary-dark"
                      title={t('stopGeneration')}
                    >
                      <span className="pointer-events-none absolute inset-0 rounded-full border-[1.5px] border-white/30 border-t-white/85 animate-spin opacity-90 transition-opacity group-hover:opacity-40" />
                      <Square size={8} strokeWidth={2.5} className="relative z-10 fill-current" />
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      disabled={!input.trim()}
                      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition disabled:opacity-25 disabled:shadow-none ${
                        forkMode
                          ? "bg-green-500 hover:bg-green-600"
                          : "bg-primary hover:bg-primary-dark"
                      }`}
                      title={forkMode ? t('forkAndSend') : t('send')}
                    >
                      <Send size={13} strokeWidth={2.5} className="-rotate-0 translate-x-[0.5px]" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (() => {
        const title = deletePreview?.chat_title || deleteTarget.title || t('newChat');
        const impacts: string[] = [];
        if (deletePreview) {
          if (deletePreview.messages > 0) impacts.push(t('deleteImpactMessages', { count: deletePreview.messages }));
          if (deletePreview.child_chats > 0) impacts.push(t('deleteImpactForks', { count: deletePreview.child_chats }));
          if (deletePreview.node_will_archive) impacts.push(t('deleteImpactNode', { title: deletePreview.node_title || '' }));
        }
        const impactText = impacts.length > 0 ? `\n${t('deleteImpactPrefix')}${impacts.join("、")}` : "";
        return (
          <ConfirmModal
            title={t('deleteTitle')}
            message={`${t('deleteConfirmMsg', { title })}${impactText}`}
            confirmText={tCommon('delete')}
            danger
            onConfirm={confirmDelete}
            onCancel={() => setDeleteTarget(null)}
          />
        );
      })()}

    </div>
  );
}

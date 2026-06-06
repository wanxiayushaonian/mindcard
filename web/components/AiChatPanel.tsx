"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { chatApi, aiApi, cardApi, workspaceApi, topologyApi, type RAGResponse, type WebSearchResult, type ChatSession, type ChatPathNode, type TopologyNode } from "@/lib/api";
import { UnifiedWSClient, createWSUrl, type StreamEvent } from "@/lib/unified-ws";
import { ModelSelector } from "@/components/ModelSelector";
import { toast } from "@/lib/toast";
import AssistantResponse from "@/components/AssistantResponse";
import { ConfirmModal } from "@/components/ConfirmModal";
import { ForkDivider } from "@/components/ForkDivider";
import { ForkBreadcrumb } from "@/components/ForkBreadcrumb";
import { usePanelStore } from "@/lib/workspace-layout-store";
import { X, History, MessageSquarePlus, Send, Square, ArrowLeft, Trash2, Globe, ChevronDown, ChevronUp, GitBranch, Copy, Sparkles, Loader2 } from "lucide-react";

const FORK_PREFIX = "__FORK__";

interface ForkMetaEntry {
  title: string;
  nodeId: string;
  collapsed: boolean;
  completed: boolean;
  msgId?: string;
  auto?: boolean;
  depth?: number;
}

function encodeForkContent(meta: Omit<ForkMetaEntry, "msgId">): string {
  return FORK_PREFIX + JSON.stringify(meta);
}

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
  childChatId?: string;
}

interface AiChatPanelProps {
  workspaceId: string;
  cardId?: string;
  onClose: () => void;
}

export function AiChatPanel({ workspaceId, cardId, onClose }: AiChatPanelProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatId, setChatIdRaw] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatSession[]>([]);

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
  const abortRef = useRef<(() => void) | null>(null);
  const wsClientRef = useRef<UnifiedWSClient | null>(null);
  const streamContentRef = useRef("");
  const webSearchResultsRef = useRef<WebSearchResult[] | undefined>(undefined);
  const [precipitatedBlocks, setPrecipitatedBlocks] = useState<Set<string>>(new Set());
  const precipitatedBlocksRef = useRef(precipitatedBlocks);
  precipitatedBlocksRef.current = precipitatedBlocks;
  const [precipitatingBlock, setPrecipitatingBlock] = useState<string | null>(null);
  const [webSearch, setWebSearch] = useState(false);
  const [expandedSearchResults, setExpandedSearchResults] = useState<Set<number>>(new Set());
  const [forkMode, setForkMode] = useState(false);
  const [forkMeta, setForkMeta] = useState<Record<string, ForkMetaEntry>>({});
  const [retrievalLevel, setRetrievalLevel] = useState<number | undefined>(undefined);
  const lastRagLevelRef = useRef<number | undefined>(undefined);
  const pendingForkRef = useRef<{ insertAt: number; syntheticId: string } | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const [activeChatIdState, setActiveChatIdState] = useState<string | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const [chatPath, setChatPath] = useState<ChatPathNode[]>([]);
  const isComposingRef = useRef(false);
  const streamingForkIdRef = useRef<string | null>(null);
  const streamingChatIdRef = useRef<string | null>(null);
  const forkChildIdRef = useRef<string | null>(null);  // child chat to switch to after stream
  const loadChatRef = useRef<(id: string) => Promise<boolean>>(() => Promise.resolve(false));
  const forkMetaRef = useRef<Record<string, ForkMetaEntry>>({});

  // Keep refs in sync
  useEffect(() => { chatIdRef.current = chatId; }, [chatId]);
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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Navigate breadcrumb — collapse current chat's forks, then load target
  const handleForkNavigate = useCallback(async (targetChatId: string) => {
    const currentChatId = chatIdRef.current;
    const currentForkMeta = forkMetaRef.current;

    // Collapse all fork dividers in the current chat and persist
    if (currentChatId && Object.keys(currentForkMeta).length > 0) {
      const updatedMeta: Record<string, ForkMetaEntry> = {};
      const persistPromises: Promise<any>[] = [];

      for (const [cid, meta] of Object.entries(currentForkMeta)) {
        if (!meta.collapsed) {
          const collapsedMeta = { ...meta, collapsed: true };
          updatedMeta[cid] = collapsedMeta;
          if (meta.msgId) {
            const { msgId: _, ...metaForEncode } = collapsedMeta;
            persistPromises.push(
              chatApi.updateMessage(currentChatId, meta.msgId, "fork-divider", encodeForkContent(metaForEncode))
                .catch((e) => console.error("Failed to persist collapse:", e))
            );
          }
        } else {
          updatedMeta[cid] = meta;
        }
      }

      setForkMeta(updatedMeta);
      // Wait for all persist calls before loading the new chat
      await Promise.all(persistPromises);
    }

    loadChatRef.current(targetChatId);
  }, []);

  // Initialize WebSocket client
  useEffect(() => {
    const handleEvent = (event: StreamEvent) => {
      // Stream-scoped events: only process if we're actively streaming
      const isStreamEvent = ["content", "web_search_results", "sources", "content_replace", "done", "error"].includes(event.type);
      if (isStreamEvent && !streamingChatIdRef.current) return;

      if (event.type === "content" && event.content) {
        // Accumulate content
        streamContentRef.current += event.content;
        const content = streamContentRef.current;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], content };
          return updated;
        });
      } else if (event.type === "web_search_results" && event.results) {
        // Web search results
        streamContentRef.current = "";
        webSearchResultsRef.current = event.results;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            webSearchResults: event.results,
            content: "",
          };
          setExpandedSearchResults((s) => new Set(s).add(updated.length - 1));
          return updated;
        });
      } else if (event.type === "sources" && event.source_cards) {
        // RAG sources
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            sources: event.source_cards,
          };
          return updated;
        });
      } else if (event.type === "auto_fork" && event.node_id) {
        // Auto-detected topic drift — insert lightweight fork divider
        const childChatId = `auto-${Date.now()}`;
        const title = event.title || "话题偏移";
        const meta: Omit<ForkMetaEntry, "msgId"> = {
          title,
          nodeId: event.node_id,
          collapsed: false,
          completed: false,
          auto: true,
        };
        setMessages((prev) => [
          ...prev,
          { role: "fork-divider" as const, content: encodeForkContent(meta), childChatId },
          { role: "assistant" as const, content: "" },
        ]);
        setForkMeta((prev) => ({ ...prev, [childChatId]: { ...meta, completed: false } }));
        activeChatIdRef.current = childChatId;
        // Don't setActiveChatIdState — synthetic ID would break breadcrumb path fetch
        // Persist divider to backend
        if (chatIdRef.current) {
          chatApi.addMessage(chatIdRef.current, "fork-divider", encodeForkContent(meta), undefined, undefined, { child_chat_id: childChatId })
            .then((saved) => {
              setForkMeta((p) => ({ ...p, [childChatId]: { ...p[childChatId], msgId: saved.id } }));
            })
            .catch((e) => console.error("Failed to save auto-fork divider:", e));
        }
      } else if (event.type === "fork_created" && event.chat_id) {
        // Server-created fork — child AiChat
        // Skip if a manual fork is already pending (topology-fork-complete will handle it)
        if (pendingForkRef.current) return;

        const childChatId = event.chat_id;
        const title = event.branch_label || "新分支";
        const depth = event.depth || 0;
        const meta: Omit<ForkMetaEntry, "msgId"> = {
          title,
          nodeId: "",
          collapsed: false,
          completed: true,
          depth,
        };
        setMessages((prev) => [
          ...prev,
          { role: "fork-divider" as const, content: encodeForkContent(meta), childChatId },
        ]);
        setForkMeta((prev) => ({ ...prev, [childChatId]: { ...meta, completed: true } }));
        activeChatIdRef.current = childChatId;
        setActiveChatIdState(childChatId);
        // Persist divider to backend with child_chat_id in metadata
        if (chatIdRef.current) {
          chatApi.addMessage(chatIdRef.current, "fork-divider", encodeForkContent(meta), undefined, undefined, { child_chat_id: childChatId })
            .then((saved) => {
              setForkMeta((p) => ({ ...p, [childChatId]: { ...p[childChatId], msgId: saved.id } }));
            })
            .catch((e) => console.error("Failed to save fork divider:", e));
        }
        toast.success(`话题偏移，已创建分支: ${title}`);
      } else if (event.type === "content_replace" && event.content) {
        // Server replaced the streamed content (e.g., stripped [BRANCH: ...] marker)
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
            updated[lastIdx] = { ...updated[lastIdx], content: event.content! };
          }
          return updated;
        });
        streamContentRef.current = event.content;
      } else if (event.type === "done") {
        // Stream completed
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          const finalContent = last.content || "模型未返回内容，请重试。";
          updated[updated.length - 1] = { ...last, content: finalContent, status: last.content ? "done" : "error" };
          return updated;
        });
        setIsStreaming(false);
        if (chatIdRef.current && streamContentRef.current && !streamingForkIdRef.current) {
          // Only save AI response to parent chat when NOT in fork mode
          saveMessage(chatIdRef.current, "assistant", streamContentRef.current, webSearchResultsRef.current);
        }
        // Mark the correct fork as completed (collapsible)
        // Use streamingForkIdRef to identify which fork this stream belonged to
        const completedForkId = streamingForkIdRef.current;
        streamingForkIdRef.current = null;
        streamingChatIdRef.current = null;
        // Keep activeChatIdRef pointing to the fork — breadcrumb and message tagging depend on it
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
        // After fork stream completes: copy parent messages to child, then switch
        const childId = forkChildIdRef.current;
        const parentId = chatIdRef.current;
        if (childId && parentId) {
          forkChildIdRef.current = null;
          (async () => {
            // Copy all parent messages (excluding fork-dividers) to the child chat
            const parentMessages = messagesRef.current.filter(
              (m) => m.role !== "fork-divider" && m.content
            );
            for (const msg of parentMessages) {
              try {
                await chatApi.addMessage(childId, msg.role, msg.content);
              } catch (e) {
                console.error("Failed to copy message to child:", e);
              }
            }
            // Switch to child chat
            setChatId(childId);
            chatIdRef.current = childId;
            loadChat(childId);
            loadHistory();
          })();
        }
      } else if (event.type === "error") {
        // Error occurred
        console.error("WebSocket stream error:", event.content);
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...last,
            content: last.content || "抱歉，处理问题时出错了。请稍后重试。",
            status: "error",
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
      toast.error("连接已断开");
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

  // Fetch chat path — prefer active fork, fall back to loaded chat
  useEffect(() => {
    const targetId = activeChatIdState || chatId;
    if (!targetId) {
      setChatPath([]);
      return;
    }
    chatApi.getChatPath(targetId)
      .then((res) => setChatPath(res.path))
      .catch((err) => {
        console.error("Failed to fetch chat path:", err);
        setChatPath([]);
      });
  }, [chatId, activeChatIdState]);

  // Listen for fork-complete: add inline fork divider at the correct position
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { nodeId: string; title: string; prompt: string; forkId?: string };
      if (!detail) return;
      // Use the real AiChat ID from topology API, not the temp local ID
      const realId = detail.nodeId;
      const syntheticId = pendingForkRef.current?.syntheticId;
      const insertAt = pendingForkRef.current?.insertAt;
      pendingForkRef.current = null;
      const title = detail.title || (detail.prompt || "").slice(0, 30) || "分支";
      const meta: ForkMetaEntry = { title, nodeId: realId, collapsed: false, completed: false };

      // Remap synthetic fork ID → real topology node ID
      setForkMeta((prev) => {
        const next = { ...prev };
        if (syntheticId && next[syntheticId]) {
          delete next[syntheticId];
        }
        next[realId] = meta;
        return next;
      });
      setMessages((prev) => {
        let updated = prev.map((m) =>
          m.childChatId === syntheticId ? { ...m, childChatId: realId } : m
        );
        const divider = { role: "fork-divider" as const, content: title, childChatId: realId };
        if (insertAt !== undefined && insertAt >= 0 && insertAt <= updated.length) {
          updated.splice(insertAt, 0, divider);
        } else {
          updated = [...updated, divider];
        }
        return updated;
      });
      // Update active fork ID to the real one — triggers path re-fetch via useEffect
      activeChatIdRef.current = realId;
      setActiveChatIdState(realId);
      // Store child ID for post-stream message copy
      forkChildIdRef.current = realId;
      // Persist fork divider to backend
      const cid = chatIdRef.current;
      if (cid) {
        try {
          const saved = await chatApi.addMessage(cid, "fork-divider", encodeForkContent(meta), undefined, undefined, { child_chat_id: realId });
          setForkMeta((prev) => ({ ...prev, [realId]: { ...prev[realId], msgId: saved.id } }));
        } catch (e) {
          console.error("Failed to persist fork divider:", e);
        }
      }
    };
    window.addEventListener("topology-fork-complete", handler);
    return () => window.removeEventListener("topology-fork-complete", handler);
  }, []);

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
          // Use child_chat_id from metadata if available, otherwise generate local ID
          const childChatId = m.metadata_?.child_chat_id || `fork-loaded-${m.id}`;
          if (parsed) {
            newForkMeta[childChatId] = { ...parsed, msgId: m.id };
          } else {
            newForkMeta[childChatId] = {
              title: m.metadata_?.branch_label || m.content || "分支",
              nodeId: "",
              collapsed: false,
              completed: true,
              msgId: m.id,
              depth: m.metadata_?.depth || 0,
            };
          }
          return { role: "fork-divider" as const, content: m.metadata_?.branch_label || parsed?.title || m.content || "分支", childChatId };
        }
        return {
          role: m.role as "user" | "assistant",
          content: m.content,
          webSearchResults: m.web_search_results || undefined,
        };
      });
      setMessages(msgs);
      setForkMeta(newForkMeta);
      setShowHistory(false);
      setForkMode(false);
      activeChatIdRef.current = null;
      setActiveChatIdState(null);
      return true;
    } catch {
      return false;
    }
  };
  loadChatRef.current = loadChat;

  // Restore last active chat on mount
  useEffect(() => {
    if (!workspaceId) return;
    const savedId = localStorage.getItem(chatStorageKey);
    if (savedId && !chatId) {
      loadChat(savedId).then((ok) => {
        if (!ok) {
          // Chat was deleted or invalid — clear stale localStorage entry
          localStorage.removeItem(chatStorageKey);
        }
      });
    }
  }, [workspaceId]);

  const startNewChat = () => {
    stopStream();
    setChatId(null);
    setMessages([]);
    setShowHistory(false);
    setForkMeta({});
    setForkMode(false);
    activeChatIdRef.current = null;
    setActiveChatIdState(null);
    pendingForkRef.current = null;
  };

  const stopStream = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const saveMessage = async (cid: string, role: string, content: string, webSearchResults?: WebSearchResult[]) => {
    try {
      await chatApi.addMessage(cid, role, content, webSearchResults);
    } catch (e) {
      console.error("Failed to save message:", e);
    }
  };

  const handlePrecipitateBlock = useCallback(async (blockText: string) => {
    if (!workspaceId) {
      toast("请从空间页面进入以使用沉淀功能", "error");
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
        title = firstLine.replace(/^#+\s*/, "").slice(0, 30) || "未命名";
      }
      const created = await cardApi.create({
        local_id: "card_" + Date.now(),
        workspace_id: workspaceId,
        title,
        content: blockText,
        keywords,
      });
      setPrecipitatedBlocks((prev) => new Set(prev).add(key));
      toast("已沉淀为卡片", "success");
      window.dispatchEvent(new CustomEvent("card-precipitated", { detail: { cardId: created.id } }));
    } catch (e: any) {
      toast("沉淀失败: " + e.message, "error");
    } finally {
      setPrecipitatingBlock(null);
    }
  }, [workspaceId]);

  const doSend = async (question: string) => {
    if (!question.trim() || isStreaming) return;

    setIsStreaming(true);
    streamContentRef.current = "";
    webSearchResultsRef.current = undefined;

    const activeChildChatId = activeChatIdRef.current;
    streamingForkIdRef.current = activeChildChatId;  // track which fork this stream belongs to
    setMessages((prev) => [...prev, { role: "user", content: question, childChatId: activeChildChatId || undefined }]);
    const loadingHint = webSearch ? "正在搜索网页..." : "";
    setMessages((prev) => [...prev, { role: "assistant", content: loadingHint, childChatId: activeChildChatId || undefined }]);

    let currentChatId = chatId;
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

    if (currentChatId && !activeChildChatId) {
      // Only save to parent chat when NOT in fork mode
      saveMessage(currentChatId, "user", question);
    }

    // Track which chat this stream belongs to (for scoping WS events)
    streamingChatIdRef.current = currentChatId;

    // Reset stream state
    streamContentRef.current = "";
    webSearchResultsRef.current = undefined;

    // Build history (exclude fork dividers) — use ref to avoid stale closure
    const hist = messagesRef.current
      .filter((m) => m.content && m.role !== "fork-divider")
      .map((m) => ({ role: m.role, content: m.content }));

    // Send via WebSocket
    if (!wsClientRef.current?.connected) {
      toast.error("WebSocket未连接，请刷新页面");
      setIsStreaming(false);
      return;
    }

    wsClientRef.current.send({
      type: "rag",
      question: question,
      workspace_ids: [workspaceId],
      card_id: cardId,
      top_k: 5,
      web_search: webSearch,
      history: hist,
      retrieval_level: retrievalLevel,
      chat_id: currentChatId || undefined,
      current_fork_id: activeChatIdRef.current || undefined,
    });

    // Set abort function to cancel via WebSocket
    abortRef.current = () => {
      wsClientRef.current?.send({ type: "cancel" });
    };
  };

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    const question = input.trim();
    setInput("");
    if (forkMode) {
      setForkMode(false);
      const childChatId = `fork-${Date.now()}`;
      activeChatIdRef.current = childChatId;
      // Don't setActiveChatIdState with synthetic ID — topology-fork-complete will set real ID
      pendingForkRef.current = { insertAt: messages.length, syntheticId: childChatId };
      doSend(question);
      window.dispatchEvent(new CustomEvent("topology-fork-request", { detail: { prompt: question, forkId: childChatId, chatId: chatIdRef.current } }));
    } else {
      doSend(question);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await chatApi.delete(deleteTarget.id);
      setHistory((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      // Remove fork divider messages referencing this branch
      setMessages((prev) => prev.filter((m) => m.childChatId !== deleteTarget.id));
      // Remove from fork metadata and update active state
      setForkMeta((prev) => {
        const next = { ...prev };
        delete next[deleteTarget.id];
        return next;
      });
      if (activeChatIdRef.current === deleteTarget.id) {
        activeChatIdRef.current = null;
        setActiveChatIdState(null);
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
              <span className="text-xs font-medium text-text">知识问答</span>
            </div>

            {Object.keys(forkMeta).length > 0 && (
              <div className="flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] text-green-700">
                <GitBranch size={10} />
                {Object.keys(forkMeta).length} 分支
              </div>
            )}

            {forkMode && (
              <div className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 animate-pulse">
                <GitBranch size={10} />
                分叉模式
                <button onClick={() => setForkMode(false)} className="ml-0.5 text-amber-400 hover:text-amber-600">×</button>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-1">
            <Sparkles size={14} className="text-primary" />
            <span className="text-[11px] font-medium">知识问答</span>
          </div>
        )}

        {/* Right: action buttons */}
        <div className="ml-auto flex items-center gap-1">
          {!rightCollapsed && (
            <>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`rounded-lg p-1.5 transition ${
                  showHistory ? "bg-primary/10 text-primary-dark" : "text-text-secondary hover:bg-gray-100"
                }`}
                title="历史对话"
              >
                <History size={15} />
              </button>
              <button
                onClick={startNewChat}
                className="rounded-lg p-1.5 text-text-secondary transition hover:bg-gray-100"
                title="新对话"
              >
                <MessageSquarePlus size={15} />
              </button>
            </>
          )}
          {!rightCollapsed && (
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-text-secondary transition hover:bg-gray-100"
              title="关闭 AI 对话面板"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* History sub-panel */}
        {showHistory && (
          <div className="absolute inset-0 z-10 flex flex-col bg-bg">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <button
                onClick={() => setShowHistory(false)}
                className="rounded-lg p-1 text-text-secondary hover:bg-gray-100"
              >
                <ArrowLeft size={15} />
              </button>
              <span className="text-xs font-medium text-text">对话历史</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {history.length === 0 && (
                <p className="px-2 py-4 text-center text-xs text-text-secondary">暂无历史记录</p>
              )}
              {(() => {
                // Group: parent chats first, then children under them
                const parents = history.filter((c) => !c.parent_id);
                const childrenMap = new Map<string, ChatSession[]>();
                for (const c of history) {
                  if (c.parent_id) {
                    const arr = childrenMap.get(c.parent_id) || [];
                    arr.push(c);
                    childrenMap.set(c.parent_id, arr);
                  }
                }
                return parents.map((chat) => {
                  const children = childrenMap.get(chat.id) || [];
                  return (
                    <div key={chat.id}>
                      <div
                        onClick={() => loadChat(chat.id)}
                        className={`group mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-gray-100 ${
                          chatId === chat.id ? "bg-primary/10 text-primary-dark" : "text-text"
                        }`}
                      >
                        <span className="line-clamp-1 flex-1">{chat.title || "新对话"}</span>
                        {children.length > 0 && (
                          <span className="flex-shrink-0 rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] text-green-600">
                            {children.length} 分支
                          </span>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(chat); }}
                          className="hidden text-text-secondary hover:text-danger group-hover:block"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      {children.map((child) => (
                        <div
                          key={child.id}
                          onClick={() => loadChat(child.id)}
                          className={`group mb-1 ml-4 flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition hover:bg-gray-100 ${
                            chatId === child.id ? "bg-green-50 text-green-700" : "text-text-secondary"
                          }`}
                        >
                          <GitBranch size={10} className="shrink-0 text-green-400" />
                          <span className="line-clamp-1 flex-1">{child.title || "分支"}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(child); }}
                            className="hidden text-text-secondary hover:text-danger group-hover:block"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* Chat area — flex layout so breadcrumb stays pinned */}
        {!rightCollapsed && chatPath.length > 0 && (
          <ForkBreadcrumb
            path={chatPath}
            activeChatId={activeChatIdState || chatId}
            onNavigate={handleForkNavigate}
            topologyNodes={topologyNodes}
          />
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center text-text-secondary">
                <div className="mb-3 text-3xl font-bold text-primary/30">AI</div>
                <p className="text-sm font-medium">基于你的灵感卡片回答问题</p>
                <p className="mt-1 text-xs">提问关于你的灵感、想法或知识的问题</p>
              </div>
            )}

            {messages.map((msg, i) => {
              // Fork divider
              if (msg.role === "fork-divider" && msg.childChatId) {
                const meta = forkMeta[msg.childChatId];
                if (!meta) return null;
                // Count messages in this fork
                const forkMsgCount = messages.filter(
                  (m, j) => j > i && (m.childChatId === msg.childChatId || (!m.childChatId && !messages.slice(i + 1, j).some(k => k.role === "fork-divider")))
                ).length;
                return (
                  <ForkDivider
                    key={i}
                    childChatId={msg.childChatId}
                    label={meta.title}
                    depth={meta.depth || 0}
                    messageCount={forkMsgCount}
                    collapsed={meta.collapsed}
                    onToggle={(cid) => {
                      setForkMeta((prev) => {
                        const updated = { ...prev[cid], collapsed: !prev[cid].collapsed };
                        // Persist collapse state to backend
                        if (updated.msgId && chatIdRef.current) {
                          const { msgId, ...metaForEncode } = updated;
                          chatApi.updateMessage(
                            chatIdRef.current, msgId, "fork-divider", encodeForkContent(metaForEncode)
                          ).catch((e) => console.error("Failed to persist collapse state:", e));
                        }
                        return { ...prev, [cid]: updated };
                      });
                    }}
                  />
                );
              }

              // Skip messages belonging to a collapsed fork
              // New messages have childChatId directly; loaded messages use position-based detection
              if (msg.childChatId) {
                const meta = forkMeta[msg.childChatId];
                if (meta?.collapsed) return null;
              } else {
                // Position-based fallback for loaded messages without childChatId
                let inCollapsedFork = false;
                for (let j = i - 1; j >= 0; j--) {
                  const prev = messages[j];
                  if (prev.role === "fork-divider" && prev.childChatId) {
                    const meta = forkMeta[prev.childChatId];
                    if (meta?.collapsed) {
                      // Check if there's another fork-divider between j and i
                      let nextForkBetween = false;
                      for (let k = j + 1; k < i; k++) {
                        if (messages[k].role === "fork-divider") {
                          nextForkBetween = true;
                          break;
                        }
                      }
                      // Also check: if no fork-divider between but the fork is completed,
                      // this message is after the fork ended (main conversation)
                      if (!nextForkBetween && !meta.completed) inCollapsedFork = true;
                    }
                    break;
                  }
                }
                if (inCollapsedFork) return null;
              }

              // Regular message
              return (
                <div key={i} className={`group/msg mb-3 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 backdrop-blur-sm ${
                      msg.role === "user"
                        ? "bg-primary/20 text-foreground border border-primary/30 shadow-sm"
                        : "bg-surface text-text shadow-sm"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      msg.content === "正在搜索网页..." ? (
                        <div className="flex items-center gap-2 text-sm text-text-secondary">
                          <Globe size={14} className="animate-pulse" />
                          <span className="animate-pulse">{msg.content}</span>
                        </div>
                      ) : isStreaming && i === messages.length - 1 && !msg.content ? (
                        <div className="flex items-center gap-2 text-sm text-text-secondary">
                          <Loader2 size={14} className="animate-spin text-primary" />
                          <span className="animate-pulse">思考中...</span>
                        </div>
                      ) : (
                        <>
                          <AssistantResponse
                            content={msg.content || " "}
                            className="text-[14px] leading-[1.75]"
                          />
                          {msg.status === "error" && (
                            <p className="mt-1 text-xs text-amber-600">回答中断，内容可能不完整</p>
                          )}
                          {msg.content && msg.content.trim() && (
                            <div className="mt-2 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const msgIdx = messages.indexOf(msg);
                                  const userMsg = msgIdx > 0 ? messages[msgIdx - 1] : null;
                                  const prompt = userMsg?.content || "继续深入探讨";
                                  window.dispatchEvent(new CustomEvent("topology-fork-request", { detail: { prompt } }));
                                }}
                                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-secondary transition hover:bg-green-50 hover:text-green-600"
                                title="从此处分叉对话"
                              >
                                <GitBranch size={10} />
                                分叉
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  usePanelStore.getState().appendToEditor(msg.content);
                                  toast("已复制到编辑器", "success");
                                }}
                                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-secondary transition hover:bg-gray-100 hover:text-foreground"
                                title="复制到编辑器"
                              >
                                <Copy size={10} />
                                复制到编辑器
                              </button>
                            </div>
                          )}
                        </>
                      )
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                    )}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2 border-t border-border pt-2">
                        <p className="mb-1.5 text-[10px] text-text-secondary">引用来源：</p>
                        <div className="flex flex-col gap-1">
                          {msg.sources.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => {
                                onClose();
                                router.push(`/workspaces/${workspaceId}/card/${s.id}`);
                              }}
                              className="flex items-start gap-2 rounded-lg border border-border/50 bg-gray-50/80 px-2.5 py-1.5 text-left text-[11px] transition hover:border-primary/30 hover:bg-primary/5"
                            >
                              <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: s.color || "#B8D4E3" }} />
                              <div className="min-w-0 flex-1">
                                {s.title && <span className="block font-medium text-text">{s.title}</span>}
                                <span className="line-clamp-1 text-text-secondary">{s.content}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {msg.webSearchResults && msg.webSearchResults.length > 0 && (
                      <div className="mt-2 border-t border-border pt-2">
                        <button
                          onClick={() => setExpandedSearchResults((s) => {
                            const next = new Set(s);
                            if (next.has(i)) next.delete(i); else next.add(i);
                            return next;
                          })}
                          className="flex w-full items-center gap-1 text-[10px] text-text-secondary hover:text-text"
                        >
                          <Globe size={10} />
                          <span>网页搜索结果 ({msg.webSearchResults.length})</span>
                          {expandedSearchResults.has(i) ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                        </button>
                        {expandedSearchResults.has(i) && (
                          <div className="mt-1">
                            {msg.webSearchResults.map((r, j) => (
                              <div key={j} className="mb-1 rounded bg-blue-50 px-2 py-1 text-[10px]">
                                <a
                                  href={r.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-medium text-blue-600 hover:underline"
                                >
                                  {r.title}
                                </a>
                                <p className="mt-0.5 line-clamp-2 text-text-secondary">{r.snippet}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            <div ref={messagesEndRef} />
          </div>

          {/* Input - DeepTutor-style composer */}
          <div className="border-t border-border bg-surface px-3 py-2.5">
            <div className="rounded-2xl border border-border bg-card shadow-sm">
              {/* Textarea area */}
              <div className="px-3 pt-2.5 pb-1">
                <textarea
                  ref={(el) => {
                    if (el) {
                      el.style.height = "28px";
                      const next = Math.min(Math.max(el.scrollHeight, 28), 160);
                      el.style.height = `${next}px`;
                      el.style.overflowY = el.scrollHeight > 160 ? "auto" : "hidden";
                    }
                  }}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
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
                      ? "你想深入了解什么？输入后回车创建分支..."
                      : "问一个关于灵感的问题..."
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
                        title={webSearch ? "关闭网页搜索" : "开启网页搜索"}
                      >
                        <Globe size={12} />
                        联网
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
                        title="创建知识分支"
                      >
                        <GitBranch size={12} />
                        分叉
                      </button>

                      <div className="h-3.5 w-px bg-border/30" />

                      {/* Retrieval depth selector */}
                      {[
                        { label: "自动", value: undefined },
                        { label: "卡片", value: 1 },
                        { label: "图谱", value: 2 },
                        { label: "全量", value: 3 },
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
                            title="检索深度"
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
                      title="停止生成"
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
                      title={forkMode ? "创建分支并发送" : "发送"}
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
        const title = deletePreview?.chat_title || deleteTarget.title || "新对话";
        const impacts: string[] = [];
        if (deletePreview) {
          if (deletePreview.messages > 0) impacts.push(`${deletePreview.messages} 条消息`);
          if (deletePreview.child_chats > 0) impacts.push(`${deletePreview.child_chats} 个分支对话`);
          if (deletePreview.node_will_archive) impacts.push(`拓扑节点「${deletePreview.node_title}」将被归档`);
        }
        const impactText = impacts.length > 0 ? `\n将同时删除：${impacts.join("、")}` : "";
        return (
          <ConfirmModal
            title="删除对话"
            message={`确定删除「${title}」？删除后无法恢复。${impactText}`}
            confirmText="删除"
            danger
            onConfirm={confirmDelete}
            onCancel={() => setDeleteTarget(null)}
          />
        );
      })()}

    </div>
  );
}

"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { chatApi, aiApi, cardApi, workspaceApi, type RAGResponse, type WebSearchResult, type ChatSession, type ChatPathNode } from "@/lib/api";
import { UnifiedWSClient, createWSUrl, type StreamEvent } from "@/lib/unified-ws";
import { ModelSelector } from "@/components/ModelSelector";
import { toast } from "@/lib/toast";
import AssistantResponse from "@/components/AssistantResponse";
import { ConfirmModal } from "@/components/ConfirmModal";
import { usePanelStore } from "@/lib/workspace-layout-store";
import { X, History, MessageSquarePlus, Send, Square, ArrowLeft, Trash2, Globe, ChevronDown, ChevronUp, GitBranch, ChevronRight, Copy, Sparkles } from "lucide-react";

const FORK_PREFIX = "__FORK__";

interface ForkMetaEntry {
  title: string;
  nodeId: string;
  collapsed: boolean;
  completed: boolean;
  msgId?: string;
  auto?: boolean;
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
  forkId?: string;
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
  const [chatId, setChatId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null);
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
  const pendingForkRef = useRef<{ insertAt: number } | null>(null);
  const activeForkIdRef = useRef<string | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const [chatPath, setChatPath] = useState<ChatPathNode[]>([]);
  const isComposingRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { chatIdRef.current = chatId; }, [chatId]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const { data: workspace } = useSWR(
    workspaceId ? `workspace-${workspaceId}` : null,
    () => workspaceApi.get(workspaceId)
  );
  const canPrecipitate = workspace?.member_role === "owner";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Initialize WebSocket client
  useEffect(() => {
    const handleEvent = (event: StreamEvent) => {
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
        const forkId = `auto-${Date.now()}`;
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
          { role: "fork-divider" as const, content: encodeForkContent(meta), forkId },
          { role: "assistant" as const, content: "" },
        ]);
        setForkMeta((prev) => ({ ...prev, [forkId]: { ...meta, completed: false } }));
        activeForkIdRef.current = forkId;
        // Persist divider to backend
        if (chatIdRef.current) {
          chatApi.addMessage(chatIdRef.current, "fork-divider", encodeForkContent(meta), undefined, forkId)
            .then((saved) => {
              setForkMeta((p) => ({ ...p, [forkId]: { ...p[forkId], msgId: saved.id } }));
            })
            .catch((e) => console.error("Failed to save auto-fork divider:", e));
        }
      } else if (event.type === "done") {
        // Stream completed
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], status: "done" };
          return updated;
        });
        setIsStreaming(false);
        if (chatIdRef.current && streamContentRef.current) {
          saveMessage(chatIdRef.current, "assistant", streamContentRef.current, webSearchResultsRef.current, activeForkIdRef.current || undefined);
        }
        // Mark the last fork as completed (collapsible)
        // Clear active fork ID so subsequent messages aren't tagged
        activeForkIdRef.current = null;
        setForkMeta((prev) => {
          const entries = Object.entries(prev);
          if (entries.length === 0) return prev;
          const [lastKey, lastVal] = entries[entries.length - 1];
          if (!lastVal.completed) {
            // Persist completion to backend
            if (lastVal.msgId && chatIdRef.current) {
              const updatedMeta = { ...lastVal, completed: true };
              chatApi.updateMessage(chatIdRef.current, lastVal.msgId, "fork-divider", encodeForkContent(updatedMeta)).catch((e) =>
                console.error("Failed to persist fork completion:", e)
              );
            }
            return { ...prev, [lastKey]: { ...lastVal, completed: true } };
          }
          return prev;
        });
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
    chatApi.list(workspaceId || undefined).then(setHistory).catch(() => {});
  }, [workspaceId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Fetch chat path when chatId changes
  useEffect(() => {
    if (!chatId) {
      setChatPath([]);
      return;
    }
    chatApi.getChatPath(chatId)
      .then((res) => setChatPath(res.path))
      .catch((err) => {
        console.error("Failed to fetch chat path:", err);
        setChatPath([]);
      });
  }, [chatId]);

  // Listen for fork-complete: add inline fork divider at the correct position
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { nodeId: string; title: string; prompt: string; forkId?: string };
      if (!detail) return;
      const forkId = detail.forkId || `fork-${Date.now()}`;
      const title = detail.title || (detail.prompt || "").slice(0, 30) || "分支";
      const meta: ForkMetaEntry = { title, nodeId: detail.nodeId, collapsed: false, completed: false };
      setForkMeta((prev) => ({ ...prev, [forkId]: meta }));
      const insertAt = pendingForkRef.current?.insertAt;
      pendingForkRef.current = null;
      setMessages((prev) => {
        const divider = { role: "fork-divider" as const, content: title, forkId };
        if (insertAt !== undefined && insertAt >= 0 && insertAt <= prev.length) {
          const updated = [...prev];
          updated.splice(insertAt, 0, divider);
          return updated;
        }
        return [...prev, divider];
      });
      // Tag subsequent messages with this fork ID
      activeForkIdRef.current = forkId;
      // Persist fork divider to backend
      const cid = chatIdRef.current;
      if (cid) {
        try {
          const saved = await chatApi.addMessage(cid, "fork-divider", encodeForkContent(meta), undefined, forkId);
          setForkMeta((prev) => ({ ...prev, [forkId]: { ...prev[forkId], msgId: saved.id } }));
        } catch (e) {
          console.error("Failed to persist fork divider:", e);
        }
      }
    };
    window.addEventListener("topology-fork-complete", handler);
    return () => window.removeEventListener("topology-fork-complete", handler);
  }, []);

  const loadChat = async (id: string) => {
    stopStream();
    try {
      const detail = await chatApi.get(id);
      setChatId(detail.id);
      // Reconstruct fork dividers from stored messages
      const newForkMeta: Record<string, ForkMetaEntry> = {};
      const msgs: Message[] = detail.messages.map((m) => {
        if (m.role === "fork-divider" || m.content.startsWith(FORK_PREFIX)) {
          const parsed = decodeForkContent(m.content);
          const forkId = `fork-loaded-${m.id}`;
          if (parsed) {
            newForkMeta[forkId] = { ...parsed, msgId: m.id };
          } else {
            newForkMeta[forkId] = { title: m.content, nodeId: "", collapsed: false, completed: false, msgId: m.id };
          }
          return { role: "fork-divider" as const, content: parsed?.title || m.content, forkId };
        }
        return {
          role: m.role as "user" | "assistant",
          content: m.content,
          webSearchResults: m.web_search_results || undefined,
          forkId: m.fork_id || undefined,
        };
      });
      setMessages(msgs);
      setForkMeta(newForkMeta);
      setShowHistory(false);
      setForkMode(false);
      activeForkIdRef.current = null;
    } catch {}
  };

  const startNewChat = () => {
    stopStream();
    setChatId(null);
    setMessages([]);
    setShowHistory(false);
    setForkMeta({});
    setForkMode(false);
  };

  const stopStream = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const saveMessage = async (cid: string, role: string, content: string, webSearchResults?: WebSearchResult[], forkId?: string) => {
    try {
      await chatApi.addMessage(cid, role, content, webSearchResults, forkId);
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
      try {
        const [titleRes, kwRes] = await Promise.all([
          aiApi.generateTitle(blockText),
          aiApi.extractKeywords(blockText),
        ]);
        title = titleRes.title || "";
        keywords = kwRes.keywords || [];
      } catch {
        // LLM call failed
      }
      // Fallback if API returned empty
      if (!title) {
        const firstLine = blockText.split("\n").find((l) => l.trim()) || "";
        title = firstLine.replace(/^#+\s*/, "").slice(0, 30) || "未命名";
      }
      await cardApi.create({
        local_id: "card_" + Date.now(),
        workspace_id: workspaceId,
        title,
        content: blockText,
        keywords,
      });
      setPrecipitatedBlocks((prev) => new Set(prev).add(key));
      toast("已沉淀为卡片", "success");
      window.dispatchEvent(new CustomEvent("card-precipitated"));
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

    const activeForkId = activeForkIdRef.current;
    setMessages((prev) => [...prev, { role: "user", content: question, forkId: activeForkId || undefined }]);
    const loadingHint = webSearch ? "正在搜索网页..." : "";
    setMessages((prev) => [...prev, { role: "assistant", content: loadingHint, forkId: activeForkId || undefined }]);

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
        loadHistory();
      } catch (e) {
        console.error("Failed to create chat:", e);
      }
    }

    if (currentChatId) {
      saveMessage(currentChatId, "user", question, undefined, activeForkId || undefined);
    }

    // Reset stream state
    streamContentRef.current = "";
    webSearchResultsRef.current = undefined;

    // Build history (exclude fork dividers)
    const hist = messages
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
      const forkId = `fork-${Date.now()}`;
      activeForkIdRef.current = forkId;
      pendingForkRef.current = { insertAt: messages.length };
      doSend(question);
      window.dispatchEvent(new CustomEvent("topology-fork-request", { detail: { prompt: question, forkId } }));
    } else {
      doSend(question);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await chatApi.delete(deleteTarget.id);
      setHistory((prev) => prev.filter((c) => c.id !== deleteTarget.id));
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
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-secondary transition hover:bg-gray-100"
            title="关闭"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {/* Breadcrumb Navigation */}
        {!rightCollapsed && chatPath.length > 0 && (
          <div className="border-b border-border bg-surface/50 px-3 py-2">
            <div className="flex items-center gap-1 text-xs text-text-secondary overflow-x-auto">
              {chatPath.map((node, idx) => (
                <div key={node.node_id} className="flex items-center gap-1">
                  {idx > 0 && <ChevronRight size={12} className="shrink-0" />}
                  <button
                    onClick={() => {
                      if (node.chat_id) {
                        loadChat(node.chat_id);
                      }
                    }}
                    disabled={!node.chat_id}
                    className={`shrink-0 rounded px-2 py-0.5 transition ${
                      node.chat_id
                        ? "hover:bg-primary/10 hover:text-primary-dark cursor-pointer"
                        : "cursor-default opacity-60"
                    } ${idx === chatPath.length - 1 ? "font-medium text-text" : ""}`}
                    title={node.title}
                  >
                    {node.title}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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
                const parents = history.filter((c) => !c.parent_chat_id);
                const childrenMap = new Map<string, ChatSession[]>();
                for (const c of history) {
                  if (c.parent_chat_id) {
                    const arr = childrenMap.get(c.parent_chat_id) || [];
                    arr.push(c);
                    childrenMap.set(c.parent_chat_id, arr);
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

        {/* Chat area */}
        <div className="flex h-full flex-col">
          <div className="flex-1 overflow-y-auto px-3 py-4">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center text-text-secondary">
                <div className="mb-3 text-3xl font-bold text-primary/30">AI</div>
                <p className="text-sm font-medium">基于你的灵感卡片回答问题</p>
                <p className="mt-1 text-xs">提问关于你的灵感、想法或知识的问题</p>
              </div>
            )}

            {messages.map((msg, i) => {
              // Fork divider
              if (msg.role === "fork-divider" && msg.forkId) {
                const meta = forkMeta[msg.forkId];
                if (!meta) return null;
                const canToggle = meta.completed;
                const isAuto = meta.auto;
                return (
                  <div key={i} className="my-3 flex items-center gap-2">
                    <div className={`h-px flex-1 ${isAuto ? "border-t border-dashed border-gray-200" : meta.completed ? "bg-gray-300/50" : "border-t border-dashed border-green-400/60"}`} style={isAuto ? { background: "transparent" } : undefined} />
                    <button
                      onClick={() => canToggle && setForkMeta((prev) => ({
                        ...prev,
                        [msg.forkId!]: { ...prev[msg.forkId!], collapsed: !prev[msg.forkId!].collapsed },
                      }))}
                      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition ${
                        isAuto
                          ? "cursor-pointer border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100"
                          : meta.completed
                            ? "cursor-pointer border-gray-300/50 bg-gray-50 text-gray-600 hover:bg-gray-100"
                            : "cursor-default border-green-400/60 bg-green-50 text-green-600 animate-[pulse_1.2s_ease-in-out_infinite]"
                      }`}
                    >
                      <GitBranch size={isAuto ? 9 : 11} />
                      <span className="max-w-[200px] truncate">{meta.title}</span>
                      {canToggle && (meta.collapsed ? <ChevronDown size={11} /> : <ChevronUp size={11} />)}
                    </button>
                    <div className={`h-px flex-1 ${isAuto ? "border-t border-dashed border-gray-200" : meta.completed ? "bg-gray-300/50" : "border-t border-dashed border-green-400/60"}`} style={isAuto ? { background: "transparent" } : undefined} />
                  </div>
                );
              }

              // Skip messages belonging to a collapsed fork
              // New messages have forkId directly; loaded messages use position-based detection
              if (msg.forkId) {
                const meta = forkMeta[msg.forkId];
                if (meta?.collapsed) return null;
              } else {
                // Position-based fallback for loaded messages without forkId
                let inCollapsedFork = false;
                for (let j = i - 1; j >= 0; j--) {
                  const prev = messages[j];
                  if (prev.role === "fork-divider" && prev.forkId) {
                    const meta = forkMeta[prev.forkId];
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
                    className={`max-w-[85%] rounded-2xl px-3 py-2.5 ${
                      msg.role === "user"
                        ? "bg-primary text-white"
                        : "bg-surface text-text shadow-sm"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      msg.content === "正在搜索网页..." ? (
                        <div className="flex items-center gap-2 text-sm text-text-secondary">
                          <Globe size={14} className="animate-pulse" />
                          <span className="animate-pulse">{msg.content}</span>
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
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <ConfirmModal
          title="删除对话"
          message={`确定删除「${deleteTarget.title || "新对话"}」？删除后无法恢复。`}
          confirmText="删除"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

    </div>
  );
}

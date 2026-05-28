"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ragApi, chatApi, aiApi, cardApi, workspaceApi, settingsApi, topologyApi, type RAGResponse, type WebSearchResult, type ChatSession } from "@/lib/api";
import { ModelSelector } from "@/components/ModelSelector";
import { toast } from "@/lib/toast";
import { MarkdownContent } from "@/components/MarkdownContent";
import { ConfirmModal } from "@/components/ConfirmModal";
import { X, History, MessageSquarePlus, Send, Square, ArrowLeft, Trash2, Globe, ChevronDown, ChevronUp, FileText, GitBranch } from "lucide-react";

type ChatMode = "rag" | "chat";

interface Message {
  role: "user" | "assistant";
  content: string;
  status?: "done" | "error";
  sources?: RAGResponse["source_cards"];
  webSearchResults?: WebSearchResult[];
}

interface AiChatPanelProps {
  workspaceId: string;
  cardId?: string;
  onClose: () => void;
}

export function AiChatPanel({ workspaceId, cardId, onClose }: AiChatPanelProps) {
  const router = useRouter();
  const [mode, setMode] = useState<ChatMode>("rag");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const streamContentRef = useRef("");
  const webSearchResultsRef = useRef<WebSearchResult[] | undefined>(undefined);
  const [precipitatedBlocks, setPrecipitatedBlocks] = useState<Set<string>>(new Set());
  const precipitatedBlocksRef = useRef(precipitatedBlocks);
  precipitatedBlocksRef.current = precipitatedBlocks;
  const [precipitatingBlock, setPrecipitatingBlock] = useState<string | null>(null);
  const [webSearch, setWebSearch] = useState(false);
  const [globalRag, setGlobalRag] = useState(false);
  const [expandedSearchResults, setExpandedSearchResults] = useState<Set<number>>(new Set());
  const [forkMode, setForkMode] = useState(false);
  const [branches, setBranches] = useState<{ chatId: string | null; messages: Message[]; title: string; nodeId: string; parentChatId: string | null }[]>([]);
  const [activeBranchIdx, setActiveBranchIdx] = useState<number | null>(null); // null = main
  const mainChatIdRef = useRef<string | null>(null);
  const mainMessagesRef = useRef<Message[]>([]);
  const chatIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const [pendingAutoSend, setPendingAutoSend] = useState<string | null>(null);

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

  useEffect(() => {
    return () => { abortRef.current?.(); };
  }, []);

  const loadHistory = useCallback(() => {
    chatApi.list(workspaceId || undefined).then(setHistory).catch(() => {});
  }, [workspaceId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Listen for fork-complete: save current, create branch, switch, auto-send
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { nodeId: string; title: string; prompt: string };
      if (!detail) return;
      // Save current conversation
      if (activeBranchIdx === null) {
        mainChatIdRef.current = chatIdRef.current;
        mainMessagesRef.current = messagesRef.current;
      } else {
        setBranches((prev) =>
          prev.map((b, i) => (i === activeBranchIdx ? { ...b, chatId: chatIdRef.current, messages: messagesRef.current } : b))
        );
      }
      // Create new branch
      const newBranch = { chatId: null as string | null, messages: [] as Message[], title: detail.title, nodeId: detail.nodeId, parentChatId: chatIdRef.current };
      setBranches((prev) => [...prev, newBranch]);
      // Switch to new branch
      setChatId(null);
      setMessages([]);
      setActiveBranchIdx(branches.length);
      // Auto-send
      if (detail.prompt) {
        setPendingAutoSend(detail.prompt);
      }
    };
    window.addEventListener("topology-fork-complete", handler);
    return () => window.removeEventListener("topology-fork-complete", handler);
  }, [activeBranchIdx, branches.length]);

  // Auto-send when pending
  useEffect(() => {
    if (!pendingAutoSend) return;
    const prompt = pendingAutoSend;
    setPendingAutoSend(null);
    const timer = setTimeout(() => doSend(prompt), 100);
    return () => clearTimeout(timer);
  }, [pendingAutoSend]);

  const loadChat = async (id: string) => {
    stopStream();
    try {
      const detail = await chatApi.get(id);
      setChatId(detail.id);
      setMode(detail.mode as ChatMode);
      setMessages(
        detail.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
          webSearchResults: m.web_search_results || undefined,
        }))
      );
      setShowHistory(false);
    } catch {}
  };

  const startNewChat = () => {
    stopStream();
    setChatId(null);
    setMessages([]);
    setShowHistory(false);
    setActiveBranchIdx(null);
    mainChatIdRef.current = null;
    mainMessagesRef.current = [];
  };

  const switchToMain = () => {
    if (activeBranchIdx === null) return;
    stopStream();
    // Save current branch
    setBranches((prev) =>
      prev.map((b, i) => (i === activeBranchIdx ? { ...b, chatId: chatIdRef.current, messages: messagesRef.current } : b))
    );
    // Load main
    setChatId(mainChatIdRef.current);
    setMessages(mainMessagesRef.current);
    setActiveBranchIdx(null);
  };

  const switchToBranch = (idx: number) => {
    if (activeBranchIdx === idx) return;
    stopStream();
    // Save current
    if (activeBranchIdx === null) {
      mainChatIdRef.current = chatIdRef.current;
      mainMessagesRef.current = messagesRef.current;
    } else {
      setBranches((prev) =>
        prev.map((b, i) => (i === activeBranchIdx ? { ...b, chatId: chatIdRef.current, messages: messagesRef.current } : b))
      );
    }
    // Load target
    const target = branches[idx];
    setChatId(target.chatId);
    setMessages(target.messages);
    setActiveBranchIdx(idx);
  };

  const removeBranch = (idx: number) => {
    setBranches((prev) => prev.filter((_, i) => i !== idx));
    if (activeBranchIdx === idx) {
      switchToMain();
    } else if (activeBranchIdx !== null && activeBranchIdx > idx) {
      setActiveBranchIdx(activeBranchIdx - 1);
    }
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

    setMessages((prev) => [...prev, { role: "user", content: question }]);
    const loadingHint = webSearch ? "正在搜索网页..." : "";
    setMessages((prev) => [...prev, { role: "assistant", content: loadingHint }]);

    let currentChatId = chatId;
    if (!currentChatId) {
      try {
        const parentChatId = activeBranchIdx !== null ? branches[activeBranchIdx]?.parentChatId : undefined;
        const chat = await chatApi.create({
          mode,
          workspace_id: workspaceId || undefined,
          card_id: cardId,
          parent_chat_id: parentChatId || undefined,
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
      saveMessage(currentChatId, "user", question);
    }

    const onChunk = (text: string) => {
      if (text.startsWith('{')) {
        try {
          const parsed = JSON.parse(text);
          if (parsed.type === "web_search_results" && parsed.results) {
            streamContentRef.current = "";
            webSearchResultsRef.current = parsed.results;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                webSearchResults: parsed.results,
                content: "",
              };
              setExpandedSearchResults((s) => new Set(s).add(updated.length - 1));
              return updated;
            });
            return;
          }
          if (parsed.type === "sources" && parsed.cards) {
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                sources: parsed.cards,
              };
              return updated;
            });
            return;
          }
        } catch {}
      }
      streamContentRef.current += text;
      const content = streamContentRef.current;
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content };
        return updated;
      });
    };

    const onDone = () => {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], status: "done" };
        return updated;
      });
      setIsStreaming(false);
      abortRef.current = null;
      if (currentChatId && streamContentRef.current) {
        saveMessage(currentChatId, "assistant", streamContentRef.current, webSearchResultsRef.current);
      }
    };

    const onError = (err: Error) => {
      console.error("Stream error:", err);
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
      abortRef.current = null;
    };

    const hist = messages
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content }));
    if (mode === "chat") {
      abortRef.current = ragApi.chatStream(question, onChunk, onDone, onError, hist, webSearch);
    } else {
      abortRef.current = ragApi.askStream(
        question, globalRag ? undefined : workspaceId, onChunk, onDone, onError, cardId, 5, webSearch, hist,
      );
    }
  };

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    const question = input.trim();
    setInput("");
    if (forkMode) {
      setForkMode(false);
      window.dispatchEvent(new CustomEvent("topology-fork-request", { detail: { prompt: question } }));
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

  const switchMode = (newMode: ChatMode) => {
    stopStream();
    setMode(newMode);
    setChatId(null);
    setMessages([]);
  };

  return (
    <div className="flex h-full w-1/2 flex-shrink-0 flex-col border-l border-border bg-bg animate-slide-in">
      {/* Header */}
      <div className="relative z-20 flex items-center gap-2 border-b border-border bg-surface/80 px-3 py-2 backdrop-blur-sm">
        <div className="flex rounded-full bg-gray-100 p-0.5">
          <button
            onClick={() => switchMode("rag")}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              mode === "rag" ? "bg-primary text-white" : "text-text-secondary hover:text-text"
            }`}
          >
            知识问答
          </button>
          <button
            onClick={() => switchMode("chat")}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              mode === "chat" ? "bg-primary text-white" : "text-text-secondary hover:text-text"
            }`}
          >
            自由对话
          </button>
        </div>

        {mode === "rag" && (
          <button
            onClick={() => setGlobalRag(!globalRag)}
            className={`ml-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition ${
              globalRag
                ? "bg-primary/10 text-primary-dark"
                : "text-text-secondary hover:bg-gray-100"
            }`}
            title={globalRag ? "搜索所有空间" : "搜索当前空间"}
          >
            <Globe size={10} />
            {globalRag ? "全部空间" : "当前空间"}
          </button>
        )}

        <ModelSelector compact />

        {activeBranchIdx !== null && branches[activeBranchIdx] && (
          <div className="flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] text-green-700">
            <GitBranch size={10} />
            <span className="max-w-[100px] truncate">{branches[activeBranchIdx].title}</span>
          </div>
        )}

        {forkMode && (
          <div className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 animate-pulse">
            <GitBranch size={10} />
            分叉模式
            <button onClick={() => setForkMode(false)} className="ml-0.5 text-amber-400 hover:text-amber-600">×</button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
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
                        <span
                          className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            chat.mode === "rag"
                              ? "bg-blue-100 text-blue-600"
                              : "bg-green-100 text-green-600"
                          }`}
                        >
                          {chat.mode === "rag" ? "知识" : "对话"}
                        </span>
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
                {mode === "rag" ? (
                  <>
                    <p className="text-sm font-medium">基于你的灵感卡片回答问题</p>
                    <p className="mt-1 text-xs">提问关于你的灵感、想法或知识的问题</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium">自由对话</p>
                    <p className="mt-1 text-xs">可以问任何问题，不限于卡片内容</p>
                  </>
                )}
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`mb-3 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
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
                        <MarkdownContent
                          content={msg.content || " "}
                          streaming={isStreaming && i === messages.length - 1}
                          onPrecipitateBlock={canPrecipitate && !isStreaming ? handlePrecipitateBlock : undefined}
                        />
                        {msg.status === "error" && (
                          <p className="mt-1 text-xs text-amber-600">回答中断，内容可能不完整</p>
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
            ))}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border bg-surface px-3 py-2.5">
            <div className="mb-2 flex items-center gap-2">
              <Globe size={12} className={webSearch ? "text-primary-dark" : "text-text-secondary"} />
              <span className={`text-xs ${webSearch ? "text-primary-dark" : "text-text-secondary"}`}>联网搜索</span>
              <button
                onClick={() => setWebSearch(!webSearch)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  webSearch ? "bg-primary" : "bg-gray-300"
                }`}
                title={webSearch ? "关闭网页搜索" : "开启网页搜索"}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                    webSearch ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
              <div className="ml-auto">
                <button
                  onClick={() => setForkMode(!forkMode)}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition ${
                    forkMode
                      ? "bg-green-100 text-green-700"
                      : "text-text-secondary hover:bg-gray-100"
                  }`}
                  title="创建知识分支"
                >
                  <GitBranch size={10} />
                  分叉
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                placeholder={
                  forkMode
                    ? "你想深入了解什么？输入后回车创建分支..."
                    : mode === "rag"
                      ? "问一个关于灵感的问题..."
                      : "输入问题..."
                }
                className={`flex-1 rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none focus:ring-2 ${
                  forkMode ? "focus:ring-green-300" : "focus:ring-primary/30"
                }`}
                disabled={isStreaming}
              />
              {isStreaming ? (
                <button
                  onClick={stopStream}
                  className="flex items-center justify-center rounded-xl bg-danger px-3 py-2 text-white transition hover:bg-red-600"
                  title="停止"
                >
                  <Square size={14} />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className={`flex items-center justify-center rounded-xl px-3 py-2 text-white transition disabled:opacity-50 ${
                    forkMode
                      ? "bg-green-500 hover:bg-green-600"
                      : "bg-primary hover:bg-primary-dark"
                  }`}
                  title={forkMode ? "创建分支并发送" : "发送"}
                >
                  {forkMode ? <GitBranch size={14} /> : <Send size={14} />}
                </button>
              )}
            </div>
          </div>

          {/* Conversation tabs */}
          {(branches.length > 0 || activeBranchIdx !== null) && (
            <div className="flex items-center gap-1 border-t border-border bg-surface/50 px-3 py-1.5">
              <button
                onClick={switchToMain}
                className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                  activeBranchIdx === null
                    ? "bg-primary text-white"
                    : "text-text-secondary hover:bg-gray-100"
                }`}
              >
                主
              </button>
              {branches.map((b, i) => (
                <div key={i} className="group relative flex items-center">
                  <button
                    onClick={() => switchToBranch(i)}
                    className={`rounded px-2 py-0.5 text-[11px] transition ${
                      activeBranchIdx === i
                        ? "bg-green-500 text-white"
                        : "text-text-secondary hover:bg-gray-100"
                    }`}
                    title={b.title}
                  >
                    {i + 1}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeBranch(i); }}
                    className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-gray-300 text-[8px] text-white hover:bg-red-400 group-hover:flex"
                    title="关闭分支"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
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

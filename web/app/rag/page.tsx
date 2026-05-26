"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useState, useRef, useEffect, useCallback } from "react";
import useSWR from "swr";
import { ragApi, chatApi, aiApi, cardApi, workspaceApi, type RAGResponse, type WebSearchResult, type ChatSession, type Workspace } from "@/lib/api";
import { toast } from "@/lib/toast";
import { MarkdownContent } from "@/components/MarkdownContent";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Globe } from "lucide-react";

type ChatMode = "rag" | "chat";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: RAGResponse["source_cards"];
  webSearchResults?: WebSearchResult[];
}

export default function RAGPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-text-secondary">Loading...</div>}>
      <RAGContent />
    </Suspense>
  );
}

function RAGContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const cardId = searchParams.get("cardId") || undefined;
  const workspaceId = searchParams.get("workspaceId") || "";

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
  const [precipitatedBlocks, setPrecipitatedBlocks] = useState<Set<string>>(new Set());
  const [precipitatingBlock, setPrecipitatingBlock] = useState<string | null>(null);
  const [webSearch, setWebSearch] = useState(false);

  const { data: workspace } = useSWR(
    workspaceId ? `workspace-${workspaceId}` : null,
    () => workspaceApi.get(workspaceId)
  );
  const canPrecipitate = workspace?.member_role === "owner";

  const ragDisabled = mode === "rag" && !workspaceId;

  const handlePrecipitateBlock = async (blockText: string) => {
    if (!workspaceId) {
      toast("请从空间页面进入以使用沉淀功能", "error");
      return;
    }
    const key = blockText.slice(0, 50);
    if (precipitatedBlocks.has(key)) return;
    setPrecipitatingBlock(key);
    try {
      const [titleRes, kwRes] = await Promise.all([
        aiApi.generateTitle(blockText),
        aiApi.extractKeywords(blockText),
      ]);
      await cardApi.create({
        local_id: "card_" + Date.now(),
        workspace_id: workspaceId,
        title: titleRes.title,
        content: blockText,
        keywords: kwRes.keywords,
      });
      setPrecipitatedBlocks((prev) => new Set(prev).add(key));
      toast("已沉淀为卡片", "success");
    } catch (e: any) {
      toast("沉淀失败: " + e.message, "error");
    } finally {
      setPrecipitatingBlock(null);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => { abortRef.current?.(); };
  }, []);

  // Load all chat history (not filtered by mode)
  const loadHistory = useCallback(() => {
    chatApi.list(workspaceId || undefined).then(setHistory).catch(() => {});
  }, [workspaceId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const loadChat = async (id: string) => {
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

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const question = input.trim();
    setInput("");
    setIsStreaming(true);
    streamContentRef.current = "";

    setMessages((prev) => [...prev, { role: "user", content: question }]);
    // Show loading hint when web search is enabled
    const loadingHint = webSearch ? "正在搜索网页..." : "";
    setMessages((prev) => [...prev, { role: "assistant", content: loadingHint }]);

    let currentChatId = chatId;
    if (!currentChatId) {
      try {
        const chat = await chatApi.create({
          mode,
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
      saveMessage(currentChatId, "user", question);
    }

    const onChunk = (text: string) => {
      // Handle JSON messages
      if (text.startsWith('{')) {
        try {
          const parsed = JSON.parse(text);
          if (parsed.type === "web_search_results" && parsed.results) {
            // Show web search results immediately
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                webSearchResults: parsed.results,
                content: "", // Clear "正在搜索网页..." hint
              };
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
      setIsStreaming(false);
      abortRef.current = null;
      if (currentChatId && streamContentRef.current) {
        // Get web search results from the last assistant message
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          const wsResults = lastMsg?.webSearchResults;
          saveMessage(currentChatId!, "assistant", streamContentRef.current, wsResults);
          return prev;
        });
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
        };
        return updated;
      });
      setIsStreaming(false);
      abortRef.current = null;
      if (currentChatId) {
        saveMessage(currentChatId, "assistant", streamContentRef.current || "抱歉，处理问题时出错了。");
      }
    };

    if (mode === "chat") {
      const hist = messages
        .filter((m) => m.content)
        .map((m) => ({ role: m.role, content: m.content }));
      abortRef.current = ragApi.chatStream(question, onChunk, onDone, onError, hist, webSearch);
    } else {
      if (!workspaceId) {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", content: "请先从空间页面进入 AI 问答。" },
        ]);
        setIsStreaming(false);
        return;
      }
      abortRef.current = ragApi.askStream(
        question, workspaceId, onChunk, onDone, onError, cardId, 5, webSearch,
      );
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
    <div className="flex h-screen flex-col bg-bg">
      {/* Header */}
      <nav className="flex items-center gap-3 border-b border-border bg-surface/80 px-4 py-3 backdrop-blur-sm">
        <Breadcrumb
          items={
            workspaceId
              ? [
                  { label: "我的空间", href: "/workspaces" },
                  { label: workspace?.name || "空间", href: `/workspaces/${workspaceId}` },
                  { label: "AI 对话" },
                ]
              : [
                  { label: "AI 对话" },
                ]
          }
        />

        <div className="ml-auto flex rounded-full bg-gray-100 p-0.5">
          <button
            onClick={() => switchMode("rag")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              mode === "rag" ? "bg-primary text-white" : "text-text-secondary hover:text-text"
            }`}
          >
            知识问答
          </button>
          <button
            onClick={() => switchMode("chat")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              mode === "chat" ? "bg-primary text-white" : "text-text-secondary hover:text-text"
            }`}
          >
            自由对话
          </button>
        </div>

        <button
          onClick={() => setShowHistory(!showHistory)}
          className="rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-gray-100"
        >
          历史
        </button>
        <button
          onClick={startNewChat}
          className="rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-gray-100"
        >
          新对话
        </button>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        {/* History sidebar */}
        {showHistory && (
          <div className="w-64 flex-shrink-0 overflow-y-auto border-r border-border bg-surface p-3">
            <h3 className="mb-2 text-xs font-semibold text-text-secondary">对话历史</h3>
            {history.length === 0 && (
              <p className="text-xs text-text-secondary">暂无历史记录</p>
            )}
            {history.map((chat) => (
              <div
                key={chat.id}
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
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(chat); }}
                  className="hidden text-xs text-text-secondary hover:text-danger group-hover:block"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Chat area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-6">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center text-center text-text-secondary">
                <div className="mb-4 text-5xl">AI</div>
                {mode === "rag" ? (
                  <>
                    <p className="text-lg font-medium">基于你的灵感卡片回答问题</p>
                    <p className="mt-2 text-sm">提问关于你的灵感、想法或知识的问题</p>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-medium">自由对话</p>
                    <p className="mt-2 text-sm">可以问任何问题，不限于卡片内容</p>
                  </>
                )}
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`mb-4 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    msg.role === "user"
                      ? "bg-primary text-white"
                      : "bg-surface text-text shadow-sm"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    msg.content === "正在搜索网页..." ? (
                      <div className="flex items-center gap-2 text-sm text-text-secondary">
                        <Globe size={16} className="animate-pulse" />
                        <span className="animate-pulse">{msg.content}</span>
                      </div>
                    ) : (
                      <MarkdownContent
                        content={msg.content || " "}
                        streaming={isStreaming && i === messages.length - 1}
                        onPrecipitateBlock={canPrecipitate && !isStreaming ? handlePrecipitateBlock : undefined}
                      />
                    )
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                  )}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-3 border-t border-border pt-2">
                      <p className="mb-1 text-xs text-text-secondary">引用来源：</p>
                      {msg.sources.map((s) => (
                        <div key={s.id} className="mb-1 rounded bg-gray-50 px-2 py-1 text-xs text-text-secondary">
                          {s.title && <span className="font-medium">{s.title}: </span>}
                          <span className="line-clamp-1">{s.content}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {msg.webSearchResults && msg.webSearchResults.length > 0 && (
                    <div className="mt-3 border-t border-border pt-2">
                      <p className="mb-1 flex items-center gap-1 text-xs text-text-secondary">
                        <Globe size={12} />
                        网页搜索结果：
                      </p>
                      {msg.webSearchResults.map((r, j) => (
                        <div key={j} className="mb-1 rounded bg-blue-50 px-2 py-1 text-xs">
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
              </div>
            ))}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border bg-surface px-4 py-3">
            {ragDisabled && (
              <div className="mb-2 rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-700">
                请从空间页面进入以使用知识问答功能
              </div>
            )}
            <div className="mb-2 flex items-center gap-2">
              <Globe size={14} className={webSearch ? "text-primary-dark" : "text-text-secondary"} />
              <span className={`text-xs ${webSearch ? "text-primary-dark" : "text-text-secondary"}`}>联网搜索</span>
              <button
                onClick={() => setWebSearch(!webSearch)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  webSearch ? "bg-primary" : "bg-gray-300"
                }`}
                title={webSearch ? "关闭网页搜索" : "开启网页搜索"}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                    webSearch ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                placeholder={mode === "rag" ? "问一个关于你灵感的问题..." : "输入你想问的问题..."}
                className="flex-1 rounded-2xl bg-gray-100 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                disabled={isStreaming || ragDisabled}
              />
              {isStreaming ? (
                <button
                  onClick={stopStream}
                  className="rounded-2xl bg-danger px-5 py-3 text-sm font-medium text-white"
                >
                  停止
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="rounded-2xl bg-primary px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
                >
                  发送
                </button>
              )}
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

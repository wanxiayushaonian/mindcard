"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import useSWR from "swr";
import { ragApi, chatApi, aiApi, cardApi, workspaceApi, type RAGResponse, type ChatSession } from "@/lib/api";
import { toast } from "@/lib/toast";
import { MarkdownContent } from "@/components/MarkdownContent";
import { ConfirmModal } from "@/components/ConfirmModal";
import { X, History, MessageSquarePlus, Send, Square, ArrowLeft, Trash2 } from "lucide-react";

type ChatMode = "rag" | "chat";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: RAGResponse["source_cards"];
}

interface AiChatPanelProps {
  workspaceId: string;
  cardId?: string;
  onClose: () => void;
}

export function AiChatPanel({ workspaceId, cardId, onClose }: AiChatPanelProps) {
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

  const loadChat = async (id: string) => {
    try {
      const detail = await chatApi.get(id);
      setChatId(detail.id);
      setMode(detail.mode as ChatMode);
      setMessages(
        detail.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
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
  };

  const stopStream = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const saveMessage = async (cid: string, role: string, content: string) => {
    try {
      await chatApi.addMessage(cid, role, content);
    } catch (e) {
      console.error("Failed to save message:", e);
    }
  };

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
      window.dispatchEvent(new CustomEvent("card-precipitated"));
    } catch (e: any) {
      toast("沉淀失败: " + e.message, "error");
    } finally {
      setPrecipitatingBlock(null);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const question = input.trim();
    setInput("");
    setIsStreaming(true);
    streamContentRef.current = "";

    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

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
      if (text.startsWith('{"type":"sources"') || text.startsWith('{"type": "sources"')) {
        try {
          const parsed = JSON.parse(text);
          if (parsed.type === "sources" && parsed.cards) {
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { ...updated[updated.length - 1], sources: parsed.cards };
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
        saveMessage(currentChatId, "assistant", streamContentRef.current);
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
      abortRef.current = ragApi.chatStream(question, onChunk, onDone, onError, hist);
    } else {
      abortRef.current = ragApi.askStream(
        question, workspaceId, onChunk, onDone, onError, cardId,
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
    <div className="flex h-full w-1/2 flex-shrink-0 flex-col border-l border-border bg-bg animate-slide-in">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-surface/80 px-3 py-2 backdrop-blur-sm">
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
                    className="hidden text-text-secondary hover:text-danger group-hover:block"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
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
                    <MarkdownContent
                      content={msg.content || " "}
                      onPrecipitateBlock={canPrecipitate && !isStreaming ? handlePrecipitateBlock : undefined}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                  )}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 border-t border-border pt-2">
                      <p className="mb-1 text-[10px] text-text-secondary">引用来源：</p>
                      {msg.sources.map((s) => (
                        <div key={s.id} className="mb-1 rounded bg-gray-50 px-2 py-1 text-[10px] text-text-secondary">
                          {s.title && <span className="font-medium">{s.title}: </span>}
                          <span className="line-clamp-1">{s.content}</span>
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
          <div className="border-t border-border bg-surface px-3 py-2.5">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                placeholder={mode === "rag" ? "问一个关于灵感的问题..." : "输入问题..."}
                className="flex-1 rounded-xl bg-gray-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
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
                  className="flex items-center justify-center rounded-xl bg-primary px-3 py-2 text-white transition hover:bg-primary-dark disabled:opacity-50"
                  title="发送"
                >
                  <Send size={14} />
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

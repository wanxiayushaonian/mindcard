const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options?.headers as Record<string, string>) || {}),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}

/** Stream SSE from a POST endpoint. Calls onChunk for each text chunk. Returns an abort function. */
export function streamRequest(
  path: string,
  body: Record<string, unknown>,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError?: (err: Error) => void,
): () => void {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const controller = new AbortController();

  fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              onDone();
              return;
            }
            onChunk(data);
          }
        }
      }
      onDone();
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        onError?.(err);
      }
    });

  return () => controller.abort();
}

// --- Auth ---
export const authApi = {
  wechatLogin: (code: string) =>
    request<{ access_token: string }>("/api/auth/wechat-login", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  devLogin: (nickname: string = "Web用户") =>
    request<{ access_token: string }>("/api/auth/dev-login", {
      method: "POST",
      body: JSON.stringify({ nickname }),
    }),
};

// --- Workspaces ---
export interface Workspace {
  id: string;
  local_id: string;
  name: string;
  icon: string;
  color: string;
  invite_code: string | null;
  created_at: string;
}

export const workspaceApi = {
  list: () => request<Workspace[]>("/api/workspaces/"),
  get: (id: string) => request<Workspace>(`/api/workspaces/${id}`),
  create: (data: { local_id: string; name: string; icon?: string; color?: string }) =>
    request<Workspace>("/api/workspaces/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<{ name: string; icon: string; color: string }>) =>
    request<Workspace>(`/api/workspaces/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<{ ok: boolean }>(`/api/workspaces/${id}`, { method: "DELETE" }),
  members: (id: string) =>
    request<{ user_id: string; nickname: string; role: string; joined_at: string }[]>(
      `/api/workspaces/${id}/members`
    ),
};

// --- Cards ---
export interface Card {
  id: string;
  local_id: string;
  workspace_id: string;
  title: string;
  content: string;
  keywords: string[];
  color: string;
  emotion_tag: string;
  is_favorite: boolean;
  is_temp: boolean;
  created_at: string;
  updated_at: string | null;
}

export const cardApi = {
  list: (workspaceId: string, skip = 0, limit = 50) =>
    request<Card[]>(`/api/cards/?workspace_id=${workspaceId}&skip=${skip}&limit=${limit}`),
  get: (id: string) => request<Card>(`/api/cards/${id}`),
  create: (data: {
    local_id: string;
    workspace_id: string;
    title?: string;
    content: string;
    keywords?: string[];
    color?: string;
    emotion_tag?: string;
  }) =>
    request<Card>("/api/cards/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<Card>) =>
    request<Card>(`/api/cards/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<{ ok: boolean }>(`/api/cards/${id}`, { method: "DELETE" }),
  getRelated: (id: string) => request<Card[]>(`/api/cards/${id}/relations`),
  addRelation: (cardId: string, relatedCardId: string, relationType = "manual") =>
    request<{ ok: boolean }>(`/api/cards/${cardId}/relations`, {
      method: "POST",
      body: JSON.stringify({ related_card_id: relatedCardId, relation_type: relationType }),
    }),
};

// --- Comments ---
export interface Comment {
  id: string;
  card_id: string;
  author_id: string | null;
  content: string;
  created_at: string;
}

export const commentApi = {
  list: (cardId: string) => request<Comment[]>(`/api/cards/${cardId}/comments`),
  add: (cardId: string, content: string, authorId?: string) =>
    request<Comment>(`/api/cards/${cardId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content, author_id: authorId }),
    }),
  delete: (cardId: string, commentId: string) =>
    request<{ ok: boolean }>(`/api/cards/${cardId}/comments/${commentId}`, {
      method: "DELETE",
    }),
};

// --- Search ---
export interface SearchResult {
  card: Card;
  score: number;
}

export const searchApi = {
  semantic: (query: string, workspaceId: string, limit = 20) =>
    request<{ results: SearchResult[]; total: number }>("/api/search/semantic", {
      method: "POST",
      body: JSON.stringify({ query, workspace_id: workspaceId, limit }),
    }),
  fulltext: (query: string, workspaceId: string, limit = 20) =>
    request<{ results: SearchResult[]; total: number }>("/api/search/fulltext", {
      method: "POST",
      body: JSON.stringify({ query, workspace_id: workspaceId, limit }),
    }),
  hybrid: (query: string, workspaceId: string, limit = 20) =>
    request<{ results: SearchResult[]; total: number }>("/api/search/hybrid", {
      method: "POST",
      body: JSON.stringify({ query, workspace_id: workspaceId, limit }),
    }),
};

// --- RAG ---
export interface RAGResponse {
  answer: string;
  source_cards: { id: string; title: string; content: string; keywords: string[] }[];
  confidence: number;
}

export const ragApi = {
  ask: (question: string, workspaceId: string, cardId?: string, topK = 5) =>
    request<RAGResponse>("/api/rag/ask", {
      method: "POST",
      body: JSON.stringify({ question, workspace_id: workspaceId, card_id: cardId, top_k: topK }),
    }),
  askStream: (
    question: string,
    workspaceId: string,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError?: (err: Error) => void,
    cardId?: string,
    topK = 5,
  ) =>
    streamRequest(
      "/api/rag/ask/stream",
      { question, workspace_id: workspaceId, card_id: cardId, top_k: topK },
      onChunk,
      onDone,
      onError,
    ),
  chat: (message: string, history: { role: string; content: string }[] = []) =>
    request<{ reply: string }>("/api/rag/chat", {
      method: "POST",
      body: JSON.stringify({ message, history }),
    }),
  chatStream: (
    message: string,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError?: (err: Error) => void,
    history: { role: string; content: string }[] = [],
  ) =>
    streamRequest(
      "/api/rag/chat/stream",
      { message, history },
      onChunk,
      onDone,
      onError,
    ),
  similar: (cardId: string, limit = 5) =>
    request<Card[]>(`/api/rag/similar/${cardId}?limit=${limit}`),
  insights: (workspaceId: string) =>
    request<{ themes: string[]; trends: string; unexplored: string[]; suggestions: string[] }>(
      "/api/rag/insights",
      {
        method: "POST",
        body: JSON.stringify({ workspace_id: workspaceId }),
      }
    ),
};

// --- Chats ---
export interface ChatSession {
  id: string;
  mode: string;
  workspace_id: string | null;
  card_id: string | null;
  title: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface ChatDetail extends ChatSession {
  messages: ChatMessage[];
}

export const chatApi = {
  list: (workspaceId?: string, mode?: string) => {
    const params = new URLSearchParams();
    if (workspaceId) params.set("workspace_id", workspaceId);
    if (mode) params.set("mode", mode);
    return request<ChatSession[]>(`/api/chats/?${params.toString()}`);
  },
  get: (chatId: string) => request<ChatDetail>(`/api/chats/${chatId}`),
  create: (data: { mode: string; workspace_id?: string; card_id?: string; title?: string }) =>
    request<ChatDetail>("/api/chats/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  addMessage: (chatId: string, role: string, content: string) =>
    request<ChatMessage>(`/api/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content }),
    }),
  delete: (chatId: string) =>
    request<{ ok: boolean }>(`/api/chats/${chatId}`, { method: "DELETE" }),
};

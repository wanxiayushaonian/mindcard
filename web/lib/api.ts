const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit & { timeout?: number }): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const { timeout = 15000, ...fetchOptions } = options || {};
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((fetchOptions.headers as Record<string, string>) || {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status === 401 && typeof window !== "undefined") {
        localStorage.removeItem("token");
        window.location.href = "/login";
        throw new Error("登录已过期，请重新登录");
      }
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    return res.json();
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error("请求超时，请检查网络连接");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
        if (res.status === 401 && typeof window !== "undefined") {
          localStorage.removeItem("token");
          window.location.href = "/login";
          throw new Error("登录已过期，请重新登录");
        }
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
        buffer = buffer.replace(/\r\n/g, "\n");
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
export interface UserMe {
  id: string;
  username: string | null;
  nickname: string;
  avatar_url: string;
  has_miniapp_wechat: boolean;
  has_web_wechat: boolean;
}

export const authApi = {
  register: (username: string, password: string, nickname?: string) =>
    request<{ access_token: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, nickname }),
    }),
  login: (username: string, password: string) =>
    request<{ access_token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  wechatLogin: (code: string) =>
    request<{ access_token: string }>("/api/auth/wechat-login", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  webOAuthLogin: (code: string) =>
    request<{ access_token: string }>("/api/auth/web-login", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  wechatQrUrl: (redirectUri: string) =>
    request<{ authorize_url: string }>(`/api/auth/wechat-qr-url?redirect_uri=${encodeURIComponent(redirectUri)}`),
  bindWechat: (code: string) =>
    request<{ ok: boolean; message: string }>("/api/auth/bind-wechat", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  me: () => request<UserMe>("/api/auth/me"),
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
  member_role: string | null;
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
  generateInviteCode: (id: string) =>
    request<{ invite_code: string }>(`/api/workspaces/${id}/invite-code`, { method: "POST" }),
  joinByCode: (invite_code: string) =>
    request<{ ok: boolean; workspace_id: string; workspace_name?: string; message?: string }>(
      "/api/workspaces/join",
      { method: "POST", body: JSON.stringify({ invite_code }) }
    ),
  removeMember: (workspaceId: string, userId: string) =>
    request<{ ok: boolean }>(`/api/workspaces/${workspaceId}/members/${userId}`, { method: "DELETE" }),
  leave: (workspaceId: string) =>
    request<{ ok: boolean }>(`/api/workspaces/${workspaceId}/leave`, { method: "POST" }),
};

// --- Cards ---
export interface Card {
  id: string;
  local_id: string;
  workspace_id: string;
  creator_id: string;
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

export interface CardFilters {
  sort_by?: "created_at" | "updated_at" | "title";
  order?: "asc" | "desc";
  is_favorite?: boolean;
  is_temp?: boolean;
  emotion_tag?: string;
  keyword?: string;
}

export interface CardListResponse {
  items: Card[];
  next_cursor: string | null;
}

export const cardApi = {
  list: (workspaceId: string, opts?: { cursor?: string; limit?: number } & CardFilters): Promise<CardListResponse> => {
    const params = new URLSearchParams({ workspace_id: workspaceId });
    if (opts?.cursor) params.set("cursor", opts.cursor);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts) {
      Object.entries(opts).forEach(([k, v]) => {
        if (k !== "cursor" && k !== "limit" && v !== undefined && v !== null && v !== "") params.set(k, String(v));
      });
    }
    return request<CardListResponse>(`/api/cards/?${params}`);
  },
  /** Fetch all cards by auto-paginating (for graph views etc). */
  listAll: async (workspaceId: string, filters?: CardFilters, onProgress?: (loaded: number) => void): Promise<Card[]> => {
    const all: Card[] = [];
    let cursor: string | undefined;
    do {
      const res = await cardApi.list(workspaceId, { ...filters, limit: 100, cursor });
      all.push(...res.items);
      cursor = res.next_cursor ?? undefined;
      onProgress?.(all.length);
    } while (cursor);
    return all;
  },
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
  removeRelation: (cardId: string, relatedCardId: string) =>
    request<{ ok: boolean }>(`/api/cards/${cardId}/relations/${relatedCardId}`, { method: "DELETE" }),
};

// --- Comments ---
export interface Comment {
  id: string;
  card_id: string;
  author_id: string | null;
  author_nickname: string;
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
  semantic: (query: string, workspaceId?: string, limit = 20, sortBy = "relevance") =>
    request<{ results: SearchResult[]; total: number }>("/api/search/semantic", {
      method: "POST",
      body: JSON.stringify({ query, workspace_id: workspaceId || null, limit, sort_by: sortBy }),
    }),
  fulltext: (query: string, workspaceId?: string, limit = 20, sortBy = "relevance") =>
    request<{ results: SearchResult[]; total: number }>("/api/search/fulltext", {
      method: "POST",
      body: JSON.stringify({ query, workspace_id: workspaceId || null, limit, sort_by: sortBy }),
    }),
  hybrid: (query: string, workspaceId?: string, limit = 20, sortBy = "relevance") =>
    request<{ results: SearchResult[]; total: number }>("/api/search/hybrid", {
      method: "POST",
      body: JSON.stringify({ query, workspace_id: workspaceId || null, limit, sort_by: sortBy }),
    }),
};

// --- RAG ---
export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
}

export interface RAGResponse {
  answer: string;
  source_cards: { id: string; title: string; content: string; keywords: string[] }[];
  confidence: number;
  web_search_results?: WebSearchResult[];
}

export const ragApi = {
  ask: (question: string, workspaceId: string, cardId?: string, topK = 5, webSearch = false) =>
    request<RAGResponse>("/api/rag/ask", {
      method: "POST",
      body: JSON.stringify({ question, workspace_id: workspaceId, card_id: cardId, top_k: topK, web_search: webSearch }),
    }),
  askStream: (
    question: string,
    workspaceId: string,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError?: (err: Error) => void,
    cardId?: string,
    topK = 5,
    webSearch = false,
    history: { role: string; content: string }[] = [],
  ) =>
    streamRequest(
      "/api/rag/ask/stream",
      { question, workspace_id: workspaceId, card_id: cardId, top_k: topK, web_search: webSearch, history },
      onChunk,
      onDone,
      onError,
    ),
  chat: (message: string, history: { role: string; content: string }[] = [], webSearch = false) =>
    request<{ reply: string }>("/api/rag/chat", {
      method: "POST",
      body: JSON.stringify({ message, history, web_search: webSearch }),
    }),
  chatStream: (
    message: string,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError?: (err: Error) => void,
    history: { role: string; content: string }[] = [],
    webSearch = false,
  ) =>
    streamRequest(
      "/api/rag/chat/stream",
      { message, history, web_search: webSearch },
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
  web_search_results?: WebSearchResult[];
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
  addMessage: (chatId: string, role: string, content: string, webSearchResults?: WebSearchResult[]) =>
    request<ChatMessage>(`/api/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content, web_search_results: webSearchResults }),
    }),
  delete: (chatId: string) =>
    request<{ ok: boolean }>(`/api/chats/${chatId}`, { method: "DELETE" }),
};

// --- AI Text Tools ---
export const aiApi = {
  polish: (content: string) =>
    request<{ text: string }>("/api/ai/polish", {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  supplement: (content: string) =>
    request<{ text: string }>("/api/ai/supplement", {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  generateTitle: (content: string) =>
    request<{ title: string }>("/api/ai/generate-title", {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  extractKeywords: (content: string) =>
    request<{ keywords: string[] }>("/api/ai/extract-keywords", {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  segmentContent: (content: string) =>
    request<{ segments: { title: string; content: string }[] }>("/api/ai/segment-content", {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
};

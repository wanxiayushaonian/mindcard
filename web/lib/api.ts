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
        throw new Error("sessionExpired");
      }
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    return res.json();
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error("networkTimeout");
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
  options?: { timeoutMs?: number },
): () => void {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
          throw new Error("sessionExpired");
        }
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let doneCalled = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data.trim() === "[DONE]") {
              if (!doneCalled) { doneCalled = true; onDone(); }
              return;
            }
            // Don't trim the data - preserve whitespace and newlines
            onChunk(data);
          }
        }
      }
      if (!doneCalled) { doneCalled = true; onDone(); }
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        onError?.(err);
      }
    })
    .finally(() => clearTimeout(timer));

  return () => { clearTimeout(timer); controller.abort(); };
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
  updateMemberRole: (workspaceId: string, userId: string, role: string) =>
    request<{ ok: boolean; role: string }>(`/api/workspaces/${workspaceId}/members/${userId}/role`, {
      method: "POST",
      body: JSON.stringify({ role }),
    }),
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
  parent_card_ids: string[];
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
    parent_card_ids?: string[];
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
  deletePreview: (id: string) =>
    request<{
      card_title: string;
      relations: number;
      topology_nodes: number;
      entities: number;
      graph_relations: number;
      comments: number;
    }>(`/api/cards/${id}/delete-preview`),
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
  source_cards: { id: string; title: string; content: string; keywords: string[]; color: string }[];
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
    workspaceId: string | undefined,
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
      { question, workspace_id: workspaceId || null, card_id: cardId, top_k: topK, web_search: webSearch, history },
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
  parent_id: string | null;        // topology tree parent (self-referencing)
  node_type: string;               // "root" | "branch" | "leaf"
  title: string;
  description: string;
  summary: string;
  chat_status: string;             // "active" | "completed" | "archived"
  created_at: string;
  message_count?: number;
  last_message?: string;
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  web_search_results?: WebSearchResult[];
  source_cards?: Array<{ id: string; title: string; content: string; keywords: string[]; color: string }>;
  fork_id?: string;
  metadata_?: Record<string, any>;  // fork-dividers store child_chat_id here
  created_at: string;
}

export interface ChatDetail extends ChatSession {
  messages: ChatMessage[];
}

export interface ChatPathNode {
  node_id: string;
  title: string;
  chat_id: string | null;
  node_type: string;
}

export const chatApi = {
  list: (workspaceId?: string, mode?: string) => {
    const params = new URLSearchParams();
    if (workspaceId) params.set("workspace_id", workspaceId);
    if (mode) params.set("mode", mode);
    return request<ChatSession[]>(`/api/chats/?${params.toString()}`);
  },
  get: (chatId: string) => request<ChatDetail>(`/api/chats/${chatId}`),
  create: (data: { mode: string; workspace_id?: string; card_id?: string; parent_id?: string; title?: string }) =>
    request<ChatDetail>("/api/chats/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  addMessage: (chatId: string, role: string, content: string, webSearchResults?: WebSearchResult[], forkId?: string, metadata?: Record<string, any>, sourceCards?: Array<{ id: string; title: string; content: string; keywords: string[]; color: string }>) =>
    request<ChatMessage>(`/api/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content, web_search_results: webSearchResults, source_cards: sourceCards, fork_id: forkId, metadata_: metadata }),
    }),
  updateMessage: (chatId: string, msgId: string, role: string, content: string) =>
    request<ChatMessage>(`/api/chats/${chatId}/messages/${msgId}`, {
      method: "PATCH",
      body: JSON.stringify({ role, content }),
    }),
  delete: (chatId: string) =>
    request<{ ok: boolean }>(`/api/chats/${chatId}`, { method: "DELETE" }),
  deleteMessage: (chatId: string, msgId: string) =>
    request<{ ok: boolean }>(`/api/chats/${chatId}/messages/${msgId}`, { method: "DELETE" }),
  deletePreview: (chatId: string) =>
    request<{
      chat_title: string;
      messages: number;
      child_chats: number;
      node_title: string | null;
      node_will_archive: boolean;
    }>(`/api/chats/${chatId}/delete-preview`),
  getChatPath: (chatId: string) =>
    request<{ path: ChatPathNode[] }>(`/api/chats/${chatId}/path`),
  fork: (chatId: string, data: { topic?: string; context_strategy?: string }) =>
    request<{ chat_id: string; context_summary: string; depth: number; node_id: string; divider_msg_id: string }>(`/api/chats/${chatId}/fork`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
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

// --- Notifications ---
export interface Notification {
  id: string;
  type: string;
  content: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export const notificationApi = {
  list: (limit = 50) => request<Notification[]>(`/api/notifications/?limit=${limit}`),
  unreadCount: () => request<{ count: number }>("/api/notifications/unread-count"),
  markRead: (id: string) => request<{ ok: boolean }>(`/api/notifications/${id}/read`, { method: "POST" }),
  markAllRead: () => request<{ ok: boolean }>("/api/notifications/read-all", { method: "POST" }),
};

// --- Activities ---
export interface Activity {
  id: string;
  actor_nickname: string;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, string> | null;
  created_at: string;
}

export const activityApi = {
  list: (workspaceId: string, limit = 50) =>
    request<Activity[]>(`/api/activities/${workspaceId}?limit=${limit}`),
};

// --- API Keys ---
export interface ApiKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export interface ApiKeyCreated extends ApiKeyInfo {
  key: string; // full key, only returned on creation
}

export const apiKeyApi = {
  list: () => request<ApiKeyInfo[]>("/api/settings/api-keys/"),
  create: (name: string) =>
    request<ApiKeyCreated>("/api/settings/api-keys/", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  revoke: (id: string) =>
    request<{ ok: boolean }>(`/api/settings/api-keys/${id}`, { method: "DELETE" }),
};

// --- Topics ---
export interface Topic {
  id: string;
  workspace_id: string;
  name: string;
  card_count: number;
  card_ids: string[];
  created_at: string;
  updated_at: string;
}

export const topicApi = {
  list: (workspaceId: string) =>
    request<{ topics: Topic[] }>(`/api/topics/?workspace_id=${workspaceId}`).then((r) => r.topics),
  rebuild: (workspaceId: string) =>
    request<{ ok: boolean }>(`/api/topics/rebuild?workspace_id=${workspaceId}`, { method: "POST" }),
  synthesize: (
    topicId: string,
    mode: string,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError?: (err: Error) => void,
    cardIds?: string[],
  ) =>
    streamRequest(
      "/api/topics/synthesize",
      { topic_id: topicId, mode, card_ids: cardIds ?? [] },
      onChunk,
      onDone,
      onError,
    ),
};

// --- LLM Provider Settings ---
export interface LLMProvider {
  name: string;
  label: string;
  models: string[];
  default_model: string;
  configured: boolean;
  backend: string;
}

export interface CurrentProvider {
  provider: string;
  model: string;
  backend: string;
}

export interface ModelsResponse {
  models: string[];
  source: "remote" | "static";
}

export const settingsApi = {
  listProviders: () => request<LLMProvider[]>("/api/settings/providers"),
  getCurrent: () => request<CurrentProvider>("/api/settings/current"),
  listModels: (provider: string) => request<ModelsResponse>(`/api/settings/models/${provider}`),
  switchProvider: (provider: string, model?: string) =>
    request<{ ok: boolean; provider: string; model: string | null }>("/api/settings/provider", {
      method: "PUT",
      body: JSON.stringify({ provider, model }),
    }),
  getExtractionLanguage: () => request<{ language: "zh" | "en" }>("/api/settings/extraction-language"),
  updateExtractionLanguage: (language: "zh" | "en") =>
    request<{ ok: boolean; language: string }>("/api/settings/extraction-language", {
      method: "PUT",
      body: JSON.stringify({ language }),
    }),
  getExtractionProvider: () =>
    request<{ provider: string; model: string; available_providers: string[] }>("/api/settings/extraction-provider"),
  updateExtractionProvider: (provider: string, model?: string) =>
    request<{ ok: boolean; provider: string; model: string }>("/api/settings/extraction-provider", {
      method: "PUT",
      body: JSON.stringify({ provider, model }),
    }),
  getWebSearchSettings: () =>
    request<{
      provider: string;
      api_key_set: boolean;
      base_url: string;
      max_results: number;
      timeout: number;
      proxy: string;
      providers: { name: string; label: string; credential: string }[];
    }>("/api/settings/web-search"),
  updateWebSearchSettings: (data: {
    provider?: string;
    api_key?: string;
    base_url?: string;
    max_results?: number;
    timeout?: number;
    proxy?: string;
  }) =>
    request<{ ok: boolean; provider: string; max_results: number; timeout: number }>(
      "/api/settings/web-search",
      { method: "PUT", body: JSON.stringify(data) }
    ),
};

// --- Topology Tree ---
export interface TopologyNode {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  chat_id: string | null;
  node_type: "root" | "branch" | "leaf";
  title: string;
  description: string;
  summary: string;
  status: "active" | "completed" | "archived";
  sort_order: number;
  card_ids: string[];
  card_count: number;
  child_ids: string[];
  ref_ids: string[];
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
}

/** @deprecated Use TopologyNode instead */
export type TreeNode = TopologyNode;

export const topologyApi = {
  list: (workspaceId: string) =>
    request<{ nodes: TopologyNode[] }>(`/api/topology/?workspace_id=${workspaceId}`).then((r) => r.nodes),
  get: (nodeId: string) => request<TopologyNode>(`/api/topology/nodes/${nodeId}`),
  create: (data: {
    workspace_id: string;
    parent_id?: string;
    node_type?: string;
    title?: string;
    description?: string;
  }) =>
    request<TopologyNode>("/api/topology/", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (nodeId: string, data: Partial<TopologyNode>) =>
    request<TopologyNode>(`/api/topology/${nodeId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (nodeId: string) =>
    request<{ ok: boolean }>(`/api/topology/${nodeId}`, { method: "DELETE" }),
  addCard: (nodeId: string, cardId: string) =>
    request<TopologyNode>(`/api/topology/${nodeId}/cards`, {
      method: "POST",
      body: JSON.stringify({ card_id: cardId }),
    }),
  removeCard: (nodeId: string, cardId: string) =>
    request<{ ok: boolean }>(`/api/topology/${nodeId}/cards/${cardId}`, { method: "DELETE" }),
  createRef: (nodeId: string, targetId: string, refType = "related", reason = "") =>
    request<TopologyNode>(`/api/topology/${nodeId}/refs`, {
      method: "POST",
      body: JSON.stringify({ target_chat_id: targetId, ref_type: refType, reason }),
    }),
  removeRef: (nodeId: string, targetId: string) =>
    request<{ ok: boolean }>(`/api/topology/${nodeId}/refs/${targetId}`, { method: "DELETE" }),
};

// --- Graph Memory API ---
export interface GraphEntity {
  id: string;
  workspace_id: string;
  name: string;
  entity_type: string | null;
  description: string | null;
  access_count: number;
  created_at: string;
  updated_at: string;
}

export interface GraphEntityDetail extends GraphEntity {
  related_cards: { card_id: string; title: string | null }[];
  neighbor_entities: { entity_id: string; name: string; relation: string; direction: string }[];
}

export interface GraphRelation {
  id: string;
  workspace_id: string;
  head_id: string;
  head_name: string;
  relation: string;
  tail_id: string;
  tail_name: string;
  weight: number;
  source_card_id: string | null;
  created_at: string;
}

export interface ReasoningPath {
  entities: string[];
  relations: string[];
  score: number;
}

export interface GraphSearchResult {
  query: string;
  retrieval_mode: string;
  reasoning_paths: ReasoningPath[];
  cards: {
    id: string;
    title: string | null;
    content_snippet: string | null;
    matched_path: string | null;
    score: number;
  }[];
}

export interface GraphStats {
  entity_count: number;
  relation_count: number;
  relation_type_counts: Record<string, number>;
}

export interface Community {
  id: string;
  title: string;
  size: number;
  level: number;
  summary: string;
  findings: string[];
  rating: number;
}

export const graphApi = {
  getEntities: (workspaceId: string, entityType?: string) => {
    const params = new URLSearchParams({ workspace_id: workspaceId });
    if (entityType) params.set("entity_type", entityType);
    return request<GraphEntity[]>(`/api/graph/entities?${params}`);
  },

  getEntity: (entityId: string, workspaceId: string) =>
    request<GraphEntityDetail>(`/api/graph/entities/${entityId}?workspace_id=${workspaceId}`),

  getRelations: (workspaceId: string) =>
    request<GraphRelation[]>(`/api/graph/relations?workspace_id=${workspaceId}`),

  search: (workspaceId: string, query: string, k = 10) =>
    request<GraphSearchResult>(`/api/graph/search?workspace_id=${workspaceId}`, {
      method: "POST",
      body: JSON.stringify({ query, k }),
    }),


  getStats: (workspaceId: string) =>
    request<GraphStats>(`/api/graph/stats?workspace_id=${workspaceId}`),

  getCommunities: (workspaceId: string) =>
    request<{ communities: Community[] }>(`/api/graph/communities?workspace_id=${workspaceId}`),

  detectCommunities: (workspaceId: string, resolution = 1.0) =>
    request<{ communities_detected: number }>(`/api/graph/communities/detect?workspace_id=${workspaceId}&resolution=${resolution}`, {
      method: "POST",
    }),

  cleanupGraph: (workspaceId: string) =>
    request<{ orphan_entities_removed: number; stale_relations_removed: number }>(`/api/graph/cleanup?workspace_id=${workspaceId}`, {
      method: "POST",
    }),

  createHnswIndex: () =>
    request<{ ok: boolean }>(`/api/graph/hnsw-index`, { method: "POST" }),
};

// --- Branch Insights ---
export interface Insight {
  id: string;
  chat_id: string;
  target_chat_id: string;
  content: string;
  consumed: boolean;
  created_at: string;
}

export const insightApi = {
  create: (chatId: string, targetChatId: string, content: string) =>
    request<Insight>(`/api/chats/${chatId}/insights`, {
      method: "POST",
      body: JSON.stringify({ target_chat_id: targetChatId, content }),
    }),
  list: (chatId: string, consumed?: boolean) =>
    request<Insight[]>(`/api/chats/${chatId}/insights${consumed !== undefined ? `?consumed=${consumed}` : ""}`),
};

// --- Workspace Memories ---
export interface Memory {
  slug: string;
  title: string;
  body: string;
}

export const memoryApi = {
  list: (workspaceId: string) =>
    request<Memory[]>(`/api/workspaces/${workspaceId}/memories`),
  upsert: (workspaceId: string, data: { slug: string; title: string; body: string }) =>
    request<Memory>(`/api/workspaces/${workspaceId}/memories`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  delete: (workspaceId: string, slug: string) =>
    request<{ ok: boolean }>(`/api/workspaces/${workspaceId}/memories/${slug}`, { method: "DELETE" }),
};

// --- Fork Settings ---
export interface ForkProfileInfo {
  name: string;
  label: string;
  description: string;
}

export interface ForkSettings {
  auto_fork_enabled: boolean;
  fork_context_strategy: string;
  profiles: ForkProfileInfo[];
}

export const forkSettingsApi = {
  get: () => request<ForkSettings>("/api/settings/fork"),
  update: (data: { auto_fork_enabled?: boolean; fork_context_strategy?: string }) =>
    request<{ ok: boolean }>("/api/settings/fork", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};

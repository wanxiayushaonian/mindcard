/**
 * Domain-organized API modules for miniapp.
 * Mirrors web/lib/api.ts structure.
 */

const config = require('../config.js');
const API_BASE = config.apiBaseUrl;

// ── Core: Token Management ──

function getToken() {
  return wx.getStorageSync('jwt_token') || '';
}

function setToken(token) {
  wx.setStorageSync('jwt_token', token);
}

function clearToken() {
  wx.removeStorageSync('jwt_token');
}

// ── Core: Base Request ──

function request(method, path, data) {
  const url = API_BASE + path;
  return new Promise((resolve, reject) => {
    const token = getToken();
    wx.request({
      url: url,
      method: method,
      data: data ? JSON.stringify(data) : undefined,
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? 'Bearer ' + token : '',
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else if (res.statusCode === 401) {
          clearToken();
          wx.reLaunch({ url: '/pages/login/login' });
          reject(new Error('登录已过期，请重新登录'));
        } else {
          const detail = (res.data && res.data.detail) || (`HTTP ${res.statusCode}`);
          reject(new Error(detail));
        }
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '网络请求失败'));
      },
    });
  });
}

// ── Core: SSE Stream Request ──

function streamRequest(path, body, onChunk, onDone, onError) {
  const token = getToken();
  let sseBuffer = '';
  let content = '';
  let finished = false;
  const extra = {};

  function extractContent(sseText) {
    let result = '';
    let pos = 0;
    while (pos < sseText.length) {
      const end = sseText.indexOf('\n\n', pos);
      const eventBlock = end === -1 ? sseText.slice(pos) : sseText.slice(pos, end);
      pos = end === -1 ? sseText.length : end + 2;
      const dataLines = [];
      for (const bl of eventBlock.split('\n')) {
        if (bl.indexOf('data: ') === 0) dataLines.push(bl.slice(6));
      }
      if (dataLines.length === 0) continue;
      const data = dataLines.join('\n');
      if (data === '[DONE]') break;
      if (data.charAt(0) === '{') continue;
      result += data;
    }
    return result;
  }

  const task = wx.request({
    url: API_BASE + path,
    method: 'POST',
    enableChunked: true,
    responseType: 'arraybuffer',
    enableHttp2: false,
    header: {
      'Content-Type': 'application/json',
      'Authorization': token ? 'Bearer ' + token : '',
    },
    data: JSON.stringify(body),
    success: (res) => {
      if (finished) return;
      if (res.data && res.data.byteLength > 0) {
        content = extractContent(decode(res.data));
      }
      if (onDone) onDone(content, extra);
    },
    fail: (err) => {
      if (onError) onError(new Error(err.errMsg || '网络请求失败'));
    },
  });

  function decode(buf) {
    if (typeof buf === 'string') return buf;
    const uint8 = new Uint8Array(buf);
    // Process in 8KB chunks — avoids O(n²) string concat and call-stack overflow
    const CHUNK = 8192;
    let str = '';
    for (let i = 0; i < uint8.length; i += CHUNK) {
      str += String.fromCharCode.apply(null, uint8.subarray(i, i + CHUNK));
    }
    try { str = decodeURIComponent(escape(str)); } catch (_e) {}
    return str;
  }

  function parseSSE(chunk) {
    if (finished) return;
    sseBuffer += chunk;
    // Process one complete SSE event at a time; events are separated by \n\n
    let eventEnd;
    while ((eventEnd = sseBuffer.indexOf('\n\n')) !== -1) {
      if (finished) break;
      const eventBlock = sseBuffer.slice(0, eventEnd);
      sseBuffer = sseBuffer.slice(eventEnd + 2);
      // Collect data: lines within this event (per SSE spec, join with \n)
      const dataLines = [];
      for (const bl of eventBlock.split('\n')) {
        if (bl.indexOf('data: ') === 0) dataLines.push(bl.slice(6));
      }
      if (dataLines.length === 0) continue;
      const dataStr = dataLines.join('\n');
      if (dataStr === '[DONE]') { finished = true; break; }
      if (dataStr.charAt(0) === '{') {
        try {
          const msg = JSON.parse(dataStr);
          if (msg.type === 'sources') { extra.sources = msg.cards || []; continue; }
          if (msg.type === 'web_search_results') { extra.webSearchResults = msg.results || []; continue; }
          if (msg.type === 'context_debug') { continue; }
          if (msg.type === 'content_replace') { content = msg.content || ''; if (onChunk) onChunk(content); continue; }
          if (msg.type === 'error') { finished = true; if (onError) onError(new Error(msg.content || msg.message || 'AI error')); return; }
          if (msg.type === 'cancelled') { finished = true; break; }
        } catch (_e) {}
        continue;
      }
      // Plain text token — concatenate directly, no extra newline between tokens
      content += dataStr;
      if (onChunk) onChunk(content);
    }
    if (finished) {
      if (onDone) onDone(content, extra);
    }
  }

  if (task && typeof task.onChunkReceived === 'function') {
    task.onChunkReceived((res) => {
      if (!res || !res.data) return;
      const text = decode(res.data);
      parseSSE(text);
    });
  } else if (task && typeof task.onChunkText === 'function') {
    task.onChunkText((text) => {
      if (!text) return;
      parseSSE(text);
    });
  } else {
    request('POST', path, body).then((data) => {
      if (typeof data === 'string') parseSSE(data);
      else if (!finished) { content = data.answer || data.reply || ''; if (onChunk) onChunk(content); if (onDone) onDone(content, {}); }
    }).catch((e) => {
      if (!finished && onError) onError(e);
    });
  }

  return task;
}

// ── Core: Convenience ──

function get(path) { return request('GET', path); }
function post(path, data) { return request('POST', path, data); }
function put(path, data) { return request('PUT', path, data); }
function del(path) { return request('DELETE', path); }

// ── Auth API ──

const authApi = {
  login: function (username, password) {
    return post('/api/auth/login', { username: username, password: password });
  },
  register: function (username, password, nickname) {
    return post('/api/auth/register', { username: username, password: password, nickname: nickname });
  },
  wechatLogin: function (code) {
    return post('/api/auth/wechat-login', { code: code });
  },
  devLogin: function (nickname) {
    return post('/api/auth/dev-login', { nickname: nickname || '小程序用户' });
  },
  getMe: function () {
    return get('/api/auth/me');
  },
};

// ── Cards API ──

const cardsApi = {
  list: function (wsId, cursor, limit) {
    let path = `/api/cards/?workspace_id=${wsId}&limit=${limit || 50}`;
    if (cursor) path += '&cursor=' + encodeURIComponent(cursor);
    return get(path);
  },
  get: function (id) {
    return get('/api/cards/' + id);
  },
  create: function (data) {
    return post('/api/cards/', data);
  },
  update: function (id, data) {
    return put('/api/cards/' + id, data);
  },
  delete: function (id) {
    return del('/api/cards/' + id);
  },
  batchCreate: function (wsId, cards) {
    return post('/api/cards/batch', { workspace_id: wsId, cards: cards });
  },
  deletePreview: function (id) {
    return get('/api/cards/' + id + '/delete-preview');
  },
  relations: function (id) {
    return get('/api/cards/' + id + '/relations');
  },
  addRelation: function (id, data) {
    return post('/api/cards/' + id + '/relations', data);
  },
  removeRelation: function (id, relatedId) {
    return del('/api/cards/' + id + '/relations/' + relatedId);
  },
  getComments: function (cardId) {
    return get('/api/cards/' + cardId + '/comments');
  },
  addComment: function (cardId, data) {
    return post('/api/cards/' + cardId + '/comments', data);
  },
  deleteComment: function (cardId, commentId) {
    return del('/api/cards/' + cardId + '/comments/' + commentId);
  },
};

// ── Workspaces API ──

const workspacesApi = {
  list: function () {
    return get('/api/workspaces/');
  },
  create: function (data) {
    return post('/api/workspaces/', data);
  },
  update: function (id, data) {
    return put('/api/workspaces/' + id, data);
  },
  delete: function (id) {
    return del('/api/workspaces/' + id);
  },
  leave: function (id) {
    return post('/api/workspaces/' + id + '/leave');
  },
  members: function (id) {
    return get('/api/workspaces/' + id + '/members');
  },
  removeMember: function (wsId, userId) {
    return del('/api/workspaces/' + wsId + '/members/' + userId);
  },
  updateMemberRole: function (wsId, userId, role) {
    return post('/api/workspaces/' + wsId + '/members/' + userId + '/role', { role: role });
  },
  generateInviteCode: function (id) {
    return post('/api/workspaces/' + id + '/invite-code');
  },
  joinByCode: function (code) {
    return post('/api/workspaces/join', { code: code });
  },
};

// ── Chat API ──

const chatApi = {
  list: function (cardId, workspaceId) {
    let path = '/api/chats/';
    if (cardId) path += '?card_id=' + cardId;
    else if (workspaceId) path += '?workspace_id=' + workspaceId;
    return get(path);
  },
  get: function (chatId) {
    return get('/api/chats/' + chatId);
  },
  create: function (data) {
    return post('/api/chats/', data);
  },
  delete: function (chatId) {
    return del('/api/chats/' + chatId);
  },
  getMessages: function (chatId) {
    return get('/api/chats/' + chatId + '/messages');
  },
  batchMessages: function (chatId, messages) {
    return post('/api/chats/' + chatId + '/messages/batch', messages);
  },
  fork: function (chatId, topic, mode) {
    return post('/api/chats/' + chatId + '/fork', { topic: topic, mode: mode });
  },
  summarize: function (chatId, title, keywords) {
    const body = {};
    if (title) body.title = title;
    if (keywords && keywords.length) body.keywords = keywords;
    return post('/api/chats/' + chatId + '/summarize', body);
  },
};

// ── RAG API ──

const ragApi = {
  chat: function (message) {
    return post('/api/rag/chat', { message });
  },
  streamChat: function (message, cardId, mode, retrievalDepth, onChunk, onDone, onError) {
    const body = { message };
    if (cardId) body.card_id = cardId;
    if (mode) body.mode = mode;
    if (retrievalDepth) body.retrieval_depth = retrievalDepth;
    return streamRequest('/api/rag/chat/stream', body, onChunk, onDone, onError);
  },
  askStream: function (params, onChunk, onDone, onError) {
    return streamRequest('/api/rag/ask/stream', params, onChunk, onDone, onError);
  },
  similar: function (cardId, limit) {
    return get('/api/rag/similar/' + cardId + (limit ? '?limit=' + limit : ''));
  },
  insights: function (workspaceId) {
    return post('/api/rag/insights', { workspace_id: workspaceId });
  },
};

// ── AI API ──

const aiApi = {
  polish: function (content) {
    return post('/api/ai/polish', { content: content });
  },
  supplement: function (content) {
    return post('/api/ai/supplement', { content: content });
  },
  extractKeywords: function (content) {
    return post('/api/ai/extract-keywords', { content: content });
  },
  generateTitle: function (content) {
    return post('/api/ai/generate-title', { content: content });
  },
  segmentContent: function (content) {
    return post('/api/ai/segment-content', { content: content });
  },
};

// ── Search API ──

const searchApi = {
  search: function (query, wsId, mode) {
    const path = `/api/search/${mode || ''}`;
    return post(path, { query: query, workspace_id: wsId });
  },
};

// ── Notifications API ──

const notificationsApi = {
  list: function () {
    return get('/api/notifications/');
  },
  unreadCount: function () {
    return get('/api/notifications/unread-count');
  },
  markRead: function (id) {
    return post('/api/notifications/' + id + '/read');
  },
  markAllRead: function () {
    return post('/api/notifications/read-all');
  },
};

// ── Activities API ──

const activitiesApi = {
  list: function (wsId, limit) {
    return get('/api/activities/' + wsId + '?limit=' + (limit || 50));
  },
};

// ── Settings API ──

const settingsApi = {
  get: function () {
    return get('/api/settings/');
  },
  update: function (data) {
    return put('/api/settings/', data);
  },
};

// ── Memory API ──

const memoryApi = {
  list: function (wsId) {
    return get('/api/workspaces/' + wsId + '/memories');
  },
  upsert: function (wsId, memory) {
    return post('/api/workspaces/' + wsId + '/memories', memory);
  },
  delete: function (wsId, slug) {
    return del('/api/workspaces/' + wsId + '/memories/' + slug);
  },
};

// ── Graph API ──

const graphApi = {
  entities: function (wsId) {
    return get('/api/graph/entities?workspace_id=' + wsId);
  },
  relations: function (wsId) {
    return get('/api/graph/relations?workspace_id=' + wsId);
  },
  getEntity: function (entityId, wsId) {
    return get('/api/graph/entities/' + entityId + '?workspace_id=' + wsId);
  },
  search: function (query, wsId, k) {
    return post('/api/graph/search?workspace_id=' + wsId, { query: query, k: k || 10 });
  },
  getStats: function (wsId) {
    return get('/api/graph/stats?workspace_id=' + wsId);
  },
  getCommunities: function (wsId) {
    return get('/api/graph/communities?workspace_id=' + wsId);
  },
};

// ── Exports ──

module.exports = {
  API_BASE: API_BASE,
  getToken: getToken,
  setToken: setToken,
  clearToken: clearToken,
  request: request,
  streamRequest: streamRequest,
  get: get,
  post: post,
  put: put,
  del: del,
  authApi: authApi,
  cardsApi: cardsApi,
  workspacesApi: workspacesApi,
  chatApi: chatApi,
  ragApi: ragApi,
  aiApi: aiApi,
  searchApi: searchApi,
  notificationsApi: notificationsApi,
  activitiesApi: activitiesApi,
  settingsApi: settingsApi,
  memoryApi: memoryApi,
  graphApi: graphApi,
};

/**
 * Domain-organized API modules for miniapp.
 * Mirrors web/lib/api.ts structure.
 */

var config = require('../config.js');
var API_BASE = config.apiBaseUrl;

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
  var url = API_BASE + path;
  return new Promise(function (resolve, reject) {
    var token = getToken();
    wx.request({
      url: url,
      method: method,
      data: data ? JSON.stringify(data) : undefined,
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? 'Bearer ' + token : '',
      },
      success: function (res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else if (res.statusCode === 401) {
          clearToken();
          wx.reLaunch({ url: '/pages/login/login' });
          reject(new Error('登录已过期，请重新登录'));
        } else {
          var detail = (res.data && res.data.detail) || ('HTTP ' + res.statusCode);
          reject(new Error(detail));
        }
      },
      fail: function (err) {
        reject(new Error(err.errMsg || '网络请求失败'));
      },
    });
  });
}

// ── Core: SSE Stream Request ──

function streamRequest(path, body, onChunk, onDone, onError) {
  var token = getToken();
  var fullContent = '';
  var extra = {};

  var task = wx.request({
    url: API_BASE + path,
    method: 'POST',
    enableChunked: true,
    header: {
      'Content-Type': 'application/json',
      'Authorization': token ? 'Bearer ' + token : '',
      'Accept': 'text/event-stream',
    },
    data: JSON.stringify(body),
    success: function () {},
    fail: function (err) {
      if (onError) onError(new Error(err.errMsg || '网络请求失败'));
    },
  });

  if (task && typeof task.onChunkText === 'function') {
    var buffer = '';
    task.onChunkText(function (text) {
      buffer += text;
      buffer = buffer.replace(/\r\n/g, '\n');
      var lines = buffer.split('\n');
      buffer = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf('data: ') !== 0) continue;
        var dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') {
          if (onDone) onDone(fullContent, extra);
          return;
        }
        if (dataStr.charAt(0) === '{') {
          try {
            var msg = JSON.parse(dataStr);
            if (msg.type === 'sources') {
              extra.sources = msg.cards || [];
              continue;
            }
            if (msg.type === 'web_search_results') {
              extra.webSearchResults = msg.results || [];
              continue;
            }
            if (msg.type === 'content_replace') {
              fullContent = msg.content || '';
              if (onChunk) onChunk(fullContent);
              continue;
            }
            if (msg.type === 'tool_executed') {
              extra.toolExecuted = extra.toolExecuted || [];
              extra.toolExecuted.push(msg);
              continue;
            }
            if (msg.type === 'fork_created') {
              extra.forkCreated = msg;
              continue;
            }
            if (msg.type === 'error') {
              if (onError) onError(new Error(msg.content || msg.message || 'AI error'));
              return;
            }
            if (msg.type === 'cancelled') {
              if (onDone) onDone(fullContent, extra);
              return;
            }
          } catch (_e) {}
        }
        fullContent += dataStr;
        if (onChunk) onChunk(fullContent);
      }
    });
  } else {
    request('POST', path, body)
      .then(function (data) {
        var content = data.answer || data.reply || '';
        if (onChunk) onChunk(content);
        if (onDone) onDone(content, {});
      })
      .catch(function (e) { if (onError) onError(e); });
  }

  return task;
}

// ── Core: Convenience ──

function get(path) { return request('GET', path); }
function post(path, data) { return request('POST', path, data); }
function put(path, data) { return request('PUT', path, data); }
function del(path) { return request('DELETE', path); }

// ── Auth API ──

var authApi = {
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

var cardsApi = {
  list: function (wsId, cursor, limit) {
    var path = '/api/cards/?workspace_id=' + wsId + '&limit=' + (limit || 50);
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

var workspacesApi = {
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

var chatApi = {
  list: function (cardId, workspaceId) {
    var path = '/api/chats/';
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
    var body = {};
    if (title) body.title = title;
    if (keywords && keywords.length) body.keywords = keywords;
    return post('/api/chats/' + chatId + '/summarize', body);
  },
};

// ── RAG API ──

var ragApi = {
  streamChat: function (message, cardId, mode, retrievalDepth, onChunk, onDone, onError) {
    var body = { message: message };
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

var aiApi = {
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

var searchApi = {
  search: function (query, wsId, mode) {
    var path = '/api/search/' + (mode || '');
    return post(path, { query: query, workspace_id: wsId });
  },
};

// ── Notifications API ──

var notificationsApi = {
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

var activitiesApi = {
  list: function (wsId, limit) {
    return get('/api/activities/' + wsId + '?limit=' + (limit || 50));
  },
};

// ── Settings API ──

var settingsApi = {
  get: function () {
    return get('/api/settings/');
  },
  update: function (data) {
    return put('/api/settings/', data);
  },
};

// ── Memory API ──

var memoryApi = {
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

var graphApi = {
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

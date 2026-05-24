// app.js
const { mockCards, mockChats } = require('./utils/mock-data');
const api = require('./utils/api');

App({
  globalData: {
    cards: [],
    aiChats: [],
    settings: {},
    workspaces: [],
    currentWorkspaceId: '',
    currentUser: { openId: '', nickName: '' },
    comments: [],
  },

  onLaunch() {
    this._dataReady = false;
    this._dataReadyCallbacks = [];
    this._loadAllData();
  },

  _onDataReady(fn) {
    if (this._dataReady) {
      fn();
    } else {
      this._dataReadyCallbacks.push(fn);
    }
  },

  async _loadAllData() {
    var authOk = await this._initUser();
    if (!authOk) return;

    this._loadSettings();

    try {
      await this._loadWorkspacesFromApi();
      await this._loadCardsFromApi();
      this._loadUserFromToken();
    } catch (e) {
      console.error('[API] Failed to load from API:', e);
    }

    this._dataReady = true;
    this._dataReadyCallbacks.forEach(function (fn) { fn(); });
    this._dataReadyCallbacks = [];
  },

  // ── User Identity ──

  async _initUser() {
    // Try cached identity first
    const cached = wx.getStorageSync('user_identity');
    if (cached && cached.openId) {
      this.globalData.currentUser = cached;
    }

    // If we have a token, validate it
    if (api.getToken()) {
      try {
        await api.get('/api/auth/me');
        return true;
      } catch (e) {
        // Token invalid or expired — clear it
        console.warn('[Auth] Token invalid, clearing');
        api.clearToken();
      }
    }

    // No valid token — redirect to login page
    wx.navigateTo({ url: '/pages/login/login' });
    return false;
  },

  // ── Workspace Management ──

  async _loadWorkspacesFromApi() {
    try {
      const workspaces = await api.get('/api/workspaces/');
      var self = this;
      this.globalData.workspaces = workspaces.map(function (ws) {
        return {
          id: ws.id,
          name: ws.name,
          icon: ws.icon || '💡',
          color: ws.color || '#94B4C8',
          createdAt: self._formatApiTime(ws.created_at),
          owner: ws.owner_id,
          inviteCode: ws.invite_code || '',
          memberRole: ws.member_role || 'editor',
        };
      });
      // Select current workspace
      const cur = wx.getStorageSync('current_workspace');
      const validCur = this.globalData.workspaces.find(function (w) { return w.id === cur; });
      this.globalData.currentWorkspaceId = validCur ? cur : (this.globalData.workspaces[0] ? this.globalData.workspaces[0].id : '');
      if (!this.globalData.currentWorkspaceId && this.globalData.workspaces.length === 0) {
        // No workspaces yet — create default
        await this._createDefaultWorkspace();
      }
    } catch (e) {
      throw e;
    }
  },

  async _createDefaultWorkspace() {
    try {
      const ws = await api.post('/api/workspaces/', {
        name: '默认空间',
        icon: '💡',
        color: '#94B4C8',
      });
      this.globalData.workspaces = [{
        id: ws.id,
        name: ws.name,
        icon: ws.icon || '💡',
        color: ws.color || '#94B4C8',
        createdAt: ws.created_at,
        owner: ws.owner_id,
      }];
      this.globalData.currentWorkspaceId = ws.id;
      wx.setStorageSync('current_workspace', ws.id);
    } catch (e) {
      console.error('[API] Failed to create default workspace:', e);
      // Fallback: local default
      var defaultWs = {
        id: 'ws_default',
        name: '默认空间',
        icon: '💡',
        color: '#94B4C8',
        createdAt: this._formatTime(new Date()),
      };
      this.globalData.workspaces = [defaultWs];
      this.globalData.currentWorkspaceId = 'ws_default';
    }
  },

  _loadWorkspaces() {
    const stored = wx.getStorageSync('workspaces');
    if (stored && stored.length > 0) {
      this.globalData.workspaces = stored;
    } else {
      const defaultWs = {
        id: 'ws_default',
        name: '默认空间',
        icon: '💡',
        color: '#94B4C8',
        createdAt: this._formatTime(new Date()),
      };
      this.globalData.workspaces = [defaultWs];
      wx.setStorageSync('workspaces', [defaultWs]);
    }
    const cur = wx.getStorageSync('current_workspace');
    this.globalData.currentWorkspaceId = cur || this.globalData.workspaces[0].id;
  },

  getCurrentWorkspace() {
    return this.globalData.workspaces.find(w => w.id === this.globalData.currentWorkspaceId) || this.globalData.workspaces[0];
  },

  getWorkspaceCards() {
    const wsId = this.globalData.currentWorkspaceId;
    return this.globalData.cards.filter(c => c.workspaceId === wsId);
  },

  switchWorkspace(id) {
    this.globalData.currentWorkspaceId = id;
    wx.setStorageSync('current_workspace', id);
    // Reload cards for the new workspace (only if API-backed)
    if (id && id.indexOf('ws_') !== 0) {
      this._loadCardsFromApi().catch(function () {});
    }
  },

  async createWorkspace({ name, icon, color }) {
    var localId = 'ws_' + Date.now();
    try {
      const ws = await api.post('/api/workspaces/', {
        local_id: localId,
        name: name,
        icon: icon || '💡',
        color: color || '#94B4C8',
      });
      var localWs = {
        id: ws.id,
        name: ws.name,
        icon: ws.icon || '💡',
        color: ws.color || '#94B4C8',
        createdAt: ws.created_at,
        owner: ws.owner_id,
      };
      this.globalData.workspaces = this.globalData.workspaces.concat([localWs]);
      return localWs;
    } catch (e) {
      console.error('[API] createWorkspace failed:', e);
      // Fallback: local
      var user = this.globalData.currentUser;
      var local = {
        id: 'ws_' + Date.now(),
        name: name,
        icon: icon || '💡',
        color: color || '#94B4C8',
        createdAt: this._formatTime(new Date()),
        owner: user.openId,
      };
      this.globalData.workspaces = this.globalData.workspaces.concat([local]);
      wx.setStorageSync('workspaces', this.globalData.workspaces);
      return local;
    }
  },

  async updateWorkspace(id, updates) {
    try {
      await api.put('/api/workspaces/' + id, updates);
    } catch (e) {
      console.error('[API] updateWorkspace failed:', e);
    }
    // Update local cache regardless
    var idx = this.globalData.workspaces.findIndex(function (w) { return w.id === id; });
    if (idx !== -1) {
      this.globalData.workspaces[idx] = Object.assign({}, this.globalData.workspaces[idx], updates);
    }
  },

  async deleteWorkspace(id) {
    try {
      await api.del('/api/workspaces/' + id);
    } catch (e) {
      console.error('[API] deleteWorkspace failed:', e);
    }
    // Remove local
    this.globalData.cards = this.globalData.cards.filter(function (c) { return c.workspaceId !== id; });
    var remainingCardIds = new Set(this.globalData.cards.map(function (c) { return c.id; }));
    this.globalData.aiChats = this.globalData.aiChats.filter(function (c) { return remainingCardIds.has(c.cardId); });
    this.globalData.workspaces = this.globalData.workspaces.filter(function (w) { return w.id !== id; });
    wx.setStorageSync('workspaces', this.globalData.workspaces);
    wx.setStorageSync('inspiration_cards', this.globalData.cards);
    wx.setStorageSync('ai_chats', this.globalData.aiChats);
    if (this.globalData.currentWorkspaceId === id && this.globalData.workspaces.length > 0) {
      this.switchWorkspace(this.globalData.workspaces[0].id);
    }
  },

  // ── Card Loading ──

  async _loadCardsFromApi() {
    var wsId = this.globalData.currentWorkspaceId;
    if (!wsId || wsId.indexOf('ws_') === 0) return; // skip local-only IDs
    try {
      var cards = await api.get('/api/cards/?workspace_id=' + wsId);
      var self = this;
      this.globalData.cards = cards.map(function (c) {
        return {
          id: c.id,
          workspaceId: c.workspace_id,
          title: c.title || '',
          content: c.content || '',
          keywords: c.keywords || [],
          color: c.color || '#B8D4E3',
          createdAt: self._formatApiTime(c.created_at),
          updatedAt: self._formatApiTime(c.updated_at),
          isFavorite: c.is_favorite || false,
          relatedIds: (c.relations || []).map(function (r) { return r.related_card_id; }),
          agentRecommendIds: [],
          agentScores: {},
          hasAiChat: false,
        };
      });
      wx.setStorageSync('inspiration_cards', this.globalData.cards);
    } catch (e) {
      console.error('[API] loadCards failed:', e);
      this._loadData();
    }
  },

  _loadData() {
    const stored = wx.getStorageSync('inspiration_cards');
    if (stored && stored.length > 0) {
      this.globalData.cards = stored;
    } else {
      const wsId = this.globalData.currentWorkspaceId || 'ws_default';
      this.globalData.cards = mockCards.map(c => ({ ...c, workspaceId: c.workspaceId || wsId }));
      wx.setStorageSync('inspiration_cards', this.globalData.cards);
    }
    const storedChats = wx.getStorageSync('ai_chats');
    if (storedChats && storedChats.length > 0) {
      this.globalData.aiChats = storedChats;
    } else {
      this.globalData.aiChats = mockChats;
      wx.setStorageSync('ai_chats', mockChats);
    }
  },

  // ── Card CRUD ──

  getCardById(id) {
    return this.globalData.cards.find(c => c.id === id);
  },

  async updateCard(id, updates) {
    // Update local cache immediately
    var idx = this.globalData.cards.findIndex(function (c) { return c.id === id; });
    if (idx !== -1) {
      var updated = Object.assign({}, this.globalData.cards[idx], updates, {
        updatedAt: this._formatTime(new Date()),
      });
      this.globalData.cards[idx] = updated;
      wx.setStorageSync('inspiration_cards', this.globalData.cards);
    }
    // Sync to API (only if we have a server UUID)
    if (id.indexOf('card_') === 0) return;
    var apiPayload = {};
    if (updates.title !== undefined) apiPayload.title = updates.title;
    if (updates.content !== undefined) apiPayload.content = updates.content;
    if (updates.keywords !== undefined) apiPayload.keywords = updates.keywords;
    if (updates.color !== undefined) apiPayload.color = updates.color;
    if (updates.isFavorite !== undefined) apiPayload.is_favorite = updates.isFavorite;
    if (updates.isTemp !== undefined) apiPayload.is_temp = updates.isTemp;
    if (Object.keys(apiPayload).length > 0) {
      try {
        await api.put('/api/cards/' + id, apiPayload);
      } catch (e) {
        console.error('[API] updateCard failed:', e);
      }
    }
  },

  async addCard(card) {
    var wsId = this.globalData.currentWorkspaceId;
    var newCard = Object.assign({}, card, {
      id: 'card_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      workspaceId: wsId,
      keywords: card.keywords || [],
      createdAt: this._formatTime(new Date()),
      updatedAt: null,
      isFavorite: false,
      relatedIds: [],
      agentRecommendIds: [],
      agentScores: {},
      hasAiChat: false,
    });

    // Add to local cache immediately
    this.globalData.cards.unshift(newCard);
    wx.setStorageSync('inspiration_cards', this.globalData.cards);

    // Sync to API
    try {
      var created = await api.post('/api/cards/', {
        local_id: newCard.id,
        workspace_id: wsId,
        title: newCard.title || '',
        content: newCard.content || '',
        keywords: newCard.keywords,
        color: newCard.color || '#B8D4E3',
      });
      // Update local with server-assigned ID
      if (created && created.id) {
        newCard.id = created.id;
        this.globalData.cards[0] = newCard;
        wx.setStorageSync('inspiration_cards', this.globalData.cards);
      }
    } catch (e) {
      console.error('[API] addCard failed, saved locally:', e);
    }

    // Background AI: auto-extract keywords + auto-generate title
    if ((newCard.content || '').trim()) {
      if (newCard.keywords.length === 0) {
        api.post('/api/ai/extract-keywords', { content: newCard.content })
          .then(function (res) {
            if (res.keywords && res.keywords.length > 0) this.updateCard(newCard.id, { keywords: res.keywords });
          }.bind(this)).catch(function () {});
      }
      if (!newCard.title) {
        api.post('/api/ai/generate-title', { content: newCard.content })
          .then(function (res) {
            if (res.title && res.title.trim()) this.updateCard(newCard.id, { title: res.title.trim() });
          }.bind(this)).catch(function () {});
      }
    }
    return newCard;
  },

  deleteCard(id) {
    this.deleteCards([id]);
  },

  async deleteCards(ids) {
    var idSet = new Set(ids);
    // Remove from local cache
    this.globalData.cards = this.globalData.cards
      .filter(function (c) { return !idSet.has(c.id); })
      .map(function (card) {
        return Object.assign({}, card, {
          relatedIds: card.relatedIds.filter(function (rid) { return !idSet.has(rid); }),
          agentRecommendIds: card.agentRecommendIds.filter(function (rid) { return !idSet.has(rid); }),
        });
      });
    this.globalData.aiChats = this.globalData.aiChats.filter(function (c) { return !idSet.has(c.cardId); });
    wx.setStorageSync('inspiration_cards', this.globalData.cards);
    wx.setStorageSync('ai_chats', this.globalData.aiChats);

    // Sync deletion to API (skip local IDs)
    for (var i = 0; i < ids.length; i++) {
      if (ids[i].indexOf('card_') === 0) continue;
      try {
        await api.del('/api/cards/' + ids[i]);
      } catch (e) {
        console.error('[API] deleteCard failed for ' + ids[i] + ':', e);
      }
    }
  },

  // ── Chat Persistence ──

  getChatByCardId(cardId) {
    return this.globalData.aiChats.find(c => c.cardId === cardId) || null;
  },

  async saveChat(chat) {
    // Update local cache
    var idx = this.globalData.aiChats.findIndex(function (c) { return c.id === chat.id; });
    if (idx !== -1) {
      this.globalData.aiChats[idx] = chat;
    } else {
      this.globalData.aiChats.push(chat);
    }
    wx.setStorageSync('ai_chats', this.globalData.aiChats);

    // Sync to API (create chat if needed, then save all messages)
    try {
      var isServerChat = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(chat.id);
      var serverChatId = chat.id;

      if (!isServerChat) {
        var created = await api.post('/api/chats/', {
          local_id: chat.id,
          title: chat.title || '',
          card_id: chat.cardId || undefined,
          workspace_id: this.globalData.currentWorkspaceId || undefined,
          mode: 'chat',
        });
        if (created && created.id) {
          var oldId = chat.id;
          serverChatId = created.id;
          // Update local chat: change ID but keep cardId
          var cidx = this.globalData.aiChats.findIndex(function (c) { return c.id === oldId; });
          if (cidx !== -1) {
            this.globalData.aiChats[cidx] = Object.assign({}, this.globalData.aiChats[cidx], { id: created.id });
            wx.setStorageSync('ai_chats', this.globalData.aiChats);
          }
        }
      }

      // Save all messages via batch endpoint
      if (chat.messages && chat.messages.length > 0) {
        var msgs = chat.messages.map(function (m) {
          return { role: m.role === 'ai' ? 'assistant' : m.role, content: m.content };
        });
        await api.post('/api/chats/' + serverChatId + '/messages/batch', msgs);
      }

      if (serverChatId !== chat.id) return serverChatId;
    } catch (e) {
      console.error('[API] saveChat failed:', e);
    }
    return chat.id;
  },

  async deleteChat(chatId) {
    this.globalData.aiChats = this.globalData.aiChats.filter(function (c) { return c.id !== chatId; });
    wx.setStorageSync('ai_chats', this.globalData.aiChats);
    try {
      await api.del('/api/chats/' + chatId);
    } catch (e) {
      console.error('[API] deleteChat failed:', e);
    }
  },

  // ── User from Token ──

  _loadUserFromToken() {
    var token = api.getToken();
    if (!token) return;
    try {
      // Decode JWT payload (base64url)
      var parts = token.split('.');
      if (parts.length < 2) return;
      var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      var userId = payload.sub;
      if (userId) {
        this.globalData.currentUser = Object.assign({}, this.globalData.currentUser, {
          openId: userId,
          id: userId,
        });
        wx.setStorageSync('user_identity', this.globalData.currentUser);
      }
    } catch (_e) {}
  },

  // ── Settings ──

  _loadSettings() {
    const stored = wx.getStorageSync('app_settings');
    if (stored) {
      try {
        this.globalData.settings = typeof stored === 'string' ? JSON.parse(stored) : stored;
      } catch (_e) {
        this.globalData.settings = {};
      }
    }
  },

  getSetting(key, defaultValue) {
    const val = this.globalData.settings[key];
    return val !== undefined ? val : defaultValue;
  },

  saveSetting(key, value) {
    this.globalData.settings = Object.assign({}, this.globalData.settings, { [key]: value });
    wx.setStorageSync('app_settings', this.globalData.settings);
  },

  // ── Comments ──

  async loadChatsFromApi(workspaceId) {
    try {
      var self = this;
      var chats = await api.get('/api/chats/?workspace_id=' + workspaceId);
      var loaded = (chats || []).map(function (c) {
        return {
          id: c.id,
          cardId: c.card_id || '',
          title: c.title || '灵感对话',
          createdAt: self._formatApiTime(c.created_at),
          messages: [],
          messageCount: c.message_count || 0,
          lastMessage: c.last_message || '',
        };
      });
      // Merge with local chats (don't overwrite local messages)
      loaded.forEach(function (serverChat) {
        var existing = self.globalData.aiChats.find(function (lc) { return lc.id === serverChat.id; });
        if (!existing) {
          self.globalData.aiChats.push(serverChat);
        } else {
          // Update metadata but keep local messages
          existing.messageCount = serverChat.messageCount;
          existing.lastMessage = serverChat.lastMessage;
          existing.title = serverChat.title || existing.title;
        }
      });
      wx.setStorageSync('ai_chats', this.globalData.aiChats);
      return loaded;
    } catch (e) {
      console.error('[API] loadChatsFromApi failed:', e);
      return [];
    }
  },

  async loadChatMessages(chatId) {
    try {
      var chat = await api.get('/api/chats/' + chatId);
      var messages = (chat.messages || []).map(function (m) {
        var d = new Date(m.created_at);
        var time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        return {
          id: m.id,
          uid: m.id,
          role: m.role === 'assistant' ? 'ai' : m.role,
          content: m.content,
          time: time,
        };
      });
      // Update local cache
      var idx = this.globalData.aiChats.findIndex(function (c) { return c.id === chatId; });
      if (idx !== -1) {
        this.globalData.aiChats[idx].messages = messages;
        wx.setStorageSync('ai_chats', this.globalData.aiChats);
      }
      return messages;
    } catch (e) {
      console.error('[API] loadChatMessages failed:', e);
      return [];
    }
  },

  async loadComments(cardId) {
    if (cardId.indexOf('card_') === 0) return [];
    try {
      var self = this;
      var comments = await api.get('/api/cards/' + cardId + '/comments');
      comments = (comments || []).map(function (c) {
        return {
          id: c.id,
          cardId: c.card_id,
          authorId: c.author_id,
          authorNickName: c.author_nickname || '',
          content: c.content,
          createdAt: self._formatApiTime(c.created_at),
        };
      });
      this.globalData.comments = comments;
      return comments;
    } catch (e) {
      console.error('[API] loadComments failed:', e);
      return [];
    }
  },

  async addComment(cardId, content) {
    if (cardId.indexOf('card_') === 0) return false;
    try {
      await api.post('/api/cards/' + cardId + '/comments', {
        content: content,
      });
      await this.loadComments(cardId);
      return true;
    } catch (e) {
      console.error('[API] addComment failed:', e);
      return false;
    }
  },

  async deleteComment(commentId, cardId) {
    if (cardId.indexOf('card_') === 0) return false;
    try {
      await api.del('/api/cards/' + cardId + '/comments/' + commentId);
      this.globalData.comments = this.globalData.comments.filter(function (c) { return c.id !== commentId; });
      return true;
    } catch (e) {
      console.error('[API] deleteComment failed:', e);
      return false;
    }
  },

  // ── Invite & Members ──

  async generateInviteCode(wsId) {
    try {
      var res = await api.post('/api/workspaces/' + wsId + '/invite-code');
      var code = res.invite_code;
      // Update local workspace
      var idx = this.globalData.workspaces.findIndex(function (w) { return w.id === wsId; });
      if (idx !== -1) {
        this.globalData.workspaces[idx].inviteCode = code;
      }
      return code;
    } catch (e) {
      console.error('[API] generateInviteCode failed:', e);
      return null;
    }
  },

  async joinWorkspace(inviteCode) {
    try {
      var res = await api.post('/api/workspaces/join', { invite_code: inviteCode });
      // Reload workspaces
      await this._loadWorkspacesFromApi();
      return res;
    } catch (e) {
      console.error('[API] joinWorkspace failed:', e);
      return null;
    }
  },

  async removeMember(wsId, userId) {
    try {
      await api.del('/api/workspaces/' + wsId + '/members/' + userId);
      return true;
    } catch (e) {
      console.error('[API] removeMember failed:', e);
      return false;
    }
  },

  isWorkspaceOwner(wsId) {
    var ws = this.globalData.workspaces.find(function (w) { return w.id === wsId; });
    if (!ws) return false;
    return ws.owner === this.globalData.currentUser.openId;
  },

  // ── Keyword utilities ──

  getKeywordRegistry() {
    var cards = this.getWorkspaceCards();
    var registry = {};
    cards.forEach(function (c) {
      (c.keywords || []).forEach(function (kw) {
        registry[kw] = (registry[kw] || 0) + 1;
      });
    });
    var sorted = Object.entries(registry).sort(function (a, b) { return b[1] - a[1]; });
    var result = {};
    sorted.forEach(function (entry) { result[entry[0]] = entry[1]; });
    return result;
  },

  getTopKeywords(limit) {
    var registry = this.getKeywordRegistry();
    return Object.keys(registry).slice(0, limit || 15);
  },

  // ── Utility ──

  setCurrentUser(user) {
    this.globalData.currentUser = Object.assign({}, this.globalData.currentUser, user);
    wx.setStorageSync('user_identity', this.globalData.currentUser);
  },

  getCurrentUser() {
    return this.globalData.currentUser;
  },

  _formatTime(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    var h = String(date.getHours()).padStart(2, '0');
    var min = String(date.getMinutes()).padStart(2, '0');
    return y + '-' + m + '-' + d + ' ' + h + ':' + min;
  },

  _formatApiTime(isoStr) {
    if (!isoStr) return '';
    try {
      return this._formatTime(new Date(isoStr));
    } catch (_e) {
      return isoStr;
    }
  },
});

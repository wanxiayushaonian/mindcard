// app.js
const { mockCards, mockChats } = require('./utils/mock-data');
const api = require('./utils/api');
const helpers = require('./utils/helpers');

App({
  globalData: {
    cards: [],
    aiChats: [],
    settings: {},
    workspaces: [],
    currentWorkspaceId: '',
    currentUser: { openId: '', nickName: '' },
    comments: [],
    notifications: [],
    unreadNotificationCount: 0,
    memories: [],
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
        await api.authApi.getMe();
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
      const workspaces = await api.workspacesApi.list();
      var self = this;
      this.globalData.workspaces = workspaces.map(function (ws) {
        return {
          id: ws.id,
          name: ws.name,
          icon: ws.icon || '💡',
          color: ws.color || '#94B4C8',
          createdAt: helpers.formatApiTime(ws.created_at),
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
      const ws = await api.workspacesApi.create({
        name: '默认空间',
        icon: '💡',
        color: '#94B4C8',
      });
      this.globalData.workspaces = [{
        id: ws.id,
        name: ws.name,
        icon: ws.icon || '💡',
        color: ws.color || '#94B4C8',
        createdAt: helpers.formatApiTime(ws.created_at),
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
        createdAt: helpers.formatTime(new Date()),
      };
      this.globalData.workspaces = [defaultWs];
      this.globalData.currentWorkspaceId = 'ws_default';
    }
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
      const ws = await api.workspacesApi.create({
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
        createdAt: helpers.formatApiTime(ws.created_at),
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
        createdAt: helpers.formatTime(new Date()),
        owner: user.openId,
      };
      this.globalData.workspaces = this.globalData.workspaces.concat([local]);
      wx.setStorageSync('workspaces', this.globalData.workspaces);
      return local;
    }
  },

  async updateWorkspace(id, updates) {
    try {
      await api.workspacesApi.update(id, updates);
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
      await api.workspacesApi.delete(id);
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
      var allCards = [];
      var cursor = null;
      var limit = 50;
      do {
        var resp = await api.cardsApi.list(wsId, cursor, limit);
        var items = Array.isArray(resp) ? resp : (resp.items || []);
        allCards = allCards.concat(items);
        cursor = (resp && resp.next_cursor) || null;
      } while (cursor);

      var self = this;
      this.globalData.cards = allCards.map(function (c) {
        var raw = (c.content || '').replace(/\n/g, ' ').replace(/\r/g, '');
        return {
          id: c.id,
          workspaceId: c.workspace_id,
          title: c.title || '',
          content: c.content || '',
          preview: raw.length > 80 ? raw.slice(0, 80) + '...' : raw,
          keywords: c.keywords || [],
          color: c.color || '#B8D4E3',
          emotionTag: c.emotion_tag || '',
          isTemp: c.is_temp !== undefined ? c.is_temp : true,
          parentCardIds: c.parent_card_ids || [],
          createdAt: helpers.formatApiTime(c.created_at),
          updatedAt: helpers.formatApiTime(c.updated_at),
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
      if (updates.content !== undefined) {
        var raw = updates.content.replace(/\n/g, ' ').replace(/\r/g, '');
        updates.preview = raw.length > 80 ? raw.slice(0, 80) + '...' : raw;
      }
      var updated = Object.assign({}, this.globalData.cards[idx], updates, {
        updatedAt: helpers.formatTime(new Date()),
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
    if (updates.emotionTag !== undefined) apiPayload.emotion_tag = updates.emotionTag;
    if (updates.parentCardIds !== undefined) apiPayload.parent_card_ids = updates.parentCardIds;
    if (Object.keys(apiPayload).length > 0) {
      try {
        await api.cardsApi.update(id, apiPayload);
      } catch (e) {
        console.error('[API] updateCard failed:', e);
      }
    }
  },

  async addCard(card) {
    var wsId = this.globalData.currentWorkspaceId;
    var raw = (card.content || '').replace(/\n/g, ' ').replace(/\r/g, '');
    var newCard = Object.assign({}, card, {
      id: 'card_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      workspaceId: wsId,
      preview: raw.length > 80 ? raw.slice(0, 80) + '...' : raw,
      keywords: card.keywords || [],
      emotionTag: card.emotionTag || '',
      isTemp: card.isTemp !== undefined ? card.isTemp : true,
      parentCardIds: card.parentCardIds || [],
      createdAt: helpers.formatTime(new Date()),
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
      var created = await api.cardsApi.create({
        local_id: newCard.id,
        workspace_id: wsId,
        title: newCard.title || '',
        content: newCard.content || '',
        keywords: newCard.keywords,
        color: newCard.color || '#B8D4E3',
        emotion_tag: newCard.emotionTag || '',
        is_temp: newCard.isTemp !== undefined ? newCard.isTemp : true,
        parent_card_ids: newCard.parentCardIds || [],
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
        api.aiApi.extractKeywords(newCard.content)
          .then(function (res) {
            if (res.keywords && res.keywords.length > 0) this.updateCard(newCard.id, { keywords: res.keywords });
          }.bind(this)).catch(function () {});
      }
      if (!newCard.title) {
        api.aiApi.generateTitle(newCard.content)
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

    // Sync deletion to API (skip local IDs, use batch)
    var serverIds = ids.filter(function (id) { return id.indexOf('card_') !== 0; });
    if (serverIds.length > 0) {
      try {
        await api.del('/api/cards/batch', { ids: serverIds });
      } catch (e) {
        // Fallback to individual deletes
        for (var i = 0; i < serverIds.length; i++) {
          try {
            await api.cardsApi.delete(serverIds[i]);
          } catch (e2) {
            console.error('[API] deleteCard failed for ' + serverIds[i] + ':', e2);
          }
        }
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
        var created = await api.chatApi.create({
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
        await api.chatApi.batchMessages(serverChatId, msgs);
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
      await api.chatApi.delete(chatId);
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
      var chats = await api.chatApi.list(null, workspaceId);
      var loaded = (chats || []).map(function (c) {
        return {
          id: c.id,
          cardId: c.card_id || '',
          workspaceId: workspaceId || '',
          title: c.title || '灵感对话',
          createdAt: helpers.formatApiTime(c.created_at),
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
      var chat = await api.chatApi.get(chatId);
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
      var comments = await api.cardsApi.getComments(cardId);
      comments = (comments || []).map(function (c) {
        return {
          id: c.id,
          cardId: c.card_id,
          authorId: c.author_id,
          authorNickName: c.author_nickname || '',
          content: c.content,
          createdAt: helpers.formatApiTime(c.created_at),
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
      await api.cardsApi.addComment(cardId, {
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
      await api.cardsApi.deleteComment(cardId, commentId);
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
      var res = await api.workspacesApi.generateInviteCode(wsId);
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
      var res = await api.workspacesApi.joinByCode(inviteCode);
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
      await api.workspacesApi.removeMember(wsId, userId);
      return true;
    } catch (e) {
      console.error('[API] removeMember failed:', e);
      return false;
    }
  },

  async leaveWorkspace(wsId) {
    try {
      await api.workspacesApi.leave(wsId);
    } catch (e) {
      console.error('[API] leaveWorkspace failed:', e);
      throw e;
    }
    this.globalData.workspaces = this.globalData.workspaces.filter(function (w) { return w.id !== wsId; });
    this.globalData.cards = this.globalData.cards.filter(function (c) { return c.workspaceId !== wsId; });
    wx.setStorageSync('workspaces', this.globalData.workspaces);
    wx.setStorageSync('inspiration_cards', this.globalData.cards);
    if (this.globalData.currentWorkspaceId === wsId && this.globalData.workspaces.length > 0) {
      this.switchWorkspace(this.globalData.workspaces[0].id);
    }
  },

  async updateMemberRole(wsId, userId, role) {
    try {
      await api.workspacesApi.updateMemberRole(wsId, userId, role);
      return true;
    } catch (e) {
      console.error('[API] updateMemberRole failed:', e);
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

  // ── Notifications ──

  async loadNotifications() {
    try {
      var self = this;
      var notifs = await api.notificationsApi.list();
      this.globalData.notifications = (notifs || []).map(function (n) {
        return {
          id: n.id,
          type: n.type,
          content: n.content,
          link: n.link || '',
          isRead: n.is_read,
          createdAt: helpers.formatApiTime(n.created_at),
        };
      });
      return this.globalData.notifications;
    } catch (e) {
      console.error('[API] loadNotifications failed:', e);
      return [];
    }
  },

  async loadUnreadCount() {
    try {
      var res = await api.notificationsApi.unreadCount();
      this.globalData.unreadNotificationCount = res.count || 0;
      return this.globalData.unreadNotificationCount;
    } catch (e) {
      return 0;
    }
  },

  async markNotificationRead(id) {
    try {
      await api.notificationsApi.markRead(id);
      var notif = this.globalData.notifications.find(function (n) { return n.id === id; });
      if (notif && !notif.isRead) {
        notif.isRead = true;
        this.globalData.unreadNotificationCount = Math.max(0, this.globalData.unreadNotificationCount - 1);
      }
    } catch (e) {
      console.error('[API] markNotificationRead failed:', e);
    }
  },

  async markAllNotificationsRead() {
    try {
      await api.notificationsApi.markAllRead();
      this.globalData.notifications.forEach(function (n) { n.isRead = true; });
      this.globalData.unreadNotificationCount = 0;
    } catch (e) {
      console.error('[API] markAllNotificationsRead failed:', e);
    }
  },

  // ── Workspace Memories ──

  async loadMemories(wsId) {
    try {
      var self = this;
      var memories = await api.memoryApi.list(wsId);
      this.globalData.memories = (memories || []).map(function (m) {
        return {
          id: m.id,
          slug: m.slug,
          title: m.title,
          body: m.body,
          sourceChatId: m.source_chat_id || '',
          createdAt: helpers.formatApiTime(m.created_at),
          updatedAt: helpers.formatApiTime(m.updated_at),
        };
      });
      return this.globalData.memories;
    } catch (e) {
      console.error('[API] loadMemories failed:', e);
      return [];
    }
  },

  async upsertMemory(wsId, memory) {
    try {
      var result = await api.memoryApi.upsert(wsId, {
        slug: memory.slug,
        title: memory.title,
        body: memory.body,
        source_chat_id: memory.sourceChatId || undefined,
      });
      await this.loadMemories(wsId);
      return result;
    } catch (e) {
      console.error('[API] upsertMemory failed:', e);
      throw e;
    }
  },

  async deleteMemory(wsId, slug) {
    try {
      await api.memoryApi.delete(wsId, slug);
      this.globalData.memories = this.globalData.memories.filter(function (m) { return m.slug !== slug; });
    } catch (e) {
      console.error('[API] deleteMemory failed:', e);
      throw e;
    }
  },

  // ── Activities ──

  async loadActivities(wsId) {
    try {
      var self = this;
      var activities = await api.activitiesApi.list(wsId);
      return (activities || []).map(function (a) {
        return {
          id: a.id,
          actorNickname: a.actor_nickname || '',
          action: a.action,
          targetType: a.target_type,
          targetId: a.target_id || '',
          metadata: a.metadata || null,
          createdAt: helpers.formatApiTime(a.created_at),
        };
      });
    } catch (e) {
      console.error('[API] loadActivities failed:', e);
      return [];
    }
  },

  // ── Phase 7: Batch / Segment / Summarize ──

  async batchCreateCards(wsId, cards) {
    try {
      var items = cards.map(function (c) {
        return {
          local_id: c.localId || ('mc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
          title: c.title || '',
          content: c.content || '',
          keywords: c.keywords || [],
          color: c.color || '#B8D4E3',
          emotion_tag: c.emotionTag || '',
          is_temp: c.isTemp !== undefined ? c.isTemp : true,
          parent_card_ids: c.parentCardIds || [],
        };
      });
      var resp = await api.cardsApi.batchCreate(wsId, items);
      return resp;
    } catch (e) {
      console.error('[API] batchCreateCards failed:', e);
      throw e;
    }
  },

  async segmentContent(content) {
    try {
      var resp = await api.aiApi.segmentContent(content);
      return resp.segments || resp || [];
    } catch (e) {
      console.error('[API] segmentContent failed:', e);
      throw e;
    }
  },

  async summarizeChat(chatId, title, keywords) {
    try {
      var body = {};
      if (title) body.title = title;
      if (keywords && keywords.length) body.keywords = keywords;
      var resp = await api.chatApi.summarize(chatId, title, keywords);
      return resp;
    } catch (e) {
      console.error('[API] summarizeChat failed:', e);
      throw e;
    }
  },
});

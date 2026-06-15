// app.js — Thin orchestrator delegating to service modules
const api = require('./utils/api');
const { createCardService } = require('./services/card-service');
const { createWorkspaceService } = require('./services/workspace-service');
const { createChatService } = require('./services/chat-service');
const { createNotificationService } = require('./services/notification-service');

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

    // Initialize services
    this._cards = createCardService(this);
    this._workspaces = createWorkspaceService(this);
    this._chats = createChatService(this);
    this._notifications = createNotificationService(this);

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
    const authOk = await this._initUser();
    if (!authOk) return;

    this._loadSettings();

    try {
      await this._workspaces.loadFromApi();
      await this._cards.loadFromApi();
    } catch (e) {
      console.error('[API] Failed to load from API:', e);
    }

    this._dataReady = true;
    this._dataReadyCallbacks.forEach((fn) => fn());
    this._dataReadyCallbacks = [];
  },

  // ── User Identity ──

  async _initUser() {
    const cached = wx.getStorageSync('user_identity');
    if (cached && cached.openId) {
      this.globalData.currentUser = cached;
    }

    if (api.getToken()) {
      try {
        const me = await api.authApi.getMe();
        if (me && me.id) {
          this.globalData.currentUser = {
            ...this.globalData.currentUser,
            openId: me.id,
            id: me.id,
            nickName: me.nickname || me.username || this.globalData.currentUser.nickName || '',
          };
          wx.setStorageSync('user_identity', this.globalData.currentUser);
        }
        return true;
      } catch (e) {
        console.warn('[Auth] Token invalid, clearing');
        api.clearToken();
      }
    }

    wx.navigateTo({ url: '/pages/login/login' });
    return false;
  },

  // Kept as no-op stub — user identity is now set from getMe() in _initUser()
  _loadUserFromToken() {},

  setCurrentUser(user) {
    this.globalData.currentUser = { ...this.globalData.currentUser, ...user };
    wx.setStorageSync('user_identity', this.globalData.currentUser);
  },

  getCurrentUser() {
    return this.globalData.currentUser;
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
    this.globalData.settings = { ...this.globalData.settings, [key]: value };
    wx.setStorageSync('app_settings', this.globalData.settings);
  },

  // ── Card delegation ──

  getCardById(id) { return this._cards.getById(id); },
  getWorkspaceCards() { return this._cards.getWorkspaceCards(); },
  async addCard(card) { return this._cards.add(card); },
  async updateCard(id, updates) { return this._cards.update(id, updates); },
  deleteCard(id) { return this._cards.remove(id); },
  deleteCards(ids) { return this._cards.removeMany(ids); },
  getKeywordRegistry() { return this._cards.getKeywordRegistry(); },
  getTopKeywords(limit) { return this._cards.getTopKeywords(limit); },
  async loadCardRelations(id) { return this._cards.loadRelations(id); },
  async addCardRelation(id, relatedId, relationType) { return this._cards.addRelation(id, relatedId, relationType); },
  async removeCardRelation(id, relatedId) { return this._cards.removeRelation(id, relatedId); },

  async loadGlobalStats() {
    const workspaces = this.globalData.workspaces.filter((w) => w.id.indexOf('ws_') !== 0);
    let totalCards = 0;
    const wsCounts = {};
    await Promise.all(workspaces.map(async (ws) => {
      try {
        let count = 0;
        let cursor = null;
        do {
          const resp = await api.cardsApi.list(ws.id, cursor, 100);
          const items = Array.isArray(resp) ? resp : (resp.items || []);
          count += items.length;
          cursor = (resp && resp.next_cursor) || null;
        } while (cursor);
        wsCounts[ws.id] = count;
        totalCards += count;
      } catch (e) {
        wsCounts[ws.id] = 0;
      }
    }));

    // Detailed stats from current workspace (already in memory)
    const currentCards = this.getWorkspaceCards();
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weeklyNew = currentCards.filter((c) => new Date((c.createdAt || '').replace(/-/g, '/')) >= weekAgo).length;
    const favorites = currentCards.filter((c) => c.isFavorite).length;

    return {
      totalWorkspaces: this.globalData.workspaces.length,
      totalCards,
      wsCounts,
      currentWeeklyNew: weeklyNew,
      currentFavorites: favorites,
      currentTempCards: currentCards.filter((c) => c.isTemp).length,
      currentWorkspaceName: (this.getCurrentWorkspace() || {}).name || '',
    };
  },

  // ── Workspace delegation ──

  getCurrentWorkspace() { return this._workspaces.getCurrent(); },
  async switchWorkspace(wsId) {
    this._workspaces.switchTo(wsId);
    await this._cards.loadFromApi();
  },
  async createWorkspace(data) { return this._workspaces.create(data); },
  async updateWorkspace(id, updates) { return this._workspaces.update(id, updates); },
  async deleteWorkspace(id) { return this._workspaces.remove(id); },
  async generateInviteCode(wsId) { return this._workspaces.generateInviteCode(wsId); },
  async joinWorkspace(code) { return this._workspaces.joinByCode(code); },
  async leaveWorkspace(wsId) { return this._workspaces.leave(wsId); },
  isWorkspaceOwner(wsId) { return this._workspaces.isOwner(wsId); },

  // ── Chat delegation ──

  getChatByCardId(cardId) { return this._chats.getByCardId(cardId); },
  async saveChat(chat) { return this._chats.save(chat); },
  async deleteChat(chatId) { return this._chats.remove(chatId); },
  async loadChatsFromApi(wsId) { return this._chats.loadFromApi(wsId); },
  async loadChatMessages(chatId) { return this._chats.loadMessages(chatId); },

  // ── Notification delegation ──

  async loadNotifications() { return this._notifications.load(); },
  async loadUnreadCount() { return this._notifications.loadUnreadCount(); },
  async markNotificationRead(id) { return this._notifications.markRead(id); },
  async markAllNotificationsRead() { return this._notifications.markAllRead(); },

  // ── Comments (thin wrappers, low complexity) ──

  async loadComments(cardId) {
    if (cardId.indexOf('card_') === 0) return [];
    try {
      const comments = await api.cardsApi.getComments(cardId);
      this.globalData.comments = (comments || []).map((c) => ({
        id: c.id,
        cardId: c.card_id,
        authorId: c.author_id,
        authorNickName: c.author_nickname || '',
        content: c.content,
        createdAt: require('./utils/helpers').formatApiTime(c.created_at),
      }));
      return this.globalData.comments;
    } catch (e) {
      console.error('[API] loadComments failed:', e);
      return [];
    }
  },

  async addComment(cardId, content) {
    if (cardId.indexOf('card_') === 0) return false;
    try {
      await api.cardsApi.addComment(cardId, { content });
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
      this.globalData.comments = this.globalData.comments.filter((c) => c.id !== commentId);
      return true;
    } catch (e) {
      console.error('[API] deleteComment failed:', e);
      return false;
    }
  },

  // ── Workspace Memories ──

  async loadMemories(wsId) {
    try {
      const memories = await api.memoryApi.list(wsId);
      this.globalData.memories = (memories || []).map((m) => ({
        id: m.id,
        slug: m.slug,
        title: m.title,
        body: m.body,
        sourceChatId: m.source_chat_id || '',
        createdAt: require('./utils/helpers').formatApiTime(m.created_at),
        updatedAt: require('./utils/helpers').formatApiTime(m.updated_at),
      }));
      return this.globalData.memories;
    } catch (e) {
      console.error('[API] loadMemories failed:', e);
      return [];
    }
  },

  // ── Activities ──

  async loadActivities(wsId) {
    try {
      const activities = await api.activitiesApi.list(wsId);
      return (activities || []).map((a) => ({
        id: a.id,
        actorNickname: a.actor_nickname || '',
        action: a.action,
        targetType: a.target_type,
        targetId: a.target_id || '',
        metadata: a.metadata || null,
        createdAt: require('./utils/helpers').formatApiTime(a.created_at),
      }));
    } catch (e) {
      console.error('[API] loadActivities failed:', e);
      return [];
    }
  },

  // ── Batch / Segment / Summarize ──

  async batchCreateCards(wsId, cards) {
    try {
      const items = cards.map((c) => ({
        local_id: c.localId || ('mc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
        title: c.title || '',
        content: c.content || '',
        keywords: c.keywords || [],
        color: c.color || '#B8D4E3',
        emotion_tag: c.emotionTag || '',
        is_temp: c.isTemp !== undefined ? c.isTemp : true,
        parent_card_ids: c.parentCardIds || [],
      }));
      return await api.cardsApi.batchCreate(wsId, items);
    } catch (e) {
      console.error('[API] batchCreateCards failed:', e);
      throw e;
    }
  },

  async segmentContent(content) {
    try {
      const resp = await api.aiApi.segmentContent(content);
      return resp.segments || resp || [];
    } catch (e) {
      console.error('[API] segmentContent failed:', e);
      throw e;
    }
  },

  async summarizeChat(chatId, title, keywords) {
    try {
      return await api.chatApi.summarize(chatId, title, keywords);
    } catch (e) {
      console.error('[API] summarizeChat failed:', e);
      throw e;
    }
  },
});

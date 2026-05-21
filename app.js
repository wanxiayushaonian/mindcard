// app.js
const { mockCards, mockChats } = require('./utils/mock-data');
const CloudStorage = require('./utils/cloud-storage');

App({
  globalData: {
    cards: [],
    aiChats: [],
    settings: {},
    workspaces: [],
    currentWorkspaceId: '',
    cloudReady: false,
  },

  onLaunch() {
    this._cloudStorage = new CloudStorage();
    this._cloudStorage.init();
    this._loadAllData();
  },

  async _loadAllData() {
    try {
      const result = await this._cloudStorage.loadAll();
      if (result.isCloud) {
        this.globalData.workspaces = result.workspaces;
        this.globalData.cards = result.cards;
        this.globalData.aiChats = result.aiChats;
        this.globalData.settings = result.settings || {};
        this.globalData.cloudReady = true;

        const cur = wx.getStorageSync('current_workspace');
        this.globalData.currentWorkspaceId = cur || (result.workspaces[0] && result.workspaces[0].id) || '';

        // First launch: no data anywhere
        if (result.workspaces.length === 0 && !wx.getStorageSync('workspaces')) {
          this._seedFirstLaunch();
        } else {
          // Sync merged data to cloud if needed
          this._migrateToCloud();
        }
      } else {
        // Offline: load from local
        this._loadWorkspaces();
        this._loadData();
        this._loadSettings();
      }
    } catch (e) {
      console.error('[CloudStorage] loadAll failed, using local:', e);
      this._loadWorkspaces();
      this._loadData();
      this._loadSettings();
    }
    this._migrateEmotionTags();
  },

  _seedFirstLaunch() {
    const defaultWs = {
      id: 'ws_default',
      name: '默认空间',
      icon: '💡',
      color: '#94B4C8',
      createdAt: this._formatTime(new Date()),
    };
    this.globalData.workspaces = [defaultWs];
    this.globalData.currentWorkspaceId = 'ws_default';
    this.globalData.cards = mockCards.map(c => ({ ...c, workspaceId: c.workspaceId || 'ws_default' }));
    this.globalData.aiChats = mockChats;
    this.globalData.settings = {};

    wx.setStorageSync('workspaces', this.globalData.workspaces);
    wx.setStorageSync('current_workspace', 'ws_default');
    wx.setStorageSync('inspiration_cards', this.globalData.cards);
    wx.setStorageSync('ai_chats', this.globalData.aiChats);

    // Write to cloud (fire-and-forget)
    this._cloudStorage.saveWorkspace(defaultWs);
    this.globalData.cards.forEach(c => this._cloudStorage.saveCard(c));
    this.globalData.aiChats.forEach(c => this._cloudStorage.saveChat(c));
  },

  async _migrateToCloud() {
    if (wx.getStorageSync('cloud_migrated')) return;
    if (!this.globalData.cloudReady) return;

    try {
      const result = await this._cloudStorage.migrateLocalToCloud({
        workspaces: this.globalData.workspaces,
        cards: this.globalData.cards,
        aiChats: this.globalData.aiChats,
        settings: this.globalData.settings,
      });
      console.log('[Migration] Cloud migration complete:', result);
      wx.setStorageSync('cloud_migrated', true);
    } catch (e) {
      console.error('[Migration] Failed, will retry next launch:', e);
    }
  },

  // ── Workspace Management ──

  _loadWorkspaces() {
    const stored = wx.getStorageSync('workspaces');
    if (stored && stored.length > 0) {
      this.globalData.workspaces = stored;
    } else {
      // First launch: create default workspace
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
  },

  createWorkspace({ name, icon, color }) {
    const ws = {
      id: 'ws_' + Date.now(),
      name,
      icon: icon || '💡',
      color: color || '#94B4C8',
      createdAt: this._formatTime(new Date()),
    };
    this.globalData.workspaces = [...this.globalData.workspaces, ws];
    wx.setStorageSync('workspaces', this.globalData.workspaces);
    this._cloudStorage.saveWorkspace(ws);
    return ws;
  },

  updateWorkspace(id, updates) {
    const idx = this.globalData.workspaces.findIndex(w => w.id === id);
    if (idx !== -1) {
      this.globalData.workspaces[idx] = { ...this.globalData.workspaces[idx], ...updates };
      wx.setStorageSync('workspaces', this.globalData.workspaces);
      this._cloudStorage.saveWorkspace(this.globalData.workspaces[idx]);
    }
  },

  deleteWorkspace(id) {
    // Capture IDs for cloud cascade before filtering
    const deletedCardIds = this.globalData.cards.filter(c => c.workspaceId === id).map(c => c.id);
    const deletedChatIds = this.globalData.aiChats.filter(c => deletedCardIds.includes(c.cardId)).map(c => c.id);

    // Remove all cards and chats belonging to this workspace
    this.globalData.cards = this.globalData.cards.filter(c => c.workspaceId !== id);
    const remainingCardIds = new Set(this.globalData.cards.map(c => c.id));
    this.globalData.aiChats = this.globalData.aiChats.filter(c => remainingCardIds.has(c.cardId));
    // Clean up relatedIds/agentRecommendIds pointing to deleted cards
    this.globalData.cards = this.globalData.cards.map(card => ({
      ...card,
      relatedIds: card.relatedIds.filter(rid => remainingCardIds.has(rid)),
      agentRecommendIds: card.agentRecommendIds.filter(rid => remainingCardIds.has(rid)),
    }));

    this.globalData.workspaces = this.globalData.workspaces.filter(w => w.id !== id);
    wx.setStorageSync('workspaces', this.globalData.workspaces);
    wx.setStorageSync('inspiration_cards', this.globalData.cards);
    wx.setStorageSync('ai_chats', this.globalData.aiChats);

    // Cloud cascade delete
    this._cloudStorage.deleteWorkspaces([id]);
    this._cloudStorage.deleteCards(deletedCardIds);
    this._cloudStorage.deleteChats(deletedChatIds);

    // Switch to first workspace if current was deleted
    if (this.globalData.currentWorkspaceId === id && this.globalData.workspaces.length > 0) {
      this.switchWorkspace(this.globalData.workspaces[0].id);
    }
  },

  // ── Data Loading ──

  // ── Keyword Migration ──

  _migrateEmotionTags() {
    let migrated = false;
    this.globalData.cards = this.globalData.cards.map(c => {
      if (c.emotionTag && (!c.keywords || c.keywords.length === 0)) {
        migrated = true;
        return { ...c, keywords: [c.emotionTag], emotionTag: '' };
      }
      return c;
    });
    if (migrated) {
      wx.setStorageSync('inspiration_cards', this.globalData.cards);
    }
  },

  getKeywordRegistry() {
    const cards = this.getWorkspaceCards();
    const registry = {};
    cards.forEach(c => {
      (c.keywords || []).forEach(kw => {
        registry[kw] = (registry[kw] || 0) + 1;
      });
    });
    // Sort by frequency descending
    const sorted = Object.entries(registry).sort((a, b) => b[1] - a[1]);
    const result = {};
    sorted.forEach(([kw, count]) => { result[kw] = count; });
    return result;
  },

  getTopKeywords(limit) {
    const registry = this.getKeywordRegistry();
    return Object.keys(registry).slice(0, limit || 15);
  },

  _autoExtractKeywords(cardId, content) {
    const { extractKeywords } = require('./utils/deepseek');
    extractKeywords(content).then(keywords => {
      if (keywords.length > 0) {
        this.updateCard(cardId, { keywords });
      }
    }).catch(function () {});
  },

  _autoGenerateTitle(cardId, content) {
    const { generateTitle } = require('./utils/deepseek');
    generateTitle(content).then(title => {
      if (title && title.trim()) {
        this.updateCard(cardId, { title: title.trim() });
      }
    }).catch(function () {});
  },

  // ── Data Loading ──

  _loadData() {
    const stored = wx.getStorageSync('inspiration_cards');
    if (stored && stored.length > 0) {
      this.globalData.cards = stored;
    } else {
      // Seed with mock data, assign to default workspace
      const wsId = this.globalData.currentWorkspaceId || 'ws_default';
      this.globalData.cards = mockCards.map(c => ({ ...c, workspaceId: c.workspaceId || wsId }));
      wx.setStorageSync('inspiration_cards', this.globalData.cards);
    }

    // Migration: assign cards without workspaceId to current workspace
    const wsId = this.globalData.currentWorkspaceId;
    let migrated = false;
    this.globalData.cards = this.globalData.cards.map(c => {
      if (!c.workspaceId) {
        migrated = true;
        return { ...c, workspaceId: wsId };
      }
      return c;
    });
    if (migrated) {
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

  _saveSettings() {
    wx.setStorageSync('app_settings', this.globalData.settings);
    this._cloudStorage.saveSettings(this.globalData.settings);
  },

  getSetting(key, defaultValue) {
    const val = this.globalData.settings[key];
    return val !== undefined ? val : defaultValue;
  },

  saveSetting(key, value) {
    this.globalData.settings = { ...this.globalData.settings, [key]: value };
    this._saveSettings();
  },

  // ── Card CRUD ──

  getCardById(id) {
    return this.globalData.cards.find(c => c.id === id);
  },

  updateCard(id, updates) {
    const idx = this.globalData.cards.findIndex(c => c.id === id);
    if (idx !== -1) {
      const updated = {
        ...this.globalData.cards[idx],
        ...updates,
        updatedAt: this._formatTime(new Date()),
      };
      this.globalData.cards[idx] = updated;
      wx.setStorageSync('inspiration_cards', this.globalData.cards);
      this._cloudStorage.saveCard(updated);
    }
  },

  addCard(card) {
    const { findRecommendations } = require('./utils/agent');
    const wsId = this.globalData.currentWorkspaceId;
    const wsCards = this.getWorkspaceCards();
    const newCard = {
      ...card,
      id: 'card_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      workspaceId: wsId,
      keywords: card.keywords || [],
      emotionTag: '',
      createdAt: this._formatTime(new Date()),
      updatedAt: null,
      isFavorite: false,
      isTemp: true,
      relatedIds: [],
      agentRecommendIds: [],
      agentScores: {},
      hasAiChat: false,
    };
    var recs = findRecommendations(newCard, wsCards);
    newCard.agentRecommendIds = recs.map(function (r) { return r.id; });
    recs.forEach(function (r) { newCard.agentScores[r.id] = r.score; });
    this.globalData.cards.unshift(newCard);
    wx.setStorageSync('inspiration_cards', this.globalData.cards);
    this._cloudStorage.saveCard(newCard);
    // Background AI: auto-extract keywords + auto-generate title
    if ((newCard.content || '').trim()) {
      if (newCard.keywords.length === 0) {
        this._autoExtractKeywords(newCard.id, newCard.content);
      }
      if (!newCard.title) {
        this._autoGenerateTitle(newCard.id, newCard.content);
      }
    }
    return newCard;
  },

  deleteCard(id) {
    this.deleteCards([id]);
  },

  deleteCards(ids) {
    var idSet = new Set(ids);
    // Capture chat IDs for cloud cascade before filtering
    var deletedChatIds = this.globalData.aiChats.filter(c => idSet.has(c.cardId)).map(c => c.id);

    this.globalData.cards = this.globalData.cards
      .filter(c => !idSet.has(c.id))
      .map(card => ({
        ...card,
        relatedIds: card.relatedIds.filter(rid => !idSet.has(rid)),
        agentRecommendIds: card.agentRecommendIds.filter(rid => !idSet.has(rid)),
      }));
    this.globalData.aiChats = this.globalData.aiChats.filter(c => !idSet.has(c.cardId));
    wx.setStorageSync('inspiration_cards', this.globalData.cards);
    wx.setStorageSync('ai_chats', this.globalData.aiChats);

    // Cloud cascade delete
    this._cloudStorage.deleteCards(ids);
    this._cloudStorage.deleteChats(deletedChatIds);
  },

  // ── Chat Persistence ──

  getChatByCardId(cardId) {
    return this.globalData.aiChats.find(c => c.cardId === cardId) || null;
  },

  saveChat(chat) {
    const idx = this.globalData.aiChats.findIndex(c => c.id === chat.id);
    if (idx !== -1) {
      this.globalData.aiChats[idx] = chat;
    } else {
      this.globalData.aiChats.push(chat);
    }
    wx.setStorageSync('ai_chats', this.globalData.aiChats);
    this._cloudStorage.saveChat(chat);
  },

  deleteChat(chatId) {
    this.globalData.aiChats = this.globalData.aiChats.filter(c => c.id !== chatId);
    wx.setStorageSync('ai_chats', this.globalData.aiChats);
    this._cloudStorage.deleteChats([chatId]);
  },

  _formatTime(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}`;
  },
});

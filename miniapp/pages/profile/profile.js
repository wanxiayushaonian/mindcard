// pages/profile/profile.js
const { PROVIDERS } = require('../../utils/deepseek');

Page({
  data: {
    stats: {
      totalCards: 0,
      weeklyNew: 0,
      favorites: 0,
      aiChats: 0,
      tempCards: 0,
    },
    aiAutoRecommend: true,
    showClearConfirm: false,
    showApiKeyModal: false,
    apiKeyInput: '',
    agentSensitivity: '中',
    walkSensitivity: '高',
    aiTone: '创意',
    aiDirection: '发散',
    // AI provider
    aiProvider: 'deepseek',
    providerName: 'DeepSeek',
    apiKeyDisplay: '',
    currentModel: '',
    currentModelName: '',
  },

  onShow() {
    this.loadStats();
    this.loadSettings();
  },

  loadStats() {
    const app = getApp();
    const cards = app.getWorkspaceCards();
    const wsCardIds = new Set(cards.map(c => c.id));
    const wsChats = app.globalData.aiChats.filter(c => wsCardIds.has(c.cardId));
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weeklyNew = cards.filter(c => {
      const d = new Date(c.createdAt.replace(/-/g, '/'));
      return d >= weekAgo;
    }).length;

    this.setData({
      stats: {
        totalCards: cards.length,
        weeklyNew,
        favorites: cards.filter(c => c.isFavorite).length,
        aiChats: wsChats.length,
        tempCards: cards.filter(c => c.isTemp).length,
      },
    });
  },

  loadSettings() {
    const app = getApp();
    const { getProvider, getModel } = require('../../utils/deepseek');
    const provider = getProvider();
    const model = getModel();
    const providerConfig = PROVIDERS[provider] || PROVIDERS.deepseek;

    // API key display
    var apiKey = '';
    if (provider === 'mimo') {
      apiKey = app.getSetting('mimoApiKey', '');
    } else {
      apiKey = app.getSetting('deepseekApiKey', '');
    }
    const masked = apiKey ? apiKey.substring(0, 6) + '***' + apiKey.slice(-4) : '';

    this.setData({
      aiAutoRecommend: app.getSetting('aiAutoRecommend', true),
      agentSensitivity: app.getSetting('agentSensitivity', '中'),
      walkSensitivity: app.getSetting('walkSensitivity', '高'),
      aiTone: app.getSetting('aiTone', '创意'),
      aiDirection: app.getSetting('aiDirection', '发散'),
      aiProvider: provider,
      providerName: providerConfig.name,
      apiKeyDisplay: masked,
      currentModel: model,
      currentModelName: (providerConfig.models[model] || model),
    });
  },

  // ── AI Provider ──

  onSetProvider() {
    const labels = Object.keys(PROVIDERS);
    wx.showActionSheet({
      itemList: labels.map(l => PROVIDERS[l].name),
      success: (res) => {
        const provider = labels[res.tapIndex];
        getApp().saveSetting('aiProvider', provider);
        this.loadSettings();
      },
    });
  },

  onSetApiKey() {
    const provider = this.data.aiProvider;
    const keySetting = provider === 'mimo' ? 'mimoApiKey' : 'deepseekApiKey';
    const current = getApp().getSetting(keySetting, '');
    const masked = current ? current.substring(0, 6) + '***' + current.slice(-4) : '';
    this.setData({ showApiKeyModal: true, apiKeyInput: current, apiKeyDisplay: masked });
  },

  onCloseApiKeyModal() {
    this.setData({ showApiKeyModal: false });
  },

  onApiKeyInput(e) {
    this.setData({ apiKeyInput: e.detail.value });
  },

  onConfirmApiKey() {
    const key = (this.data.apiKeyInput || '').trim();
    const provider = this.data.aiProvider;
    const keySetting = provider === 'mimo' ? 'mimoApiKey' : 'deepseekApiKey';
    getApp().saveSetting(keySetting, key);
    const masked = key ? key.substring(0, 6) + '***' + key.slice(-4) : '';
    this.setData({
      apiKeyDisplay: masked,
      showApiKeyModal: false,
    });
    wx.showToast({ title: key ? '已保存' : '已清除', icon: 'success' });
  },

  onSetModel() {
    const provider = this.data.aiProvider;
    const providerConfig = PROVIDERS[provider] || PROVIDERS.deepseek;
    const models = Object.keys(providerConfig.models);
    wx.showActionSheet({
      itemList: models.map(m => providerConfig.models[m]),
      success: (res) => {
        const model = models[res.tapIndex];
        if (provider === 'mimo') {
          getApp().saveSetting('mimoModel', model);
        } else {
          getApp().saveSetting('deepseekModel', model);
        }
        this.loadSettings();
      },
    });
  },

  onSetMimoBaseUrl() {
    const current = getApp().getSetting('mimoBaseUrl', 'https://token-plan-cn.xiaomimimo.com/v1');
    wx.showModal({
      title: 'MiMo API 地址',
      editable: true,
      placeholderText: '输入 MiMo API Base URL',
      content: current,
      success: (res) => {
        if (res.confirm && res.content) {
          getApp().saveSetting('mimoBaseUrl', res.content.trim());
          wx.showToast({ title: '已保存', icon: 'success' });
        }
      },
    });
  },

  // ── Data Management ──

  onBackup() {
    const app = getApp();
    const wsCards = app.getWorkspaceCards();
    const wsCardIds = new Set(wsCards.map(c => c.id));
    const wsChats = app.globalData.aiChats.filter(c => wsCardIds.has(c.cardId));
    const data = {
      workspace: app.getCurrentWorkspace().name,
      cards: wsCards,
      aiChats: wsChats,
      exportedAt: new Date().toISOString(),
    };
    const json = JSON.stringify(data);
    wx.setStorageSync('inspiration_backup', json);
    wx.setClipboardData({
      data: json,
      success: function () {
        wx.showToast({ title: '已复制到剪贴板', icon: 'success' });
      },
    });
  },

  onClearData() { this.setData({ showClearConfirm: true }); },
  onHideClear() { this.setData({ showClearConfirm: false }); },

  onStopPropagation() {},

  onConfirmClear() {
    const app = getApp();
    const wsId = app.globalData.currentWorkspaceId;
    const wsCardIds = new Set(app.getWorkspaceCards().map(c => c.id));
    const deletedCardIds = [...wsCardIds];
    const deletedChatIds = app.globalData.aiChats.filter(c => wsCardIds.has(c.cardId)).map(c => c.id);

    app.globalData.cards = app.globalData.cards.filter(c => c.workspaceId !== wsId);
    app.globalData.aiChats = app.globalData.aiChats.filter(c => !wsCardIds.has(c.cardId));
    wx.setStorageSync('inspiration_cards', app.globalData.cards);
    wx.setStorageSync('ai_chats', app.globalData.aiChats);

    // Cloud cascade delete
    if (app._cloudStorage) {
      app._cloudStorage.deleteCards(deletedCardIds);
      app._cloudStorage.deleteChats(deletedChatIds);
    }

    this.setData({ showClearConfirm: false });
    this.loadStats();
    wx.showToast({ title: '当前空间数据已清空', icon: 'success' });
  },

  onAiChatRecords() {
    wx.navigateTo({ url: '/pages/ai-records/ai-records' });
  },

  // ── Settings ──

  onAgentSettings() {
    const labels = ['高', '中', '低'];
    wx.showActionSheet({
      itemList: labels.map(l => l + '灵敏度'),
      success: (res) => {
        getApp().saveSetting('agentSensitivity', labels[res.tapIndex]);
        this.setData({ agentSensitivity: labels[res.tapIndex] });
      },
    });
  },

  onDefaultColor() {
    const { CARD_COLORS } = require('../../utils/mock-data');
    wx.showActionSheet({
      itemList: CARD_COLORS.map((_, i) => '配色' + (i + 1)),
      success: (res) => {
        getApp().saveSetting('defaultColor', CARD_COLORS[res.tapIndex]);
        wx.showToast({ title: '已更新', icon: 'success' });
      },
    });
  },

  onWalkSettings() {
    const labels = ['高', '中', '低'];
    wx.showActionSheet({
      itemList: labels.map(l => l + '灵敏度'),
      success: (res) => {
        getApp().saveSetting('walkSensitivity', labels[res.tapIndex]);
        this.setData({ walkSensitivity: labels[res.tapIndex] });
      },
    });
  },

  onAiTone() {
    const labels = ['严谨', '活泼', '创意'];
    wx.showActionSheet({
      itemList: labels,
      success: (res) => {
        getApp().saveSetting('aiTone', labels[res.tapIndex]);
        this.setData({ aiTone: labels[res.tapIndex] });
      },
    });
  },

  onAiDirection() {
    const labels = ['发散', '聚焦', '落地'];
    wx.showActionSheet({
      itemList: labels,
      success: (res) => {
        getApp().saveSetting('aiDirection', labels[res.tapIndex]);
        this.setData({ aiDirection: labels[res.tapIndex] });
      },
    });
  },

  onAiAutoRecommend() {
    const newVal = !this.data.aiAutoRecommend;
    getApp().saveSetting('aiAutoRecommend', newVal);
    this.setData({ aiAutoRecommend: newVal });
  },

  onHelp() {
    wx.showModal({
      title: '操作说明',
      content: '1. 点击右下角"+"按钮进行极速闪记\n2. 点击卡片查看详情\n3. 在卡片详情页可进行AI对话、关联卡片\n4. 通过思维链路查看灵感关联\n5. 使用灵感漫游随机回顾灵感\n6. 摇晃手机也可触发灵感漫游',
      showCancel: false,
      confirmText: '知道了',
    });
  },
});

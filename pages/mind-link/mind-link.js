// pages/mind-link/mind-link.js
const { generateThoughtFlow, requireApiKey } = require('../../utils/deepseek');

Page({
  data: {
    cardId: '',
    centerCard: {},
    relatedNodes: [],
    aiNodes: [],
    showCardPicker: false,
    showSaveDialog: false,
    templateName: '',
    thoughtFlow: '',
    generatingFlow: false,
  },

  onLoad(options) {
    const id = options.id;
    if (id) {
      this.setData({ cardId: id });
      this.loadLinkData(id);
    }
  },

  loadLinkData(id) {
    const app = getApp();
    const card = app.getCardById(id);
    if (!card) return;

    const relatedNodes = (card.relatedIds || [])
      .map(rid => app.getCardById(rid)).filter(Boolean);

    // #2: Use globalData
    const aiNodes = app.globalData.aiChats.filter(c => c.cardId === id);

    this.setData({ centerCard: card, relatedNodes, aiNodes });
  },

  onNodeTap(e) {
    wx.redirectTo({ url: `/pages/card-detail/card-detail?id=${e.currentTarget.dataset.id}` });
  },

  onAiNodeTap() {
    wx.navigateTo({ url: `/pages/ai-chat/ai-chat?cardId=${this.data.cardId}` });
  },

  // #10: Add card via picker
  onAddCard() {
    const { cardId, centerCard } = this.data;
    this.setData({
      showCardPicker: true,
      pickerExclude: [cardId, ...(centerCard.relatedIds || [])],
    });
  },

  onCardPickerSelect(e) {
    const relateId = e.detail.id;
    const app = getApp();
    const { centerCard } = this.data;

    app.updateCard(centerCard.id, { relatedIds: [...(centerCard.relatedIds || []), relateId] });
    const target = app.getCardById(relateId);
    if (target && !(target.relatedIds || []).includes(centerCard.id)) {
      app.updateCard(relateId, { relatedIds: [...(target.relatedIds || []), centerCard.id] });
    }

    this.setData({ showCardPicker: false });
    wx.showToast({ title: '已关联', icon: 'success' });
    this.loadLinkData(centerCard.id);
  },

  onCardPickerClose() {
    this.setData({ showCardPicker: false });
  },

  onAddAiNode() {
    wx.navigateTo({ url: `/pages/ai-chat/ai-chat?cardId=${this.data.cardId}` });
  },

  // #11: Save template with name input
  onSaveTemplate() {
    this.setData({ showSaveDialog: true, templateName: '' });
  },

  onTemplateNameInput(e) {
    this.setData({ templateName: e.detail.value });
  },

  onConfirmSaveTemplate() {
    const name = this.data.templateName.trim() || '未命名模板';
    const app = getApp();
    const templates = app.getSetting('mindTemplates', []);
    app.saveSetting('mindTemplates', [...templates, {
      id: 'tpl_' + Date.now(),
      name,
      cardId: this.data.cardId,
      createdAt: new Date().toLocaleString(),
    }]);
    this.setData({ showSaveDialog: false });
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  onCancelSaveTemplate() {
    this.setData({ showSaveDialog: false });
  },

  onGenerateFlow() {
    if (this.data.generatingFlow) return;
    if (!requireApiKey()) return;

    var app = getApp();
    var cards = app.getWorkspaceCards();
    if (cards.length < 2) {
      wx.showToast({ title: '至少需要2张卡片', icon: 'none' });
      return;
    }

    this.setData({ generatingFlow: true, thoughtFlow: '' });
    var self = this;
    generateThoughtFlow(cards).then(function (text) {
      self.setData({ thoughtFlow: text, generatingFlow: false });
    }).catch(function (err) {
      self.setData({ generatingFlow: false });
      wx.showToast({ title: err.message || '生成失败', icon: 'none' });
    });
  },

  onStopPropagation() {},
  onNodeLongPress(e) {
    const id = e.currentTarget.dataset.id;
    const { centerCard } = this.data;
    wx.showActionSheet({
      itemList: ['删除关联'],
      success: (res) => {
        if (res.tapIndex === 0) {
          const app = getApp();
          // Remove bidirectional
          const newRelated = (centerCard.relatedIds || []).filter(rid => rid !== id);
          app.updateCard(centerCard.id, { relatedIds: newRelated });
          const target = app.getCardById(id);
          if (target) {
            app.updateCard(id, { relatedIds: (target.relatedIds || []).filter(rid => rid !== centerCard.id) });
          }
          wx.showToast({ title: '已删除关联', icon: 'success' });
          this.loadLinkData(centerCard.id);
        }
      },
    });
  },
});

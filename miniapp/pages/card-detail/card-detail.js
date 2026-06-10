// pages/card-detail/card-detail.js
var api = require('../../utils/api');
var helpers = require('../../utils/helpers');
Page({
  data: {
    card: {},
    showDeleteConfirm: false,
    cardId: '',
    deletePreview: null,
    deletePreviewLoading: false,
  },

  onLoad(options) {
    this.setData({ cardId: options.id });
    this.loadCard(options.id);
  },

  onShow() {
    if (this.data.cardId) this.loadCard(this.data.cardId);
  },

  loadCard(id) {
    const app = getApp();
    const card = app.getCardById(id);
    if (!card) {
      this.setData({ card: { keywords: [] } });
      wx.showToast({ title: '卡片不存在', icon: 'none' });
      setTimeout(function () { wx.navigateBack(); }, 1000);
      return;
    }
    this.setData({ card: card });
  },

  onToggleFav() {
    const { card } = this.data;
    const newFav = !card.isFavorite;
    getApp().updateCard(card.id, { isFavorite: newFav });
    this.loadCard(card.id);
    wx.showToast({ title: newFav ? '收藏成功' : '取消收藏', icon: 'success' });
  },

  onEdit() {
    wx.navigateTo({ url: `/pages/card-edit/card-edit?id=${this.data.cardId}` });
  },

  onAiChat() {
    wx.navigateTo({ url: `/pages/ai-chat/ai-chat?cardId=${this.data.cardId}` });
  },

  onAiBadgeTap() {
    wx.navigateTo({ url: `/pages/ai-chat/ai-chat?cardId=${this.data.cardId}` });
  },

  onDelete() {
    this.setData({ showDeleteConfirm: true, deletePreviewLoading: true });
    var self = this;
    if (helpers.isUuid(this.data.cardId)) {
      api.cardsApi.deletePreview(this.data.cardId)
        .then(function (preview) { self.setData({ deletePreview: preview, deletePreviewLoading: false }); })
        .catch(function () { self.setData({ deletePreviewLoading: false }); });
    } else {
      this.setData({ deletePreviewLoading: false });
    }
  },

  onHideDelete() { this.setData({ showDeleteConfirm: false }); },

  onStopPropagation() {},

  onConfirmDelete() {
    getApp().deleteCard(this.data.cardId);
    wx.navigateBack();
  },
});

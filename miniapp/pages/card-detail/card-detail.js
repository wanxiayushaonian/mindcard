// pages/card-detail/card-detail.js
const api = require('../../utils/api');
const helpers = require('../../utils/helpers');

Page({
  data: {
    card: {},
    showDeleteConfirm: false,
    cardId: '',
    deletePreview: null,
    deletePreviewLoading: false,
    relatedCards: [],
    loadingRelations: true,   // M5: start true to prevent empty-state flash before load
    showCardPicker: false,
    excludeIds: [],
    canEditRelations: false,
  },

  onLoad(options) {
    this.setData({ cardId: options.id });
    this.loadCard(options.id);
  },

  onShow() {
    if (this.data.cardId) {
      this.loadCard(this.data.cardId);
      this.loadRelations();
    }
  },

  loadCard(id) {
    const app = getApp();
    const card = app.getCardById(id);
    if (!card) {
      this.setData({ card: { keywords: [] } });
      wx.showToast({ title: '卡片不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1000);
      return;
    }
    this.setData({ card });
    // Can edit relations only if card has a server UUID
    this.setData({ canEditRelations: helpers.isUuid(id) });
  },

  async loadRelations() {
    const { cardId } = this.data;
    if (!helpers.isUuid(cardId)) {
      // For local cards, show relatedIds from card data
      this._loadLocalRelations();
      return;
    }
    this.setData({ loadingRelations: true });
    try {
      const app = getApp();
      const relations = await app.loadCardRelations(cardId);
      const relatedIds = Array.isArray(relations)
        ? relations.map((r) => r.related_card_id || r.id)
        : [];
      const relatedCards = relatedIds
        .map((rid) => app.getCardById(rid))
        .filter(Boolean);
      this.setData({ relatedCards, loadingRelations: false });
    } catch (e) {
      this.setData({ loadingRelations: false });
    }
  },

  _loadLocalRelations() {
    const app = getApp();
    const card = app.getCardById(this.data.cardId);
    if (card && card.relatedIds && card.relatedIds.length > 0) {
      const relatedCards = card.relatedIds
        .map((rid) => app.getCardById(rid))
        .filter(Boolean);
      this.setData({ relatedCards, loadingRelations: false });
    } else {
      this.setData({ relatedCards: [], loadingRelations: false });
    }
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

  onAddRelation() {
    const app = getApp();
    const cards = app.getWorkspaceCards();
    const excludeIds = [this.data.cardId, ...this.data.relatedCards.map((c) => c.id)];
    this.setData({ showCardPicker: true, excludeIds });
  },

  async onRelationPickerSelect(e) {
    const relatedId = e.detail.id;
    const { cardId } = this.data;
    this.setData({ showCardPicker: false });
    try {
      await getApp().addCardRelation(cardId, relatedId, 'related');
      wx.showToast({ title: '关联成功', icon: 'success' });
      this.loadRelations();
    } catch (err) {
      wx.showToast({ title: '关联失败', icon: 'none' });
    }
  },

  onRelationPickerClose() {
    this.setData({ showCardPicker: false });
  },

  onRelationTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/card-detail/card-detail?id=${id}` });
  },

  async onRemoveRelation(e) {
    const relatedId = e.currentTarget.dataset.id;
    const { cardId } = this.data;
    try {
      await getApp().removeCardRelation(cardId, relatedId);
      wx.showToast({ title: '已取消关联', icon: 'success' });
      this.loadRelations();
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  onDelete() {
    this.setData({ showDeleteConfirm: true, deletePreviewLoading: true });
    if (helpers.isUuid(this.data.cardId)) {
      api.cardsApi.deletePreview(this.data.cardId)
        .then((preview) => this.setData({ deletePreview: preview, deletePreviewLoading: false }))
        .catch(() => this.setData({ deletePreviewLoading: false }));
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

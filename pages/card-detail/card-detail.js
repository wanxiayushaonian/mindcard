// pages/card-detail/card-detail.js
Page({
  data: {
    card: {},
    relatedCards: [],
    recommendCards: [],
    showMoreMenu: false,
    showDeleteConfirm: false,
    showCardPicker: false,
    cardId: '',
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
      this.setData({ card: { keywords: [], relatedIds: [] }, relatedCards: [], recommendCards: [] });
      wx.showToast({ title: '卡片不存在', icon: 'none' });
      setTimeout(function () { wx.navigateBack(); }, 1000);
      return;
    }
    const relatedCards = (card.relatedIds || [])
      .map(rid => app.getCardById(rid)).filter(Boolean);
    const recommendCards = (card.agentRecommendIds || [])
      .map((rid) => {
        const c = app.getCardById(rid);
        if (!c) return null;
        var rawScore = (card.agentScores || {})[rid] || 0;
        var matchScore = Math.round(rawScore * 100);
        if (matchScore < 10) matchScore = 10 + Math.floor(Math.random() * 20);
        return { ...c, matchScore };
      })
      .filter(Boolean)
      .filter(rc => !(card.relatedIds || []).includes(rc.id));

    this.setData({ card, relatedCards, recommendCards });
  },

  // #1: Fix inverted toast
  onToggleFav() {
    const { card } = this.data;
    const newFav = !card.isFavorite;
    getApp().updateCard(card.id, { isFavorite: newFav });
    this.loadCard(card.id);
    wx.showToast({ title: newFav ? '收藏成功' : '取消收藏', icon: 'success' });
  },

  onShowMore() { this.setData({ showMoreMenu: true }); },
  onHideMore() { this.setData({ showMoreMenu: false }); },

  onEdit() {
    wx.navigateTo({ url: `/pages/card-edit/card-edit?id=${this.data.cardId}` });
  },

  onAiChat() {
    wx.navigateTo({ url: `/pages/ai-chat/ai-chat?cardId=${this.data.cardId}` });
  },

  // #9: Open card picker
  onRelate() {
    const { card } = this.data;
    this.setData({
      showCardPicker: true,
      pickerExclude: [card.id, ...(card.relatedIds || [])],
    });
  },

  onMindLink() {
    wx.navigateTo({ url: `/pages/mind-link/mind-link?id=${this.data.cardId}` });
  },

  onNetwork() {
    wx.navigateTo({ url: `/pages/network/network?highlight=${this.data.cardId}` });
  },

  onRelatedCardTap(e) {
    wx.redirectTo({ url: `/pages/card-detail/card-detail?id=${e.currentTarget.dataset.id}` });
  },

  // #9: Add relate via picker
  onAddRelate() {
    const { card } = this.data;
    this.setData({
      showCardPicker: true,
      pickerExclude: [card.id, ...(card.relatedIds || [])],
    });
  },

  onCardPickerSelect(e) {
    const relateId = e.detail.id;
    this._relateCards(relateId);
    this.setData({ showCardPicker: false });
  },

  onCardPickerClose() {
    this.setData({ showCardPicker: false });
  },

  onQuickRelate(e) {
    this._relateCards(e.currentTarget.dataset.id);
  },

  _relateCards(relateId) {
    const app = getApp();
    const { card } = this.data;
    if ((card.relatedIds || []).includes(relateId)) return;

    app.updateCard(card.id, { relatedIds: [...(card.relatedIds || []), relateId] });
    const target = app.getCardById(relateId);
    if (target && !(target.relatedIds || []).includes(card.id)) {
      app.updateCard(relateId, { relatedIds: [...(target.relatedIds || []), card.id] });
    }
    // Clean from recommendations
    const newRecIds = (card.agentRecommendIds || []).filter(id => id !== relateId);
    if (newRecIds.length !== card.agentRecommendIds.length) {
      app.updateCard(card.id, { agentRecommendIds: newRecIds });
    }
    wx.showToast({ title: '关联成功', icon: 'success' });
    this.loadCard(card.id);
  },

  // #24: AI badge clickable
  onAiBadgeTap() {
    wx.navigateTo({ url: `/pages/ai-chat/ai-chat?cardId=${this.data.cardId}` });
  },

  onArchive() {
    getApp().updateCard(this.data.cardId, { isTemp: false });
    this.setData({ showMoreMenu: false });
    wx.showToast({ title: '已归档', icon: 'success' });
    this.loadCard(this.data.cardId);
  },

  // #13: Share
  onShare() {
    this.setData({ showMoreMenu: false });
    wx.showShareMenu({ withShareTicket: true });
  },

  onDelete() {
    this.setData({ showMoreMenu: false, showDeleteConfirm: true });
  },

  onHideDelete() { this.setData({ showDeleteConfirm: false }); },

  onStopPropagation() {},

  onConfirmDelete() {
    getApp().deleteCard(this.data.cardId);
    wx.navigateBack();
  },
});

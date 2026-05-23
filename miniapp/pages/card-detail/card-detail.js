// pages/card-detail/card-detail.js
var api = require('../../utils/api');
Page({
  data: {
    card: {},
    relatedCards: [],
    recommendCards: [],
    showMoreMenu: false,
    showDeleteConfirm: false,
    showCardPicker: false,
    cardId: '',
    // Comments
    comments: [],
    commentText: '',
    commentsLoading: false,
  },

  onLoad(options) {
    this.setData({ cardId: options.id });
    this.loadCard(options.id);
  },

  onShow() {
    if (this.data.cardId) this.loadCard(this.data.cardId);
  },

  _isUuid(id) {
    return id && id.indexOf('card_') !== 0;
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

    this.setData({ card: card, relatedCards: [], recommendCards: [] });

    // Only fetch related cards from API if we have a server UUID
    var self = this;
    if (this._isUuid(id)) {
      api.get('/api/cards/' + id + '/relations')
        .then(function (related) {
          var relatedCards = (related || []).map(function (c) {
            return {
              id: c.id,
              title: c.title,
              content: c.content,
              keywords: c.keywords || [],
              color: c.color || '#B8D4E3',
            };
          });
          self.setData({ relatedCards: relatedCards });
        })
        .catch(function () {
          // Fallback: use local relatedIds
          var localRelated = (card.relatedIds || [])
            .map(function (rid) { return app.getCardById(rid); })
            .filter(Boolean);
          self.setData({ relatedCards: localRelated });
        });
    } else {
      // Local ID: use local relatedIds only
      var localRelated = (card.relatedIds || [])
        .map(function (rid) { return app.getCardById(rid); })
        .filter(Boolean);
      self.setData({ relatedCards: localRelated });
    }

    // Load recommendations from local cache
    var recommendCards = (card.agentRecommendIds || [])
      .map(function (rid) {
        var c = app.getCardById(rid);
        if (!c) return null;
        var rawScore = (card.agentScores || {})[rid] || 0;
        var matchScore = Math.round(rawScore * 100);
        if (matchScore < 10) matchScore = 10 + Math.floor(Math.random() * 20);
        return Object.assign({}, c, { matchScore: matchScore });
      })
      .filter(Boolean);
    this.setData({ recommendCards: recommendCards });
    this.loadComments(id);
  },

  async loadComments(cardId) {
    if (!this._isUuid(cardId)) {
      this.setData({ comments: [], commentsLoading: false });
      return;
    }
    this.setData({ commentsLoading: true });
    try {
      const app = getApp();
      const comments = await app.loadComments(cardId);
      this.setData({ comments: comments || [], commentsLoading: false });
    } catch (e) {
      this.setData({ comments: [], commentsLoading: false });
      wx.showToast({ title: e.message || '加载评论失败', icon: 'none' });
    }
  },

  onCommentInput(e) {
    this.setData({ commentText: e.detail.value });
  },

  async onAddComment() {
    const content = this.data.commentText.trim();
    if (!content) return;

    try {
      const app = getApp();
      const success = await app.addComment(this.data.cardId, content);
      if (success) {
        this.setData({ commentText: '' });
        this.setData({ comments: app.globalData.comments });
        wx.showToast({ title: '已评论', icon: 'success' });
      } else {
        wx.showToast({ title: '评论失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: e.message || '评论失败', icon: 'none' });
    }
  },

  onDeleteComment(e) {
    const commentId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除评论',
      content: '确定删除这条评论？',
      success: async (res) => {
        if (res.confirm) {
          try {
            const app = getApp();
            const success = await app.deleteComment(commentId, this.data.cardId);
            if (success) {
              this.setData({ comments: app.globalData.comments });
              wx.showToast({ title: '已删除', icon: 'success' });
            } else {
              wx.showToast({ title: '删除失败', icon: 'none' });
            }
          } catch (e) {
            wx.showToast({ title: e.message || '删除失败', icon: 'none' });
          }
        }
      },
    });
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

    // Update local cache first
    app.updateCard(card.id, { relatedIds: [].concat(card.relatedIds || [], [relateId]) });
    this.loadCard(card.id);

    // Sync to API only if we have a server UUID
    if (!this._isUuid(card.id)) {
      wx.showToast({ title: '关联成功', icon: 'success' });
      return;
    }
    api.post('/api/cards/' + card.id + '/relations', {
      related_card_id: relateId,
      relation_type: 'manual',
    }).then(function () {
      wx.showToast({ title: '关联成功', icon: 'success' });
    }.bind(this)).catch(function () {
      wx.showToast({ title: '关联失败', icon: 'none' });
    });
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

// pages/search/search.js
Page({
  data: { query: '', results: [], chatResults: [], searched: false },

  onInput(e) {
    this.setData({ query: e.detail.value });
    if (e.detail.value.trim()) {
      this.doSearch(e.detail.value.trim());
    } else {
      this.setData({ results: [], chatResults: [], searched: false });
    }
  },

  doSearch(query) {
    const app = getApp();
    const q = query.toLowerCase();
    const wsCards = app.getWorkspaceCards();
    const wsCardIds = new Set(wsCards.map(c => c.id));
    const results = wsCards.filter(c =>
      (c.content || '').toLowerCase().includes(q) ||
      (c.title || '').toLowerCase().includes(q) ||
      (c.keywords || []).some(function (k) { return k.toLowerCase().includes(q); })
    );
    const chatResults = app.globalData.aiChats.filter(c =>
      wsCardIds.has(c.cardId) && (
        (c.title || '').toLowerCase().includes(q) ||
        c.messages.some(m => (m.content || '').toLowerCase().includes(q))
      )
    );
    this.setData({ results, chatResults, searched: true });
  },

  onResultTap(e) {
    wx.navigateTo({ url: '/pages/card-detail/card-detail?id=' + e.currentTarget.dataset.id });
  },
  onChatResultTap(e) {
    wx.navigateTo({ url: '/pages/ai-chat/ai-chat?cardId=' + e.currentTarget.dataset.cardId });
  },
  onCancel() { wx.navigateBack(); },
});

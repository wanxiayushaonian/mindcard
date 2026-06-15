// pages/search/search.js
const api = require('../../utils/api');

Page({
  data: {
    query: '',
    results: [],
    searched: false,
    loading: false,
    mode: 'hybrid',
    modes: [
      { key: 'hybrid', label: '混合搜索' },
      { key: 'semantic', label: '语义搜索' },
      { key: 'fulltext', label: '全文搜索' },
    ],
  },

  _debounceTimer: null,

  onInput(e) {
    const query = e.detail.value;
    this.setData({ query });

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    if (query.trim()) {
      this._debounceTimer = setTimeout(() => {
        this.doSearch();
      }, 400);
    } else {
      this.setData({ results: [], searched: false });
    }
  },

  onModeTap(e) {
    this.setData({ mode: e.currentTarget.dataset.mode });
    if (this.data.query.trim()) {
      this.doSearch();
    }
  },

  async doSearch() {
    const query = this.data.query.trim();
    if (!query) return;

    const app = getApp();
    const workspaceId = app.globalData.currentWorkspaceId;
    if (!workspaceId) {
      wx.showToast({ title: '请先选择空间', icon: 'none' });
      return;
    }

    this.setData({ loading: true });

    try {
      const res = await api.searchApi.search(query, workspaceId, this.data.mode);
      const results = (res.results || []).map((r) => ({
        id: r.card.id,
        title: r.card.title,
        content: r.card.content,
        keywords: r.card.keywords || [],
        color: r.card.color || '#B8D4E3',
        score: r.score,
        scorePercent: Math.round((r.score || 0) * 100),
        createdAt: r.card.created_at,
      }));
      this.setData({ results, searched: true, loading: false });
    } catch (err) {
      wx.showToast({ title: err.message || '搜索失败，已切换本地搜索', icon: 'none' });
      this._localSearch(query);
      this.setData({ loading: false });
    }
  },

  _localSearch(query) {
    const app = getApp();
    const q = query.toLowerCase();
    const wsCards = app.getWorkspaceCards();
    const results = wsCards.filter((c) =>
      (c.content || '').toLowerCase().indexOf(q) >= 0 ||
      (c.title || '').toLowerCase().indexOf(q) >= 0 ||
      (c.keywords || []).some((k) => k.toLowerCase().indexOf(q) >= 0)
    ).map((c) => ({
      id: c.id,
      title: c.title,
      content: c.content,
      keywords: c.keywords || [],
      color: c.color || '#B8D4E3',
      score: 0,
      createdAt: c.createdAt,
    }));
    this.setData({ results, searched: true });
  },

  onResultTap(e) {
    wx.navigateTo({ url: `/pages/card-detail/card-detail?id=${e.currentTarget.dataset.id}` });
  },

  // L5: clear pending debounce timer on unload to avoid setData on dead page
  onUnload() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
  },

  onCancel() {
    wx.navigateBack();
  },
});

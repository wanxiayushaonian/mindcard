// pages/search/search.js
var api = require('../../utils/api');

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
    var query = e.detail.value;
    this.setData({ query: query });

    // Debounce auto-search
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    var self = this;
    if (query.trim()) {
      this._debounceTimer = setTimeout(function () {
        self.doSearch();
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

  doSearch() {
    var query = this.data.query.trim();
    if (!query) return;

    var app = getApp();
    var workspaceId = app.globalData.currentWorkspaceId;
    if (!workspaceId) {
      wx.showToast({ title: '请先选择空间', icon: 'none' });
      return;
    }

    this.setData({ loading: true });

    api.searchApi.search(query, workspaceId, this.data.mode)
      .then(function (res) {
        var results = (res.results || []).map(function (r) {
          return {
            id: r.card.id,
            title: r.card.title,
            content: r.card.content,
            keywords: r.card.keywords || [],
            color: r.card.color || '#B8D4E3',
            score: r.score,
            scorePercent: Math.round((r.score || 0) * 100),
            createdAt: r.card.created_at,
          };
        });
        this.setData({ results: results, searched: true, loading: false });
      }.bind(this))
      .catch(function (err) {
        // Fallback to local search
        wx.showToast({ title: err.message || '搜索失败，已切换本地搜索', icon: 'none' });
        this._localSearch(query);
        this.setData({ loading: false });
      }.bind(this));
  },

  _localSearch(query) {
    var app = getApp();
    var q = query.toLowerCase();
    var wsCards = app.getWorkspaceCards();
    var results = wsCards.filter(function (c) {
      return (c.content || '').toLowerCase().indexOf(q) >= 0 ||
        (c.title || '').toLowerCase().indexOf(q) >= 0 ||
        (c.keywords || []).some(function (k) { return k.toLowerCase().indexOf(q) >= 0; });
    }).map(function (c) {
      return {
        id: c.id,
        title: c.title,
        content: c.content,
        keywords: c.keywords || [],
        color: c.color || '#B8D4E3',
        score: 0,
        createdAt: c.createdAt,
      };
    });
    this.setData({ results: results, searched: true });
  },

  onResultTap(e) {
    wx.navigateTo({ url: '/pages/card-detail/card-detail?id=' + e.currentTarget.dataset.id });
  },

  onCancel() {
    wx.navigateBack();
  },
});

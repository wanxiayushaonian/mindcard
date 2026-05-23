// pages/insights/insights.js
var api = require('../../utils/api');

Page({
  data: {
    loading: false,
    loaded: false,
    themes: [],
    trends: '',
    unexplored: [],
    suggestions: [],
  },

  onLoad() {
    this.loadInsights();
  },

  loadInsights() {
    var app = getApp();
    var workspaceId = app.globalData.currentWorkspaceId;
    if (!workspaceId) {
      wx.showToast({ title: '请先选择空间', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    var self = this;

    api.post('/api/rag/insights', { workspace_id: workspaceId })
      .then(function (res) {
        self.setData({
          loading: false,
          loaded: true,
          themes: res.themes || [],
          trends: res.trends || '',
          unexplored: res.unexplored || [],
          suggestions: res.suggestions || [],
        });
      })
      .catch(function (err) {
        self.setData({ loading: false });
        wx.showToast({ title: err.message || '分析失败', icon: 'none' });
      });
  },

  onRefresh() {
    this.loadInsights();
  },
});

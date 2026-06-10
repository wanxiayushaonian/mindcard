// pages/profile/profile.js
var api = require('../../utils/api');

Page({
  data: {
    stats: {
      totalCards: 0,
      weeklyNew: 0,
      favorites: 0,
      tempCards: 0,
    },
  },

  onShow() {
    this.loadStats();
  },

  loadStats() {
    const app = getApp();
    const cards = app.getWorkspaceCards();
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
        tempCards: cards.filter(c => c.isTemp).length,
      },
    });
  },

  onBackup() {
    const app = getApp();
    const wsCards = app.getWorkspaceCards();
    const data = {
      workspace: app.getCurrentWorkspace().name,
      cards: wsCards,
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

  onLogout() {
    wx.showModal({
      title: '确认退出',
      content: '退出后需要重新登录，本地数据不会丢失。',
      confirmText: '退出',
      confirmColor: '#e74c3c',
      success: (res) => {
        if (res.confirm) {
          api.clearToken();
          wx.removeStorageSync('user_identity');
          wx.redirectTo({ url: '/pages/login/login' });
        }
      },
    });
  },
});

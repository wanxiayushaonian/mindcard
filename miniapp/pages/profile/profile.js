// pages/profile/profile.js
const api = require('../../utils/api');
const { CARD_COLORS } = require('../../utils/mock-data');

Page({
  data: {
    user: { nickName: '' },
    stats: {
      totalWorkspaces: 0,
      totalCards: 0,
      currentWeeklyNew: 0,
      currentFavorites: 0,
      currentTempCards: 0,
      currentWorkspaceName: '',
    },
    loadingStats: true,
    // Settings
    walkSensitivity: '中',
    defaultColor: '#D4B5D0',
    autoExtract: true,
    colors: CARD_COLORS,
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    this._loadUser();
    this._loadSettings();
    this._loadStats();
  },

  _loadUser() {
    const user = getApp().getCurrentUser();
    this.setData({ user });
  },

  _loadSettings() {
    const app = getApp();
    this.setData({
      walkSensitivity: app.getSetting('walkSensitivity', '中'),
      defaultColor: app.getSetting('defaultColor', '#D4B5D0'),
      autoExtract: app.getSetting('autoExtract', true),
    });
  },

  async _loadStats() {
    this.setData({ loadingStats: true });
    try {
      const stats = await getApp().loadGlobalStats();
      this.setData({ stats, loadingStats: false });
    } catch (e) {
      this.setData({ loadingStats: false });
    }
  },

  // ── Settings handlers ──

  onSensitivityTap() {
    const opts = ['高', '中', '低'];
    const self = this;
    wx.showActionSheet({
      itemList: opts,
      success: (res) => {
        const val = opts[res.tapIndex];
        getApp().saveSetting('walkSensitivity', val);
        self.setData({ walkSensitivity: val });
      },
    });
  },

  onColorSelect(e) {
    const color = e.currentTarget.dataset.color;
    getApp().saveSetting('defaultColor', color);
    this.setData({ defaultColor: color });
  },

  onAutoExtractToggle() {
    const newVal = !this.data.autoExtract;
    getApp().saveSetting('autoExtract', newVal);
    this.setData({ autoExtract: newVal });
  },

  // ── Data management ──

  onExportCurrent() {
    const app = getApp();
    const ws = app.getCurrentWorkspace();
    const cards = app.getWorkspaceCards();
    const data = {
      workspace: ws ? ws.name : '',
      cards,
      exportedAt: new Date().toISOString(),
    };
    this._doExport(data, '当前空间');
  },

  onExportAll() {
    const app = getApp();
    const workspaces = app.globalData.workspaces;
    const allData = {
      workspaces: workspaces.map((ws) => ({
        name: ws.name,
        cards: ws.id === app.globalData.currentWorkspaceId
          ? app.getWorkspaceCards()
          : [],
      })),
      exportedAt: new Date().toISOString(),
    };
    const note = app.globalData.currentWorkspaceId
      ? '（仅当前空间卡片已加载，其他空间请单独导出）'
      : '';
    this._doExport(allData, `全部空间${note}`);
  },

  _doExport(data, label) {
    const json = JSON.stringify(data, null, 2);
    wx.setStorageSync('inspiration_backup', json);
    wx.setClipboardData({
      data: json,
      success: () => {
        wx.showToast({ title: `${label}数据已复制`, icon: 'success' });
      },
    });
  },

  // ── Account ──

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
          wx.reLaunch({ url: '/pages/login/login' });
        }
      },
    });
  },
});

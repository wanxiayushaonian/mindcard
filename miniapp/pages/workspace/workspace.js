// pages/workspace/workspace.js
var api = require('../../utils/api');

const WS_ICONS = ['lightbulb', 'palette', 'book-open', 'flask-conical', 'music', 'rocket', 'sprout', 'brain', 'sparkles', 'flame'];

const EMOJI_TO_ICON = {
  '💡': 'lightbulb', '📖': 'book-open', '🎨': 'palette', '🎵': 'music',
  '✈️': 'rocket', '💼': 'flask-conical', '📝': 'sprout', '🏠': 'brain',
  '🌱': 'sprout', '🎯': 'sparkles', '🔥': 'flame', '❤️': 'sparkles',
};

function normalizeIcon(icon) {
  if (!icon) return 'lightbulb';
  if (EMOJI_TO_ICON[icon]) return EMOJI_TO_ICON[icon];
  if (WS_ICONS.indexOf(icon) !== -1) return icon;
  return 'lightbulb';
}

const WS_COLORS = ['#94B4C8', '#B8D4E3', '#C4D7B2', '#E8C9A0', '#D4B5D0', '#D4C5A9', '#A0B8C8', '#B8A9D4'];

Page({
  data: {
    workspaces: [],
    sharedWorkspaces: [],
    gridItems: [],
    WS_ICONS,
    WS_COLORS,
    showCreateModal: false,
    showDeleteConfirm: false,
    wsName: '',
    wsIcon: 'lightbulb',
    wsColor: '#94B4C8',
    editingWorkspaceId: '',
    deletingWorkspaceId: '',
    // Share & Members
    showInviteModal: false,
    inviteCode: '',
    inviteWsName: '',
    showJoinModal: false,
    joinCodeInput: '',
  },

  onShow() {
    var self = this;
    getApp()._onDataReady(function () {
      self.loadWorkspaces();
    });
  },

  loadWorkspaces() {
    const app = getApp();
    const cards = app.globalData.cards;
    const workspaces = app.globalData.workspaces.map(ws => ({
      ...ws,
      icon: normalizeIcon(ws.icon),
      _cardCount: cards.filter(c => c.workspaceId === ws.id).length,
      _memberCount: (ws.members || []).length,
      _isOwner: ws.owner === app.globalData.currentUser.openId,
    }));
    const sharedWorkspaces = (app.globalData.sharedWorkspaces || []).map(ws => ({
      ...ws,
      icon: normalizeIcon(ws.icon),
      _cardCount: 0,
      _memberCount: (ws.members || []).length,
      _isShared: true,
    }));
    const gridItems = [
      ...workspaces,
      { id: '__add__', _type: 'add' },
      { id: '__join__', _type: 'join' },
    ];
    this.setData({ workspaces, sharedWorkspaces, gridItems });
    this._loadAllCardCounts();
  },

  async _loadAllCardCounts() {
    var app = getApp();
    var workspaces = app.globalData.workspaces;
    var self = this;
    var counts = {};

    function loadWsCards(wsId) {
      var allCards = [];
      var cursor = null;
      function loadPage() {
        return api.cardsApi.list(wsId, cursor, 50).then(function (resp) {
          var items = Array.isArray(resp) ? resp : (resp.items || []);
          allCards = allCards.concat(items);
          cursor = (resp && resp.next_cursor) || null;
          if (cursor) return loadPage();
          counts[wsId] = allCards.length;
        }).catch(function () { counts[wsId] = 0; });
      }
      return loadPage();
    }

    await Promise.all(workspaces.map(function (ws) {
      if (ws.id.indexOf('ws_') === 0) return Promise.resolve();
      return loadWsCards(ws.id);
    }));

    var updatedWorkspaces = self.data.workspaces.map(function (ws) {
      return Object.assign({}, ws, { _cardCount: counts[ws.id] || 0 });
    });
    var gridItems = updatedWorkspaces.concat([
      { id: '__add__', _type: 'add' },
      { id: '__join__', _type: 'join' },
    ]);
    self.setData({ workspaces: updatedWorkspaces, gridItems: gridItems });
  },

  onStopPropagation() {},

  // ── Navigation ──

  onGridItemTap(e) {
    const type = e.currentTarget.dataset.type;
    if (type === 'add') return this.onCreateWorkspace();
    if (type === 'join') return this.onShowJoinModal();
    this.onWorkspaceTap(e);
  },

  onGridItemLongPress(e) {
    const type = e.currentTarget.dataset.type;
    if (type) return; // ignore long press on action buttons
    this.onWorkspaceLongPress(e);
  },

  onWorkspaceTap(e) {
    const id = e.currentTarget.dataset.id;
    const app = getApp();
    app.switchWorkspace(id);
    wx.navigateTo({ url: '/pages/index/index' });
  },

  onWorkspaceLongPress(e) {
    const id = e.currentTarget.dataset.id;
    const app = getApp();
    const ws = app.globalData.workspaces.find(w => w.id === id);
    if (!ws) return;

    const options = ['编辑空间', '删除空间'];

    wx.showActionSheet({
      itemList: options,
      success: (res) => {
        const action = options[res.tapIndex];
        if (action === '编辑空间') {
          this.setData({
            showCreateModal: true,
            editingWorkspaceId: id,
            wsName: ws.name,
            wsIcon: normalizeIcon(ws.icon),
            wsColor: ws.color,
          });
        } else if (action === '删除空间') {
          this.setData({
            showDeleteConfirm: true,
            deletingWorkspaceId: id,
          });
        }
      },
    });
  },

  onProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  // ── Share & Join ──

  async onShareWorkspace(wsId) {
    const app = getApp();
    const ws = app.globalData.workspaces.find(w => w.id === wsId);
    if (!ws) return;

    wx.showLoading({ title: '生成邀请码...' });
    try {
      let code = ws.inviteCode;
      if (!code) {
        code = await app.generateInviteCode(wsId);
      }
      wx.hideLoading();

      if (code) {
        this.setData({
          showInviteModal: true,
          inviteCode: code,
          inviteWsName: ws.name,
        });
      } else {
        wx.showToast({ title: '生成失败', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '生成邀请码失败', icon: 'none' });
    }
  },

  onCopyInviteCode() {
    wx.setClipboardData({
      data: this.data.inviteCode,
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
    });
  },

  onCloseInviteModal() {
    this.setData({ showInviteModal: false });
  },

  onShowJoinModal() {
    this.setData({ showJoinModal: true, joinCodeInput: '' });
  },

  onCloseJoinModal() {
    this.setData({ showJoinModal: false });
  },

  onJoinCodeInput(e) {
    this.setData({ joinCodeInput: e.detail.value.toUpperCase() });
  },

  async onConfirmJoin() {
    const code = this.data.joinCodeInput.trim();
    if (code.length !== 6) {
      wx.showToast({ title: '请输入6位邀请码', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '加入中...' });
    try {
      const result = await getApp().joinWorkspace(code);
      wx.hideLoading();

      if (result) {
        this.setData({ showJoinModal: false });
        wx.showToast({ title: '已加入 ' + (result.workspaceName || '空间'), icon: 'success' });
        this.loadWorkspaces();
      } else {
        wx.showToast({ title: '邀请码无效', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '加入失败', icon: 'none' });
    }
  },

  // ── Create / Edit Modal ──

  onCreateWorkspace() {
    this.setData({
      showCreateModal: true,
      editingWorkspaceId: '',
      wsName: '',
      wsIcon: 'lightbulb',
      wsColor: '#94B4C8',
    });
  },

  onCloseCreateModal() {
    this.setData({ showCreateModal: false });
  },

  onNameInput(e) {
    this.setData({ wsName: e.detail.value });
  },

  onIconSelect(e) {
    this.setData({ wsIcon: e.currentTarget.dataset.icon });
  },

  onColorSelect(e) {
    this.setData({ wsColor: e.currentTarget.dataset.color });
  },

  async onConfirmCreate() {
    const { wsName, wsIcon, wsColor, editingWorkspaceId } = this.data;
    if (!wsName.trim()) {
      wx.showToast({ title: '请输入空间名称', icon: 'none' });
      return;
    }

    try {
      const app = getApp();
      if (editingWorkspaceId) {
        await app.updateWorkspace(editingWorkspaceId, {
          name: wsName.trim(),
          icon: wsIcon,
          color: wsColor,
        });
        wx.showToast({ title: '已更新', icon: 'success' });
      } else {
        await app.createWorkspace({
          name: wsName.trim(),
          icon: wsIcon,
          color: wsColor,
        });
        wx.showToast({ title: '创建成功', icon: 'success' });
      }

      this.setData({ showCreateModal: false });
      this.loadWorkspaces();
    } catch (e) {
      wx.showToast({ title: e.message || '操作失败', icon: 'none' });
    }
  },

  // ── Delete ──

  onHideDelete() {
    this.setData({ showDeleteConfirm: false });
  },

  async onConfirmDelete() {
    const { deletingWorkspaceId } = this.data;
    try {
      const app = getApp();
      await app.deleteWorkspace(deletingWorkspaceId);
      this.setData({ showDeleteConfirm: false });
      wx.showToast({ title: '已删除', icon: 'success' });
      this.loadWorkspaces();
    } catch (e) {
      wx.showToast({ title: e.message || '删除失败', icon: 'none' });
    }
  },
});

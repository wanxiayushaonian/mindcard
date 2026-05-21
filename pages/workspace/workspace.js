// pages/workspace/workspace.js

const WS_ICONS = ['💡', '📖', '🎨', '🎵', '✈️', '💼', '📝', '🏠', '🌱', '🎯', '🔥', '❤️'];
const WS_COLORS = ['#94B4C8', '#B8D4E3', '#C4D7B2', '#E8C9A0', '#D4B5D0', '#D4C5A9', '#A0B8C8', '#B8A9D4'];

Page({
  data: {
    workspaces: [],
    WS_ICONS,
    WS_COLORS,
    showCreateModal: false,
    showDeleteConfirm: false,
    wsName: '',
    wsIcon: '💡',
    wsColor: '#94B4C8',
    editingWorkspaceId: '',
    deletingWorkspaceId: '',
  },

  onShow() {
    this.loadWorkspaces();
  },

  loadWorkspaces() {
    const app = getApp();
    const cards = app.globalData.cards;
    const workspaces = app.globalData.workspaces.map(ws => ({
      ...ws,
      _cardCount: cards.filter(c => c.workspaceId === ws.id).length,
    }));
    this.setData({ workspaces });
  },

  onStopPropagation() {},

  // ── Navigation ──

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

    const options = ['编辑空间'];
    // Don't allow deleting the last workspace
    if (app.globalData.workspaces.length > 1) {
      options.push('删除空间');
    }

    wx.showActionSheet({
      itemList: options,
      success: (res) => {
        if (res.tapIndex === 0) {
          this.setData({
            showCreateModal: true,
            editingWorkspaceId: id,
            wsName: ws.name,
            wsIcon: ws.icon,
            wsColor: ws.color,
          });
        } else if (res.tapIndex === 1) {
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

  // ── Create / Edit Modal ──

  onCreateWorkspace() {
    this.setData({
      showCreateModal: true,
      editingWorkspaceId: '',
      wsName: '',
      wsIcon: '💡',
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

  onConfirmCreate() {
    const { wsName, wsIcon, wsColor, editingWorkspaceId } = this.data;
    if (!wsName.trim()) {
      wx.showToast({ title: '请输入空间名称', icon: 'none' });
      return;
    }

    const app = getApp();
    if (editingWorkspaceId) {
      app.updateWorkspace(editingWorkspaceId, {
        name: wsName.trim(),
        icon: wsIcon,
        color: wsColor,
      });
      wx.showToast({ title: '已更新', icon: 'success' });
    } else {
      app.createWorkspace({
        name: wsName.trim(),
        icon: wsIcon,
        color: wsColor,
      });
      wx.showToast({ title: '创建成功', icon: 'success' });
    }

    this.setData({ showCreateModal: false });
    this.loadWorkspaces();
  },

  // ── Delete ──

  onHideDelete() {
    this.setData({ showDeleteConfirm: false });
  },

  onConfirmDelete() {
    const { deletingWorkspaceId } = this.data;
    const app = getApp();
    app.deleteWorkspace(deletingWorkspaceId);
    this.setData({ showDeleteConfirm: false });
    wx.showToast({ title: '已删除', icon: 'success' });
    this.loadWorkspaces();
  },
});

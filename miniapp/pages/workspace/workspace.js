// pages/workspace/workspace.js

const WS_ICONS = ['💡', '📖', '🎨', '🎵', '✈️', '💼', '📝', '🏠', '🌱', '🎯', '🔥', '❤️'];
const WS_COLORS = ['#94B4C8', '#B8D4E3', '#C4D7B2', '#E8C9A0', '#D4B5D0', '#D4C5A9', '#A0B8C8', '#B8A9D4'];

Page({
  data: {
    workspaces: [],
    sharedWorkspaces: [],
    WS_ICONS,
    WS_COLORS,
    showCreateModal: false,
    showDeleteConfirm: false,
    wsName: '',
    wsIcon: '💡',
    wsColor: '#94B4C8',
    editingWorkspaceId: '',
    deletingWorkspaceId: '',
    // Share & Members
    showInviteModal: false,
    inviteCode: '',
    inviteWsName: '',
    showJoinModal: false,
    joinCodeInput: '',
    showMembersModal: false,
    membersWsName: '',
    membersList: [],
    membersWsId: '',
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
      _memberCount: (ws.members || []).length,
      _isOwner: ws.owner === app.globalData.currentUser.openId,
    }));
    const sharedWorkspaces = (app.globalData.sharedWorkspaces || []).map(ws => ({
      ...ws,
      _cardCount: 0, // shared spaces cards loaded separately
      _memberCount: (ws.members || []).length,
      _isShared: true,
    }));
    this.setData({ workspaces, sharedWorkspaces });
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

    const isOwner = ws.owner === app.globalData.currentUser.openId;
    const options = ['编辑空间'];

    if (isOwner || !ws.owner) {
      options.push('分享空间');
      if ((ws.members || []).length > 1) {
        options.push('管理成员');
      }
    }
    if (app.globalData.workspaces.length > 1) {
      options.push('删除空间');
    }

    wx.showActionSheet({
      itemList: options,
      success: (res) => {
        const action = options[res.tapIndex];
        if (action === '编辑空间') {
          this.setData({
            showCreateModal: true,
            editingWorkspaceId: id,
            wsName: ws.name,
            wsIcon: ws.icon,
            wsColor: ws.color,
          });
        } else if (action === '分享空间') {
          this.onShareWorkspace(id);
        } else if (action === '管理成员') {
          this.onManageMembers(id);
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
    const result = await getApp().joinWorkspace(code);
    wx.hideLoading();

    if (result) {
      this.setData({ showJoinModal: false });
      wx.showToast({ title: '已加入 ' + (result.workspaceName || '空间'), icon: 'success' });
      this.loadWorkspaces();
    } else {
      wx.showToast({ title: '邀请码无效', icon: 'none' });
    }
  },

  // ── Members ──

  onManageMembers(wsId) {
    const app = getApp();
    const ws = app.globalData.workspaces.find(w => w.id === wsId);
    if (!ws) return;

    this.setData({
      showMembersModal: true,
      membersWsId: wsId,
      membersWsName: ws.name,
      membersList: ws.members || [],
    });
  },

  onCloseMembersModal() {
    this.setData({ showMembersModal: false });
  },

  onRemoveMember(e) {
    const { openid, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '移除成员',
      content: '确定移除 ' + (name || '该成员') + '？',
      success: async (res) => {
        if (res.confirm) {
          const success = await getApp().removeMember(this.data.membersWsId, openid);
          if (success) {
            // Update local data
            const app = getApp();
            const ws = app.globalData.workspaces.find(w => w.id === this.data.membersWsId);
            if (ws) {
              ws.members = ws.members.filter(m => m.openId !== openid);
              wx.setStorageSync('workspaces', app.globalData.workspaces);
            }
            this.setData({
              membersList: ws ? ws.members : [],
            });
            this.loadWorkspaces();
            wx.showToast({ title: '已移除', icon: 'success' });
          }
        }
      },
    });
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

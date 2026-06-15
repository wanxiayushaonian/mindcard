/**
 * Workspace service: CRUD, switching, invite, members.
 * Extracted from app.js.
 */

const api = require('../utils/api');
const helpers = require('../utils/helpers');

function createWorkspaceService(app) {
  const store = app;

  async function loadFromApi() {
    try {
      const workspaces = await api.workspacesApi.list();
      store.globalData.workspaces = workspaces.map((ws) => ({
        id: ws.id,
        name: ws.name,
        icon: ws.icon || 'lightbulb',
        color: ws.color || '#94B4C8',
        createdAt: helpers.formatApiTime(ws.created_at),
        owner: ws.owner_id,
        inviteCode: ws.invite_code || '',
        memberRole: ws.member_role || 'editor',
      }));

      const cur = wx.getStorageSync('current_workspace');
      const validCur = store.globalData.workspaces.find((w) => w.id === cur);
      store.globalData.currentWorkspaceId = validCur
        ? cur
        : (store.globalData.workspaces[0] ? store.globalData.workspaces[0].id : '');

      if (store.globalData.currentWorkspaceId) {
        wx.setStorageSync('current_workspace', store.globalData.currentWorkspaceId);
      }
    } catch (e) {
      console.error('[API] loadWorkspaces failed:', e);
      _loadFromStorage();
    }
  }

  function _loadFromStorage() {
    const stored = wx.getStorageSync('workspaces');
    if (stored && stored.length > 0) {
      store.globalData.workspaces = stored;
      store.globalData.currentWorkspaceId = stored[0] ? stored[0].id : '';
    } else {
      store.globalData.workspaces = [{
        id: 'ws_default',
        name: '默认空间',
        icon: 'lightbulb',
        color: '#94B4C8',
        createdAt: helpers.formatTime(new Date()),
        owner: '',
        inviteCode: '',
        memberRole: 'owner',
      }];
      store.globalData.currentWorkspaceId = 'ws_default';
      wx.setStorageSync('workspaces', store.globalData.workspaces);
      wx.setStorageSync('current_workspace', 'ws_default');
    }
  }

  function getCurrent() {
    const wsId = store.globalData.currentWorkspaceId;
    return store.globalData.workspaces.find((w) => w.id === wsId) || store.globalData.workspaces[0] || null;
  }

  function switchTo(wsId) {
    store.globalData.currentWorkspaceId = wsId;
    wx.setStorageSync('current_workspace', wsId);
  }

  async function create(data) {
    try {
      const created = await api.workspacesApi.create(data);
      await loadFromApi();
      return created;
    } catch (e) {
      console.error('[API] createWorkspace failed:', e);
      throw e;
    }
  }

  // M7: local update only after API succeeds; error propagates to UI
  async function update(id, updates) {
    await api.workspacesApi.update(id, updates);
    const idx = store.globalData.workspaces.findIndex((w) => w.id === id);
    if (idx !== -1) {
      store.globalData.workspaces[idx] = { ...store.globalData.workspaces[idx], ...updates };
    }
  }

  // M3: local cleanup only after API succeeds; error propagates to UI
  async function remove(id) {
    await api.workspacesApi.delete(id);
    store.globalData.cards = store.globalData.cards.filter((c) => c.workspaceId !== id);
    const remainingCardIds = new Set(store.globalData.cards.map((c) => c.id));
    store.globalData.aiChats = store.globalData.aiChats.filter((c) => remainingCardIds.has(c.cardId));
    store.globalData.workspaces = store.globalData.workspaces.filter((w) => w.id !== id);
    wx.setStorageSync('workspaces', store.globalData.workspaces);
    wx.setStorageSync('inspiration_cards', store.globalData.cards);
    wx.setStorageSync('ai_chats', store.globalData.aiChats);
    if (store.globalData.currentWorkspaceId === id && store.globalData.workspaces.length > 0) {
      switchTo(store.globalData.workspaces[0].id);
    }
  }

  async function generateInviteCode(wsId) {
    try {
      const res = await api.workspacesApi.generateInviteCode(wsId);
      const code = res.invite_code;
      const idx = store.globalData.workspaces.findIndex((w) => w.id === wsId);
      if (idx !== -1) store.globalData.workspaces[idx].inviteCode = code;
      return code;
    } catch (e) {
      console.error('[API] generateInviteCode failed:', e);
      return null;
    }
  }

  async function joinByCode(inviteCode) {
    try {
      const res = await api.workspacesApi.joinByCode(inviteCode);
      await loadFromApi();
      return res;
    } catch (e) {
      console.error('[API] joinWorkspace failed:', e);
      return null;
    }
  }

  async function leave(wsId) {
    try {
      await api.workspacesApi.leave(wsId);
    } catch (e) {
      console.error('[API] leaveWorkspace failed:', e);
      throw e;
    }
    store.globalData.workspaces = store.globalData.workspaces.filter((w) => w.id !== wsId);
    store.globalData.cards = store.globalData.cards.filter((c) => c.workspaceId !== wsId);
    wx.setStorageSync('workspaces', store.globalData.workspaces);
    wx.setStorageSync('inspiration_cards', store.globalData.cards);
    if (store.globalData.currentWorkspaceId === wsId && store.globalData.workspaces.length > 0) {
      switchTo(store.globalData.workspaces[0].id);
    }
  }

  function isOwner(wsId) {
    const ws = store.globalData.workspaces.find((w) => w.id === wsId);
    if (!ws) return false;
    return ws.owner === store.globalData.currentUser.openId;
  }

  return {
    loadFromApi,
    getCurrent,
    switchTo,
    create,
    update,
    remove,
    generateInviteCode,
    joinByCode,
    leave,
    isOwner,
  };
}

module.exports = { createWorkspaceService };

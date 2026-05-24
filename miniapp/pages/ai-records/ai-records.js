// pages/ai-records/ai-records.js
Page({
  data: { chats: [], loading: false },

  onShow() {
    this.loadChats();
  },

  async loadChats() {
    var app = getApp();
    var ws = app.getCurrentWorkspace();
    if (ws && ws.id) {
      this.setData({ loading: true });
      await app.loadChatsFromApi(ws.id);
      this.setData({ loading: false });
    }
    var wsCardIds = new Set(app.getWorkspaceCards().map(function (c) { return c.id; }));
    var chats = app.globalData.aiChats.filter(function (c) {
      return wsCardIds.has(c.cardId) || !c.cardId;
    });
    this.setData({ chats: chats });
  },

  onRecordTap(e) {
    var chatId = e.currentTarget.dataset.id;
    var cardId = e.currentTarget.dataset.cardId;
    if (cardId) {
      wx.navigateTo({ url: '/pages/ai-chat/ai-chat?cardId=' + cardId });
    } else {
      wx.navigateTo({ url: '/pages/ai-chat/ai-chat?chatId=' + chatId });
    }
  },

  onDeleteRecord(e) {
    wx.showModal({
      title: '删除对话记录',
      content: '确定删除这条AI对话记录吗？',
      success: (res) => {
        if (res.confirm) {
          getApp().deleteChat(e.currentTarget.dataset.id);
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadChats();
        }
      },
    });
  },
});

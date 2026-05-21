// pages/ai-records/ai-records.js
Page({
  data: { chats: [] },

  onShow() {
    this.loadChats();
  },

  loadChats() {
    const app = getApp();
    const wsCardIds = new Set(app.getWorkspaceCards().map(c => c.id));
    const chats = app.globalData.aiChats.filter(c => wsCardIds.has(c.cardId));
    this.setData({ chats });
  },

  onRecordTap(e) {
    wx.navigateTo({ url: '/pages/ai-chat/ai-chat?cardId=' + e.currentTarget.dataset.cardId });
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

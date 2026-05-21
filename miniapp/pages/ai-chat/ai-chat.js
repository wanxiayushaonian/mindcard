// pages/ai-chat/ai-chat.js
const { chatStream, generateTitle, extractKeywords } = require('../../utils/deepseek');
const { CARD_COLORS } = require('../../utils/mock-data');

Page({
  data: {
    cardId: '',
    contextCard: null,
    messages: [],
    inputText: '',
    isLoading: false,
    scrollTarget: '',
    showCardPicker: false,
    chatId: '',
    precipitating: false,
  },

  _streamTimer: null,
  _streamContent: '',
  _streamMsgId: '',
  _streamTime: '',

  onLoad(options) {
    const cardId = options.cardId || '';
    this.setData({ cardId });

    if (cardId) {
      const app = getApp();
      const card = app.getCardById(cardId);
      if (card) this.setData({ contextCard: card });

      // #2: Load from globalData
      const chat = app.getChatByCardId(cardId);
      if (chat) {
        this.setData({ messages: chat.messages, chatId: chat.id });
      }
      this.scrollToBottom();
    }
  },

  // #4.1: Persist messages on unload
  onUnload() {
    this._persistChat();
  },

  _persistChat() {
    const { cardId, messages, chatId } = this.data;
    if (!cardId || messages.length === 0) return;

    const app = getApp();
    const now = app._formatTime ? app._formatTime(new Date()) : new Date().toLocaleString();

    if (chatId) {
      const chat = app.globalData.aiChats.find(c => c.id === chatId);
      if (chat) {
        app.saveChat({ ...chat, messages });
      }
    } else {
      const newChat = {
        id: 'chat_' + Date.now(),
        cardId,
        title: (this.data.contextCard || {}).title || '灵感对话',
        createdAt: now,
        messages,
      };
      app.saveChat(newChat);
      this.setData({ chatId: newChat.id });
      // Mark card as having AI chat
      app.updateCard(cardId, { hasAiChat: true });
    }
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  onSend() {
    const { inputText, messages, contextCard } = this.data;
    if (!inputText.trim()) return;

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const userMsg = { id: 'msg_' + Date.now(), role: 'user', content: inputText.trim(), time };

    this.setData({ messages: [...messages, userMsg], inputText: '', isLoading: true });
    this.scrollToBottom();

    var self = this;
    var aiMsgId = 'msg_' + Date.now();
    var aiTime = time;
    self._streamMsgId = aiMsgId;
    self._streamTime = aiTime;
    self._streamContent = '';
    self._streamTimer = null;

    chatStream({
      cardContext: contextCard ? contextCard.content : '',
      historyMessages: messages,
      userMessage: inputText.trim(),
      onChunk: function (text) {
        self._streamContent = text;
        if (!self._streamTimer) {
          self._streamTimer = setTimeout(function () {
            self._flushStream();
            self._streamTimer = null;
          }, 100);
        }
      },
      onComplete: function (text) {
        if (self._streamTimer) { clearTimeout(self._streamTimer); self._streamTimer = null; }
        self._streamContent = text;
        self._flushStream();
        self.setData({ isLoading: false });
        self.scrollToBottom();
        self._persistChat();
      },
      onError: function (err) {
        if (self._streamTimer) { clearTimeout(self._streamTimer); self._streamTimer = null; }
        var errMsg = { id: aiMsgId, role: 'ai', content: '抱歉，AI 暂时无法回复：' + err.message, time: aiTime };
        self.setData({ messages: [...self.data.messages, errMsg], isLoading: false });
        self.scrollToBottom();
      },
    });
  },

  _flushStream() {
    var msgs = [...this.data.messages];
    var idx = msgs.findIndex(m => m.id === this._streamMsgId);
    var aiMsg = { id: this._streamMsgId, role: 'ai', content: this._streamContent, time: this._streamTime };
    if (idx !== -1) {
      msgs[idx] = aiMsg;
    } else {
      msgs.push(aiMsg);
    }
    this.setData({ messages: msgs });
  },

  onQuickPrompt(e) {
    this.setData({ inputText: e.currentTarget.dataset.prompt });
  },

  // #6: Actually apply AI content to card
  onApplyToCard(e) {
    const msgId = e.currentTarget.dataset.msgId;
    const msg = this.data.messages.find(m => m.id === msgId);
    if (!msg || !this.data.cardId) return;

    const app = getApp();
    const card = app.getCardById(this.data.cardId);
    if (card) {
      const newContent = card.content + '\n\n--- AI建议 ---\n' + msg.content;
      app.updateCard(this.data.cardId, { content: newContent });
    }
    wx.showToast({ title: '已应用到卡片', icon: 'success' });
  },

  onPrecipitate(e) {
    if (this.data.precipitating) return;
    const msgId = e.currentTarget.dataset.msgId;
    const msg = this.data.messages.find(m => m.id === msgId);
    if (!msg) return;

    this.setData({ precipitating: true });
    const app = getApp();
    const content = msg.content;
    const color = CARD_COLORS[Math.floor(Math.random() * CARD_COLORS.length)];

    Promise.all([
      generateTitle(content).catch(function () { return 'AI灵感'; }),
      extractKeywords(content).catch(function () { return []; }),
    ]).then(function (results) {
      var title = results[0] || 'AI灵感';
      var keywords = results[1] || [];
      var newCard = app.addCard({ title: title, content: content, keywords: keywords, color: color });
      wx.showToast({ title: '已沉淀为新卡片', icon: 'success' });
      setTimeout(function () {
        wx.navigateTo({ url: '/pages/card-detail/card-detail?id=' + newCard.id });
      }, 800);
    }).finally(() => {
      this.setData({ precipitating: false });
    });
  },

  // #8: Change context via card picker
  onChangeContext() {
    this.setData({ showCardPicker: true });
  },

  onContextPickerSelect(e) {
    const app = getApp();
    const card = app.getCardById(e.detail.id);
    if (card) {
      this.setData({ contextCard: card, cardId: card.id, messages: [], chatId: '' });
      const chat = app.getChatByCardId(card.id);
      if (chat) this.setData({ messages: chat.messages, chatId: chat.id });
    }
    this.setData({ showCardPicker: false });
  },

  onContextPickerClose() {
    this.setData({ showCardPicker: false });
  },

  // #12: Navigate to AI settings
  onSettings() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  // #20: Long press message for delete/copy
  onMsgLongPress(e) {
    const msgId = e.currentTarget.dataset.msgId;
    wx.showActionSheet({
      itemList: ['复制内容', '删除消息'],
      success: (res) => {
        if (res.tapIndex === 0) {
          const msg = this.data.messages.find(m => m.id === msgId);
          if (msg) {
            wx.setClipboardData({ data: msg.content });
          }
        } else if (res.tapIndex === 1) {
          const newMessages = this.data.messages.filter(m => m.id !== msgId);
          this.setData({ messages: newMessages });
          this._persistChat();
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      },
    });
  },

  scrollToBottom() {
    setTimeout(() => {
      this.setData({ scrollTarget: 'scroll-bottom' });
    }, 150);
  },
});

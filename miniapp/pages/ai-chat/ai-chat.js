// pages/ai-chat/ai-chat.js
const api = require('../../utils/api');
const helpers = require('../../utils/helpers');

Page({
  data: {
    cardId: '',
    contextCard: null,
    messages: [],
    inputText: '',
    isLoading: false,
    scrollTarget: '',
    showCardPicker: false,
    showHistory: false,
    chatHistory: [],
    chatId: '',
  },

  _streamMsgId: '',
  _streamTime: '',
  _streamTask: null,
  _msgCounter: 0,
  _pendingStreamContent: null,
  _streamFlushTimer: null,

  onLoad(options) {
    const cardId = options.cardId || '';
    const chatId = options.chatId || '';
    this.setData({ cardId });

    if (cardId) {
      const app = getApp();
      const card = app.getCardById(cardId);
      if (card) this.setData({ contextCard: card });

      const chat = app.getChatByCardId(cardId);
      if (chat) {
        const msgs = chat.messages.map((m) => m.uid ? m : { ...m, uid: m.id });
        this.setData({ messages: msgs, chatId: chat.id });
      }
      this.scrollToBottom();
    } else if (chatId) {
      this.setData({ chatId });
      getApp().loadChatMessages(chatId).then((messages) => {
        if (messages.length > 0) {
          this.setData({ messages });
          this.scrollToBottom();
        }
      });
    }
  },

  onUnload() {
    if (this._streamFlushTimer) {
      clearInterval(this._streamFlushTimer);
      this._streamFlushTimer = null;
    }
    const { chatId, cardId, messages } = this.data;
    if (messages.length === 0) return;
    // Sync: update in-memory so navigating back sees latest messages
    const chats = getApp().globalData.aiChats;
    const existing = chatId
      ? chats.find((c) => c.id === chatId)
      : (cardId ? chats.find((c) => c.cardId === cardId) : null);
    if (existing) existing.messages = messages;
    this._persistChat();
  },

  _persistChat() {
    const { cardId, messages, chatId } = this.data;
    if (messages.length === 0) return;

    const app = getApp();
    const now = helpers.formatTime(new Date());
    const wsId = app.globalData.currentWorkspaceId;

    if (chatId) {
      const chat = app.globalData.aiChats.find((c) => c.id === chatId);
      if (chat) {
        const updatedChat = { ...chat, messages };
        app.saveChat(updatedChat).then((serverId) => {
          if (serverId && serverId !== chatId) {
            this.setData({ chatId: serverId });
          }
        });
      }
    } else {
      const existing = cardId ? app.globalData.aiChats.find((c) => c.cardId === cardId) : null;
      if (existing) {
        app.saveChat({ ...existing, messages });
        this.setData({ chatId: existing.id });
      } else {
        const newChat = {
          id: `chat_${Date.now()}`,
          cardId: cardId || '',
          workspaceId: wsId || '',
          title: (this.data.contextCard || {}).title || '灵感对话',
          createdAt: now,
          messages,
        };
        app.saveChat(newChat).then((serverId) => {
          if (serverId && serverId !== newChat.id) {
            this.setData({ chatId: serverId });
          }
        });
        this.setData({ chatId: newChat.id });
        if (cardId) app.updateCard(cardId, { hasAiChat: true });
      }
    }
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  onSend() {
    if (this.data.isLoading) return;
    const inputText = this.data.inputText;
    if (!inputText.trim()) return;

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    // C5: use counter to guarantee unique IDs even within the same millisecond
    const userMsgId = `msg_u_${Date.now()}_${++this._msgCounter}`;
    const userMsg = {
      id: userMsgId,
      uid: userMsgId,
      role: 'user',
      content: inputText.trim(),
      time,
    };

    this.setData({ messages: [...this.data.messages, userMsg], inputText: '', isLoading: true });
    this.scrollToBottom();

    const aiMsgId = `msg_a_${Date.now()}_${++this._msgCounter}`;
    this._streamMsgId = aiMsgId;
    this._streamTime = time;

    this._streamTask = api.ragApi.streamChat(
      inputText.trim(),
      this.data.cardId || undefined,
      null, null,
      (fullContent) => {
        const msgs = this.data.messages;
        const isFirst = msgs.findIndex((m) => m.id === this._streamMsgId) === -1;
        if (isFirst) {
          // First chunk: add bubble immediately, start flush timer for subsequent chunks
          const newMsgs = msgs.slice();
          newMsgs.push({
            id: this._streamMsgId,
            uid: this._streamMsgId,
            role: 'ai',
            content: fullContent,
            time: this._streamTime,
            streaming: true,
          });
          this.setData({ messages: newMsgs, isLoading: false });
          // Throttle: flush buffered content at most once per 300ms so
          // markdown-render doesn't re-parse on every network chunk
          this._streamFlushTimer = setInterval(() => {
            if (this._pendingStreamContent === null) return;
            const c = this._pendingStreamContent;
            this._pendingStreamContent = null;
            const m = this.data.messages.slice();
            const i = m.findIndex((x) => x.id === this._streamMsgId);
            if (i !== -1) {
              m[i] = { ...m[i], content: c };
              this.setData({ messages: m });
            }
          }, 300);
        } else {
          // Buffer content; the flush timer will pick it up
          this._pendingStreamContent = fullContent;
        }
      },
      (fullContent) => {
        if (this._streamFlushTimer) {
          clearInterval(this._streamFlushTimer);
          this._streamFlushTimer = null;
        }
        this._pendingStreamContent = null;
        const msgs = this.data.messages.slice();
        const idx = msgs.findIndex((m) => m.id === this._streamMsgId);
        const aiMsg = {
          id: this._streamMsgId,
          uid: this._streamMsgId,
          role: 'ai',
          content: fullContent,
          time: this._streamTime,
          streaming: false,
        };
        if (idx !== -1) {
          msgs[idx] = aiMsg;
        } else {
          msgs.push(aiMsg);
        }
        this.setData({ messages: msgs, isLoading: false });
        this.scrollToBottom();
        this._persistChat();
      },
      (err) => {
        this._streamTask = null;
        const msgs = this.data.messages.slice();
        const idx = msgs.findIndex((m) => m.id === this._streamMsgId);
        const errMsg = {
          id: aiMsgId,
          uid: aiMsgId,
          role: 'ai',
          content: `抱歉，AI 暂时无法回复：${err.message}`,
          time,
          isError: true,
        };
        if (idx !== -1) {
          msgs[idx] = errMsg;
        } else {
          msgs.push(errMsg);
        }
        this.setData({ messages: msgs, isLoading: false });
        this.scrollToBottom();
      }
    );
  },

  onStopStream() {
    if (this._streamFlushTimer) {
      clearInterval(this._streamFlushTimer);
      this._streamFlushTimer = null;
    }
    this._pendingStreamContent = null;
    if (this._streamTask && typeof this._streamTask.abort === 'function') {
      this._streamTask.abort();
      this._streamTask = null;
    }
    this.setData({ isLoading: false });
  },

  onQuickPrompt(e) {
    this.setData({ inputText: e.currentTarget.dataset.prompt });
  },

  onSaveAsNewCard(e) {
    const msgId = e.currentTarget.dataset.msgId;
    const msg = this.data.messages.find((m) => m.id === msgId);
    if (!msg) return;

    const lines = msg.content.trim().split('\n');
    const title = lines[0].replace(/^[#\s]+/, '').slice(0, 30) || 'AI 灵感';

    const app = getApp();
    app.addCard({
      title,
      content: msg.content,
      isTemp: false,
      parentCardIds: this.data.cardId ? [this.data.cardId] : [],
    });
    wx.showToast({ title: '已存为新卡片', icon: 'success' });
  },

  onChangeContext() {
    this.setData({ showCardPicker: true });
  },

  onContextPickerSelect(e) {
    const app = getApp();
    const card = app.getCardById(e.detail.id);
    if (card) {
      this.setData({ contextCard: card, cardId: card.id, messages: [], chatId: '' });
      const chat = app.getChatByCardId(card.id);
      if (chat) {
        const msgs = chat.messages.map((m) => m.uid ? m : { ...m, uid: m.id });
        this.setData({ messages: msgs, chatId: chat.id });
      }
    }
    this.setData({ showCardPicker: false });
  },

  onContextPickerClose() {
    this.setData({ showCardPicker: false });
  },

  onMsgLongPress(e) {
    const msgId = e.currentTarget.dataset.msgId;
    wx.showActionSheet({
      itemList: ['复制内容', '删除消息'],
      success: (res) => {
        if (res.tapIndex === 0) {
          const msg = this.data.messages.find((m) => m.id === msgId);
          if (msg) wx.setClipboardData({ data: msg.content });
        } else if (res.tapIndex === 1) {
          const newMessages = this.data.messages.filter((m) => m.id !== msgId);
          this.setData({ messages: newMessages });
          this._persistChat();
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      },
    });
  },

  onSourceTap(e) {
    const cardId = e.currentTarget.dataset.id;
    if (cardId) {
      wx.navigateTo({ url: `/pages/card-detail/card-detail?id=${cardId}` });
    }
  },

  noop() {},

  onToggleHistory() {
    if (this.data.showHistory) {
      this.setData({ showHistory: false });
      return;
    }
    const chats = (getApp().globalData.aiChats || []).slice().reverse().map((c) => ({
      ...c,
      _displayCount: c.messageCount || (c.messages ? c.messages.length : 0),
    }));
    this.setData({ chatHistory: chats, showHistory: true });
  },

  onSelectHistoryChat(e) {
    const chatId = e.currentTarget.dataset.id;
    const app = getApp();
    const chat = app.globalData.aiChats.find((c) => c.id === chatId);
    if (!chat) return;
    const msgs = (chat.messages || []).map((m) => m.uid ? m : { ...m, uid: m.id });
    this.setData({
      messages: msgs,
      chatId: chat.id,
      cardId: chat.cardId || '',
      showHistory: false,
    });
    if (chat.cardId) {
      const card = app.getCardById(chat.cardId);
      if (card) this.setData({ contextCard: card });
    }
    this.scrollToBottom();
  },

  onDeleteHistoryChat(e) {
    const idx = e.currentTarget.dataset.idx;
    const chat = this.data.chatHistory[idx];
    if (!chat) return;
    wx.showModal({
      title: '删除对话',
      content: '确定删除此对话？',
      success: (res) => {
        if (res.confirm) {
          getApp().deleteChat(chat.id);
          const chats = this.data.chatHistory.slice();
          chats.splice(idx, 1);
          this.setData({ chatHistory: chats });
          if (this.data.chatId === chat.id) {
            this.setData({ messages: [], chatId: '', cardId: '', contextCard: null });
          }
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

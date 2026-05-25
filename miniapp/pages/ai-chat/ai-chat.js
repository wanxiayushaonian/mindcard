// pages/ai-chat/ai-chat.js
var api = require('../../utils/api');
var { CARD_COLORS } = require('../../utils/mock-data');

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
    canPrecipitate: false,
    mode: 'rag',
    modes: [
      { key: 'rag', label: '知识问答' },
      { key: 'chat', label: '自由对话' },
    ],
  },

  _streamTimer: null,
  _streamContent: '',
  _streamMsgId: '',
  _streamTime: '',
  _streamTask: null,

  onLoad: function (options) {
    var cardId = options.cardId || '';
    var chatId = options.chatId || '';
    var app = getApp();
    var ws = app.getCurrentWorkspace();
    this.setData({ cardId: cardId, canPrecipitate: ws && ws.memberRole === 'owner' });

    if (cardId) {
      var card = app.getCardById(cardId);
      if (card) this.setData({ contextCard: card });

      var chat = app.getChatByCardId(cardId);
      if (chat) {
        var msgs = chat.messages.map(function (m) {
          return m.uid ? m : Object.assign({}, m, { uid: m.id });
        });
        this.setData({ messages: msgs, chatId: chat.id });
      }
      this.scrollToBottom();
    } else if (chatId) {
      // Load specific chat by ID (from history list)
      this.setData({ chatId: chatId });
      var self = this;
      app.loadChatMessages(chatId).then(function (messages) {
        if (messages.length > 0) {
          self.setData({ messages: messages });
          self.scrollToBottom();
        }
      });
    }
  },

  onUnload: function () {
    this._persistChat();
  },

  _persistChat: function () {
    var cardId = this.data.cardId;
    var messages = this.data.messages;
    var chatId = this.data.chatId;
    if (!cardId || messages.length === 0) return;

    var app = getApp();
    var now = app._formatTime ? app._formatTime(new Date()) : new Date().toLocaleString();
    var self = this;

    if (chatId) {
      var chat = app.globalData.aiChats.find(function (c) { return c.id === chatId; });
      if (chat) {
        var updatedChat = Object.assign({}, chat, { messages: messages });
        app.saveChat(updatedChat).then(function (serverId) {
          if (serverId && serverId !== chatId) {
            self.setData({ chatId: serverId });
          }
        });
      }
    } else {
      // Check if a chat already exists for this card (might have been loaded from server)
      var existing = app.globalData.aiChats.find(function (c) { return c.cardId === cardId; });
      if (existing) {
        app.saveChat(Object.assign({}, existing, { messages: messages }));
        self.setData({ chatId: existing.id });
      } else {
        var newChat = {
          id: 'chat_' + Date.now(),
          cardId: cardId,
          title: (this.data.contextCard || {}).title || '灵感对话',
          createdAt: now,
          messages: messages,
        };
        app.saveChat(newChat).then(function (serverId) {
          if (serverId && serverId !== newChat.id) {
            self.setData({ chatId: serverId });
          }
        });
        this.setData({ chatId: newChat.id });
        app.updateCard(cardId, { hasAiChat: true });
      }
    }
  },

  onInput: function (e) {
    this.setData({ inputText: e.detail.value });
  },

  onModeTap: function (e) {
    this.setData({ mode: e.currentTarget.dataset.mode });
  },

  onSend: function () {
    var inputText = this.data.inputText;
    var messages = this.data.messages;
    var contextCard = this.data.contextCard;
    if (!inputText.trim()) return;

    var now = new Date();
    var time = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    var userMsg = { id: 'msg_' + Date.now(), uid: 'msg_' + Date.now(), role: 'user', content: inputText.trim(), time: time };

    this.setData({ messages: messages.concat([userMsg]), inputText: '', isLoading: true });
    this.scrollToBottom();

    var self = this;
    var aiMsgId = 'msg_' + Date.now();
    var aiTime = time;
    self._streamMsgId = aiMsgId;
    self._streamTime = aiTime;
    self._streamContent = '';
    self._streamTimer = null;

    var app = getApp();
    var workspaceId = app.globalData.currentWorkspaceId;
    var aiTone = app.getSetting('aiTone', '创意');
    var aiDirection = app.getSetting('aiDirection', '发散');

    if (self.data.mode === 'rag') {
      // RAG knowledge Q&A via FastAPI
      if (!workspaceId) {
        wx.showToast({ title: '请先选择空间', icon: 'none' });
        self.setData({ isLoading: false });
        return;
      }
      self._streamTask = api.streamRequest('/api/rag/ask/stream', {
        question: inputText.trim(),
        workspace_id: workspaceId,
        card_id: self.data.cardId || undefined,
        top_k: 5,
        ai_tone: aiTone,
        ai_direction: aiDirection,
      }, function (text) {
        // onChunk
        self._streamContent = text;
        if (!self._streamTimer) {
          var len = text.length;
          var delay = len < 3000 ? 80 : len < 10000 ? 140 : 220;
          self._streamTimer = setTimeout(function () {
            self._flushStream();
            self._streamTimer = null;
          }, delay);
        }
      }, function (fullContent, extra) {
        // onDone
        self._streamTask = null;
        if (self._streamTimer) { clearTimeout(self._streamTimer); self._streamTimer = null; }
        self._streamContent = fullContent;
        self._flushStream();
        // Attach sources if available
        if (extra && extra.sources && extra.sources.length > 0) {
          var msgs = self.data.messages.slice();
          var idx = msgs.findIndex(function (m) { return m.id === aiMsgId; });
          if (idx !== -1) {
            msgs[idx] = Object.assign({}, msgs[idx], { sources: extra.sources });
            self.setData({ messages: msgs });
          }
        }
        self.setData({ isLoading: false });
        self.scrollToBottom();
        self._persistChat();
      }, function (err) {
        // onError
        self._streamTask = null;
        if (self._streamTimer) { clearTimeout(self._streamTimer); self._streamTimer = null; }
        var errMsg = { id: aiMsgId, uid: aiMsgId, role: 'ai', content: '抱歉，AI 暂时无法回复：' + err.message, time: aiTime, isError: true };
        self.setData({ messages: self.data.messages.concat([errMsg]), isLoading: false });
        self.scrollToBottom();
      });
    } else {
      // Free chat via FastAPI
      var history = messages.slice(-10).map(function (m) {
        return { role: m.role === 'ai' ? 'assistant' : 'user', content: m.content };
      });
      self._streamTask = api.streamRequest('/api/rag/chat/stream', {
        message: inputText.trim(),
        history: history,
        ai_tone: aiTone,
        ai_direction: aiDirection,
      }, function (text) {
        self._streamContent = text;
        if (!self._streamTimer) {
          var len = text.length;
          var delay = len < 3000 ? 80 : len < 10000 ? 140 : 220;
          self._streamTimer = setTimeout(function () {
            self._flushStream();
            self._streamTimer = null;
          }, delay);
        }
      }, function (fullContent) {
        self._streamTask = null;
        if (self._streamTimer) { clearTimeout(self._streamTimer); self._streamTimer = null; }
        self._streamContent = fullContent;
        self._flushStream();
        self.setData({ isLoading: false });
        self.scrollToBottom();
        self._persistChat();
      }, function (err) {
        self._streamTask = null;
        if (self._streamTimer) { clearTimeout(self._streamTimer); self._streamTimer = null; }
        var errMsg = { id: aiMsgId, uid: aiMsgId, role: 'ai', content: '抱歉，AI 暂时无法回复：' + err.message, time: aiTime, isError: true };
        self.setData({ messages: self.data.messages.concat([errMsg]), isLoading: false });
        self.scrollToBottom();
      });
    }
  },

  _streamVersion: 0,

  _flushStream: function () {
    var msgs = this.data.messages.slice();
    var idx = -1;
    for (var i = 0; i < msgs.length; i++) {
      if (msgs[i].id === this._streamMsgId) { idx = i; break; }
    }
    this._streamVersion++;
    var aiMsg = { id: this._streamMsgId, uid: this._streamMsgId + '_v' + this._streamVersion, role: 'ai', content: this._streamContent, time: this._streamTime };
    if (idx !== -1) {
      msgs[idx] = aiMsg;
    } else {
      msgs.push(aiMsg);
    }
    this.setData({ messages: msgs });
  },

  onStopStream: function () {
    if (this._streamTask && typeof this._streamTask.abort === 'function') {
      this._streamTask.abort();
    }
    if (this._streamTimer) {
      clearTimeout(this._streamTimer);
      this._streamTimer = null;
    }
    // Keep whatever content was streamed so far
    if (this._streamContent) {
      this._flushStream();
      this._persistChat();
    }
    this._streamTask = null;
    this.setData({ isLoading: false });
  },

  onQuickPrompt: function (e) {
    this.setData({ inputText: e.currentTarget.dataset.prompt });
  },

  onApplyToCard: function (e) {
    var msgId = e.currentTarget.dataset.msgId;
    var msg = this.data.messages.find(function (m) { return m.id === msgId; });
    if (!msg || !this.data.cardId) return;

    var app = getApp();
    var card = app.getCardById(this.data.cardId);
    if (card) {
      var newContent = card.content + '\n\n--- AI建议 ---\n' + msg.content;
      app.updateCard(this.data.cardId, { content: newContent });
    }
    wx.showToast({ title: '已应用到卡片', icon: 'success' });
  },

  onPrecipitate: function (e) {
    if (this.data.precipitating || !this.data.canPrecipitate) return;
    var msgId = e.currentTarget.dataset.msgId;
    var msg = this.data.messages.find(function (m) { return m.id === msgId; });
    if (!msg) return;

    this.setData({ precipitating: true });
    var app = getApp();
    var content = msg.content;
    var color = CARD_COLORS[Math.floor(Math.random() * CARD_COLORS.length)];
    var self = this;

    // Use backend AI endpoints for title/keywords
    Promise.all([
      api.post('/api/ai/generate-title', { content: content })
        .then(function (r) { return r.title; })
        .catch(function () { return 'AI灵感'; }),
      api.post('/api/ai/extract-keywords', { content: content })
        .then(function (r) { return r.keywords || []; })
        .catch(function () { return []; }),
    ]).then(function (results) {
      var title = results[0] || 'AI灵感';
      var keywords = results[1] || [];
      return app.addCard({ title: title, content: content, keywords: keywords, color: color });
    }).then(function (newCard) {
      wx.showToast({ title: '已沉淀为新卡片', icon: 'success' });
      setTimeout(function () {
        wx.navigateTo({ url: '/pages/card-detail/card-detail?id=' + newCard.id });
      }, 800);
    }).finally(function () {
      self.setData({ precipitating: false });
    });
  },

  onChangeContext: function () {
    this.setData({ showCardPicker: true });
  },

  onContextPickerSelect: function (e) {
    var app = getApp();
    var card = app.getCardById(e.detail.id);
    if (card) {
      this.setData({ contextCard: card, cardId: card.id, messages: [], chatId: '' });
      var chat = app.getChatByCardId(card.id);
      if (chat) {
        var msgs = chat.messages.map(function (m) {
          return m.uid ? m : Object.assign({}, m, { uid: m.id });
        });
        this.setData({ messages: msgs, chatId: chat.id });
      }
    }
    this.setData({ showCardPicker: false });
  },

  onContextPickerClose: function () {
    this.setData({ showCardPicker: false });
  },

  onSettings: function () {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  onHistory: function () {
    wx.navigateTo({ url: '/pages/ai-records/ai-records' });
  },

  onMsgLongPress: function (e) {
    var msgId = e.currentTarget.dataset.msgId;
    var self = this;
    wx.showActionSheet({
      itemList: ['复制内容', '删除消息'],
      success: function (res) {
        if (res.tapIndex === 0) {
          var msg = self.data.messages.find(function (m) { return m.id === msgId; });
          if (msg) {
            wx.setClipboardData({ data: msg.content });
          }
        } else if (res.tapIndex === 1) {
          var newMessages = self.data.messages.filter(function (m) { return m.id !== msgId; });
          self.setData({ messages: newMessages });
          self._persistChat();
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      },
    });
  },

  onSourceTap: function (e) {
    var cardId = e.currentTarget.dataset.id;
    if (cardId) {
      wx.navigateTo({ url: '/pages/card-detail/card-detail?id=' + cardId });
    }
  },

  scrollToBottom: function () {
    var self = this;
    setTimeout(function () {
      self.setData({ scrollTarget: 'scroll-bottom' });
    }, 150);
  },
});

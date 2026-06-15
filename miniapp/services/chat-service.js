/**
 * Chat service: persistence, loading, message sync.
 * Extracted from app.js.
 */

const api = require('../utils/api');
const helpers = require('../utils/helpers');

function createChatService(app) {
  const store = app;

  function loadFromStorage() {
    const stored = wx.getStorageSync('ai_chats');
    if (stored && stored.length > 0) {
      store.globalData.aiChats = stored;
    } else {
      const { mockChats } = require('../utils/mock-data');
      store.globalData.aiChats = mockChats;
      wx.setStorageSync('ai_chats', mockChats);
    }
  }

  function getByCardId(cardId) {
    return store.globalData.aiChats.find((c) => c.cardId === cardId) || null;
  }

  async function save(chat) {
    const idx = store.globalData.aiChats.findIndex((c) => c.id === chat.id);
    if (idx !== -1) {
      store.globalData.aiChats[idx] = chat;
    } else {
      store.globalData.aiChats.push(chat);
    }
    wx.setStorageSync('ai_chats', store.globalData.aiChats);

    try {
      const isServerChat = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(chat.id);
      let serverChatId = chat.id;

      if (!isServerChat) {
        const created = await api.chatApi.create({
          local_id: chat.id,
          title: chat.title || '',
          card_id: chat.cardId || undefined,
          workspace_id: store.globalData.currentWorkspaceId || undefined,
          mode: 'chat',
        });
        if (created && created.id) {
          serverChatId = created.id;
          const cidx = store.globalData.aiChats.findIndex((c) => c.id === chat.id);
          if (cidx !== -1) {
            store.globalData.aiChats[cidx] = { ...store.globalData.aiChats[cidx], id: created.id };
            wx.setStorageSync('ai_chats', store.globalData.aiChats);
          }
        }
      }

      if (chat.messages && chat.messages.length > 0) {
        const msgs = chat.messages.map((m) => ({
          role: m.role === 'ai' ? 'assistant' : m.role,
          content: m.content,
        }));
        await api.chatApi.batchMessages(serverChatId, msgs);
      }

      if (serverChatId !== chat.id) return serverChatId;
    } catch (e) {
      console.error('[API] saveChat failed:', e);
    }
    return chat.id;
  }

  async function remove(chatId) {
    store.globalData.aiChats = store.globalData.aiChats.filter((c) => c.id !== chatId);
    wx.setStorageSync('ai_chats', store.globalData.aiChats);
    try {
      await api.chatApi.delete(chatId);
    } catch (e) {
      console.error('[API] deleteChat failed:', e);
    }
  }

  async function loadFromApi(workspaceId) {
    try {
      const chats = await api.chatApi.list(null, workspaceId);
      const loaded = (chats || []).map((c) => ({
        id: c.id,
        cardId: c.card_id || '',
        workspaceId: workspaceId || '',
        title: c.title || '灵感对话',
        createdAt: helpers.formatApiTime(c.created_at),
        messages: [],
        messageCount: c.message_count || 0,
        lastMessage: c.last_message || '',
      }));

      loaded.forEach((serverChat) => {
        const existing = store.globalData.aiChats.find((lc) => lc.id === serverChat.id);
        if (!existing) {
          store.globalData.aiChats.push(serverChat);
        } else {
          existing.messageCount = serverChat.messageCount;
          existing.lastMessage = serverChat.lastMessage;
          existing.title = serverChat.title || existing.title;
        }
      });
      wx.setStorageSync('ai_chats', store.globalData.aiChats);
      return loaded;
    } catch (e) {
      console.error('[API] loadChatsFromApi failed:', e);
      return [];
    }
  }

  async function loadMessages(chatId) {
    try {
      const chat = await api.chatApi.get(chatId);
      const messages = (chat.messages || []).map((m) => {
        const d = new Date(m.created_at);
        const time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        return {
          id: m.id,
          uid: m.id,
          role: m.role === 'assistant' ? 'ai' : m.role,
          content: m.content,
          time,
        };
      });
      const idx = store.globalData.aiChats.findIndex((c) => c.id === chatId);
      if (idx !== -1) {
        store.globalData.aiChats[idx].messages = messages;
        wx.setStorageSync('ai_chats', store.globalData.aiChats);
      }
      return messages;
    } catch (e) {
      console.error('[API] loadChatMessages failed:', e);
      return [];
    }
  }

  return {
    loadFromStorage,
    getByCardId,
    save,
    remove,
    loadFromApi,
    loadMessages,
  };
}

module.exports = { createChatService };

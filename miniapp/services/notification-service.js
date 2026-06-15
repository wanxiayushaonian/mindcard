/**
 * Notification service: list, unread count, mark read.
 * Extracted from app.js.
 */

const api = require('../utils/api');
const helpers = require('../utils/helpers');

function createNotificationService(app) {
  const store = app;

  async function load() {
    try {
      const notifs = await api.notificationsApi.list();
      store.globalData.notifications = (notifs || []).map((n) => ({
        id: n.id,
        type: n.type,
        content: n.content,
        link: n.link || '',
        isRead: n.is_read,
        createdAt: helpers.formatApiTime(n.created_at),
      }));
      return store.globalData.notifications;
    } catch (e) {
      console.error('[API] loadNotifications failed:', e);
      return [];
    }
  }

  async function loadUnreadCount() {
    try {
      const res = await api.notificationsApi.unreadCount();
      store.globalData.unreadNotificationCount = res.count || 0;
      return store.globalData.unreadNotificationCount;
    } catch (e) {
      return 0;
    }
  }

  async function markRead(id) {
    try {
      await api.notificationsApi.markRead(id);
      const notif = store.globalData.notifications.find((n) => n.id === id);
      if (notif && !notif.isRead) {
        notif.isRead = true;
        store.globalData.unreadNotificationCount = Math.max(0, store.globalData.unreadNotificationCount - 1);
      }
    } catch (e) {
      console.error('[API] markNotificationRead failed:', e);
    }
  }

  async function markAllRead() {
    try {
      await api.notificationsApi.markAllRead();
      store.globalData.notifications.forEach((n) => { n.isRead = true; });
      store.globalData.unreadNotificationCount = 0;
    } catch (e) {
      console.error('[API] markAllNotificationsRead failed:', e);
    }
  }

  return { load, loadUnreadCount, markRead, markAllRead };
}

module.exports = { createNotificationService };

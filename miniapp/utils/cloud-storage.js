// utils/cloud-storage.js
// WeChat Cloud Development storage abstraction layer
// Write-through: local sync + cloud async, read with cloud-first fallback

const CLOUD_TIMEOUT = 5000;

class CloudStorage {
  constructor() {
    this.db = null;
    this.collections = {};
    this.ready = false;
  }

  // ── Lifecycle ──

  init() {
    try {
      wx.cloud.init({ env: 'mindcard-prod', traceUser: true });
      this.db = wx.cloud.database();
      this.collections = {
        workspaces: this.db.collection('workspaces'),
        cards: this.db.collection('cards'),
        ai_chats: this.db.collection('ai_chats'),
        settings: this.db.collection('settings'),
        comments: this.db.collection('comments'),
      };
      this.ready = true;
    } catch (e) {
      console.error('[CloudStorage] init failed:', e);
      this.ready = false;
    }
  }

  // ── Read with fallback ──

  async loadAll() {
    if (!this.ready) return this._loadLocal();

    try {
      const [wsRes, cardsRes, chatsRes, settingsRes] = await Promise.all([
        this._fetchWithLimit('workspaces'),
        this._fetchWithLimit('cards'),
        this._fetchWithLimit('ai_chats'),
        this._fetchWithLimit('settings'),
      ]);

      const cloudWorkspaces = wsRes.map(d => this._fromCloud(d, 'workspaces'));
      const cloudCards = cardsRes.map(d => this._fromCloud(d, 'cards'));
      const cloudChats = chatsRes.map(d => this._fromCloud(d, 'ai_chats'));
      const cloudSettings = settingsRes.length > 0 ? this._fromCloud(settingsRes[0], 'settings') : null;

      // Merge with local: cloud wins on conflict
      const local = this._loadLocal();
      const workspaces = this._merge(cloudWorkspaces, local.workspaces);
      const cards = this._merge(cloudCards, local.cards);
      const aiChats = this._merge(cloudChats, local.aiChats);

      // Write merged back to local
      wx.setStorageSync('workspaces', workspaces);
      wx.setStorageSync('inspiration_cards', cards);
      wx.setStorageSync('ai_chats', aiChats);

      return {
        workspaces,
        cards,
        aiChats,
        settings: cloudSettings || local.settings,
        isCloud: true,
      };
    } catch (e) {
      console.error('[CloudStorage] cloud load failed, using local:', e);
      return this._loadLocal();
    }
  }

  // ── Write-through ──

  async saveWorkspace(doc) {
    wx.setStorageSync('workspaces', getApp().globalData.workspaces);
    this._upsert('workspaces', doc.id, {
      localId: doc.id,
      name: doc.name,
      icon: doc.icon,
      color: doc.color,
      createdAt: doc.createdAt,
      owner: doc.owner || '',
      members: doc.members || [],
      inviteCode: doc.inviteCode || '',
    });
  }

  async saveCard(doc) {
    wx.setStorageSync('inspiration_cards', getApp().globalData.cards);
    this._upsert('cards', doc.id, {
      localId: doc.id,
      workspaceLocalId: doc.workspaceId,
      content: doc.content,
      title: doc.title,
      keywords: doc.keywords || [],
      emotionTag: doc.emotionTag || '',
      color: doc.color,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      isFavorite: doc.isFavorite,
      isTemp: doc.isTemp,
      relatedIds: doc.relatedIds || [],
      agentRecommendIds: doc.agentRecommendIds || [],
      agentScores: doc.agentScores || {},
      hasAiChat: doc.hasAiChat,
    });
  }

  async saveChat(doc) {
    wx.setStorageSync('ai_chats', getApp().globalData.aiChats);
    this._upsert('ai_chats', doc.id, {
      localId: doc.id,
      cardLocalId: doc.cardId,
      title: doc.title,
      createdAt: doc.createdAt,
      messages: doc.messages,
    });
  }

  async saveSettings(settingsObj) {
    wx.setStorageSync('app_settings', settingsObj);
    this._upsertSettings(settingsObj);
  }

  // ── Delete ──

  async deleteWorkspaces(ids) {
    this._batchDelete('workspaces', ids);
  }

  async deleteCards(ids) {
    this._batchDelete('cards', ids);
  }

  async deleteChats(ids) {
    this._batchDelete('ai_chats', ids);
  }

  // ── Migration ──

  async migrateLocalToCloud({ workspaces, cards, aiChats, settings }) {
    let migrated = 0;
    let failed = 0;

    for (const ws of workspaces) {
      try {
        await this._upsertSync('workspaces', ws.id, {
          localId: ws.id,
          name: ws.name,
          icon: ws.icon,
          color: ws.color,
          createdAt: ws.createdAt,
          owner: ws.owner || '',
          members: ws.members || [],
          inviteCode: ws.inviteCode || '',
        });
        migrated++;
      } catch (e) { failed++; }
    }

    // Cards in batches of 10
    for (let i = 0; i < cards.length; i += 10) {
      const batch = cards.slice(i, i + 10);
      const results = await Promise.allSettled(batch.map(card =>
        this._upsertSync('cards', card.id, {
          localId: card.id,
          workspaceLocalId: card.workspaceId,
          content: card.content,
          title: card.title,
          keywords: card.keywords || [],
          emotionTag: card.emotionTag || '',
          color: card.color,
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
          isFavorite: card.isFavorite,
          isTemp: card.isTemp,
          relatedIds: card.relatedIds || [],
          agentRecommendIds: card.agentRecommendIds || [],
          agentScores: card.agentScores || {},
          hasAiChat: card.hasAiChat,
        })
      ));
      results.forEach(r => r.status === 'fulfilled' ? migrated++ : failed++);
    }

    for (const chat of aiChats) {
      try {
        await this._upsertSync('ai_chats', chat.id, {
          localId: chat.id,
          cardLocalId: chat.cardId,
          title: chat.title,
          createdAt: chat.createdAt,
          messages: chat.messages,
        });
        migrated++;
      } catch (e) { failed++; }
    }

    // Settings: single doc per user
    try {
      await this._upsertSettingsSync(settings);
      migrated++;
    } catch (e) { failed++; }

    return { migrated, failed };
  }

  // ── Internal helpers ──

  _loadLocal() {
    const workspaces = wx.getStorageSync('workspaces') || [];
    const cards = wx.getStorageSync('inspiration_cards') || [];
    const aiChats = wx.getStorageSync('ai_chats') || [];
    let settings = {};
    const stored = wx.getStorageSync('app_settings');
    if (stored) {
      try {
        settings = typeof stored === 'string' ? JSON.parse(stored) : stored;
      } catch (_e) { settings = {}; }
    }
    return { workspaces, cards, aiChats, settings, isCloud: false };
  }

  async _fetchWithLimit(collection) {
    const col = this.collections[collection];
    // Cloud DB limit is 20 per query, loop if needed
    let all = [];
    let offset = 0;
    const batchSize = 20;
    while (true) {
      const res = await Promise.race([
        col.skip(offset).limit(batchSize).get(),
        this._timeout(CLOUD_TIMEOUT),
      ]);
      if (!res || !res.data || res.data.length === 0) break;
      all = all.concat(res.data);
      if (res.data.length < batchSize) break;
      offset += batchSize;
    }
    return all;
  }

  _timeout(ms) {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Cloud timeout')), ms)
    );
  }

  // Fire-and-forget upsert (async, errors swallowed)
  _upsert(collection, localId, data) {
    if (!this.ready) return;
    const col = this.collections[collection];
    col.where({ localId }).get().then(res => {
      if (res.data.length > 0) {
        return col.doc(res.data[0]._id).update({ data });
      } else {
        return col.add({ data });
      }
    }).catch(e => {
      console.warn('[CloudStorage] upsert failed:', collection, localId, e);
    });
  }

  // Sync upsert for migration (awaits result)
  async _upsertSync(collection, localId, data) {
    const col = this.collections[collection];
    const res = await col.where({ localId }).get();
    if (res.data.length > 0) {
      await col.doc(res.data[0]._id).update({ data });
    } else {
      await col.add({ data });
    }
  }

  // Fire-and-forget settings upsert
  _upsertSettings(settingsObj) {
    if (!this.ready) return;
    const col = this.collections.settings;
    col.limit(1).get().then(res => {
      const data = { ...settingsObj };
      if (res.data.length > 0) {
        return col.doc(res.data[0]._id).update({ data });
      } else {
        return col.add({ data });
      }
    }).catch(e => {
      console.warn('[CloudStorage] settings upsert failed:', e);
    });
  }

  // Sync settings upsert for migration
  async _upsertSettingsSync(settingsObj) {
    const col = this.collections.settings;
    const res = await col.limit(1).get();
    const data = { ...settingsObj };
    if (res.data.length > 0) {
      await col.doc(res.data[0]._id).update({ data });
    } else {
      await col.add({ data });
    }
  }

  // Fire-and-forget batch delete
  _batchDelete(collection, localIds) {
    if (!this.ready || localIds.length === 0) return;
    const col = this.collections[collection];
    // Delete in batches of 20
    for (let i = 0; i < localIds.length; i += 20) {
      const batch = localIds.slice(i, i + 20);
      batch.forEach(localId => {
        col.where({ localId }).get().then(res => {
          if (res.data.length > 0) {
            return col.doc(res.data[0]._id).remove();
          }
        }).catch(e => {
          console.warn('[CloudStorage] delete failed:', collection, localId, e);
        });
      });
    }
  }

  // Convert cloud doc back to local format
  _fromCloud(doc, collection) {
    if (collection === 'workspaces') {
      return {
        id: doc.localId,
        name: doc.name,
        icon: doc.icon,
        color: doc.color,
        createdAt: doc.createdAt,
        owner: doc.owner || '',
        members: doc.members || [],
        inviteCode: doc.inviteCode || '',
      };
    }
    if (collection === 'cards') {
      return {
        id: doc.localId,
        workspaceId: doc.workspaceLocalId,
        content: doc.content,
        title: doc.title,
        keywords: doc.keywords || [],
        emotionTag: doc.emotionTag || '',
        color: doc.color,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        isFavorite: doc.isFavorite,
        isTemp: doc.isTemp,
        relatedIds: doc.relatedIds || [],
        agentRecommendIds: doc.agentRecommendIds || [],
        agentScores: doc.agentScores || {},
        hasAiChat: doc.hasAiChat,
      };
    }
    if (collection === 'ai_chats') {
      return {
        id: doc.localId,
        cardId: doc.cardLocalId,
        title: doc.title,
        createdAt: doc.createdAt,
        messages: doc.messages,
      };
    }
    if (collection === 'settings') {
      const s = { ...doc };
      delete s._id;
      delete s._openid;
      return s;
    }
    return doc;
  }

  // Merge cloud + local arrays by id. Cloud wins on conflict.
  _merge(cloudArr, localArr) {
    const map = {};
    localArr.forEach(item => { map[item.id] = item; });
    cloudArr.forEach(item => { map[item.id] = item; }); // cloud overwrites local
    return Object.values(map);
  }
}

module.exports = CloudStorage;

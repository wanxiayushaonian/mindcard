/**
 * Card service: CRUD, sync, keyword utilities.
 * Extracted from app.js to reduce God Object.
 */

const api = require('../utils/api');
const helpers = require('../utils/helpers');

function createCardService(app) {
  const store = app;

  async function loadFromApi() {
    const wsId = store.globalData.currentWorkspaceId;
    if (!wsId || wsId.indexOf('ws_') === 0) return;

    try {
      const allCards = [];
      let cursor = null;
      const limit = 50;
      do {
        const resp = await api.cardsApi.list(wsId, cursor, limit);
        const items = Array.isArray(resp) ? resp : (resp.items || []);
        allCards.push(...items);
        cursor = (resp && resp.next_cursor) || null;
      } while (cursor);

      store.globalData.cards = allCards.map((c) => {
        const raw = (c.content || '').replace(/\n/g, ' ').replace(/\r/g, '');
        return {
          id: c.id,
          workspaceId: c.workspace_id,
          title: c.title || '',
          content: c.content || '',
          preview: raw.length > 80 ? raw.slice(0, 80) + '...' : raw,
          keywords: c.keywords || [],
          color: c.color || '#B8D4E3',
          emotionTag: c.emotion_tag || '',
          isTemp: c.is_temp !== undefined ? c.is_temp : true,
          parentCardIds: c.parent_card_ids || [],
          createdAt: helpers.formatApiTime(c.created_at),
          updatedAt: helpers.formatApiTime(c.updated_at),
          isFavorite: c.is_favorite || false,
          relatedIds: (c.relations || []).map((r) => r.related_card_id),
          agentRecommendIds: [],
          agentScores: {},
          hasAiChat: false,
        };
      });
      wx.setStorageSync('inspiration_cards', store.globalData.cards);
    } catch (e) {
      console.error('[API] loadCards failed:', e);
      loadFromStorage();
    }
  }

  function loadFromStorage() {
    const stored = wx.getStorageSync('inspiration_cards');
    if (stored && stored.length > 0) {
      store.globalData.cards = stored;
    } else {
      const { mockCards } = require('../utils/mock-data');
      const wsId = store.globalData.currentWorkspaceId || 'ws_default';
      store.globalData.cards = mockCards.map((c) => ({ ...c, workspaceId: c.workspaceId || wsId }));
      wx.setStorageSync('inspiration_cards', store.globalData.cards);
    }
  }

  function getById(id) {
    return store.globalData.cards.find((c) => c.id === id);
  }

  function getWorkspaceCards() {
    const wsId = store.globalData.currentWorkspaceId;
    return store.globalData.cards.filter((c) => c.workspaceId === wsId);
  }

  async function update(id, updates) {
    const idx = store.globalData.cards.findIndex((c) => c.id === id);
    if (idx !== -1) {
      const patched = { ...updates };
      if (updates.content !== undefined) {
        const raw = updates.content.replace(/\n/g, ' ').replace(/\r/g, '');
        patched.preview = raw.length > 80 ? raw.slice(0, 80) + '...' : raw;
      }
      store.globalData.cards[idx] = {
        ...store.globalData.cards[idx],
        ...patched,
        updatedAt: helpers.formatTime(new Date()),
      };
      wx.setStorageSync('inspiration_cards', store.globalData.cards);
    }

    if (id.indexOf('card_') === 0) return;

    const apiPayload = {};
    const fieldMap = {
      title: 'title',
      content: 'content',
      keywords: 'keywords',
      color: 'color',
      isFavorite: 'is_favorite',
      isTemp: 'is_temp',
      emotionTag: 'emotion_tag',
      parentCardIds: 'parent_card_ids',
    };
    Object.keys(fieldMap).forEach((key) => {
      if (updates[key] !== undefined) apiPayload[fieldMap[key]] = updates[key];
    });

    if (Object.keys(apiPayload).length > 0) {
      try {
        await api.cardsApi.update(id, apiPayload);
      } catch (e) {
        console.error('[API] updateCard failed:', e);
      }
    }
  }

  async function add(card) {
    const wsId = store.globalData.currentWorkspaceId;
    const raw = (card.content || '').replace(/\n/g, ' ').replace(/\r/g, '');
    const newCard = {
      ...card,
      id: 'card_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      workspaceId: wsId,
      preview: raw.length > 80 ? raw.slice(0, 80) + '...' : raw,
      keywords: card.keywords || [],
      emotionTag: card.emotionTag || '',
      isTemp: card.isTemp !== undefined ? card.isTemp : true,
      parentCardIds: card.parentCardIds || [],
      createdAt: helpers.formatTime(new Date()),
      updatedAt: null,
      isFavorite: false,
      relatedIds: [],
      agentRecommendIds: [],
      agentScores: {},
      hasAiChat: false,
    };

    store.globalData.cards.unshift(newCard);
    wx.setStorageSync('inspiration_cards', store.globalData.cards);

    try {
      const created = await api.cardsApi.create({
        local_id: newCard.id,
        workspace_id: wsId,
        title: newCard.title || '',
        content: newCard.content || '',
        keywords: newCard.keywords,
        color: newCard.color || '#B8D4E3',
        emotion_tag: newCard.emotionTag || '',
        is_temp: newCard.isTemp,
        parent_card_ids: newCard.parentCardIds,
      });
      if (created && created.id) {
        newCard.id = created.id;
        store.globalData.cards[0] = newCard;
        wx.setStorageSync('inspiration_cards', store.globalData.cards);
      }
    } catch (e) {
      console.error('[API] addCard failed, saved locally:', e);
    }

    // Background AI: auto-extract keywords + title
    const autoExtract = store.getSetting ? store.getSetting('autoExtract', true) : true;
    if ((newCard.content || '').trim()) {
      if (autoExtract && newCard.keywords.length === 0) {
        api.aiApi.extractKeywords(newCard.content)
          .then((res) => {
            if (res.keywords && res.keywords.length > 0) update(newCard.id, { keywords: res.keywords });
          })
          .catch(() => {});
      }
      if (!newCard.title) {
        api.aiApi.generateTitle(newCard.content)
          .then((res) => {
            if (res.title && res.title.trim()) update(newCard.id, { title: res.title.trim() });
          })
          .catch(() => {});
      }
    }
    return newCard;
  }

  async function removeMany(ids) {
    const idSet = new Set(ids);
    store.globalData.cards = store.globalData.cards
      .filter((c) => !idSet.has(c.id))
      .map((card) => ({
        ...card,
        relatedIds: card.relatedIds.filter((rid) => !idSet.has(rid)),
        agentRecommendIds: card.agentRecommendIds.filter((rid) => !idSet.has(rid)),
      }));
    store.globalData.aiChats = store.globalData.aiChats.filter((c) => !idSet.has(c.cardId));
    wx.setStorageSync('inspiration_cards', store.globalData.cards);
    wx.setStorageSync('ai_chats', store.globalData.aiChats);

    const serverIds = ids.filter((id) => id.indexOf('card_') !== 0);
    if (serverIds.length > 0) {
      try {
        await api.del('/api/cards/batch', { ids: serverIds });
      } catch (e) {
        for (const sid of serverIds) {
          try {
            await api.cardsApi.delete(sid);
          } catch (e2) {
            console.error('[API] deleteCard failed for ' + sid + ':', e2);
          }
        }
      }
    }
  }

  function remove(id) {
    return removeMany([id]);
  }

  // ── Relations ──

  async function loadRelations(id) {
    if (!id || id === 'undefined' || id.indexOf('card_') === 0) return [];
    try {
      return await api.cardsApi.relations(id);
    } catch (e) {
      console.error('[API] loadRelations failed:', e);
      return [];
    }
  }

  async function addRelation(id, relatedId, relationType) {
    try {
      await api.cardsApi.addRelation(id, { related_card_id: relatedId, relation_type: relationType || 'related' });
      const card = getById(id);
      if (card && card.relatedIds.indexOf(relatedId) === -1) {
        card.relatedIds.push(relatedId);
        wx.setStorageSync('inspiration_cards', store.globalData.cards);
      }
    } catch (e) {
      console.error('[API] addRelation failed:', e);
      throw e;
    }
  }

  async function removeRelation(id, relatedId) {
    try {
      await api.cardsApi.removeRelation(id, relatedId);
      const card = getById(id);
      if (card) {
        card.relatedIds = card.relatedIds.filter((rid) => rid !== relatedId);
        wx.setStorageSync('inspiration_cards', store.globalData.cards);
      }
    } catch (e) {
      console.error('[API] removeRelation failed:', e);
      throw e;
    }
  }

  // ── Keyword utilities ──

  function getKeywordRegistry() {
    const cards = getWorkspaceCards();
    const registry = {};
    cards.forEach((c) => {
      (c.keywords || []).forEach((kw) => {
        registry[kw] = (registry[kw] || 0) + 1;
      });
    });
    return Object.entries(registry)
      .sort((a, b) => b[1] - a[1])
      .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});
  }

  function getTopKeywords(limit) {
    return Object.keys(getKeywordRegistry()).slice(0, limit || 15);
  }

  return {
    loadFromApi,
    loadFromStorage,
    getById,
    getWorkspaceCards,
    update,
    add,
    remove,
    removeMany,
    loadRelations,
    addRelation,
    removeRelation,
    getKeywordRegistry,
    getTopKeywords,
  };
}

module.exports = { createCardService };

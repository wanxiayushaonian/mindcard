// pages/category/category.js
const { polishText } = require('../../utils/deepseek');

Page({
  data: {
    keywordCategories: [],
    activeCategory: 'all',
    cards: [],
    displayCards: [],
    allCount: 0,
    tempCount: 0,
    favCount: 0,
    categoryCounts: {},
    batchMode: false,
    checkedIds: [],
  },

  onShow() {
    this.loadCards();
  },

  loadCards() {
    const app = getApp();
    const cards = app.getWorkspaceCards();

    const registry = app.getKeywordRegistry();
    const keywordCategories = Object.keys(registry).slice(0, 15);
    const categoryCounts = {};
    keywordCategories.forEach(kw => {
      categoryCounts[kw] = cards.filter(c => (c.keywords || []).indexOf(kw) !== -1).length;
    });

    this.setData({
      cards,
      allCount: cards.length,
      tempCount: cards.filter(c => c.isTemp).length,
      favCount: cards.filter(c => c.isFavorite).length,
      keywordCategories,
      categoryCounts,
    });

    this.filterCards(this.data.activeCategory);
  },

  onCategorySelect(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ activeCategory: key, checkedIds: [] });
    this.filterCards(key);
  },

  filterCards(key) {
    const { cards } = this.data;
    let filtered;

    if (key === 'all') {
      filtered = [...cards];
    } else if (key === 'temp') {
      filtered = cards.filter(c => c.isTemp);
    } else if (key === 'fav') {
      filtered = cards.filter(c => c.isFavorite);
    } else {
      filtered = cards.filter(c => (c.keywords || []).indexOf(key) !== -1);
    }

    this.setData({ displayCards: filtered });
  },

  onCardTap(e) {
    if (this.data.batchMode) return;
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/card-detail/card-detail?id=${id}`,
    });
  },

  onBatchMode() {
    this.setData({
      batchMode: !this.data.batchMode,
      checkedIds: [],
    });
  },

  onCheckCard(e) {
    const id = e.currentTarget.dataset.id;
    const { checkedIds } = this.data;
    const idx = checkedIds.indexOf(id);
    if (idx > -1) {
      this.setData({ checkedIds: checkedIds.filter(cid => cid !== id) });
    } else {
      this.setData({ checkedIds: [...checkedIds, id] });
    }
  },

  onBatchArchive() {
    const app = getApp();
    const ids = this.data.checkedIds;
    let updated = false;
    for (var i = 0; i < ids.length; i++) {
      var card = app.getCardById(ids[i]);
      if (card && card.isTemp) {
        app.updateCard(ids[i], { isTemp: false });
        updated = true;
      }
    }
    wx.showToast({ title: '归档成功', icon: 'success' });
    this.setData({ batchMode: false, checkedIds: [] });
    this.loadCards();
  },

  onBatchAi() {
    const { checkedIds } = this.data;
    if (checkedIds.length === 0) {
      wx.showToast({ title: '请先选择卡片', icon: 'none' }); return;
    }
    wx.showToast({ title: '批量AI优化中...', icon: 'loading', duration: 5000 });

    const app = getApp();
    let done = 0;
    const total = checkedIds.length;

    checkedIds.forEach(id => {
      const card = app.getCardById(id);
      if (!card) { done++; return; }
      polishText({
        text: card.content,
        onComplete: (result) => {
          app.updateCard(id, { content: result });
          done++;
          if (done >= total) {
            wx.showToast({ title: '优化完成', icon: 'success' });
            this.setData({ batchMode: false, checkedIds: [] });
            this.loadCards();
          }
        },
        onError: () => {
          done++;
          if (done >= total) {
            wx.showToast({ title: '部分优化失败', icon: 'none' });
            this.setData({ batchMode: false, checkedIds: [] });
            this.loadCards();
          }
        },
      });
    });
  },

  onBatchDelete() {
    const app = getApp();
    app.deleteCards(this.data.checkedIds);
    wx.showToast({ title: '删除成功', icon: 'success' });
    this.setData({ batchMode: false, checkedIds: [] });
    this.loadCards();
  },
});

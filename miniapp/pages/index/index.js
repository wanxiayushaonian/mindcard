// pages/index/index.js
var api = require('../../utils/api');

Page({
  data: {
    allKeywords: [],
    selectedTag: '全部',
    cards: [],
    filteredCards: [],
    leftCards: [],
    rightCards: [],
    favCount: 0,
    showFlashModal: false,
    showWalkModal: false,
    flashContent: '',
    flashKeywords: [],
    flashKeywordInput: '',
    flashColor: '#D4B5D0',
    flashSuggestedKeywords: [],
    walkCard: null,
    refreshing: false,
    workspaceName: '',
  },

  onLoad() {
    const ws = getApp().getCurrentWorkspace();
    this.setData({ workspaceName: ws.name });
    this.loadCards();
    this._setupShake();
  },

  onShow() {
    const ws = getApp().getCurrentWorkspace();
    this.setData({ workspaceName: ws.name });
    this.loadCards();
  },

  onUnload() {
    wx.stopAccelerometer();
  },

  onNavigateBack() {
    wx.navigateBack({ delta: 1 });
  },

  _setupShake() {
    let lastTime = 0;
    let lastX = 0, lastY = 0, lastZ = 0;
    wx.startAccelerometer({ interval: 'normal' });
    wx.onAccelerometerChange((res) => {
      const now = Date.now();
      if (now - lastTime < 500) return;
      const app = getApp();
      const sensitivity = app.getSetting('walkSensitivity', '高');
      const threshold = sensitivity === '高' ? 2.5 : sensitivity === '低' ? 5.0 : 3.5;
      const diff = Math.abs(res.x - lastX) + Math.abs(res.y - lastY) + Math.abs(res.z - lastZ);
      if (diff > threshold) {
        lastTime = now;
        this.onWalk();
      }
      lastX = res.x; lastY = res.y; lastZ = res.z;
    });
  },

  loadCards() {
    const app = getApp();
    const cards = app.getWorkspaceCards();
    const favCount = cards.filter(c => c.isFavorite).length;
    const allKeywords = app.getTopKeywords(10);
    const flashColor = app.getSetting('defaultColor', '#D4B5D0');
    this.setData({ cards, favCount, allKeywords, flashColor });
    this.filterCards(this.data.selectedTag);
  },

  filterCards(tag) {
    const { cards } = this.data;
    let filtered;
    if (tag === '全部') filtered = [...cards];
    else if (tag === '临时灵感箱') filtered = cards.filter(c => c.isTemp);
    else if (tag === '收藏') filtered = cards.filter(c => c.isFavorite);
    else filtered = cards.filter(c => (c.keywords || []).indexOf(tag) !== -1);

    const leftCards = [];
    const rightCards = [];
    filtered.forEach((card, i) => {
      (i % 2 === 0 ? leftCards : rightCards).push(card);
    });
    this.setData({ selectedTag: tag, filteredCards: filtered, leftCards, rightCards });
  },

  onTagSelect(e) { this.filterCards(e.currentTarget.dataset.tag); },

  onCardTap(e) {
    wx.navigateTo({ url: `/pages/card-detail/card-detail?id=${e.currentTarget.dataset.id}` });
  },

  onCardLongPress(e) {
    const id = e.currentTarget.dataset.id;
    const app = getApp();
    const card = app.getCardById(id);
    if (!card) return;
    wx.showActionSheet({
      itemList: [card.isFavorite ? '取消收藏' : '收藏', '删除'],
      success: (res) => {
        if (res.tapIndex === 0) {
          app.updateCard(id, { isFavorite: !card.isFavorite });
          wx.showToast({ title: card.isFavorite ? '取消收藏' : '收藏成功', icon: 'success' });
          this.loadCards();
        } else if (res.tapIndex === 1) {
          app.deleteCard(id);
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadCards();
        }
      },
    });
  },

  onSearch() {
    wx.navigateTo({ url: '/pages/search/search' });
  },

  onInsights() {
    wx.navigateTo({ url: '/pages/insights/insights' });
  },

  onWalk() {
    const { cards } = this.data;
    if (cards.length === 0) {
      wx.showToast({ title: '还没有灵感卡片', icon: 'none' });
      return;
    }
    this.setData({ showWalkModal: true, walkCard: cards[Math.floor(Math.random() * cards.length)] });
  },

  onWalkClose() { this.setData({ showWalkModal: false, walkCard: null }); },
  onWalkRefresh() {
    const { cards } = this.data;
    this.setData({ walkCard: cards[Math.floor(Math.random() * cards.length)] });
  },
  onWalkDetail() {
    const { walkCard } = this.data;
    if (walkCard) {
      this.setData({ showWalkModal: false, walkCard: null });
      wx.navigateTo({ url: `/pages/card-detail/card-detail?id=${walkCard.id}` });
    }
  },

  onProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  onNetwork() {
    wx.navigateTo({ url: '/pages/network/network' });
  },

  onMore() {
    var self = this;
    wx.showActionSheet({
      itemList: ['关联网络', '洞察', '设置'],
      success: function (res) {
        if (res.tapIndex === 0) self.onNetwork();
        else if (res.tapIndex === 1) self.onInsights();
        else if (res.tapIndex === 2) self.onProfile();
      },
    });
  },

  onCategory() {
    wx.navigateTo({ url: '/pages/category/category' });
  },

  onRefresh() {
    this.setData({ refreshing: true });
    this.loadCards();
    setTimeout(() => { this.setData({ refreshing: false }); }, 600);
  },

  // Flash Note Modal
  onFabTap() {
    const suggestions = getApp().getTopKeywords(10);
    this.setData({
      showFlashModal: true,
      flashSuggestedKeywords: suggestions,
    });
  },

  onStopPropagation() {},

  onModalClose() {
    this.setData({
      showFlashModal: false,
      flashContent: '',
      flashKeywords: [],
      flashKeywordInput: '',
    });
  },

  onFlashInput(e) { this.setData({ flashContent: e.detail.value }); },

  onFlashKeywordInput(e) {
    this.setData({ flashKeywordInput: e.detail.value });
  },

  onFlashAddKeyword() {
    const input = (this.data.flashKeywordInput || '').trim();
    if (!input) return;
    if (this.data.flashKeywords.indexOf(input) !== -1) return;
    if (this.data.flashKeywords.length >= 5) return;
    this.setData({
      flashKeywords: [...this.data.flashKeywords, input],
      flashKeywordInput: '',
    });
  },

  onFlashRemoveKeyword(e) {
    const kw = e.currentTarget.dataset.kw;
    this.setData({ flashKeywords: this.data.flashKeywords.filter(k => k !== kw) });
  },

  onFlashSuggestKeyword(e) {
    const kw = e.currentTarget.dataset.kw;
    if (this.data.flashKeywords.indexOf(kw) !== -1) return;
    if (this.data.flashKeywords.length >= 5) return;
    this.setData({ flashKeywords: [...this.data.flashKeywords, kw] });
  },

  onAiPolish() {
    if (!this.data.flashContent.trim()) {
      wx.showToast({ title: '请先输入内容', icon: 'none' }); return;
    }
    wx.showToast({ title: 'AI润色中...', icon: 'loading', duration: 2000 });
    api.post('/api/ai/polish', { content: this.data.flashContent })
      .then(function (res) {
        this.setData({ flashContent: res.text });
        wx.showToast({ title: '润色完成', icon: 'success' });
      }.bind(this))
      .catch(function (err) {
        wx.showToast({ title: err.message || '润色失败', icon: 'none' });
      });
  },

  onAiSupplement() {
    if (!this.data.flashContent.trim()) {
      wx.showToast({ title: '请先输入内容', icon: 'none' }); return;
    }
    wx.showToast({ title: 'AI补充中...', icon: 'loading', duration: 2000 });
    api.post('/api/ai/supplement', { content: this.data.flashContent })
      .then(function (res) {
        this.setData({ flashContent: this.data.flashContent + '\n\n' + res.text });
        wx.showToast({ title: '补充完成', icon: 'success' });
      }.bind(this))
      .catch(function (err) {
        wx.showToast({ title: err.message || '补充失败', icon: 'none' });
      });
  },

  onFlashSave() {
    const { flashContent, flashKeywords, flashColor } = this.data;
    if (!flashContent.trim()) {
      wx.showToast({ title: '请输入灵感内容', icon: 'none' }); return;
    }
    getApp().addCard({
      content: flashContent.trim(),
      title: '',
      keywords: flashKeywords,
      color: flashColor,
    });
    this.setData({
      showFlashModal: false,
      flashContent: '',
      flashKeywords: [],
      flashKeywordInput: '',
    });
    wx.showToast({ title: '保存成功', icon: 'success' });
    this.loadCards();
  },
});

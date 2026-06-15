// pages/index/index.js
const api = require('../../utils/api');

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
    unreadCount: 0,
  },

  _aiLoading: false,

  onLoad() {
    // C7: guard against null workspace on fresh install
    const ws = getApp().getCurrentWorkspace();
    this.setData({ workspaceName: ws ? ws.name : '' });
    this.loadCards();
    this._setupShake();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    const ws = getApp().getCurrentWorkspace();
    this.setData({ workspaceName: ws ? ws.name : '' });
    this.loadCards();
    this._loadUnreadCount();
  },

  _loadUnreadCount() {
    const app = getApp();
    app.loadUnreadCount().then((count) => {
      this.setData({ unreadCount: count });
    }).catch(() => {});
  },

  // M6: await notification call and handle failure
  async onBellTap() {
    try {
      await getApp().markAllNotificationsRead();
      this.setData({ unreadCount: 0 });
      wx.showToast({ title: '已全部已读', icon: 'success' });
    } catch (_e) {
      wx.showToast({ title: '标记已读失败', icon: 'none' });
    }
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
    wx.stopAccelerometer({
      complete: function () {
        wx.startAccelerometer({ interval: 'normal' });
      }
    });
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

    const { leftCards, rightCards } = this._distributeWaterfall(filtered);
    this.setData({ selectedTag: tag, filteredCards: filtered, leftCards, rightCards });
  },

  _distributeWaterfall(cards) {
    const leftCards = [];
    const rightCards = [];
    let leftHeight = 0;
    let rightHeight = 0;

    cards.forEach((card) => {
      const est = this._estimateCardHeight(card);
      if (leftHeight <= rightHeight) {
        leftCards.push(card);
        leftHeight += est;
      } else {
        rightCards.push(card);
        rightHeight += est;
      }
    });
    return { leftCards, rightCards };
  },

  _estimateCardHeight(card) {
    const keywordH = (card.keywords && card.keywords.length > 0) ? 50 : 0;
    const titleH = card.title ? 42 : 0;
    const previewLen = (card.preview || '').length;
    const contentH = Math.ceil(previewLen / 20) * 38;
    const footerH = 50;
    const padding = 48;
    return keywordH + titleH + contentH + footerH + padding;
  },

  onTagSelect(e) { this.filterCards(e.currentTarget.dataset.tag); },

  onCardTap(e) {
    const id = e.detail ? e.detail.id : e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/card-detail/card-detail?id=${id}` });
  },

  onCardLongPress(e) {
    const id = e.detail ? e.detail.id : e.currentTarget.dataset.id;
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

  // M1: guard against concurrent AI calls
  onAiPolish() {
    if (this._aiLoading) return;
    if (!this.data.flashContent.trim()) {
      wx.showToast({ title: '请先输入内容', icon: 'none' }); return;
    }
    this._aiLoading = true;
    wx.showToast({ title: 'AI润色中...', icon: 'loading', duration: 2000 });
    api.aiApi.polish(this.data.flashContent)
      .then((res) => {
        this.setData({ flashContent: res.text });
        wx.showToast({ title: '润色完成', icon: 'success' });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '润色失败', icon: 'none' });
      })
      .finally(() => { this._aiLoading = false; });
  },

  // M1: guard against concurrent AI calls
  onAiSupplement() {
    if (this._aiLoading) return;
    if (!this.data.flashContent.trim()) {
      wx.showToast({ title: '请先输入内容', icon: 'none' }); return;
    }
    this._aiLoading = true;
    wx.showToast({ title: 'AI补充中...', icon: 'loading', duration: 2000 });
    api.aiApi.supplement(this.data.flashContent)
      .then((res) => {
        this.setData({ flashContent: `${this.data.flashContent}\n\n${res.text}` });
        wx.showToast({ title: '补充完成', icon: 'success' });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '补充失败', icon: 'none' });
      })
      .finally(() => { this._aiLoading = false; });
  },

  // C4: await addCard and surface errors
  async onFlashSave() {
    const { flashContent, flashKeywords, flashColor } = this.data;
    if (!flashContent.trim()) {
      wx.showToast({ title: '请输入灵感内容', icon: 'none' }); return;
    }
    try {
      await getApp().addCard({
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
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    }
  },
});

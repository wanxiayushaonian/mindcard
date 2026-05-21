// pages/card-edit/card-edit.js
const { CARD_COLORS } = require('../../utils/mock-data');
const { polishText, supplementText, generateFromPrompt, generateTitle, extractKeywords } = require('../../utils/deepseek');

Page({
  data: {
    isEdit: false,
    cardId: '',
    title: '',
    content: '',
    keywords: [],
    keywordInput: '',
    suggestedKeywords: [],
    selectedColor: '#D4B5D0',
    colors: CARD_COLORS,
  },

  onLoad(options) {
    if (options.id) {
      this.loadCard(options.id);
    }
    this._loadSuggestions();
  },

  onShow() {
    if (this.data.cardId && !this.data.isEdit) {
      this.loadCard(this.data.cardId);
    }
    this._loadSuggestions();
  },

  loadCard(id) {
    const card = getApp().getCardById(id);
    if (card) {
      this.setData({
        isEdit: true,
        cardId: id,
        title: card.title || '',
        content: card.content || '',
        keywords: card.keywords || [],
        selectedColor: card.color || '#D4B5D0',
      });
    }
  },

  _loadSuggestions() {
    const topKw = getApp().getTopKeywords(15);
    const current = this.data.keywords || [];
    const suggestions = topKw.filter(kw => current.indexOf(kw) === -1);
    this.setData({ suggestedKeywords: suggestions });
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value });
  },

  onKeywordInput(e) {
    this.setData({ keywordInput: e.detail.value });
  },

  onAddKeyword() {
    const input = (this.data.keywordInput || '').trim();
    if (!input) return;
    if (this.data.keywords.indexOf(input) !== -1) {
      wx.showToast({ title: '已存在', icon: 'none' });
      return;
    }
    if (this.data.keywords.length >= 5) {
      wx.showToast({ title: '最多5个关键字', icon: 'none' });
      return;
    }
    const keywords = [...this.data.keywords, input];
    this.setData({ keywords, keywordInput: '' });
    this._updateSuggestions(keywords);
  },

  onRemoveKeyword(e) {
    const kw = e.currentTarget.dataset.kw;
    const keywords = this.data.keywords.filter(k => k !== kw);
    this.setData({ keywords });
    this._updateSuggestions(keywords);
  },

  onSuggestKeyword(e) {
    const kw = e.currentTarget.dataset.kw;
    if (this.data.keywords.indexOf(kw) !== -1) return;
    if (this.data.keywords.length >= 5) {
      wx.showToast({ title: '最多5个关键字', icon: 'none' });
      return;
    }
    const keywords = [...this.data.keywords, kw];
    this.setData({ keywords });
    this._updateSuggestions(keywords);
  },

  _updateSuggestions(keywords) {
    const topKw = getApp().getTopKeywords(15);
    const suggestions = topKw.filter(kw => keywords.indexOf(kw) === -1);
    this.setData({ suggestedKeywords: suggestions });
  },

  onColorSelect(e) {
    this.setData({ selectedColor: e.currentTarget.dataset.color });
  },

  onAiTitle() {
    const text = this.data.content || this.data.title;
    if (!text || !text.trim()) {
      wx.showToast({ title: '请先输入内容', icon: 'none' }); return;
    }
    wx.showToast({ title: '提炼标题中...', icon: 'loading', duration: 3000 });
    generateTitle(text).then(title => {
      this.setData({ title: title.trim() });
      wx.showToast({ title: '已生成', icon: 'success' });
    }).catch(err => {
      wx.showToast({ title: err.message || '生成失败', icon: 'none' });
    });
  },

  onAiKeywords() {
    const text = this.data.content;
    if (!text || !text.trim()) {
      wx.showToast({ title: '请先输入内容', icon: 'none' }); return;
    }
    wx.showToast({ title: '提取关键字中...', icon: 'loading', duration: 3000 });
    extractKeywords(text).then(kws => {
      if (kws.length === 0) {
        wx.showToast({ title: '未提取到关键字', icon: 'none' });
        return;
      }
      this.setData({ keywords: kws });
      this._updateSuggestions(kws);
      wx.showToast({ title: '已提取 ' + kws.length + ' 个关键字', icon: 'success' });
    }).catch(err => {
      wx.showToast({ title: err.message || '提取失败', icon: 'none' });
    });
  },

  onSave() {
    const { title, content, keywords, selectedColor, isEdit, cardId } = this.data;
    if (!content.trim()) {
      wx.showToast({ title: '请输入灵感内容', icon: 'none' });
      return;
    }

    const app = getApp();
    if (isEdit) {
      app.updateCard(cardId, {
        title: title.trim(),
        content: content.trim(),
        keywords: keywords,
        color: selectedColor,
      });
    } else {
      app.addCard({
        title: title.trim(),
        content: content.trim(),
        keywords: keywords,
        color: selectedColor,
      });
    }

    wx.showToast({ title: '保存成功', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 800);
  },

  onAiGenerate() {
    const prompt = this.data.title || this.data.content || '帮我生成一段关于产品创新的灵感思路';
    wx.showToast({ title: 'AI生成中...', icon: 'loading', duration: 2000 });
    generateFromPrompt({
      prompt,
      onComplete: (result) => {
        this.setData({ content: result });
        wx.showToast({ title: '生成完成', icon: 'success' });
      },
      onError: (err) => {
        wx.showToast({ title: err.message || '生成失败', icon: 'none' });
      },
    });
  },

  onAiPolish() {
    if (!this.data.content.trim()) {
      wx.showToast({ title: '请先输入内容', icon: 'none' }); return;
    }
    wx.showToast({ title: 'AI润色中...', icon: 'loading', duration: 2000 });
    polishText({
      text: this.data.content,
      onComplete: (result) => {
        this.setData({ content: result });
        wx.showToast({ title: '润色完成', icon: 'success' });
      },
      onError: (err) => {
        wx.showToast({ title: err.message || '润色失败', icon: 'none' });
      },
    });
  },

  onAiSupplement() {
    if (!this.data.content.trim()) {
      wx.showToast({ title: '请先输入内容', icon: 'none' }); return;
    }
    wx.showToast({ title: 'AI补充中...', icon: 'loading', duration: 2000 });
    supplementText({
      text: this.data.content,
      onComplete: (result) => {
        this.setData({ content: this.data.content + '\n\n' + result });
        wx.showToast({ title: '补充完成', icon: 'success' });
      },
      onError: (err) => {
        wx.showToast({ title: err.message || '补充失败', icon: 'none' });
      },
    });
  },
});

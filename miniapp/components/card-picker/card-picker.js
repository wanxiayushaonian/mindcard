// components/card-picker/card-picker.js
Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '选择卡片' },
    excludeIds: { type: Array, value: [] },
  },

  data: {
    cards: [],
    filteredCards: [],
    query: '',
  },

  observers: {
    'visible': function (val) {
      if (val) {
        this.loadCards();
      }
    },
  },

  methods: {
    loadCards() {
      const app = getApp();
      const excludeSet = new Set(this.data.excludeIds);
      const cards = app.getWorkspaceCards().filter(c => !excludeSet.has(c.id));
      this.setData({ cards, filteredCards: cards, query: '' });
    },

    onSearch(e) {
      const query = e.detail.value.trim().toLowerCase();
      const { cards } = this.data;
      if (!query) {
        this.setData({ filteredCards: cards, query: '' });
        return;
      }
      const filtered = cards.filter(c =>
        (c.content || '').toLowerCase().includes(query) ||
        (c.title || '').toLowerCase().includes(query) ||
        (c.keywords || []).some(function (k) { return k.toLowerCase().includes(query); })
      );
      this.setData({ filteredCards: filtered, query });
    },

    onSelect(e) {
      const id = e.currentTarget.dataset.id;
      this.triggerEvent('select', { id });
    },

    onClose() {
      this.triggerEvent('close');
    },

    onStopPropagation() {},
  },
});

Component({
  properties: {
    card: {
      type: Object,
      value: {},
    },
  },

  methods: {
    onTap() {
      this.triggerEvent('tap', { id: this.data.card.id });
    },

    onLongPress() {
      this.triggerEvent('longpress', { id: this.data.card.id });
    },
  },
});

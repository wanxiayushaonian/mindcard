Component({
  data: {
    selected: 0,
    list: [
      { key: 'workspace', pagePath: '/pages/workspace/workspace', text: '空间', icon: 'grid', iconActive: 'grid' },
      { key: 'index', pagePath: '/pages/index/index', text: '卡片', icon: 'layers', iconActive: 'layers' },
      { key: 'profile', pagePath: '/pages/profile/profile', text: '我的', icon: 'user', iconActive: 'user' },
    ],
  },

  methods: {
    onSwitch(e) {
      const { index, url } = e.currentTarget.dataset;
      if (this.data.selected === index) return;
      wx.switchTab({ url });
    },
  },
});

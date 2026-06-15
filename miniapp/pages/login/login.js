// pages/login/login.js
const api = require('../../utils/api');

Page({
  data: {
    mode: 'login',
    username: '',
    password: '',
    nickname: '',
    error: '',
    loading: false,
    wxLoading: false,
  },

  onSwitchMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode, error: '' });
  },

  onUsernameInput(e) {
    this.setData({ username: e.detail.value });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value });
  },

  async onSubmit() {
    const username = this.data.username.trim();
    const password = this.data.password;

    if (!username || username.length < 3) {
      this.setData({ error: '用户名至少3个字符' });
      return;
    }
    if (!password || password.length < 6) {
      this.setData({ error: '密码至少6个字符' });
      return;
    }

    this.setData({ loading: true, error: '' });

    try {
      const nickname = this.data.nickname.trim() || username;
      const res = this.data.mode === 'register'
        ? await api.authApi.register(username, password, nickname)
        : await api.authApi.login(username, password);

      api.setToken(res.access_token);
      const app = getApp();
      app._loadUserFromToken();
      await app._loadAllData();

      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack({ delta: 1 });
      } else {
        wx.switchTab({ url: '/pages/index/index' });
      }
    } catch (err) {
      this.setData({ error: err.message || '操作失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onWeChatLogin() {
    this.setData({ wxLoading: true, error: '' });

    wx.login({
      success: (res) => {
        if (!res.code) {
          this.setData({ error: '微信登录失败', wxLoading: false });
          return;
        }
        api.authApi.wechatLogin(res.code)
          .then((data) => {
            api.setToken(data.access_token);
            const app = getApp();
            app._loadUserFromToken();
            return app._loadAllData();
          })
          .then(() => {
            const pages = getCurrentPages();
            if (pages.length > 1) {
              wx.navigateBack({ delta: 1 });
            } else {
              wx.switchTab({ url: '/pages/index/index' });
            }
          })
          .catch((err) => {
            this.setData({ error: err.message || '微信登录失败' });
          })
          .finally(() => {
            this.setData({ wxLoading: false });
          });
      },
      fail: () => {
        this.setData({ error: '微信登录失败', wxLoading: false });
      },
    });
  },
});

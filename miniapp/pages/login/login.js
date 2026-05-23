// pages/login/login.js
var api = require('../../utils/api');

Page({
  data: {
    mode: 'login', // 'login' or 'register'
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

  onSubmit() {
    var username = this.data.username.trim();
    var password = this.data.password;

    // Validate
    if (!username || username.length < 3) {
      this.setData({ error: '用户名至少3个字符' });
      return;
    }
    if (!password || password.length < 6) {
      this.setData({ error: '密码至少6个字符' });
      return;
    }

    this.setData({ loading: true, error: '' });

    var self = this;
    var promise;
    if (this.data.mode === 'register') {
      var nickname = this.data.nickname.trim() || username;
      promise = api.post('/api/auth/register', {
        username: username,
        password: password,
        nickname: nickname,
      });
    } else {
      promise = api.post('/api/auth/login', {
        username: username,
        password: password,
      });
    }

    promise
      .then(function (res) {
        api.setToken(res.access_token);
        var app = getApp();
        app._loadUserFromToken();
        return app._loadAllData();
      })
      .then(function () {
        wx.navigateBack({ delta: 1 });
      })
      .catch(function (err) {
        self.setData({ error: err.message || '操作失败' });
      })
      .finally(function () {
        self.setData({ loading: false });
      });
  },

  onWeChatLogin() {
    this.setData({ wxLoading: true, error: '' });
    var self = this;

    wx.login({
      success: function (res) {
        if (!res.code) {
          self.setData({ error: '微信登录失败', wxLoading: false });
          return;
        }
        api.post('/api/auth/wechat-login', { code: res.code })
          .then(function (data) {
            api.setToken(data.access_token);
            var app = getApp();
            app._loadUserFromToken();
            return app._loadAllData();
          })
          .then(function () {
            wx.navigateBack({ delta: 1 });
          })
          .catch(function (err) {
            self.setData({ error: err.message || '微信登录失败' });
          })
          .finally(function () {
            self.setData({ wxLoading: false });
          });
      },
      fail: function () {
        self.setData({ error: '微信登录失败', wxLoading: false });
      },
    });
  },
});

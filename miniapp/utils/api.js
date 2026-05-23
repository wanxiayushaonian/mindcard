/**
 * FastAPI request utility for miniapp.
 * Replaces wx.cloud with REST API calls.
 */

var config = require('../config.js');
var API_BASE = config.apiBaseUrl;
// ── Token Management ──

function getToken() {
  return wx.getStorageSync('jwt_token') || '';
}

function setToken(token) {
  wx.setStorageSync('jwt_token', token);
}

function clearToken() {
  wx.removeStorageSync('jwt_token');
}

// ── Base Request ──

function request(method, path, data) {
  var url = API_BASE + path;
  return new Promise(function (resolve, reject) {
    var token = getToken();
    wx.request({
      url: url,
      method: method,
      data: data ? JSON.stringify(data) : undefined,
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? 'Bearer ' + token : '',
      },
      success: function (res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else if (res.statusCode === 401) {
          clearToken();
          reject(new Error('登录已过期，请重新登录'));
        } else {
          var detail = (res.data && res.data.detail) || ('HTTP ' + res.statusCode);
          reject(new Error(detail));
        }
      },
      fail: function (err) {
        reject(new Error(err.errMsg || '网络请求失败'));
      },
    });
  });
}

// ── SSE Stream Request ──

function streamRequest(path, body, onChunk, onDone, onError) {
  var token = getToken();
  var fullContent = '';
  var extra = {};

  var task = wx.request({
    url: API_BASE + path,
    method: 'POST',
    enableChunked: true,
    header: {
      'Content-Type': 'application/json',
      'Authorization': token ? 'Bearer ' + token : '',
      'Accept': 'text/event-stream',
    },
    data: JSON.stringify(body),
    success: function () {},
    fail: function (err) {
      if (onError) onError(new Error(err.errMsg || '网络请求失败'));
    },
  });

  if (task && typeof task.onChunkText === 'function') {
    var buffer = '';
    task.onChunkText(function (text) {
      buffer += text;
      buffer = buffer.replace(/\r\n/g, '\n');
      var lines = buffer.split('\n');
      buffer = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf('data: ') !== 0) continue;
        var dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') {
          if (onDone) onDone(fullContent, extra);
          return;
        }
        // Try JSON parse for structured messages (e.g. sources)
        if (dataStr.charAt(0) === '{') {
          try {
            var msg = JSON.parse(dataStr);
            if (msg.type === 'sources') {
              extra.sources = msg.cards || [];
              continue;
            }
          } catch (_e) {}
        }
        // Plain text chunk
        fullContent += dataStr;
        if (onChunk) onChunk(fullContent);
      }
    });
  } else {
    // Fallback: non-streaming request
    request('POST', path, body)
      .then(function (data) {
        var content = data.answer || data.reply || '';
        if (onChunk) onChunk(content);
        if (onDone) onDone(content, {});
      })
      .catch(function (e) { if (onError) onError(e); });
  }

  return task;
}

// ── Convenience: GET/POST/PUT/DELETE ──

function get(path) { return request('GET', path); }
function post(path, data) { return request('POST', path, data); }
function put(path, data) { return request('PUT', path, data); }
function del(path) { return request('DELETE', path); }

module.exports = {
  API_BASE: API_BASE,
  getToken: getToken,
  setToken: setToken,
  clearToken: clearToken,
  request: request,
  streamRequest: streamRequest,
  get: get,
  post: post,
  put: put,
  del: del,
};

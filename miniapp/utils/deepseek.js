// utils/deepseek.js — Multi-provider AI client (DeepSeek + MiMo)

// ── Provider config ──

const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    models: {
      'deepseek-v4-flash': 'DeepSeek-V4-Flash（快速响应）',
      'deepseek-v4-pro': 'DeepSeek-V4-Pro（深度推理）',
    },
    defaultModel: 'deepseek-v4-flash',
  },
  mimo: {
    name: 'MiMo',
    models: {
      'mimo-v2.5-pro': 'MiMo-V2.5-Pro',
    },
    defaultModel: 'mimo-v2.5-pro',
  },
};

// Keep MODELS export for backward compatibility
const MODELS = PROVIDERS.deepseek.models;

function getProvider() {
  const app = getApp();
  return app ? app.getSetting('aiProvider', 'deepseek') : 'deepseek';
}

function getApiKey() {
  const provider = getProvider();
  const app = getApp();
  if (provider === 'mimo') {
    return app ? app.getSetting('mimoApiKey', '') : '';
  }
  return app ? app.getSetting('deepseekApiKey', '') : '';
}

function getModel() {
  const provider = getProvider();
  const app = getApp();
  if (provider === 'mimo') {
    return app ? app.getSetting('mimoModel', 'mimo-v2.5-pro') : 'mimo-v2.5-pro';
  }
  return app ? app.getSetting('deepseekModel', 'deepseek-v4-flash') : 'deepseek-v4-flash';
}

function getBaseUrl() {
  const app = getApp();
  if (getProvider() === 'mimo') {
    return app ? app.getSetting('mimoBaseUrl', 'https://token-plan-cn.xiaomimimo.com/v1') : 'https://token-plan-cn.xiaomimimo.com/v1';
  }
  return 'https://api.deepseek.com';
}

function requireApiKey() {
  const key = getApiKey();
  if (!key) {
    wx.showModal({
      title: '未配置 API Key',
      content: '请先在"个人中心 → AI设置"中配置 API Key',
      showCancel: false,
      confirmText: '知道了',
    });
    return false;
  }
  return true;
}

// ── DeepSeek call (OpenAI chat completions format) ──

function _buildDeepSeekData({ messages, temperature, maxTokens, stream, noThinking }) {
  const model = getModel();
  const data = { model, messages, stream: !!stream, max_tokens: maxTokens || 1024 };
  if (model === 'deepseek-v4-pro' && !noThinking) {
    data.thinking = { type: 'enabled' };
    data.reasoning_effort = 'high';
  } else {
    data.temperature = temperature || 0.7;
  }
  return data;
}

function _callDeepSeek({ messages, temperature, maxTokens, stream }) {
  const key = getApiKey();
  const baseUrl = getBaseUrl();
  return new Promise(function (resolve, reject) {
    wx.request({
      url: baseUrl + '/chat/completions',
      method: 'POST',
      header: {
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      data: _buildDeepSeekData({ messages, temperature, maxTokens, stream: !!stream }),
      success: function (res) {
        if (res.statusCode === 200 && res.data.choices && res.data.choices[0]) {
          var msg = res.data.choices[0].message;
          var content = msg.content || msg.reasoning_content || '';
          resolve(content.trim());
        } else if (res.statusCode === 401) {
          reject(new Error('API Key 无效'));
        } else if (res.statusCode === 429) {
          reject(new Error('请求过于频繁，请稍后再试'));
        } else {
          reject(new Error('API 返回错误: ' + (res.statusCode || 'unknown')));
        }
      },
      fail: function (err) {
        reject(new Error('网络请求失败: ' + (err.errMsg || '')));
      },
    });
  });
}

// ── Unified call interface ──

function callDeepSeek(opts) {
  return _callDeepSeek(opts);
}

function _callSimple({ messages, temperature, maxTokens }) {
  var key = getApiKey();
  if (!key) return Promise.resolve('');
  return callDeepSeek({ messages: messages, temperature: temperature, maxTokens: maxTokens || 64 });
}

// ── Streaming ──

function callDeepSeekStream({ messages, temperature, maxTokens, onChunk, onComplete, onError }) {
  var key = getApiKey();
  if (!key) {
    if (onError) onError(new Error('未配置 API Key'));
    return;
  }

  var baseUrl = getBaseUrl();
  var fullContent = '';
  var task = wx.request({
    url: baseUrl + '/chat/completions',
    method: 'POST',
    enableChunked: true,
    header: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    data: _buildDeepSeekData({ messages, temperature, maxTokens, stream: true }),
    success: function () {},
    fail: function () {
      callDeepSeek({ messages, temperature, maxTokens })
        .then(function (content) {
          fullContent = content;
          if (onChunk) onChunk(content);
          if (onComplete) onComplete(content);
        })
        .catch(function (e) { if (onError) onError(e); });
    },
  });

  if (task && typeof task.onChunkText === 'function') {
    var buffer = '';
    task.onChunkText(function (text) {
      buffer += text;
      var lines = buffer.split('\n');
      buffer = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.indexOf('data: ') !== 0) continue;
        var jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') {
          if (onComplete) onComplete(fullContent);
          return;
        }
        try {
          var data = JSON.parse(jsonStr);
          var delta = data.choices && data.choices[0] && data.choices[0].delta;
          if (delta) {
            var chunk = delta.content || delta.reasoning_content || '';
            if (chunk) {
              fullContent += chunk;
              if (onChunk) onChunk(fullContent);
            }
          }
        } catch (_e) {}
      }
    });
  } else {
    callDeepSeek({ messages, temperature, maxTokens })
      .then(function (content) {
        fullContent = content;
        if (onChunk) onChunk(content);
        if (onComplete) onComplete(content);
      })
      .catch(function (e) { if (onError) onError(e); });
  }
}

// ── Convenience wrappers ──

function getSystemPrompt() {
  var app = getApp();
  var tone = app ? app.getSetting('aiTone', '创意') : '创意';
  var direction = app ? app.getSetting('aiDirection', '发散') : '发散';
  var toneMap = { '严谨': '严谨专业', '活泼': '活泼轻松', '创意': '富有创意和想象力' };
  var dirMap = { '发散': '鼓励发散思考，提供多种可能性', '聚焦': '聚焦核心问题，深入分析', '落地': '注重可行性，提供具体行动建议' };
  return '你是一个灵感思维助手。你的角色是帮助用户深化和拓展灵感，而不是替代用户思考。' +
    '语气风格：' + (toneMap[tone] || tone) + '。' +
    '思路方向：' + (dirMap[direction] || direction) + '。' +
    '回复要求：1.直接回应用户需求 2.提供具体可行建议 3.适当提出引导性问题 4.控制回复在200字以内';
}

function chatStream(opts) {
  if (!requireApiKey()) { if (opts.onError) opts.onError(new Error('未配置 API Key')); return; }
  var messages = [
    { role: 'system', content: getSystemPrompt() + (opts.cardContext ? '\n\n当前灵感卡片内容：\n「' + opts.cardContext + '」' : '') },
  ];
  if (opts.historyMessages && opts.historyMessages.length > 0) {
    var recent = opts.historyMessages.slice(-10);
    for (var i = 0; i < recent.length; i++) {
      messages.push({ role: recent[i].role === 'ai' ? 'assistant' : 'user', content: recent[i].content });
    }
  }
  messages.push({ role: 'user', content: opts.userMessage });
  callDeepSeekStream({ messages: messages, onChunk: opts.onChunk, onComplete: opts.onComplete, onError: opts.onError });
}

function polishText(opts) {
  if (!requireApiKey()) { if (opts.onError) opts.onError(new Error('未配置 API Key')); return; }
  callDeepSeek({
    messages: [
      { role: 'system', content: '你是一个文字润色专家。请润色以下灵感文字，保持原意不变，优化语言表达和逻辑结构。直接输出润色后的文字，不要加任何前缀说明或解释。' },
      { role: 'user', content: opts.text },
    ],
    temperature: 0.5,
  }).then(function (c) { if (opts.onComplete) opts.onComplete(c); })
    .catch(function (e) { if (opts.onError) opts.onError(e); });
}

function supplementText(opts) {
  if (!requireApiKey()) { if (opts.onError) opts.onError(new Error('未配置 API Key')); return; }
  var app = getApp();
  var direction = app ? app.getSetting('aiDirection', '发散') : '发散';
  callDeepSeek({
    messages: [
      { role: 'system', content: '你是一个灵感拓展助手。基于用户的灵感内容，从多个角度补充拓展思路。直接输出补充内容，格式清晰有条理。思路方向：' + direction },
      { role: 'user', content: opts.text },
    ],
  }).then(function (c) { if (opts.onComplete) opts.onComplete(c); })
    .catch(function (e) { if (opts.onError) opts.onError(e); });
}

function generateFromPrompt(opts) {
  if (!requireApiKey()) { if (opts.onError) opts.onError(new Error('未配置 API Key')); return; }
  callDeepSeek({
    messages: [
      { role: 'system', content: '你是一个灵感生成器。根据用户的提示，生成一段有深度的灵感文字。直接输出内容，不要加前缀。' },
      { role: 'user', content: opts.prompt },
    ],
  }).then(function (c) { if (opts.onComplete) opts.onComplete(c); })
    .catch(function (e) { if (opts.onError) opts.onError(e); });
}

function generateTitle(content) {
  return _callSimple({
    messages: [
      { role: 'system', content: '请用不超过8个字概括以下内容的主题，作为标题。只输出标题文字本身，绝对不要加引号、书名号、序号或其他任何符号。' },
      { role: 'user', content: content },
    ],
    temperature: 0.3,
    maxTokens: 16,
  }).then(function (raw) {
    var t = (raw || '').trim().replace(/["""''《》【】「」]/g, '');
    if (t.length > 10) t = t.substring(0, 10);
    return t;
  });
}

function extractKeywords(content) {
  if (!getApiKey()) return Promise.resolve([]);
  return _callSimple({
    messages: [
      { role: 'system', content: '从以下内容中提取3-5个核心关键字。每个关键字2-4个字，用逗号分隔，不要加序号、解释或其他符号。' },
      { role: 'user', content: content },
    ],
    temperature: 0.3,
    maxTokens: 48,
  }).then(function (raw) {
    return (raw || '').split(/[,，、\n]/).map(function (s) {
      var kw = s.trim().replace(/["""''《》【】「」]/g, '');
      if (kw.length > 6) kw = kw.substring(0, 6);
      return kw;
    }).filter(function (s) { return s.length > 0; }).slice(0, 5);
  }).catch(function () { return []; });
}

function generateThoughtFlow(cards) {
  var cardSummaries = cards.map(function (c) {
    var title = c.title || c.content.substring(0, 20) + '...';
    var kw = (c.keywords || []).join(', ');
    return '· ' + title + (kw ? '（关键字：' + kw + '）' : '');
  }).join('\n');
  return callDeepSeek({
    messages: [
      { role: 'system', content: '你是一个思维链路分析师。请分析以下灵感卡片，总结用户的思维流向和演进路径。格式：\n1. 思维起点：从哪里开始\n2. 关键转折：经过哪些碰撞\n3. 当前导向：目前指向什么方向\n4. 下一步建议：建议接下来探索什么\n\n用简洁清晰的语言，200字以内。' },
      { role: 'user', content: '当前思维空间的所有灵感卡片：\n' + cardSummaries },
    ],
    temperature: 0.5,
    maxTokens: 512,
  });
}

module.exports = {
  PROVIDERS,
  MODELS,
  callDeepSeek,
  callDeepSeekStream,
  chatStream,
  polishText,
  supplementText,
  generateFromPrompt,
  generateTitle,
  generateThoughtFlow,
  extractKeywords,
  getApiKey,
  getModel,
  getProvider,
  getBaseUrl,
  requireApiKey,
};

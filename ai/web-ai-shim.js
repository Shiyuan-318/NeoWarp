/**
 * NeoWarp 网页版 AI 助手 AIAssistantPreload 浏览器兼容层
 * AI 助手窗口通过 postMessage 与打开它的编辑器窗口通信，
 * 由编辑器侧的 EditorPreload 兼容层提供工程内容 / 工具调用 / 应用改动等能力。
 */
(function () {
  'use strict';

  var ORIGIN = window.location.origin;
  var pending = new Map();
  var seq = 0;

  // 编辑器窗口（由编辑器 window.open 打开，因此是 window.opener）
  function editorWindow () {
    try {
      if (window.opener && !window.opener.closed) return window.opener;
    } catch (e) { /* 跨源等情况 */ }
    return null;
  }

  function request (method, args, timeout) {
    var target = editorWindow();
    if (!target) return Promise.resolve(null);
    var id = 'ai-' + Date.now() + '-' + (++seq);
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        pending.delete(id);
        resolve(null);
      }, timeout || 15000);
      pending.set(id, function (result) {
        clearTimeout(timer);
        resolve(result);
      });
      try {
        target.postMessage({ __neowarpAI: true, id: id, method: method, args: args || [] }, ORIGIN);
      } catch (e) {
        clearTimeout(timer);
        pending.delete(id);
        resolve(null);
      }
    });
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== ORIGIN) return;
    if (event.source !== editorWindow()) return;
    var data = event.data;
    if (!data || data.__neowarpAIResponse !== true) return;
    var cb = pending.get(data.requestId);
    if (!cb) return;
    pending.delete(data.requestId);
    cb(data.result);
  });

  function localTheme () {
    try {
      var setting = localStorage.getItem('tw:theme');
      if (setting === 'light' || setting === 'dark') return setting;
      if (setting) {
        var parsed = JSON.parse(setting);
        if (parsed && (parsed.gui === 'dark' || parsed.gui === 'light')) return parsed.gui;
      }
    } catch (e) { /* ignore */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function localLocale () {
    try {
      var v = localStorage.getItem('tw:locale');
      if (v) return v;
    } catch (e) { /* ignore */ }
    return (navigator.language || 'zh-cn').toLowerCase();
  }

  function noop () {}

  window.AIAssistantPreload = {
    // ── 与编辑器交互 ──
    getProjectCode: function () {
      return request('getProjectCode', [], 15000).then(function (result) {
        if (result && typeof result === 'object' && 'projectJSON' in result) {
          return result.projectJSON;
        }
        return result;
      });
    },
    applyProject: function (projectJSON) {
      return request('applyProject', [projectJSON], 30000).then(function (r) {
        return r || { success: false, error: '编辑器未响应' };
      });
    },
    applySprite: function (spriteJSON, targetId) {
      return request('applySprite', [spriteJSON, targetId], 30000).then(function (r) {
        return r || { success: false, error: '编辑器未响应' };
      });
    },
    getSpriteLibrary: function () { return Promise.resolve(null); },
    callTool: function (toolName, params) {
      return request('callTool', [toolName, params], 180000).then(function (r) {
        return r || { success: false, error: '编辑器未响应' };
      });
    },

    // ── 网页版不支持的桌面能力 ──
    webSearch: function () {
      return Promise.resolve({ success: false, error: '网页版暂不支持联网搜索' });
    },
    getPhoneLink: function () {
      return Promise.resolve({ success: false, error: '网页版暂不支持手机编程' });
    },
    phoneSyncBroadcast: noop,
    onPhoneClientsChanged: noop,
    openDesktopSettings: function () {
      try { window.open('../addons/addons.html', '_blank'); } catch (e) { /* ignore */ }
      return Promise.resolve(true);
    },

    // ── 主题 / 语言（同源，直接读 localStorage）──
    getTheme: function () { return Promise.resolve(localTheme()); },
    getLocale: function () { return Promise.resolve(localLocale()); },
    onThemeChanged: noop,
    onLocaleChanged: noop,
    onAiModelConfigsChanged: noop,
    removeThemeListener: noop,
    removeLocaleListener: noop,

    // ── 窗口 ──
    closeWindow: function () {
      try { window.close(); } catch (e) { /* ignore */ }
      return Promise.resolve(true);
    }
  };

  console.log('[NeoWarp] 网页版 AIAssistantPreload 已加载');
})();

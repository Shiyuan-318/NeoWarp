/* ==========================================================================
 * NeoWarp 网页版 — AI 助手 AIAssistantPreload 浏览器实现
 * 工程读写类能力由宿主（编辑器页面）提供；模型配置与主题走宿主的 desktop 服务。
 * 大模型请求本身由页面直接用 fetch 发出（各厂商均已开放 CORS）。
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  var util = NW.util;
  var rpc = NW.rpc;

  function desktop (method, args, fallback) {
    if (!rpc.isAvailable()) return Promise.resolve(fallback);
    return rpc.call('desktop', method, args).catch(function () { return fallback; });
  }

  function editor (method, args, timeout) {
    if (!rpc.isAvailable()) {
      return Promise.resolve({ success: false, error: 'AI 助手需要由编辑器打开才能操作工程' });
    }
    return rpc.call('editor', method, args, timeout).catch(function (error) {
      return { success: false, error: (error && error.message) || '编辑器未响应' };
    });
  }

  /* --------------------------- 联网搜索（尽力而为） --------------------------- */
  function fetchWithTimeout (url, options, timeout) {
    if (typeof global.AbortController === 'function') {
      var controller = new AbortController();
      var timer = global.setTimeout(function () { controller.abort(); }, timeout || 8000);
      return fetch(url, Object.assign({}, options, { signal: controller.signal }))
        .then(function (response) {
          global.clearTimeout(timer);
          return response;
        }, function (error) {
          global.clearTimeout(timer);
          throw error;
        });
    }
    return fetch(url, options);
  }

  function searchDuckDuckGo (query) {
    var url = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1';
    return fetchWithTimeout(url, { method: 'GET' }, 9000)
      .then(function (response) { return response.json(); })
      .then(function (data) {
        var results = [];
        if (data && data.AbstractText) {
          results.push({
            title: data.Heading || query,
            url: data.AbstractURL || '',
            snippet: data.AbstractText
          });
        }
        (data && data.RelatedTopics ? data.RelatedTopics : []).slice(0, 8).forEach(function (topic) {
          if (topic && topic.FirstURL && topic.Text) {
            results.push({ title: topic.Text.split(' - ')[0], url: topic.FirstURL, snippet: topic.Text });
          }
        });
        return results;
      });
  }

  var AiAssistantPreload = {
    /* ------------------------ 工程读写 ------------------------ */
    getProjectCode: function () {
      return rpc.isAvailable()
        ? rpc.call('editor', 'getProjectCode', [], 60000).catch(function () { return null; })
        : Promise.resolve(null);
    },

    applyProject: function (projectJSON) {
      return editor('applyProject', [projectJSON], 120000);
    },

    applySprite: function (spriteJSON, targetId) {
      return editor('applySprite', [spriteJSON, targetId], 120000);
    },

    getSpriteLibrary: function () {
      return rpc.isAvailable()
        ? rpc.call('editor', 'getSpriteLibrary', [], 30000).catch(function () { return null; })
        : Promise.resolve(null);
    },

    callTool: function (toolName, params) {
      return editor('callTool', [toolName, params], 300000);
    },

    /* -------------------- 统一的 AI 模型配置存储 -------------------- */
    getModelConfigs: function () {
      return desktop('getAiModelConfigs', [], { configs: [], activeId: null });
    },

    saveModelConfigs: function (payload) {
      return desktop('saveAiModelConfigs', [payload], { configs: [], activeId: null });
    },

    onAiModelConfigsChanged: function (callback) {
      rpc.on('desktop', 'aiModelConfigs', callback);
    },

    openDesktopSettings: function () {
      return desktop('openDesktopSettings', [], false);
    },

    /* ------------------------ 主题与语言 ------------------------ */
    getTheme: function () {
      return desktop('getTheme', [], util.resolveTheme());
    },

    getLocale: function () {
      return desktop('getLocale', [], util.resolveLocale());
    },

    onThemeChanged: function (callback) {
      rpc.on('desktop', 'theme', callback);
    },

    onLocaleChanged: function (callback) {
      rpc.on('desktop', 'locale', callback);
    },

    removeThemeListener: function () { /* 事件由宿主统一广播，无需逐个解绑 */ },
    removeLocaleListener: function () { /* 同上 */ },

    onProjectCodeResponse: function (callback) {
      rpc.on('editor', 'projectCode', callback);
    },

    /* ------------------------ 联网搜索 ------------------------ */
    webSearch: function (query) {
      if (!query) return Promise.resolve({ success: false, error: '搜索词为空' });
      return searchDuckDuckGo(query).then(function (results) {
        if (!results.length) {
          return { success: false, error: '没有检索到结果（网页版的联网能力受浏览器跨域限制）' };
        }
        return { success: true, results: results };
      }, function (error) {
        return { success: false, error: '网页版联网搜索不可用：' + ((error && error.message) || error) };
      });
    },

    /* -------------------- 手机远程（WebRTC 房间） -------------------- */
    getPhoneLink: function () {
      var remote = NW.remote;
      if (!remote || !remote.isAvailable()) {
        return Promise.resolve({ ok: false, error: '当前浏览器不支持 WebRTC 远控' });
      }
      return NW.phoneSync.ensureHost().then(function (host) {
        return { ok: true, urls: [host.url], clients: host.clients };
      }).catch(function (error) {
        return { ok: false, error: (error && error.message) || String(error) };
      });
    },
    phoneSyncBroadcast: function (payload) {
      // AI 页面把会话变化/流式输出推给所有已连接的手机
      if (NW.phoneSync) NW.phoneSync.broadcastPush(payload);
    },
    onPhoneClientsChanged: function (callback) {
      if (NW.phoneSync) NW.phoneSync.onClients(callback);
    },

    /* ------------------------ 窗口控制 ------------------------ */
    closeWindow: function () {
      if (rpc.postToHost({ __nw: 1, t: 'close' })) return Promise.resolve(true);
      try { global.close(); } catch (e) { /* 忽略 */ }
      return Promise.resolve(true);
    }
  };

  global.AIAssistantPreload = AiAssistantPreload;
})(window);

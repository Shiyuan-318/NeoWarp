/**
 * 远程模式桥接层（手机端）
 *
 * 手机扫码后加载的就是桌面那份 ai-assistant.html 本体，因此两端 UI 完全一致。
 * 这份脚本在主脚本之前执行，负责把页面期望的运行环境补齐：
 *   1. 顶起 window.AIAssistantPreload 的替身（远程端没有 Electron preload）；
 *   2. 用 SSE 接收桌面推送的会话状态，用 POST 把操作回投桌面执行；
 *   3. 注入远程端才需要的适配样式（安全区、隐藏本机专属入口）。
 *
 * 首屏快照由服务端直接内联成 window.__NEOWARP_REMOTE_BOOT__，主脚本同步初始化
 * 时即可拿到完整会话，不会先闪一帧空界面。
 */
(function () {
  'use strict';

  var TOKEN = window.__NEOWARP_REMOTE_TOKEN__ || '';
  var BOOT = window.__NEOWARP_REMOTE_BOOT__ || {};
  var listeners = [];
  var source = null;
  var retryTimer = 0;
  var online = false;
  var statusBar = null;

  function withToken (path) {
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN);
  }

  function emit (kind, data) {
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](kind, data);
      } catch (e) {
        void e;
      }
    }
  }

  /* ── 连接状态提示 ── */

  function ensureStatusBar () {
    if (statusBar || !document.body) return statusBar;
    statusBar = document.createElement('div');
    statusBar.className = 'remote-status-bar';
    document.body.appendChild(statusBar);
    return statusBar;
  }

  function setOnline (value, message) {
    online = value;
    var bar = ensureStatusBar();
    if (!bar) return;
    if (value) {
      bar.classList.remove('show');
    } else {
      bar.textContent = message || '与电脑的连接已断开，正在重连…';
      bar.classList.add('show');
    }
  }

  /* ── 事件流：桌面 → 手机 ── */

  /**
   * 桌面推来的事件名。注意不能包含 'error'：EventSource 自身的连接错误也叫
   * error，注册同名监听会让每次掉线都误报一条业务错误。桌面统一用 toast。
   */
  var PUSH_EVENTS = ['snapshot', 'history', 'stream', 'toast', 'clients', 'bye'];

  function connect () {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = 0;
    }
    try {
      source = new EventSource(withToken('/api/events'));
    } catch (e) {
      retryTimer = setTimeout(connect, 2500);
      return;
    }
    PUSH_EVENTS.forEach(function (kind) {
      source.addEventListener(kind, function (event) {
        var data = {};
        try {
          data = event.data ? JSON.parse(event.data) : {};
        } catch (e) {
          data = {};
        }
        if (kind === 'bye') {
          setOnline(false, '电脑端已关闭 AI 窗口');
          return;
        }
        setOnline(true);
        emit(kind, data);
      });
    });
    source.onopen = function () {
      setOnline(true);
    };
    source.onerror = function () {
      setOnline(false);
      try {
        source.close();
      } catch (e) {
        void e;
      }
      source = null;
      retryTimer = setTimeout(connect, 2500);
    };
  }

  /* ── 命令通道：手机 → 桌面 ── */

  function sendCommand (cmd, payload) {
    var body = {cmd: cmd};
    if (payload) {
      Object.keys(payload).forEach(function (key) {
        body[key] = payload[key];
      });
    }
    return fetch(withToken('/api/cmd'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json();
    }).catch(function () {
      return {ok: false, error: '网络错误，请检查与电脑的连接'};
    });
  }

  function fetchSnapshot () {
    return fetch(withToken('/api/state')).then(function (res) {
      if (!res.ok) throw new Error('bad token');
      return res.json();
    });
  }

  window.__NeoWarpRemote = {
    boot: BOOT,
    on: function (fn) {
      if (typeof fn === 'function') listeners.push(fn);
    },
    send: sendCommand,
    refresh: function () {
      return fetchSnapshot().then(function (snap) {
        emit('snapshot', snap);
        return snap;
      }).catch(function () {
        return null;
      });
    },
    isOnline: function () {
      return online;
    }
  };

  /* ── preload 替身 ── */

  var unavailable = function () {
    return Promise.resolve({success: false, error: '该操作只能在电脑端执行'});
  };

  window.AIAssistantPreload = {
    getProjectCode: function () {
      return Promise.resolve(null);
    },
    applyProject: unavailable,
    applySprite: unavailable,
    getSpriteLibrary: function () {
      return Promise.resolve(null);
    },
    getSettings: function () {
      return Promise.resolve({});
    },
    saveSettings: function () {
      return Promise.resolve({success: true});
    },
    callTool: unavailable,
    webSearch: unavailable,
    getTheme: function () {
      return Promise.resolve(BOOT.theme || 'light');
    },
    getLocale: function () {
      return Promise.resolve(BOOT.locale || 'zh-CN');
    },
    closeWindow: function () {
      return Promise.resolve({success: true});
    },
    getPhoneLink: function () {
      return Promise.resolve({ok: false});
    },
    phoneSyncBroadcast: function () {},
    onPhoneClientsChanged: function () {},
    onProjectCodeResponse: function () {},
    onThemeChanged: function () {},
    onLocaleChanged: function () {},
    removeThemeListener: function () {},
    removeLocaleListener: function () {}
  };

  /* ── 远程端样式适配 ── */

  var REMOTE_CSS = [
    'html.remote-mode { -webkit-text-size-adjust: 100%; }',
    'html.remote-mode body { overscroll-behavior-y: none; }',
    'html.remote-mode * { -webkit-tap-highlight-color: transparent; }',
    /* 本机专属入口在远程端没有意义 */
    'html.remote-mode #phoneLinkBtn, html.remote-mode .phone-popover { display: none !important; }',
    /* 附件解析（pdf.js）依赖外网，远程端只保留图片上传 */
    'html.remote-mode #fileUploadBtn { display: none !important; }',
    /* 刘海/灵动岛让位 */
    'html.remote-mode .top-bar { top: calc(var(--float-gap) + env(safe-area-inset-top, 0px)); }',
    'html.remote-mode .chat-area { padding-top: calc(var(--float-gap) * 2 + var(--float-bar-h) + env(safe-area-inset-top, 0px)); }',
    'html.remote-mode .sidebar { top: 0; bottom: 0; padding-top: env(safe-area-inset-top, 0px); }',
    'html.remote-mode .phone-popover { top: calc(var(--float-gap) + var(--float-bar-h) + 8px + env(safe-area-inset-top, 0px)); }',
    /* 触屏没有 hover，按压反馈交给 :active */
    'html.remote-mode .chat-item .chat-item-delete { opacity: 1; }',
    'html.remote-mode .chat-area::-webkit-scrollbar { width: 0; }',
    /* 断连提示条 */
    '.remote-status-bar {',
    '  position: fixed; left: 50%; transform: translateX(-50%);',
    '  bottom: calc(env(safe-area-inset-bottom, 0px) + 88px);',
    '  z-index: 400; max-width: calc(100% - 32px);',
    '  padding: 8px 16px; border-radius: 9999px;',
    '  background: rgba(255, 59, 48, 0.94); color: #fff;',
    '  font-size: 12.5px; font-weight: 600; letter-spacing: -0.1px;',
    '  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);',
    '  opacity: 0; pointer-events: none;',
    '  transition: opacity 0.25s ease;',
    '}',
    '.remote-status-bar.show { opacity: 1; }'
  ].join('\n');

  document.documentElement.classList.add('remote-mode');
  var style = document.createElement('style');
  style.textContent = REMOTE_CSS;
  document.head.appendChild(style);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      ensureStatusBar();
      if (!online) setOnline(false);
    });
  } else {
    ensureStatusBar();
  }

  connect();
})();

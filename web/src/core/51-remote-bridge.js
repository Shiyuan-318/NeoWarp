/* NeoWarp Web — 协作素材注入 + 手机远控请求网关
 *
 * 1. 协作「素材不互通」修复：
 *    Scratch 项目 JSON 里的造型/声音只是 md5 引用，加载时按 md5 去
 *    assets.scratch.mit.edu 拉取；房主的自定义素材不在官方 CDN 上，
 *    协作对端就会丢素材（桌面版同样存在此问题）。
 *    网页版由房主把素材本体随项目一并传输，对端在这里注册；
 *    之后任何 md5 命中的官方素材请求改从本地已收到的数据应答。
 *
 * 2. AI 手机远控（ai/ai-assistant.html?r=<room>）：
 *    手机端与桌面 remote-bridge.js 完全同一份 UI 代码，桌面通过
 *    Electron 主进程的 SSE + POST 通信；网页版没有主进程，这里把
 *    EventSource 与 fetch('/api/...') 重定向到 WebRTC datachannel，
 *    remote-bridge.js 零改动复用。
 */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  if (!NW.rpc) return; // 非宿主注入环境

  /* ---------------- 素材注册表 ---------------- */

  var assets = {}; // md5ext -> ArrayBuffer
  var listeners = [];

  function assetKey (md5ext) {
    return String(md5ext || '').toLowerCase();
  }

  /** 注册协作素材；返回新注册数量（用于就绪判断） */
  function registerAssets (list) {
    var added = 0;
    (list || []).forEach(function (item) {
      var key = assetKey(item.md5ext);
      if (!key || assets[key]) return;
      var bin = item.data;
      if (typeof bin === 'string') {
        // base64 → ArrayBuffer
        var raw = global.atob(bin);
        var buf = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
        bin = buf.buffer;
      }
      assets[key] = bin;
      added += 1;
    });
    listeners.forEach(function (fn) {
      try { fn(added); } catch (e) { void e; }
    });
    return added;
  }

  function hasAssets () {
    return Object.keys(assets).length > 0;
  }

  function clearAssets () {
    assets = {};
  }

  function onAssets (fn) {
    listeners.push(fn);
  }

  NW.collabAssets = {
    registerAssets: registerAssets,
    hasAssets: hasAssets,
    clearAssets: clearAssets,
    onAssets: onAssets
  };

  /* ---------------- fetch 拦截：本地应答官方素材请求 ---------------- */

  var ASSET_URL_RE = /^https?:\/\/assets\.scratch\.mit\.edu\/(?:internalapi\/)?asset\/([a-f0-9]+\.[a-z0-9]+)\/?/i;

  var origFetch = global.fetch ? global.fetch.bind(global) : null;
  global.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var match = ASSET_URL_RE.exec(url);
      if (match && assets[assetKey(match[1])]) {
        return Promise.resolve(new Response(assets[assetKey(match[1])], {
          status: 200,
          headers: {'Content-Type': 'application/octet-stream'}
        }));
      }
    } catch (e) { void e; }
    if (origFetch) return origFetch(input, init);
    return Promise.reject(new Error('fetch 不可用'));
  };

  /* ---------------- AI 手机远控的假 SSE / 假 fetch ---------------- */

  var phoneSession = null; // NW.remote.join() 结果

  function getRoomParam () {
    try {
      var params = new URLSearchParams(global.location.search);
      return params.get('r') || '';
    } catch (e) {
      return '';
    }
  }

  /** 以 datachannel 模拟 EventSource（供 remote-bridge.js 使用） */
  function RemoteEventSource () {
    this.readyState = 0;
    this._listeners = {};
    this.onopen = null;
    this.onerror = null;
    var self = this;
    // 建立 P2P 会话，并把电脑端推来的 phone-push 转成 SSE 同名事件
    global.__NWPhoneBridge.ensureSession(function (obj) {
      if (!obj) return;
      if (obj.t === 'phone-push') {
        if (obj.kind === 'bye') {
          self.readyState = 2;
          self._emit('bye', obj.data || {});
          return;
        }
        self._emit(obj.kind, obj.data || {});
      } else if (obj.t === 'phone-closed') {
        self.readyState = 2;
        self._fail('与电脑的连接已断开');
      }
    }).then(function (session) {
      self._open(session);
    }).catch(function (error) {
      self._fail(error && error.message);
    });
  }
  RemoteEventSource.prototype.addEventListener = function (kind, fn) {
    (this._listeners[kind] = this._listeners[kind] || []).push(fn);
  };
  RemoteEventSource.prototype.removeEventListener = function (kind, fn) {
    var list = this._listeners[kind] || [];
    var idx = list.indexOf(fn);
    if (idx >= 0) list.splice(idx, 1);
  };
  RemoteEventSource.prototype.close = function () {
    this.readyState = 2;
    if (this._session) {
      try { this._session.close(); } catch (e) { void e; }
      this._session = null;
    }
  };
  RemoteEventSource.prototype._emit = function (kind, obj) {
    var list = this._listeners[kind] || [];
    var data = JSON.stringify(obj);
    for (var i = 0; i < list.length; i++) {
      try { list[i].call(this, {data: data}); } catch (e) { void e; }
    }
  };
  RemoteEventSource.prototype._open = function (session) {
    this._session = session;
    this.readyState = 1;
    if (this.onopen) this.onopen.call(this);
  };
  RemoteEventSource.prototype._fail = function (message) {
    this.readyState = 2;
    if (this.onerror) this.onerror.call(this, {message: message || '连接失败'});
  };

  global.__NWPhoneBridge = {
    /** 供 fetch 拦截器与 remote-bridge 使用：建立/复用连接 */
    ensureSession: function (onEvent) {
      if (phoneSession) return Promise.resolve(phoneSession);
      var room = getRoomParam();
      if (!room || !NW.remote || !NW.remote.isAvailable()) {
        return Promise.reject(new Error('缺少房间参数或环境不支持'));
      }
      return new Promise(function (resolve, reject) {
        var session = NW.remote.join(room, {
          onOpen: function () {
            phoneSession = session;
            resolve(session);
          },
          onData: function (link, obj) {
            if (onEvent) onEvent(obj);
          },
          onClose: function () {
            phoneSession = null;
            if (onEvent) onEvent({t: 'phone-closed'});
          },
          onFail: function (error) {
            reject(error);
          }
        });
      });
    },
    /** 手机 → 电脑命令（POST /api/cmd 的等价物） */
    sendCommand: function (cmd, payload, timeout) {
      var body = Object.assign({cmd: cmd}, payload || {});
      return this.ensureSession().then(function (session) {
        return new Promise(function (resolve, reject) {
          var id = 'cmd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          var timer = setTimeout(function () {
            reject(new Error('电脑端响应超时'));
          }, timeout || 30000);
          var orig = session.link.onData;
          session.link.onData = function (obj) {
            if (orig) orig.apply(session.link, arguments);
            if (obj && obj.t === 'phone-cmd-res' && obj.id === id) {
              clearTimeout(timer);
              session.link.onData = orig;
              resolve(obj.result || {ok: false});
            }
          };
          session.send({t: 'phone-cmd', id: id, msg: body});
        });
      });
    },
    /** 手机 → 电脑快照请求（GET /api/state 的等价物） */
    fetchState: function () {
      return this.sendCommand('__state', {}, 15000);
    },
    isPhoneMode: function () {
      return !!getRoomParam() && !!(NW.remote && NW.remote.isAvailable());
    },
    _setEventSource: function (ctor) {
      // 仅在手机模式下接管 EventSource；保持桌面模式（Electron server）不受影响
      if (this.isPhoneMode()) {
        global.EventSource = ctor;
      }
    }
  };

  if (NW.remote && NW.remote.isAvailable() && getRoomParam()) {
    global.EventSource = RemoteEventSource;
    global.__NWRemoteEventSourceProto = RemoteEventSource.prototype;

    // 接管手机端对 /api/events、/api/cmd、/api/state 的全部请求
    var origFetchPhone = global.fetch;
    global.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || String(input);
        var path = url.replace(/^https?:\/\/[^/]+/, '');
        if (path.indexOf('/api/cmd') === 0 && init && init.method === 'POST') {
          var body = {};
          try { body = JSON.parse(init.body || '{}'); } catch (e) { void e; }
          return __NWPhoneBridge.sendCommand(body.cmd, body).then(function (result) {
            return new Response(JSON.stringify(result), {
              status: 200, headers: {'Content-Type': 'application/json'}
            });
          }).catch(function (error) {
            return new Response(JSON.stringify({ok: false, error: error.message}), {
              status: 200, headers: {'Content-Type': 'application/json'}
            });
          });
        }
        if (path.indexOf('/api/state') === 0) {
          return __NWPhoneBridge.fetchState().then(function (snap) {
            return new Response(JSON.stringify(snap || {}), {
              status: 200, headers: {'Content-Type': 'application/json'}
            });
          }).catch(function (error) {
            return new Response(JSON.stringify({error: error.message}), {status: 503});
          });
        }
      } catch (e) { void e; }
      return origFetchPhone.apply(global, arguments);
    };
  }
})(window);

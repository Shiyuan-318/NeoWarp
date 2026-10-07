/* NeoWarp Web Runtime — 由 web/build.mjs 自动生成，请勿直接修改 */
(function () {
  window.NW_VERSION = "2.0.0";
  window.NW_MONACO_CDNS = ["https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs","https://unpkg.com/monaco-editor@0.52.2/min/vs"];
})();
/* ===== 00-util.js ===== */
/* ==========================================================================
 * NeoWarp Web Runtime — 工具层
 * 提供主题解析、localStorage 安全读写、toast、跨标签页广播等基础能力。
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});

  /* 站点根：所有页面地址都以它为基准，支持部署到子目录 */
  var baseHref = './';
  try {
    var currentScript = global.document.currentScript;
    if (currentScript && currentScript.src) {
      baseHref = new URL('../', currentScript.src).href;
    }
  } catch (e) { /* 保持默认 */ }

  function resolveAppPath (relativePath) {
    return new URL(relativePath, baseHref).href;
  }

  /* ---------- 安全存储 ---------- */
  function readLocal (key, fallback) {
    try {
      var value = global.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function writeLocal (key, value) {
    try {
      if (value === null || value === undefined) global.localStorage.removeItem(key);
      else global.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  function readJSON (key, fallback) {
    var raw = readLocal(key, null);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON (key, value) {
    try {
      return writeLocal(key, JSON.stringify(value));
    } catch (e) {
      return false;
    }
  }

  /* ---------- 主题 ---------- */
  function normalizeTheme (raw) {
    if (raw === 'light' || raw === 'dark') return raw;
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && (parsed.gui === 'dark' || parsed.gui === 'light')) return parsed.gui;
      } catch (e) { /* 不是 JSON，忽略 */ }
    }
    return null;
  }

  function resolveTheme () {
    var fromSetting = normalizeTheme(readLocal('tw:theme', null));
    if (fromSetting) return fromSetting;
    try {
      return global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) {
      return 'dark';
    }
  }

  function resolveAccent () {
    var raw = readLocal('tw:theme', null);
    if (!raw) return '#ff4c4c';
    try {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.accent === 'purple') return '#855cd6';
      if (parsed && parsed.accent === 'blue') return '#4c97ff';
    } catch (e) { /* 纯字符串值，走默认值 */ }
    return '#ff4c4c';
  }

  function resolveLocale () {
    return readLocal('tw:locale', null) || (global.navigator.language || 'zh-cn').toLowerCase();
  }

  /* ---------- 轻量提示 ---------- */
  var toastEl = null;
  var toastTimer = null;

  function toast (message, duration) {
    var doc = global.document;
    if (!doc || !doc.body) return;
    if (!toastEl) {
      toastEl = doc.createElement('div');
      toastEl.className = 'nw-toast';
      doc.body.appendChild(toastEl);
      var styleId = 'nw-toast-style';
      if (!doc.getElementById(styleId)) {
        var style = doc.createElement('style');
        style.id = styleId;
        style.textContent = [
          '.nw-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%) translateY(8px);',
          'z-index:2147483647;padding:10px 18px;border-radius:10px;max-width:76vw;',
          'background:rgba(24,24,28,.92);color:#fff;font-size:13px;line-height:1.6;',
          'box-shadow:0 8px 28px rgba(0,0,0,.35);opacity:0;pointer-events:none;text-align:center;',
          'transition:opacity .22s ease,transform .22s ease;white-space:pre-wrap;}',
          '.nw-toast.is-visible{opacity:1;transform:translateX(-50%) translateY(0);}'
        ].join('');
        (doc.head || doc.documentElement).appendChild(style);
      }
    }
    toastEl.textContent = message;
    // 强制回流，保证连续调用也能重新播放动画
    void toastEl.offsetWidth;
    toastEl.classList.add('is-visible');
    global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(function () {
      toastEl.classList.remove('is-visible');
    }, duration || 2600);
  }

  /* ---------- 同源判断 ---------- */
  function sameOrigin (event) {
    return event.origin === global.location.origin;
  }

  /* ---------- 跨标签页广播（主页 <-> 编辑器） ---------- */
  var CHANNEL_NAME = 'neowarp-web';
  var channel = null;
  var channelListeners = [];

  function getChannel () {
    if (channel !== null) return channel;
    if (typeof global.BroadcastChannel === 'function') {
      try {
        channel = new global.BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = function (event) {
          var data = event.data;
          if (!data || data.__nw !== true) return;
          channelListeners.forEach(function (listener) {
            try { listener(data); } catch (e) { /* 单个监听器失败不影响其他 */ }
          });
        };
      } catch (e) {
        channel = false;
      }
    } else {
      channel = false;
    }
    return channel;
  }

  function broadcast (type, data) {
    var ch = getChannel();
    if (!ch) return;
    try {
      ch.postMessage({ __nw: true, type: type, data: data });
    } catch (e) { /* 忽略 */ }
  }

  function onBroadcast (listener) {
    channelListeners.push(listener);
    getChannel();
  }

  /**
   * Scratch VM 只接受 [a-z0-9] 的扩展 id（见 extension-support 的 _prepareExtensionInfo，
   * 校验对象是 getInfo() 返回的 id 字段）。用户手写的代码常带下划线、中文或直接没有
   * // ID 注释，这里兜底成合法 id，否则「添加到项目」会在 VM 侧抛 Invalid extension id。
   *
   * 三层处理：
   *  1. 改写 // ID: 注释为合法 id；
   *  2. 把代码中与注释原 id 完全相同的字符串字面量一并替换（覆盖 getInfo 里 id: 'xxx'）；
   *  3. 前置一段 Scratch.extensions.register 包装，运行时把非法的 getInfo().id 改写掉
   *     （覆盖 const EXT_ID = 'xxx' 这类间接引用）。
   */
  function normalizeExtensionCode (code, name) {
    var text = String(code == null ? '' : code);
    var isValidId = function (v) { return /^[a-zA-Z0-9]+$/.test(String(v || '')); };
    var match = /^[ \t]*\/\/[ \t]*ID:[ \t]*(\S+)[ \t]*$/m.exec(text);
    var declared = match ? String(match[1]).trim() : '';

    var candidate = isValidId(declared) ? declared : '';
    if (!candidate) {
      candidate = String(name || '')
        .replace(/\.js$/i, '')
        .replace(/[^a-zA-Z0-9]/g, '');
      if (!isValidId(candidate)) candidate = 'ext' + Date.now().toString(36);
    }

    var changed = text;
    if (match) {
      changed = changed.replace(match[0], '// ID: ' + candidate);
      if (declared !== candidate) {
        // 与注释原 id 完全相同的字符串字面量（'xxx' / "xxx"）同步替换
        var escaped = declared.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        changed = changed.replace(
          new RegExp('([\'"])' + escaped + '\\1', 'g'),
          function (whole, quote) { return quote + candidate + quote; }
        );
      }
    } else {
      changed = '// ID: ' + candidate + '\n' + changed;
    }

    // 代码中存在非法的 id: 字面量（含 getInfo 内）时，前置 register 包装兜底
    var needGuard = declared !== candidate;
    if (!needGuard) {
      var literal = /\bid\s*:\s*(['"])([A-Za-z0-9_$.-]*)\1/g;
      var found;
      while ((found = literal.exec(text))) {
        if (!/^[a-zA-Z0-9]+$/.test(found[2])) { needGuard = true; break; }
      }
    }
    if (needGuard) changed = idGuardSource(candidate) + changed;
    return changed;
  }

  /** 前置注入：包装 Scratch.extensions.register，把非法 getInfo().id 改写为合法 id */
  function idGuardSource (candidate) {
    return [
      ';(function (Scratch) {',
      '  try {',
      '    if (!Scratch || !Scratch.extensions || typeof Scratch.extensions.register !== "function") return;',
      '    var origRegister = Scratch.extensions.register;',
      '    var VALID = /^[a-z0-9]+$/i;',
      '    Scratch.extensions.register = function (extension) {',
      '      try {',
      '        if (extension && typeof extension.getInfo === "function") {',
      '          var origGetInfo = extension.getInfo;',
      '          extension.getInfo = function () {',
      '            var info = origGetInfo.apply(this, arguments);',
      '            try {',
      '              if (info && !VALID.test(String(info.id))) info.id = ' + JSON.stringify(candidate) + ';',
      '            } catch (e) { void e; }',
      '            return info;',
      '          };',
      '        }',
      '      } catch (e) { void e; }',
      '      return origRegister.call(Scratch.extensions, extension);',
      '    };',
      '  } catch (e) { void e; }',
      '})(typeof Scratch === "undefined" ? undefined : Scratch);',
      ''
    ].join('\n');
  }

  NW.util = {
    base: baseHref,
    resolveAppPath: resolveAppPath,
    normalizeExtensionCode: normalizeExtensionCode,
    readLocal: readLocal,
    writeLocal: writeLocal,
    readJSON: readJSON,
    writeJSON: writeJSON,
    normalizeTheme: normalizeTheme,
    resolveTheme: resolveTheme,
    resolveAccent: resolveAccent,
    resolveLocale: resolveLocale,
    toast: toast,
    sameOrigin: sameOrigin,
    broadcast: broadcast,
    onBroadcast: onBroadcast
  };
})(window);

/* ===== 10-rpc.js ===== */
/* ==========================================================================
 * NeoWarp Web Runtime — RPC 层
 * 子窗口(iframe 或新标签页) <-> 宿主(顶层页面) 之间的同源远程调用。
 *
 * 两条传输通道，自动择优：
 *   1. window.postMessage —— iframe 页内窗口，以及 window.open 打开且仍持有 opener 的标签页
 *   2. BroadcastChannel  —— 标签页被刷新、或从地址栏直接打开导致 opener 丢失时的兜底
 *
 * 协议：
 *   子 -> 宿  {__nw:1, t:'req', id, ns, m, a}        方法调用
 *   宿 -> 子  {__nw:1, t:'res', id, r}                正常返回
 *   宿 -> 子  {__nw:1, t:'res', id, e}                异常返回
 *   宿 -> 子  {__nw:1, t:'evt', ns, n, d}             事件推送
 *   子 -> 宿  {__nw:1, t:'hello'}                     子窗口就绪
 *   子 -> 宿  {__nw:1, t:'close'}                     请求关闭自己
 *   子 -> 宿  {__nw:1, ch:1, t:'discover'}            询问哪些标签页能当宿主
 *   宿 -> 子  {__nw:1, ch:1, t:'announce', ns:[...]}  声明自己提供的服务
 *   宿 -> 子  {__nw:1, ch:1, t:'bye'}                 宿主页面即将卸载
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  var util = NW.util;

  var isTop = false;
  try {
    isTop = (global === global.top);
  } catch (e) {
    isTop = true;
  }

  var LOCAL_ID = 'w-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  var CHANNEL_NAME = 'neowarp-rpc';

  var pending = Object.create(null);
  var listeners = Object.create(null); // 'ns:event' -> [callback]
  var seq = 0;
  var windowServices = Object.create(null); // opener/parent 宿主声明的服务 -> true

  /* ------------------------- 传输通道 2：BroadcastChannel ------------------------- */
  var channel = null;                    // null=未初始化，false=不支持
  var remoteServices = Object.create(null); // ns -> 宿主 id
  var discovering = null;

  function initChannel () {
    if (channel !== null) return channel;
    if (typeof global.BroadcastChannel !== 'function') {
      channel = false;
      return channel;
    }
    try {
      channel = new global.BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener('message', function (event) {
        onChannelMessage(event.data);
      });
    } catch (e) {
      channel = false;
    }
    return channel;
  }

  function channelPost (message) {
    var ch = initChannel();
    if (!ch) return false;
    try {
      ch.postMessage(Object.assign({ __nw: 1, ch: 1, from: LOCAL_ID }, message));
      return true;
    } catch (e) {
      return false;
    }
  }

  function onChannelMessage (data) {
    if (!data || data.__nw !== 1 || data.ch !== 1) return;
    if (data.from === LOCAL_ID) return;

    if (data.t === 'announce') {
      (data.ns || []).forEach(function (ns) { remoteServices[ns] = data.from; });
      // 窗口宿主也会广播自己的服务清单，据此判断它能否处理某个命名空间
      if (data.from === windowHostId) {
        (data.ns || []).forEach(function (ns) { windowServices[ns] = true; });
      }
      return;
    }

    if (data.t === 'bye') {
      Object.keys(remoteServices).forEach(function (ns) {
        if (remoteServices[ns] === data.from) delete remoteServices[ns];
      });
      return;
    }

    if (data.t === 'res') {
      if (data.to && data.to !== LOCAL_ID) return;
      var entry = pending[data.id];
      if (!entry) return;
      delete pending[data.id];
      settleEntry(entry, data);
      return;
    }

    if (data.t === 'evt') {
      emitLocally(data.ns, data.n, data.d);
    }
  }

  /** 询问同一浏览器里其它标签页是否提供指定服务；250ms 内收集应答 */
  function discover (ns) {
    if (remoteServices[ns]) return Promise.resolve(true);
    if (!initChannel()) return Promise.resolve(false);
    if (discovering) {
      return discovering.then(function () { return !!remoteServices[ns]; });
    }
    channelPost({ t: 'discover' });
    discovering = new Promise(function (resolve) {
      global.setTimeout(resolve, 250);
    }).then(function () {
      discovering = null;
      return true;
    });
    return discovering.then(function () { return !!remoteServices[ns]; });
  }

  /* ------------------------- 传输通道 1：postMessage ------------------------- */
  function emitterKey (ns, name) {
    return ns + ':' + name;
  }

  /* ---------- 宿主窗口：优先 opener（window.open 场景），否则 parent ---------- */
  function resolveHostWindow () {
    try {
      if (global.opener && !global.opener.closed) return global.opener;
    } catch (e) { /* 跨源等情况 */ }
    try {
      if (global.parent && global.parent !== global) return global.parent;
    } catch (e) { /* 跨源等情况 */ }
    return null;
  }

  var windowHostId = null;

  function hasWindowHost () {
    var target = resolveHostWindow();
    try {
      return !!(target && target.NWHost);
    } catch (e) {
      return false;
    }
  }

  /**
   * 窗口宿主（opener/parent）能处理该命名空间时才走 postMessage。
   * 典型场景：扩展编辑器开在独立标签页，opener 是主页，
   * 但 editor.* 服务只存在于另一个标签页的编辑器里 —— 这时必须走广播。
   */
  function windowHostHas (ns) {
    if (!hasWindowHost()) return false;
    if (windowHostId === null) {
      // 还没握到对方 id：先按可用处理，宿主收不到会自动报错
      return true;
    }
    return !!windowServices[ns];
  }

  function postToHost (message) {
    var target = resolveHostWindow();
    if (!target) return false;
    if (!target.NWHost) {
      // 宿主没有运行 NeoWarp 运行时（例如直接静态打开），视为不可用
      return false;
    }
    try {
      target.postMessage(message, global.location.origin);
      return true;
    } catch (e) {
      return false;
    }
  }

  function settleEntry (entry, data) {
    if (Object.prototype.hasOwnProperty.call(data, 'e')) {
      entry.reject(new Error(data.e));
    } else {
      entry.resolve(data.r);
    }
  }

  /**
   * 调用宿主服务
   * @param {string} ns 命名空间，例如 'desktop'
   * @param {string} method 方法名
   * @param {Array} args 参数
   * @param {number} [timeout] 超时（毫秒）
   */
  function call (ns, method, args, timeout) {
    // 先决定走哪条通道：窗口引用可用且能处理该服务时最可靠，否则退回广播发现
    return Promise.resolve().then(function () {
      if (hasWindowHost() && windowHostHas(ns)) return 'window';
      return discover(ns).then(function (found) { return found ? 'channel' : null; });
    }).then(function (transport) {
      if (!transport) throw new Error('宿主不可用: ' + ns + '.' + method);
      return dispatch(transport, ns, method, args, timeout).catch(function (error) {
        // 窗口宿主接不住（服务其实在另一个标签页）时，再走一次广播
        if (transport !== 'window') throw error;
        return discover(ns).then(function (found) {
          if (!found) throw error;
          return dispatch('channel', ns, method, args, timeout);
        });
      });
    });
  }

  function dispatch (transport, ns, method, args, timeout) {
    return new Promise(function (resolve, reject) {
      var id = 'nw-' + (++seq) + '-' + Date.now();
      var timer = global.setTimeout(function () {
        delete pending[id];
        reject(new Error('调用超时: ' + ns + '.' + method));
      }, timeout || 30000);

      pending[id] = {
        resolve: function (value) { global.clearTimeout(timer); resolve(value); },
        reject: function (error) { global.clearTimeout(timer); reject(error); }
      };

      var message = { __nw: 1, t: 'req', id: id, ns: ns, m: method, a: args || [] };
      var sent = transport === 'window'
        ? postToHost(message)
        : channelPost(Object.assign({}, message, { to: remoteServices[ns] }));
      if (!sent) {
        global.clearTimeout(timer);
        delete pending[id];
        reject(new Error('宿主不可用: ' + ns + '.' + method));
      }
    });
  }

  /** 订阅宿主事件 */
  function on (ns, name, callback) {
    var key = emitterKey(ns, name);
    (listeners[key] || (listeners[key] = [])).push(callback);
  }

  function emitLocally (ns, name, data) {
    var key = emitterKey(ns, name);
    (listeners[key] || []).forEach(function (callback) {
      try {
        callback(data);
      } catch (e) {
        console.error('[NeoWarp] 事件处理出错', key, e);
      }
    });
  }

  global.addEventListener('message', function (event) {
    if (!util.sameOrigin(event)) return;
    var data = event.data;
    if (!data || data.__nw !== 1) return;

    if (data.t === 'res') {
      var entry = pending[data.id];
      if (!entry) return;
      delete pending[data.id];
      settleEntry(entry, data);
      return;
    }

    if (data.t === 'evt') {
      emitLocally(data.ns, data.n, data.d);
    }
  });

  NW.rpc = {
    isTop: isTop,
    id: LOCAL_ID,
    call: call,
    on: on,
    emit: emitLocally,
    postToHost: postToHost,
    resolveHostWindow: resolveHostWindow,
    discover: discover,
    channelPost: channelPost,
    initChannel: initChannel,
    isAvailable: function () {
      if (hasWindowHost()) return true;
      return Object.keys(remoteServices).length > 0;
    }
  };

  // 页面一就绪就开始探路，让后续调用不必等待发现过程
  if (!isTop && initChannel()) {
    channelPost({ t: 'discover' });
  }

  // 通知宿主：子窗口已经准备好接收事件
  global.addEventListener('DOMContentLoaded', function () {
    postToHost({ __nw: 1, t: 'hello' });
  });
  if (global.document && global.document.readyState !== 'loading') {
    postToHost({ __nw: 1, t: 'hello' });
  }
})(window);

/* ===== 20-storage.js ===== */
/* ==========================================================================
 * NeoWarp Web Runtime — 存储层
 * 桌面版 tw_config.json / 磁盘文件的浏览器等价实现：
 *   - 设置统一落在 localStorage 的 neowarp:settings
 *   - AI 模型配置落在 neowarp:ai-model-configs（与 AI 助手 / 桌面设置 / 扩展编辑器共用）
 *   - 扩展编辑器的工程文件落在 IndexedDB 虚拟文件系统
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  var util = NW.util;

  var SETTINGS_KEY = 'neowarp:settings';
  var AI_CONFIGS_KEY = 'neowarp:ai-model-configs';
  var AI_ACTIVE_KEY = 'neowarp:ai-active-config-id';

  /* ----------------------------- 通用设置 ----------------------------- */
  var DEFAULT_SETTINGS = {
    updateChecker: 'startup',
    uiTheme: 'system',
    microphone: null,
    camera: null,
    hardwareAcceleration: true,
    backgroundThrottling: true,
    bypassCORS: true,
    spellchecker: false,
    exitFullscreenOnEscape: true,
    richPresence: false,
    showRecentProjects: true,
    topBarDeviceStats: false,
    homeLogoText: 'NeoWarp'
  };

  function getSettings () {
    var stored = util.readJSON(SETTINGS_KEY, {});
    var merged = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
      merged[key] = Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : DEFAULT_SETTINGS[key];
    });
    Object.keys(stored).forEach(function (key) {
      if (!(key in merged)) merged[key] = stored[key];
    });
    return merged;
  }

  function setSetting (key, value) {
    var current = getSettings();
    current[key] = value;
    util.writeJSON(SETTINGS_KEY, current);
    NW.storage.emitSettingsChanged(key, value);
    return true;
  }

  var settingsListeners = [];
  function onSettingsChanged (listener) {
    settingsListeners.push(listener);
  }
  function emitSettingsChanged (key, value) {
    settingsListeners.forEach(function (listener) {
      try { listener(key, value); } catch (e) { /* 忽略 */ }
    });
  }

  /* --------------------------- AI 模型配置 --------------------------- */
  var CONFIG_FIELDS = [
    'id', 'name', 'provider', 'model', 'apiKey', 'apiFormat',
    'customEndpoint', 'customModelId', 'customContextLimit', 'thinkingLevel'
  ];

  function normalizeConfig (raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var cfg = {};
    CONFIG_FIELDS.forEach(function (field) {
      if (raw[field] !== undefined && raw[field] !== null) cfg[field] = raw[field];
    });
    if (typeof cfg.id !== 'string' || !cfg.id) cfg.id = 'cfg_' + Date.now() + '_' + (index || 0);
    if (typeof cfg.provider !== 'string' || !cfg.provider) cfg.provider = 'openai';
    if (typeof cfg.name !== 'string') cfg.name = '';
    if (typeof cfg.model !== 'string') cfg.model = '';
    if (typeof cfg.apiKey !== 'string') cfg.apiKey = '';
    if (cfg.apiFormat !== 'anthropic' && cfg.apiFormat !== 'ollama' && cfg.apiFormat !== 'custom') {
      cfg.apiFormat = 'openai';
    }
    if (typeof cfg.customEndpoint !== 'string') cfg.customEndpoint = '';
    if (typeof cfg.customModelId !== 'string') cfg.customModelId = '';
    var contextLimit = Number(cfg.customContextLimit);
    cfg.customContextLimit = isFinite(contextLimit) && contextLimit >= 1000 ? Math.floor(contextLimit) : 32000;
    if (typeof cfg.thinkingLevel !== 'string' || !cfg.thinkingLevel) cfg.thinkingLevel = 'medium';
    return cfg;
  }

  function getAiModelConfigs () {
    var list = util.readJSON(AI_CONFIGS_KEY, []) || [];
    var configs = (Array.isArray(list) ? list : []).map(normalizeConfig).filter(Boolean);
    var storedActive = util.readLocal(AI_ACTIVE_KEY, null);
    var activeId = null;
    if (storedActive && configs.some(function (cfg) { return cfg.id === storedActive; })) {
      activeId = storedActive;
    } else if (configs.length) {
      activeId = configs[0].id;
    }
    return { configs: configs, activeId: activeId };
  }

  function saveAiModelConfigs (payload) {
    var input = payload || {};
    var list = input.configs === undefined || input.configs === null
      ? getAiModelConfigs().configs
      : input.configs;
    var configs = (Array.isArray(list) ? list : []).map(normalizeConfig).filter(Boolean);
    var activeId = typeof input.activeId === 'string' ? input.activeId : null;
    if (!activeId || !configs.some(function (cfg) { return cfg.id === activeId; })) {
      activeId = configs.length ? configs[0].id : null;
    }
    util.writeJSON(AI_CONFIGS_KEY, configs);
    util.writeLocal(AI_ACTIVE_KEY, activeId);
    var result = { configs: configs, activeId: activeId };
    emitAiConfigsChanged(result);
    return result;
  }

  var aiConfigListeners = [];
  function onAiConfigsChanged (listener) {
    aiConfigListeners.push(listener);
  }
  function emitAiConfigsChanged (payload) {
    aiConfigListeners.forEach(function (listener) {
      try { listener(payload); } catch (e) { /* 忽略 */ }
    });
  }

  /* ------------------------ 虚拟文件系统(IndexedDB) ------------------------ */
  var VFS_DB = 'neowarp-web-vfs';
  var VFS_STORE = 'files';
  var PENDING_DB = 'neowarp-web';
  var PENDING_STORE = 'pending-files';

  function openDB (name, version, storeName) {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error('当前环境不支持 IndexedDB'));
        return;
      }
      var request = global.indexedDB.open(name, version);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function idbPut (db, storeName, value, key) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function vfsPut (path, content) {
    return openDB(VFS_DB, 1, VFS_STORE).then(function (db) {
      return idbPut(db, VFS_STORE, { path: path, content: content, updatedAt: Date.now() }, path)
        .then(function () { db.close(); return true; }, function (error) { db.close(); throw error; });
    });
  }

  function vfsList () {
    return openDB(VFS_DB, 1, VFS_STORE).then(function (db) {
      return new Promise(function (resolve) {
        var request = db.transaction(VFS_STORE, 'readonly').objectStore(VFS_STORE).getAll();
        request.onsuccess = function () {
          db.close();
          resolve(request.result || []);
        };
        request.onerror = function () { db.close(); resolve([]); };
      });
    }).catch(function () { return []; });
  }

  function vfsDelete (path) {
    return openDB(VFS_DB, 1, VFS_STORE).then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(VFS_STORE, 'readwrite');
        tx.objectStore(VFS_STORE).delete(path);
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); resolve(false); };
      });
    }).catch(function () { return false; });
  }

  /* --------------------- 主页 -> 编辑器 的待打开文件 --------------------- */
  function putPendingFile (payload) {
    return openDB(PENDING_DB, 1, PENDING_STORE).then(function (db) {
      return idbPut(db, PENDING_STORE, payload, 'pending')
        .then(function () { db.close(); return true; }, function () { db.close(); return false; });
    }).catch(function () { return false; });
  }

  function takePendingFile () {
    return openDB(PENDING_DB, 1, PENDING_STORE).then(function (db) {
      return new Promise(function (resolve) {
        var value = null;
        var tx = db.transaction(PENDING_STORE, 'readwrite');
        var store = tx.objectStore(PENDING_STORE);
        var request = store.get('pending');
        request.onsuccess = function () {
          value = request.result || null;
          store.delete('pending');
        };
        tx.oncomplete = function () { db.close(); resolve(value); };
        tx.onerror = function () { db.close(); resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function clearPendingFile () {
    return takePendingFile().then(function () { return true; });
  }

  NW.storage = {
    getSettings: getSettings,
    setSetting: setSetting,
    onSettingsChanged: onSettingsChanged,
    emitSettingsChanged: emitSettingsChanged,

    getAiModelConfigs: getAiModelConfigs,
    saveAiModelConfigs: saveAiModelConfigs,
    onAiConfigsChanged: onAiConfigsChanged,
    emitAiConfigsChanged: emitAiConfigsChanged,

    vfsPut: vfsPut,
    vfsList: vfsList,
    vfsDelete: vfsDelete,
    putPendingFile: putPendingFile,
    takePendingFile: takePendingFile,
    clearPendingFile: clearPendingFile,
    normalizeAiConfig: normalizeConfig
  };
})(window);

/* ===== 30-host.js ===== */
/* ==========================================================================
 * NeoWarp Web Runtime — 宿主层
 * 桌面版 Electron 主进程的浏览器等价实现：运行在顶层页面，
 * 通过 namespace.method 的形式向所有子窗口提供服务。
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  var util = NW.util;
  var storage = NW.storage;

  var services = Object.create(null);     // ns -> 服务对象
  var windows = new Map();                // 子窗口的 contentWindow -> 句柄信息
  var readyFrames = new Set();            // 已完成握手的 contentWindow

  function register (ns, impl) {
    services[ns] = Object.assign(services[ns] || {}, impl);
    // 服务清单变化后主动广播，让新打开的标签页能立刻发现
    announce();
  }

  /** 声明本标签页提供的服务，供其它标签页路由 */
  function announce () {
    if (!NW.rpc || !NW.rpc.channelPost) return;
    if (!(NW.rpc.isTop)) return; // 只有顶层页面充当跨标签页宿主
    try {
      NW.rpc.channelPost({ t: 'announce', ns: Object.keys(services) });
    } catch (e) { /* 忽略 */ }
  }

  function has (ns) {
    return !!services[ns];
  }

  /**
   * 向所有子窗口推送事件（页内 iframe + 其它标签页）
   * @param {string} ns 命名空间
   * @param {string} name 事件名
   * @param {*} data 数据
   * @param {Window} [except] 需要跳过的窗口
   */
  function emit (ns, name, data, except) {
    windows.forEach(function (info, frameWindow) {
      if (frameWindow === except) return;
      try {
        frameWindow.postMessage({ __nw: 1, t: 'evt', ns: ns, n: name, d: data }, global.location.origin);
      } catch (e) { /* 窗口已销毁 */ }
    });
    if (NW.rpc && NW.rpc.channelPost) {
      NW.rpc.channelPost({ t: 'evt', ns: ns, n: name, d: data });
    }
  }

  function postResult (source, id, result) {
    try {
      source.postMessage({ __nw: 1, t: 'res', id: id, r: result === undefined ? null : result }, global.location.origin);
    } catch (e) { /* 忽略 */ }
  }

  function postError (source, id, error) {
    try {
      source.postMessage({ __nw: 1, t: 'res', id: id, e: String((error && error.message) || error) }, global.location.origin);
    } catch (e) { /* 忽略 */ }
  }

  async function handleRequest (event, data) {
    var service = services[data.ns];
    if (!service) {
      postError(event.source, data.id, new Error('宿主未提供服务: ' + data.ns));
      return;
    }
    var method = service[data.m];
    if (typeof method !== 'function') {
      postError(event.source, data.id, new Error('宿主未提供方法: ' + data.ns + '.' + data.m));
      return;
    }
    try {
      postResult(event.source, data.id, await method.apply(service, data.a || []));
    } catch (error) {
      console.error('[NeoWarp] ' + data.ns + '.' + data.m + ' 执行失败', error);
      postError(event.source, data.id, error);
    }
  }

  function trackFrame (frameWindow, handle) {
    windows.set(frameWindow, handle || {});
  }

  function untrackFrame (frameWindow) {
    windows.delete(frameWindow);
    readyFrames.delete(frameWindow);
  }

  /* ------------------------ 跨标签页：BroadcastChannel ------------------------ */
  /**
   * 桌面版里 AI 助手、扩展编辑器都是独立窗口，靠主进程共享编辑器。
   * 网页版若把它们开在新标签页，就没有共同宿主了，这里让顶层页面
   * 通过 BroadcastChannel 兼职提供服务（例如 editor.getProjectCode）。
   */
  function handleChannelRequest (data) {
    var service = services[data.ns];
    if (!service) return; // 本标签页没有该服务，交给其它标签页应答
    var method = service[data.m];
    if (typeof method !== 'function') {
      channelError(data, new Error('宿主未提供方法: ' + data.ns + '.' + data.m));
      return;
    }
    Promise.resolve()
      .then(function () { return method.apply(service, data.a || []); })
      .then(function (result) {
        channelResult(data, result === undefined ? null : result);
      }, function (error) {
        console.error('[NeoWarp] ' + data.ns + '.' + data.m + ' 执行失败', error);
        channelError(data, error);
      });
  }

  function channelResult (data, result) {
    if (!NW.rpc || !NW.rpc.channelPost) return;
    NW.rpc.channelPost({ t: 'res', id: data.id, r: result, to: data.from });
  }

  function channelError (data, error) {
    if (!NW.rpc || !NW.rpc.channelPost) return;
    NW.rpc.channelPost({ t: 'res', id: data.id, e: String((error && error.message) || error), to: data.from });
  }

  function initHostChannel () {
    if (!NW.rpc || !NW.rpc.initChannel) return;
    var rpc = NW.rpc;
    var channel = rpc.initChannel();
    if (!channel) return;
    if (!rpc.isTop) return;

    // 收到子页面探路 -> 声明服务；收到调用 -> 执行并回包
    rpc.onChannelHostMessage = function (data) {
      if (!data || data.__nw !== 1 || data.ch !== 1) return;
      if (data.from === rpc.id) return;
      if (data.t === 'discover') {
        announce();
        return;
      }
      if (data.t === 'req') {
        handleChannelRequest(data);
      }
    };
    channel.addEventListener('message', function (event) {
      rpc.onChannelHostMessage(event.data);
    });

    // 页面关闭时让其它标签页立即失效，避免调用打到已卸载的宿主
    global.addEventListener('pagehide', function () {
      try {
        rpc.channelPost({ t: 'bye' });
      } catch (e) { /* 忽略 */ }
    });

    announce();
  }

  global.addEventListener('message', function (event) {
    if (!util.sameOrigin(event)) return;
    var data = event.data;
    if (!data || data.__nw !== 1) return;

    if (data.t === 'req') {
      handleRequest(event, data);
      return;
    }

    if (data.t === 'hello') {
      readyFrames.add(event.source);
      trackFrame(event.source);
      // 把自己的服务清单回给子窗口，让它能判断哪些调用可以交给 opener/parent
      try {
        event.source.postMessage({
          __nw: 1, ch: 1, t: 'announce', from: NW.rpc ? NW.rpc.id : null, ns: Object.keys(services)
        }, global.location.origin);
      } catch (e) { /* 忽略 */ }
      return;
    }

    if (data.t === 'close') {
      // 子窗口请求关闭自身：交给窗口管理器处理
      if (global.NWWindow && global.NWWindow.closeByFrame) {
        global.NWWindow.closeByFrame(event.source);
      }
      return;
    }
  });

  /* --------------------------- 桌面级通用服务 --------------------------- */
  register('desktop', {
    getTheme: function () { return util.resolveTheme(); },
    getAccent: function () { return util.resolveAccent(); },
    getLocale: function () { return util.resolveLocale(); },
    getSettings: function () { return storage.getSettings(); },
    setSetting: function (key, value) { return storage.setSetting(key, value); },

    getAiModelConfigs: function () { return storage.getAiModelConfigs(); },
    saveAiModelConfigs: function (payload) { return storage.saveAiModelConfigs(payload); },

    enumerateMediaDevices: async function () {
      try {
        if (!global.navigator.mediaDevices || !global.navigator.mediaDevices.enumerateDevices) return [];
        var devices = await global.navigator.mediaDevices.enumerateDevices();
        return devices.map(function (device) {
          return { deviceId: device.deviceId, kind: device.kind, label: device.label };
        });
      } catch (e) {
        return [];
      }
    },

    toast: function (message) {
      util.toast(message);
      return true;
    },

    openUserData: function () {
      util.toast('网页版的数据保存在浏览器存储中\n可在设置页导出备份');
      return true;
    }
  });

  /* --------------- 主题 / AI 配置变更 -> 广播给所有子窗口 --------------- */
  var lastTheme = util.resolveTheme();
  var lastAccent = util.resolveAccent();
  var lastLocale = util.resolveLocale();

  function notifyAppearanceChanged () {
    var theme = util.resolveTheme();
    var accent = util.resolveAccent();
    var locale = util.resolveLocale();
    if (theme !== lastTheme || accent !== lastAccent) {
      lastTheme = theme;
      lastAccent = accent;
      emit('desktop', 'theme', { theme: theme, accent: accent });
    }
    if (locale !== lastLocale) {
      lastLocale = locale;
      emit('desktop', 'locale', { locale: locale });
    }
  }

  global.addEventListener('storage', function (event) {
    if (event.key === 'tw:theme' || event.key === 'tw:locale') notifyAppearanceChanged();
  });

  storage.onAiConfigsChanged(function (payload) {
    emit('desktop', 'aiModelConfigs', payload);
  });

  NW.host = {
    register: register,
    has: has,
    emit: emit,
    announce: announce,
    trackFrame: trackFrame,
    untrackFrame: untrackFrame,
    notifyAppearanceChanged: notifyAppearanceChanged,

    /** 根据 iframe 的 contentWindow 找出它所属窗口的 key */
    findKeyByFrame: function (frameWindow) {
      var result = null;
      windows.forEach(function (info, tracked) {
        if (tracked === frameWindow && info && info.key) result = info.key;
      });
      return result;
    }
  };

  global.NWHost = NW.host;

  initHostChannel();
})(window);

/* ===== 35-extepop.js ===== */
/* ==========================================================================
 * NeoWarp 网页版 — AI 面板弹窗服务（宿主侧）
 * 扩展编辑器的 AI 面板可以弹出为独立窗口。网页版里该窗口由宿主创建，
 * 宿主充当双方的交换机：缓存弹窗初始化状态、转发达代码/插入代码请求。
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  var util = NW.util;

  // 仅在宿主（顶层页面）注册
  if (!NW.host) return;

  var state = {
    initial: null,
    popoutKey: 'ext-ai-popout'
  };

  NW.host.register('extepop', {
    open: function (initialState) {
      state.initial = initialState || null;
      var url = new URL('../extension-editor/ai-panel.html', global.location.href).href;
      if (global.NWWindow) {
        if (global.NWWindow.has(state.popoutKey)) {
          global.NWWindow.focus(state.popoutKey);
        } else {
          global.NWWindow.open({
            key: state.popoutKey,
            url: url,
            title: 'AI 助手',
            width: 460,
            height: 760,
            minWidth: 360,
            minHeight: 420
          });
        }
        return true;
      }
      global.open(url, '_blank');
      return true;
    },

    getInitial: function () {
      return state.initial;
    },

    /** AI 面板 -> 扩展编辑器：取当前编辑器里的代码 */
    getCode: function () {
      return requestEditor('getCode', {}, 30000);
    },

    insertCode: function (code) {
      return requestEditor('insertCode', { code: code }, 30000);
    },

    replaceCode: function (code) {
      return requestEditor('replaceCode', { code: code }, 30000);
    },

    reportState: function (nextState) {
      state.initial = nextState || null;
      return true;
    },

    dockBack: function (nextState) {
      NW.host.emit('extepop', 'popoutClosed', nextState || null);
      if (global.NWWindow) global.NWWindow.close(state.popoutKey);
      state.initial = null;
      return true;
    }
  });

  /* -------------------- 宿主 -> 扩展编辑器 的请求转发 -------------------- */
  var editorPending = new Map();
  var editorSeq = 0;

  function requestEditor (kind, payload, timeout) {
    return new Promise(function (resolve, reject) {
      if (!hasExtensionEditor()) {
        reject(new Error('扩展编辑器窗口未打开'));
        return;
      }
      var requestId = 'expop-' + (++editorSeq) + '-' + Date.now();
      var timer = global.setTimeout(function () {
        editorPending.delete(requestId);
        reject(new Error('扩展编辑器响应超时'));
      }, timeout || 30000);
      editorPending.set(requestId, { resolve: resolve, timer: timer });
      NW.host.emit('extepop', 'editorRequest', {
        requestId: requestId,
        kind: kind,
        payload: payload || {}
      });
    });
  }

  function hasExtensionEditor () {
    if (!global.NWWindow) return false;
    return global.NWWindow.has('extension-editor');
  }

  NW.host.resolveEditorResponse = function (requestId, result) {
    var entry = editorPending.get(requestId);
    if (!entry) return false;
    editorPending.delete(requestId);
    global.clearTimeout(entry.timer);
    entry.resolve(result);
    return true;
  };

  // 供扩展编辑器通过 RPC 回报执行结果
  NW.host.register('extepop', {
    respondEditor: function (requestId, result) {
      return NW.host.resolveEditorResponse(requestId, result);
    }
  });
})(window);

/* ===== 36-app-windows.js ===== */
/* ==========================================================================
 * NeoWarp Web Runtime — 应用窗口清单与路由
 * 桌面版由主进程 new BrowserWindow 打开的页面，网页版统一登记在这里，
 * 由宿主按需以页内窗口的形式打开（主页、编辑器共用同一份清单）。
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  var util = NW.util;

  var ROUTES = {
    /* 主页入口一律走独立标签页（等价桌面版再开一个应用窗口），
       唯一的例外是右下角的「设置」——它保持在页内浮层窗口。 */
    'editor': { url: 'gui/gui.html', title: 'NeoWarp', newTab: true },
    'desktop-settings': { url: 'desktop-settings/desktop-settings.html', title: '设置', width: 1020, height: 720, resizable: false, minimizable: false, maximizable: false },
    'ai-assistant': { url: 'ai/ai-assistant.html', title: 'AI 助手', newTab: true },
    'extension-editor': { url: 'extension-editor/extension-editor.html', title: '扩展编辑器', newTab: true },
    'image-editor': { url: 'image-editor/index.html', title: '图片编辑器', newTab: true },
    'todo-list': { url: 'todo-list/todo-list.html', title: '待办清单', newTab: true },
    'task-manager': { url: 'task-manager/task-manager.html', title: '任务管理器', newTab: true },
    'project-analysis': { url: 'project-analysis/project-analysis.html', title: '工程分析', newTab: true },
    'mobile-preview': { url: 'mobile-preview/mobile-preview.html', title: '手机预览', newTab: true },
    'about': { url: 'about/about.html', title: '关于 NeoWarp', newTab: true },
    'privacy': { url: 'privacy/privacy.html', title: '隐私设置', newTab: true },
    'contact': { url: 'contact/contact.html', title: '联系我们', newTab: true },
    'packager': { url: 'gui/migrate-helper.html', title: '打包器', newTab: true },
    'detached-stage': { url: 'detached-stage/index.html', title: '分离舞台', newTab: true },
    'addons': { url: 'addons/addons.html', title: '附加组件设置', newTab: true }
  };

  function openRoute (key, options) {
    var route = ROUTES[key];
    if (!route) return null;
    var merged = Object.assign({}, route);
    delete merged.url;
    Object.assign(merged, options || {});

    if (typeof merged.width === 'number') {
      merged.width = Math.min(merged.width, global.innerWidth - 32);
    }
    if (typeof merged.height === 'number') {
      merged.height = Math.min(merged.height, global.innerHeight - 32);
    }

    /* 独立标签页模式：与桌面版「再开一个应用窗口」最接近。
       刻意保留 opener —— 跨标签页 RPC 优先走它，广播只作兜底。 */
    if (merged.newTab) {
      var tab = global.open(util.resolveAppPath(route.url), '_blank');
      if (!tab) {
        // 弹窗被拦截时退回当前页跳转，至少保证功能可达
        global.location.href = util.resolveAppPath(route.url);
        return null;
      }
      return { key: key, newTab: true, tab: tab };
    }

    if (global.NWWindow) {
      return global.NWWindow.open(Object.assign({ key: key }, merged, { url: util.resolveAppPath(route.url) }));
    }
    global.open(util.resolveAppPath(route.url), '_blank');
    return null;
  }

  NW.routes = ROUTES;
  NW.openRoute = openRoute;
  global.NWOpenRoute = openRoute;

  if (NW.host) {
    NW.host.register('desktop', {
      openWindow: function (key, options) {
        return !!openRoute(key, options);
      },
      openDesktopSettings: function () {
        return !!openRoute('desktop-settings');
      },
      openExtensionEditor: function () {
        return !!openRoute('extension-editor');
      },
      openImageEditor: function () {
        return !!openRoute('image-editor');
      },
      openAI: function () {
        return !!openRoute('ai-assistant');
      },
      openEditor: function () {
        return !!openRoute('editor');
      }
    });
  }
})(window);

/* ===== 40-window-manager.js ===== */
/* ==========================================================================
 * NeoWarp Web Runtime — 页内窗口管理器
 * 用同源 iframe + 浮层还原桌面版的独立窗口体验：
 * 拖拽、八向缩放、最大化/还原、最小化到 Dock、层级管理、开合动画、位置记忆。
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  var util = NW.util;

  var instances = new Map();   // key -> handle
  var zTop = 100000;
  var activeKey = null;
  var seq = 0;

  var GEOMETRY_KEY = 'neowarp:window-geometry';

  function readGeometry () {
    return util.readJSON(GEOMETRY_KEY, {});
  }

  function writeGeometry (key, geometry) {
    var all = readGeometry();
    all[key] = geometry;
    util.writeJSON(GEOMETRY_KEY, all);
  }

  /* ------------------------------ 样式 ------------------------------ */
  var CSS = [
    '.nw-app-window{position:fixed;z-index:auto;contain:layout style;}',
    '.nw-app-window__panel{position:absolute;display:flex;flex-direction:column;overflow:hidden;',
    '  background:var(--nw-win-bg,#1b1b20);color:var(--nw-win-fg,#f5f5f7);',
    '  border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 .5px rgba(255,255,255,.09);',
    '  transition:transform .26s cubic-bezier(.22,1,.36,1),opacity .2s ease;',
    '  transform-origin:center center;}',
    '.nw-app-window--closing .nw-app-window__panel{opacity:0;transform:scale(.96);}',
    '.nw-app-window--minimized .nw-app-window__panel{opacity:0;transform:scale(.9) translateY(24px);pointer-events:none;}',
    '.nw-app-window--opening .nw-app-window__panel{animation:nw-win-in .26s cubic-bezier(.22,1,.36,1);}',
    '@keyframes nw-win-in{from{opacity:0;transform:scale(.97) translateY(10px);}to{opacity:1;transform:none;}}',

    '.nw-app-window__bar{position:relative;display:flex;align-items:center;gap:10px;height:38px;flex:0 0 auto;',
    '  padding:0 12px;background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.03));',
    '  border-bottom:.5px solid rgba(255,255,255,.1);cursor:default;user-select:none;}',
    'html[data-theme="light"] .nw-app-window__bar{background:linear-gradient(180deg,#f6f6f8,#ececed);',
    '  border-bottom:.5px solid rgba(0,0,0,.1);}',
    '.nw-app-window--bare .nw-app-window__bar{display:none;}',

    '.nw-lights{display:flex;align-items:center;gap:8px;flex:0 0 auto;}',
    '.nw-light{width:12px;height:12px;border-radius:50%;border:none;padding:0;cursor:pointer;position:relative;',
    '  box-shadow:inset 0 0 0 .5px rgba(0,0,0,.18);transition:filter .15s ease;}',
    '.nw-light:hover{filter:brightness(1.15);}',
    '.nw-light--close{background:#ff5f57;}',
    '.nw-light--min{background:#febc2e;}',
    '.nw-light--max{background:#28c840;}',
    '.nw-light--disabled{background:rgba(128,128,128,.35);cursor:default;}',
    '.nw-lights__glyph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
    '  font-size:9px;line-height:1;color:rgba(0,0,0,.55);opacity:0;}',
    '.nw-lights:hover .nw-lights__glyph{opacity:1;}',

    '.nw-app-window__title{flex:1 1 auto;text-align:center;font-size:13px;font-weight:600;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.9;}',
    '.nw-app-window__spacer{width:52px;flex:0 0 auto;}',
    '.nw-app-window__frame{flex:1 1 auto;width:100%;height:100%;border:none;background:#fff;display:block;}',
    'html[data-theme="light"] .nw-app-window__frame{background:#fff;}',
    'html:not([data-theme="light"]) .nw-app-window__frame{background:var(--nw-win-bg,#1b1b20);}',

    '.nw-resize{position:absolute;z-index:5;}',
    '.nw-resize--n{top:-3px;left:8px;right:8px;height:6px;cursor:ns-resize;}',
    '.nw-resize--s{bottom:-3px;left:8px;right:8px;height:6px;cursor:ns-resize;}',
    '.nw-resize--w{left:-3px;top:8px;bottom:8px;width:6px;cursor:ew-resize;}',
    '.nw-resize--e{right:-3px;top:8px;bottom:8px;width:6px;cursor:ew-resize;}',
    '.nw-resize--nw{left:-3px;top:-3px;width:14px;height:14px;cursor:nwse-resize;}',
    '.nw-resize--ne{right:-3px;top:-3px;width:14px;height:14px;cursor:nesw-resize;}',
    '.nw-resize--sw{left:-3px;bottom:-3px;width:14px;height:14px;cursor:nesw-resize;}',
    '.nw-resize--se{right:-3px;bottom:-3px;width:14px;height:14px;cursor:nwse-resize;}',

    /* Dock */
    '.nw-dock{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:flex-end;gap:10px;',
    '  padding:8px 12px;border-radius:18px;z-index:2147483000;',
    '  background:rgba(28,28,32,.62);border:.5px solid rgba(255,255,255,.14);',
    '  box-shadow:0 18px 46px rgba(0,0,0,.5);backdrop-filter:blur(24px) saturate(180%);',
    '  -webkit-backdrop-filter:blur(24px) saturate(180%);}',
    '.nw-dock:empty{display:none;}',
    '.nw-dock__item{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;width:132px;',
    '  padding:8px 6px 6px;border:none;border-radius:12px;background:transparent;color:inherit;cursor:pointer;',
    '  font-size:11px;line-height:1.2;transition:background .15s ease,transform .15s ease;}',
    '.nw-dock__item:hover{background:rgba(255,255,255,.12);transform:translateY(-2px);}',
    '.nw-dock__label{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.nw-dock__dot{position:absolute;bottom:-1px;left:50%;transform:translateX(-50%);width:4px;height:4px;',
    '  border-radius:50%;background:currentColor;opacity:.75;}',
    '.nw-dock__square{width:34px;height:26px;border-radius:5px;border:1.5px solid currentColor;opacity:.8;}',
    '.nw-app-window--hidden,.nw-app-window--hidden .nw-app-window__panel{display:none;}'
  ].join('\n');

  function ensureStyles () {
    if (global.document.getElementById('nw-window-style')) return;
    var style = global.document.createElement('style');
    style.id = 'nw-window-style';
    style.textContent = CSS;
    (global.document.head || global.document.documentElement).appendChild(style);
  }

  /* ------------------------------ Dock ------------------------------ */
  var dockEl = null;

  function ensureDock () {
    if (dockEl) return dockEl;
    dockEl = global.document.createElement('div');
    dockEl.className = 'nw-dock';
    global.document.body.appendChild(dockEl);
    return dockEl;
  }

  function renderDock () {
    var dock = ensureDock();
    dock.textContent = '';
    instances.forEach(function (handle) {
      var muted = activeKey === handle.key && !handle.isMinimized();
      var item = global.document.createElement('button');
      item.type = 'button';
      item.className = 'nw-dock__item';
      item.title = handle.title;
      item.setAttribute('aria-label', handle.title);

      var square = global.document.createElement('span');
      square.className = 'nw-dock__square';

      var label = global.document.createElement('span');
      label.className = 'nw-dock__label';
      label.textContent = handle.title;

      item.appendChild(square);
      item.appendChild(label);
      if (muted) {
        var dot = global.document.createElement('span');
        dot.className = 'nw-dock__dot';
        item.appendChild(dot);
      }

      item.addEventListener('click', function () {
        if (handle.isMinimized()) handle.restore();
        else handle.minimize();
      });

      dock.appendChild(item);
    });
  }

  /* --------------------------- 工具函数 --------------------------- */
  function clamp (value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function defaultSize (options) {
    var viewportWidth = global.innerWidth;
    var viewportHeight = global.innerHeight;
    var width = options.width || Math.round(Math.min(1080, viewportWidth * 0.8));
    var height = options.height || Math.round(Math.min(760, viewportHeight * 0.82));
    return {
      width: Math.max(options.minWidth || 320, Math.min(width, viewportWidth - 24)),
      height: Math.max(options.minHeight || 200, Math.min(height, viewportHeight - 24))
    };
  }

  function centerPosition (width, height) {
    return {
      left: Math.round(Math.max(12, (global.innerWidth - width) / 2)),
      top: Math.round(Math.max(12, (global.innerHeight - height) / 2.4))
    };
  }

  /**
   * 打开一个页内窗口
   * @param {object} options
   *   key      窗口唯一标识（重复打开会聚焦已存在的实例）
   *   title    标题
   *   url      内容地址
   *   width / height  初始尺寸
   *   minWidth / minHeight
   *   resizable  是否可缩放（默认 true）
   *   maximizable 是否可最大化（默认 true）
   *   minimizable 是否可最小化（默认 true）
   *   bare     隐藏标题栏（自带标题的页面）
   *   singleton 是否单例（默认 true）
   *   onClose  关闭回调
   *   onMessage 收到子窗口 postMessage 业务消息时的回调
   */
  function open (options) {
    ensureStyles();
    var key = options.key || ('nw-window-' + (++seq));

    if (options.singleton !== false && instances.has(key)) {
      var existing = instances.get(key);
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return existing;
    }

    var size = defaultSize(options);
    var saved = options.remember !== false ? readGeometry()[key] : null;
    var geometry = Object.assign(centerPosition(size.width, size.height), size);
    if (saved && saved.width && saved.height) {
      geometry.left = clamp(saved.left || geometry.left, 0, Math.max(0, global.innerWidth - saved.width));
      geometry.top = clamp(saved.top || geometry.top, 0, Math.max(0, global.innerHeight - saved.height));
      geometry.width = saved.width;
      geometry.height = saved.height;
      geometry.maximized = !!saved.maximized;
    } else {
      geometry.maximized = !!options.maximized;
    }

    var root = global.document.createElement('div');
    root.className = 'nw-app-window nw-app-window--opening';
    if (options.bare) root.classList.add('nw-app-window--bare');
    if (options.className) root.classList.add(options.className);
    root.style.inset = '0';
    root.style.pointerEvents = 'none';

    var panel = global.document.createElement('div');
    panel.className = 'nw-app-window__panel';
    panel.style.pointerEvents = 'auto';
    panel.style.left = geometry.left + 'px';
    panel.style.top = geometry.top + 'px';
    panel.style.width = geometry.width + 'px';
    panel.style.height = geometry.height + 'px';

    var bar = global.document.createElement('div');
    bar.className = 'nw-app-window__bar';

    var lights = global.document.createElement('div');
    lights.className = 'nw-lights';
    lights.innerHTML =
      '<button class="nw-light nw-light--close" type="button" aria-label="关闭"><span class="nw-lights__glyph">✕</span></button>' +
      '<button class="nw-light nw-light--min" type="button" aria-label="最小化"><span class="nw-lights__glyph">−</span></button>' +
      '<button class="nw-light nw-light--max" type="button" aria-label="最大化"><span class="nw-lights__glyph">⤢</span></button>';

    var titleEl = global.document.createElement('div');
    titleEl.className = 'nw-app-window__title';
    titleEl.textContent = options.title || '';

    bar.appendChild(lights);
    bar.appendChild(titleEl);

    // 右侧留白，保证标题始终居中（与左侧三个圆点等宽）
    var spacer = global.document.createElement('div');
    spacer.className = 'nw-app-window__spacer';
    bar.appendChild(spacer);

    var frame = global.document.createElement('iframe');
    frame.className = 'nw-app-window__frame';
    frame.setAttribute('allow', 'clipboard-read; clipboard-write; microphone; camera; fullscreen; autoplay; display-capture');
    frame.setAttribute('title', options.title || '');
    frame.src = options.url;

    panel.appendChild(bar);
    panel.appendChild(frame);

    if (options.resizable !== false) {
      ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(function (dir) {
        var handle = global.document.createElement('div');
        handle.className = 'nw-resize nw-resize--' + dir;
        handle.dataset.dir = dir;
        panel.appendChild(handle);
      });
    }

    root.appendChild(panel);
    (global.document.body || global.document.documentElement).appendChild(root);

    // 让布局生效后再去除入场动画类
    global.setTimeout(function () { root.classList.remove('nw-app-window--opening'); }, 300);

    var closeLight = lights.querySelector('.nw-light--close');
    var minLight = lights.querySelector('.nw-light--min');
    var maxLight = lights.querySelector('.nw-light--max');

    var state = {
      key: key,
      root: root,
      panel: panel,
      frame: frame,
      title: options.title || '',
      minimized: false,
      maximized: !!geometry.maximized,
      closed: false,
      restoreGeometry: { left: geometry.left, top: geometry.top, width: geometry.width, height: geometry.height }
    };

    function applyGeometry (next) {
      panel.style.left = next.left + 'px';
      panel.style.top = next.top + 'px';
      panel.style.width = next.width + 'px';
      panel.style.height = next.height + 'px';
    }

    /* 初始即为最大化时，直接铺满视口 */
    if (state.maximized) {
      applyGeometry({
        left: 8,
        top: 8,
        width: global.innerWidth - 16,
        height: global.innerHeight - 16
      });
    }

    function persist () {
      if (options.remember === false) return;
      writeGeometry(key, {
        left: parseInt(panel.style.left, 10) || 0,
        top: parseInt(panel.style.top, 10) || 0,
        width: panel.offsetWidth,
        height: panel.offsetHeight,
        maximized: state.maximized
      });
    }

    function close () {
      if (state.closed) return;
      state.closed = true;
      root.classList.add('nw-app-window--closing');
      instances.delete(key);
      if (NW.host) NW.host.untrackFrame(frame.contentWindow);
      global.setTimeout(function () {
        if (root.parentNode) root.parentNode.removeChild(root);
      }, 180);
      global.removeEventListener('resize', onViewportResize);
      global.document.removeEventListener('keydown', onKeyDown, true);
      if (activeKey === key) activeKey = null;
      renderDock();
      if (typeof options.onClose === 'function') {
        try { options.onClose(); } catch (e) { /* 忽略 */ }
      }
    }

    function focusWindow () {
      if (state.closed) return;
      root.style.zIndex = String(++zTop);
      if (activeKey !== key) {
        activeKey = key;
        instances.forEach(function (other) {
          if (other.key !== key) other.panel.classList.remove('is-focused');
        });
        renderDock();
      }
      try { frame.contentWindow.focus(); } catch (e) { /* 忽略 */ }
    }

    function setMinimized (value) {
      if (state.minimized === value) return;
      state.minimized = value;
      if (value) {
        root.classList.add('nw-app-window--minimized');
        global.setTimeout(function () {
          if (state.minimized) root.classList.add('nw-app-window--hidden');
        }, 200);
      } else {
        root.classList.remove('nw-app-window--hidden');
        // 下一帧再移除最小化类，保证过渡动画能从隐藏态播放回来
        global.requestAnimationFrame(function () {
          root.classList.remove('nw-app-window--minimized');
        });
        focusWindow();
      }
      renderDock();
    }

    function toggleMaximize () {
      if (state.maximized) {
        state.maximized = false;
        panel.style.transition = '';
        applyGeometry(state.restoreGeometry);
      } else {
        state.restoreGeometry = {
          left: parseInt(panel.style.left, 10) || 0,
          top: parseInt(panel.style.top, 10) || 0,
          width: panel.offsetWidth,
          height: panel.offsetHeight
        };
        state.maximized = true;
        applyGeometry({
          left: 8,
          top: 8,
          width: global.innerWidth - 16,
          height: global.innerHeight - 16
        });
      }
      persist();
    }

    function onViewportResize () {
      if (state.maximized) {
        applyGeometry({ left: 8, top: 8, width: global.innerWidth - 16, height: global.innerHeight - 16 });
        return;
      }
      panel.style.left = clamp(parseInt(panel.style.left, 10) || 0, 0, Math.max(0, global.innerWidth - panel.offsetWidth)) + 'px';
      panel.style.top = clamp(parseInt(panel.style.top, 10) || 0, 0, Math.max(0, global.innerHeight - panel.offsetHeight)) + 'px';
    }

    function onKeyDown (event) {
      if (event.key === 'Escape' && !state.minimized) close();
    }

    closeLight.addEventListener('click', close);
    if (options.minimizable === false) {
      minLight.classList.add('nw-light--disabled');
      minLight.disabled = true;
    } else {
      minLight.addEventListener('click', function () { setMinimized(true); });
    }
    if (options.maximizable === false || options.resizable === false) {
      maxLight.classList.add('nw-light--disabled');
      maxLight.disabled = true;
    } else {
      maxLight.addEventListener('click', toggleMaximize);
    }

    /* ------------------------------ 拖拽 ------------------------------ */
    function startDrag (event, mode) {
      if (state.maximized && mode === 'move') return;
      var startX = event.clientX;
      var startY = event.clientY;
      var startRect = {
        left: parseInt(panel.style.left, 10) || 0,
        top: parseInt(panel.style.top, 10) || 0,
        width: panel.offsetWidth,
        height: panel.offsetHeight
      };
      focusWindow();

      function onMove (moveEvent) {
        var dx = moveEvent.clientX - startX;
        var dy = moveEvent.clientY - startY;
        var next = {
          left: startRect.left,
          top: startRect.top,
          width: startRect.width,
          height: startRect.height
        };

        if (mode.indexOf('w') >= 0) {
          next.left = startRect.left + dx;
          next.width = startRect.width - dx;
        }
        if (mode.indexOf('e') >= 0) next.width = startRect.width + dx;
        if (mode.indexOf('n') >= 0) {
          next.top = startRect.top + dy;
          next.height = startRect.height - dy;
        }
        if (mode.indexOf('s') >= 0) next.height = startRect.height + dy;

        var minWidth = options.minWidth || 320;
        var minHeight = options.minHeight || 200;

        if (next.width < minWidth) {
          if (mode.indexOf('w') >= 0) next.left = startRect.left + (startRect.width - minWidth);
          next.width = minWidth;
        }
        if (next.height < minHeight) {
          if (mode.indexOf('n') >= 0) next.top = startRect.top + (startRect.height - minHeight);
          next.height = minHeight;
        }

        next.width = Math.min(next.width, global.innerWidth - 8);
        next.height = Math.min(next.height, global.innerHeight - 8);
        next.left = clamp(next.left, 0, global.innerWidth - next.width);
        next.top = clamp(next.top, 0, global.innerHeight - next.height);

        applyGeometry(mode === 'move' ? {
          left: clamp(startRect.left + dx, 0, global.innerWidth - next.width),
          top: clamp(startRect.top + dy, 0, global.innerHeight - next.height),
          width: startRect.width,
          height: startRect.height
        } : next);
      }

      function onUp () {
        global.document.removeEventListener('pointermove', onMove);
        global.document.removeEventListener('pointerup', onUp);
        global.document.body.style.userSelect = '';
        persist();
      }

      global.document.addEventListener('pointermove', onMove);
      global.document.addEventListener('pointerup', onUp);
      global.document.body.style.userSelect = 'none';
      event.preventDefault();
    }

    bar.addEventListener('pointerdown', function (event) {
      if (event.target.closest('.nw-light')) return;
      if (options.draggable === false) return;
      if (event.detail === 2 && options.maximizable !== false) {
        toggleMaximize();
        return;
      }
      startDrag(event, 'move');
    });

    Array.prototype.forEach.call(panel.querySelectorAll('.nw-resize'), function (handle) {
      handle.addEventListener('pointerdown', function (event) {
        startDrag(event, handle.dataset.dir);
      });
    });

    root.addEventListener('pointerdown', focusWindow, true);

    global.addEventListener('resize', onViewportResize);
    if (options.closeOnEscape !== false) {
      global.document.addEventListener('keydown', onKeyDown, true);
    }

    if (NW.host) NW.host.trackFrame(frame.contentWindow, { key: key });

    /* 焦点在页内窗口内部时，键盘事件不会传到宿主 document。
       这里在子页面 document 上补一层监听，让 ESC 的行为与桌面版一致。 */
    function bridgeEscape () {
      if (options.closeOnEscape === false) return;
      try {
        var inner = frame.contentWindow && frame.contentWindow.document;
        if (!inner) return;
        inner.addEventListener('keydown', function (event) {
          if (event.key !== 'Escape') return;
          // 子页面自己消费掉的 ESC（关闭内部弹窗等）不再关窗口
          if (event.defaultPrevented) return;
          onKeyDown(event);
        }, false);
      } catch (e) { /* 跨域或尚未就绪时忽略 */ }
    }
    bridgeEscape();

    frame.addEventListener('load', function () {
      if (NW.host) NW.host.trackFrame(frame.contentWindow, { key: key });
      bridgeEscape();
      focusWindow();
      var theme = util.resolveTheme();
      try {
        frame.contentWindow.postMessage({ __nw: 1, t: 'evt', ns: 'desktop', n: 'theme', d: { theme: theme, accent: util.resolveAccent() } }, global.location.origin);
      } catch (e) { /* 忽略 */ }
      if (typeof options.onLoad === 'function') {
        try { options.onLoad(frame.contentWindow); } catch (e) { /* 忽略 */ }
      }
    });

    root.style.zIndex = String(++zTop);
    activeKey = key;
    renderDock();

    var handle = {
      key: key,
      title: options.title || '',
      root: root,
      panel: panel,
      frame: frame,
      close: close,
      focus: focusWindow,
      minimize: function () { setMinimized(true); },
      restore: function () { setMinimized(false); },
      toggleMaximize: toggleMaximize,
      isMinimized: function () { return state.minimized; },
      isMaximized: function () { return state.maximized; },
      setTitle: function (next) {
        state.title = next;
        options.title = next;
        titleEl.textContent = next;
        frame.setAttribute('title', next);
        renderDock();
      }
    };

    instances.set(key, handle);
    return handle;
  }

  function closeByFrame (frameWindow) {
    var target = null;
    instances.forEach(function (handle) {
      if (handle.frame.contentWindow === frameWindow) target = handle;
    });
    if (target) {
      target.close();
      return true;
    }
    return false;
  }

  function close (key) {
    var handle = instances.get(key);
    if (handle) {
      handle.close();
      return true;
    }
    return false;
  }

  function focusKey (key) {
    var handle = instances.get(key);
    if (!handle) return null;
    if (handle.isMinimized()) handle.restore();
    handle.focus();
    return handle;
  }

  var api = {
    open: open,
    close: close,
    focus: focusKey,
    closeByFrame: closeByFrame,
    get: function (key) { return instances.get(key) || null; },
    has: function (key) { return instances.has(key); },
    closeAll: function () {
      Array.from(instances.values()).forEach(function (handle) { handle.close(); });
    },
    count: function () { return instances.size; }
  };

  NW.window = api;
  global.NWWindow = api;
})(window);

/* ===== 50-dispatch.js ===== */
/* ==========================================================================
 * NeoWarp Web Runtime — 主题同步与自动装配
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  var util = NW.util;

  function applyThemeToDocument (theme) {
    var root = global.document.documentElement;
    if (theme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
  }

  applyThemeToDocument(util.resolveTheme());

  NW.applyThemeToDocument = applyThemeToDocument;

  /* 同标签页内：用户改了 scratch 的主题偏好时同步给自己和所有子窗口 */
  global.addEventListener('storage', function (event) {
    if (event.key !== 'tw:theme') return;
    var theme = util.resolveTheme();
    applyThemeToDocument(theme);
    if (NW.host) NW.host.notifyAppearanceChanged();
  });

  /* 子窗口：接收宿主的统一事件 */
  if (NW.rpc && !NW.rpc.isTop) {
    NW.rpc.on('desktop', 'theme', function (data) {
      applyThemeToDocument(data && data.theme);
    });
  }

  /* 跨标签页同步（主页 <-> 编辑器） */
  util.onBroadcast(function (message) {
    if (message.type === 'theme') {
      applyThemeToDocument(util.resolveTheme());
      if (NW.host) NW.host.notifyAppearanceChanged();
    }
  });

  console.log('[NeoWarp] Web Runtime 已加载' + (NW.rpc && NW.rpc.isTop ? '（宿主）' : '（子窗口）'));
})(window);

/* ===== 50-remote.js ===== */
/* NeoWarp Web — 远程通道（信令 + WebRTC）
 *
 * 网页版没有 Electron 主进程，无法起局域网 HTTP/WS 服务，
 * 因此桌面版「主进程开服务 + 手机扫码」的三类远控能力
 * （AI 手机编程、手机观看舞台、多人协作）统一改为：
 *
 *   公共 MQTT broker（信令） → WebRTC datachannel（业务数据 P2P 直连）
 *
 * 信令只交换 SDP/ICE，项目数据、AI 会话、舞台帧全部走 P2P，
 * 不经过任何第三方业务服务器。
 */
(function (global) {
  'use strict';

  var util = global.NW && global.NW.util;

  /* 公共信令 broker：全部为公开匿名 WebSocket 端点。
   * 依次尝试，第一个连上的生效；MQTT 全局对象由 assets/vendor/mqtt.min.js 提供。 */
  var BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081'
  ];

  var TOPIC_PREFIX = 'neowarp-web/v1/';
  var ICE_SERVERS = [
    {urls: 'stun:stun.l.google.com:19302'},
    {urls: 'stun:stun.miwifi.com:3478'}
  ];
  var CHUNK_SIZE = 60 * 1024; // datachannel 单条消息安全上限内

  var state = {
    mqtt: null,          // mqtt.Client
    mqttIndex: 0,
    topics: {},          // topic -> handler
    selfId: 'c-' + Math.random().toString(36).slice(2, 8)
  };

  function isAvailable () {
    return !!(global.RTCPeerConnection && global.mqtt);
  }

  /* ---------------- MQTT 信令（惰性共享连接） ---------------- */

  function connectMqtt () {
    if (state.mqtt) return Promise.resolve(state.mqtt);
    return new Promise(function (resolve, reject) {
      if (state.mqttIndex >= BROKERS.length) {
        state.mqttIndex = 0;
        reject(new Error('信令服务器均不可达'));
        return;
      }
      var url = BROKERS[state.mqttIndex];
      var client;
      try {
        client = global.mqtt.connect(url, {
          clientId: 'nw-' + state.selfId + '-' + Math.random().toString(36).slice(2, 6),
          keepalive: 30,
          reconnectPeriod: 0, // 我们自己换 broker 重试
          connectTimeout: 8000
        });
      } catch (e) {
        state.mqttIndex += 1;
        resolve(connectMqtt());
        return;
      }
      client.on('connect', function () {
        state.mqtt = client;
        client.on('message', function (topic, payload) {
          var handler = state.topics[topic];
          if (!handler) return;
          var msg;
          try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
          try { handler(msg); } catch (e) { void e; }
        });
        // 重新订阅此前登记的主题
        Object.keys(state.topics).forEach(function (topic) {
          client.subscribe(topic, function () {});
        });
        resolve(client);
      });
      client.on('error', function () {
        if (!state.mqtt) {
          try { client.end(true); } catch (e) { void e; }
          state.mqttIndex += 1;
          resolve(connectMqtt());
        }
      });
      setTimeout(function () {
        if (!state.mqtt) {
          try { client.end(true); } catch (e) { void e; }
          state.mqttIndex += 1;
          resolve(connectMqtt());
        }
      }, 9000);
    });
  }

  function subscribe (topic, handler) {
    state.topics[topic] = handler;
    return connectMqtt().then(function (client) {
      return new Promise(function (resolve) {
        client.subscribe(topic, function () { resolve(); });
      });
    });
  }

  function unsubscribe (topic) {
    delete state.topics[topic];
    if (state.mqtt) {
      try { state.mqtt.unsubscribe(topic, function () {}); } catch (e) { void e; }
    }
  }

  function publish (topic, obj) {
    return connectMqtt().then(function (client) {
      client.publish(topic, JSON.stringify(obj));
    });
  }

  /* ---------------- 房间 ---------------- */

  function generateRoom () {
    var alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    var code = '';
    for (var i = 0; i < 6; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
  }

  /* 信令主题内的设备到 datachannel 的一对一连接 */
  function PeerLink (pc, channel, meta) {
    this.pc = pc;
    this.channel = channel;
    this.meta = meta || {};
    this.onData = null;      // fn(obj)
    this.onBinary = null;    // fn(ArrayBuffer)
    this.onClose = null;     // fn()
    var self = this;
    channel.binaryType = 'arraybuffer';
    channel.onmessage = function (event) {
      if (event.data instanceof ArrayBuffer) {
        if (self.onBinary) self.onBinary(event.data);
        return;
      }
      var obj;
      try { obj = JSON.parse(event.data); } catch (e) { return; }
      if (self.onData) self.onData(obj);
    };
    channel.onclose = function () {
      if (self.onClose) self.onClose();
    };
  }

  PeerLink.prototype.send = function (obj) {
    try {
      if (this.channel.readyState === 'open') this.channel.send(JSON.stringify(obj));
    } catch (e) { void e; }
  };

  /** 大 payload 分块：meta 帧 + n 个二进制块 */
  PeerLink.prototype.sendBlob = function (name, buffer) {
    var bytes = new Uint8Array(buffer);
    var total = Math.max(1, Math.ceil(bytes.length / CHUNK_SIZE));
    var self = this;
    this.send({t: 'blob-meta', name: name, size: bytes.length, chunks: total});
    var i = 0;
    var step = function () {
      while (i < total) {
        var start = i * CHUNK_SIZE;
        var part = bytes.subarray(start, Math.min(start + CHUNK_SIZE, bytes.length));
        try {
          self.channel.send(part);
        } catch (e) {
          setTimeout(step, 50);
          return;
        }
        i += 1;
      }
    };
    step();
  };

  /** 接收端组装器（单 blob 流假设足够；喂满 chunk 即返回组装结果） */
  function BlobAssembler () {
    this.blobs = {};
  }
  BlobAssembler.prototype.feed = function (obj) {
    if (obj && obj.t === 'blob-meta') {
      this.blobs[obj.name] = {size: obj.size, chunks: obj.chunks, parts: []};
      return true;
    }
    return false;
  };
  BlobAssembler.prototype.binary = function (buffer) {
    for (var name in this.blobs) {
      var entry = this.blobs[name];
      entry.parts.push(buffer);
      if (entry.parts.length < entry.chunks) return null;
      delete this.blobs[name];
      var out = new Uint8Array(entry.size);
      var offset = 0;
      for (var i = 0; i < entry.parts.length; i++) {
        out.set(new Uint8Array(entry.parts[i]), offset);
        offset += entry.parts[i].byteLength;
      }
      return {name: name, buffer: out.buffer};
    }
    return null;
  };

  /* ---------------- 房主 ---------------- */

  /**
   * 开房：监听信令主题，接受任意 join 并与之建立 datachannel。
   * handlers: {onOpen(link), onData(link, obj), onBinary(link, buf), onClose(link), onSignal(msg)}
   */
  function host (room, handlers) {
    var topic = TOPIC_PREFIX + room;
    var links = [];
    var closed = false;

    var api = {
      room: room,
      topic: topic,
      links: links,
      /* 信令就绪（订阅已完成）后手机发来的 join 才能收到 */
      ready: subscribe(topic, function (msg) {
        if (closed) return;
        if (msg.t === 'join') {
          acceptJoin(msg);
        } else if (msg.t === 'answer') {
          // 客人的应答：交给对应 link 完成 handshake
          var answerTarget = null;
          links.forEach(function (l) {
            if (l.meta.peerId === msg.from) answerTarget = l;
          });
          if (answerTarget && answerTarget.pc.signalingState === 'have-local-offer') {
            answerTarget.pc.setRemoteDescription(msg.sdp).catch(function () {});
          }
        } else if (msg.t === 'ice' && msg.to === 'host') {
          var target = null;
          // 通过 from 匹配对应 link（meta.peerId）
          links.forEach(function (l) {
            if (l.meta.peerId === msg.from) target = l;
          });
          if (target && target.pc.signalingState !== 'closed') {
            target.pc.addIceCandidate(msg.cand).catch(function () {});
          }
        } else if (handlers.onSignal) {
          handlers.onSignal(msg);
        }
      }),
      broadcast: function (obj) { links.forEach(function (l) { l.send(obj); }); },
      sendBlobAll: function (name, buffer) {
        links.forEach(function (l) { l.sendBlob(name, buffer); });
      },
      close: function () {
        closed = true;
        unsubscribe(topic);
        links.forEach(function (l) {
          try { l.channel.close(); } catch (e) { void e; }
        });
        publish(topic, {t: 'bye', from: 'host'}).catch(function () {});
      }
    };

    function acceptJoin (msg) {
      if (closed || msg.from === 'host') return;
      // 同一设备会因 join 重试而重复到达：已有 link（或握手中）时直接重发 offer 即可，
      // 否则每次 join 都新建 RTCPeerConnection，会出现「一个 open 一个永久 connecting」。
      var existing = null;
      links.forEach(function (l) {
        if (l.meta.peerId === msg.from) existing = l;
      });
      if (existing) {
        if (existing.channel.readyState === 'open') {
          // 已连通，告知客人握手完成（客人侧可能仍在重试 join）
          existing.send({t: 'welcome', kind: existing.meta.kind});
        } else if (existing.pc.signalingState === 'have-local-offer') {
          publish(topic, {
            t: 'offer', from: 'host', to: msg.from, sdp: existing.pc.localDescription
          }).catch(function () {});
        }
        return;
      }
      var pc;
      try {
        pc = new global.RTCPeerConnection({iceServers: ICE_SERVERS});
      } catch (e) {
        return;
      }
      var channel = pc.createDataChannel('nw', {ordered: true});
      var link = new PeerLink(pc, channel, {peerId: msg.from, kind: msg.kind});
      link.meta.peerId = msg.from;
      links.push(link);
      link.onClose = function () {
        var idx = links.indexOf(link);
        if (idx >= 0) links.splice(idx, 1);
        if (handlers.onClose) handlers.onClose(link);
      };
      if (handlers.onData) link.onData = function (obj) { handlers.onData(link, obj); };
      if (handlers.onBinary) link.onBinary = function (buf) { handlers.onBinary(link, buf); };
      // datachannel 真正打通后才通知上层（推首帧、广播快照等都依赖这个时机）
      channel.onopen = function () {
        if (closed) return;
        if (handlers.onOpen) handlers.onOpen(link);
      };

      pc.onicecandidate = function (event) {
        if (event.candidate) {
          publish(topic, {t: 'ice', from: 'host', to: msg.from, cand: event.candidate.toJSON()}).catch(function () {});
        }
      };
      pc.createOffer().then(function (offer) {
        return pc.setLocalDescription(offer);
      }).then(function () {
        return publish(topic, {t: 'offer', from: 'host', to: msg.from, sdp: pc.localDescription});
      }).catch(function () {
        // 握手失败即丢弃
      });
    }

    return api;
  }

  /* ---------------- 客人 ---------------- */

  /**
   * 加入房间：join → 收 offer → answer → datachannel。
   * handlers: {onOpen(link), onData(link, obj), onBinary(link, buf), onClose(link), onFail(error)}
   */
  function join (room, handlers) {
    var topic = TOPIC_PREFIX + room;
    var closed = false;
    var pc = null;
    var link = null;
    var myId = state.selfId + '-' + Math.random().toString(36).slice(2, 6);
    var joinTimer = null;

    function fail (error) {
      if (joinTimer) clearInterval(joinTimer);
      if (handlers.onFail) handlers.onFail(error);
    }

    subscribe(topic, function (msg) {
      if (closed) return;
      if (msg.t === 'offer' && (msg.to === myId || msg.to === undefined)) {
        if (pc && pc.signalingState !== 'closed') return;
        try {
          pc = new global.RTCPeerConnection({iceServers: ICE_SERVERS});
        } catch (e) { fail(e); return; }
        pc.ondatachannel = function (event) {
          link = new PeerLink(pc, event.channel, {peerId: 'host'});
          if (handlers.onData) link.onData = function (obj) { handlers.onData(link, obj); };
          if (handlers.onBinary) link.onBinary = function (buf) { handlers.onBinary(link, buf); };
          link.onClose = function () {
            if (handlers.onClose) handlers.onClose(link);
          };
          if (handlers.onOpen) handlers.onOpen(link);
        };
        pc.onicecandidate = function (event) {
          if (event.candidate) {
            publish(topic, {t: 'ice', from: myId, to: 'host', cand: event.candidate.toJSON()}).catch(function () {});
          }
        };
        pc.setRemoteDescription(msg.sdp).then(function () {
          return pc.createAnswer();
        }).then(function (answer) {
          return pc.setLocalDescription(answer);
        }).then(function () {
          return publish(topic, {t: 'answer', from: myId, sdp: pc.localDescription});
        }).catch(function (e) { fail(e); });
      } else if (msg.t === 'ice' && msg.to === myId && pc) {
        pc.addIceCandidate(msg.cand).catch(function () {});
      } else if (msg.t === 'welcome') {
        // 房主侧 datachannel 已 open，重试定时器可以停了
        clearInterval(joinTimer);
      } else if (msg.t === 'bye' && msg.from === 'host') {
        if (link) {
          try { link.channel.close(); } catch (e) { void e; }
        }
      }
    });

    publish(topic, {t: 'join', from: myId, kind: 'client'}).catch(function (e) { fail(e); });

    // join 是普通消息：若房主端的信令订阅尚未建立就会丢失，重发直到连接建立
    var joinAttempts = 0;
    joinTimer = setInterval(function () {
      joinAttempts += 1;
      if (closed || link) {
        clearInterval(joinTimer);
        return;
      }
      if (joinAttempts > 8) {
        clearInterval(joinTimer);
        fail(new Error('连接超时，请确认电脑端房间仍开启'));
        return;
      }
      publish(topic, {t: 'join', from: myId, kind: 'client'}).catch(function () {});
    }, 2500);

    // 兜底：45 秒没建立成功视为失败
    setTimeout(function () {
      clearInterval(joinTimer);
      if (!closed && !link) fail(new Error('连接超时，请确认电脑端房间仍开启'));
    }, 45000);

    var api = {
      room: room,
      get link () { return link; },
      send: function (obj) { if (link) link.send(obj); },
      close: function () {
        closed = true;
        unsubscribe(topic);
        if (link) {
          try { link.channel.close(); } catch (e) { void e; }
        }
      }
    };
    return api;
  }

  /* ---------------- 二维码 ---------------- */

  function qrSvg (text) {
    try {
      var qrcodeGen = global.qrcode; // qrcode-generator@1.4.4（ai 页自带）
      if (!qrcodeGen) return null;
      var qr = qrcodeGen(0, 'M');
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({cellSize: 4, margin: 2, scalable: true});
    } catch (e) {
      return null;
    }
  }

  function remoteUrl (path, room, extra) {
    var base = (util && util.base) ? util.base : '/';
    var url = base + path + '?r=' + encodeURIComponent(room);
    if (extra) url += '&' + extra;
    return url;
  }

  global.NW.remote = {
    isAvailable: isAvailable,
    generateRoom: generateRoom,
    host: host,
    join: join,
    qrSvg: qrSvg,
    remoteUrl: remoteUrl,
    BlobAssembler: BlobAssembler,
    CHUNK_SIZE: CHUNK_SIZE,
    /* 调试用（只读快照） */
    _state: state
  };
})(window);

/* ===== 51-remote-bridge.js ===== */
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

/* ===== 52-phone-sync.js ===== */
/* NeoWarp Web — AI 手机远控宿主（电脑端）
 *
 * AI 助手页面的内嵌脚本已经完整实现手机远控业务（phoneSnapshot /
 * __phoneRemoteCommand / phoneSyncBroadcast），桌面版由 Electron 主进程
 * 提供 SSE + HTTP 通道；网页版这里用 WebRTC datachannel 承担同样的角色：
 *
 *   手机端消息 {t:'phone-cmd'}  → window.__phoneRemoteCommand() 执行 → 回包
 *   手机端接入                  → 推送完整快照（kind:'snapshot'）
 *   phoneSyncBroadcast()       → {t:'phone-push'} 广播给所有手机
 */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});

  var runtime = {
    host: null,
    room: null,
    url: null,
    clients: 0,
    clientCallbacks: [],
    starting: null
  };

  function notifyClients () {
    runtime.clientCallbacks.forEach(function (fn) {
      try { fn({count: runtime.clients}); } catch (e) { void e; }
    });
  }

  function getSyncState () {
    try {
      if (typeof global.__phoneGetSyncState === 'function') {
        return global.__phoneGetSyncState();
      }
    } catch (e) { void e; }
    return null;
  }

  function runCommand (msg) {
    try {
      if (typeof global.__phoneRemoteCommand === 'function') {
        return global.__phoneRemoteCommand(msg || {});
      }
    } catch (e) {
      return {ok: false, error: String((e && e.message) || e)};
    }
    return {ok: false, error: 'unsupported'};
  }

  function ensureHost () {
    if (runtime.starting) return runtime.starting;
    if (runtime.host) {
      return Promise.resolve({url: runtime.url, clients: runtime.clients});
    }
    if (!NW.remote || !NW.remote.isAvailable()) {
      return Promise.reject(new Error('当前浏览器不支持 WebRTC 远控'));
    }
    runtime.starting = new Promise(function (resolve, reject) {
      var room = NW.remote.generateRoom();
      var host = NW.remote.host(room, {
        onOpen: function (link) {
          runtime.clients += 1;
          notifyClients();
          // 新手机接入：补发完整快照（等价桌面端 boot 内联 + snapshot 事件）
          var snap = getSyncState();
          if (snap) link.send({t: 'phone-push', kind: 'snapshot', data: snap});
        },
        onClose: function () {
          runtime.clients = Math.max(0, runtime.clients - 1);
          notifyClients();
        },
        onData: function (link, obj) {
          if (!obj || obj.t !== 'phone-cmd') return;
          var isState = obj.msg && obj.msg.cmd === '__state';
          // __state 返回快照本体（等价 GET /api/state），其余走 __phoneRemoteCommand
          var result = isState ? getSyncState() : runCommand(obj.msg);
          link.send({t: 'phone-cmd-res', id: obj.id, result: result});
        }
      });
      runtime.host = host;
      runtime.room = room;
      runtime.url = NW.remote.remoteUrl('ai/ai-assistant.html', room);
      // 等信令订阅就绪后再把房间号交给用户（否则手机 join 会丢消息）
      return host.ready.then(function () {
        resolve({url: runtime.url, clients: 0});
      });
    });
    return runtime.starting;
  }

  global.addEventListener('pagehide', function () {
    if (runtime.host) {
      try { runtime.host.close(); } catch (e) { void e; }
      runtime.host = null;
    }
  });

  NW.phoneSync = {
    ensureHost: ensureHost,
    broadcastPush: function (payload) {
      if (!runtime.host || !payload) return;
      runtime.host.broadcast({
        t: 'phone-push',
        kind: payload.kind || 'history',
        data: payload.data || {}
      });
    },
    onClients: function (fn) {
      if (typeof fn === 'function') runtime.clientCallbacks.push(fn);
    },
    get room () { return runtime.room; }
  };
})(window);

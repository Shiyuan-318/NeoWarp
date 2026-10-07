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

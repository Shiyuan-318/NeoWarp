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

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

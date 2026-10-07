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

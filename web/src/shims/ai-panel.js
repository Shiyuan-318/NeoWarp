/* ==========================================================================
 * NeoWarp 网页版 — AI 面板弹窗 ExtensionEditorPreload（弹窗侧）浏览器实现
 * 弹窗由宿主创建，宿主负责把取代码/插代码请求转发给扩展编辑器窗口。
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  var storage = NW.storage;
  var rpc = NW.rpc;

  function extepopCall (method, args, timeout) {
    if (!rpc.isAvailable()) return Promise.resolve(null);
    return rpc.call('extepop', method, args, timeout).catch(function () { return null; });
  }

  function desktopCall (method, args, fallback) {
    if (!rpc.isAvailable()) return Promise.resolve(fallback);
    return rpc.call('desktop', method, args).catch(function () { return fallback; });
  }

  global.ExtensionEditorPreload = {
    getPopoutInitial: function () {
      return extepopCall('getInitial', [], 10000);
    },

    onPopoutInit: function (callback) {
      rpc.on('extepop', 'popoutInit', callback);
      // 宿主在窗口就绪后重发一次初始化状态
      extepopCall('getInitial', [], 10000).then(function (initial) {
        if (initial) {
          try { callback(initial); } catch (e) { /* 忽略 */ }
        }
      });
    },

    popoutGetCode: function () {
      return extepopCall('getCode', [], 30000);
    },

    popoutInsertCode: function (code) {
      return extepopCall('insertCode', [code], 30000);
    },

    popoutReplaceCode: function (code) {
      return extepopCall('replaceCode', [code], 30000);
    },

    popoutGetAiModelConfigs: function () {
      return desktopCall('getAiModelConfigs', [], storage.getAiModelConfigs());
    },

    popoutSaveAiModelConfigs: function (payload) {
      return desktopCall('saveAiModelConfigs', [payload], storage.saveAiModelConfigs(payload));
    },

    reportPopoutState: function (popoutState) {
      return extepopCall('reportState', [popoutState], 10000);
    },

    dockBack: function (popoutState) {
      return extepopCall('dockBack', [popoutState], 10000).then(function () { return true; });
    },

    closeWindow: function () {
      if (rpc.postToHost({ __nw: 1, t: 'close' })) return Promise.resolve(true);
      try { global.close(); } catch (e) { /* 忽略 */ }
      return Promise.resolve(true);
    }
  };
})(window);

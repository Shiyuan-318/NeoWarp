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

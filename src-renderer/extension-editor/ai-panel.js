/* NeoWarp AI 独立窗口：与停靠侧栏共用 ai-shared.js 面板 */
(function () {
  'use strict';

  var P = window.ExtensionEditorPreload;

  var STRINGS = {
    zh: {
      dockBack: '恢复到编辑器侧栏',
      inserted: '代码已插入编辑器',
      replaced: '已替换编辑器全部内容（Ctrl+Z 可撤销）',
      replaceFailed: '替换失败：编辑器无可用标签'
    },
    en: {
      dockBack: 'Dock back to editor sidebar',
      inserted: 'Code inserted into editor',
      replaced: 'Editor content replaced (Ctrl+Z to undo)',
      replaceFailed: 'Replace failed: no active tab in the editor'
    }
  };

  var panel = null;
  var pendingState = null;

  function $ (id) {
    return document.getElementById(id);
  }

  var toastTimer = null;
  function showToast (message) {
    var toast = $('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('visible');
    }, 2600);
  }

  // 编辑器窗口在加载完成后把交接状态（聊天记录等）推过来
  P.onPopoutInit(function (state) {
    pendingState = state;
    if (panel && state) {
      panel.setState(state);
    }
  });

  P.getPopoutInitial().then(function (initial) {
    var lang = ((initial && initial.locale) || 'en').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
    var strings = STRINGS[lang];
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = (lang === 'zh' ? 'AI 助手' : 'AI Assistant') + ' - NeoWarp';
    $('ai-dock-btn').title = strings.dockBack;

    panel = window.createNeoWarpAiPanel({
      lang: lang,
      // 代码上下文经主进程向编辑器窗口中继获取
      getCode: function () {
        return P.popoutGetCode();
      },
      insertCode: function (code) {
        P.popoutInsertCode(code).then(function (ok) {
          if (ok) showToast(strings.inserted);
        });
      },
      replaceCode: function (code) {
        P.popoutReplaceCode(code).then(function (ok) {
          if (ok) {
            showToast(strings.replaced);
          } else {
            showToast(strings.replaceFailed);
          }
        });
      },
      settingsApi: {
        getConfigs: P.popoutGetAiModelConfigs,
        saveActive: function (activeId, configs) {
          return P.popoutSaveAiModelConfigs({configs: configs, activeId: activeId});
        },
        onChanged: P.onAiModelConfigsChanged,
        openSettings: P.openDesktopSettings
      },
      // 每轮对话变化都把最新状态报给主进程，窗口关闭时带回侧栏
      onStateChanged: function (state) {
        P.reportPopoutState(state);
      }
    });

    if (pendingState) {
      panel.setState(pendingState);
      P.reportPopoutState(pendingState);
    }

    $('ai-dock-btn').addEventListener('click', function () {
      P.dockBack(panel.getState());
    });
  });
})();

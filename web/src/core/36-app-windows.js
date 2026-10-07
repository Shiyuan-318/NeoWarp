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

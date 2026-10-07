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

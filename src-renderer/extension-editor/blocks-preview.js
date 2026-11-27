/* NeoWarp 扩展编辑器 —— 积木预览弹窗（blocks-preview.html 配套脚本）
 * 经 tw-extension-editor:// 协议加载（CSP 禁止内联脚本，逻辑全部外链于此）。
 * 渲染纯函数在 blocks-render.js（共享），本脚本只负责弹窗接线（preload API）。
 */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var R = isNode ? require('./blocks-render.js') : root.NeoWarpBlocksRender;
  if (isNode) {
    // node 下仅导出渲染函数，便于单测
    module.exports = R;
    return;
  }

  // ══ 浏览器接线区 ═══════════════════════════════════════════════════════════

  var P = root.ExtensionEditorPreload;
  var STRINGS = {
    zh: {
      refresh: '刷新',
      close: '关闭',
      docTitle: '积木预览',
      noBlocks: '未检测到积木',
      noTab: '编辑器无可用标签',
      errorPrefix: '无法解析扩展代码：'
    },
    en: {
      refresh: 'Refresh',
      close: 'Close',
      docTitle: 'Blocks Preview',
      noBlocks: 'No blocks found',
      noTab: 'No active tab in the editor',
      errorPrefix: 'Failed to parse extension code: '
    }
  };
  var lang = 'en';

  function $ (id) { return document.getElementById(id); }
  function isZh (locale) { return typeof locale === 'string' && /^zh/i.test(locale); }
  function applyLocale (payload) {
    if (payload && isZh(payload.locale)) lang = 'zh';
    else if (payload && payload.locale) lang = 'en';
    var s = STRINGS[lang];
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = s.docTitle;
    var title = $('blocks-title');
    if (title) title.textContent = s.docTitle;
    var refreshBtn = $('blocks-refresh-btn');
    if (refreshBtn) refreshBtn.title = s.refresh;
    var closeBtn = $('blocks-close-btn');
    if (closeBtn) closeBtn.title = s.close;
  }

  function renderState (message) {
    var body = $('blocks-body');
    if (!body) return;
    body.innerHTML = '<div class="blocks-state">' + R.escapeXml(message) + '</div>';
  }

  function renderExtensions (extensions) {
    if (!Array.isArray(extensions) || extensions.length === 0) {
      renderState(STRINGS[lang].noBlocks);
      return;
    }
    var body = $('blocks-body');
    if (!body) return;
    var html = '';
    for (var i = 0; i < extensions.length; i++) {
      html += R.buildExtensionSection(extensions[i], lang);
    }
    body.innerHTML = html;
  }

  // silent（focus 自动刷新）失败时保留上次内容；非 silent 才覆盖为错误/空态
  function refresh (silent) {
    if (!P || typeof P.popoutGetBlocks !== 'function') return;
    P.popoutGetBlocks().then(function (res) {
      if (res && res.ok) {
        renderExtensions(res.extensions);
      } else if (!silent) {
        var err = res && res.error;
        renderState(err === 'no-tab' ? STRINGS[lang].noTab : STRINGS[lang].errorPrefix + (err || ''));
      }
    }, function () {
      // 请求失败：保留上次内容，避免闪空
    });
  }

  if (P) {
    P.getBlocksPopoutInitial().then(function (initial) {
      applyLocale(initial);
      refresh(false);
    }, function () {
      applyLocale(null);
      refresh(false);
    });
    // did-finish-load 后主进程再推一次 init：直接安全重刷（渲染幂等）
    P.onBlocksPopoutInit(function (payload) {
      applyLocale(payload);
      refresh(false);
    });
    $('blocks-refresh-btn').addEventListener('click', function () { refresh(false); });
    $('blocks-close-btn').addEventListener('click', function () { root.close(); });
    root.addEventListener('focus', function () { refresh(true); });
  }
})(typeof window !== 'undefined' ? window : globalThis);

/* NeoWarp 网页版内置窗口（in-app window）
 *
 * 用同源 iframe + 浮层替代 window.open 新标签页，供 AI 助手、附加组件设置等
 * 内部页面使用。子页面与父页面的 postMessage 通信保持不变：
 *   - 子页面 → 父页面：window.parent.postMessage(...)
 *   - 父页面 → 子页面：event.source.postMessage(...)
 *
 * 对外接口：
 *   NeoWarpWindow.open(url, {title, width, height, anchor, modal, key, onClose})
 *     -> 返回句柄 { frame, root, close(), focus() }
 *   NeoWarpWindow.close(key)   // 按 key 关闭
 *
 * 子页面若想关闭自己所在的浮层，向父页面发送：
 *   parent.postMessage({ __neowarpCloseWindow: true }, origin)
 */
(function () {
  'use strict';

  var ORIGIN = window.location.origin;
  var STYLE_ID = 'neowarp-inapp-window-style';
  var Z_INDEX = 999999;
  var seq = 0;

  var instances = new Map(); // key -> 句柄

  var CSS = [
    '.nw-win-root{position:fixed;inset:0;z-index:' + Z_INDEX + ';}',
    '.nw-win-root--modal{background:rgba(0,0,0,.45);}',
    '.nw-win-panel{position:absolute;display:flex;flex-direction:column;overflow:hidden;',
    'background:#16161c;color:#f5f5f7;border:1px solid rgba(255,255,255,.1);border-radius:12px;',
    'box-shadow:0 24px 70px rgba(0,0,0,.55);}',
    'html[data-theme="light"] .nw-win-panel{background:#fff;color:#1d1d1f;border-color:rgba(0,0,0,.08);',
    'box-shadow:0 24px 70px rgba(0,0,0,.25);}',
    '.nw-win-header{display:flex;align-items:center;justify-content:space-between;gap:12px;',
    'padding:8px 8px 8px 14px;background:rgba(128,128,128,.14);border-bottom:1px solid rgba(128,128,128,.2);',
    'font-size:14px;font-weight:600;cursor:default;user-select:none;flex:0 0 auto;}',
    '.nw-win-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.nw-win-close{flex:0 0 auto;width:28px;height:28px;border:none;border-radius:6px;background:transparent;',
    'color:inherit;font-size:18px;line-height:1;cursor:pointer;}',
    '.nw-win-close:hover{background:rgba(128,128,128,.28);}',
    '.nw-win-frame{flex:1 1 auto;width:100%;border:none;background:transparent;}'
  ].join('');

  function ensureStyle () {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // 拖动：按住标题栏移动整个面板，并限制在视口内
  function makeDraggable (panel, handle) {
    var dragging = false;
    var startX = 0;
    var startY = 0;
    var startLeft = 0;
    var startTop = 0;

    function clampLeft (left) {
      return Math.min(Math.max(0, left), Math.max(0, window.innerWidth - panel.offsetWidth));
    }
    function clampTop (top) {
      return Math.min(Math.max(0, top), Math.max(0, window.innerHeight - panel.offsetHeight));
    }

    handle.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      if (event.target && event.target.closest && event.target.closest('.nw-win-close')) return;
      var rect = panel.getBoundingClientRect();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      try { handle.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
      event.preventDefault();
    });

    handle.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      panel.style.left = clampLeft(startLeft + (event.clientX - startX)) + 'px';
      panel.style.top = clampTop(startTop + (event.clientY - startY)) + 'px';
    });

    function endDrag (event) {
      if (!dragging) return;
      dragging = false;
      try { handle.releasePointerCapture(event.pointerId); } catch (e) { /* ignore */ }
    }
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  function open (url, options) {
    var opts = options || {};
    ensureStyle();

    var key = opts.key || null;
    if (key && instances.has(key)) {
      var existing = instances.get(key);
      existing.root.style.display = '';
      existing.focus();
      return existing;
    }

    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var width = Math.min(opts.width || 480, vw - 24);
    var height = Math.min(opts.height || 820, vh - 24);

    var left = opts.anchor === 'right' ? (vw - width - 16) : ((vw - width) / 2);
    var top = opts.anchor === 'right' ? 16 : Math.max(12, (vh - height) / 2);

    var root = document.createElement('div');
    root.className = 'nw-win-root' + (opts.modal ? ' nw-win-root--modal' : '');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', opts.title || '窗口');

    var panel = document.createElement('div');
    panel.className = 'nw-win-panel';
    panel.style.width = width + 'px';
    panel.style.height = height + 'px';
    panel.style.left = Math.max(0, left) + 'px';
    panel.style.top = Math.max(0, top) + 'px';

    var header = document.createElement('div');
    header.className = 'nw-win-header';

    var title = document.createElement('div');
    title.className = 'nw-win-title';
    title.textContent = opts.title || '';

    var closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'nw-win-close';
    closeButton.setAttribute('aria-label', '关闭');
    closeButton.textContent = '\u00d7';

    header.appendChild(title);
    header.appendChild(closeButton);

    var frame = document.createElement('iframe');
    frame.className = 'nw-win-frame';
    frame.setAttribute('allow', 'clipboard-write; microphone; camera; fullscreen');
    frame.src = url;

    panel.appendChild(header);
    panel.appendChild(frame);
    root.appendChild(panel);

    var closed = false;

    function close () {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onResize);
      if (key) instances.delete(key);
      if (typeof opts.onClose === 'function') {
        try { opts.onClose(); } catch (e) { /* ignore */ }
      }
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    function onKeyDown (event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    }

    function onResize () {
      var rect = panel.getBoundingClientRect();
      panel.style.left = Math.min(Math.max(0, rect.left), Math.max(0, window.innerWidth - panel.offsetWidth)) + 'px';
      panel.style.top = Math.min(Math.max(0, rect.top), Math.max(0, window.innerHeight - panel.offsetHeight)) + 'px';
    }

    closeButton.addEventListener('click', close);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onResize);

    if (opts.modal) {
      root.addEventListener('mousedown', function (event) {
        if (event.target === root) close();
      });
    }

    if (opts.draggable !== false) makeDraggable(panel, header);

    (document.body || document.documentElement).appendChild(root);

    var handle = {
      frame: frame,
      root: root,
      close: close,
      focus: function () {
        try { frame.contentWindow.focus(); } catch (e) { /* ignore */ }
      }
    };

    if (key) instances.set(key, handle);

    // 首次加载完成后把键盘焦点交给子页面
    frame.addEventListener('load', function () {
      handle.focus();
    });

    return handle;
  }

  // 子页面请求关闭：只关闭发起消息的那个 iframe 所在的浮层
  window.addEventListener('message', function (event) {
    if (event.origin !== ORIGIN) return;
    var data = event.data;
    if (!data || data.__neowarpCloseWindow !== true) return;
    instances.forEach(function (handle) {
      if (handle.frame && handle.frame.contentWindow === event.source) {
        handle.close();
      }
    });
  });

  window.NeoWarpWindow = {
    open: open,
    close: function (key) {
      var handle = instances.get(key);
      if (handle) handle.close();
    },
    closeAll: function () {
      Array.from(instances.values()).forEach(function (handle) {
        handle.close();
      });
    }
  };

  console.log('[NeoWarp] 网页版内置窗口已加载');
})();

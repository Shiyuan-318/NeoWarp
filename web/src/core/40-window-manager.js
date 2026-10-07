/* ==========================================================================
 * NeoWarp Web Runtime — 页内窗口管理器
 * 用同源 iframe + 浮层还原桌面版的独立窗口体验：
 * 拖拽、八向缩放、最大化/还原、最小化到 Dock、层级管理、开合动画、位置记忆。
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  var util = NW.util;

  var instances = new Map();   // key -> handle
  var zTop = 100000;
  var activeKey = null;
  var seq = 0;

  var GEOMETRY_KEY = 'neowarp:window-geometry';

  function readGeometry () {
    return util.readJSON(GEOMETRY_KEY, {});
  }

  function writeGeometry (key, geometry) {
    var all = readGeometry();
    all[key] = geometry;
    util.writeJSON(GEOMETRY_KEY, all);
  }

  /* ------------------------------ 样式 ------------------------------ */
  var CSS = [
    '.nw-app-window{position:fixed;z-index:auto;contain:layout style;}',
    '.nw-app-window__panel{position:absolute;display:flex;flex-direction:column;overflow:hidden;',
    '  background:var(--nw-win-bg,#1b1b20);color:var(--nw-win-fg,#f5f5f7);',
    '  border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 .5px rgba(255,255,255,.09);',
    '  transition:transform .26s cubic-bezier(.22,1,.36,1),opacity .2s ease;',
    '  transform-origin:center center;}',
    '.nw-app-window--closing .nw-app-window__panel{opacity:0;transform:scale(.96);}',
    '.nw-app-window--minimized .nw-app-window__panel{opacity:0;transform:scale(.9) translateY(24px);pointer-events:none;}',
    '.nw-app-window--opening .nw-app-window__panel{animation:nw-win-in .26s cubic-bezier(.22,1,.36,1);}',
    '@keyframes nw-win-in{from{opacity:0;transform:scale(.97) translateY(10px);}to{opacity:1;transform:none;}}',

    '.nw-app-window__bar{position:relative;display:flex;align-items:center;gap:10px;height:38px;flex:0 0 auto;',
    '  padding:0 12px;background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.03));',
    '  border-bottom:.5px solid rgba(255,255,255,.1);cursor:default;user-select:none;}',
    'html[data-theme="light"] .nw-app-window__bar{background:linear-gradient(180deg,#f6f6f8,#ececed);',
    '  border-bottom:.5px solid rgba(0,0,0,.1);}',
    '.nw-app-window--bare .nw-app-window__bar{display:none;}',

    '.nw-lights{display:flex;align-items:center;gap:8px;flex:0 0 auto;}',
    '.nw-light{width:12px;height:12px;border-radius:50%;border:none;padding:0;cursor:pointer;position:relative;',
    '  box-shadow:inset 0 0 0 .5px rgba(0,0,0,.18);transition:filter .15s ease;}',
    '.nw-light:hover{filter:brightness(1.15);}',
    '.nw-light--close{background:#ff5f57;}',
    '.nw-light--min{background:#febc2e;}',
    '.nw-light--max{background:#28c840;}',
    '.nw-light--disabled{background:rgba(128,128,128,.35);cursor:default;}',
    '.nw-lights__glyph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
    '  font-size:9px;line-height:1;color:rgba(0,0,0,.55);opacity:0;}',
    '.nw-lights:hover .nw-lights__glyph{opacity:1;}',

    '.nw-app-window__title{flex:1 1 auto;text-align:center;font-size:13px;font-weight:600;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.9;}',
    '.nw-app-window__spacer{width:52px;flex:0 0 auto;}',
    '.nw-app-window__frame{flex:1 1 auto;width:100%;height:100%;border:none;background:#fff;display:block;}',
    'html[data-theme="light"] .nw-app-window__frame{background:#fff;}',
    'html:not([data-theme="light"]) .nw-app-window__frame{background:var(--nw-win-bg,#1b1b20);}',

    '.nw-resize{position:absolute;z-index:5;}',
    '.nw-resize--n{top:-3px;left:8px;right:8px;height:6px;cursor:ns-resize;}',
    '.nw-resize--s{bottom:-3px;left:8px;right:8px;height:6px;cursor:ns-resize;}',
    '.nw-resize--w{left:-3px;top:8px;bottom:8px;width:6px;cursor:ew-resize;}',
    '.nw-resize--e{right:-3px;top:8px;bottom:8px;width:6px;cursor:ew-resize;}',
    '.nw-resize--nw{left:-3px;top:-3px;width:14px;height:14px;cursor:nwse-resize;}',
    '.nw-resize--ne{right:-3px;top:-3px;width:14px;height:14px;cursor:nesw-resize;}',
    '.nw-resize--sw{left:-3px;bottom:-3px;width:14px;height:14px;cursor:nesw-resize;}',
    '.nw-resize--se{right:-3px;bottom:-3px;width:14px;height:14px;cursor:nwse-resize;}',

    /* Dock */
    '.nw-dock{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:flex-end;gap:10px;',
    '  padding:8px 12px;border-radius:18px;z-index:2147483000;',
    '  background:rgba(28,28,32,.62);border:.5px solid rgba(255,255,255,.14);',
    '  box-shadow:0 18px 46px rgba(0,0,0,.5);backdrop-filter:blur(24px) saturate(180%);',
    '  -webkit-backdrop-filter:blur(24px) saturate(180%);}',
    '.nw-dock:empty{display:none;}',
    '.nw-dock__item{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;width:132px;',
    '  padding:8px 6px 6px;border:none;border-radius:12px;background:transparent;color:inherit;cursor:pointer;',
    '  font-size:11px;line-height:1.2;transition:background .15s ease,transform .15s ease;}',
    '.nw-dock__item:hover{background:rgba(255,255,255,.12);transform:translateY(-2px);}',
    '.nw-dock__label{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.nw-dock__dot{position:absolute;bottom:-1px;left:50%;transform:translateX(-50%);width:4px;height:4px;',
    '  border-radius:50%;background:currentColor;opacity:.75;}',
    '.nw-dock__square{width:34px;height:26px;border-radius:5px;border:1.5px solid currentColor;opacity:.8;}',
    '.nw-app-window--hidden,.nw-app-window--hidden .nw-app-window__panel{display:none;}'
  ].join('\n');

  function ensureStyles () {
    if (global.document.getElementById('nw-window-style')) return;
    var style = global.document.createElement('style');
    style.id = 'nw-window-style';
    style.textContent = CSS;
    (global.document.head || global.document.documentElement).appendChild(style);
  }

  /* ------------------------------ Dock ------------------------------ */
  var dockEl = null;

  function ensureDock () {
    if (dockEl) return dockEl;
    dockEl = global.document.createElement('div');
    dockEl.className = 'nw-dock';
    global.document.body.appendChild(dockEl);
    return dockEl;
  }

  function renderDock () {
    var dock = ensureDock();
    dock.textContent = '';
    instances.forEach(function (handle) {
      var muted = activeKey === handle.key && !handle.isMinimized();
      var item = global.document.createElement('button');
      item.type = 'button';
      item.className = 'nw-dock__item';
      item.title = handle.title;
      item.setAttribute('aria-label', handle.title);

      var square = global.document.createElement('span');
      square.className = 'nw-dock__square';

      var label = global.document.createElement('span');
      label.className = 'nw-dock__label';
      label.textContent = handle.title;

      item.appendChild(square);
      item.appendChild(label);
      if (muted) {
        var dot = global.document.createElement('span');
        dot.className = 'nw-dock__dot';
        item.appendChild(dot);
      }

      item.addEventListener('click', function () {
        if (handle.isMinimized()) handle.restore();
        else handle.minimize();
      });

      dock.appendChild(item);
    });
  }

  /* --------------------------- 工具函数 --------------------------- */
  function clamp (value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function defaultSize (options) {
    var viewportWidth = global.innerWidth;
    var viewportHeight = global.innerHeight;
    var width = options.width || Math.round(Math.min(1080, viewportWidth * 0.8));
    var height = options.height || Math.round(Math.min(760, viewportHeight * 0.82));
    return {
      width: Math.max(options.minWidth || 320, Math.min(width, viewportWidth - 24)),
      height: Math.max(options.minHeight || 200, Math.min(height, viewportHeight - 24))
    };
  }

  function centerPosition (width, height) {
    return {
      left: Math.round(Math.max(12, (global.innerWidth - width) / 2)),
      top: Math.round(Math.max(12, (global.innerHeight - height) / 2.4))
    };
  }

  /**
   * 打开一个页内窗口
   * @param {object} options
   *   key      窗口唯一标识（重复打开会聚焦已存在的实例）
   *   title    标题
   *   url      内容地址
   *   width / height  初始尺寸
   *   minWidth / minHeight
   *   resizable  是否可缩放（默认 true）
   *   maximizable 是否可最大化（默认 true）
   *   minimizable 是否可最小化（默认 true）
   *   bare     隐藏标题栏（自带标题的页面）
   *   singleton 是否单例（默认 true）
   *   onClose  关闭回调
   *   onMessage 收到子窗口 postMessage 业务消息时的回调
   */
  function open (options) {
    ensureStyles();
    var key = options.key || ('nw-window-' + (++seq));

    if (options.singleton !== false && instances.has(key)) {
      var existing = instances.get(key);
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return existing;
    }

    var size = defaultSize(options);
    var saved = options.remember !== false ? readGeometry()[key] : null;
    var geometry = Object.assign(centerPosition(size.width, size.height), size);
    if (saved && saved.width && saved.height) {
      geometry.left = clamp(saved.left || geometry.left, 0, Math.max(0, global.innerWidth - saved.width));
      geometry.top = clamp(saved.top || geometry.top, 0, Math.max(0, global.innerHeight - saved.height));
      geometry.width = saved.width;
      geometry.height = saved.height;
      geometry.maximized = !!saved.maximized;
    } else {
      geometry.maximized = !!options.maximized;
    }

    var root = global.document.createElement('div');
    root.className = 'nw-app-window nw-app-window--opening';
    if (options.bare) root.classList.add('nw-app-window--bare');
    if (options.className) root.classList.add(options.className);
    root.style.inset = '0';
    root.style.pointerEvents = 'none';

    var panel = global.document.createElement('div');
    panel.className = 'nw-app-window__panel';
    panel.style.pointerEvents = 'auto';
    panel.style.left = geometry.left + 'px';
    panel.style.top = geometry.top + 'px';
    panel.style.width = geometry.width + 'px';
    panel.style.height = geometry.height + 'px';

    var bar = global.document.createElement('div');
    bar.className = 'nw-app-window__bar';

    var lights = global.document.createElement('div');
    lights.className = 'nw-lights';
    lights.innerHTML =
      '<button class="nw-light nw-light--close" type="button" aria-label="关闭"><span class="nw-lights__glyph">✕</span></button>' +
      '<button class="nw-light nw-light--min" type="button" aria-label="最小化"><span class="nw-lights__glyph">−</span></button>' +
      '<button class="nw-light nw-light--max" type="button" aria-label="最大化"><span class="nw-lights__glyph">⤢</span></button>';

    var titleEl = global.document.createElement('div');
    titleEl.className = 'nw-app-window__title';
    titleEl.textContent = options.title || '';

    bar.appendChild(lights);
    bar.appendChild(titleEl);

    // 右侧留白，保证标题始终居中（与左侧三个圆点等宽）
    var spacer = global.document.createElement('div');
    spacer.className = 'nw-app-window__spacer';
    bar.appendChild(spacer);

    var frame = global.document.createElement('iframe');
    frame.className = 'nw-app-window__frame';
    frame.setAttribute('allow', 'clipboard-read; clipboard-write; microphone; camera; fullscreen; autoplay; display-capture');
    frame.setAttribute('title', options.title || '');
    frame.src = options.url;

    panel.appendChild(bar);
    panel.appendChild(frame);

    if (options.resizable !== false) {
      ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(function (dir) {
        var handle = global.document.createElement('div');
        handle.className = 'nw-resize nw-resize--' + dir;
        handle.dataset.dir = dir;
        panel.appendChild(handle);
      });
    }

    root.appendChild(panel);
    (global.document.body || global.document.documentElement).appendChild(root);

    // 让布局生效后再去除入场动画类
    global.setTimeout(function () { root.classList.remove('nw-app-window--opening'); }, 300);

    var closeLight = lights.querySelector('.nw-light--close');
    var minLight = lights.querySelector('.nw-light--min');
    var maxLight = lights.querySelector('.nw-light--max');

    var state = {
      key: key,
      root: root,
      panel: panel,
      frame: frame,
      title: options.title || '',
      minimized: false,
      maximized: !!geometry.maximized,
      closed: false,
      restoreGeometry: { left: geometry.left, top: geometry.top, width: geometry.width, height: geometry.height }
    };

    function applyGeometry (next) {
      panel.style.left = next.left + 'px';
      panel.style.top = next.top + 'px';
      panel.style.width = next.width + 'px';
      panel.style.height = next.height + 'px';
    }

    /* 初始即为最大化时，直接铺满视口 */
    if (state.maximized) {
      applyGeometry({
        left: 8,
        top: 8,
        width: global.innerWidth - 16,
        height: global.innerHeight - 16
      });
    }

    function persist () {
      if (options.remember === false) return;
      writeGeometry(key, {
        left: parseInt(panel.style.left, 10) || 0,
        top: parseInt(panel.style.top, 10) || 0,
        width: panel.offsetWidth,
        height: panel.offsetHeight,
        maximized: state.maximized
      });
    }

    function close () {
      if (state.closed) return;
      state.closed = true;
      root.classList.add('nw-app-window--closing');
      instances.delete(key);
      if (NW.host) NW.host.untrackFrame(frame.contentWindow);
      global.setTimeout(function () {
        if (root.parentNode) root.parentNode.removeChild(root);
      }, 180);
      global.removeEventListener('resize', onViewportResize);
      global.document.removeEventListener('keydown', onKeyDown, true);
      if (activeKey === key) activeKey = null;
      renderDock();
      if (typeof options.onClose === 'function') {
        try { options.onClose(); } catch (e) { /* 忽略 */ }
      }
    }

    function focusWindow () {
      if (state.closed) return;
      root.style.zIndex = String(++zTop);
      if (activeKey !== key) {
        activeKey = key;
        instances.forEach(function (other) {
          if (other.key !== key) other.panel.classList.remove('is-focused');
        });
        renderDock();
      }
      try { frame.contentWindow.focus(); } catch (e) { /* 忽略 */ }
    }

    function setMinimized (value) {
      if (state.minimized === value) return;
      state.minimized = value;
      if (value) {
        root.classList.add('nw-app-window--minimized');
        global.setTimeout(function () {
          if (state.minimized) root.classList.add('nw-app-window--hidden');
        }, 200);
      } else {
        root.classList.remove('nw-app-window--hidden');
        // 下一帧再移除最小化类，保证过渡动画能从隐藏态播放回来
        global.requestAnimationFrame(function () {
          root.classList.remove('nw-app-window--minimized');
        });
        focusWindow();
      }
      renderDock();
    }

    function toggleMaximize () {
      if (state.maximized) {
        state.maximized = false;
        panel.style.transition = '';
        applyGeometry(state.restoreGeometry);
      } else {
        state.restoreGeometry = {
          left: parseInt(panel.style.left, 10) || 0,
          top: parseInt(panel.style.top, 10) || 0,
          width: panel.offsetWidth,
          height: panel.offsetHeight
        };
        state.maximized = true;
        applyGeometry({
          left: 8,
          top: 8,
          width: global.innerWidth - 16,
          height: global.innerHeight - 16
        });
      }
      persist();
    }

    function onViewportResize () {
      if (state.maximized) {
        applyGeometry({ left: 8, top: 8, width: global.innerWidth - 16, height: global.innerHeight - 16 });
        return;
      }
      panel.style.left = clamp(parseInt(panel.style.left, 10) || 0, 0, Math.max(0, global.innerWidth - panel.offsetWidth)) + 'px';
      panel.style.top = clamp(parseInt(panel.style.top, 10) || 0, 0, Math.max(0, global.innerHeight - panel.offsetHeight)) + 'px';
    }

    function onKeyDown (event) {
      if (event.key === 'Escape' && !state.minimized) close();
    }

    closeLight.addEventListener('click', close);
    if (options.minimizable === false) {
      minLight.classList.add('nw-light--disabled');
      minLight.disabled = true;
    } else {
      minLight.addEventListener('click', function () { setMinimized(true); });
    }
    if (options.maximizable === false || options.resizable === false) {
      maxLight.classList.add('nw-light--disabled');
      maxLight.disabled = true;
    } else {
      maxLight.addEventListener('click', toggleMaximize);
    }

    /* ------------------------------ 拖拽 ------------------------------ */
    function startDrag (event, mode) {
      if (state.maximized && mode === 'move') return;
      var startX = event.clientX;
      var startY = event.clientY;
      var startRect = {
        left: parseInt(panel.style.left, 10) || 0,
        top: parseInt(panel.style.top, 10) || 0,
        width: panel.offsetWidth,
        height: panel.offsetHeight
      };
      focusWindow();

      function onMove (moveEvent) {
        var dx = moveEvent.clientX - startX;
        var dy = moveEvent.clientY - startY;
        var next = {
          left: startRect.left,
          top: startRect.top,
          width: startRect.width,
          height: startRect.height
        };

        if (mode.indexOf('w') >= 0) {
          next.left = startRect.left + dx;
          next.width = startRect.width - dx;
        }
        if (mode.indexOf('e') >= 0) next.width = startRect.width + dx;
        if (mode.indexOf('n') >= 0) {
          next.top = startRect.top + dy;
          next.height = startRect.height - dy;
        }
        if (mode.indexOf('s') >= 0) next.height = startRect.height + dy;

        var minWidth = options.minWidth || 320;
        var minHeight = options.minHeight || 200;

        if (next.width < minWidth) {
          if (mode.indexOf('w') >= 0) next.left = startRect.left + (startRect.width - minWidth);
          next.width = minWidth;
        }
        if (next.height < minHeight) {
          if (mode.indexOf('n') >= 0) next.top = startRect.top + (startRect.height - minHeight);
          next.height = minHeight;
        }

        next.width = Math.min(next.width, global.innerWidth - 8);
        next.height = Math.min(next.height, global.innerHeight - 8);
        next.left = clamp(next.left, 0, global.innerWidth - next.width);
        next.top = clamp(next.top, 0, global.innerHeight - next.height);

        applyGeometry(mode === 'move' ? {
          left: clamp(startRect.left + dx, 0, global.innerWidth - next.width),
          top: clamp(startRect.top + dy, 0, global.innerHeight - next.height),
          width: startRect.width,
          height: startRect.height
        } : next);
      }

      function onUp () {
        global.document.removeEventListener('pointermove', onMove);
        global.document.removeEventListener('pointerup', onUp);
        global.document.body.style.userSelect = '';
        persist();
      }

      global.document.addEventListener('pointermove', onMove);
      global.document.addEventListener('pointerup', onUp);
      global.document.body.style.userSelect = 'none';
      event.preventDefault();
    }

    bar.addEventListener('pointerdown', function (event) {
      if (event.target.closest('.nw-light')) return;
      if (options.draggable === false) return;
      if (event.detail === 2 && options.maximizable !== false) {
        toggleMaximize();
        return;
      }
      startDrag(event, 'move');
    });

    Array.prototype.forEach.call(panel.querySelectorAll('.nw-resize'), function (handle) {
      handle.addEventListener('pointerdown', function (event) {
        startDrag(event, handle.dataset.dir);
      });
    });

    root.addEventListener('pointerdown', focusWindow, true);

    global.addEventListener('resize', onViewportResize);
    if (options.closeOnEscape !== false) {
      global.document.addEventListener('keydown', onKeyDown, true);
    }

    if (NW.host) NW.host.trackFrame(frame.contentWindow, { key: key });

    /* 焦点在页内窗口内部时，键盘事件不会传到宿主 document。
       这里在子页面 document 上补一层监听，让 ESC 的行为与桌面版一致。 */
    function bridgeEscape () {
      if (options.closeOnEscape === false) return;
      try {
        var inner = frame.contentWindow && frame.contentWindow.document;
        if (!inner) return;
        inner.addEventListener('keydown', function (event) {
          if (event.key !== 'Escape') return;
          // 子页面自己消费掉的 ESC（关闭内部弹窗等）不再关窗口
          if (event.defaultPrevented) return;
          onKeyDown(event);
        }, false);
      } catch (e) { /* 跨域或尚未就绪时忽略 */ }
    }
    bridgeEscape();

    frame.addEventListener('load', function () {
      if (NW.host) NW.host.trackFrame(frame.contentWindow, { key: key });
      bridgeEscape();
      focusWindow();
      var theme = util.resolveTheme();
      try {
        frame.contentWindow.postMessage({ __nw: 1, t: 'evt', ns: 'desktop', n: 'theme', d: { theme: theme, accent: util.resolveAccent() } }, global.location.origin);
      } catch (e) { /* 忽略 */ }
      if (typeof options.onLoad === 'function') {
        try { options.onLoad(frame.contentWindow); } catch (e) { /* 忽略 */ }
      }
    });

    root.style.zIndex = String(++zTop);
    activeKey = key;
    renderDock();

    var handle = {
      key: key,
      title: options.title || '',
      root: root,
      panel: panel,
      frame: frame,
      close: close,
      focus: focusWindow,
      minimize: function () { setMinimized(true); },
      restore: function () { setMinimized(false); },
      toggleMaximize: toggleMaximize,
      isMinimized: function () { return state.minimized; },
      isMaximized: function () { return state.maximized; },
      setTitle: function (next) {
        state.title = next;
        options.title = next;
        titleEl.textContent = next;
        frame.setAttribute('title', next);
        renderDock();
      }
    };

    instances.set(key, handle);
    return handle;
  }

  function closeByFrame (frameWindow) {
    var target = null;
    instances.forEach(function (handle) {
      if (handle.frame.contentWindow === frameWindow) target = handle;
    });
    if (target) {
      target.close();
      return true;
    }
    return false;
  }

  function close (key) {
    var handle = instances.get(key);
    if (handle) {
      handle.close();
      return true;
    }
    return false;
  }

  function focusKey (key) {
    var handle = instances.get(key);
    if (!handle) return null;
    if (handle.isMinimized()) handle.restore();
    handle.focus();
    return handle;
  }

  var api = {
    open: open,
    close: close,
    focus: focusKey,
    closeByFrame: closeByFrame,
    get: function (key) { return instances.get(key) || null; },
    has: function (key) { return instances.has(key); },
    closeAll: function () {
      Array.from(instances.values()).forEach(function (handle) { handle.close(); });
    },
    count: function () { return instances.size; }
  };

  NW.window = api;
  global.NWWindow = api;
})(window);

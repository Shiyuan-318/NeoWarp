/**
 * NeoWarp: Windows 窗口控制覆盖层（WCO）支持
 *
 * 编辑器窗口始终以"隐藏原生标题栏 + 原生窗口控制按钮覆盖层"创建
 * （见 src-main/windows/editor.js），「Windows 窗口样式」开关只切换
 * 渲染层的呈现方式，两者都在 <html> 上以 data 属性表达：
 *
 * - data-compact-window-style="normal"（开关关闭，默认）：
 *   在顶部画一条 32px 自绘标题条（可拖动/双击最大化/右键系统菜单，
 *   与原生标题栏等价），界面内容整体下移补偿（#neowarp-titlebar +
 *   #app 的样式见 gui.css「Windows 窗口样式」一节）；
 * - data-compact-window-style="compact"（开关开启）：
 *   隐藏自绘标题条，编辑器顶栏（menu-bar）兼作标题栏（36px，恰为
 *   窄档高度），右上角系统按钮覆盖在顶栏右侧；
 * - data-os-fullscreen="true"|'false': F11 等 OS 级全屏状态，
 *   全屏时隐藏标题条并取消内容区补偿。
 *
 * 只有启用了覆盖层的窗口（Windows）才会挂这些属性；macOS/Linux 下
 * 本模块不做任何事，gui.css 里的样式也不会命中。
 */

const STYLE_ATTRIBUTE = 'data-compact-window-style';
const OS_FULLSCREEN_ATTRIBUTE = 'data-os-fullscreen';

let overlayState = null;
let titleObserver = null;

const ensureTitlebarElement = () => {
  let titlebar = document.getElementById('neowarp-titlebar');
  if (!titlebar) {
    titlebar = document.createElement('div');
    titlebar.id = 'neowarp-titlebar';

    const title = document.createElement('span');
    title.id = 'neowarp-titlebar-title';
    titlebar.appendChild(title);

    document.body.appendChild(titlebar);
  }
  return titlebar;
};

const syncTitleText = () => {
  const title = document.getElementById('neowarp-titlebar-title');
  if (!title) {
    return;
  }
  // document.title 由 scratch-gui 随工程名更新为"工程名 - NeoWarp"，
  // 直接镜像即可，与原生标题栏的显示内容一致
  title.textContent = document.title;
};

const ensureTitleObserver = () => {
  if (titleObserver) {
    return;
  }
  // document.title 的写入最终反映为 <head> 内 <title> 的文本变化，
  // 观察 head 即可同步工程名；childList 以防 <title> 会被整体替换
  titleObserver = new MutationObserver(syncTitleText);
  titleObserver.observe(document.head, {
    subtree: true,
    childList: true,
    characterData: true
  });
};

/**
 * 把当前 overlayState 落到 <html> 属性上。
 * 属性变更后补发一次 resize：scratch-blocks 只在 window 的 resize 事件
 * 里重新测量代码区（与 data-toolbar-height 切换的做法一致）。
 */
const applyOverlayState = (dispatchResize) => {
  if (!overlayState || !overlayState.hasOverlay) {
    return;
  }
  const root = document.documentElement;
  const next = overlayState.compact ? 'compact' : 'normal';
  if (root.getAttribute(STYLE_ATTRIBUTE) === next) {
    if (!dispatchResize) {
      return;
    }
  } else {
    root.setAttribute(STYLE_ATTRIBUTE, next);
  }

  if (next === 'normal') {
    // 自绘标题条由 CSS 控制显隐，元素与标题文本监听常备即可
    ensureTitlebarElement();
    ensureTitleObserver();
    syncTitleText();
  }

  // 布局切换后标题条的取色来源改变（自绘条 ⇄ 顶栏），按钮区底色需重测
  ensureColorObserver();
  pushOverlayColor();

  if (dispatchResize) {
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
  }
};

const applyOSFullscreen = (fullscreen) => {
  if (!overlayState || !overlayState.hasOverlay) {
    return;
  }
  document.documentElement.setAttribute(
    OS_FULLSCREEN_ATTRIBUTE, fullscreen ? 'true' : 'false');
};

// ============================================================
// NeoWarp: 系统按钮区底色同步
//
// 右上角最小化/最大化/关闭的按钮覆盖层由主进程 setTitleBarOverlay
// 单独绘制底色，而标题条本身（自绘条或顶栏）由渲染层按主题变量绘制，
// 两边是两套独立上色。主进程原实现把亮色底色硬编码为 TurboWarp 默认
// 强调色（红），一旦积木颜色/主题色不是红色，切换到浅色主题后按钮区
// 就和标题条对不上（深色恰好同为 #333333 所以看不出问题）。
//
// 这里持续测量"当前实际画在标题条上的颜色"并上报主进程；主进程按
// 主题分别保存（存下来的颜色在深浅来回切换时直接复用，不会闪色）。
// ============================================================

let colorObserver = null;
/** 每个主题最近上报成功的颜色，用于去重 */
const pushedColors = {dark: '', light: ''};

/**
 * 任意 CSS 颜色（hsla/rgba/命名色等）→ #rrggbb。
 * 覆盖层需要不透明底色，带透明度或解析失败时返回 null。
 */
const cssColorToHex = (color) => {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    ctx.fillStyle = '#000000';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    if (data[3] < 255) {
      return null;
    }
    return `#${[data[0], data[1], data[2]].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  } catch (e) {
    return null;
  }
};

/**
 * 读取"当前画在标题条上的颜色"：
 * compact 模式 = 编辑器顶栏（menu-bar）元素；
 * normal 模式 = 自绘标题条元素；
 * 元素尚未渲染时退回 <html> 上的主题变量（与 gui.css 同一变量），
 * 再退 meta theme-color（scratch-gui 每次应用主题都会写入解析后的
 * 顶栏底色），全都没有时返回 null。
 */
const readTitleBarColor = () => {
  const candidates = [];
  if (overlayState && overlayState.compact) {
    // CSS Modules 编译后类名带哈希，选择器写法与 gui.css 保持一致
    const menuBar = document.querySelector('[class*="menu-bar_menu-bar_"]');
    if (menuBar) {
      candidates.push(menuBar);
    }
  } else {
    const titlebar = document.getElementById('neowarp-titlebar');
    if (titlebar) {
      candidates.push(titlebar);
    }
  }
  for (const el of candidates) {
    const bg = window.getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      return bg;
    }
  }
  const isDark = document.documentElement.getAttribute('data-gui-theme') === 'dark';
  const variable = isDark ? '--menu-bar-background' : '--looks-secondary';
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(variable);
  if (value && value.trim()) {
    return value.trim();
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    return meta.getAttribute('content');
  }
  return null;
};

/**
 * 把当前主题的标题条颜色上报给主进程（按主题去重，避免 IPC 刷屏）。
 * 上报失败不静默吞掉界面状态：主进程继续使用存量颜色/硬编码兜底。
 */
const pushOverlayColor = () => {
  if (!overlayState || !overlayState.hasOverlay) {
    return;
  }
  try {
    const preload = window.EditorPreload;
    if (!preload || !preload.sendTitleBarOverlayColor) {
      return;
    }
    const isDark = document.documentElement.getAttribute('data-gui-theme') === 'dark';
    const theme = isDark ? 'dark' : 'light';
    const color = cssColorToHex(readTitleBarColor() || '');
    if (color === null || color === pushedColors[theme]) {
      return;
    }
    pushedColors[theme] = color;
    preload.sendTitleBarOverlayColor(theme, color);
  } catch (e) {
    // 保持主进程现有颜色
  }
};

const ensureColorObserver = () => {
  if (colorObserver) {
    return;
  }
  // scratch-gui 每次应用主题（guiHelpers 的 applyGuiColors）都会把整套
  // 主题变量写到 <html> 的 inline style；深浅切换、积木颜色切换、系统
  // 外观变化最终都汇到这里。data-gui-theme 由 NeoWarp 单独维护，一并监听。
  colorObserver = new MutationObserver(() => {
    pushOverlayColor();
  });
  colorObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'data-gui-theme']
  });
};

/**
 * 在 React 渲染前调用（index.jsx）：同步读取覆盖层状态并写好初始属性。
 * 已关闭开关 / 非 Windows 时设置属性并补发 resize；未启用覆盖层时不做任何事。
 * @param {boolean} [dispatchResize] 桌面设置切换后的调用传 true（针对性补发 resize）
 */
const setupWindowControlsOverlay = (dispatchResize) => {
  try {
    const preload = window.EditorPreload;
    if (!preload || !preload.getWindowControlsOverlayState) {
      return;
    }
    if (!overlayState) {
      // 首次调用同步读一次主进程状态；之后由推送事件维护
      const state = preload.getWindowControlsOverlayState();
      if (!state || !state.hasOverlay) {
        return;
      }
      overlayState = state;
      applyOverlayState(false);
      if (preload.onCompactWindowStyleChanged) {
        preload.onCompactWindowStyleChanged((compact) => {
          overlayState = {hasOverlay: true, compact: compact === true};
          applyOverlayState(true);
        });
      }
      if (preload.onOSFullscreenChanged) {
        preload.onOSFullscreenChanged(applyOSFullscreen);
      }
      // React 渲染前主题变量还未写入，先挂好监听，由 applyGuiColors 落
      // 变量时触发上报；这里立即补一次（已经就绪就取到）还有兜底延后
      // 一拍再取一次，覆盖监听开始前就已完成的极端时序
      if (preload.sendTitleBarOverlayColor) {
        ensureColorObserver();
        pushOverlayColor();
        window.requestAnimationFrame(pushOverlayColor);
      }
    } else if (typeof dispatchResize === 'boolean') {
      // 后续调用（desktop-hoc 兜底）：只按已有状态重放一遍
      applyOverlayState(dispatchResize);
    }
  } catch (e) {
    // 读不到状态时保持无属性：样式回退到没有标题条的默认布局
  }
};

/**
 * 供 desktop-hoc 兜底调用：与 setupWindowControlsOverlay 的推送处理
 * 等价，用于 React 重挂载时再订阅一次（幂等，属性相同不重复发 resize）。
 */
const applyCompactWindowState = (compact) => {
  if (!overlayState) {
    // 状态未知（模块未初始化）；仅在明确启用覆盖层时才进行兜底
    return;
  }
  overlayState.compact = compact === true;
  applyOverlayState(true);
};

export {
  setupWindowControlsOverlay,
  applyCompactWindowState
};

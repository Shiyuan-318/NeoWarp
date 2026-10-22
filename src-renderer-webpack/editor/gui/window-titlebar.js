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

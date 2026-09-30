const {screen} = require('electron');
const AbstractWindow = require('./abstract');
const {translate} = require('../l10n');
const {APP_NAME} = require('../brand');

/**
 * SOLO 的舞台窗口：展示后台编辑器 VM 的舞台画面。
 * 帧数据由宿主 SoloWindow 转发（solo-stage-window-frame），
 * 绿旗/暂停/停止按钮的指令也经 SoloWindow 转发给后台编辑器。
 * 与 DetachedStageWindow 不同：不做输入回传（SOLO 的舞台只看不操作），
 * 绿旗/暂停/停止按钮固定在舞台画面下方的控制条里，不悬浮遮挡画面，
 * 窗口高度 = 舞台画面高度 + 控制条高度。
 */

// 舞台画面的期望显示宽度（默认 480×360 时画面为 720×540，窗口为 720×586）
const STAGE_TARGET_WIDTH = 720;
// 底部控制条的高度，需与页面里 .controls 的高度保持一致
const CONTROL_BAR_HEIGHT = 46;

/**
 * 依据舞台宽高比计算舞台窗口的内容尺寸：上方是等比缩放的舞台画面，
 * 下方是固定高度的控制条，画面区域比例与舞台完全一致、不留黑边。
 * @param {{width: number, height: number}|null} frameSize 舞台帧的像素尺寸；
 *   还没收到帧时按默认 480×360（4:3）处理
 * @param {{width: number, height: number}} maxArea 窗口可用区域（父窗口范围）
 * @returns {{width: number, height: number}} useContentSize 语义下的窗口尺寸
 */
const computeStageWindowSize = (frameSize, maxArea) => {
  let stageW = 480;
  let stageH = 360;
  if (frameSize && frameSize.width >= 1 && frameSize.height >= 1) {
    stageW = frameSize.width;
    stageH = frameSize.height;
  }
  const maxW = Math.max(320, maxArea.width - 48);
  // 预留控制条高度，保证整个窗口（画面 + 控制条）都能落在可用区域内
  const maxH = Math.max(260, maxArea.height - 48 - CONTROL_BAR_HEIGHT);
  // 先按期望宽度定高，超界再等比缩小，画面比例始终与舞台一致
  let displayW = Math.min(STAGE_TARGET_WIDTH, maxW);
  let displayH = displayW * stageH / stageW;
  if (displayH > maxH) {
    displayH = maxH;
    displayW = displayH * stageW / stageH;
  }
  return {
    width: Math.round(Math.max(240, displayW)),
    height: Math.round(Math.max(180, displayH)) + CONTROL_BAR_HEIGHT
  };
};

class SoloStageWindow extends AbstractWindow {
  /**
   * @param {Electron.BrowserWindow} parentWindow SOLO 主窗口
   * @param {SoloWindow} soloWindow 宿主，负责帧转发与控制指令路由
   */
  constructor (parentWindow, soloWindow) {
    super({
      parentWindow
    });

    this.soloWindow = soloWindow;
    this.isReady = false;

    this.window.setTitle(`${translate('solo-stage.title', 'Stage')} - ${APP_NAME}`);

    this.window.on('closed', () => {
      if (this.soloWindow) {
        this.soloWindow.handleStageWindowClosed();
      }
    });

    this.ipc.on('solo-stage-window-ready', () => {
      this.isReady = true;
      // 开窗后同步一次运行状态，按钮图标才能摆到正确的档位
      this.soloWindow.queryStageRunState();
    });

    this.ipc.on('solo-stage-window-control', (event, action) => {
      this.soloWindow.controlStage(action);
    });

    // 开窗前按当前舞台比例修正尺寸：getDimensions 在父类构造期间执行，
    // 那时 this.soloWindow 还没赋值，只能先落到默认 4:3，这里再改过来。
    // 此刻窗口还未 show，不会有可见的尺寸跳变。
    this.fitToStage(this.soloWindow.getStageFrameSize ? this.soloWindow.getStageFrameSize() : null);

    this.loadURL('tw-solo-stage://./index.html');
    this.show();
  }

  getPreload () {
    return 'solo-stage';
  }

  getWindowOptions () {
    const opts = super.getWindowOptions();
    if (this.parentWindow) {
      opts.parent = this.parentWindow;
    }
    return opts;
  }

  getDimensions () {
    // 窗口大小跟随当前 sb3 舞台的宽高比（构造初期 soloWindow 未就绪时按 480×360）
    const frameSize = this.soloWindow && this.soloWindow.getStageFrameSize ?
      this.soloWindow.getStageFrameSize() : null;
    return computeStageWindowSize(frameSize, this.getStageMaxArea());
  }

  /**
   * 窗口尺寸的上限区域：优先用父窗口（SOLO 主窗口）的范围，保证弹窗居中于其上。
   */
  getStageMaxArea () {
    try {
      if (this.parentWindow && !this.parentWindow.isDestroyed()) {
        return this.parentWindow.getBounds();
      }
    } catch (e) {
      // Window might be closing
    }
    return screen.getPrimaryDisplay().workArea;
  }

  /**
   * 舞台比例变化（如 AI 调了舞台尺寸）时，把窗口调成同样的比例，中心不动。
   *
   * 这个方法每帧都会被调用（帧流约 8fps），所以比例没变时必须立刻返回、
   * 完全不碰窗口：在 Windows 的非 100% 显示缩放下，反复 setContentSize/
   * setPosition 的 DIP↔物理像素换算误差会逐帧累积，表现为窗口持续向
   * 右下角缓慢漂移。
   * @param {{width: number, height: number}|null} frameSize
   */
  fitToStage (frameSize) {
    if (!frameSize || !this.window || this.window.isDestroyed()) return;
    const want = computeStageWindowSize(frameSize, this.getStageMaxArea());
    let cur;
    let outer;
    try {
      cur = this.window.getContentSize();
      outer = this.window.getBounds();
    } catch (e) {
      // Window might be closing
      return;
    }
    // 比例差异小于 2% 视为没变（覆盖亚像素舍入），窗口保持原样
    const curRatio = cur[0] / Math.max(1, cur[1]);
    const wantRatio = want.width / Math.max(1, want.height);
    if (Math.abs(curRatio - wantRatio) / wantRatio < 0.02) return;
    try {
      // 用当前内容/外框差推算窗口边框，一次 setBounds 同时改尺寸并绕中心居中
      const frameW = outer.width - cur[0];
      const frameH = outer.height - cur[1];
      const centerX = outer.x + outer.width / 2;
      const centerY = outer.y + outer.height / 2;
      this.window.setBounds({
        x: Math.round(centerX - (want.width + frameW) / 2),
        y: Math.round(centerY - (want.height + frameH) / 2),
        width: Math.round(want.width + frameW),
        height: Math.round(want.height + frameH)
      });
    } catch (e) {
      // Window might be closing
    }
  }

  isPopup () {
    return true;
  }

  getBackgroundColor () {
    return '#0d0d0f';
  }

  sendFrame (dataURL) {
    if (!this.isReady) return;
    try {
      this.window.webContents.send('solo-stage-window-frame', dataURL);
    } catch (e) {
      // Window might be closing
    }
  }

  sendRunStatus (status) {
    if (!this.isReady) return;
    try {
      this.window.webContents.send('solo-stage-window-run-status', status);
    } catch (e) {
      // Window might be closing
    }
  }

  /**
   * 推送舞台 DOM 覆盖层状态（变量监视器 + 提问框）。
   * 这些元素在 scratch-gui 里是 DOM，不在 canvas 快照里。
   * @param {{monitors: Array, prompt: object|null}} data
   */
  sendOverlays (data) {
    if (!this.isReady) return;
    try {
      this.window.webContents.send('solo-stage-window-overlays', data);
    } catch (e) {
      // Window might be closing
    }
  }

  sendState (state) {
    if (!this.isReady) return;
    try {
      this.window.webContents.send('solo-stage-window-state', state);
    } catch (e) {
      // Window might be closing
    }
  }

  static show (parentWindow, soloWindow) {
    const existing = AbstractWindow.getWindowsByClass(SoloStageWindow)
      .find(w => w.soloWindow === soloWindow);
    if (existing) {
      existing.show();
      return existing;
    }
    return new SoloStageWindow(parentWindow, soloWindow);
  }
}

module.exports = SoloStageWindow;

const AbstractWindow = require('./abstract');
const {screen} = require('electron');
const {translate} = require('../l10n');
const {APP_NAME} = require('../brand');

class DetachedStageWindow extends AbstractWindow {
  constructor(parentWindow, editorWindow, stageWidth, stageHeight) {
    super({
      parentWindow
    });

    this.editorWindow = editorWindow;
    this.isReady = false;
    this.stageWidth = stageWidth || 480;
    this.stageHeight = stageHeight || 360;

    this.window.setTitle(`${translate('detached-stage.title', 'Detached Stage')} - ${APP_NAME}`);

    // Resize the window to match the stage's aspect ratio
    this.applyStageAspectBounds();

    this.window.on('closed', () => {
      this.editorWindow.handleDetachedStageClosed();
    });

    this.ipc.on('detached-stage-ready', () => {
      this.isReady = true;
      // Inform the renderer of the actual stage dimensions
      try {
        this.window.webContents.send('detached-stage-dimensions', {
          width: this.stageWidth,
          height: this.stageHeight
        });
      } catch (e) {
        // Window might be closing
      }
    });

    this.ipc.on('detached-stage-input', (event, inputData) => {
      this.editorWindow.handleDetachedStageInput(inputData);
    });

    this.loadURL('tw-detached-stage://./index.html');
    this.show();
  }

  /**
   * Compute a window size that preserves the stage aspect ratio and fits the screen.
   */
  applyStageAspectBounds() {
    const targetScale = 2; // 2x the stage native size for better visibility
    let width = this.stageWidth * targetScale;
    let height = this.stageHeight * targetScale;

    // Cap to a reasonable maximum so very large stages don't create oversized windows
    const MAX_WIDTH = 1280;
    const MAX_HEIGHT = 800;
    const fitScale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
    width = Math.round(width * fitScale);
    height = Math.round(height * fitScale);

    // Prefer centering on the parent window; fall back to the active display.
    let area;
    if (this.parentWindow) {
      area = this.parentWindow.getBounds();
    } else {
      area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    }
    const bounds = AbstractWindow.calculateWindowBounds(area, {width, height});
    this.window.setBounds(bounds);
  }

  getPreload() {
    return 'detached-stage';
  }

  getWindowOptions() {
    const opts = super.getWindowOptions();
    if (this.parentWindow) {
      opts.parent = this.parentWindow;
    }
    return opts;
  }

  getDimensions() {
    // Fallback used during initial super() construction; actual bounds are
    // corrected in applyStageAspectBounds() afterwards.
    return {
      width: 960,
      height: 800
    };
  }

  isPopup() {
    return true;
  }

  getBackgroundColor() {
    return '#ffffff';
  }

  sendFrame(dataURL) {
    if (!this.isReady) return;
    try {
      this.window.webContents.send('stage-frame', dataURL);
    } catch (e) {
      // Window might be closing
    }
  }

  close() {
    try {
      this.window.webContents.send('close-detached-stage');
    } catch (e) {
      // Window might already be closed
    }
    this.window.close();
  }
}

module.exports = DetachedStageWindow;

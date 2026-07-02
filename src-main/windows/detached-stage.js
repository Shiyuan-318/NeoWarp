const AbstractWindow = require('./abstract');
const {translate} = require('../l10n');
const {APP_NAME} = require('../brand');

class DetachedStageWindow extends AbstractWindow {
  constructor(parentWindow, editorWindow) {
    super({
      parentWindow
    });

    this.editorWindow = editorWindow;
    this.isReady = false;

    this.window.setTitle(`${translate('detached-stage.title', 'Detached Stage')} - ${APP_NAME}`);

    this.window.on('closed', () => {
      this.editorWindow.handleDetachedStageClosed();
    });

    this.ipc.on('detached-stage-ready', () => {
      this.isReady = true;
    });

    this.ipc.on('detached-stage-input', (event, inputData) => {
      this.editorWindow.handleDetachedStageInput(inputData);
    });

    this.loadURL('tw-detached-stage://./index.html');
    this.show();
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
    // Stage native size is 480x360, scale to 2x for better visibility (960x720)
    // Add some extra space for borders/title bar
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

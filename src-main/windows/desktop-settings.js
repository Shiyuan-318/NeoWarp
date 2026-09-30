const {app, shell, ipcMain} = require('electron');
const fs = require('fs');
const path = require('path');
const AbstractWindow = require('./abstract');
const {translate, getStrings, getLocale} = require('../l10n');
const {APP_NAME} = require('../brand');
const settings = require('../settings');
const {registerAiModelConfigIpc} = require('../ai-model-configs');
const {getEffectiveTheme} = require('../effective-theme');
const {manualCheck} = require('../update-checker');
const RichPresence = require('../rich-presence');
// app.getVersion() returns the Electron version when started via `electron src-main/entrypoint.js`,
// so read the app version from package.json like update-checker does
const {version: APP_VERSION} = require('../../package.json');

class DesktopSettingsWindow extends AbstractWindow {
  constructor () {
    super();

    this.window.setTitle(`${translate('desktop-settings.title')} - ${APP_NAME}`);
    this.window.setMinimizable(false);
    this.window.setMaximizable(false);

    this.ipc.handle('ds-get-theme', () => getEffectiveTheme());

    // 统一的 AI 模型配置存储（与 AI 助手 / SOLO / 扩展编辑器共用）：
    // 读取/保存/广播 + 打开桌面设置窗口
    registerAiModelConfigIpc(this.ipc);

    this.ipc.on('init', (event) => {
      event.returnValue = {
        locale: getLocale(),
        strings: getStrings(),
        version: APP_VERSION,
        settings: {
          updateCheckerAllowed: true,
          updateChecker: settings.updateChecker,
          uiTheme: settings.uiTheme,
          microphone: settings.microphone,
          camera: settings.camera,
          hardwareAcceleration: settings.hardwareAcceleration,
          backgroundThrottling: settings.backgroundThrottling,
          bypassCORS: settings.bypassCORS,
          spellchecker: settings.spellchecker,
          exitFullscreenOnEscape: settings.exitFullscreenOnEscape,
          richPresenceAvailable: RichPresence.isAvailable(),
          richPresence: settings.richPresence,
          codeAreaBackgroundImage: settings.codeAreaBackgroundImage,
          stageAreaBackgroundImage: settings.stageAreaBackgroundImage,
          homeLogo: settings.homeLogo,
          homeLogoText: settings.homeLogoText,
          homeBackground: settings.homeBackground,
          showRecentProjects: settings.showRecentProjects
        }
      };
    });

    this.ipc.handle('set-update-checker', async (event, updateChecker) => {
      settings.updateChecker = updateChecker;
      await settings.save();
    });

    this.ipc.handle('set-ui-theme', async (event, uiTheme) => {
      if (uiTheme !== 'light' && uiTheme !== 'dark' && uiTheme !== 'system') {
        return;
      }
      settings.uiTheme = uiTheme;
      await settings.save();
      // 推送给编辑器：写入 tw:theme 并经 Redux 即时切换；
      // 编辑器随后通过 theme-changed 广播带动 SOLO、AI 助手等子窗口
      const EditorWindow = require('./editor');
      for (const editorWindow of AbstractWindow.getWindowsByClass(EditorWindow)) {
        if (!editorWindow.window.isDestroyed()) {
          editorWindow.window.webContents.send('global-ui-theme-changed', uiTheme);
        }
      }
      // 固定浅/深色时本窗口立即跟随；跟随系统时由编辑器的主题广播带回实际主题
      if (uiTheme !== 'system') {
        for (const dsWindow of AbstractWindow.getWindowsByClass(DesktopSettingsWindow)) {
          if (!dsWindow.window.isDestroyed()) {
            dsWindow.window.webContents.send('ds-theme-changed', { theme: uiTheme });
          }
        }
      }
      // 主页窗口：固定浅/深色直接生效；跟随系统时若没有编辑器在广播主题，
      // 则按系统外观推送（有编辑器时由编辑器的 theme-changed 广播带动）
      const HomeWindow = require('./home');
      if (uiTheme !== 'system') {
        HomeWindow.broadcastTheme(uiTheme);
      } else {
        const EditorWindow = require('./editor');
        if (AbstractWindow.getWindowsByClass(EditorWindow).length === 0) {
          const {nativeTheme} = require('electron');
          HomeWindow.broadcastTheme(nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
        }
      }
      // AI 助手与 SOLO：同样固定浅/深色直接生效；跟随系统且没有编辑器广播
      // 主题时按系统外观推送（有编辑器时由编辑器的 theme-changed 广播带动）
      const AIAssistantWindow = require('./ai-assistant');
      if (uiTheme !== 'system') {
        AIAssistantWindow.broadcastTheme(uiTheme);
      } else {
        const EditorWindow = require('./editor');
        if (AbstractWindow.getWindowsByClass(EditorWindow).length === 0) {
          const {nativeTheme} = require('electron');
          AIAssistantWindow.broadcastTheme(nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
        }
      }
    });

    this.ipc.handle('check-for-updates', async () => {
      try {
        const result = await manualCheck();
        return result;
      } catch (error) {
        console.error('Error checking for updates:', error);
        return {
          hasUpdate: false,
          error: error.message
        };
      }
    });

    this.ipc.handle('enumerate-media-devices', async () => {
      // Imported late due to circular dependencies
      const EditorWindow = require('./editor');
      const anEditorWindow = AbstractWindow.getWindowsByClass(EditorWindow)[0];
      if (!anEditorWindow) {
        // If you change this error message, please make sure to update desktop settings' error handling
        throw new Error('Editor must be open');
      }
      return anEditorWindow.enumerateMediaDevices();
    });

    this.ipc.handle('set-microphone', async (event, microphone) => {
      settings.microphone = microphone;
      await settings.save();
    });

    this.ipc.handle('set-camera', async (event, camera) => {
      settings.camera = camera;
      await settings.save();
    });

    this.ipc.handle('set-hardware-acceleration', async (event, hardwareAcceleration) => {
      settings.hardwareAcceleration = hardwareAcceleration;
      await settings.save();
    });

    this.ipc.handle('set-background-throttling', async (event, backgroundThrottling) => {
      settings.backgroundThrottling = backgroundThrottling;
      AbstractWindow.settingsChanged();
      await settings.save();
    });

    this.ipc.handle('set-bypass-cors', async (event, bypassCORS) => {
      settings.bypassCORS = bypassCORS;
      await settings.save();
    });

    this.ipc.handle('set-spellchecker', async (event, spellchecker) => {
      settings.spellchecker = spellchecker;
      AbstractWindow.settingsChanged();
      await settings.save();
    });

    this.ipc.handle('set-exit-fullscreen-on-escape', async (event, exitFullscreenOnEscape) => {
      settings.exitFullscreenOnEscape = exitFullscreenOnEscape;
      await settings.save();
    });

    this.ipc.handle('set-rich-presence', async (event, richPresence) => {
      settings.richPresence = richPresence;
      if (richPresence) {
        RichPresence.enable();
      } else {
        RichPresence.disable();
      }
      await settings.save();
    });

    this.ipc.handle('open-user-data', async () => {
      shell.showItemInFolder(app.getPath('userData'));
    });

    this.ipc.handle('set-code-area-background-image', async (event, imageData) => {
      settings.codeAreaBackgroundImage = imageData;
      AbstractWindow.settingsChanged();
      await settings.save();
    });

    this.ipc.handle('set-stage-area-background-image', async (event, imageData) => {
      settings.stageAreaBackgroundImage = imageData;
      AbstractWindow.settingsChanged();
      await settings.save();
    });

    this.ipc.handle('set-top-bar-device-stats', async (event, topBarDeviceStats) => {
      settings.topBarDeviceStats = topBarDeviceStats;
      AbstractWindow.settingsChanged();
      await settings.save();
    });

    this.ipc.handle('set-home-logo', async (event, homeLogo) => {
      if (homeLogo !== null && typeof homeLogo !== 'string') {
        return;
      }
      settings.homeLogo = homeLogo || null;
      await settings.save();
      const HomeWindow = require('./home');
      HomeWindow.broadcastBranding();
    });

    this.ipc.handle('set-home-logo-text', async (event, homeLogoText) => {
      if (homeLogoText !== null && typeof homeLogoText !== 'string') {
        return;
      }
      settings.homeLogoText = homeLogoText || null;
      await settings.save();
      const HomeWindow = require('./home');
      HomeWindow.broadcastBranding();
    });

    // 主页自定义背景图：null 表示恢复默认环境光背景
    this.ipc.handle('set-home-background', async (event, homeBackground) => {
      if (homeBackground !== null && typeof homeBackground !== 'string') {
        return;
      }
      settings.homeBackground = homeBackground || null;
      await settings.save();
      const HomeWindow = require('./home');
      HomeWindow.broadcastBranding();
    });

    this.ipc.handle('reset-home-branding', async () => {
      settings.homeLogo = null;
      settings.homeLogoText = null;
      settings.homeBackground = null;
      await settings.save();
      const HomeWindow = require('./home');
      HomeWindow.broadcastBranding();
    });

    // 是否在主页显示"最近项目"：保存后广播主页刷新
    this.ipc.handle('set-show-recent-projects', async (event, showRecentProjects) => {
      settings.showRecentProjects = showRecentProjects === true;
      await settings.save();
      const HomeWindow = require('./home');
      HomeWindow.broadcastRecentProjects();
    });

    // 默认主页 Logo 的 data URL，用于设置页预览（tw-desktop-settings 协议
    // 根目录之外无法直接引用主页的 logo.png）
    this.ipc.handle('home-get-default-logo', () => {
      try {
        const file = path.resolve(__dirname, '../../src-renderer/home/logo.png');
        return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
      } catch (e) {
        return null;
      }
    });

    this.loadURL('tw-desktop-settings://./desktop-settings.html');
  }

  getDimensions () {
    return {
      width: 800,
      height: 560
    };
  }

  getPreload () {
    return 'desktop-settings';
  }

  isPopup () {
    return true;
  }

  static show () {
    const window = AbstractWindow.singleton(DesktopSettingsWindow);
    window.show();
  }
}

module.exports = DesktopSettingsWindow;

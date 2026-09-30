const path = require('path');
const {dialog, nativeTheme} = require('electron');
const AbstractWindow = require('./abstract');
const DesktopSettingsWindow = require('./desktop-settings');
const settings = require('../settings');
const {getEffectiveTheme} = require('../effective-theme');
const {getRecentProjects} = require('../recent-projects');
const {APP_NAME} = require('../brand');
const packageJSON = require('../../package.json');

const LIGHT_BACKGROUND = '#f2f2f7';
const DARK_BACKGROUND = '#0a0a0d';

class HomeWindow extends AbstractWindow {
  constructor () {
    super();

    this.window.setTitle(APP_NAME);

    this.ipc.on('home-get-info', (event) => {
      event.returnValue = {
        locale: settings.locale,
        version: packageJSON.version,
        homeLogo: settings.homeLogo,
        homeLogoText: settings.homeLogoText,
        homeBackground: settings.homeBackground
      };
    });

    this.ipc.handle('home-get-theme', () => getEffectiveTheme());

    // 渲染进程应用主题后回带，用于同步窗口背景色，避免边缘露底
    this.ipc.on('home-theme-applied', (event, theme) => {
      try {
        this.window.setBackgroundColor(theme === 'light' ? LIGHT_BACKGROUND : DARK_BACKGROUND);
      } catch (e) {
        // window destroyed
      }
    });

    this.ipc.handle('home-new-scratch-project', () => {
      // Imported late due to circular dependencies
      const EditorWindow = require('./editor');
      EditorWindow.newWindow();
    });

    this.ipc.handle('home-new-extension', () => {
      // Imported late due to circular dependencies
      const ExtensionEditorWindow = require('./extension-editor');
      ExtensionEditorWindow.newWindow();
    });

    this.ipc.handle('home-open-solo', () => {
      // Imported late due to circular dependencies
      const SoloWindow = require('./solo');
      SoloWindow.show();
    });

    this.ipc.handle('home-open-file', async () => {
      const result = await dialog.showOpenDialog(this.window, {
        properties: ['openFile'],
        defaultPath: settings.lastDirectory,
        filters: [
          {
            name: 'NeoWarp',
            extensions: ['sb3', 'js', 'np1', 'npnp']
          },
          {
            name: 'Scratch Project',
            extensions: ['sb3', 'np1', 'sb2', 'sb', 'npnp', 'viewsb3']
          },
          {
            name: 'JavaScript',
            extensions: ['js']
          }
        ]
      });
      if (result.canceled) {
        return 'cancelled';
      }

      const filePath = result.filePaths[0];
      settings.lastDirectory = path.dirname(filePath);
      await settings.save();

      if (path.extname(filePath).toLowerCase() === '.js') {
        // .js 文件由扩展项目编辑器打开
        const ExtensionEditorWindow = require('./extension-editor');
        ExtensionEditorWindow.openFile(filePath);
        return 'opened';
      }

      // Imported late due to circular dependencies
      const EditorWindow = require('./editor');
      EditorWindow.openFiles([filePath], false, '');
      return 'opened';
    });

    this.ipc.handle('home-open-image-editor', () => {
      // Imported late due to circular dependencies
      const ImageEditorWindow = require('./image-editor');
      ImageEditorWindow.show();
    });

    // 主页「加入协作」：弹出加入表单（局域网搜索 + 手动填写），
    // 连接成功后由协作窗口创建并挂载编辑器
    this.ipc.handle('home-open-collab-join', () => {
      const CollaborationWindow = require('./collaboration');
      CollaborationWindow.showJoinFromHome();
    });

    // 主页「发起协作」：新建空白项目并打开协作发起面板
    this.ipc.handle('home-open-collab-host-new', () => {
      const EditorWindow = require('./editor');
      const editorWindow = EditorWindow.newWindow(false);
      const CollaborationWindow = require('./collaboration');
      const win = CollaborationWindow.showHost(editorWindow);
      if (win && win.markEditorPending) {
        win.markEditorPending();
      }
    });

    // 主页「发起协作」：选择 sb3 等项目文件并打开协作发起面板
    this.ipc.handle('home-open-collab-host-file', async () => {
      const result = await dialog.showOpenDialog(this.window, {
        properties: ['openFile'],
        defaultPath: settings.lastDirectory,
        filters: [
          {
            name: 'Scratch Project',
            extensions: ['sb3', 'np1', 'sb2', 'sb', 'npnp', 'viewsb3']
          }
        ]
      });
      if (result.canceled) {
        return 'cancelled';
      }

      const filePath = result.filePaths[0];
      settings.lastDirectory = path.dirname(filePath);
      await settings.save();

      const EditorWindow = require('./editor');
      const windows = EditorWindow.openFiles([filePath], false, '');
      const CollaborationWindow = require('./collaboration');
      const win = CollaborationWindow.showHost(windows[0]);
      if (win && win.markEditorPending) {
        win.markEditorPending();
      }
      return 'opened';
    });

    this.ipc.handle('home-open-settings', () => {
      DesktopSettingsWindow.show();
    });

    // 主页"最近项目"：读取列表（已过滤不存在的文件）
    this.ipc.handle('home-get-recent-projects', () => ({
      show: settings.showRecentProjects,
      projects: getRecentProjects()
    }));

    // 点击最近项目直接打开，按类型分流
    this.ipc.handle('home-open-recent', async (event, filePath) => {
      const resolved = path.resolve(String(filePath));
      const projects = getRecentProjects();
      if (!projects.some((i) => i.path === resolved)) {
        return 'not-found';
      }
      settings.lastDirectory = path.dirname(resolved);
      await settings.save();

      if (path.extname(resolved).toLowerCase() === '.js') {
        const ExtensionEditorWindow = require('./extension-editor');
        ExtensionEditorWindow.openFile(resolved);
        return 'opened';
      }

      const EditorWindow = require('./editor');
      EditorWindow.openFiles([resolved], false, '');
      return 'opened';
    });

    // 回到主页（窗口重新聚焦）时刷新最近项目列表
    this.window.on('focus', () => {
      if (!this.window.isDestroyed()) {
        this.window.webContents.send('home-recent-changed');
      }
    });

    this.loadURL('tw-home://./home.html');
  }

  getPreload () {
    return 'home';
  }

  getDimensions () {
    return {
      width: 1280,
      height: 800
    };
  }

  getBackgroundColor () {
    if (settings.uiTheme === 'light') {
      return LIGHT_BACKGROUND;
    }
    if (settings.uiTheme === 'dark') {
      return DARK_BACKGROUND;
    }
    return nativeTheme.shouldUseDarkColors ? DARK_BACKGROUND : LIGHT_BACKGROUND;
  }

  /**
   * 向所有主页窗口广播品牌自定义设置（Logo、标题文字与背景图）。
   */
  static broadcastBranding () {
    for (const homeWindow of AbstractWindow.getWindowsByClass(HomeWindow)) {
      if (!homeWindow.window.isDestroyed()) {
        homeWindow.window.webContents.send('home-branding-changed', {
          logo: settings.homeLogo,
          text: settings.homeLogoText,
          background: settings.homeBackground
        });
      }
    }
  }

  /**
   * 向所有主页窗口广播"最近项目"有变化（或可见性开关变化），
   * 渲染层收到后重新拉取列表。
   */
  static broadcastRecentProjects () {
    for (const homeWindow of AbstractWindow.getWindowsByClass(HomeWindow)) {
      if (!homeWindow.window.isDestroyed()) {
        homeWindow.window.webContents.send('home-recent-changed');
      }
    }
  }

  /**
   * 向所有主页窗口广播主题变化。
   * @param {'light'|'dark'} theme
   */
  static broadcastTheme (theme) {
    for (const homeWindow of AbstractWindow.getWindowsByClass(HomeWindow)) {
      if (!homeWindow.window.isDestroyed()) {
        homeWindow.window.webContents.send('home-theme-changed', { theme });
      }
    }
  }

  static show () {
    const window = AbstractWindow.singleton(HomeWindow);
    window.show();
  }
}

module.exports = HomeWindow;

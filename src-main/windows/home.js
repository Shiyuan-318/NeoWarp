const path = require('path');
const {dialog} = require('electron');
const AbstractWindow = require('./abstract');
const DesktopSettingsWindow = require('./desktop-settings');
const settings = require('../settings');
const {APP_NAME} = require('../brand');
const packageJSON = require('../../package.json');

class HomeWindow extends AbstractWindow {
  constructor () {
    super();

    this.window.setTitle(APP_NAME);

    this.ipc.on('home-get-info', (event) => {
      event.returnValue = {
        locale: settings.locale,
        version: packageJSON.version
      };
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

    this.ipc.handle('home-open-file', async () => {
      const result = await dialog.showOpenDialog(this.window, {
        properties: ['openFile'],
        defaultPath: settings.lastDirectory,
        filters: [
          {
            name: 'NeoWarp',
            extensions: ['sb3', 'js']
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

    this.ipc.handle('home-open-settings', () => {
      DesktopSettingsWindow.show();
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
    return '#0d0d0f';
  }

  static show () {
    const window = AbstractWindow.singleton(HomeWindow);
    window.show();
  }
}

module.exports = HomeWindow;

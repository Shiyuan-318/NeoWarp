const {ipcMain} = require('electron');
const AbstractWindow = require('./abstract');
const {translate} = require('../l10n');
const {APP_NAME} = require('../brand');

class ContactWindow extends AbstractWindow {
  constructor () {
    super();

    this.window.setMinimizable(false);
    this.window.setMaximizable(false);
    this.window.setTitle(`${translate('contact-us.title')} - ${APP_NAME}`);

    this.ipc.handle('contact-get-theme', () => {
      const EditorWindow = require('./editor');
      const anEditorWindow = AbstractWindow.getWindowsByClass(EditorWindow)[0];
      if (!anEditorWindow || anEditorWindow.window.isDestroyed()) {
        return 'light';
      }
      return new Promise((resolve) => {
        const requestId = Date.now().toString();
        const handler = (event, data) => {
          if (data && data.requestId === requestId) {
            ipcMain.removeListener('theme-response', handler);
            resolve(data.theme || 'light');
          }
        };
        ipcMain.on('theme-response', handler);
        anEditorWindow.window.webContents.send('request-theme', { requestId });
        setTimeout(() => {
          ipcMain.removeListener('theme-response', handler);
          resolve('light');
        }, 3000);
      });
    });

    this.loadURL('tw-contact://./contact.html');
  }

  getDimensions () {
    return {
      width: 600,
      height: 400
    };
  }

  getPreload () {
    return 'contact';
  }

  isPopup () {
    return true;
  }

  static show () {
    const window = AbstractWindow.singleton(ContactWindow);
    window.show();
  }
}

module.exports = ContactWindow;

const {ipcMain, nativeTheme} = require('electron');
const settings = require('./settings');

/**
 * 解析当前生效的 UI 主题：
 * 全局设置为固定浅色/深色时直接返回；跟随系统时优先询问已打开的
 * 编辑器窗口（其自身可能配置了主题），没有编辑器时退回系统外观。
 * @returns {Promise<'light'|'dark'>}
 */
const getEffectiveTheme = () => {
  if (settings.uiTheme === 'light' || settings.uiTheme === 'dark') {
    return Promise.resolve(settings.uiTheme);
  }
  // Late requires to avoid circular dependencies
  const AbstractWindow = require('./windows/abstract');
  const EditorWindow = require('./windows/editor');
  const anEditorWindow = AbstractWindow.getWindowsByClass(EditorWindow)[0];
  if (!anEditorWindow || anEditorWindow.window.isDestroyed()) {
    return Promise.resolve(nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  }
  return new Promise((resolve) => {
    const requestId = `${Date.now()}:${Math.random()}`;
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
      resolve(nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    }, 3000);
  });
};

module.exports = { getEffectiveTheme };

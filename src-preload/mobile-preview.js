const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('MobilePreviewPreload', {
  start: () => ipcRenderer.invoke('mobile-preview-start'),
  stop: () => ipcRenderer.invoke('mobile-preview-stop'),
  getQRCode: (url) => ipcRenderer.invoke('mobile-preview-get-qr', url),
  getTheme: () => ipcRenderer.invoke('mobile-preview-get-theme'),
  onThemeChanged: (callback) => {
    ipcRenderer.on('mobile-preview-theme-changed', (event, data) => callback(data));
  }
});

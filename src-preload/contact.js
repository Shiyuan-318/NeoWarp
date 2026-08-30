const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('ContactPreload', {
  getTheme: () => ipcRenderer.invoke('contact-get-theme'),
  onThemeChanged: (callback) => {
    ipcRenderer.on('contact-theme-changed', (event, data) => callback(data));
  }
});

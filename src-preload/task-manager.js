const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('TaskManagerPreload', {
  getSystemStats: () => ipcRenderer.invoke('task-manager-get-system-stats'),
  getSpriteStats: () => ipcRenderer.invoke('task-manager-get-sprite-stats'),
  getTheme: () => ipcRenderer.invoke('task-manager-get-theme'),
  closeWindow: () => ipcRenderer.invoke('task-manager-close-window'),
  onThemeChanged: (callback) => {
    ipcRenderer.on('tm-theme-changed', (event, data) => callback(data));
  },
  removeThemeListener: () => {
    ipcRenderer.removeAllListeners('tm-theme-changed');
  }
});

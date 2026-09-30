const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('HomePreload', {
  getInfo: () => ipcRenderer.sendSync('home-get-info'),
  getTheme: () => ipcRenderer.invoke('home-get-theme'),
  themeApplied: (theme) => ipcRenderer.send('home-theme-applied', theme),
  onThemeChanged: (callback) => {
    ipcRenderer.on('home-theme-changed', (event, data) => callback(data));
  },
  onBrandingChanged: (callback) => {
    ipcRenderer.on('home-branding-changed', (event, data) => callback(data));
  },
  newScratchProject: () => ipcRenderer.invoke('home-new-scratch-project'),
  newExtension: () => ipcRenderer.invoke('home-new-extension'),
  openFromFile: () => ipcRenderer.invoke('home-open-file'),
  openCollabJoin: () => ipcRenderer.invoke('home-open-collab-join'),
  openCollabHostNew: () => ipcRenderer.invoke('home-open-collab-host-new'),
  openCollabHostFromFile: () => ipcRenderer.invoke('home-open-collab-host-file'),
  openImageEditor: () => ipcRenderer.invoke('home-open-image-editor'),
  openSettings: () => ipcRenderer.invoke('home-open-settings'),
  openSolo: () => ipcRenderer.invoke('home-open-solo'),
  getRecentProjects: () => ipcRenderer.invoke('home-get-recent-projects'),
  openRecentProject: (filePath) => ipcRenderer.invoke('home-open-recent', filePath),
  onRecentChanged: (callback) => {
    ipcRenderer.on('home-recent-changed', () => callback());
  }
});

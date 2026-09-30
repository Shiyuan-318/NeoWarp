const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('ImageEditorPreload', {
  getTheme: () => ipcRenderer.invoke('image-editor-get-theme'),
  themeApplied: (theme) => ipcRenderer.send('image-editor-theme-applied', theme),
  openFile: () => ipcRenderer.invoke('image-editor-open-file'),
  saveFile: (payload) => ipcRenderer.invoke('image-editor-save-file', payload)
});

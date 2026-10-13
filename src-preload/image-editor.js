const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('ImageEditorPreload', {
  getTheme: () => ipcRenderer.invoke('image-editor-get-theme'),
  themeApplied: (theme) => ipcRenderer.send('image-editor-theme-applied', theme),
  openFile: () => ipcRenderer.invoke('image-editor-open-file'),
  saveFile: (payload) => ipcRenderer.invoke('image-editor-save-file', payload),
  // 「导出到 Scratch 项目」：列出已打开的项目 / 导入图片 / 项目开关通知
  listProjects: () => ipcRenderer.invoke('image-editor-list-projects'),
  importToProject: (payload) => ipcRenderer.invoke('image-editor-import', payload),
  onProjectsChanged: (callback) => {
    ipcRenderer.on('image-editor-projects-changed', () => callback());
  }
});

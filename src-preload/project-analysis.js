const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('ProjectAnalysisPreload', {
  getProjectData: () => ipcRenderer.invoke('project-analysis-get-data'),
  getTheme: () => ipcRenderer.invoke('project-analysis-get-theme'),
  closeWindow: () => ipcRenderer.invoke('project-analysis-close-window'),
  saveImage: (dataUrl) => ipcRenderer.invoke('project-analysis-save-image', dataUrl),
  onThemeChanged: (callback) => {
    ipcRenderer.on('pa-theme-changed', (event, data) => callback(data));
  },
  removeThemeListener: () => {
    ipcRenderer.removeAllListeners('pa-theme-changed');
  }
});

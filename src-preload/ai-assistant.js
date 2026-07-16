const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('AIAssistantPreload', {
  getProjectCode: () => ipcRenderer.invoke('get-project-code'),
  applyProject: (projectJSON) => ipcRenderer.invoke('apply-project', projectJSON),
  applySprite: (spriteJSON, targetId) => ipcRenderer.invoke('apply-sprite', spriteJSON, targetId),
  getSpriteLibrary: () => ipcRenderer.invoke('get-sprite-library'),
  getSettings: () => ipcRenderer.invoke('get-ai-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-ai-settings', settings),
  callTool: (toolName, params) => ipcRenderer.invoke('ai-tool-call', toolName, params),
  webSearch: (query) => ipcRenderer.invoke('web-search', query),
  getTheme: () => ipcRenderer.invoke('ai-get-theme'),
  getLocale: () => ipcRenderer.invoke('ai-get-locale'),
  closeWindow: () => ipcRenderer.invoke('ai-close-window'),
  onProjectCodeResponse: (callback) => {
    ipcRenderer.on('project-code-response', (event, data) => callback(data));
  },
  onThemeChanged: (callback) => {
    ipcRenderer.on('ai-theme-changed', (event, data) => callback(data));
  },
  onLocaleChanged: (callback) => {
    ipcRenderer.on('ai-locale-changed', (event, data) => callback(data));
  },
  removeThemeListener: () => {
    ipcRenderer.removeAllListeners('ai-theme-changed');
  },
  removeLocaleListener: () => {
    ipcRenderer.removeAllListeners('ai-locale-changed');
  }
});

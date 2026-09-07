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
  // 手机编程：获取局域网链接/二维码信息
  getPhoneLink: () => ipcRenderer.invoke('ai-get-phone-link'),
  // 手机编程：把聊天状态变化广播给已连接的手机
  phoneSyncBroadcast: (payload) => ipcRenderer.send('ai-phone-broadcast', payload),
  onPhoneClientsChanged: (callback) => {
    ipcRenderer.on('ai-phone-clients', (event, data) => callback(data));
  },
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

const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('AIAssistantPreload', {
  getProjectCode: () => ipcRenderer.invoke('get-project-code'),
  applyProject: (projectJSON, sessionId) => ipcRenderer.invoke('apply-project', projectJSON, sessionId),
  applySprite: (spriteJSON, targetId, sessionId) => ipcRenderer.invoke('apply-sprite', spriteJSON, targetId, sessionId),
  getSpriteLibrary: () => ipcRenderer.invoke('get-sprite-library'),
  // 统一的 AI 模型配置存储（与 SOLO、扩展编辑器、桌面设置共用）
  getModelConfigs: () => ipcRenderer.invoke('ai-get-model-configs'),
  saveModelConfigs: (payload) => ipcRenderer.invoke('ai-save-model-configs', payload),
  // tw-ai-proxy 转发协议的能力令牌（主进程按窗口来源签发，带过期时间）
  getAiProxyToken: (targets) => ipcRenderer.invoke('ai-get-proxy-token', {targets}),
  openDesktopSettings: () => ipcRenderer.invoke('open-desktop-settings'),
  // AI 工作流设置（Plan / Spec / Goal）：读取/保存/选目录/文档落盘
  getWorkflowSettings: () => ipcRenderer.invoke('ai-get-workflow-settings'),
  saveWorkflowSettings: (payload) => ipcRenderer.invoke('ai-save-workflow-settings', payload),
  pickWorkflowDocsDir: () => ipcRenderer.invoke('ai-pick-workflow-docs-dir'),
  saveWorkflowDoc: (payload) => ipcRenderer.invoke('ai-save-workflow-doc', payload),
  openWorkflowDocsDir: () => ipcRenderer.invoke('ai-open-workflow-docs-dir'),
  // meta 目前只带 {sessionId}：编辑器据此把改动记进对应对话的 AI 改动日志
  callTool: (toolName, params, meta) => ipcRenderer.invoke('ai-tool-call', toolName, params, meta),
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
  onAiModelConfigsChanged: (callback) => {
    ipcRenderer.on('ai-model-configs-changed', (event, data) => callback(data));
  },
  onWorkflowSettingsChanged: (callback) => {
    ipcRenderer.on('ai-workflow-settings-changed', (event, data) => callback(data));
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

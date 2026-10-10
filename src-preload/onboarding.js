const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('OnboardingPreload', {
  getInfo: () => ipcRenderer.sendSync('onboarding-get-info'),
  getTheme: () => ipcRenderer.invoke('onboarding-get-theme'),
  themeApplied: (theme) => ipcRenderer.send('onboarding-theme-applied', theme),
  onThemeChanged: (callback) => {
    ipcRenderer.on('onboarding-theme-changed', (event, data) => callback(data));
  },
  setLocale: (locale) => ipcRenderer.invoke('onboarding-set-locale', locale),
  setUiTheme: (uiTheme) => ipcRenderer.invoke('onboarding-set-ui-theme', uiTheme),
  // 统一 AI 模型配置（与桌面设置共用）
  getModelConfigs: () => ipcRenderer.invoke('ai-get-model-configs'),
  saveModelConfigs: (payload) => ipcRenderer.invoke('ai-save-model-configs', payload),
  done: () => ipcRenderer.invoke('onboarding-done')
});

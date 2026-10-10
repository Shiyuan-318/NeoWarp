const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('DesktopSettingsPreload', {
  init: () => ipcRenderer.sendSync('init'),
  setUpdateChecker: (updateChecker) => ipcRenderer.invoke('set-update-checker', updateChecker),
  setUITheme: (uiTheme) => ipcRenderer.invoke('set-ui-theme', uiTheme),
  setLocale: (locale) => ipcRenderer.invoke('set-locale', locale),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  enumerateMediaDevices: () => ipcRenderer.invoke('enumerate-media-devices'),
  setMicrophone: (microphone) => ipcRenderer.invoke('set-microphone', microphone),
  setCamera: (camera) => ipcRenderer.invoke('set-camera', camera),
  setHardwareAcceleration: (hardwareAcceleration) => ipcRenderer.invoke('set-hardware-acceleration', hardwareAcceleration),
  setBackgroundThrottling: (backgroundThrottling) => ipcRenderer.invoke('set-background-throttling', backgroundThrottling),
  setBypassCORS: (bypassCORS) => ipcRenderer.invoke('set-bypass-cors', bypassCORS),
  setSpellchecker: (spellchecker) => ipcRenderer.invoke('set-spellchecker', spellchecker),
  setExitFullscreenOnEscape: (exitFullscreenOnEscape) => ipcRenderer.invoke('set-exit-fullscreen-on-escape', exitFullscreenOnEscape),
  setRichPresence: (richPresence) => ipcRenderer.invoke('set-rich-presence', richPresence),
  openUserData: () => ipcRenderer.invoke('open-user-data'),
  setCodeAreaBackgroundImage: (imageData) => ipcRenderer.invoke('set-code-area-background-image', imageData),
  setStageAreaBackgroundImage: (imageData) => ipcRenderer.invoke('set-stage-area-background-image', imageData),
  setTopBarDeviceStats: (topBarDeviceStats) => ipcRenderer.invoke('set-top-bar-device-stats', topBarDeviceStats),
  setHomeLogo: (homeLogo) => ipcRenderer.invoke('set-home-logo', homeLogo),
  setHomeLogoText: (homeLogoText) => ipcRenderer.invoke('set-home-logo-text', homeLogoText),
  setHomeBackground: (homeBackground) => ipcRenderer.invoke('set-home-background', homeBackground),
  resetHomeBranding: () => ipcRenderer.invoke('reset-home-branding'),
  setShowRecentProjects: (showRecentProjects) => ipcRenderer.invoke('set-show-recent-projects', showRecentProjects),
  getDefaultLogo: () => ipcRenderer.invoke('home-get-default-logo'),
  // 统一的 AI 模型配置存储（与 AI 助手 / SOLO / 扩展编辑器共用）
  getAiModelConfigs: () => ipcRenderer.invoke('ai-get-model-configs'),
  saveAiModelConfigs: (payload) => ipcRenderer.invoke('ai-save-model-configs', payload),
  onAiModelConfigsChanged: (callback) => {
    ipcRenderer.on('ai-model-configs-changed', (event, data) => callback(data));
  },
  getTheme: () => ipcRenderer.invoke('ds-get-theme'),
  onThemeChanged: (callback) => {
    ipcRenderer.on('ds-theme-changed', (event, data) => callback(data));
  }
});

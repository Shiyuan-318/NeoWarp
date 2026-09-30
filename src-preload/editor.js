const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('EditorPreload', {
  isInitiallyFullscreen: () => ipcRenderer.sendSync('is-initially-fullscreen'),
  getInitialFile: () => ipcRenderer.invoke('get-initial-file'),
  getFile: (id) => ipcRenderer.invoke('get-file', id),
  openedFile: (id) => ipcRenderer.invoke('opened-file', id),
  closedFile: () => ipcRenderer.invoke('closed-file'),
  showSaveFilePicker: (suggestedName) => ipcRenderer.invoke('show-save-file-picker', suggestedName),
  showOpenFilePicker: () => ipcRenderer.invoke('show-open-file-picker'),
  setLocale: (locale) => ipcRenderer.sendSync('set-locale', locale),
  setChanged: (changed) => ipcRenderer.invoke('set-changed', changed),
  openNewWindow: () => ipcRenderer.invoke('open-new-window'),
  openAddonSettings: (search) => ipcRenderer.invoke('open-addon-settings', search),
  openPackager: () => ipcRenderer.invoke('open-packager'),
  showEncryptedSaveFilePicker: (suggestedName) => ipcRenderer.invoke('show-encrypted-save-file-picker', suggestedName),
  encryptAndSave: (fileId, data, password) => ipcRenderer.invoke('encrypt-and-save', fileId, data, password),
  decryptNpnpFile: (fileId, password) => ipcRenderer.invoke('decrypt-npnp-file', fileId, password),
  showViewsb3SaveFilePicker: (suggestedName) => ipcRenderer.invoke('show-viewsb3-save-file-picker', suggestedName),
  encryptAndSaveViewsb3: (fileId, data) => ipcRenderer.invoke('encrypt-and-save-viewsb3', fileId, data),
  openDesktopSettings: () => ipcRenderer.invoke('open-desktop-settings'),
  openPrivacy: () => ipcRenderer.invoke('open-privacy'),
  openAbout: () => ipcRenderer.invoke('open-about'),
  openContact: () => ipcRenderer.invoke('open-contact'),
  getPreferredMediaDevices: () => ipcRenderer.invoke('get-preferred-media-devices'),
  getAdvancedCustomizations: () => ipcRenderer.invoke('get-advanced-customizations'),
  setExportForPackager: (callback) => {
    exportForPackager = callback;
  },
  setIsFullScreen: (isFullScreen) => ipcRenderer.invoke('set-is-full-screen', isFullScreen),
  getSystemStats: () => ipcRenderer.invoke('get-system-stats'),
  getAISystemInfo: () => ipcRenderer.invoke('get-ai-system-info'),
  detachStage: () => ipcRenderer.invoke('detach-stage'),
  reattachStage: () => ipcRenderer.invoke('reattach-stage'),
  sendStageFrame: (dataURL) => ipcRenderer.send('stage-frame', dataURL),
  onStageDetached: (callback) => {
    stageDetachedCallback = callback;
  },
  onStageReattached: (callback) => {
    stageReattachedCallback = callback;
  },
  onDetachedStageInput: (callback) => {
    detachedStageInputCallback = callback;
  },
  getCodeAreaBackgroundImage: () => ipcRenderer.sendSync('get-code-area-background-image'),
  setCodeAreaBackgroundImage: (imageData) => ipcRenderer.invoke('set-code-area-background-image', imageData),
  getStageAreaBackgroundImage: () => ipcRenderer.sendSync('get-stage-area-background-image'),
  setStageAreaBackgroundImage: (imageData) => ipcRenderer.invoke('set-stage-area-background-image', imageData),
  getTopBarDeviceStats: () => ipcRenderer.sendSync('get-top-bar-device-stats'),
  getNeowarpExpands: () => ipcRenderer.invoke('get-neowarp-expands'),
  openAI: () => ipcRenderer.invoke('open-ai-assistant'),
  openTodoList: () => ipcRenderer.invoke('open-todo-list'),
  openProjectAnalysis: () => ipcRenderer.invoke('open-project-analysis'),
  openTaskManager: () => ipcRenderer.invoke('open-task-manager'),
  openMobilePreview: () => ipcRenderer.invoke('open-mobile-preview'),
  onRequestProjectJSON: (callback) => {
    ipcRenderer.on('request-project-json', (event, data) => {
      callback(data);
    });
  },
  sendProjectJSON: (data) => {
    ipcRenderer.send('project-json-response', data);
  },
  onApplyProject: (callback) => {
    ipcRenderer.on('apply-project', (event, data) => {
      callback(data);
    });
  },
  onApplySprite: (callback) => {
    ipcRenderer.on('apply-sprite', (event, data) => {
      callback(data);
    });
  },
  onRequestSpriteLibrary: (callback) => {
    ipcRenderer.on('request-sprite-library', () => {
      callback();
    });
  },
  sendSpriteLibrary: (data) => {
    ipcRenderer.send('sprite-library-response', data);
  },
  fetchImage: (url) => ipcRenderer.invoke('fetch-image', url),
  onAIToolCall: (callback) => {
    ipcRenderer.on('ai-tool-call', (event, data) => {
      callback(data);
    });
  },
  sendAIToolResponse: (data) => {
    ipcRenderer.send('ai-tool-response', data);
  },
  // 扩展编辑器「添加到项目」：主进程转来的扩展代码，由当前项目的 VM 加载
  onAddExtension: (callback) => {
    ipcRenderer.on('extension-add-to-project', (event, data) => {
      callback(data);
    });
  },
  sendAddExtensionResult: (data) => {
    ipcRenderer.send('extension-add-to-project-result', data);
  },
  // 扩展库「我的扩展」右键「编辑」：解码扩展代码并送入扩展编辑器
  openExtensionInEditor: (payload) => ipcRenderer.invoke('open-extension-in-editor', payload),
  // 扩展编辑器「添加到/更新我的扩展」：写入本渲染层的 localStorage 我的扩展列表
  onMyExtensionsUpsert: (callback) => {
    ipcRenderer.on('my-extensions-upsert', (event, data) => {
      callback(data);
    });
  },
  sendMyExtensionsUpsertResult: (data) => {
    ipcRenderer.send('my-extensions-upsert-result', data);
  },
  // SOLO：后台编辑器请求导出整个工程（保存回 sb3 文件）
  onSoloExportProject: (callback) => {
    ipcRenderer.on('solo-export-project', (event, data) => {
      callback(data);
    });
  },
  sendSoloExportProject: (data) => {
    ipcRenderer.send('solo-export-project-response', data);
  },
  // SOLO：主进程指令开始/停止把舞台画面转发给 SOLO 窗口
  onSoloStageStream: (callback) => {
    ipcRenderer.on('solo-stage-stream', (event, data) => {
      callback(data);
    });
  },
  sendSoloStageFrame: (dataURL) => {
    ipcRenderer.send('solo-stage-frame', dataURL);
  },
  // SOLO：随帧推送的舞台 DOM 覆盖层状态（变量监视器 + 提问框）——
  // 它们是 scratch-gui 的 DOM 元素，不在 canvas 快照里，必须单独转发
  sendSoloStageOverlays: (data) => {
    ipcRenderer.send('solo-stage-overlays', data);
  },
  // SOLO：舞台窗口里用户提交的"回答"，转发给 VM 结束 ask and wait
  onSoloStageAnswer: (callback) => {
    ipcRenderer.on('solo-stage-answer', (event, data) => {
      callback(data);
    });
  },
  // SOLO：舞台窗口的绿旗/暂停/继续/停止按钮 → 后台 VM
  onSoloStageControl: (callback) => {
    ipcRenderer.on('solo-stage-control', (event, data) => {
      callback(data);
    });
  },
  sendSoloStageControl: (data) => {
    ipcRenderer.send('solo-stage-control-response', data);
  },
  // SOLO：VM 运行状态变化 → 主进程（按钮亮灭跟随）
  sendSoloStageRunStatus: (data) => {
    ipcRenderer.send('solo-stage-run-status', data);
  },
  onRequestTheme: (callback) => {
    ipcRenderer.on('request-theme', (event, data) => {
      callback(data);
    });
  },
  sendTheme: (data) => {
    ipcRenderer.send('theme-response', data);
  },
  notifyThemeChanged: (theme) => {
    ipcRenderer.send('theme-changed', { theme });
  },
  // 全局 UI 主题（桌面设置里配置）：挂载时读取一次 + 变更推送
  getGlobalUITheme: () => ipcRenderer.invoke('editor-get-global-ui-theme'),
  onGlobalUIThemeChanged: (callback) => {
    ipcRenderer.on('global-ui-theme-changed', (event, mode) => {
      callback(mode);
    });
  },
  onRequestSpriteStats: (callback) => {
    ipcRenderer.on('request-sprite-stats', (event, data) => {
      callback(data);
    });
  },
  sendSpriteStats: (data) => {
    ipcRenderer.send('sprite-stats-response', data);
  },
  removeAllAIListeners: () => {
    ipcRenderer.removeAllListeners('request-project-json');
    ipcRenderer.removeAllListeners('apply-project');
    ipcRenderer.removeAllListeners('apply-sprite');
    ipcRenderer.removeAllListeners('ai-tool-call');
    ipcRenderer.removeAllListeners('request-theme');
  },
  openCollaborationHost: () => ipcRenderer.invoke('open-collaboration-host'),
  openCollaborationJoin: () => ipcRenderer.invoke('open-collaboration-join'),
  endCollaboration: () => ipcRenderer.invoke('end-collaboration'),
  leaveCollaboration: () => ipcRenderer.invoke('leave-collaboration'),
  openCollaborationChat: () => ipcRenderer.invoke('open-collaboration-chat'),
  onCollaborationStateChange: (callback) => {
    ipcRenderer.on('collaboration-state-changed', (event, data) => callback(data));
  },
  onCollabRequestProjectJSON: (callback) => {
    ipcRenderer.on('collab-request-project-json', (event, data) => callback(data));
  },
  sendCollabProjectJSON: (project, targetUsername) => {
    ipcRenderer.send('collab-send-project-json', { project, targetUsername });
  },
  onCollabProjectUpdate: (callback) => {
    ipcRenderer.on('collab-project-update', (event, data) => callback(data));
  },
  sendCollabProjectUpdate: (project) => {
    ipcRenderer.send('collab-send-project-update', { project });
  }
});

let exportForPackager = () => Promise.reject(new Error('exportForPackager missing'));
let stageDetachedCallback = null;
let stageReattachedCallback = null;
let detachedStageInputCallback = null;

ipcRenderer.on('stage-detached', () => {
  if (stageDetachedCallback) stageDetachedCallback();
});

ipcRenderer.on('stage-reattached', () => {
  if (stageReattachedCallback) stageReattachedCallback();
});

ipcRenderer.on('detached-stage-input', (event, inputData) => {
  if (detachedStageInputCallback) detachedStageInputCallback(inputData);
});

ipcRenderer.on('export-project-to-port', (e) => {
  const port = e.ports[0];
  exportForPackager()
    .then(({data, name}) => {
      port.postMessage({ data, name });
    })
    .catch((error) => {
      console.error(error);
      port.postMessage({ error: true });
    });
});

window.addEventListener('message', (e) => {
  if (e.source === window) {
    const data = e.data;
    if (data && typeof data.ipcStartWriteStream === 'string') {
      ipcRenderer.postMessage('start-write-stream', data.ipcStartWriteStream, e.ports);
    }
  }
});

ipcRenderer.on('enumerate-media-devices', (e) => {
  navigator.mediaDevices.enumerateDevices()
    .then((devices) => {
      e.sender.send('enumerated-media-devices', {
        devices: devices.map((device) => ({
          deviceId: device.deviceId,
          kind: device.kind,
          label: device.label
        }))
      });
    })
    .catch((error) => {
      console.error(error);
      e.sender.send('enumerated-media-devices', {
        error: `${error}`
      });
    });
});

contextBridge.exposeInMainWorld('PromptsPreload', {
  alert: (message) => ipcRenderer.sendSync('alert', message),
  confirm: (message) => ipcRenderer.sendSync('confirm', message),
});

// In some Linux environments, people may try to drag & drop files that we don't have access to.
// Remove when https://github.com/electron/electron/issues/30650 is fixed.
if (navigator.userAgent.includes('Linux')) {
  document.addEventListener('drop', (e) => {
    if (e.isTrusted) {
      for (const file of e.dataTransfer.files) {
        // Using webUtils is safe as we don't have a legacy build for Linux
        const {webUtils} = require('electron');
        const path = webUtils.getPathForFile(file);
        ipcRenderer.invoke('check-drag-and-drop-path', path);
      }
    }
  }, {
    capture: true
  });
}

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
  openAI: () => ipcRenderer.invoke('open-ai-assistant'),
  openTodoList: () => ipcRenderer.invoke('open-todo-list'),
  openProjectAnalysis: () => ipcRenderer.invoke('open-project-analysis'),
  openTaskManager: () => ipcRenderer.invoke('open-task-manager'),
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
  checkCollaborationPermission: (action) => ipcRenderer.invoke('check-collaboration-permission', action),
  onCollaborationStateChange: (callback) => {
    ipcRenderer.on('collaboration-state-changed', (event, data) => callback(data));
  },
  onCollaborationChatMessage: (callback) => {
    ipcRenderer.on('collaboration-chat-message', (event, data) => callback(data));
  },
  onCollaborationEnded: (callback) => {
    ipcRenderer.on('collaboration-ended', (event, data) => callback(data));
  },
  removeAllCollaborationListeners: () => {
    ipcRenderer.removeAllListeners('collaboration-state-changed');
    ipcRenderer.removeAllListeners('collaboration-chat-message');
    ipcRenderer.removeAllListeners('collaboration-ended');
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

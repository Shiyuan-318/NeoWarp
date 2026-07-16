/**
 * NeoWarp 网页版 EditorPreload 浏览器兼容层
 * 用浏览器原生 API 替代 Electron 主进程的功能
 * 桌面专属功能（AI助手窗口/协作/分离舞台等）改为空实现或浏览器版本
 */
(function () {
  'use strict';

  // ============ 内部状态 ============
  let fileIdCounter = 0;
  // file id -> File 对象 的映射（用于打开的文件）
  const fileStore = new Map();
  // file id -> FileSystemFileHandle 的映射（用于保存的文件）
  const handleStore = new Map();
  // file id -> 可写流
  const writableStore = new Map();
  // 监听 write stream 消息（兼容 WrappedFileWritable 的 postMessage 协议）
  window.addEventListener('message', (e) => {
    if (e.source === window) {
      const data = e.data;
      if (data && typeof data.ipcStartWriteStream === 'string') {
        const id = data.ipcStartWriteStream;
        const port = e.ports[0];
        const stream = writableStore.get(id);
        if (!stream) {
          port.postMessage({ error: 'No writable stream' });
          port.close();
          return;
        }
        port.onmessage = async (event) => {
          const msg = event.data;
          try {
            if (msg.write) {
              await stream.write(msg.write);
              port.postMessage({ response: { id: msg.id, result: true } });
            } else if (msg.finish) {
              await stream.close();
              writableStore.delete(id);
              port.postMessage({ response: { id: msg.id, result: true } });
              port.close();
            } else if (msg.abort) {
              await stream.abort();
              writableStore.delete(id);
              port.postMessage({ response: { id: msg.id, result: true } });
              port.close();
            }
          } catch (err) {
            port.postMessage({ response: { id: msg.id, result: { error: String(err) } } });
          }
        };
      }
    }
  });

  // ============ 文件操作（用浏览器原生 File System Access API）============
  const FILE_OPEN_ACCEPTS = [
    { description: '项目文件', accept: { 'application/json': ['.sb3', '.np1', '.npnp', '.viewsb3', '.sb2', '.sb'] } },
    { description: '所有文件', accept: { '*/*': ['*'] } }
  ];

  const showOpenFilePicker = async () => {
    if (!window.showOpenFilePicker) {
      // 不支持 File System Access API 的浏览器，用 input[type=file] 兜底
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.sb3,.np1,.npnp,.viewsb3,.sb2,.sb';
        input.onchange = () => {
          if (!input.files.length) return resolve(null);
          const file = input.files[0];
          const id = `file-${++fileIdCounter}`;
          fileStore.set(id, file);
          resolve({ id, name: file.name });
        };
        input.click();
      });
    }
    try {
      const [handle] = await window.showOpenFilePicker({ types: FILE_OPEN_ACCEPTS, multiple: false });
      const file = await handle.getFile();
      const id = `file-${++fileIdCounter}`;
      fileStore.set(id, file);
      handleStore.set(id, handle);
      return { id, name: file.name };
    } catch (e) {
      return null;
    }
  };

  const showSaveFilePicker = async (suggestedName) => {
    if (!window.showSaveFilePicker) {
      // 兜底：用 a 标签下载
      return new Promise((resolve) => {
        const id = `save-${++fileIdCounter}`;
        // 创建一个占位 handle，真正写入时用下载
        handleStore.set(id, { _downloadMode: true, _name: suggestedName });
        resolve({ id, name: suggestedName });
      });
    }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: '项目文件', accept: { 'application/json': ['.sb3'] } }]
      });
      const id = `save-${++fileIdCounter}`;
      handleStore.set(id, handle);
      return { id, name: handle.name || suggestedName };
    } catch (e) {
      return null;
    }
  };

  const getFile = async (id) => {
    const file = fileStore.get(id);
    if (!file) throw new Error('文件未找到');
    const data = await file.arrayBuffer();
    return { data: new Uint8Array(data), isEncrypted: false, isViewOnly: false };
  };

  const startWriteStream = (id) => {
    // 在 handleStore 里找到 FileSystemFileHandle，创建可写流
    const handle = handleStore.get(id);
    if (!handle) return;

    if (handle._downloadMode) {
      // 不支持 FS API 时的下载兜底：把数据缓存下来
      let chunks = [];
      writableStore.set(id, {
        write: (data) => { chunks.push(new Uint8Array(data)); },
        close: () => {
          const blob = new Blob(chunks, { type: 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = handle._name || 'project.sb3';
          a.click();
          URL.revokeObjectURL(url);
        },
        abort: () => { chunks = []; }
      });
    } else {
      handle.createWritable().then((stream) => {
        writableStore.set(id, stream);
      }).catch((err) => {
        console.error('创建可写流失败:', err);
      });
    }
  };

  // 兼容 WrappedFileWritable 的 postMessage 协议（index.js 构建产物会用这个）
  // 已经在上面 message 监听器里处理了 ipcStartWriteStream

  // ============ 回调存储 ============
  const callbacks = {
    stageDetached: null,
    stageReattached: null,
    detachedStageInput: null,
    requestProjectJSON: [],
    applyProject: [],
    applySprite: [],
    aiToolCall: [],
    requestTheme: [],
    collaborationStateChange: [],
    collaborationChatMessage: [],
    collaborationEnded: [],
    collabRequestProjectJSON: [],
    collabProjectUpdate: []
  };

  // ============ EditorPreload 浏览器版实现 ============
  window.EditorPreload = {
    // 基础
    isInitiallyFullscreen: () => false,
    getInitialFile: () => Promise.resolve(null),

    // 文件操作
    getFile,
    openedFile: (id) => { /* 网页版无需跟踪 */ },
    closedFile: () => { /* 网页版无需跟踪 */ },
    showOpenFilePicker,
    showSaveFilePicker,
    showEncryptedSaveFilePicker: showSaveFilePicker,
    showViewsb3SaveFilePicker: showSaveFilePicker,

    // 加密保存（网页版暂不支持，给空实现）
    encryptAndSave: async () => { throw new Error('网页版暂不支持加密保存'); },
    decryptNpnpFile: async () => { throw new Error('网页版暂不支持加密文件'); },
    encryptAndSaveViewsb3: async () => { throw new Error('网页版暂不支持 viewb3 保存'); },

    // 语言（网页版返回空 strings，scratch-gui 会用默认）
    setLocale: (locale) => ({ strings: {} }),

    // 窗口状态
    setChanged: (changed) => { /* 网页版用浏览器 title 提示 */ },
    setIsFullScreen: (isFullScreen) => {
      if (isFullScreen && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else if (!isFullScreen && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    },

    // 打开子窗口（网页版改为跳转或提示）
    openNewWindow: () => window.open(location.href, '_blank'),
    openAddonSettings: () => { window.open('addons.html', '_blank'); },
    openPackager: () => { window.open('https://packager.turbowarp.org', '_blank'); },
    openDesktopSettings: () => alert('网页版暂不支持桌面设置'),
    openPrivacy: () => alert('网页版暂不支持隐私设置页面'),
    openAbout: () => alert('NeoWarp 网页版\n基于 TurboWarp 二次开发'),
    openContact: () => { window.open('https://github.com/Shiyuan-318/NeoWarp', '_blank'); },

    // 媒体设备
    getPreferredMediaDevices: async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return {
          audioInputId: devices.find(d => d.kind === 'audioinput')?.deviceId || '',
          videoInputId: devices.find(d => d.kind === 'videoinput')?.deviceId || ''
        };
      } catch (e) {
        return { audioInputId: '', videoInputId: '' };
      }
    },

    // 用户自定义脚本/样式（网页版用 localStorage）
    getAdvancedCustomizations: async () => {
      try {
        const userscript = localStorage.getItem('neowarp:userscript') || '';
        const userstyle = localStorage.getItem('neowarp:userstyle') || '';
        return { userscript, userstyle };
      } catch (e) {
        return { userscript: '', userstyle: '' };
      }
    },

    // 导出给打包器
    setExportForPackager: (callback) => {
      window._neowarpExportForPackager = callback;
    },

    // 系统状态（浏览器拿不到真实 CPU/内存，返回空）
    getSystemStats: async () => ({ cpuUsage: 0, memory: { used: 0, total: 0 } }),
    getTopBarDeviceStats: () => false,

    // 分离舞台（网页版不支持，给空实现避免报错）
    detachStage: () => { console.warn('网页版不支持分离舞台'); },
    reattachStage: () => {},
    sendStageFrame: () => {},
    onStageDetached: (cb) => { callbacks.stageDetached = cb; },
    onStageReattached: (cb) => { callbacks.stageReattached = cb; },
    onDetachedStageInput: (cb) => { callbacks.detachedStageInput = cb; },

    // 背景图（网页版用 localStorage 存 base64）
    getCodeAreaBackgroundImage: () => {
      try { return localStorage.getItem('neowarp:codeBg'); } catch (e) { return null; }
    },
    setCodeAreaBackgroundImage: async (imageData) => {
      try {
        if (imageData) localStorage.setItem('neowarp:codeBg', imageData);
        else localStorage.removeItem('neowarp:codeBg');
      } catch (e) {}
    },
    getStageAreaBackgroundImage: () => {
      try { return localStorage.getItem('neowarp:stageBg'); } catch (e) { return null; }
    },
    setStageAreaBackgroundImage: async (imageData) => {
      try {
        if (imageData) localStorage.setItem('neowarp:stageBg', imageData);
        else localStorage.removeItem('neowarp:stageBg');
      } catch (e) {}
    },

    // AI 助手（网页版暂不支持，给空实现）
    openAI: () => alert('网页版暂不支持 AI 助手，请使用桌面版'),
    openTodoList: () => alert('网页版暂不支持待办清单，请使用桌面版'),
    openProjectAnalysis: () => alert('网页版暂不支持项目分析，请使用桌面版'),
    openTaskManager: () => {},

    // AI 相关回调（空实现）
    onRequestProjectJSON: (cb) => { callbacks.requestProjectJSON.push(cb); },
    sendProjectJSON: () => {},
    onApplyProject: (cb) => { callbacks.applyProject.push(cb); },
    onApplySprite: (cb) => { callbacks.applySprite.push(cb); },
    onRequestSpriteLibrary: (cb) => {},
    sendSpriteLibrary: () => {},
    fetchImage: async (url) => {
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        return new Uint8Array(await blob.arrayBuffer());
      } catch (e) {
        throw new Error('无法获取图片: ' + e.message);
      }
    },
    onAIToolCall: (cb) => { callbacks.aiToolCall.push(cb); },
    sendAIToolResponse: () => {},
    onRequestTheme: (cb) => { callbacks.requestTheme.push(cb); },
    sendTheme: () => {},
    notifyThemeChanged: () => {},
    onRequestSpriteStats: (cb) => {},
    sendSpriteStats: () => {},
    removeAllAIListeners: () => {
      callbacks.requestProjectJSON.length = 0;
      callbacks.applyProject.length = 0;
      callbacks.applySprite.length = 0;
      callbacks.aiToolCall.length = 0;
      callbacks.requestTheme.length = 0;
    },

    // 协作（网页版暂不支持）
    openCollaborationHost: () => alert('网页版暂不支持协作功能'),
    openCollaborationJoin: () => alert('网页版暂不支持协作功能'),
    endCollaboration: () => {},
    leaveCollaboration: () => {},
    openCollaborationChat: () => {},
    checkCollaborationPermission: async () => false,
    onCollaborationStateChange: (cb) => { callbacks.collaborationStateChange.push(cb); },
    onCollaborationChatMessage: (cb) => { callbacks.collaborationChatMessage.push(cb); },
    onCollaborationEnded: (cb) => { callbacks.collaborationEnded.push(cb); },
    onCollabRequestProjectJSON: (cb) => { callbacks.collabRequestProjectJSON.push(cb); },
    sendCollabProjectJSON: () => {},
    onCollabProjectUpdate: (cb) => { callbacks.collabProjectUpdate.push(cb); },
    sendCollabProjectUpdate: () => {},
    removeAllCollaborationListeners: () => {
      callbacks.collaborationStateChange.length = 0;
      callbacks.collaborationChatMessage.length = 0;
      callbacks.collaborationEnded.length = 0;
      callbacks.collabRequestProjectJSON.length = 0;
      callbacks.collabProjectUpdate.length = 0;
    }
  };

  // ============ PromptsPreload 浏览器版 ============
  window.PromptsPreload = {
    alert: (message) => { alert(message); return true; },
    confirm: (message) => confirm(message)
  };

  // ============ AddonsPreload 浏览器版 ============
  window.AddonsPreload = {
    exportSettings: (settings) => {
      // 网页版：导出设置成文件下载
      const blob = new Blob([settings], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'neowarp-addon-settings.json';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  console.log('[NeoWarp] 网页版 EditorPreload 已加载');
})();

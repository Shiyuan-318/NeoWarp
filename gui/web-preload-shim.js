/**
 * NeoWarp 网页版 EditorPreload 浏览器兼容层
 * 用浏览器原生 API 替代 Electron 主进程的功能
 * 桌面专属功能（AI助手窗口/协作/分离舞台等）改为空实现或浏览器版本
 */
(function () {
  'use strict';

  // ============ 原生对话框（prompt.js 会把 window.alert/confirm 改写为
  // PromptsPreload.alert/confirm，这里先保存原生实现，避免互相调用造成无限递归）
  var nativeAlert = typeof window.alert === 'function' ? window.alert.bind(window) : function () {};
  var nativeConfirm = typeof window.confirm === 'function' ? window.confirm.bind(window) : function () { return false; };

  // ============ 轻量提示条（不依赖编辑器内部实现）============
  var toastEl = null;
  var toastTimer = null;
  function showWebToast (message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'neowarp-web-toast';
      toastEl.style.cssText =
        'position:fixed;left:50%;bottom:32px;transform:translateX(-50%) translateY(8px);' +
        'z-index:2147483647;padding:10px 18px;border-radius:10px;max-width:70vw;' +
        'background:rgba(20,20,24,0.9);color:#fff;font-size:13px;line-height:1.5;' +
        'box-shadow:0 8px 28px rgba(0,0,0,0.35);opacity:0;transition:opacity .2s,transform .2s;' +
        'pointer-events:none;text-align:center;';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.style.opacity = '1';
    toastEl.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (toastEl) {
        toastEl.style.opacity = '0';
        toastEl.style.transform = 'translateX(-50%) translateY(8px)';
      }
    }, 2800);
  }

  // ============ 环境补丁：确保 navigator.mediaDevices 存在 ============
  // 渲染层在模块初始化时会直接执行 navigator.mediaDevices.getUserMedia.bind(...)，
  // 在非安全上下文（http://）或部分浏览器中 navigator.mediaDevices 为 undefined，
  // 会抛出 TypeError 导致整个 bundle 初始化中断，这里补一个最小实现兜底。
  if (!navigator.mediaDevices) {
    try {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: () => Promise.reject(new Error('当前环境不支持媒体设备（需要 HTTPS 安全上下文）')),
          enumerateDevices: () => Promise.resolve([]),
          getSupportedConstraints: () => ({}),
          addEventListener: () => {},
          removeEventListener: () => {}
        }
      });
    } catch (e) {
      // 忽略：无法定义时保持原状
    }
  }

  // ============ 内部状态 ============
  let fileIdCounter = 0;
  // file id -> File 对象 的映射（用于打开的文件）
  const fileStore = new Map();
  // file id -> FileSystemFileHandle 的映射（用于保存的文件）
  const handleStore = new Map();
  // file id -> 可写流
  const writableStore = new Map();
  // 主页「从文件中打开」预先存放的文件（IndexedDB 跨页面传递）
  const pendingFileStore = new Map();
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

  // ============ IndexedDB：主页选中的文件跨页面传递 ============
  const PENDING_DB = 'neowarp-web';
  const PENDING_STORE = 'pending-files';

  function openPendingDB () {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(PENDING_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PENDING_STORE)) {
          db.createObjectStore(PENDING_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // 取出并删除主页暂存的项目文件
  function takePendingFile () {
    return openPendingDB().then((db) => new Promise((resolve) => {
      let value = null;
      const tx = db.transaction(PENDING_STORE, 'readwrite');
      const store = tx.objectStore(PENDING_STORE);
      const getReq = store.get('pending');
      getReq.onsuccess = () => {
        value = getReq.result || null;
        store.delete('pending');
      };
      tx.oncomplete = () => {
        db.close();
        resolve(value);
      };
      tx.onerror = () => {
        db.close();
        resolve(null);
      };
      tx.onabort = () => {
        db.close();
        resolve(null);
      };
    }));
  }

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
    if (pendingFileStore.has(id)) {
      const pending = pendingFileStore.get(id);
      pendingFileStore.delete(id);
      return {
        data: new Uint8Array(pending.buffer),
        name: pending.name,
        type: 'file',
        isEncrypted: false,
        isViewOnly: false
      };
    }
    const file = fileStore.get(id);
    if (!file) throw new Error('文件未找到');
    const data = await file.arrayBuffer();
    return { data: new Uint8Array(data), name: file.name, type: 'file', isEncrypted: false, isViewOnly: false };
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
    spriteStats: [],
    requestTheme: [],
    collaborationStateChange: [],
    collaborationChatMessage: [],
    collaborationEnded: [],
    collabRequestProjectJSON: [],
    collabProjectUpdate: []
  };

  // ============ 系统占用（浏览器可获取的近似值）============
  // 浏览器没有系统级 CPU 接口，这里用主线程事件循环的阻塞比例做近似估计：
  // 低负载时 setTimeout 基本准时，负载越高实际耗时相对预期越久。
  let cpuEstimate = 0;
  (function sampleCpu () {
    const INTERVAL = 250;
    const startedAt = performance.now();
    setTimeout(() => {
      if (!document.hidden) {
        const actual = performance.now() - startedAt;
        let busy = (actual - INTERVAL) / INTERVAL;
        if (!isFinite(busy) || busy < 0) busy = 0;
        if (busy > 1) busy = 1;
        cpuEstimate = cpuEstimate * 0.6 + busy * 100 * 0.4;
      }
      sampleCpu();
    }, INTERVAL);
  })();

  // ============ AI 助手窗口桥接 ============
  // 编辑器窗口打开 AI 助手（同源新窗口），两边用 postMessage 通信，
  // AI 窗口通过 AIAssistantPreload 请求工程内容 / 工具调用 / 应用改动。
  let aiWindow = null;
  const aiPending = new Map();

  function postToSource (source, message) {
    if (!source) return;
    try {
      source.postMessage(Object.assign({ __neowarpAIResponse: true }, message), location.origin);
    } catch (e) {
      // 窗口已关闭等情况忽略
    }
  }

  function respondAI (source, requestId, result) {
    postToSource(source, { requestId, ok: true, result });
  }

  function handleAIRequest (event, msg) {
    const source = event.source;
    const requestId = msg.id;
    const args = msg.args || [];
    switch (msg.method) {
      case 'getProjectCode': {
        if (!callbacks.requestProjectJSON.length) {
          respondAI(source, requestId, null);
          return;
        }
        aiPending.set(requestId, { source, kind: 'projectJSON' });
        callbacks.requestProjectJSON.forEach((cb) => {
          try { cb({ requestId }); } catch (e) { aiPending.delete(requestId); respondAI(source, requestId, null); }
        });
        break;
      }
      case 'applyProject': {
        callbacks.applyProject.forEach((cb) => {
          try { cb({ projectJSON: args[0] }); } catch (e) { /* ignore */ }
        });
        respondAI(source, requestId, { success: true });
        break;
      }
      case 'applySprite': {
        callbacks.applySprite.forEach((cb) => {
          try { cb({ spriteJSON: args[0], targetId: args[1] }); } catch (e) { /* ignore */ }
        });
        respondAI(source, requestId, { success: true });
        break;
      }
      case 'callTool': {
        if (!callbacks.aiToolCall.length) {
          respondAI(source, requestId, { success: false, error: '编辑器尚未就绪' });
          return;
        }
        aiPending.set(requestId, { source, kind: 'toolResponse' });
        callbacks.aiToolCall.forEach((cb) => {
          try { cb({ requestId, toolName: args[0], params: args[1] }); } catch (e) {
            aiPending.delete(requestId);
            respondAI(source, requestId, { success: false, error: e.message });
          }
        });
        break;
      }
      case 'getSpriteStats': {
        if (!callbacks.spriteStats.length) {
          respondAI(source, requestId, { sprites: [], totalThreads: 0 });
          return;
        }
        aiPending.set(requestId, { source, kind: 'spriteStats' });
        callbacks.spriteStats.forEach((cb) => {
          try { cb({ requestId }); } catch (e) { aiPending.delete(requestId); respondAI(source, requestId, null); }
        });
        break;
      }
      case 'getTheme': {
        // 与编辑器同源，直接读编辑器的主题设置
        let theme = '';
        try {
          const setting = localStorage.getItem('tw:theme');
          if (setting === 'light' || setting === 'dark') {
            theme = setting;
          } else if (setting) {
            const parsed = JSON.parse(setting);
            if (parsed && (parsed.gui === 'dark' || parsed.gui === 'light')) theme = parsed.gui;
          }
        } catch (e) { /* ignore */ }
        if (!theme) {
          theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        respondAI(source, requestId, theme);
        break;
      }
      default:
        respondAI(source, requestId, null);
    }
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.__neowarpAI !== true) return;
    if (event.origin !== location.origin) return;
    handleAIRequest(event, data);
  });

  // ============ EditorPreload 浏览器版实现 ============
  window.EditorPreload = {
    // 基础
    isInitiallyFullscreen: () => false,
    getInitialFile: () => takePendingFile().then((pending) => {
      if (!pending || !pending.buffer) return null;
      const id = `pending-${++fileIdCounter}`;
      pendingFileStore.set(id, pending);
      return id;
    }).catch(() => null),

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
    openAddonSettings: () => { window.open('../addons/addons.html', '_blank'); },
    openPackager: () => { window.open('https://packager.turbowarp.org', '_blank'); },
    openDesktopSettings: () => showWebToast('网页版暂不支持桌面设置，可使用附加组件设置页面'),
    openPrivacy: () => showWebToast('网页版暂不支持隐私设置页面'),
    openAbout: () => showWebToast('NeoWarp 网页版\n基于 TurboWarp 二次开发'),
    openContact: () => { window.open('https://github.com/Shiyuan-318/NeoWarp', '_blank'); },

    // 媒体设备
    getPreferredMediaDevices: async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const microphone = (devices.find(d => d.kind === 'audioinput') || {}).deviceId || null;
        const camera = (devices.find(d => d.kind === 'videoinput') || {}).deviceId || null;
        return { microphone, camera, audioInputId: microphone || '', videoInputId: camera || '' };
      } catch (e) {
        return { microphone: null, camera: null, audioInputId: '', videoInputId: '' };
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

    // 系统状态：菜单栏需要 cpuPercent / ramUsedMB，
    // 顶部悬浮统计需要 usedMemory / totalMemory，这里一并给出
    getSystemStats: async () => {
      let usedMemory = 0;
      let totalMemory = 0;
      const perfMemory = (typeof performance !== 'undefined') && performance.memory;
      if (perfMemory) {
        usedMemory = perfMemory.usedJSHeapSize || 0;
        totalMemory = perfMemory.jsHeapSizeLimit || 0;
      } else if (navigator.deviceMemory) {
        // 浏览器不提供精确的已用内存，退化为设备内存上限
        totalMemory = navigator.deviceMemory * 1024 * 1024 * 1024;
      }
      const ramUsedMB = Math.max(0, Math.round(usedMemory / 1024 / 1024));
      const cpuPercent = Math.round(cpuEstimate * 10) / 10;
      return {
        cpuPercent,
        ramUsedMB,
        usedMemory,
        totalMemory,
        // 兼容旧字段命名
        cpuUsage: cpuPercent,
        memory: { used: usedMemory, total: totalMemory }
      };
    },
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

    // AI 助手：网页版打开同源的 AI 助手窗口，通过 postMessage 与编辑器通信
    openAI: () => {
      const url = new URL('../ai/ai-assistant.html', location.href).href;
      const width = 480;
      const height = 820;
      const left = Math.max(0, (window.screenX || 0) + (window.outerWidth || width) - width - 24);
      const top = Math.max(0, (window.screenY || 0) + 60);
      const features = `width=${width},height=${height},left=${left},top=${top},` +
        'menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes';
      aiWindow = window.open(url, 'neowarp-ai-assistant', features);
      if (!aiWindow || aiWindow.closed) {
        showWebToast('浏览器拦截了 AI 助手窗口，请允许本站弹出窗口后重试');
        return false;
      }
      try { aiWindow.focus(); } catch (e) {}
      return true;
    },
    openTodoList: () => showWebToast('网页版暂不支持待办清单，请使用桌面版'),
    openProjectAnalysis: () => showWebToast('网页版暂不支持项目分析，请使用桌面版'),
    openTaskManager: () => showWebToast('网页版暂不支持任务管理器，请使用桌面版'),
    openMobilePreview: () => showWebToast('网页版暂不支持手机预览，请使用桌面版'),

    // AI 相关回调（网页版由 AI 助手窗口通过 postMessage 触发）
    onRequestProjectJSON: (cb) => { callbacks.requestProjectJSON.push(cb); },
    sendProjectJSON: (data) => {
      if (!data) return;
      const pending = aiPending.get(data.requestId);
      if (!pending) return;
      aiPending.delete(data.requestId);
      postToSource(pending.source, {
        requestId: data.requestId,
        result: { projectJSON: data.projectJSON || null, assetSize: data.assetSize || 0 }
      });
    },
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
    sendAIToolResponse: (data) => {
      if (!data) return;
      const pending = aiPending.get(data.requestId);
      if (!pending) return;
      aiPending.delete(data.requestId);
      postToSource(pending.source, { requestId: data.requestId, result: data.result });
    },
    onRequestTheme: (cb) => { callbacks.requestTheme.push(cb); },
    sendTheme: () => {},
    notifyThemeChanged: () => {},
    onRequestSpriteStats: (cb) => { callbacks.spriteStats.push(cb); },
    sendSpriteStats: (data) => {
      if (!data) return;
      const pending = aiPending.get(data.requestId);
      if (!pending) return;
      aiPending.delete(data.requestId);
      postToSource(pending.source, { requestId: data.requestId, result: data });
    },
    removeAllAIListeners: () => {
      callbacks.requestProjectJSON.length = 0;
      callbacks.applyProject.length = 0;
      callbacks.applySprite.length = 0;
      callbacks.aiToolCall.length = 0;
      callbacks.spriteStats.length = 0;
      callbacks.requestTheme.length = 0;
    },

    // 协作（网页版暂不支持）
    openCollaborationHost: () => showWebToast('网页版暂不支持协作功能'),
    openCollaborationJoin: () => showWebToast('网页版暂不支持协作功能'),
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
  // 必须调用原生 alert/confirm：prompt.js 已把 window.alert 指向本对象，
  // 直接调用 window.alert 会造成无限递归（栈溢出）
  window.PromptsPreload = {
    alert: (message) => { nativeAlert(message); return true; },
    confirm: (message) => nativeConfirm(message)
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

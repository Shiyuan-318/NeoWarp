/**
 * NeoWarp 网页版主页 HomePreload 浏览器兼容层
 * 用浏览器原生能力替代 Electron 主进程：最近项目、文件选择、窗口跳转等
 */
(function () {
  'use strict';

  var EDITOR_URL = 'gui/gui.html';

  // ============ 轻量提示条（优先复用主页自带的 #toast）============
  function toast (message) {
    if (typeof window.showToast === 'function') {
      window.showToast(message);
      return;
    }
    var el = document.createElement('div');
    el.style.cssText =
      'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:2147483647;' +
      'padding:10px 18px;border-radius:10px;background:rgba(20,20,24,0.9);color:#fff;' +
      'font-size:13px;line-height:1.5;box-shadow:0 8px 28px rgba(0,0,0,0.35);';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  }

  // ============ 主题解析（与编辑器启动屏保持一致）============
  function resolveTheme () {
    var theme = '';
    try {
      var setting = localStorage.getItem('tw:theme');
      if (setting === 'light' || setting === 'dark') {
        theme = setting;
      } else if (setting) {
        var parsed = JSON.parse(setting);
        if (parsed && (parsed.gui === 'dark' || parsed.gui === 'light')) {
          theme = parsed.gui;
        }
      }
    } catch (e) { /* ignore */ }
    if (!theme) {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme;
  }

  function readLocal (key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  // ============ IndexedDB：把选中的文件传给编辑器 ============
  var PENDING_DB = 'neowarp-web';
  var PENDING_STORE = 'pending-files';

  function openPendingDB () {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      var req = indexedDB.open(PENDING_DB, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(PENDING_STORE)) {
          db.createObjectStore(PENDING_STORE);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function writePendingFile (payload) {
    return openPendingDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(PENDING_STORE, 'readwrite');
        tx.objectStore(PENDING_STORE).put(payload, 'pending');
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); resolve(false); };
        tx.onabort = function () { db.close(); resolve(false); };
      });
    });
  }

  function clearPendingFile () {
    return openPendingDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(PENDING_STORE, 'readwrite');
        tx.objectStore(PENDING_STORE).delete('pending');
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); resolve(false); };
        tx.onabort = function () { db.close(); resolve(false); };
      });
    }).catch(function () { return false; });
  }

  function goToEditor () {
    window.location.href = EDITOR_URL;
  }

  // 选择本地项目文件并暂存，随后跳转编辑器
  function openFromFile () {
    var pick = new Promise(function (resolve) {
      if (window.showOpenFilePicker) {
        window.showOpenFilePicker({
          types: [
            { description: '项目文件', accept: { 'application/json': ['.sb3', '.np1', '.npnp', '.viewsb3', '.sb2', '.sb'] } },
            { description: '所有文件', accept: { '*/*': ['*'] } }
          ],
          multiple: false
        }).then(function (handles) {
          return handles[0].getFile();
        }).then(resolve).catch(function () { resolve(null); });
        return;
      }
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.sb3,.np1,.npnp,.viewsb3,.sb2,.sb';
      input.onchange = function () {
        resolve(input.files && input.files.length ? input.files[0] : null);
      };
      input.click();
    });

    return pick.then(function (file) {
      if (!file) return false;
      return file.arrayBuffer().then(function (buffer) {
        return writePendingFile({ name: file.name, buffer: buffer }).then(function () {
          goToEditor();
          return true;
        });
      });
    });
  }

  // ============ HomePreload 浏览器版实现 ============
  var themeListeners = [];
  var recentListeners = [];

  window.HomePreload = {
    getInfo: function () {
      return {
        locale: readLocal('tw:locale', navigator.language || 'zh-cn'),
        version: '2.0.0',
        homeLogo: readLocal('neowarp:homeLogo', ''),
        homeLogoText: readLocal('neowarp:homeLogoText', 'NeoWarp'),
        homeBackground: readLocal('neowarp:homeBackground', '')
      };
    },
    getTheme: function () { return Promise.resolve(resolveTheme()); },
    themeApplied: function () { /* 网页版无需回报 */ },
    onThemeChanged: function (cb) { themeListeners.push(cb); },

    onBrandingChanged: function (cb) { /* 网页版暂无动态品牌更新 */ },

    // 新建 / 打开
    newScratchProject: function () {
      clearPendingFile().then(goToEditor);
      return Promise.resolve(true);
    },
    openFromFile: openFromFile,
    openSolo: function () {
      toast('网页版暂不支持 SOLO，请使用桌面版');
    },
    newExtension: function () {
      toast('网页版暂不支持扩展编辑器，请使用桌面版');
    },
    openImageEditor: function () {
      toast('网页版暂不支持图片编辑器，请使用桌面版');
    },
    openCollabJoin: function () { toast('网页版暂不支持协作功能'); },
    openCollabHostNew: function () { toast('网页版暂不支持协作功能'); },
    openCollabHostFromFile: function () { toast('网页版暂不支持协作功能'); },

    // 设置：打开附加组件设置页面
    openSettings: function () {
      window.open('addons/addons.html', '_blank');
    },

    // 最近项目：网页版不保存本地文件路径，始终为空
    getRecentProjects: function () {
      return Promise.resolve({ show: false, projects: [] });
    },
    openRecentProject: function () { return Promise.resolve('not-found'); },
    onRecentChanged: function (cb) { recentListeners.push(cb); }
  };

  // 跨标签页（主页 <-> 编辑器）主题同步
  window.addEventListener('storage', function (e) {
    if (e && e.key === 'tw:theme') {
      var theme = resolveTheme();
      themeListeners.forEach(function (cb) {
        try { cb({ theme: theme }); } catch (err) { /* ignore */ }
      });
    }
  });

  // 打开编辑器后可用浏览器「后退」回到主页，这里不额外处理
  console.log('[NeoWarp] 网页版 HomePreload 已加载');
})();

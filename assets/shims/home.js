/* ==========================================================================
 * NeoWarp 网页版 — 主页 HomePreload 浏览器实现
 * 修正桌面版的语义：设置打开「桌面设置」而不是附加组件；
 * 扩展编辑器、图片编辑器等入口以页内窗口的形式真实可用。
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  var util = NW.util;
  var storage = NW.storage;

  /* --------------------------- 最近项目 --------------------------- */
  var RECENT_DB = 'neowarp-web-recent';
  var RECENT_STORE = 'handles';

  function openRecentDB () {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('IndexedDB 不可用')); return; }
      var request = global.indexedDB.open(RECENT_DB, 1);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(RECENT_STORE)) db.createObjectStore(RECENT_STORE);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function recentListKey () {
    return 'list';
  }

  function readRecent () {
    return openRecentDB().then(function (db) {
      return new Promise(function (resolve) {
        var request = db.transaction(RECENT_STORE, 'readonly').objectStore(RECENT_STORE).get(recentListKey());
        request.onsuccess = function () {
          db.close();
          resolve(request.result || []);
        };
        request.onerror = function () { db.close(); resolve([]); };
      });
    }).catch(function () { return []; });
  }

  function writeRecent (entries) {
    return openRecentDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(RECENT_STORE, 'readwrite');
        tx.objectStore(RECENT_STORE).put(entries, recentListKey());
        tx.oncomplete = function () { db.close(); resolve(entries); };
        tx.onerror = function () { db.close(); resolve(entries); };
      });
    }).catch(function () { return entries; });
  }

  function rememberRecent (id, name, handle) {
    readRecent().then(function (entries) {
      var next = entries.filter(function (entry) { return entry.id !== id; });
      next.unshift({ id: id, name: name, addedAt: Date.now(), hasHandle: !!handle });
      writeRecent(next.slice(0, 12));
      notifyRecentChanged();
    });
  }

  var recentListeners = [];
  function notifyRecentChanged () {
    recentListeners.forEach(function (listener) {
      try { listener(); } catch (e) { /* 忽略 */ }
    });
  }

  /* --------------------------- 打开文件 --------------------------- */
  /**
   * 桌面版编辑器是独立窗口，网页版用「最大化页内窗口」等价替换：
   * 既保留返回主页的出口，又让编辑器继续持有宿主上下文（AI、设置等依赖它）。
   * 不支持页内窗口的老浏览器退回整页跳转。
   */
  function gotoEditor () {
    var win = NW.openRoute('editor');
    if (!win) global.location.href = util.resolveAppPath('gui/gui.html');
    return win;
  }

  function stageFile (file, handle) {
    var id = 'recent-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    return file.arrayBuffer().then(function (buffer) {
      return storage.putPendingFile({ name: file.name, buffer: buffer }).then(function () {
        rememberRecent(id, file.name, handle);
        if (handle) {
          // 句柄无法跨页面传输，暂存到最近项目表，打开时按 id 取回
          return openRecentDB().then(function (db) {
            return new Promise(function (resolve) {
              var tx = db.transaction(RECENT_STORE, 'readwrite');
              tx.objectStore(RECENT_STORE).put(handle, 'handle:' + id);
              tx.oncomplete = function () { db.close(); resolve(); };
              tx.onerror = function () { db.close(); resolve(); };
            });
          });
        }
        return null;
      });
    }).then(function () {
      gotoEditor();
      return true;
    });
  }

  function pickProjectFile () {
    if (global.showOpenFilePicker) {
      return global.showOpenFilePicker({
        types: [{ description: '项目文件', accept: { 'application/json': ['.sb3', '.np1', '.npnp', '.viewsb3', '.sb2', '.sb'] } }],
        multiple: false
      }).then(function (handles) {
        var handle = handles[0];
        return handle.getFile().then(function (file) { return stageFile(file, handle); });
      }).catch(function (error) {
        if (error && error.name === 'AbortError') return false;
        return pickProjectFileFallback();
      });
    }
    return pickProjectFileFallback();
  }

  function pickProjectFileFallback () {
    return new Promise(function (resolve) {
      var input = global.document.createElement('input');
      input.type = 'file';
      input.accept = '.sb3,.np1,.npnp,.viewsb3,.sb2,.sb';
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) { resolve(false); return; }
        stageFile(file, null).then(resolve);
      });
      input.click();
    });
  }

  /* --------------------------- HomePreload --------------------------- */
  var themeListeners = [];
  var brandingListeners = [];

  global.HomePreload = {
    getInfo: function () {
      return {
        locale: util.resolveLocale(),
        version: global.NW_VERSION || '2.0.0',
        homeLogo: util.readLocal('neowarp:homeLogo', ''),
        homeLogoText: util.readLocal('neowarp:homeLogoText', 'NeoWarp'),
        homeBackground: util.readLocal('neowarp:homeBackground', '')
      };
    },

    getTheme: function () { return Promise.resolve(util.resolveTheme()); },
    themeApplied: function () {},
    onThemeChanged: function (callback) { themeListeners.push(callback); },
    onBrandingChanged: function (callback) { brandingListeners.push(callback); },

    newScratchProject: function () {
      return storage.clearPendingFile().then(function () {
        gotoEditor();
        return true;
      });
    },

    newExtension: function () {
      NW.openRoute('extension-editor');
      return Promise.resolve(true);
    },

    openFromFile: pickProjectFile,

    openImageEditor: function () {
      NW.openRoute('image-editor');
      return Promise.resolve(true);
    },

    /* SOLO 与 AI 助手共用同一个页面（桌面版只是用不同协议区分窗口），
       网页版直接打开 AI 助手窗口，自主建站能力需要有编辑器上下文时才可用 */
    openSolo: function () {
      NW.openRoute('ai-assistant', { title: 'NeoWarp SOLO' });
      util.toast('SOLO 自主建站需先打开编辑器；网页版可直接与 AI 对话协作');
      return Promise.resolve(true);
    },
    openCollabJoin: function () {
      util.toast('多人协作是桌面版专属能力，请使用 NeoWarp 桌面客户端');
      return Promise.resolve(false);
    },
    openCollabHostNew: function () {
      util.toast('多人协作是桌面版专属能力，请使用 NeoWarp 桌面客户端');
      return Promise.resolve(false);
    },
    openCollabHostFromFile: function () {
      util.toast('多人协作是桌面版专属能力，请使用 NeoWarp 桌面客户端');
      return Promise.resolve(false);
    },

    /* 修正点：桌面版这里打开的是「桌面设置」窗口 */
    openSettings: function () {
      NW.openRoute('desktop-settings');
      return Promise.resolve(true);
    },

    getRecentProjects: function () {
      var show = storage.getSettings().showRecentProjects !== false;
      if (!show) return Promise.resolve({ show: false, projects: [] });
      return readRecent().then(function (entries) {
        return {
          show: true,
          projects: entries.map(function (entry) {
            return { filePath: entry.id, name: entry.name };
          })
        };
      });
    },

    openRecentProject: function (filePath) {
      return openRecentDB().then(function (db) {
        return new Promise(function (resolve) {
          var request = db.transaction(RECENT_STORE, 'readonly').objectStore(RECENT_STORE).get('handle:' + filePath);
          request.onsuccess = function () {
            db.close();
            resolve(request.result || null);
          };
          request.onerror = function () { db.close(); resolve(null); };
        });
      }).catch(function () { return null; }).then(function (handle) {
        if (!handle) {
          util.toast('浏览器已不再保留该文件的访问授权，请重新打开一次');
          return 'not-found';
        }
        var options = { mode: 'read' };
        return Promise.resolve(handle.queryPermission ? handle.queryPermission(options) : 'granted')
          .then(function (status) {
            if (status === 'granted') return 'granted';
            return handle.requestPermission ? handle.requestPermission(options) : 'denied';
          })
          .then(function (status) {
            if (status !== 'granted') {
              util.toast('未获得该文件的访问授权');
              return 'denied';
            }
            return handle.getFile().then(function (file) {
              return file.arrayBuffer().then(function (buffer) {
                return storage.putPendingFile({ name: file.name, buffer: buffer });
              });
            }).then(function () {
              gotoEditor();
              return 'ok';
            }).catch(function () { return 'not-found'; });
          });
      });
    },

    onRecentChanged: function (callback) { recentListeners.push(callback); }
  };

  util.onBroadcast(function (message) {
    if (message.type === 'branding') {
      brandingListeners.forEach(function (listener) {
        try { listener(message.data); } catch (e) { /* 忽略 */ }
      });
    }
  });

  console.log('[NeoWarp] 网页版 HomePreload 已加载');
})(window);

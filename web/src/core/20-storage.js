/* ==========================================================================
 * NeoWarp Web Runtime — 存储层
 * 桌面版 tw_config.json / 磁盘文件的浏览器等价实现：
 *   - 设置统一落在 localStorage 的 neowarp:settings
 *   - AI 模型配置落在 neowarp:ai-model-configs（与 AI 助手 / 桌面设置 / 扩展编辑器共用）
 *   - 扩展编辑器的工程文件落在 IndexedDB 虚拟文件系统
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  var util = NW.util;

  var SETTINGS_KEY = 'neowarp:settings';
  var AI_CONFIGS_KEY = 'neowarp:ai-model-configs';
  var AI_ACTIVE_KEY = 'neowarp:ai-active-config-id';

  /* ----------------------------- 通用设置 ----------------------------- */
  var DEFAULT_SETTINGS = {
    updateChecker: 'startup',
    uiTheme: 'system',
    microphone: null,
    camera: null,
    hardwareAcceleration: true,
    backgroundThrottling: true,
    bypassCORS: true,
    spellchecker: false,
    exitFullscreenOnEscape: true,
    richPresence: false,
    showRecentProjects: true,
    topBarDeviceStats: false,
    homeLogoText: 'NeoWarp'
  };

  function getSettings () {
    var stored = util.readJSON(SETTINGS_KEY, {});
    var merged = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
      merged[key] = Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : DEFAULT_SETTINGS[key];
    });
    Object.keys(stored).forEach(function (key) {
      if (!(key in merged)) merged[key] = stored[key];
    });
    return merged;
  }

  function setSetting (key, value) {
    var current = getSettings();
    current[key] = value;
    util.writeJSON(SETTINGS_KEY, current);
    NW.storage.emitSettingsChanged(key, value);
    return true;
  }

  var settingsListeners = [];
  function onSettingsChanged (listener) {
    settingsListeners.push(listener);
  }
  function emitSettingsChanged (key, value) {
    settingsListeners.forEach(function (listener) {
      try { listener(key, value); } catch (e) { /* 忽略 */ }
    });
  }

  /* --------------------------- AI 模型配置 --------------------------- */
  var CONFIG_FIELDS = [
    'id', 'name', 'provider', 'model', 'apiKey', 'apiFormat',
    'customEndpoint', 'customModelId', 'customContextLimit', 'thinkingLevel'
  ];

  function normalizeConfig (raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var cfg = {};
    CONFIG_FIELDS.forEach(function (field) {
      if (raw[field] !== undefined && raw[field] !== null) cfg[field] = raw[field];
    });
    if (typeof cfg.id !== 'string' || !cfg.id) cfg.id = 'cfg_' + Date.now() + '_' + (index || 0);
    if (typeof cfg.provider !== 'string' || !cfg.provider) cfg.provider = 'openai';
    if (typeof cfg.name !== 'string') cfg.name = '';
    if (typeof cfg.model !== 'string') cfg.model = '';
    if (typeof cfg.apiKey !== 'string') cfg.apiKey = '';
    if (cfg.apiFormat !== 'anthropic' && cfg.apiFormat !== 'ollama' && cfg.apiFormat !== 'custom') {
      cfg.apiFormat = 'openai';
    }
    if (typeof cfg.customEndpoint !== 'string') cfg.customEndpoint = '';
    if (typeof cfg.customModelId !== 'string') cfg.customModelId = '';
    var contextLimit = Number(cfg.customContextLimit);
    cfg.customContextLimit = isFinite(contextLimit) && contextLimit >= 1000 ? Math.floor(contextLimit) : 32000;
    if (typeof cfg.thinkingLevel !== 'string' || !cfg.thinkingLevel) cfg.thinkingLevel = 'medium';
    return cfg;
  }

  function getAiModelConfigs () {
    var list = util.readJSON(AI_CONFIGS_KEY, []) || [];
    var configs = (Array.isArray(list) ? list : []).map(normalizeConfig).filter(Boolean);
    var storedActive = util.readLocal(AI_ACTIVE_KEY, null);
    var activeId = null;
    if (storedActive && configs.some(function (cfg) { return cfg.id === storedActive; })) {
      activeId = storedActive;
    } else if (configs.length) {
      activeId = configs[0].id;
    }
    return { configs: configs, activeId: activeId };
  }

  function saveAiModelConfigs (payload) {
    var input = payload || {};
    var list = input.configs === undefined || input.configs === null
      ? getAiModelConfigs().configs
      : input.configs;
    var configs = (Array.isArray(list) ? list : []).map(normalizeConfig).filter(Boolean);
    var activeId = typeof input.activeId === 'string' ? input.activeId : null;
    if (!activeId || !configs.some(function (cfg) { return cfg.id === activeId; })) {
      activeId = configs.length ? configs[0].id : null;
    }
    util.writeJSON(AI_CONFIGS_KEY, configs);
    util.writeLocal(AI_ACTIVE_KEY, activeId);
    var result = { configs: configs, activeId: activeId };
    emitAiConfigsChanged(result);
    return result;
  }

  var aiConfigListeners = [];
  function onAiConfigsChanged (listener) {
    aiConfigListeners.push(listener);
  }
  function emitAiConfigsChanged (payload) {
    aiConfigListeners.forEach(function (listener) {
      try { listener(payload); } catch (e) { /* 忽略 */ }
    });
  }

  /* ------------------------ 虚拟文件系统(IndexedDB) ------------------------ */
  var VFS_DB = 'neowarp-web-vfs';
  var VFS_STORE = 'files';
  var PENDING_DB = 'neowarp-web';
  var PENDING_STORE = 'pending-files';

  function openDB (name, version, storeName) {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error('当前环境不支持 IndexedDB'));
        return;
      }
      var request = global.indexedDB.open(name, version);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function idbPut (db, storeName, value, key) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = function () { resolve(true); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function vfsPut (path, content) {
    return openDB(VFS_DB, 1, VFS_STORE).then(function (db) {
      return idbPut(db, VFS_STORE, { path: path, content: content, updatedAt: Date.now() }, path)
        .then(function () { db.close(); return true; }, function (error) { db.close(); throw error; });
    });
  }

  function vfsList () {
    return openDB(VFS_DB, 1, VFS_STORE).then(function (db) {
      return new Promise(function (resolve) {
        var request = db.transaction(VFS_STORE, 'readonly').objectStore(VFS_STORE).getAll();
        request.onsuccess = function () {
          db.close();
          resolve(request.result || []);
        };
        request.onerror = function () { db.close(); resolve([]); };
      });
    }).catch(function () { return []; });
  }

  function vfsDelete (path) {
    return openDB(VFS_DB, 1, VFS_STORE).then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(VFS_STORE, 'readwrite');
        tx.objectStore(VFS_STORE).delete(path);
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); resolve(false); };
      });
    }).catch(function () { return false; });
  }

  /* --------------------- 主页 -> 编辑器 的待打开文件 --------------------- */
  function putPendingFile (payload) {
    return openDB(PENDING_DB, 1, PENDING_STORE).then(function (db) {
      return idbPut(db, PENDING_STORE, payload, 'pending')
        .then(function () { db.close(); return true; }, function () { db.close(); return false; });
    }).catch(function () { return false; });
  }

  function takePendingFile () {
    return openDB(PENDING_DB, 1, PENDING_STORE).then(function (db) {
      return new Promise(function (resolve) {
        var value = null;
        var tx = db.transaction(PENDING_STORE, 'readwrite');
        var store = tx.objectStore(PENDING_STORE);
        var request = store.get('pending');
        request.onsuccess = function () {
          value = request.result || null;
          store.delete('pending');
        };
        tx.oncomplete = function () { db.close(); resolve(value); };
        tx.onerror = function () { db.close(); resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function clearPendingFile () {
    return takePendingFile().then(function () { return true; });
  }

  NW.storage = {
    getSettings: getSettings,
    setSetting: setSetting,
    onSettingsChanged: onSettingsChanged,
    emitSettingsChanged: emitSettingsChanged,

    getAiModelConfigs: getAiModelConfigs,
    saveAiModelConfigs: saveAiModelConfigs,
    onAiConfigsChanged: onAiConfigsChanged,
    emitAiConfigsChanged: emitAiConfigsChanged,

    vfsPut: vfsPut,
    vfsList: vfsList,
    vfsDelete: vfsDelete,
    putPendingFile: putPendingFile,
    takePendingFile: takePendingFile,
    clearPendingFile: clearPendingFile,
    normalizeAiConfig: normalizeConfig
  };
})(window);

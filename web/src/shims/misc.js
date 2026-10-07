/* ==========================================================================
 * NeoWarp 网页版 — 小型窗口统一 shim
 * 关于 / 隐私 / 联系 / 任务管理器 / 待办清单 / 工程分析 / 手机预览 /
 * 附加组件设置 / 文件授权等页面共用一份实现（各页面只会用到自己那一个）。
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  var util = NW.util;
  var storage = NW.storage;
  var rpc = NW.rpc;

  function editorCall (method, args, timeout) {
    if (!rpc.isAvailable()) return Promise.resolve(null);
    return rpc.call('editor', method, args, timeout).catch(function () { return null; });
  }

  function closeSelf () {
    if (rpc.postToHost({ __nw: 1, t: 'close' })) return Promise.resolve(true);
    try { global.close(); } catch (e) { /* 忽略 */ }
    return Promise.resolve(true);
  }

  /* ------------------------------ 关于 ------------------------------ */
  global.AboutPreload = {
    getInfo: function () {
      return {
        name: 'NeoWarp',
        version: global.NW_VERSION || '2.0.0',
        electron: 'Web',
        platform: '浏览器',
        arch: (global.navigator && global.navigator.platform) || 'web',
        dist: 'NeoWarp Web'
      };
    }
  };

  /* ------------------------------ 隐私 ------------------------------ */
  global.PrivacyPreload = {
    isUpdateCheckerAllowed: function () { return true; },
    openDesktopSettings: function () {
      if (rpc.isAvailable()) {
        return rpc.call('desktop', 'openDesktopSettings', []).catch(function () { return false; });
      }
      return Promise.resolve(false);
    }
  };

  /* ------------------------------ 联系方式 ------------------------------ */
  global.ContactPreload = {
    getTheme: function () { return Promise.resolve(util.resolveTheme()); },
    onThemeChanged: function (callback) { rpc.on('desktop', 'theme', callback); }
  };

  /* ---------------------------- 任务管理器 ---------------------------- */
  global.TaskManagerPreload = {
    getSystemStats: function () {
      return editorCall('getSystemStats', [], 10000).then(function (result) {
        return result || { cpuPercent: 0, ramUsedMB: 0, usedMemory: 0, totalMemory: 0 };
      });
    },
    getSpriteStats: function () {
      return editorCall('getSpriteStats', [], 30000).then(function (result) {
        return result || { sprites: [], totalThreads: 0 };
      });
    },
    getTheme: function () { return Promise.resolve(util.resolveTheme()); },
    closeWindow: closeSelf,
    onThemeChanged: function (callback) { rpc.on('desktop', 'theme', callback); },
    removeThemeListener: function () {}
  };

  /* ---------------------------- 待办清单 ---------------------------- */
  var REMINDER_KEY = 'neowarp:reminders';
  var reminderListeners = [];

  function readReminders () {
    return util.readJSON(REMINDER_KEY, {});
  }

  function writeReminders (value) {
    util.writeJSON(REMINDER_KEY, value);
  }

  var reminderTimer = null;
  function scheduleReminders () {
    if (reminderTimer) return;
    reminderTimer = global.setInterval(function () {
      var now = Date.now();
      var reminders = readReminders();
      var changed = false;
      Object.keys(reminders).forEach(function (todoId) {
        var reminder = reminders[todoId];
        if (!reminder || reminder.triggered) return;
        if (reminder.reminderTime && reminder.reminderTime <= now) {
          reminder.triggered = true;
          changed = true;
          reminderListeners.forEach(function (listener) {
            try { listener({ todoId: todoId, todoText: reminder.todoText, reminderTime: reminder.reminderTime }); } catch (e) { /* 忽略 */ }
          });
        }
      });
      if (changed) writeReminders(reminders);
    }, 5000);
  }

  global.TodoListPreload = {
    getTheme: function () { return Promise.resolve(util.resolveTheme()); },
    closeWindow: closeSelf,
    onThemeChanged: function (callback) { rpc.on('desktop', 'theme', callback); },
    removeThemeListener: function () {},

    setReminder: function (todoId, todoText, reminderTime) {
      var reminders = readReminders();
      reminders[todoId] = { todoText: todoText, reminderTime: reminderTime, triggered: false };
      writeReminders(reminders);
      scheduleReminders();
      return Promise.resolve(true);
    },
    cancelReminder: function (todoId) {
      var reminders = readReminders();
      delete reminders[todoId];
      writeReminders(reminders);
      return Promise.resolve(true);
    },
    getReminders: function () {
      return Promise.resolve(readReminders());
    },
    onReminderTriggered: function (callback) {
      reminderListeners.push(callback);
      scheduleReminders();
    },
    removeReminderTriggeredListener: function () { reminderListeners.length = 0; }
  };

  /* ---------------------------- 工程分析 ---------------------------- */
  global.ProjectAnalysisPreload = {
    getProjectData: function () {
      return editorCall('getProjectCode', [], 90000);
    },
    getTheme: function () { return Promise.resolve(util.resolveTheme()); },
    closeWindow: closeSelf,
    saveImage: function (dataUrl) {
      if (typeof dataUrl !== 'string' || !dataUrl) return Promise.resolve(null);
      if (global.showSaveFilePicker) {
        return global.showSaveFilePicker({
          suggestedName: 'project-analysis.png',
          types: [{ description: 'PNG 图片', accept: { 'image/png': ['.png'] } }]
        }).then(function (handle) {
          return fetch(dataUrl).then(function (response) { return response.blob(); }).then(function (blob) {
            return handle.createWritable().then(function (writable) {
              return writable.write(blob).then(function () { return writable.close(); });
            });
          }).then(function () { return { name: handle.name }; });
        }).catch(function (error) {
          if (error && error.name === 'AbortError') return null;
          downloadDataUrl(dataUrl, 'project-analysis.png');
          return { name: 'project-analysis.png' };
        });
      }
      downloadDataUrl(dataUrl, 'project-analysis.png');
      return Promise.resolve({ name: 'project-analysis.png' });
    },
    onThemeChanged: function (callback) { rpc.on('desktop', 'theme', callback); },
    removeThemeListener: function () {}
  };

  function downloadDataUrl (dataUrl, fileName) {
    var anchor = global.document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = fileName;
    global.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  /* ---------------------------- 手机预览 ---------------------------- */
  /* 网页版：无局域网 HTTP 服务，改为 WebRTC 实时舞台串流（帧 + 控制） */
  global.MobilePreviewPreload = {
    start: function () {
      if (!NW.stageShare) {
        return Promise.resolve({success: false, error: '舞台串流仅在编辑器页面可用'});
      }
      return NW.stageShare.start().then(function (urls) {
        return {
          success: true,
          url: urls[0],
          urls: urls,
          port: 'P2P'
        };
      }).catch(function (error) {
        return {success: false, error: (error && error.message) || String(error)};
      });
    },
    stop: function () {
      if (NW.stageShare && NW.stageShare.host) {
        try { NW.stageShare.host.close(); } catch (e) { void e; }
        NW.stageShare.host = null;
        NW.stageShare.room = null;
      }
      return Promise.resolve(true);
    },
    getQRCode: function (url) {
      if (!url) return Promise.resolve(null);
      var svg = NW.remote ? NW.remote.qrSvg(url) : null;
      return Promise.resolve(svg);
    },
    getTheme: function () { return Promise.resolve(util.resolveTheme()); },
    onThemeChanged: function (callback) { rpc.on('desktop', 'theme', callback); }
  };

  /* ------------------------- 附加组件设置导出 ------------------------- */
  global.AddonsPreload = {
    exportSettings: function (settings) {
      var blob = new Blob([settings], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var anchor = global.document.createElement('a');
      anchor.href = url;
      anchor.download = 'neowarp-addon-settings.json';
      global.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      global.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return Promise.resolve(true);
    }
  };

  /* ---------------------- 文件访问权限说明窗口 ---------------------- */
  global.FileAccessPreload = {
    init: function () {
      return { theme: util.resolveTheme() };
    },
    onNewPath: function () {}
  };

  /* ---------------------------- 分离舞台 ---------------------------- */
  global.DetachedStagePreload = {
    onFrame: function () {},
    onClose: function () {},
    onDimensions: function () {},
    sendInput: function () {},
    ready: function () {}
  };
})(window);

/* ==========================================================================
 * NeoWarp 网页版 — 扩展编辑器 ExtensionEditorPreload 浏览器实现
 * 磁盘读写替换为 File System Access API + IndexedDB 虚拟文件系统；
 * 「添加到项目 / 我的扩展」通过宿主的 editor 服务下发到 Scratch 项目。
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  var util = NW.util;
  var storage = NW.storage;
  var rpc = NW.rpc;

  var JS_TYPES = [
    { description: 'JavaScript 文件', accept: { 'text/javascript': ['.js'] } },
    { description: '所有文件', accept: { '*/*': ['*'] } }
  ];

  /* ---------------------- 文件引用 ----------------------
   * handle:<seq>  —— 真实磁盘文件（持有 FileSystemFileHandle，可直接回写）
   * vfs:<name>    —— 浏览器虚拟文件（IndexedDB）
   */
  var handleSeq = 0;
  var handleMap = new Map();   // 'handle:N' -> FileSystemFileHandle
  var nameMap = new Map();     // 'handle:N' -> 文件名
  var vfsCache = new Map();    // 'vfs:name' -> 内容

  function makeHandleRef (handle, name) {
    var ref = 'handle:' + (++handleSeq);
    handleMap.set(ref, handle);
    nameMap.set(ref, name);
    return ref;
  }

  function makeVfsRef (name) {
    return 'vfs:' + name;
  }

  function isVfsRef (path) {
    return typeof path === 'string' && path.indexOf('vfs:') === 0;
  }

  function vfsName (path) {
    return path.slice(4);
  }

  function readFileRef (ref) {
    if (isVfsRef(ref)) {
      var cached = vfsCache.get(ref);
      if (cached !== undefined) return Promise.resolve(cached);
      return storage.vfsList().then(function (files) {
        var matched = files.find(function (file) { return file.path === ref; });
        return matched ? matched.content : '';
      });
    }
    var handle = handleMap.get(ref);
    if (!handle) return Promise.reject(new Error('文件句柄已失效，请重新打开'));
    return handle.getFile().then(function (file) { return file.text(); });
  }

  function writeFileRef (ref, name, content) {
    if (isVfsRef(ref)) {
      vfsCache.set(ref, content);
      return storage.vfsPut(ref, content).then(function () {
        return { path: ref, name: name };
      });
    }
    var handle = handleMap.get(ref);
    if (!handle) return Promise.resolve({ error: '文件句柄已失效，请另存为' });
    return handle.createWritable().then(function (writable) {
      return writable.write(content).then(function () { return writable.close(); });
    }).then(function () {
      return { path: ref, name: name };
    }).catch(function (error) {
      return { error: '写入失败：' + ((error && error.message) || error) };
    });
  }

  function pickOpenFiles () {
    var picked = [];
    if (global.showOpenFilePicker) {
      return global.showOpenFilePicker({ types: JS_TYPES, multiple: true })
        .then(function (handles) {
          return Promise.all(handles.map(function (handle) {
            return handle.getFile().then(function (file) {
              var ref = makeHandleRef(handle, file.name);
              return file.text().then(function (content) {
                return { path: ref, name: file.name, content: content };
              });
            });
          }));
        })
        .catch(function (error) {
          if (error && error.name === 'AbortError') return null;
          return null;
        });
    }
    return pickOpenFilesFallback();
  }

  function pickOpenFilesFallback () {
    return new Promise(function (resolve) {
      var input = global.document.createElement('input');
      input.type = 'file';
      input.accept = '.js,text/javascript';
      input.multiple = true;
      input.addEventListener('change', function () {
        var files = Array.prototype.slice.call(input.files || []);
        if (!files.length) {
          resolve(null);
          return;
        }
        Promise.all(files.map(function (file) {
          return file.text().then(function (content) {
            var ref = makeVfsRef(file.name);
            return { path: ref, name: file.name, content: content };
          });
        })).then(function (list) {
          picked = list;
          resolve(list);
        });
      });
      input.click();
    });
  }

  function downloadText (name, content) {
    var blob = new Blob([content], { type: 'text/javascript' });
    var url = URL.createObjectURL(blob);
    var anchor = global.document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    global.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    global.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function suggestName (content) {
    var matched = /Scratch\.Blocks|getInfo\s*\(|id\s*:\s*['"]([a-zA-Z0-9_-]+)['"]/.exec(content || '');
    if (matched && matched[1]) return matched[1] + '.js';
    return 'extension.js';
  }

  /* ---------------------- 与宿主/编辑器交互 ---------------------- */
  function editorCall (method, args, timeout) {
    if (!rpc.isAvailable()) return Promise.resolve(null);
    return rpc.call('editor', method, args, timeout).catch(function () { return null; });
  }

  /** 编辑器窗口当前是否可用（页内窗口打开后由宿主提供 editor 服务） */
  function editorAvailable () {
    return rpc.isAvailable();
  }

  function extepopCall (method, args, timeout) {
    if (!rpc.isAvailable()) return Promise.resolve(null);
    return rpc.call('extepop', method, args, timeout).catch(function () { return null; });
  }

  var projectsListeners = [];
  var openPathListeners = [];
  var memoryFileListeners = [];
  var popoutClosedListeners = [];
  var editorRequestListeners = [];

  function takeInitialFiles () {
    return editorCall('takePendingExtensionFiles', [], 10000).then(function (files) {
      if (files && files.length) return files[0];
      return null;
    }).catch(function () { return null; });
  }

  function buildInitial () {
    var params = new URLSearchParams(global.location.search);
    if (params.get('file')) {
      try {
        return Promise.resolve({ file: JSON.parse(decodeURIComponent(params.get('file'))) });
      } catch (e) {
        return Promise.resolve({ file: null, error: '参数解析失败' });
      }
    }
    return takeInitialFiles().then(function (file) {
      return { file: file, memoryFiles: pendingExternalFiles.slice() };
    });
  }

  var pendingExternalFiles = [];

  global.ExtensionEditorPreload = {
    /* ------------------------------ 文件读写 ------------------------------ */
    getInitial: buildInitial,

    save: function (path, content) {
      if (!path) {
        return global.ExtensionEditorPreload.saveAs(null, content);
      }
      return writeFileRef(path, nameMap.get(path) || 'extension.js', content);
    },

    saveAs: function (suggestedName, content) {
      var name = suggestedName || suggestName(content);
      if (global.showSaveFilePicker) {
        return global.showSaveFilePicker({
          suggestedName: name,
          types: JS_TYPES
        }).then(function (handle) {
          var ref = makeHandleRef(handle, handle.name || name);
          return writeFileRef(ref, handle.name || name, content);
        }).catch(function (error) {
          if (error && error.name === 'AbortError') return null;
          // 浏览器不支持或用户拒绝时退回下载
          downloadText(name, content);
          return { path: makeVfsRef(name), name: name, downloaded: true };
        });
      }
      downloadText(name, content);
      return Promise.resolve({ path: makeVfsRef(name), name: name, downloaded: true });
    },

    openDialog: function () {
      return pickOpenFiles();
    },

    confirmClose: function (fileName) {
      var confirmed = global.confirm('“' + (fileName || '未命名') + '”尚未保存，是否保存后再关闭？');
      if (confirmed) return Promise.resolve('save');
      var discard = global.confirm('放弃未保存的修改吗？');
      return Promise.resolve(discard ? 'discard' : 'cancel');
    },

    rename: function (path, newName) {
      if (isVfsRef(path)) {
        var nextRef = makeVfsRef(newName);
        return readFileRef(path).then(function (content) {
          return storage.vfsDelete(path).then(function () {
            return writeFileRef(nextRef, newName, content);
          });
        });
      }
      return Promise.resolve({ error: '网页版暂不支持重命名磁盘文件，请用「另存为」' });
    },

    /* ------------------------------ 添加到项目 ------------------------------ */
    listProjects: function () {
      return editorCall('listProjects', [], 10000).then(function (list) {
        return list || [];
      });
    },

    addToProject: function (targetId, name, code) {
      return editorCall('addToProject', [targetId, name, code], 60000).then(function (result) {
        return result || { success: false, error: '没有可用的 Scratch 项目' };
      });
    },

    onProjectsChanged: function (callback) {
      projectsListeners.push(callback);
      rpc.on('editor', 'projectsChanged', callback);
      // 首帧推一次当前状态
      global.ExtensionEditorPreload.listProjects().then(function (list) {
        projectsListeners.forEach(function (listener) {
          try { listener(list); } catch (e) { /* 忽略 */ }
        });
      });
    },

    /**
     * 加入「我的扩展」。网页版始终写入本地虚拟文件系统（编辑器的扩展库会读到），
     * 同时尝试同步给已打开的编辑器；两者任一成功即可。
     */
    addToMyExtensions: function (id, name, code) {
      var fileName = (name || id || 'extension').replace(/[\\/:*?"<>|]/g, '_');
      if (!/\.js$/i.test(fileName)) fileName += '.js';
      // VM 只接受字母数字 id，写入前先兜底规范化
      var normalized = util.normalizeExtensionCode(code, fileName);
      var saved = NW.storage.vfsPut('my-extensions/' + fileName, normalized);

      return saved.then(function () {
        if (!editorAvailable()) {
          return { success: true, persisted: 'local' };
        }
        return editorCall('upsertMyExtension', [id, name, normalized], 60000).then(function (result) {
          return result && result.success ? result : { success: true, persisted: 'local' };
        }, function () {
          return { success: true, persisted: 'local' };
        });
      }).catch(function (error) {
        return { success: false, error: (error && error.message) || '保存到我的扩展失败' };
      });
    },

    onOpenMemoryFiles: function (callback) {
      memoryFileListeners.push(callback);
    },

    onOpenPaths: function (callback) {
      openPathListeners.push(callback);
    },

    /* ------------------------------ AI 模型配置 ------------------------------ */
    getAiModelConfigs: function () {
      if (rpc.isAvailable()) {
        return rpc.call('desktop', 'getAiModelConfigs', []).catch(function () { return storage.getAiModelConfigs(); });
      }
      return Promise.resolve(storage.getAiModelConfigs());
    },
    saveAiModelConfigs: function (payload) {
      if (rpc.isAvailable()) {
        return rpc.call('desktop', 'saveAiModelConfigs', [payload]).catch(function () { return storage.saveAiModelConfigs(payload); });
      }
      return Promise.resolve(storage.saveAiModelConfigs(payload));
    },
    onAiModelConfigsChanged: function (callback) {
      rpc.on('desktop', 'aiModelConfigs', callback);
      storage.onAiConfigsChanged(callback);
    },
    openDesktopSettings: function () {
      if (rpc.isAvailable()) {
        return rpc.call('desktop', 'openDesktopSettings', []).catch(function () { return false; });
      }
      return Promise.resolve(false);
    },

    /* --------------------------- AI 面板弹出/停靠 --------------------------- */
    popoutAi: function (popoutState) {
      return extepopCall('open', [popoutState], 10000).then(function (result) {
        return !!result;
      });
    },

    onPopoutClosed: function (callback) {
      popoutClosedListeners.push(callback);
      rpc.on('extepop', 'popoutClosed', callback);
    },

    onEditorRequest: function (callback) {
      editorRequestListeners.push(callback);
      rpc.on('extepop', 'editorRequest', function (data) {
        try { callback(data); } catch (e) { /* 忽略 */ }
      });
    },

    sendEditorResponse: function (requestId, result) {
      return extepopCall('respondEditor', [requestId, result], 10000);
    },

    closeWindow: function () {
      if (rpc.postToHost({ __nw: 1, t: 'close' })) return Promise.resolve(true);
      try { global.close(); } catch (e) { /* 忽略 */ }
      return Promise.resolve(true);
    }
  };
})(window);

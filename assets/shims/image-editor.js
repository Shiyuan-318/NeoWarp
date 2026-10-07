/* ==========================================================================
 * NeoWarp 网页版 — 图片编辑器 ImageEditorPreload 浏览器实现
 * 原 Electron 版本经由主进程弹系统文件对话框；网页版用
 * File System Access API（不支持时退回 input[type=file] / 下载）。
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  var util = NW.util;
  var rpc = NW.rpc;

  var IMAGE_TYPES = [
    {
      description: '图片文件',
      accept: {
        'image/png': ['.png'],
        'image/jpeg': ['.jpg', '.jpeg'],
        'image/webp': ['.webp'],
        'image/gif': ['.gif'],
        'image/bmp': ['.bmp'],
        'image/svg+xml': ['.svg']
      }
    }
  ];

  function toDataURL (payload) {
    if (!payload) return null;
    if (typeof payload === 'string') return payload;
    if (payload.dataUrl) return payload.dataUrl;
    if (payload.imageData) return payload.imageData;
    if (payload.base64) return payload.base64;
    if (payload.data) return payload.data;
    return null;
  }

  function dataUrlToBlob (dataUrl) {
    var matched = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
    if (!matched) return Promise.reject(new Error('不是合法的 Data URL'));
    var mime = matched[1] || 'application/octet-stream';
    if (matched[2]) {
      var binary = global.atob(matched[3]);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return Promise.resolve(new Blob([bytes], { type: mime }));
    }
    return Promise.resolve(new Blob([decodeURIComponent(matched[3])], { type: mime }));
  }

  function extensionForMime (mime) {
    switch (mime) {
      case 'image/jpeg': return '.jpg';
      case 'image/webp': return '.webp';
      case 'image/gif': return '.gif';
      case 'image/bmp': return '.bmp';
      case 'image/svg+xml': return '.svg';
      default: return '.png';
    }
  }

  /** 选择一张本地图片并读取为 data URL */
  function pickImage () {
    if (global.showOpenFilePicker) {
      return global.showOpenFilePicker({ types: IMAGE_TYPES, multiple: false })
        .then(function (handles) { return handles[0].getFile(); })
        .then(readFileAsDataURL)
        .catch(function (error) {
          if (error && error.name === 'AbortError') return null;
          // 权限被拒等情况退回传统 input
          return pickImageFallback();
        });
    }
    return pickImageFallback();
  }

  function pickImageFallback () {
    return new Promise(function (resolve) {
      var input = global.document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) {
          resolve(null);
          return;
        }
        readFileAsDataURL(file).then(resolve, function () { resolve(null); });
      });
      input.click();
    });
  }

  function readFileAsDataURL (file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve({ name: file.name, dataUrl: String(reader.result) });
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(file);
    });
  }

  /** 保存：优先写回原文件，否则走另存为 */
  function saveBlob (blob, suggestedName) {
    if (global.showSaveFilePicker) {
      return global.showSaveFilePicker({
        suggestedName: suggestedName,
        types: [{ description: '图片文件', accept: IMAGE_TYPES[0].accept }]
      }).then(function (handle) {
        return handle.createWritable().then(function (writable) {
          return writable.write(blob).then(function () { return writable.close(); });
        }).then(function () {
          return { name: handle.name || suggestedName };
        });
      }).catch(function (error) {
        if (error && error.name === 'AbortError') return null;
        downloadBlob(blob, suggestedName);
        return { name: suggestedName, downloaded: true };
      });
    }
    downloadBlob(blob, suggestedName);
    return Promise.resolve({ name: suggestedName, downloaded: true });
  }

  function downloadBlob (blob, fileName) {
    var url = URL.createObjectURL(blob);
    var anchor = global.document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    global.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    global.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function notifyThemeApplied (theme) {
    if (!rpc.isAvailable()) return Promise.resolve(true);
    return rpc.call('desktop', 'themeApplied', [theme]).catch(function () { return true; });
  }

  global.ImageEditorPreload = {
    getTheme: function () {
      if (rpc.isAvailable()) {
        return rpc.call('desktop', 'getTheme', []).catch(function () { return util.resolveTheme(); });
      }
      return Promise.resolve(util.resolveTheme());
    },

    themeApplied: function (theme) {
      notifyThemeApplied(theme);
    },

    openFile: function () {
      return pickImage();
    },

    saveFile: function (payload) {
      var dataUrl = toDataURL(payload);
      if (!dataUrl) return Promise.resolve(null);
      var suggestedName = (payload && (payload.name || payload.fileName)) || 'untitled.png';
      var dotIndex = suggestedName.lastIndexOf('.');
      if (dotIndex <= 0) {
        suggestedName += extensionForMime((/^data:([^;,]+)/.exec(dataUrl) || [])[1] || 'image/png');
      }
      return dataUrlToBlob(dataUrl)
        .then(function (blob) { return saveBlob(blob, suggestedName); })
        .catch(function (error) {
          util.toast('保存失败：' + (error && error.message ? error.message : error));
          return null;
        });
    }
  };
})(window);

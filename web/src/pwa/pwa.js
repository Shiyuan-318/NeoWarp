/* NeoWarp 网页版 PWA 引导脚本
 *
 * 职责：
 *   1. 注册根作用域的 Service Worker（sw.js）
 *   2. 新版本接管后自动刷新页面（首次注册不触发，避免多余加载）
 *   3. 页面空闲后触发 SW 预热，把编辑器产物提前拉进缓存 —— 这是「打开编辑器更快」的关键
 *   4. 暴露 window.NeoWarpPWA.reset()，供「清除缓存并重试」按钮调用
 *
 * 兼容根域名与子路径部署：SW 地址由本脚本自身的 URL 推导，而不是写死 '/sw.js'。
 */
(function () {
  'use strict';

  var SW_URL = (function () {
    try {
      var src = document.currentScript && document.currentScript.src;
      if (src) return new URL('sw.js', src).href;
    } catch (err) {
      // ignore
    }
    return 'sw.js';
  })();

  var supported = 'serviceWorker' in navigator;
  var hadController = supported && !!navigator.serviceWorker.controller;
  var reloading = false;
  var hoverBound = false;

  function reloadOnce () {
    if (reloading) return;
    reloading = true;
    location.reload();
  }

  function clearAllCaches () {
    if (!('caches' in window)) return Promise.resolve();
    return caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return caches.delete(key);
      }));
    }).catch(function () {});
  }

  function sendToSW (message) {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function (registration) {
      var sw = registration.active;
      if (sw && sw.postMessage) sw.postMessage(message);
    }).catch(function () {});
  }

  /** 浏览器空闲时预热；不支持 requestIdleCallback 的环境退化到 setTimeout */
  function whenIdle (callback, timeout) {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(callback, {timeout: timeout || 2000});
    } else {
      setTimeout(callback, 1200);
    }
  }

  window.NeoWarpPWA = {
    // 「加载有问题？点此清除缓存并重试」
    reset: function () {
      var reload = function () {
        if (reloading) return;
        reloading = true;
        try {
          var search = location.search.replace(/[?&]nocache=[\d.]+(?=$|&)/, '');
          location.replace(location.pathname + search + (search ? '&' : '?') + 'nocache=' + Date.now());
        } catch (err) {
          location.reload();
        }
      };

      if (!supported) {
        clearAllCaches().then(reload);
        return;
      }
      setTimeout(reload, 5000); // 兜底：注销迟迟不返回也要刷新
      navigator.serviceWorker.getRegistration().then(function (registration) {
        return registration && registration.unregister();
      }).then(clearAllCaches).then(reload).catch(reload);
    },

    /** 手动触发一次预热（例如用户停留在主页超过几秒时提前准备编辑器） */
    warmup: function () {
      sendToSW('warmup');
    },

    /** 预热编辑器主包（体积较大，只在空闲或用户表现出意图时调用） */
    warmupEditor: function () {
      sendToSW('warmup:heavy');
    }
  };

  if (!supported) return;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register(SW_URL).then(function () {
      // 注册完成后趁早预热，用户点开子页面时直接命中缓存
      whenIdle(function () {
        sendToSW('warmup');
      }, 1500);
      // 编辑器主包体积大，稍后再预热，避免与首屏渲染抢带宽
      whenIdle(function () {
        sendToSW('warmup:heavy');
      }, 8000);
    }).catch(function (err) {
      console.warn('[NeoWarp] Service Worker 注册失败：', err);
    });
  });

  // 用户把指针移到入口按钮上时，视为「即将打开」，立刻开始拉编辑器
  window.addEventListener('pointerover', function (event) {
    if (hoverBound) return;
    var target = event.target;
    while (target && target !== document.body) {
      var id = target.id || '';
      if (id === 'btn-new-scratch' || id === 'btn-open-file' || id === 'btn-recent') {
        hoverBound = true;
        sendToSW('warmup:heavy');
        return;
      }
      target = target.parentElement;
    }
  }, true);

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!hadController) {
      hadController = true;
      return;
    }
    reloadOnce();
  });
})();

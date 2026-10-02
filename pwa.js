/* NeoWarp 网页版 PWA 引导脚本
 *
 * 职责：
 *   1. 注册根作用域的 Service Worker（sw.js）
 *   2. 新版本接管后自动刷新页面（首次注册不触发，避免多余加载）
 *   3. 暴露 window.NeoWarpPWA.reset()，供“清除缓存并重试”按钮调用
 *
 * 兼容根域名（e.np.sy1.top）与子路径（如 /NeoWarp/）部署：
 * SW 地址由本脚本自身的 URL 推导，而不是写死 '/sw.js'。
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

  window.NeoWarpPWA = {
    // “加载有问题？点此清除缓存并重试”
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
    }
  };

  if (!supported) return;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register(SW_URL).catch(function (err) {
      console.warn('[NeoWarp] Service Worker 注册失败：', err);
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!hadController) {
      hadController = true;
      return;
    }
    reloadOnce();
  });
})();

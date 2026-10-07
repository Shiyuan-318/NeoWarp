/* ==========================================================================
 * NeoWarp 网页版 — 桌面设置 DesktopSettingsPreload 浏览器实现
 * 桌面版 init 是同步 IPC（sendSync），网页版同步返回本地数据，
 * 其余 setter 写入浏览器存储并广播给其它窗口。
 * ========================================================================== */
(function (global) {
  'use strict';

  var NW = global.NW || (global.NW = {});
  var util = NW.util;
  var storage = NW.storage;
  var rpc = NW.rpc;

  var STRINGS = global.NW_DESKTOP_SETTINGS_STRINGS || {};
  var VERSION = global.NW_VERSION || '2.0.0';

  /* HomePreload 读取的品牌键名，与主页保持一致 */
  var BRAND_KEYS = {
    logo: 'neowarp:homeLogo',
    logoText: 'neowarp:homeLogoText',
    background: 'neowarp:homeBackground'
  };

  function getBranding () {
    return {
      homeLogo: util.readLocal(BRAND_KEYS.logo, ''),
      homeLogoText: util.readLocal(BRAND_KEYS.logoText, ''),
      homeBackground: util.readLocal(BRAND_KEYS.background, '')
    };
  }

  function setBrandingValue (key, value) {
    if (value === null || value === undefined || value === '') {
      util.writeLocal(key, null);
    } else {
      util.writeLocal(key, value);
    }
    util.broadcast('branding', getBranding());
  }

  function collectSettings () {
    var stored = storage.getSettings();
    var branding = getBranding();
    return {
      // 网页版没有安装包更新通道，但保留手动检查入口
      updateCheckerAllowed: true,
      updateChecker: stored.updateChecker,
      uiTheme: stored.uiTheme,
      microphone: stored.microphone,
      camera: stored.camera,
      hardwareAcceleration: true,
      backgroundThrottling: true,
      bypassCORS: stored.bypassCORS,
      spellchecker: stored.spellchecker,
      exitFullscreenOnEscape: stored.exitFullscreenOnEscape,
      richPresenceAvailable: false,
      richPresence: stored.richPresence,
      codeAreaBackgroundImage: util.readLocal('neowarp:codeBg', null),
      stageAreaBackgroundImage: util.readLocal('neowarp:stageBg', null),
      topBarDeviceStats: stored.topBarDeviceStats,
      homeLogo: branding.homeLogo,
      homeLogoText: branding.homeLogoText,
      homeBackground: branding.homeBackground,
      showRecentProjects: stored.showRecentProjects
    };
  }

  function compareVersions (a, b) {
    var left = String(a || '').replace(/^v/, '').split('.');
    var right = String(b || '').replace(/^v/, '').split('.');
    for (var i = 0; i < Math.max(left.length, right.length); i++) {
      var x = parseInt(left[i], 10) || 0;
      var y = parseInt(right[i], 10) || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  function checkUpdatesViaGitHub () {
    var url = 'https://api.github.com/repos/Shiyuan-318/NeoWarp/releases/latest';
    return fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (release) {
        var latest = release.tag_name || release.name || '';
        return {
          error: null,
          hasUpdate: compareVersions(latest, VERSION) > 0,
          latestVersion: latest,
          releaseUrl: release.html_url || 'https://github.com/Shiyuan-318/NeoWarp/releases/latest'
        };
      });
  }

  global.DesktopSettingsPreload = {
    init: function () {
      var locale = util.resolveLocale();
      var strings = STRINGS[locale] || STRINGS[locale.split('-')[0]] || STRINGS.zh || STRINGS.en || {};
      return {
        locale: locale,
        strings: strings,
        version: VERSION,
        settings: collectSettings()
      };
    },

    getTheme: function () { return Promise.resolve(util.resolveTheme()); },
    onThemeChanged: function (callback) { rpc.on('desktop', 'theme', callback); },

    /* ------------------------------ 常规设置 ------------------------------ */
    setUITheme: function (uiTheme) {
      storage.setSetting('uiTheme', uiTheme);
      // 与 Scratch 的主题偏好打通，让编辑器立即跟随
      if (uiTheme === 'light' || uiTheme === 'dark') {
        util.writeLocal('tw:theme', uiTheme);
      } else {
        util.writeLocal('tw:theme', 'system');
      }
      NW.applyThemeToDocument(util.resolveTheme());
      if (NW.host) NW.host.notifyAppearanceChanged();
      util.broadcast('theme', { theme: util.resolveTheme() });
      return Promise.resolve(null);
    },

    setUpdateChecker: function (value) { storage.setSetting('updateChecker', value); return Promise.resolve(null); },

    checkForUpdates: function () {
      return checkUpdatesViaGitHub().catch(function (error) {
        return { error: (error && error.message) || String(error) };
      });
    },

    enumerateMediaDevices: function () {
      if (!global.navigator.mediaDevices || !global.navigator.mediaDevices.enumerateDevices) {
        return Promise.resolve([]);
      }
      return global.navigator.mediaDevices.enumerateDevices().then(function (devices) {
        return devices.map(function (device) {
          return { deviceId: device.deviceId, kind: device.kind, label: device.label };
        });
      }).catch(function () { return []; });
    },

    setMicrophone: function (value) { storage.setSetting('microphone', value); return Promise.resolve(null); },
    setCamera: function (value) { storage.setSetting('camera', value); return Promise.resolve(null); },
    setHardwareAcceleration: function () { return Promise.resolve(null); },
    setBackgroundThrottling: function () { return Promise.resolve(null); },
    setBypassCORS: function (value) { storage.setSetting('bypassCORS', value); return Promise.resolve(null); },
    setSpellchecker: function (value) { storage.setSetting('spellchecker', value); return Promise.resolve(null); },
    setExitFullscreenOnEscape: function (value) { storage.setSetting('exitFullscreenOnEscape', value); return Promise.resolve(null); },
    setRichPresence: function (value) { storage.setSetting('richPresence', value); return Promise.resolve(null); },
    setTopBarDeviceStats: function (value) { storage.setSetting('topBarDeviceStats', value); return Promise.resolve(null); },
    setShowRecentProjects: function (value) { storage.setSetting('showRecentProjects', value); return Promise.resolve(null); },

    openUserData: function () {
      util.toast('网页版数据保存在浏览器本地存储中');
      return Promise.resolve(null);
    },

    /* --------------------------- 背景图与品牌 --------------------------- */
    setCodeAreaBackgroundImage: function (imageData) {
      util.writeLocal('neowarp:codeBg', imageData || null);
      return Promise.resolve(null);
    },
    setStageAreaBackgroundImage: function (imageData) {
      util.writeLocal('neowarp:stageBg', imageData || null);
      return Promise.resolve(null);
    },
    setHomeLogo: function (imageData) {
      setBrandingValue(BRAND_KEYS.logo, imageData);
      return Promise.resolve(null);
    },
    setHomeLogoText: function (value) {
      setBrandingValue(BRAND_KEYS.logoText, value);
      return Promise.resolve(null);
    },
    setHomeBackground: function (imageData) {
      setBrandingValue(BRAND_KEYS.background, imageData);
      return Promise.resolve(null);
    },
    resetHomeBranding: function () {
      setBrandingValue(BRAND_KEYS.logo, null);
      setBrandingValue(BRAND_KEYS.logoText, null);
      setBrandingValue(BRAND_KEYS.background, null);
      return Promise.resolve(null);
    },
    getDefaultLogo: function () { return Promise.resolve(null); },

    /* ----------------------------- AI 模型配置 ----------------------------- */
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
    }
  };
})(window);

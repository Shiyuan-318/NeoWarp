const fsPromises = require('fs/promises');
const path = require('path')
const AbstractWindow = require('./abstract');
const settings = require('../settings');
const askForMediaAccess = require('../media-permissions');
const SecurityPromptWindow = require('./security-prompt');

const listLocalFiles = async () => {
  const files = await fsPromises.readdir(path.join(__dirname, '../../dist-library-files/'));
  return files.map(filename => filename.replace('.br', ''));
};

let cached = null;
const listLocalFilesCached = () => {
  if (!cached) {
    cached = listLocalFiles()
      .catch((error) => {
        console.error(error);
        return [];
      });
  }
  return cached;
};

/**
 * @param {string} url
 * @returns {string|null} eg. "https:" or null if invalid URL
 */
const getProtocol = url => {
  try {
    return new URL(url).protocol;
  } catch (e) {
    return null;
  }
};

const WEB_PROTOCOLS = ['http:', 'https:'];

// 只有这几类响应会被页面脚本真正读取，也只有它们需要放宽 CORS；
// 文档 / 图片 / 脚本加上 ACAO 没有任何用处，只会扩大暴露面。
const READABLE_RESOURCE_TYPES = new Set(['xhr', 'fetch', 'other']);

class ProjectRunningWindow extends AbstractWindow {
  handlePermissionCheck (permission, details) {
    return (
      // Autoplay audio and media device enumeration
      permission === 'media' ||

      // Entering fullscreen with enhanced fullscreen addon
      permission === 'window-placement' ||

      // Notifications extension
      // Actually displaying notifications also requires handlePermissionRequest check
      permission === 'notifications' ||

      // Custom fonts menu
      permission === 'local-fonts'
    );
  }

  async handlePermissionRequest (permission, details) {
    // Attempting to record video or audio
    if (permission === 'media') {
      // mediaTypes is not guaranteed to exist
      const mediaTypes = details.mediaTypes || [];
      for (const mediaType of mediaTypes) {
        const hasPermission = await askForMediaAccess(this.window, mediaType);
        if (!hasPermission) {
          return false;
        }
      }
      return true;
    }

    // Clipboard extension
    if (permission === 'clipboard-read') {
      return SecurityPromptWindow.requestReadClipboard(this.window);
    }

    // Notifications extension
    if (permission === 'notifications') {
      return SecurityPromptWindow.requestNotifications(this.window);
    }

    return (
      // Enhanced fullscreen addon
      permission === 'fullscreen' ||

      // Pointerlock extension and experiment
      permission === 'pointerLock' ||

      // Clipboard extension
      // Writing is safer than reading
      permission === 'clipboard-sanitized-write' ||

      // Wake Lock extension
      permission === 'screen-wake-lock' ||

      // Backpack, restore points want persistent storage
      permission === 'persistent-storage'
    );
  }

  onBeforeRequest (details, callback) {
    if (details.resourceType === 'cspReport' || details.resourceType === 'ping') {
      return callback({
        cancel: true
      });
    }

    const parsed = new URL(details.url);

    if (parsed.origin === 'https://cdn.assets.scratch.mit.edu' || parsed.origin === 'https://assets.scratch.mit.edu') {
      const match = parsed.href.match(/[0-9a-f]{32}\.\w{3}/i);
      if (match) {
        const md5ext = match[0];
        return listLocalFilesCached().then((localLibraryFiles) => {
          if (localLibraryFiles.includes(md5ext)) {
            return callback({
              redirectURL: `tw-library://./${md5ext}`
            });
          }
          callback({});
        });
      }
    }

    if (parsed.origin === 'https://extensions.turbowarp.org') {
      return callback({
        // pathname always has a leading / already
        redirectURL: `tw-extensions://.${parsed.pathname}`
      });
    }

    super.onBeforeRequest(details, callback);
  }

  onBeforeSendHeaders (details, callback) {
    const parsed = new URL(details.url);

    if (WEB_PROTOCOLS.includes(parsed.protocol)) {
      // bypassCORS 打开后，项目的扩展脚本能读取任意网站的跨域响应。若请求本身
      // 带着用户在该站点的登录态 Cookie，这条通路就变成了"读走用户私有数据"；
      // 记下这类请求，下面 onHeadersReceived 不给它们放宽 CORS。
      // （扩展用自己申请的 API Key 走的 Authorization 仍然可用，不受影响。）
      if (settings.bypassCORS && this.hasCookieHeader(details.requestHeaders)) {
        this.trackCredentialedRequest(details.id);
      }

      // Some third-party APIs (eg. YouTube embeds) require a non-empty referer header.
      // The website being contacted already receives "neowarp/x.y.z" in the user-agent so this isn't
      // revealing any metadata that they couldn't already have access to.
      return callback({
        requestHeaders: {
          ...details.requestHeaders,
          referer: 'https://desktop.turbowarp.org/referer.html'
        }
      });
    }

    callback({});
  }

  /** @returns {Set<number>} 本次窗口生命周期内带 Cookie 的请求 id */
  get credentialedRequestIds () {
    if (!this._credentialedRequestIds) {
      this._credentialedRequestIds = new Set();
    }
    return this._credentialedRequestIds;
  }

  /**
   * 请求头里是否带 Cookie（大小写不敏感）。
   * @param {Record<string, string|string[]>|undefined} requestHeaders
   * @returns {boolean}
   */
  hasCookieHeader (requestHeaders) {
    if (!requestHeaders) return false;
    return Object.keys(requestHeaders).some((key) => key.toLowerCase() === 'cookie');
  }

  /**
   * 记录一个带凭据的请求 id 供 onHeadersReceived 判定。用有界集合避免
   * 请求失败（不会走到 onHeadersReceived）时无限增长。
   * @param {number} id
   */
  trackCredentialedRequest (id) {
    if (this.credentialedRequestIds.size > 500) {
      this.credentialedRequestIds.clear();
    }
    this.credentialedRequestIds.add(id);
  }

  /**
   * 发起方是 http(s) 页面时回写它的具体源，避免 `*` 把响应开放给任意来源。
   * 发起方是自有协议（tw-editor:// 等）或拿不到来源时返回 null。
   * @param {Electron.OnHeadersReceivedListenerDetails} details
   * @returns {string|null}
   */
  getRequestOrigin (details) {
    try {
      const initiator = details.initiator || '';
      if (!initiator) return null;
      const parsed = new URL(initiator);
      return WEB_PROTOCOLS.includes(parsed.protocol) ? parsed.origin : null;
    } catch (e) {
      return null;
    }
  }

  onHeadersReceived (details, callback) {
    // 带 Cookie 的请求不放宽 CORS：项目/扩展脚本不该借用户登录态读取私有数据
    const carriedCredentials = this.credentialedRequestIds.delete(details.id);

    if (
      settings.bypassCORS &&
      !carriedCredentials &&
      // Don't give extra powers when fetching our custom protocols
      WEB_PROTOCOLS.includes(getProtocol(details.url))
    ) {
      const newHeaders = {};

      const isMainFrame = details.frame === this.window.webContents.mainFrame;
      // 只对脚本可读取的资源类型注入 CORS 头
      const isReadableResource = READABLE_RESOURCE_TYPES.has(details.resourceType);
      const origin = isMainFrame && isReadableResource ? this.getRequestOrigin(details) : null;
      if (isMainFrame && isReadableResource) {
        newHeaders['access-control-allow-origin'] = origin || '*';
        if (origin) {
          newHeaders.vary = 'origin';
        }
      }

      for (const [key, headers] of Object.entries(details.responseHeaders)) {
        switch (key.toLowerCase()) {
          case 'access-control-allow-origin':
            if (isMainFrame && isReadableResource) {
              // Above we forced this header to be * (or the caller's origin), so ignore any other value
            } else {
              newHeaders[key] = headers;
            }
            break;

          // Remove x-frame-options so that embedding is allowed
          case 'x-frame-options':
            break;

          // Modify CSP frame-ancestors to allow embedding
          // We modify the report-only header to reduce console spam
          case 'content-security-policy':
          case 'content-security-policy-report-only': {
            // We try to add allowed origins rather than completely remove/replace to reduce possible security impact.
            const extraFrameAncestors = this.protocol ? this.protocol : null;
            if (extraFrameAncestors) {
              // Note that frame-ancestors does not fall back to default-src.
              // Regex based on ABNF from https://www.w3.org/TR/CSP3/#grammardef-serialized-policy
              newHeaders[key] = headers.map(csp => (
                csp.replace(
                  /((?:;[\x09\x0A\x0C\x0D\x20]*)?frame-ancestors[\x09\x0A\x0C\x0D\x20]+)([^;,]+)/ig,
                  (_, directiveName, directiveValue) => `${directiveName}${directiveValue} ${extraFrameAncestors}`
                )
              ));
            }
            break;  
          }

          default:
            newHeaders[key] = headers;
            break;
        }
      }

      return callback({
        responseHeaders: newHeaders
      });
    }

    super.onHeadersReceived(details, callback);
  }

  handleWindowOpen (details) {
    const parsed = new URL(details.url);
    if (parsed.protocol === 'data:') {
      // Imported lazily due to circular dependencies
      const DataPreviewWindow = require('./data-preview');
      DataPreviewWindow.open(this.window, details.url);

      return {
        action: 'deny'
      };
    }

    return super.handleWindowOpen(details);
  }
}

module.exports = ProjectRunningWindow;

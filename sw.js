/**
 * NeoWarp Web Service Worker
 * 目标：让二次打开几乎瞬时完成，同时保证资源更新能被感知。
 *  - 应用外壳（主页 + 运行时）预缓存
 *  - 体积较大的编辑器构建产物：缓存优先 + 后台刷新
 *  - 可被 build.mjs 替换 2.0.0，版本变化时自动清理旧缓存
 */
const VERSION = '2.0.0';
const CACHE_NAME = 'neowarp-web-' + VERSION;

/* 首屏必需的最小集合 */
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './logo.png',
  './assets/nw-core.js',
  './assets/shims/home.js',
  './pwa.js'
];

/* 编辑器与常用子页面：安装后在后台预热，用户点开时直接命中缓存 */
const WARMUP = [
  './gui/gui.html',
  './assets/vendor/mqtt.min.js',
  './assets/vendor/qrcode.min.js',
  './assets/shims/editor.js',
  './assets/shims/ai-assistant.js',
  './assets/shims/desktop-settings.js',
  './assets/shims/image-editor.js',
  './assets/shims/extension-editor.js',
  './assets/shims/ai-panel.js',
  './assets/shims/misc.js',
  './ai/ai-assistant.html',
  './ai/remote-bridge.js',
  './remote/index.html',
  './mobile-preview/mobile-preview.html',
  './desktop-settings/desktop-settings.html',
  './image-editor/index.html',
  './extension-editor/extension-editor.html',
  './extension-editor/extension-editor.js',
  './extension-editor/extension-editor.css',
  './extension-editor/ai-shared.js',
  './extension-editor/ai-panel.html',
  './extension-editor/ai-panel.js',
  './task-manager/task-manager.html',
  './todo-list/todo-list.html',
  './project-analysis/project-analysis.html',
  './project-analysis/html2canvas.min.js',
  './about/about.html',
  './privacy/privacy.html',
  './contact/contact.html'
];

/* 重型资源：编辑器主包。体积大，只在页面空闲后再预热，避免和首屏抢带宽 */
const WARMUP_HEAVY = [
  './gui/index.js'
];

const toAbsolute = (relative) => new URL(relative, self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL.map(toAbsolute)).catch((error) => {
      console.warn('[SW] 预缓存失败', error);
    });
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => {
      if (name !== CACHE_NAME && name.startsWith('neowarp-web-')) {
        return caches.delete(name);
      }
      return null;
    }));
    await self.clients.claim();
    warmup();
  })());
});

/** 空闲时预热常用资源，避免首次打开子窗口时的白屏等待 */
async function warmup (includeHeavy) {
  const cache = await caches.open(CACHE_NAME);
  const list = includeHeavy ? WARMUP.concat(WARMUP_HEAVY) : WARMUP;
  for (const url of list) {
    try {
      const absolute = toAbsolute(url);
      const cached = await cache.match(absolute, {ignoreSearch: true});
      if (cached) continue;
      const response = await fetch(absolute, {credentials: 'same-origin'});
      if (response && response.ok) await cache.put(absolute, response.clone());
    } catch (error) {
      // 预热失败不影响功能，下次会重试
    }
  }
}

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
  if (event.data === 'warmup') warmup(false);
  if (event.data === 'warmup:heavy') warmup(true);
});

async function cacheFirst (request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, {ignoreSearch: true});
  if (cached) {
    // 后台静默更新
    fetch(request).then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
    }).catch(() => {});
    return cached;
  }
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst (request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, {ignoreSearch: true});
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate (request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, {ignoreSearch: true});
  const network = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 带 Live Server 之类查询串的请求统一忽略查询串
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  const path = url.pathname;

  // 编辑器构建产物体积大且带内容哈希，永久复用
  if (path.includes('/gui/') || path.includes('/addons/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (path.startsWith(self.location.pathname.replace(/sw\.js$/, ''))) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

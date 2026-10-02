/* NeoWarp 部署 Service Worker
 *
 * 设计参考 remixwarp.pages.dev 的部署方式：
 *   - script / style / image / font ：缓存优先（cache-first）
 *   - HTML、导航、/api/、.sb3      ：网络优先（network-first）
 *   - 其余请求                     ：stale-while-revalidate
 *   - 只接管同源 http(s) 的 GET 请求
 *
 * 缓存纪元 CACHE_EPOCH：
 *   该常量会参与所有缓存条目的 key 计算（见 cacheKey）。
 *   构建产物变化时只需更换此常量（由 scripts/bump-version.mjs 自动维护），
 *   即可让全部旧缓存整体失效，无需改动任何文件名。
 */

const CACHE_EPOCH = 'e2';

const PRECACHE = 'neowarp-precache-' + CACHE_EPOCH;
const RUNTIME = 'neowarp-runtime-' + CACHE_EPOCH;

const PRECACHE_URLS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'logo.png'
];

// 把 epoch 混入缓存 key：请求 URL 本身不变，但换纪元后必然缓存未命中。
function cacheKey (request) {
  const url = new URL(request.url);
  url.searchParams.set('nw_v', CACHE_EPOCH);
  return url.href;
}

async function cacheFirst (event, cacheName) {
  const cache = await caches.open(cacheName);
  const key = cacheKey(event.request);
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = await fetch(event.request);
  if (response && response.status === 200) {
    event.waitUntil(cache.put(key, response.clone()));
  }
  return response;
}

async function networkFirst (event, cacheName) {
  const cache = await caches.open(cacheName);
  const key = cacheKey(event.request);
  try {
    const response = await fetch(event.request);
    if (response && response.status === 200) {
      event.waitUntil(cache.put(key, response.clone()));
    }
    return response;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate (event, cacheName) {
  const cache = await caches.open(cacheName);
  const key = cacheKey(event.request);
  const hit = await cache.match(key);
  const network = fetch(event.request).then((response) => {
    if (response && response.status === 200) {
      event.waitUntil(cache.put(key, response.clone()));
    }
    return response;
  }).catch(() => hit);
  return hit || network;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) =>
      Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting()).catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== PRECACHE && key !== RUNTIME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.origin !== self.location.origin) return;

  const destination = request.destination;
  const isDocument = request.mode === 'navigate' || destination === 'document';
  const isApi = url.pathname.includes('/api/') ||
    url.pathname.endsWith('.sb3') ||
    url.pathname.endsWith('.sb2');

  if (isDocument || isApi) {
    event.respondWith(networkFirst(event, RUNTIME));
  } else if (destination === 'script' || destination === 'style' ||
             destination === 'image' || destination === 'font') {
    event.respondWith(cacheFirst(event, RUNTIME));
  } else {
    event.respondWith(staleWhileRevalidate(event, RUNTIME));
  }
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    );
  }
});

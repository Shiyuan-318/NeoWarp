const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const fsPromises = require('fs/promises');

// 手机预览：在局域网上开一个只读的 HTTP 服务，把当前项目导出成 sb3 发给手机，
// 手机端用 scaffolding（TurboWarp 的独立运行时）自己跑一份，不与编辑器内的舞台联动。

const PLAYER_HTML = path.resolve(__dirname, '../src-renderer/mobile-preview/player.html');
const SCAFFOLDING_JS = path.resolve(
  __dirname,
  '../node_modules/@turbowarp/scaffolding/dist/scaffolding-with-music.js'
);

const DEFAULT_PORT = 8601;
const MAX_PORT_ATTEMPTS = 20;

/**
 * 局域网 IPv4 地址。优先返回常见的私有网段，避免选到虚拟网卡的地址。
 * @returns {string[]}
 */
const getLocalIPv4Addresses = () => {
  const preferred = [];
  const others = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      // 虚拟机 / 容器网卡通常不是用户手机所在的网段
      if (/^(?:VMware|VirtualBox|Hyper-V|vEthernet|docker|br-|veth)/i.test(name)) {
        others.push(iface.address);
      } else if (/^(?:192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(iface.address)) {
        preferred.push(iface.address);
      } else {
        others.push(iface.address);
      }
    }
  }
  return [...preferred, ...others];
};

class MobilePreviewServer {
  /**
   * @param {object} options
   * @param {() => Promise<{name: string; data: ArrayBuffer}>} options.getProject
   * @param {() => string} [options.getTitle]
   */
  constructor ({getProject, getTitle}) {
    this.getProject = getProject;
    this.getTitle = getTitle || (() => '');
    this.server = null;
    this.port = null;
    this.addresses = [];
    /** @type {Buffer | null} */
    this.scaffoldingCache = null;
    /** @type {Buffer | null} */
    this.scaffoldingGzipCache = null;
    this.projectTitle = '';
    /**
     * 导出项目会让编辑器渲染进程把整个项目序列化成 ArrayBuffer。
     * 手机端刷新或并发连接可能同时发起多个 /project.sb3 请求，导致渲染进程
     * 同时序列化多份大项目、内存峰值叠加（严重时会 OOM 崩溃）。
     * 这里用互斥锁串行化，同一时刻只允许一个导出在飞。
     * @type {Promise<{name: string; data: ArrayBuffer}> | null}
     */
    this.exportInFlight = null;
  }

  getURL () {
    if (!this.port) return null;
    const host = this.addresses[0] || '127.0.0.1';
    return `http://${host}:${this.port}/`;
  }

  getAllURLs () {
    if (!this.port) return [];
    return this.addresses.map(address => `http://${address}:${this.port}/`);
  }

  async start (preferredPort) {
    if (this.server) {
      return {success: true, port: this.port, url: this.getURL()};
    }

    this.addresses = getLocalIPv4Addresses();

    const server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        console.error('[mobile-preview]', error);
        if (!res.headersSent) {
          res.writeHead(500, {'Content-Type': 'text/plain; charset=utf-8'});
        }
        res.end('内部错误');
      });
    });
    // 手机端只是短连接取一次项目，保持连接没有意义，且会拖慢关闭服务
    server.keepAliveTimeout = 5000;

    const basePort = Number(preferredPort) || DEFAULT_PORT;
    for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
      const port = basePort + attempt;
      const result = await new Promise((resolve) => {
        const onError = (err) => {
          server.removeListener('listening', onListening);
          resolve({success: false, error: err});
        };
        const onListening = () => {
          server.removeListener('error', onError);
          resolve({success: true});
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '0.0.0.0');
      });

      if (result.success) {
        this.server = server;
        this.port = port;
        return {success: true, port, url: this.getURL()};
      }
      if (result.error.code !== 'EADDRINUSE') {
        return {success: false, error: result.error.message};
      }
    }

    return {success: false, error: '找不到可用的端口，请关闭占用端口的程序后重试'};
  }

  /**
   * 串行化项目导出：同一时刻只允许一个导出在飞，后续并发请求复用同一个
   * 在途的 Promise。避免手机端刷新 / 并发连接触发多次完整序列化叠加内存峰值。
   * @returns {Promise<{name: string; data: ArrayBuffer}>}
   */
  exportProjectOnce () {
    if (this.exportInFlight) {
      return this.exportInFlight;
    }
    const promise = Promise.resolve()
      .then(() => this.getProject())
      .finally(() => {
        this.exportInFlight = null;
      });
    this.exportInFlight = promise;
    return promise;
  }

  async stop () {
    const server = this.server;
    this.server = null;
    this.port = null;
    if (!server) return;
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
      setTimeout(resolve, 1000);
    });
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  async handleRequest (req, res) {
    // 只读服务：除了取页面和项目之外什么都不做
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end('不支持的请求方法');
      return;
    }

    let pathname = '/';
    try {
      pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
    } catch (e) {
      pathname = '/';
    }

    if (pathname === '/' || pathname === '/index.html') {
      const html = await fsPromises.readFile(PLAYER_HTML);
      this.sendBuffer(req, res, html, 'text/html; charset=utf-8', {compress: true, cache: false});
      return;
    }

    if (pathname === '/scaffolding.js') {
      if (!this.scaffoldingCache) {
        this.scaffoldingCache = await fsPromises.readFile(SCAFFOLDING_JS);
      }
      this.sendBuffer(req, res, this.scaffoldingCache, 'text/javascript; charset=utf-8', {
        compress: true,
        cache: true,
        gzipCacheKey: 'scaffolding'
      });
      return;
    }

    if (pathname === '/project.sb3') {
      const project = await this.exportProjectOnce();
      this.projectTitle = project.name || this.projectTitle;
      const buffer = Buffer.from(project.data);
      // sb3 本身就是 zip，再压一次只是浪费 CPU
      this.sendBuffer(req, res, buffer, 'application/octet-stream', {compress: false, cache: false});
      return;
    }

    if (pathname === '/api/info') {
      const body = Buffer.from(JSON.stringify({
        title: this.getTitle() || this.projectTitle || '未命名项目'
      }), 'utf8');
      this.sendBuffer(req, res, body, 'application/json; charset=utf-8', {compress: false, cache: false});
      return;
    }

    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('未找到');
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @param {Buffer} buffer
   * @param {string} contentType
   */
  sendBuffer (req, res, buffer, contentType, {compress, cache, gzipCacheKey} = {}) {
    const headers = {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff'
    };
    headers['Cache-Control'] = cache ? 'public, max-age=3600' : 'no-store';

    let body = buffer;
    const acceptEncoding = String(req.headers['accept-encoding'] || '');
    if (compress && buffer.length > 1024 && /\bgzip\b/.test(acceptEncoding)) {
      if (gzipCacheKey === 'scaffolding' && this.scaffoldingGzipCache) {
        body = this.scaffoldingGzipCache;
      } else {
        body = zlib.gzipSync(buffer, {level: 6});
        if (gzipCacheKey === 'scaffolding') {
          this.scaffoldingGzipCache = body;
        }
      }
      headers['Content-Encoding'] = 'gzip';
    }

    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
    } else {
      res.end(body);
    }
  }
}

module.exports = MobilePreviewServer;
module.exports.getLocalIPv4Addresses = getLocalIPv4Addresses;

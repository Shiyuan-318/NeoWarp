const http = require('http');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

/**
 * 手机编程（Phone Sync）服务
 *
 * 手机扫码后拿到的不是另写一份简化页，而是桌面 AI 窗口那份 ai-assistant.html
 * 本体——同一套 DOM、同一套 CSS、同一套渲染函数，因此两端观感完全一致。
 * 差异只由注入的 remote-bridge.js 抹平：它顶起 preload 替身、接 SSE、把操作
 * 回投桌面。
 *
 * 桌面是唯一的事实源：模型调用、工具执行、会话存储都只发生在桌面；手机端只
 * 负责显示状态和发起操作。
 *
 * - GET  /?token=...            手机端页面（桌面 HTML + 注入桥接）
 * - GET  /<asset>?token=...     页面静态资源（脚本 / 样式 / 图片）
 * - GET  /api/state?token=...   当前完整快照
 * - GET  /api/events?token=...  SSE 事件流（history / stream / toast / bye）
 * - POST /api/cmd?token=...     手机发起的操作，交由桌面执行
 *
 * 所有路由都要求 token（启动时随机生成），避免局域网内陌生设备控制桌面。
 */

const RENDERER_DIR = path.resolve(__dirname, '../src-renderer/ai-assistant');
const PAGE_FILE = path.join(RENDERER_DIR, 'ai-assistant.html');

const STATIC_TYPES = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

const MOBILE_VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1, ' +
  'maximum-scale=1, user-scalable=no, viewport-fit=cover">\n' +
  '    <meta name="mobile-web-app-capable" content="yes">\n' +
  '    <meta name="apple-mobile-web-app-capable" content="yes">\n' +
  '    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">';

/** @returns {string[]} 局域网 IPv4 地址（私网段优先） */
const getLanAddresses = () => {
  const result = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const ip = iface.address;
      if (/^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
        result.unshift(ip); // 私网段优先
      } else {
        result.push(ip);
      }
    }
  }
  return result;
};

/** 内联进 <script> 的 JSON 需要转义 `</script>` 与行分隔符 */
const inlineJson = value => JSON.stringify(value === undefined ? null : value)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

class PhoneSyncServer {
  constructor () {
    this.server = null;
    this.port = 0;
    this.token = crypto.randomBytes(16).toString('hex');
    this.clients = new Set(); // SSE 响应对象
    this.aiWindow = null;
    this.ipcMain = null;
    this.readyPromise = null;
  }

  /**
   * @param {AIAssistantWindow} aiWindow 桌面 AI 窗口（用于拉取状态/下发操作）
   * @param {Electron.IpcMain} ipcMain
   */
  register (aiWindow, ipcMain) {
    this.ipcMain = ipcMain;
    // AI 窗口可以关掉再开，每次都是新的 BrowserWindow，所以按窗口重新挂钩子
    if (this.aiWindow === aiWindow) return;
    this.aiWindow = aiWindow;

    aiWindow.window.on('closed', () => {
      if (this.aiWindow !== aiWindow) return;
      this.broadcast({kind: 'bye'});
      for (const client of this.clients) {
        try { client.end(); } catch (e) { void e; }
      }
      this.clients.clear();
      this.aiWindow = null;
      if (this.server) {
        this.server.close();
        this.server = null;
        this.readyPromise = null;
      }
    });
  }

  ensureServer () {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch(err => {
        try {
          res.writeHead(500, {'Content-Type': 'text/plain; charset=utf-8'});
          res.end('Internal error');
        } catch (e) { void e; }
        console.error('[phone-sync] request failed:', err && err.message);
      });
    });
    this.server.on('error', err => {
      console.error('[phone-sync] server error:', err.message);
      this.server = null;
      this.readyPromise = null;
    });
    // 随机端口，避免与其他服务冲突；listen 是异步的，记录就绪 Promise
    this.readyPromise = new Promise((resolve, reject) => {
      this.server.once('listening', resolve);
      this.server.once('error', reject);
    });
    this.server.listen(0, '0.0.0.0');
  }

  async getLinkInfo () {
    this.ensureServer();
    await this.readyPromise;
    const address = this.server.address();
    this.port = address ? address.port : 0;
    const urls = getLanAddresses().map(ip => `http://${ip}:${this.port}/?token=${this.token}`);
    return {
      ok: true,
      port: this.port,
      token: this.token,
      urls,
      clients: this.clients.size
    };
  }

  /** 桌面窗口的 webContents，窗口已销毁时返回 null */
  getWindow () {
    if (!this.aiWindow || !this.aiWindow.window || this.aiWindow.window.isDestroyed()) return null;
    return this.aiWindow.window;
  }

  async getSnapshot () {
    const win = this.getWindow();
    if (!win) return null;
    try {
      return await win.webContents.executeJavaScript(
        'window.__phoneGetSyncState ? window.__phoneGetSyncState() : null', true);
    } catch (e) {
      return null;
    }
  }

  /** 把手机发起的操作交给桌面页面执行 */
  async runCommand (body) {
    const win = this.getWindow();
    if (!win) return {ok: false, error: '电脑端 AI 窗口已关闭'};
    const payload = inlineJson(body);
    try {
      const result = await win.webContents.executeJavaScript(
        `window.__phoneRemoteCommand ? window.__phoneRemoteCommand(${payload}) : {ok:false,error:'unsupported'}`,
        true
      );
      return result || {ok: true};
    } catch (e) {
      return {ok: false, error: String((e && e.message) || e)};
    }
  }

  /**
   * 令牌校验：页面请求带 ?token=，页面内部发出的子请求（脚本/图片/SSE/命令）
   * 只带 Cookie——它们是相对 URL，没法逐个塞查询串。
   */
  checkToken (url, req) {
    if (url.searchParams.get('token') === this.token) return true;
    const cookie = (req && req.headers.cookie) || '';
    return cookie.split(';').some(part => part.trim() === `nw_token=${this.token}`);
  }

  /** 桌面 HTML + 注入远程桥接与首屏快照 */
  buildPage (snapshot) {
    let html = fs.readFileSync(PAGE_FILE, 'utf8');
    html = html.replace(
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      MOBILE_VIEWPORT
    );
    const inject = '<script>' +
      `window.__NEOWARP_REMOTE_TOKEN__=${inlineJson(this.token)};` +
      `window.__NEOWARP_REMOTE_BOOT__=${inlineJson(snapshot || {})};` +
      '</script>\n' +
      '    <script src="./remote-bridge.js"></script>\n    ';
    const anchor = '<script src="./qrcode.min.js"></script>';
    if (html.indexOf(anchor) >= 0) {
      html = html.replace(anchor, inject + anchor);
    } else {
      html = html.replace('</head>', inject + '</head>');
    }
    return html;
  }

  serveStatic (pathname, res) {
    const name = path.basename(decodeURIComponent(pathname));
    const ext = path.extname(name).toLowerCase();
    const type = STATIC_TYPES[ext];
    const file = path.join(RENDERER_DIR, name);
    // 只允许目录内的白名单类型，杜绝路径穿越
    if (!type || path.dirname(file) !== RENDERER_DIR || !fs.existsSync(file)) {
      res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end('Not found');
      return;
    }
    res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-cache'});
    fs.createReadStream(file).pipe(res);
  }

  async handle (req, res) {
    const requestUrl = new URL(req.url, `http://127.0.0.1:${this.port || 80}`);
    if (!this.checkToken(requestUrl, req)) {
      res.writeHead(403, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end('Forbidden');
      return;
    }
    const {pathname} = requestUrl;

    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const snapshot = await this.getSnapshot();
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // 页面内的相对请求（脚本/图片/SSE/命令）带不上查询串，靠 Cookie 续签令牌
        'Set-Cookie': `nw_token=${this.token}; Path=/; SameSite=Strict`
      });
      res.end(this.buildPage(snapshot));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      const snap = await this.getSnapshot();
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify(snap || {messages: [], loading: false, theme: 'light'}));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write('retry: 2500\n\n');
      this.clients.add(res);
      this.notifyClients();

      const snapshot = await this.getSnapshot();
      if (snapshot) {
        res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
      }

      const keepAlive = setInterval(() => {
        try { res.write(': ping\n\n'); } catch (e) { void e; }
      }, 20000);
      req.on('close', () => {
        clearInterval(keepAlive);
        this.clients.delete(res);
        this.notifyClients();
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/cmd') {
      let body = '';
      let aborted = false;
      req.on('data', chunk => {
        if (aborted) return;
        body += chunk;
        // 应用工程 JSON 也走这条通道，上限放宽到 8MB
        if (body.length > 8 * 1024 * 1024) {
          aborted = true;
          req.destroy();
        }
      });
      req.on('end', async () => {
        let result;
        try {
          result = await this.runCommand(JSON.parse(body));
        } catch (e) {
          result = {ok: false, error: String((e && e.message) || e)};
        }
        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify(result));
      });
      return;
    }

    if (req.method === 'GET') {
      this.serveStatic(pathname, res);
      return;
    }

    res.writeHead(404, {'Content-Type': 'application/json; charset=utf-8'});
    res.end('{}');
  }

  broadcast (payload) {
    if (!payload || !this.clients.size) return;
    const frame = `event: ${payload.kind}\ndata: ${JSON.stringify(payload.data || {})}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(frame);
      } catch (e) {
        this.clients.delete(client);
      }
    }
  }

  notifyClients () {
    const win = this.getWindow();
    if (!win) return;
    try {
      win.webContents.send('ai-phone-clients', {count: this.clients.size});
    } catch (e) { void e; }
  }
}

module.exports = new PhoneSyncServer();

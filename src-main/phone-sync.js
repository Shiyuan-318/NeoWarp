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
 * 凭据与命令通道的安全模型：
 * - 二维码 URL 只带"配对码"（pair）：短时效、每次打开弹窗重新生成，且只用于
 *   GET /?pair=... 一次性兑换会话 Cookie，随后 303 跳回干净地址。于是泄露到
 *   浏览器历史 / 代理日志 / 截图里的只是一枚很快失效的凭据，而不是长期会话
 *   令牌。
 * - 会话令牌只经 Set-Cookie 下发（HttpOnly + SameSite=Strict），绝不出现在
 *   URL 或页面内联脚本里。页面所有子请求（脚本/图片/SSE/命令）都是同源相对
 *   地址，浏览器自动携带 Cookie；HttpOnly 让页面脚本自己也拿不到令牌。
 * - 手机命令在主进程先过白名单规整（sanitizeCommand），只有已知 cmd 名与已知
 *   形状的字段才会交给 executeJavaScript。"令牌持有者 = 桌面远程执行权"这道
 *   题因此收敛为"令牌持有者 = 一组受控操作"：纵使页面处理函数有疏漏，能到达
 *   它的也不是任意 JSON。
 *
 * - GET  /?pair=...            配对：兑换会话 Cookie 并跳回 /
 * - GET  /                     手机端页面（桌面 HTML + 注入桥接）
 * - GET  /<asset>              页面静态资源（脚本 / 样式 / 图片）
 * - GET  /api/state            当前完整快照
 * - GET  /api/events           SSE 事件流（history / stream / toast / bye）
 * - POST /api/cmd              手机发起的操作，交由桌面执行
 *
 * 所有路由只服务局域网对端（应用层校验来源 IP），并要求会话 Cookie，
 * 避免局域网内陌生设备控制桌面。
 */

const RENDERER_DIR = path.resolve(__dirname, '../src-renderer/ai-assistant');
const PAGE_FILE = path.join(RENDERER_DIR, 'ai-assistant.html');

const COOKIE_NAME = 'nw_token';
/** 配对码有效期：扫码窗口内有效，过期后重新打开弹窗即可换新码 */
const PAIR_TTL_MS = 10 * 60 * 1000;
/** 命令通道限流：每来源 IP 每 10 秒最多 60 条（正常手机操作远够用） */
const CMD_RATE_LIMIT = {max: 60, windowMs: 10 * 1000};
/** 鉴权失败限流：压制对配对码/会话令牌的枚举尝试与扫描噪音 */
const AUTH_RATE_LIMIT = {max: 30, windowMs: 10 * 1000};

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

/** @returns {string[]} 可扫码的局域网 IPv4（只列私网段：RFC1918 / CGNAT） */
const getLanAddresses = () => {
  const result = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const ip = iface.address;
      // 只广播私网段：公网地址上的对端会被 isLanPeer 拒绝，列出来只会给出死链接
      if (isLanIp(ip)) result.push(ip);
    }
  }
  return result;
};

/** 私网网段：回环 / RFC1918 / CGNAT(100.64/10) / 链路本地 */
const LAN_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^169\.254\./
];

const isLanIp = ip => LAN_PATTERNS.some(re => re.test(ip));

/**
 * 来源对端是否允许访问。0.0.0.0 绑定是为了让任意一块网卡都能收码，
 * 代价是公网地址也可能被扫到——所以在应用层把非私网对端拒之门外。
 */
const isLanPeer = address => {
  if (!address) return false;
  // 0.0.0.0 绑定下 Node 给出的对端一般是 IPv4 或 ::ffff: 映射形式
  const ip = address.startsWith('::ffff:') ? address.slice(7) : address;
  return ip === '::1' || isLanIp(ip);
};

/** 内联进 <script> 的 JSON 需要转义 `</script>` 与行分隔符 */
const inlineJson = value => JSON.stringify(value === undefined ? null : value)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

/** 常数时间比较：先哈希抹平长度差异，避免时序/长度侧信道 */
const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

/** 统一安全响应头：nosniff 防 MIME 嗅探，no-store 防中间层留缓存 */
const baseHeaders = type => ({
  'Content-Type': type,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store'
});

/** CSRF 纵深：浏览器才会带 Origin，若带了就必须同源 */
const isSameOrigin = (origin, req) => {
  try {
    return new URL(origin).host === req.headers.host;
  } catch (e) {
    return false;
  }
};

/** 手机命令白名单：页面端 handlePhoneCommand 认识的 cmd 全集 */
const KNOWN_COMMANDS = new Set([
  'send', 'abort', 'newChat', 'selectChat', 'deleteChat', 'undoChanges',
  'clearChat', 'selectModel', 'setThinking', 'answerQuestion', 'applyProject', 'ping'
]);

const COMMAND_LIMITS = {
  text: 256 * 1024, // send 正文：允许贴大段代码
  images: 8,
  imageBytes: 6 * 1024 * 1024,
  id: 128,
  answer: 4096,
  level: 32,
  projectJSON: 8 * 1024 * 1024 // 与 /api/cmd 请求体上限一致
};

/**
 * 校验并规整手机命令：只保留白名单字段，剔除其余一切。
 * 返回 null 表示拒绝——主进程不会把任何未经规整的内容送进 executeJavaScript。
 */
const sanitizeCommand = body => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const cmd = typeof body.cmd === 'string' ? body.cmd : '';
  if (!KNOWN_COMMANDS.has(cmd)) return null;
  const out = {cmd};
  if (cmd === 'send') {
    const text = typeof body.text === 'string' ? body.text : '';
    if (text.length > COMMAND_LIMITS.text) return null;
    if (text) out.text = text;
    if (Array.isArray(body.images)) {
      if (body.images.length > COMMAND_LIMITS.images) return null;
      const images = body.images.filter(item =>
        typeof item === 'string' &&
        item.startsWith('data:image/') &&
        item.length <= COMMAND_LIMITS.imageBytes
      );
      if (images.length) out.images = images;
    }
  } else if (cmd === 'selectChat' || cmd === 'deleteChat') {
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id || id.length > COMMAND_LIMITS.id) return null;
    out.id = id;
  } else if (cmd === 'selectModel') {
    const index = Number(body.index);
    if (!Number.isInteger(index) || index < 0 || index > 999) return null;
    out.index = index;
  } else if (cmd === 'setThinking') {
    const level = typeof body.level === 'string' ? body.level : '';
    if (!level || level.length > COMMAND_LIMITS.level) return null;
    out.level = level;
  } else if (cmd === 'answerQuestion') {
    const answer = typeof body.answer === 'string' ? body.answer : '';
    if (!answer || answer.length > COMMAND_LIMITS.answer) return null;
    out.answer = answer;
    if (body.isCustom === true) out.isCustom = true;
  } else if (cmd === 'applyProject') {
    const projectJSON = typeof body.projectJSON === 'string' ? body.projectJSON : '';
    if (!projectJSON || projectJSON.length > COMMAND_LIMITS.projectJSON) return null;
    out.projectJSON = projectJSON;
  }
  // abort / newChat / undoChanges / clearChat / ping 无参数
  return out;
};

/** 固定窗口限流：每来源 IP 一个计数器，窗口过期即重置 */
const rateLimitHit = (store, key, max, windowMs) => {
  const now = Date.now();
  if (store.size > 512) {
    for (const [k, entry] of store) {
      if (now - entry.start >= windowMs) store.delete(k);
    }
  }
  const entry = store.get(key);
  if (!entry || now - entry.start >= windowMs) {
    store.set(key, {start: now, count: 1});
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
};

class PhoneSyncServer {
  constructor () {
    this.server = null;
    this.port = 0;
    this.token = crypto.randomBytes(32).toString('hex'); // 只走 Cookie，从不进 URL
    this.pairCode = null; // 二维码里的短时效配对码
    this.pairExpiresAt = 0;
    this.clients = new Set(); // SSE 响应对象
    this.aiWindow = null;
    this.ipcMain = null;
    this.readyPromise = null;
    this.cmdHits = new Map(); // 命令通道限流计数
    this.authHits = new Map(); // 鉴权失败限流计数
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
      // 服务随窗口一起销毁：配对码与会话令牌全部作废
      this.pairCode = null;
      this.pairExpiresAt = 0;
    });
  }

  ensureServer () {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch(err => {
        try {
          res.writeHead(500, baseHeaders('text/plain; charset=utf-8'));
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
    // 随机端口，避免与其他服务冲突；listen 是异步的，记录就绪 Promise。
    // 绑定 0.0.0.0 是因为机器可能有多块网卡，手机连哪个都该能通；
    // "不对外暴露"由 handle() 里的 isLanPeer 在应用层兜底。
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
    // 每次打开弹窗都换新配对码：旧码立即作废，泄露面收敛到"此刻屏幕上这一个"
    this.pairCode = crypto.randomBytes(24).toString('base64url');
    this.pairExpiresAt = Date.now() + PAIR_TTL_MS;
    const urls = getLanAddresses().map(ip => `http://${ip}:${this.port}/?pair=${this.pairCode}`);
    return {
      ok: true,
      port: this.port,
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

  /**
   * 把手机发起的操作交给桌面页面执行。
   * executeJavaScript 是触达页面逻辑的唯一通道，注入本身无法避免；
   * 能做的是把送进去的内容收敛为白名单规整后的字段——payload 由主进程
   * 构造，而不是用户 JSON 的原样回放。
   */
  async runCommand (body) {
    const cmd = sanitizeCommand(body);
    if (!cmd) return {ok: false, error: '不支持的操作'};
    const win = this.getWindow();
    if (!win) return {ok: false, error: '电脑端 AI 窗口已关闭'};
    const payload = inlineJson(cmd);
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

  sessionCookie () {
    // 会话 Cookie：不设 Max-Age（随手机浏览器会话失效，掉线重新扫码即可）。
    // HttpOnly 让页面脚本拿不到令牌；SameSite=Strict 挡住跨站请求。
    // 明文 HTTP 是局域网场景的既定前提，Secure 加了反而连不上。
    return `${COOKIE_NAME}=${this.token}; Path=/; HttpOnly; SameSite=Strict`;
  }

  /**
   * 令牌校验：只认 Cookie，不接受任何查询串凭据——URL 会进浏览器历史、
   * 代理日志、Referer，从来就不该当凭据的载体。
   */
  checkToken (req) {
    const header = (req && req.headers.cookie) || '';
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      const name = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (name === COOKIE_NAME && safeEqual(value, this.token)) return true;
    }
    return false;
  }

  /** 配对码校验：存在、未过期、常数时间比对 */
  checkPairCode (code) {
    if (!this.pairCode || Date.now() > this.pairExpiresAt) return false;
    return safeEqual(code, this.pairCode);
  }

  /** 桌面 HTML + 注入远程桥接与首屏快照 */
  buildPage (snapshot) {
    let html = fs.readFileSync(PAGE_FILE, 'utf8');
    html = html.replace(
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      MOBILE_VIEWPORT
    );
    // 空数据 URI 占位：浏览器不会再请求 /favicon.ico，避免控制台出现 404 噪音。
    // 只内联首屏快照（认证后用户自己的数据）；令牌不再内联——页面子请求
    // 靠 Cookie 鉴权，页面脚本不需要也不该拿到它。
    const inject = '<link rel="icon" href="data:,">' +
      '<script>' +
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
    let name = '';
    try {
      name = path.basename(decodeURIComponent(pathname));
    } catch (e) { void e; }
    const ext = path.extname(name).toLowerCase();
    const type = STATIC_TYPES[ext];
    const file = path.join(RENDERER_DIR, name);
    // 只允许目录内的白名单类型，杜绝路径穿越
    if (!type || path.dirname(file) !== RENDERER_DIR || !fs.existsSync(file)) {
      res.writeHead(404, baseHeaders('text/plain; charset=utf-8'));
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(file).pipe(res);
  }

  async handle (req, res) {
    // 局域网守卫：先于一切鉴权，非私网对端直接拒绝
    if (!isLanPeer(req.socket && req.socket.remoteAddress)) {
      res.writeHead(403, baseHeaders('text/plain; charset=utf-8'));
      res.end('Forbidden');
      return;
    }
    const requestUrl = new URL(req.url, `http://127.0.0.1:${this.port || 80}`);
    const {pathname} = requestUrl;
    const peer = (req.socket && req.socket.remoteAddress) || 'unknown';

    // 配对：扫码 URL 里的 pair 只在此处兑换会话 Cookie，随后跳回干净地址，
    // 让配对码不留在地址栏。配对码不作为 API 凭据，其余路由一律不认它。
    if (req.method === 'GET' &&
        (pathname === '/' || pathname === '/index.html') &&
        requestUrl.searchParams.has('pair')) {
      const code = requestUrl.searchParams.get('pair') || '';
      if (!this.checkPairCode(code)) {
        rateLimitHit(this.authHits, peer, AUTH_RATE_LIMIT.max, AUTH_RATE_LIMIT.windowMs);
        res.writeHead(403, baseHeaders('text/plain; charset=utf-8'));
        res.end('配对码无效或已过期，请在电脑端重新打开"手机编程"二维码。');
        return;
      }
      res.writeHead(303, {
        ...baseHeaders('text/plain; charset=utf-8'),
        Location: '/',
        'Set-Cookie': this.sessionCookie(),
        'Referrer-Policy': 'no-referrer'
      });
      res.end();
      return;
    }

    // 会话鉴权：只认 HttpOnly Cookie
    if (!this.checkToken(req)) {
      if (!rateLimitHit(this.authHits, peer, AUTH_RATE_LIMIT.max, AUTH_RATE_LIMIT.windowMs)) {
        res.writeHead(429, baseHeaders('text/plain; charset=utf-8'));
        res.end('Too Many Requests');
        return;
      }
      res.writeHead(403, baseHeaders('text/plain; charset=utf-8'));
      res.end('Forbidden');
      return;
    }

    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const snapshot = await this.getSnapshot();
      res.writeHead(200, {
        ...baseHeaders('text/html; charset=utf-8'),
        // 每次进页面都续签会话 Cookie，手机端所有子请求靠它过鉴权
        'Set-Cookie': this.sessionCookie(),
        'Referrer-Policy': 'no-referrer'
      });
      res.end(this.buildPage(snapshot));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      const snap = await this.getSnapshot();
      res.writeHead(200, baseHeaders('application/json; charset=utf-8'));
      res.end(JSON.stringify(snap || {messages: [], loading: false, theme: 'light'}));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff'
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
      // CSRF 纵深：SameSite=Strict 之外，再拒绝跨源 POST（只有浏览器会带 Origin）
      const origin = req.headers.origin;
      if (origin && !isSameOrigin(origin, req)) {
        res.writeHead(403, baseHeaders('application/json; charset=utf-8'));
        res.end(JSON.stringify({ok: false, error: 'cross-origin request rejected'}));
        return;
      }
      if (!rateLimitHit(this.cmdHits, peer, CMD_RATE_LIMIT.max, CMD_RATE_LIMIT.windowMs)) {
        res.writeHead(429, baseHeaders('application/json; charset=utf-8'));
        res.end(JSON.stringify({ok: false, error: '请求过于频繁，请稍后再试'}));
        return;
      }
      let body = '';
      let aborted = false;
      req.on('data', chunk => {
        if (aborted) return;
        body += chunk;
        // 应用工程 JSON 也走这条通道，上限放宽到 8MB
        if (body.length > COMMAND_LIMITS.projectJSON) {
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
        res.writeHead(200, baseHeaders('application/json; charset=utf-8'));
        res.end(JSON.stringify(result));
      });
      return;
    }

    if (req.method === 'GET') {
      this.serveStatic(pathname, res);
      return;
    }

    res.writeHead(404, baseHeaders('application/json; charset=utf-8'));
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

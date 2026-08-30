const http = require('http');
const crypto = require('crypto');
const os = require('os');

/**
 * 手机编程（Phone Sync）服务：
 * 在局域网内起一个 HTTP 服务，手机扫码/访问链接后打开一个与桌面端 AI 界面
 * 同观感的聊天页；桌面与手机之间通过 SSE（桌面→手机）与 POST（手机→桌面）双向同步。
 *
 * - GET  /?token=...            手机端页面
 * - GET  /api/state?token=...   当前会话快照（标题/消息/加载状态/主题）
 * - GET  /api/events?token=...  SSE 事件流（history / stream / clients / bye）
 * - POST /api/send?token=...    手机发来的用户消息，转发给桌面 AI 窗口
 *
 * 所有路由都要求 token（启动时随机生成），避免局域网内陌生设备控制桌面。
 */

const MOBILE_PAGE_TEMPLATE = (token) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<title>NeoWarp AI</title>
<style>
:root {
  --bg: #f2f2f7; --surface: #ffffff; --surface-tertiary: #e5e5ea;
  --text: #1c1c1e; --text-secondary: #6b7280; --text-tertiary: #9ca3af;
  --border: #e5e5ea; --accent: #007aff; --user-bubble: #007aff; --user-text: #fff;
  --ai-bubble: #f2f2f7; --ai-text: #1c1c1e; --skill-bg: #ecfdf5; --skill-border: #34d399; --skill-text: #065f46;
}
html.dark {
  --bg: #000; --surface: #1c1c1e; --surface-tertiary: #3a3a3c;
  --text: #f2f2f7; --text-secondary: #aeaeb2; --text-tertiary: #8e8e93;
  --border: #38383a; --accent: #0a84ff; --user-bubble: #0a84ff; --user-text: #fff;
  --ai-bubble: #2c2c2e; --ai-text: #f2f2f7; --skill-bg: #0f2417; --skill-border: #10b981; --skill-text: #6ee7b7;
}
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { height: 100%; }
body {
  background: var(--bg); color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  display: flex; flex-direction: column; overflow: hidden;
}
.top {
  flex-shrink: 0; padding: 12px 16px 10px; display: flex; align-items: center; gap: 10px;
  border-bottom: 0.5px solid var(--border); background: var(--bg);
  padding-top: max(12px, env(safe-area-inset-top));
}
.top-title { font-weight: 700; font-size: 16px; letter-spacing: -0.3px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #34c759; flex-shrink: 0; transition: background .3s; }
.dot.off { background: #ff3b30; }
.chat { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 14px 14px 8px; display: flex; flex-direction: column; }
.msg { display: flex; margin-bottom: 10px; flex-shrink: 0; }
.msg.user { justify-content: flex-end; }
.msg.ai { justify-content: flex-start; }
.bubble {
  max-width: 84%; padding: 10px 14px; border-radius: 18px; font-size: 15px; line-height: 1.6;
  word-break: break-word; position: relative; letter-spacing: -0.1px;
}
.msg.user .bubble { background: var(--user-bubble); color: var(--user-text); border-bottom-right-radius: 6px; }
.msg.ai .bubble { background: var(--ai-bubble); color: var(--ai-text); border-bottom-left-radius: 6px; }
.bubble .time { font-size: 10px; opacity: .6; margin-top: 4px; text-align: right; }
.bubble code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .9em; background: rgba(120,120,128,.16); padding: 1px 5px; border-radius: 4px; }
.bubble pre { background: rgba(0,0,0,.82); color: #f5f5f7; border-radius: 10px; padding: 10px 12px; overflow-x: auto; margin: 6px 0; }
.bubble pre code { background: transparent; padding: 0; color: inherit; }
.bubble strong { font-weight: 700; }
.msg.ai .bubble .time { text-align: left; }
.reasoning { border: 1px solid rgba(245,158,11,.5); background: rgba(245,158,11,.08); border-radius: 10px; margin-bottom: 6px; font-size: 12px; }
.reasoning summary { padding: 6px 10px; cursor: pointer; color: #b45309; font-weight: 600; list-style: none; }
.reasoning summary::before { content: '▸ '; }
.reasoning[open] summary::before { content: '▾ '; }
.reasoning .rc { padding: 0 10px 8px; white-space: pre-wrap; color: var(--text-secondary); }
.skill {
  max-width: 88%; background: var(--skill-bg); border: 1px solid var(--skill-border); border-radius: 12px;
  padding: 8px 12px; margin: 0 0 8px; font-size: 12.5px; color: var(--skill-text); flex-shrink: 0; align-self: flex-start;
}
.skill b { display: block; margin-bottom: 3px; }
.skill .args { font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; opacity: .85; white-space: pre-wrap; word-break: break-all; max-height: 90px; overflow: hidden; }
.skill.fail { border-color: #ef4444; }
.todo { max-width: 92%; background: var(--surface); border: .5px solid var(--border); border-radius: 14px; padding: 12px 14px; margin: 0 0 10px; flex-shrink: 0; font-size: 13px; }
.todo h4 { font-size: 13.5px; margin-bottom: 8px; display: flex; justify-content: space-between; }
.todo h4 .p { color: var(--accent); }
.todo .row { display: flex; align-items: baseline; gap: 8px; padding: 4px 0; color: var(--text-secondary); }
.todo .row .mk { width: 16px; flex-shrink: 0; }
.todo .row.done .mk { color: #34c759; }
.todo .row.done .tx { text-decoration: line-through; color: var(--text-tertiary); }
.todo .row.doing .tx { color: var(--accent); font-weight: 600; }
.typing { display: inline-flex; gap: 4px; padding: 4px 2px; }
.typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--text-tertiary); animation: tb 1.2s infinite; }
.typing span:nth-child(2) { animation-delay: .2s; }
.typing span:nth-child(3) { animation-delay: .4s; }
@keyframes tb { 0%,60%,100% { transform: translateY(0); opacity: .4; } 30% { transform: translateY(-6px); opacity: 1; } }
.cursor::after { content: '▌'; animation: blink 1s infinite; color: var(--accent); }
@keyframes blink { 50% { opacity: 0; } }
.composer {
  flex-shrink: 0; display: flex; gap: 8px; align-items: flex-end;
  padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  border-top: .5px solid var(--border); background: var(--bg);
}
.composer textarea {
  flex: 1; resize: none; border: none; outline: none; background: var(--surface);
  color: var(--text); border-radius: 20px; padding: 11px 16px; font-size: 15px; font-family: inherit;
  max-height: 120px; min-height: 42px; line-height: 1.4; border: .5px solid var(--border);
}
.composer button {
  width: 42px; height: 42px; border-radius: 50%; border: none; background: var(--accent); color: #fff;
  font-size: 18px; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
}
.composer button:disabled { opacity: .4; }
.hint { text-align: center; font-size: 11px; color: var(--text-tertiary); padding: 6px; }
</style>
</head>
<body>
<div class="top">
  <span class="dot off" id="dot"></span>
  <div class="top-title" id="title">NeoWarp AI</div>
</div>
<div class="chat" id="chat"><div class="hint" id="hint">正在连接桌面端…</div></div>
<div class="composer">
  <textarea id="input" rows="1" placeholder="输入消息…"></textarea>
  <button id="send" disabled>↑</button>
</div>
<script>
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var TOKEN = params.get('token') || '';
  var chat = document.getElementById('chat');
  var titleEl = document.getElementById('title');
  var dot = document.getElementById('dot');
  var input = document.getElementById('input');
  var sendBtn = document.getElementById('send');
  var state = { messages: [], loading: false, stream: null, theme: 'light' };
  var todoCard = null;

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function md(t) {
    var h = esc(t || '');
    h = h.replace(/\`\`\`(\\w*)\\n?([\\s\\S]*?)\`\`\`/g, function (_, lang, code) {
      return '<pre><code>' + code.replace(/\\n$/, '') + '</code></pre>';
    });
    h = h.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    h = h.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    return h.replace(/\\n/g, '<br>');
  }
  function bubble(role, html, time) {
    var w = document.createElement('div');
    w.className = 'msg ' + role;
    w.innerHTML = '<div class="bubble">' + html +
      '<div class="time">' + esc(time || '') + '</div></div>';
    chat.appendChild(w);
    return w;
  }
  function scroll() { chat.scrollTop = chat.scrollHeight; }

  function todoCardEl(title, items) {
    var el = document.createElement('div');
    el.className = 'todo';
    el.innerHTML = '<h4><span>' + esc(title || 'Tasks') + '</span><span class="p">0/' + items.length + '</span></h4>' +
      items.map(function (it, i) {
        return '<div class="row" data-i="' + (i + 1) + '"><span class="mk">○</span><span class="tx">' + esc(it) + '</span></div>';
      }).join('');
    el._states = items.map(function () { return 'pending'; });
    return el;
  }
  function todoUpdate(card, idx, status) {
    if (!card || !card._states) return;
    if (idx < 1 || idx > card._states.length) return;
    card._states[idx - 1] = status;
    var row = card.querySelector('.row[data-i="' + idx + '"]');
    if (row) {
      row.classList.remove('done', 'doing');
      if (status === 'done') { row.classList.add('done'); row.querySelector('.mk').textContent = '✓'; }
      else if (status === 'doing') { row.classList.add('doing'); row.querySelector('.mk').textContent = '●'; }
      else { row.querySelector('.mk').textContent = '○'; }
    }
    var done = card._states.filter(function (s) { return s === 'done'; }).length;
    card.querySelector('.p').textContent = done + '/' + card._states.length;
  }

  function render() {
    chat.innerHTML = '';
    todoCard = null;
    titleEl.textContent = state.title || 'NeoWarp AI';
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
    state.messages.forEach(function (m) {
      if (m.role === 'user') {
        var inner = md(m.content);
        if (m.images && m.images.length) {
          m.images.forEach(function (src) { inner += '<img src="' + src + '" style="max-width:100%;border-radius:8px;margin-top:6px;">'; });
        }
        bubble('user', inner, m.time);
      } else if (m.role === 'tool_result') {
        var ok = m.result && m.result.success !== false;
        var box = document.createElement('div');
        box.className = 'skill' + (ok ? '' : ' fail');
        var body = m.result ? esc(JSON.stringify(m.result).slice(0, 220)) : esc(m.error || '');
        box.innerHTML = '<b>' + esc(m.name || 'tool') + '</b><div class="args">' + body + '</div>';
        chat.appendChild(box);
      } else if (m.role === 'tool') {
        /* API 侧记录，跳过 */
      } else {
        if (m.toolCalls && m.toolCalls.length) {
          m.toolCalls.forEach(function (tc) {
            var name = tc.name || '';
            if (name === 'plan todos') {
              todoCard = todoCardEl(tc.args && tc.args.title, (tc.args && tc.args.items) || []);
              chat.appendChild(todoCard);
              return;
            }
            if (name === 'update todo') { todoUpdate(todoCard, parseInt(tc.args && tc.args.index, 10), tc.args && tc.args.status); return; }
            var bx = document.createElement('div');
            bx.className = 'skill';
            bx.innerHTML = '<b>' + esc(name) + '</b><div class="args">' + esc(JSON.stringify(tc.args || {}).slice(0, 200)) + '</div>';
            chat.appendChild(bx);
          });
        }
        var html = '';
        if (m.reasoning) {
          html += '<details class="reasoning"><summary>Reasoning</summary><div class="rc">' + esc(m.reasoning) + '</div></details>';
        }
        html += md(m.content || '');
        bubble('ai', html, m.time);
      }
    });
    renderStream();
    updateComposer();
    scroll();
  }

  var streamEl = null;
  function renderStream() {
    if (streamEl && streamEl.parentNode) { streamEl.parentNode.remove(); streamEl = null; }
    if (!state.loading) return;
    var has = state.stream && (state.stream.content || state.stream.reasoning);
    var w = document.createElement('div');
    w.className = 'msg ai';
    var html = '';
    if (state.stream && state.stream.reasoning) {
      html += '<details class="reasoning" open><summary>Reasoning</summary><div class="rc">' + esc(state.stream.reasoning) + '</div></details>';
    }
    html += has
      ? '<div class="cursor">' + md(state.stream ? state.stream.content : '') + '</div>'
      : '<div class="typing"><span></span><span></span><span></span></div>';
    w.innerHTML = '<div class="bubble">' + html + '</div>';
    chat.appendChild(w);
    streamEl = w;
    scroll();
  }

  function updateComposer() {
    sendBtn.disabled = state.loading;
    input.disabled = false;
  }

  function applySnapshot(snap) {
    if (!snap) return;
    state.messages = snap.messages || [];
    state.loading = !!snap.loading;
    state.theme = snap.theme || 'light';
    state.title = snap.title || '';
    state.stream = snap.stream || null;
    render();
  }

  function connect() {
    var es = new EventSource('/api/events?token=' + encodeURIComponent(TOKEN));
    es.addEventListener('snapshot', function (e) {
      dot.classList.remove('off');
      applySnapshot(JSON.parse(e.data));
    });
    es.addEventListener('history', function (e) {
      dot.classList.remove('off');
      var d = JSON.parse(e.data);
      state.messages = d.messages || [];
      state.loading = !!d.loading;
      state.title = d.title || state.title;
      state.stream = null;
      render();
    });
    es.addEventListener('stream', function (e) {
      dot.classList.remove('off');
      state.stream = JSON.parse(e.data);
      state.loading = true;
      renderStream();
    });
    es.addEventListener('clients', function () { /* 预留 */ });
    es.onerror = function () {
      dot.classList.add('off');
      es.close();
      setTimeout(connect, 2500);
    };
  }

  function send() {
    var text = input.value.trim();
    if (!text || state.loading) return;
    input.value = '';
    input.style.height = 'auto';
    bubble('user', esc(text), '');
    scroll();
    fetch('/api/send?token=' + encodeURIComponent(TOKEN), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) {
        var w = document.createElement('div');
        w.className = 'hint';
        w.textContent = j.error || '发送失败';
        chat.appendChild(w);
        scroll();
      }
    }).catch(function () {
      var w = document.createElement('div');
      w.className = 'hint';
      w.textContent = '网络错误，请重试';
      chat.appendChild(w);
      scroll();
    });
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  fetch('/api/state?token=' + encodeURIComponent(TOKEN))
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('bad token')); })
    .then(function (snap) { document.getElementById('hint').remove(); applySnapshot(snap); })
    .catch(function () {
      document.getElementById('hint').textContent = '连接失败：令牌无效或桌面端已关闭';
    });
  connect();
})();
</script>
</body>
</html>`;
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

class PhoneSyncServer {
  constructor () {
    this.server = null;
    this.port = 0;
    this.token = crypto.randomBytes(16).toString('hex');
    this.clients = new Set(); // SSE 响应对象
    this.aiWindow = null;
    this.ipcMain = null;
    this.registered = false;
  }

  /**
   * @param {AIAssistantWindow} aiWindow 桌面 AI 窗口（用于拉取状态/下发消息）
   * @param {Electron.IpcMain} ipcMain
   */
  register (aiWindow, ipcMain) {
    this.aiWindow = aiWindow;
    this.ipcMain = ipcMain;
    if (this.registered) return;
    this.registered = true;

    ipcMain.on('ai-phone-broadcast', (event, payload) => {
      this.broadcast(payload);
    });

    aiWindow.window.on('closed', () => {
      this.broadcast({kind: 'bye'});
      for (const client of this.clients) {
        try { client.end(); } catch (e) { void e; }
      }
      this.clients.clear();
      if (this.server) {
        this.server.close();
        this.server = null;
      }
    });
  }

  ensureServer () {
    if (this.server) return true;
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.server.on('error', err => {
      console.error('[phone-sync] server error:', err.message);
      this.server = null;
    });
    // 随机端口，避免与其他服务冲突；listen 是异步的，记录就绪 Promise
    this.readyPromise = new Promise((resolve, reject) => {
      this.server.once('listening', resolve);
      this.server.once('error', reject);
    });
    this.server.listen(0, '0.0.0.0');
    return true;
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

  async getSnapshot () {
    const win = this.aiWindow && !this.aiWindow.window.isDestroyed() ? this.aiWindow.window : null;
    if (!win) return null;
    try {
      return await win.webContents.executeJavaScript(
        'window.__phoneGetSyncState ? window.__phoneGetSyncState() : null', true);
    } catch (e) {
      return null;
    }
  }

  checkToken (url) {
    const t = new URL(url, 'http://x').searchParams.get('token');
    return t === this.token;
  }

  async handle (req, res) {
    const requestUrl = new URL(req.url, `http://127.0.0.1:${this.port || 80}`);
    if (!this.checkToken(requestUrl.href)) {
      res.writeHead(403, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end('Forbidden');
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/') {
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      res.end(MOBILE_PAGE_TEMPLATE(this.token));
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/state') {
      const snap = await this.getSnapshot();
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify(snap || {messages: [], loading: false, theme: 'light'}));
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      res.write('retry: 2500' + String.fromCharCode(10,10));
      this.clients.add(res);
      this.notifyClients();

      const snapshot = await this.getSnapshot();
      if (snapshot) {
        res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
      }

      const keepAlive = setInterval(() => {
        try { res.write(': ping\\n\\n'); } catch (e) { void e; }
      }, 20000);
      req.on('close', () => {
        clearInterval(keepAlive);
        this.clients.delete(res);
        this.notifyClients();
      });
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/api/send') {
      let body = '';
      req.on('data', c => {
        body += c;
        if (body.length > 65536) req.destroy();
      });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const text = String(data.text || '').trim();
          if (!text) throw new Error('empty');
          const win = this.aiWindow && !this.aiWindow.window.isDestroyed() ? this.aiWindow.window : null;
          if (!win) throw new Error('desktop unavailable');
          win.webContents.send('ai-phone-remote-message', {text});
          res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({ok: true}));
        } catch (e) {
          res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({ok: false, error: String((e && e.message) || e)}));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('{}');
  }

  broadcast (payload) {
    if (!this.clients.size) return;
    const frame = `event: ${payload.kind}\ndata: ${JSON.stringify(payload.data || {})}\n\n`;
    for (const client of this.clients) {
      try { client.write(frame); } catch (e) {
        this.clients.delete(client);
      }
    }
  }

  notifyClients () {
    try {
      const win = this.aiWindow && !this.aiWindow.window.isDestroyed() ? this.aiWindow.window : null;
      if (win) win.webContents.send('ai-phone-clients', {count: this.clients.size});
    } catch (e) { void e; }
  }
}

module.exports = new PhoneSyncServer();

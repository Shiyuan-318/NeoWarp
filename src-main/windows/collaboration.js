const AbstractWindow = require('./abstract');
const CollaborationServer = require('../collaboration-server');
const {ipcMain} = require('electron');
const os = require('os');
const http = require('http');

// Scan the local /24 subnet for collaboration hosts on the given port.
function discoverSessions (port) {
  return new Promise((resolve) => {
    const interfaces = os.networkInterfaces();
    const localIPs = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIPs.push(iface.address);
        }
      }
    }

    const candidates = new Set();
    for (const ip of localIPs) {
      const parts = ip.split('.');
      if (parts.length === 4) {
        const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
        for (let i = 1; i < 255; i++) {
          candidates.add(`${prefix}.${i}`);
        }
      }
    }
    // Exclude own IPs
    for (const ip of localIPs) candidates.delete(ip);

    const results = [];
    const list = Array.from(candidates);
    if (list.length === 0) { resolve(results); return; }

    let remaining = list.length;
    const finishOne = () => {
      remaining--;
      if (remaining === 0) resolve(results);
    };

    for (const ip of list) {
      let settled = false;
      const req = http.get({
        hostname: ip,
        port: port,
        path: '/discover',
        timeout: 400
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (settled) return;
          settled = true;
          try {
            const parsed = JSON.parse(data);
            if (parsed && parsed.ok) {
              results.push({
                ip: ip,
                port: port,
                roomName: parsed.roomName,
                hostName: parsed.hostName,
                hostAvatar: parsed.hostAvatar,
                onlineCount: parsed.onlineCount
              });
            }
          } catch (e) {
            // not a collaboration server
          }
          finishOne();
        });
      });
      req.on('timeout', () => {
        if (settled) return;
        settled = true;
        try { req.destroy(); } catch (e) {}
        finishOne();
      });
      req.on('error', () => {
        if (settled) return;
        settled = true;
        finishOne();
      });
    }
  });
}

class CollaborationWindow extends AbstractWindow {
  constructor (editorWindow, mode) {
    super();

    this.editorWindow = editorWindow;
    this.mode = mode; // 'host' or 'join'
    // 主页「加入协作」打开的独立窗口：没有关联的编辑器，
    // 连接成功后才创建编辑器（见 attachDeferredEditor）
    this.standalone = !editorWindow && mode === 'join';
    // 编辑器渲染层就绪前，发往编辑器的 IPC 先排队（见 sendToEditor）
    this.editorReady = true;
    this.pendingEditorMessages = [];
    this.server = null;
    this.ws = null;
    this.joinUsername = null;
    this.joinPermissions = null;
    this.hostNickname = '主机';
    this.hostAvatar = '🏠';
    this.forceClose = false;
    this.pingInterval = null;
    this.lastPongTime = 0;

    this.window.on('page-title-updated', event => {
      event.preventDefault();
    });
    this.window.setTitle('协作');

    // Intercept close: hide window instead of destroying (collaboration continues)
    this.window.on('close', (event) => {
      if (!this.forceClose) {
        event.preventDefault();
        this.window.hide();
      }
    });

    // Only clean up when window is actually destroyed
    this.window.on('closed', () => {
      this.cleanup();
    });

    // --- IPC handlers ---

    this.ipc.handle('collab-get-mode', () => {
      return this.mode;
    });

    this.ipc.handle('collab-get-theme', () => this.requestEditorTheme());

    this.ipc.handle('collab-get-local-ip', () => {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            return iface.address;
          }
        }
      }
      return '127.0.0.1';
    });

    this.ipc.handle('collab-discover-sessions', async (event, { port }) => {
      try {
        const results = await discoverSessions(port || 8080);
        return { success: true, sessions: results };
      } catch (e) {
        return { success: false, sessions: [], error: e.message };
      }
    });

    this.ipc.handle('collab-start-host', async (event, { password, port, permissions, nickname, avatar }) => {
      this.hostNickname = (nickname && String(nickname).trim()) || '主机';
      this.hostAvatar = (avatar && String(avatar)) || '🏠';
      this.server = new CollaborationServer({
        password,
        port,
        permissions,
        hostName: this.hostNickname,
        hostAvatar: this.hostAvatar
      });

      this.server.onClientJoin = (username, avatar) => {
        const onlineCount = this.server.getTotalOnlineCount();
        this.sendToCollabWindow('collab-client-join', {
          username,
          avatar,
          onlineCount,
          members: this.server.getRoster()
        });
        this.sendToEditor('collaboration-state-changed', {
          isCollaborating: true,
          role: 'host',
          onlineCount,
          permissions: this.server.permissions
        });
      };

      this.server.onClientLeave = (username) => {
        const onlineCount = this.server.getTotalOnlineCount();
        this.sendToCollabWindow('collab-client-leave', {
          username,
          onlineCount,
          members: this.server.getRoster()
        });
        this.sendToEditor('collaboration-state-changed', {
          isCollaborating: true,
          role: 'host',
          onlineCount,
          permissions: this.server.permissions
        });
      };

      this.server.onChatMessage = (message) => {
        this.sendToCollabWindow('collab-chat-message', message);
      };

      // When a new client joins, request current project JSON from editor
      this.server.onProjectRequest = (username) => {
        // Request project JSON from editor renderer
        this.sendToEditor('collab-request-project-json', { targetUsername: username });
      };

      // When a participant sends a project update, forward to editor
      this.server.onProjectUpdate = (data) => {
        this.sendToEditor('collab-project-update', data);
      };

      const result = await this.server.start();
      if (result.success) {
        this.sendToCollabWindow('collab-host-started', {
          success: true,
          onlineCount: 1,
          nickname: this.hostNickname,
          avatar: this.hostAvatar,
          members: this.server.getRoster()
        });
        this.sendToEditor('collaboration-state-changed', {
          isCollaborating: true,
          role: 'host',
          onlineCount: 1,
          permissions: this.server.permissions
        });
      } else {
        this.sendToCollabWindow('collab-host-started', { success: false, error: result.error });
        this.server = null;
      }
      return result;
    });

    this.ipc.handle('collab-end-host', async () => {
      if (this.server) {
        await this.server.end();
        this.server = null;
      }
      this.sendToEditor('collaboration-state-changed', {
        isCollaborating: false,
        role: null,
        onlineCount: 0
      });
      this.forceClose = true;
      if (this.window && !this.window.isDestroyed()) {
        this.window.close();
      }
      return { success: true };
    });

    this.ipc.handle('collab-join-connect', async (event, { ip, port, password, nickname, avatar }) => {
      const WebSocket = globalThis.WebSocket;
      if (!WebSocket) {
        this.sendToCollabWindow('collab-join-connected', { success: false, error: 'WebSocket 不可用' });
        return { success: false, error: 'WebSocket 不可用' };
      }

      this.joinNickname = (nickname && String(nickname).trim()) || '';
      this.joinAvatar = (avatar && String(avatar)) || '👤';

      return new Promise((resolve) => {
        let ws;
        try {
          ws = new WebSocket(`ws://${ip}:${port}`);
        } catch (e) {
          this.sendToCollabWindow('collab-join-connected', { success: false, error: '连接失败' });
          resolve({ success: false, error: '连接失败' });
          return;
        }

        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            try { ws.close(); } catch (e) {}
            this.sendToCollabWindow('collab-join-connected', { success: false, error: '连接超时' });
            resolve({ success: false, error: '连接超时' });
          }
        }, 10000);

        ws.addEventListener('open', () => {
          ws.send(JSON.stringify({
            type: 'auth',
            password,
            nickname: this.joinNickname,
            avatar: this.joinAvatar
          }));
        });

        ws.addEventListener('message', (event) => {
          let message;
          try {
            const data = event.data;
            message = JSON.parse(typeof data === 'string' ? data : data.toString());
          } catch (e) {
            return;
          }

          if (message.type === 'auth-result') {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              if (message.success) {
                this.ws = ws;
                this.joinUsername = message.username;
                this.joinAvatar = message.avatar || this.joinAvatar;
                this.joinPermissions = message.permissions || null;
                // 主页「加入协作」：认证通过后才打开编辑器窗口
                if (this.standalone && !this.editorWindow) {
                  this.attachDeferredEditor();
                }
                this.sendToCollabWindow('collab-join-connected', {
                  success: true,
                  permissions: message.permissions,
                  username: message.username,
                  avatar: this.joinAvatar,
                  onlineCount: message.onlineCount,
                  hostName: message.hostName,
                  hostAvatar: message.hostAvatar,
                  members: message.members
                });
                this.sendToEditor('collaboration-state-changed', {
                  isCollaborating: true,
                  role: 'participant',
                  onlineCount: message.onlineCount,
                  permissions: message.permissions
                });
                this.startJoinHeartbeat();
                // Detect the host going away after the connection was
                // established (crash, network loss, host app killed)
                ws.addEventListener('close', () => {
                  if (this.ws === ws) {
                    this.stopJoinHeartbeat();
                    this.ws = null;
                    this.sendToCollabWindow('collab-collaboration-ended', { reason: 'connection-lost' });
                    this.sendToEditor('collaboration-state-changed', {
                      isCollaborating: false,
                      role: null,
                      onlineCount: 0
                    });
                  }
                });
                resolve({ success: true });
              } else {
                this.sendToCollabWindow('collab-join-connected', {
                  success: false,
                  error: message.error || '认证失败'
                });
                resolve({ success: false, error: message.error });
              }
            }
            return;
          }

          if (message.type === 'chat') {
            this.sendToCollabWindow('collab-chat-message', message);
            return;
          }

          if (message.type === 'project-update') {
            // Forward project data to editor renderer to load into VM
            this.sendToEditor('collab-project-update', { project: message.project, from: message.from });
            return;
          }

          if (message.type === 'pong') {
            this.lastPongTime = Date.now();
            return;
          }

          if (message.type === 'member-joined') {
            this.sendToCollabWindow('collab-member-joined', message);
            this.sendToEditor('collaboration-state-changed', {
              isCollaborating: true,
              role: 'participant',
              onlineCount: message.onlineCount,
              permissions: this.joinPermissions
            });
            return;
          }

          if (message.type === 'member-left') {
            this.sendToCollabWindow('collab-member-left', message);
            this.sendToEditor('collaboration-state-changed', {
              isCollaborating: true,
              role: 'participant',
              onlineCount: message.onlineCount,
              permissions: this.joinPermissions
            });
            return;
          }

          if (message.type === 'collaboration-ended') {
            this.stopJoinHeartbeat();
            this.sendToCollabWindow('collab-collaboration-ended', { reason: message.reason });
            this.sendToEditor('collaboration-state-changed', {
              isCollaborating: false,
              role: null,
              onlineCount: 0
            });
            this.ws = null;
            return;
          }
        });

        ws.addEventListener('close', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            this.sendToCollabWindow('collab-join-connected', { success: false, error: '连接已断开' });
            resolve({ success: false, error: '连接已断开' });
          }
        });

        ws.addEventListener('error', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            this.sendToCollabWindow('collab-join-connected', { success: false, error: '连接失败，请检查 IP 和端口' });
            resolve({ success: false, error: '连接失败' });
          }
        });
      });
    });

    this.ipc.handle('collab-leave', async () => {
      this.stopJoinHeartbeat();
      if (this.ws) {
        try { this.ws.close(); } catch (e) {}
        this.ws = null;
      }
      this.sendToEditor('collaboration-state-changed', {
        isCollaborating: false,
        role: null,
        onlineCount: 0
      });
      this.forceClose = true;
      if (this.window && !this.window.isDestroyed()) {
        this.window.close();
      }
      return { success: true };
    });

    this.ipc.on('collab-send-chat', (event, { text }) => {
      if (this.mode === 'host' && this.server) {
        const timestamp = Date.now();
        const chatData = {
          type: 'chat',
          from: this.hostNickname,
          avatar: this.hostAvatar,
          text: String(text || ''),
          timestamp: timestamp
        };
        // Broadcast to all connected clients (isSelf: false for them)
        this.server.broadcast({ ...chatData, isSelf: false });
        // Show in host's own renderer (isSelf: true)
        this.sendToCollabWindow('collab-chat-message', { ...chatData, isSelf: true });
      } else if (this.mode === 'join' && this.ws) {
        try {
          this.ws.send(JSON.stringify({ type: 'chat', text: String(text || '') }));
        } catch (e) {
          // ignore
        }
      }
    });

    // Host: editor sends project JSON to broadcast to a specific client or all.
    // Registered on the EDITOR window's frame IPC (see EditorWindow) because
    // per-frame IPC only receives messages sent from that same frame.
    this.ipc.handle('collab-close-window', () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.close();
      }
      return { success: true };
    });

    this.loadURL('tw-collaboration://./collaboration.html');
    this.show();
  }

  // Called by EditorWindow when the editor renderer exports project JSON
  handleProjectJSONFromEditor (project, targetUsername) {
    if (this.mode === 'host' && this.server) {
      this.server.broadcastProject(project, targetUsername);
    }
  }

  // Called by EditorWindow when a participant's editor broadcasts its project
  handleProjectUpdateFromEditor (project) {
    if (this.mode === 'join' && this.ws) {
      try {
        this.ws.send(JSON.stringify({ type: 'project-update', project }));
      } catch (e) {
        // ignore
      }
    }
  }

  // Application-level liveness probing for the join connection: sends a ping
  // the server echoes back, so a silently lost network is noticed within ~70s.
  startJoinHeartbeat () {
    this.stopJoinHeartbeat();
    this.lastPongTime = Date.now();
    this.pingInterval = setInterval(() => {
      if (!this.ws) {
        this.stopJoinHeartbeat();
        return;
      }
      if (Date.now() - this.lastPongTime > 70000) {
        // Server stopped answering: force the close path so the UI resets
        try { this.ws.close(); } catch (e) {}
        return;
      }
      try {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      } catch (e) {
        // ignore
      }
    }, 25000);
  }

  stopJoinHeartbeat () {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  cleanup () {
    this.stopJoinHeartbeat();
    if (this.server) {
      this.sendToEditor('collaboration-state-changed', {
        isCollaborating: false,
        role: null,
        onlineCount: 0
      });
      this.server.end().then(() => {
        this.server = null;
      });
    }
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
      this.sendToEditor('collaboration-state-changed', {
        isCollaborating: false,
        role: null,
        onlineCount: 0
      });
    }
  }

  sendToCollabWindow (channel, data) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, data);
    }
  }

  sendToEditor (channel, data) {
    if (!this.editorWindow || !this.editorWindow.window || this.editorWindow.window.isDestroyed()) {
      return;
    }
    if (!this.editorReady) {
      // 编辑器渲染层尚未挂载（React 组件还没注册 IPC 监听），
      // 此时直接 send 会被丢弃；先排队，就绪后按原顺序补发
      this.pendingEditorMessages.push({ channel, data });
      return;
    }
    this.editorWindow.window.webContents.send(channel, data);
  }

  /**
   * 主页「加入协作」：连接成功后创建编辑器窗口并挂到本协作会话上。
   * 编辑器加载完成前收到的项目同步会在 sendToEditor 里排队。
   */
  attachDeferredEditor () {
    // Imported late due to circular dependencies
    const EditorWindow = require('./editor');
    this.editorWindow = new EditorWindow(null, false);
    this.markEditorPending();
  }

  /**
   * 标记关联的编辑器尚未就绪：探测到其渲染层挂载完成后补发排队的消息。
   * 用于刚从主页创建编辑器、马上又打开协作面板的场景。
   */
  markEditorPending () {
    if (!this.editorWindow || !this.editorWindow.window || this.editorWindow.window.isDestroyed()) {
      return;
    }
    this.editorReady = false;
    this.waitEditorReady().then(() => {
      // 探测超时也照常补发：最好情况是编辑器其实早已就绪，
      // 最坏情况与旧行为一致（消息被渲染层丢弃）
      this.editorReady = true;
      this.flushPendingEditorMessages();
    });
  }

  // 通过 request-theme → theme-response 往返判断编辑器 React 组件
  // 是否已挂载（协作的 IPC 监听与主题响应在同一个组件里注册）
  probeEditorReady () {
    return new Promise((resolve) => {
      const editorWindow = this.editorWindow;
      if (!editorWindow || !editorWindow.window || editorWindow.window.isDestroyed()) {
        resolve(false);
        return;
      }
      const requestId = `collab-ready-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const handler = (event, data) => {
        if (data && data.requestId === requestId) {
          ipcMain.removeListener('theme-response', handler);
          clearTimeout(timeout);
          resolve(true);
        }
      };
      const timeout = setTimeout(() => {
        ipcMain.removeListener('theme-response', handler);
        resolve(false);
      }, 1500);
      ipcMain.on('theme-response', handler);
      editorWindow.window.webContents.send('request-theme', {requestId});
    });
  }

  waitEditorReady (maxMs = 30000) {
    return new Promise((resolve) => {
      const deadline = Date.now() + maxMs;
      const attempt = () => {
        if (!this.editorWindow || !this.editorWindow.window || this.editorWindow.window.isDestroyed()) {
          resolve(false);
          return;
        }
        this.probeEditorReady().then((ready) => {
          if (ready || Date.now() >= deadline) {
            resolve(ready);
            return;
          }
          setTimeout(attempt, 400);
        });
      };
      attempt();
    });
  }

  flushPendingEditorMessages () {
    if (!this.pendingEditorMessages.length) {
      return;
    }
    const pending = this.pendingEditorMessages;
    this.pendingEditorMessages = [];
    for (const {channel, data} of pending) {
      if (this.editorWindow && this.editorWindow.window && !this.editorWindow.window.isDestroyed()) {
        this.editorWindow.window.webContents.send(channel, data);
      }
    }
  }

  // Ask the editor renderer which theme it is currently using, so the
  // collaboration window opens in light/dark to match it.
  requestEditorTheme () {
    const editorWindow = this.editorWindow;
    if (!editorWindow || !editorWindow.window || editorWindow.window.isDestroyed()) {
      // 没有关联的编辑器（如主页「加入协作」）：退回全局/系统主题
      const {getEffectiveTheme} = require('../effective-theme');
      return getEffectiveTheme().catch(() => 'light');
    }
    return new Promise((resolve) => {
      const requestId = `collaboration-${Date.now()}`;
      const handler = (event, data) => {
        if (data && data.requestId === requestId) {
          ipcMain.removeListener('theme-response', handler);
          clearTimeout(timeout);
          resolve(data.theme || 'light');
        }
      };
      const timeout = setTimeout(() => {
        ipcMain.removeListener('theme-response', handler);
        resolve('light');
      }, 3000);
      ipcMain.on('theme-response', handler);
      editorWindow.window.webContents.send('request-theme', {requestId});
    });
  }

  getDimensions () {
    return {
      width: 460,
      height: 720
    };
  }

  getPreload () {
    return 'collaboration';
  }

  isPopup () {
    return true;
  }

  getBackgroundColor () {
    return '#f2f2f7';
  }

  static showHost (editorWindow) {
    const existing = AbstractWindow.getWindowsByClass(CollaborationWindow);
    if (existing.length) {
      const win = existing[0];
      // If already hosting, just show the window
      if (win.mode === 'host' && win.server) {
        win.show();
        return win;
      }
      // Otherwise force close and create new
      win.forceClose = true;
      win.window.close();
    }
    return new CollaborationWindow(editorWindow, 'host');
  }

  static showJoin (editorWindow) {
    const existing = AbstractWindow.getWindowsByClass(CollaborationWindow);
    if (existing.length) {
      const win = existing[0];
      // If already joined, just show the window
      if (win.mode === 'join' && win.ws) {
        win.show();
        return win;
      }
      // Otherwise force close and create new
      win.forceClose = true;
      win.window.close();
    }
    return new CollaborationWindow(editorWindow, 'join');
  }

  /**
   * 主页「加入协作」：弹出加入表单（局域网搜索 + 手动填写），
   * 连接成功后才打开编辑器窗口。不关联已有编辑器。
   */
  static showJoinFromHome () {
    const existing = AbstractWindow.getWindowsByClass(CollaborationWindow);
    if (existing.length) {
      const win = existing[0];
      // 已有活跃会话（主持中或已加入）：直接展示，避免误关他人会话
      if (win.ws || win.server) {
        win.show();
        return win;
      }
      // 已有未连接的加入表单窗口：复用
      if (win.mode === 'join') {
        win.show();
        return win;
      }
      // 未连接的发起表单：关掉后换成本次加入
      win.forceClose = true;
      win.window.close();
    }
    return new CollaborationWindow(null, 'join');
  }

  static focusChat (editorWindow) {
    const existing = AbstractWindow.getWindowsByClass(CollaborationWindow);
    if (existing.length) {
      const win = existing[0];
      win.show();
      if (win.window && !win.window.isDestroyed()) {
        win.window.webContents.send('collab-focus-chat');
      }
      return win;
    }
    return null;
  }
}

module.exports = CollaborationWindow;

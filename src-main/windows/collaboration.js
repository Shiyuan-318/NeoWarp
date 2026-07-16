const AbstractWindow = require('./abstract');
const CollaborationServer = require('../collaboration-server');
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
    this.server = null;
    this.ws = null;
    this.joinUsername = null;
    this.hostNickname = '主机';
    this.hostAvatar = '🏠';
    this.forceClose = false;

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
        const onlineCount = this.server.getOnlineCount() + 1; // +1 for host
        this.sendToCollabWindow('collab-client-join', { username, avatar, onlineCount });
        this.sendToEditor('collaboration-state-changed', {
          isCollaborating: true,
          role: 'host',
          onlineCount,
          permissions: this.server.permissions
        });
      };

      this.server.onClientLeave = (username) => {
        const onlineCount = this.server.getOnlineCount() + 1;
        this.sendToCollabWindow('collab-client-leave', { username, onlineCount });
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
          avatar: this.hostAvatar
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
                this.sendToCollabWindow('collab-join-connected', {
                  success: true,
                  permissions: message.permissions,
                  username: message.username,
                  avatar: this.joinAvatar
                });
                this.sendToEditor('collaboration-state-changed', {
                  isCollaborating: true,
                  role: 'participant',
                  onlineCount: 1,
                  permissions: message.permissions
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

          if (message.type === 'collaboration-ended') {
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

    // Host: editor sends project JSON to broadcast to a specific client or all
    this.ipc.on('collab-send-project-json', (event, { project, targetUsername }) => {
      if (this.mode === 'host' && this.server) {
        this.server.broadcastProject(project, targetUsername);
      }
    });

    // Participant: editor sends project update to broadcast to host and others
    this.ipc.on('collab-send-project-update', (event, { project }) => {
      if (this.mode === 'join' && this.ws) {
        try {
          this.ws.send(JSON.stringify({ type: 'project-update', project }));
        } catch (e) {
          // ignore
        }
      }
    });

    this.ipc.handle('collab-close-window', () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.close();
      }
      return { success: true };
    });

    this.loadURL('tw-collaboration://./collaboration.html');
    this.show();
  }

  cleanup () {
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
    if (this.editorWindow && this.editorWindow.window && !this.editorWindow.window.isDestroyed()) {
      this.editorWindow.window.webContents.send(channel, data);
    }
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
    return '#f5f5f7';
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

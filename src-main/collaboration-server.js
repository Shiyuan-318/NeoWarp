const http = require('http');
const crypto = require('crypto');

const MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// WebSocket opcodes
const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xA;

class CollaborationServer {
  constructor ({ password, port, permissions, hostName, hostAvatar, heartbeatIntervalMs, heartbeatTimeoutMs, authTimeoutMs }) {
    this.password = password;
    this.port = port;
    this.permissions = permissions;
    this.hostName = hostName || '主机';
    this.hostAvatar = hostAvatar || '🏠';
    // Heartbeat: the server pings all clients periodically and drops the ones
    // that have not sent anything (incl. pongs) within the timeout window.
    this.heartbeatIntervalMs = heartbeatIntervalMs || 30000;
    this.heartbeatTimeoutMs = heartbeatTimeoutMs || 65000;
    // Unauthenticated sockets are dropped after this long.
    this.authTimeoutMs = authTimeoutMs || 30000;
    // Frames larger than this are treated as hostile and the socket dropped.
    this.maxBufferBytes = 64 * 1024 * 1024;
    this.server = null;
    this.heartbeatTimer = null;
    this.clients = new Map(); // socket -> client info
    this.clientCounter = 0;
    this.onClientJoin = null;
    this.onClientLeave = null;
    this.onChatMessage = null;
    this.onProjectRequest = null;
    this.onProjectUpdate = null;
  }

  // Returns discovery metadata for LAN scanning clients
  getDiscoveryInfo () {
    return {
      ok: true,
      roomName: `${this.hostName} 的协作`,
      hostName: this.hostName,
      hostAvatar: this.hostAvatar,
      onlineCount: this.getTotalOnlineCount(),
      port: this.port
    };
  }

  getOnlineCount () {
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.authenticated) count++;
    }
    return count;
  }

  // Full member list for the collaboration window's roster panel. The host is
  // not a WebSocket client, so it is prepended manually.
  getRoster () {
    const roster = [{
      name: this.hostName,
      avatar: this.hostAvatar,
      role: 'host'
    }];
    for (const client of this.clients.values()) {
      if (!client.authenticated) continue;
      roster.push({
        name: client.username,
        avatar: client.avatar,
        role: 'participant'
      });
    }
    return roster;
  }

  // Total humans in the room: connected clients plus the host.
  getTotalOnlineCount () {
    return this.getOnlineCount() + 1;
  }

  // Host calls this to broadcast project JSON to all clients (or a specific client)
  broadcastProject (projectJson, targetUsername) {
    const data = JSON.stringify({
      type: 'project-update',
      project: projectJson
    });
    for (const client of this.clients.values()) {
      if (!client.authenticated) continue;
      if (targetUsername && client.username !== targetUsername) continue;
      this.sendToClient(client, data);
    }
  }

  start () {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        // Discovery endpoint: GET /discover or ?discover=1
        let pathParts = req.url || '';
        try {
          const parsed = new URL(pathParts, `http://${req.headers.host || 'localhost'}`);
          if (parsed.pathname === '/discover' || parsed.searchParams.get('discover') === '1') {
            const info = this.getDiscoveryInfo();
            res.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify(info));
            return;
          }
        } catch (e) {
          // fall through to plain text
        }
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('NeoWarp Collaboration Server');
      });

      this.server.on('upgrade', (req, socket, head) => {
        this.handleUpgrade(req, socket, head);
      });

      let resolved = false;

      this.server.on('error', (err) => {
        if (resolved) return;
        resolved = true;
        if (err.code === 'EADDRINUSE') {
          resolve({ success: false, error: '端口被占用，请更换端口' });
        } else {
          resolve({ success: false, error: err.message });
        }
      });

      this.server.listen(this.port, () => {
        if (resolved) return;
        resolved = true;
        this.startHeartbeat();
        resolve({ success: true, port: this.port });
      });
    });
  }

  handleUpgrade (req, socket, head) {
    // Only accept WebSocket upgrades on the root path with a version we support
    let pathname = '/';
    try {
      pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
    } catch (e) {
      socket.destroy();
      return;
    }
    if (pathname !== '/' || req.headers['sec-websocket-version'] !== '13') {
      socket.destroy();
      return;
    }

    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const accept = crypto.createHash('sha1').update(key + MAGIC_STRING).digest('base64');

    const responseLines = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      ''
    ];
    socket.write(responseLines.join('\r\n'));

    const clientId = ++this.clientCounter;
    const client = {
      id: clientId,
      socket: socket,
      username: null,
      avatar: null,
      authenticated: false,
      buffer: Buffer.alloc(0),
      closed: false,
      lastSeen: Date.now(),
      authTimeout: null
    };

    client.authTimeout = setTimeout(() => {
      if (!client.authenticated) {
        try { socket.destroy(); } catch (e) {}
      }
    }, this.authTimeoutMs);

    this.clients.set(socket, client);

    socket.on('data', (data) => {
      this.handleData(client, data);
    });

    socket.on('close', () => {
      this.handleClose(client);
    });

    socket.on('error', () => {
      this.handleClose(client);
    });

    if (head && head.length > 0) {
      this.handleData(client, head);
    }
  }

  handleData (client, data) {
    client.lastSeen = Date.now();
    client.buffer = Buffer.concat([client.buffer, data]);
    if (client.buffer.length > this.maxBufferBytes) {
      try { client.socket.destroy(); } catch (e) {}
      return;
    }

    while (client.buffer.length >= 2) {
      const frame = this.parseFrame(client.buffer);
      if (!frame) break; // incomplete frame, wait for more data

      client.buffer = client.buffer.slice(frame.bytesRead);
      this.handleFrame(client, frame);
    }
  }

  parseFrame (buffer) {
    if (buffer.length < 2) return null;

    const b0 = buffer[0];
    const b1 = buffer[1];

    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let payloadLength = b1 & 0x7f;

    let offset = 2;
    let maskKey = null;

    if (payloadLength === 126) {
      if (buffer.length < 4) return null;
      payloadLength = buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (buffer.length < 10) return null;
      const high = buffer.readUInt32BE(2);
      const low = buffer.readUInt32BE(6);
      payloadLength = high * 0x100000000 + low;
      offset = 10;
    }

    if (masked) {
      if (buffer.length < offset + 4) return null;
      maskKey = buffer.slice(offset, offset + 4);
      offset += 4;
    }

    if (buffer.length < offset + payloadLength) return null;

    let payload = buffer.slice(offset, offset + payloadLength);

    if (masked) {
      const unmasked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        unmasked[i] = payload[i] ^ maskKey[i % 4];
      }
      payload = unmasked;
    }

    return {
      fin,
      opcode,
      payload: payload,
      bytesRead: offset + payloadLength
    };
  }

  handleFrame (client, frame) {
    const { opcode, payload } = frame;

    if (opcode === OPCODE_CLOSE) {
      this.handleClose(client);
      return;
    }

    if (opcode === OPCODE_PING) {
      this.sendFrame(client.socket, OPCODE_PONG, payload);
      return;
    }

    if (opcode === OPCODE_PONG) {
      client.lastSeen = Date.now();
      return;
    }

    if (opcode === OPCODE_TEXT) {
      const text = payload.toString('utf8');
      this.handleMessage(client, text);
    }
  }

  handleMessage (client, text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch (e) {
      return;
    }

    // App-level liveness probe from participants (works even when the
    // OS-level connection appears healthy but the peer is unreachable).
    if (message.type === 'ping') {
      client.lastSeen = Date.now();
      this.sendToClient(client, JSON.stringify({
        type: 'pong',
        onlineCount: this.getTotalOnlineCount()
      }));
      return;
    }

    if (message.type === 'auth') {
      // Hash both sides so the comparison is constant-time
      const givenHash = crypto.createHash('sha256').update(String(message.password == null ? '' : message.password)).digest();
      const expectedHash = crypto.createHash('sha256').update(String(this.password == null ? '' : this.password)).digest();
      if (crypto.timingSafeEqual(givenHash, expectedHash)) {
        client.authenticated = true;
        if (client.authTimeout) {
          clearTimeout(client.authTimeout);
          client.authTimeout = null;
        }
        const num = Math.floor(1000 + Math.random() * 9000);
        const requestedName = String(message.nickname || '').trim();
        client.username = this.getUniqueUsername(requestedName || `用户-${num}`);
        client.avatar = String(message.avatar || '').trim() || '👤';

        this.sendToClient(client, JSON.stringify({
          type: 'auth-result',
          success: true,
          permissions: this.permissions,
          username: client.username,
          avatar: client.avatar,
          onlineCount: this.getTotalOnlineCount(),
          hostName: this.hostName,
          hostAvatar: this.hostAvatar,
          members: this.getRoster()
        }));

        // Tell the other clients about the new member
        for (const otherClient of this.clients.values()) {
          if (otherClient === client || !otherClient.authenticated) continue;
          this.sendToClient(otherClient, JSON.stringify({
            type: 'member-joined',
            username: client.username,
            avatar: client.avatar,
            onlineCount: this.getTotalOnlineCount(),
            members: this.getRoster()
          }));
        }

        if (this.onClientJoin) {
          this.onClientJoin(client.username, client.avatar);
        }

        // Request host to send current project state to the new client
        if (this.onProjectRequest) {
          this.onProjectRequest(client.username);
        }
      } else {
        this.sendToClient(client, JSON.stringify({
          type: 'auth-result',
          success: false,
          error: '密码错误',
          permissions: this.permissions,
          username: null
        }));
      }
      return;
    }

    if (!client.authenticated) {
      return;
    }

    if (message.type === 'chat') {
      const timestamp = Date.now();
      const chatData = {
        type: 'chat',
        from: client.username,
        avatar: client.avatar,
        text: String(message.text || ''),
        timestamp: timestamp
      };

      // Send to all OTHER clients with isSelf: false
      for (const otherClient of this.clients.values()) {
        if (otherClient === client) continue;
        if (!otherClient.authenticated) continue;
        this.sendToClient(otherClient, JSON.stringify({
          ...chatData,
          isSelf: false
        }));
      }

      // Send back to sender with isSelf: true
      this.sendToClient(client, JSON.stringify({
        ...chatData,
        isSelf: true
      }));

      // Forward to host window (isSelf: false from host's perspective)
      if (this.onChatMessage) {
        this.onChatMessage({
          ...chatData,
          isSelf: false
        });
      }
      return;
    }

    // Project sync: a client or host broadcasts project state
    if (message.type === 'project-update') {
      // Broadcast to all OTHER authenticated clients
      const updateData = {
        type: 'project-update',
        project: message.project,
        from: client.username
      };
      for (const otherClient of this.clients.values()) {
        if (otherClient === client) continue;
        if (!otherClient.authenticated) continue;
        this.sendToClient(otherClient, JSON.stringify(updateData));
      }
      // Forward to host window (host is not a WebSocket client)
      if (this.onProjectUpdate) {
        this.onProjectUpdate(updateData);
      }
      return;
    }
  }

  // Ensure no two members share a username, so targeted project pushes
  // (broadcastProject by username) always reach exactly one client.
  getUniqueUsername (base) {
    const taken = new Set();
    for (const c of this.clients.values()) {
      if (c.authenticated && c.username) taken.add(c.username);
    }
    if (!taken.has(base)) return base;
    let i = 2;
    while (taken.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  }

  sendToClient (client, message) {
    if (client.closed) return;
    try {
      this.sendFrame(client.socket, OPCODE_TEXT, Buffer.from(message, 'utf8'));
    } catch (e) {
      // socket already gone
    }
  }

  sendFrame (socket, opcode, payload) {
    const payloadLength = payload.length;
    let header;

    if (payloadLength <= 125) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = payloadLength;
    } else if (payloadLength <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(payloadLength, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(payloadLength, 6);
    }

    socket.write(Buffer.concat([header, payload]));
  }

  broadcast (message) {
    const data = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.authenticated) {
        this.sendToClient(client, data);
      }
    }
  }

  startHeartbeat () {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const client of Array.from(this.clients.values())) {
        if (client.closed) continue;
        if (now - client.lastSeen > this.heartbeatTimeoutMs) {
          // No pong or any other traffic within the window: the peer is gone
          try { client.socket.destroy(); } catch (e) {}
        } else {
          try {
            this.sendFrame(client.socket, OPCODE_PING, Buffer.alloc(0));
          } catch (e) {
            // socket already gone
          }
        }
      }
    }, this.heartbeatIntervalMs);
  }

  stopHeartbeat () {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  handleClose (client) {
    if (client.closed) return;
    client.closed = true;

    if (client.authTimeout) {
      clearTimeout(client.authTimeout);
      client.authTimeout = null;
    }

    const wasAuthenticated = client.authenticated;
    const username = client.username;

    this.clients.delete(client.socket);

    try {
      client.socket.destroy();
    } catch (e) {
      // ignore
    }

    if (wasAuthenticated) {
      // Notify remaining clients so their member list stays accurate
      for (const otherClient of this.clients.values()) {
        if (!otherClient.authenticated) continue;
        this.sendToClient(otherClient, JSON.stringify({
          type: 'member-left',
          username: username,
          onlineCount: this.getTotalOnlineCount(),
          members: this.getRoster()
        }));
      }
      if (this.onClientLeave) {
        this.onClientLeave(username);
      }
    }
  }

  end () {
    return new Promise((resolve) => {
      this.stopHeartbeat();

      const endMessage = JSON.stringify({
        type: 'collaboration-ended',
        reason: 'host-ended'
      });

      for (const client of this.clients.values()) {
        try {
          this.sendToClient(client, endMessage);
          client.closed = true;
          client.socket.destroy();
        } catch (e) {
          // ignore
        }
      }
      this.clients.clear();

      if (this.server) {
        this.server.close(() => {
          resolve();
        });
        setTimeout(() => {
          resolve();
        }, 1000);
      } else {
        resolve();
      }
    });
  }
}

module.exports = CollaborationServer;

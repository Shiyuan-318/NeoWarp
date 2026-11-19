const http = require('http');
const crypto = require('crypto');
const {evaluateProjectUpdate} = require('./collaboration-project-policy');
const {decodeProjectPayload} = require('./collaboration-project-payload');

const MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// Authentication is a PBKDF2 challenge-response exchange. The password itself
// never crosses the wire and every proof is bound to a fresh, single-use server
// nonce, so a captured handshake cannot be replayed. This is deliberately not a
// PAKE: someone who records a handshake can still mount an offline dictionary
// attack at PBKDF2 cost, and ws:// provides no transport encryption. A long,
// random room password and a trusted LAN remain the real security boundary.
const AUTH_PROTOCOL_VERSION = 2;
const AUTH_KDF_ITERATIONS = 210000;
const AUTH_NONCE_BYTES = 32;
const AUTH_SALT_BYTES = 16;
const AUTH_CHALLENGE_TTL_MS = 15000;
const AUTH_MAX_INIT_PER_CONNECTION = 10;
const AUTH_MAX_TRIES_PER_CONNECTION = 3;
const AUTH_MAX_FAILURES_PER_IP = 5;
const AUTH_IP_BLOCK_MS = 60000;
const AUTH_FAILURE_DELAY_MS = 400;
const AUTH_HEX_PROOF = /^[0-9a-f]{64}$/i;

// WebSocket opcodes
const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xA;

class CollaborationServer {
  constructor ({ password, port, permissions, hostName, hostAvatar, heartbeatIntervalMs, heartbeatTimeoutMs, authTimeoutMs }) {
    this.password = password == null ? '' : String(password);
    this.port = port;
    this.permissions = permissions;
    this.hostName = hostName || '主机';
    this.hostAvatar = hostAvatar || '🏠';
    // 稳定唯一的房间 ID：主机可能在多个网卡 IP 上同时响应发现请求，
    // 发现阶段用它区分「同一个房间的多条记录」与「不同的房间」
    this.id = crypto.randomUUID();
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
    this.authFailuresByIp = new Map(); // ip -> { count, blockedUntil, lastFailure }
    this.onClientJoin = null;
    this.onClientLeave = null;
    this.onChatMessage = null;
    this.onProjectRequest = null;
    this.onProjectUpdate = null;
    this.onProjectUpdateRejected = null;
    // 房间的权威工程状态：主机每次广播都会刷新，参与者的更新必须和它做
    // 语义比对（见 authorizeParticipantProjectUpdate）。原始载荷延迟解码，
    // 避免主机每次编辑都在主进程里解开一遍 sb3。
    this.roomProjectPayload = null;
    this.roomProject = null;
    this.roomProjectDecodeError = null;
  }

  // Returns discovery metadata for LAN scanning clients
  getDiscoveryInfo () {
    return {
      ok: true,
      id: this.id,
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
    this.rememberHostProject(projectJson);
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

  // 主机推送的工程就是房间的权威状态。这里只记原始载荷，等参与者第一次
  // 提交更新时再解码一次。
  rememberHostProject (projectJson) {
    this.roomProjectPayload = projectJson;
    this.roomProject = null;
    this.roomProjectDecodeError = null;
  }

  getRoomProject () {
    if (this.roomProject) return this.roomProject;
    if (!this.roomProjectPayload) return null;

    const decoded = decodeProjectPayload(this.roomProjectPayload);
    // 载荷可能是几十 MB 的 base64，解完就释放
    this.roomProjectPayload = null;
    if (decoded.error) {
      this.roomProjectDecodeError = decoded.error;
      console.warn('[collaboration] failed to decode host project payload:', decoded.error);
      return null;
    }
    this.roomProject = decoded.projectJSON;
    return this.roomProject;
  }

  // 参与者发来的 project-update 必须在广播给其他人、交给主机之前通过语义
  // 权限检查：只信已认证身份是不够的，客户端可以绕过渲染层的 UI 包装直接
  // 发送任意工程快照。
  authorizeParticipantProjectUpdate (payload) {
    const decoded = decodeProjectPayload(payload);
    if (decoded.error) {
      return {
        allowed: false,
        reason: 'invalid-project',
        message: `项目数据无效：${decoded.error}`,
        operations: [],
        violations: []
      };
    }

    const previous = this.getRoomProject();
    if (!previous) {
      return {
        allowed: false,
        reason: this.roomProjectDecodeError ? 'host-state-unavailable' : 'not-synchronized',
        message: this.roomProjectDecodeError
          ? '主机项目状态不可用，已拒绝同步'
          : '房间项目尚未同步完成，请稍后重试',
        operations: [],
        violations: []
      };
    }

    const decision = evaluateProjectUpdate({
      previous,
      next: decoded.projectJSON,
      permissions: this.permissions
    });
    if (!decision.allowed) return decision;

    // 通过检查的快照成为新的权威状态，后续更新与它比较。
    this.roomProjectPayload = null;
    this.roomProject = decoded.projectJSON;
    return decision;
  }

  rejectProjectUpdate (client, decision) {
    console.warn(
      `[collaboration] project-update from ${client.username} rejected (${decision.reason}): ${decision.message}`
    );

    this.sendToClient(client, JSON.stringify({
      type: 'project-update-rejected',
      reason: decision.reason,
      message: decision.message,
      operations: decision.violations.map(violation => violation.operation)
    }));

    if (this.onProjectUpdateRejected) {
      this.onProjectUpdateRejected(client.username, decision);
    }

    // 把权威工程重新推给该客户端，免得它带着被拒绝的本地状态继续广播。
    // 每次拒绝都触发全量同步会被恶意客户端拿来放大流量，因此限流。
    const now = Date.now();
    if (!client.lastResyncAt || now - client.lastResyncAt > 5000) {
      client.lastResyncAt = now;
      if (this.onProjectRequest) this.onProjectRequest(client.username);
    }
  }

  start () {
    return new Promise((resolve) => {
      if (!this.password) {
        resolve({ success: false, error: '请先设置房间密码' });
        return;
      }

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
      ip: socket.remoteAddress || '',
      username: null,
      avatar: null,
      authenticated: false,
      buffer: Buffer.alloc(0),
      closed: false,
      lastSeen: Date.now(),
      authTimeout: null,
      authChallenge: null,
      authFailures: 0,
      lastResyncAt: 0
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

    if (message.type === 'auth-init') {
      this.handleAuthInit(client, message);
      return;
    }

    if (message.type === 'auth') {
      // Deliberately not awaited: the KDF runs off the event loop and the
      // socket may deliver more frames (or close) while it is computing.
      this.handleAuthProof(client, message);
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
      // 认证只证明对方知道房间密码，不证明它遵守主机设定的权限。渲染层对
      // deleteSprite / loadExtensionURL 的包装可以被绕过，所以这里必须按
      // 工程快照的语义差异再做一次判定。
      const decision = this.authorizeParticipantProjectUpdate(message.project);
      if (!decision.allowed) {
        this.rejectProjectUpdate(client, decision);
        return;
      }

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

  // Step 1: the client announces itself and asks for a challenge. Nothing
  // secret is sent here, so a passive listener learns only that a join began.
  handleAuthInit (client, message) {
    if (client.authenticated) return;

    if (this.getAuthBlockRemaining(client.ip) > 0) {
      this.sendAuthFailure(client, '尝试次数过多，请稍后再试', { destroy: true });
      return;
    }

    client.authInitCount = (client.authInitCount || 0) + 1;
    if (client.authInitCount > AUTH_MAX_INIT_PER_CONNECTION) {
      this.sendAuthFailure(client, '认证请求过于频繁', { destroy: true });
      return;
    }

    client.authNickname = String(message.nickname || '').trim();
    client.authAvatar = String(message.avatar || '').trim() || '👤';
    client.authChallenge = {
      nonce: crypto.randomBytes(AUTH_NONCE_BYTES),
      salt: crypto.randomBytes(AUTH_SALT_BYTES),
      iterations: AUTH_KDF_ITERATIONS,
      expiresAt: Date.now() + AUTH_CHALLENGE_TTL_MS
    };

    this.sendToClient(client, JSON.stringify({
      type: 'auth-challenge',
      version: AUTH_PROTOCOL_VERSION,
      nonce: client.authChallenge.nonce.toString('hex'),
      salt: client.authChallenge.salt.toString('hex'),
      iterations: client.authChallenge.iterations
    }));
  }

  // Step 2: verify HMAC(PBKDF2(password, salt), nonce). The challenge is
  // consumed whether or not the proof is valid, so a captured proof can never
  // be replayed against this connection.
  async handleAuthProof (client, message) {
    if (client.authenticated) return;

    const challenge = client.authChallenge;
    client.authChallenge = null;
    if (!challenge) {
      this.sendAuthFailure(client, '认证请求无效，请重试', { countFailure: true });
      return;
    }
    if (Date.now() > challenge.expiresAt) {
      this.sendAuthFailure(client, '认证超时，请重试', { countFailure: true });
      return;
    }

    const proofHex = typeof message.proof === 'string' ? message.proof : '';
    if (!AUTH_HEX_PROOF.test(proofHex)) {
      this.sendAuthFailure(client, '密码错误', { countFailure: true });
      return;
    }

    let key;
    try {
      key = await new Promise((resolve, reject) => {
        crypto.pbkdf2(this.password, challenge.salt, challenge.iterations, 32, 'sha256', (err, derived) => {
          if (err) reject(err); else resolve(derived);
        });
      });
    } catch (e) {
      this.sendAuthFailure(client, '认证失败');
      return;
    }

    if (client.closed) return;

    const expectedProof = crypto.createHmac('sha256', key).update(challenge.nonce).digest();
    const givenProof = Buffer.from(proofHex, 'hex');
    // Both operands are fixed-length HMACs bound to a single-use nonce. The
    // constant-time compare is cheap insurance, not the security property:
    // the password never crosses the wire and the proof cannot be replayed.
    if (givenProof.length !== expectedProof.length || !crypto.timingSafeEqual(givenProof, expectedProof)) {
      this.sendAuthFailure(client, '密码错误', { countFailure: true });
      return;
    }

    this.authFailuresByIp.delete(client.ip);
    client.authenticated = true;
    if (client.authTimeout) {
      clearTimeout(client.authTimeout);
      client.authTimeout = null;
    }
    const num = Math.floor(1000 + Math.random() * 9000);
    client.username = this.getUniqueUsername(client.authNickname || `用户-${num}`);
    client.avatar = client.authAvatar || '👤';

    // The client also verifies this proof, so a peer that merely relays the
    // handshake cannot impersonate the host without knowing the password.
    const serverProof = crypto.createHmac('sha256', key).update(challenge.nonce).update(':server').digest('hex');

    this.sendToClient(client, JSON.stringify({
      type: 'auth-result',
      success: true,
      serverProof,
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
  }

  // Failed attempts are delayed and eventually close the socket; repeated
  // failures from one address are blocked for a while to slow online guessing.
  sendAuthFailure (client, error, { destroy = false, countFailure = false } = {}) {
    if (client.closed) return;

    let failures = 0;
    if (countFailure) {
      client.authFailures = (client.authFailures || 0) + 1;
      failures = client.authFailures;
      const entry = this.authFailuresByIp.get(client.ip) || { count: 0, blockedUntil: 0, lastFailure: 0 };
      entry.count += 1;
      entry.lastFailure = Date.now();
      if (entry.count >= AUTH_MAX_FAILURES_PER_IP) {
        entry.count = 0;
        entry.blockedUntil = Date.now() + AUTH_IP_BLOCK_MS;
      }
      this.authFailuresByIp.set(client.ip, entry);
    }

    const response = JSON.stringify({
      type: 'auth-result',
      success: false,
      error,
      permissions: this.permissions,
      username: null
    });

    setTimeout(() => {
      if (client.closed) return;
      this.sendToClient(client, response);
      if (destroy || failures >= AUTH_MAX_TRIES_PER_CONNECTION) {
        // end() flushes the auth-result frame before the FIN; destroy() could
        // drop it and leave the peer staring at a generic disconnect.
        try { client.socket.end(); } catch (e) {}
      }
    }, AUTH_FAILURE_DELAY_MS);
  }

  getAuthBlockRemaining (ip) {
    const entry = this.authFailuresByIp.get(ip);
    if (!entry || !entry.blockedUntil) return 0;
    const remaining = entry.blockedUntil - Date.now();
    if (remaining <= 0) {
      this.authFailuresByIp.delete(ip);
      return 0;
    }
    return remaining;
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

      // Forget stale per-IP auth failures so the map cannot grow forever.
      for (const [ip, entry] of this.authFailuresByIp) {
        const expired = (entry.blockedUntil || 0) <= now;
        const idle = now - (entry.lastFailure || 0) > 10 * 60 * 1000;
        if (expired && idle) this.authFailuresByIp.delete(ip);
      }

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
    client.authChallenge = null;

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
      this.roomProjectPayload = null;
      this.roomProject = null;
      this.roomProjectDecodeError = null;

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

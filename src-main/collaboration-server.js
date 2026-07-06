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
  constructor ({ password, port, permissions }) {
    this.password = password;
    this.port = port;
    this.permissions = permissions;
    this.server = null;
    this.clients = new Map(); // socket -> client info
    this.clientCounter = 0;
    this.onClientJoin = null;
    this.onClientLeave = null;
    this.onChatMessage = null;
  }

  start () {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
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
        resolve({ success: true, port: this.port });
      });
    });
  }

  handleUpgrade (req, socket, head) {
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
      authenticated: false,
      buffer: Buffer.alloc(0),
      closed: false
    };

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
    client.buffer = Buffer.concat([client.buffer, data]);

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

    if (message.type === 'auth') {
      if (message.password === this.password) {
        client.authenticated = true;
        const num = Math.floor(1000 + Math.random() * 9000);
        client.username = `用户-${num}`;

        this.sendToClient(client, JSON.stringify({
          type: 'auth-result',
          success: true,
          permissions: this.permissions,
          username: client.username
        }));

        if (this.onClientJoin) {
          this.onClientJoin(client.username);
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
    }
  }

  sendToClient (client, message) {
    if (client.closed) return;
    this.sendFrame(client.socket, OPCODE_TEXT, Buffer.from(message, 'utf8'));
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

  getOnlineCount () {
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.authenticated) count++;
    }
    return count;
  }

  handleClose (client) {
    if (client.closed) return;
    client.closed = true;

    const wasAuthenticated = client.authenticated;
    const username = client.username;

    this.clients.delete(client.socket);

    try {
      client.socket.destroy();
    } catch (e) {
      // ignore
    }

    if (wasAuthenticated && this.onClientLeave) {
      this.onClientLeave(username);
    }
  }

  end () {
    return new Promise((resolve) => {
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

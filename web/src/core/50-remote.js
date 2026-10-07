/* NeoWarp Web — 远程通道（信令 + WebRTC）
 *
 * 网页版没有 Electron 主进程，无法起局域网 HTTP/WS 服务，
 * 因此桌面版「主进程开服务 + 手机扫码」的三类远控能力
 * （AI 手机编程、手机观看舞台、多人协作）统一改为：
 *
 *   公共 MQTT broker（信令） → WebRTC datachannel（业务数据 P2P 直连）
 *
 * 信令只交换 SDP/ICE，项目数据、AI 会话、舞台帧全部走 P2P，
 * 不经过任何第三方业务服务器。
 */
(function (global) {
  'use strict';

  var util = global.NW && global.NW.util;

  /* 公共信令 broker：全部为公开匿名 WebSocket 端点。
   * 依次尝试，第一个连上的生效；MQTT 全局对象由 assets/vendor/mqtt.min.js 提供。 */
  var BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081'
  ];

  var TOPIC_PREFIX = 'neowarp-web/v1/';
  var ICE_SERVERS = [
    {urls: 'stun:stun.l.google.com:19302'},
    {urls: 'stun:stun.miwifi.com:3478'}
  ];
  var CHUNK_SIZE = 60 * 1024; // datachannel 单条消息安全上限内

  var state = {
    mqtt: null,          // mqtt.Client
    mqttIndex: 0,
    topics: {},          // topic -> handler
    selfId: 'c-' + Math.random().toString(36).slice(2, 8)
  };

  function isAvailable () {
    return !!(global.RTCPeerConnection && global.mqtt);
  }

  /* ---------------- MQTT 信令（惰性共享连接） ---------------- */

  function connectMqtt () {
    if (state.mqtt) return Promise.resolve(state.mqtt);
    return new Promise(function (resolve, reject) {
      if (state.mqttIndex >= BROKERS.length) {
        state.mqttIndex = 0;
        reject(new Error('信令服务器均不可达'));
        return;
      }
      var url = BROKERS[state.mqttIndex];
      var client;
      try {
        client = global.mqtt.connect(url, {
          clientId: 'nw-' + state.selfId + '-' + Math.random().toString(36).slice(2, 6),
          keepalive: 30,
          reconnectPeriod: 0, // 我们自己换 broker 重试
          connectTimeout: 8000
        });
      } catch (e) {
        state.mqttIndex += 1;
        resolve(connectMqtt());
        return;
      }
      client.on('connect', function () {
        state.mqtt = client;
        client.on('message', function (topic, payload) {
          var handler = state.topics[topic];
          if (!handler) return;
          var msg;
          try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
          try { handler(msg); } catch (e) { void e; }
        });
        // 重新订阅此前登记的主题
        Object.keys(state.topics).forEach(function (topic) {
          client.subscribe(topic, function () {});
        });
        resolve(client);
      });
      client.on('error', function () {
        if (!state.mqtt) {
          try { client.end(true); } catch (e) { void e; }
          state.mqttIndex += 1;
          resolve(connectMqtt());
        }
      });
      setTimeout(function () {
        if (!state.mqtt) {
          try { client.end(true); } catch (e) { void e; }
          state.mqttIndex += 1;
          resolve(connectMqtt());
        }
      }, 9000);
    });
  }

  function subscribe (topic, handler) {
    state.topics[topic] = handler;
    return connectMqtt().then(function (client) {
      return new Promise(function (resolve) {
        client.subscribe(topic, function () { resolve(); });
      });
    });
  }

  function unsubscribe (topic) {
    delete state.topics[topic];
    if (state.mqtt) {
      try { state.mqtt.unsubscribe(topic, function () {}); } catch (e) { void e; }
    }
  }

  function publish (topic, obj) {
    return connectMqtt().then(function (client) {
      client.publish(topic, JSON.stringify(obj));
    });
  }

  /* ---------------- 房间 ---------------- */

  function generateRoom () {
    var alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    var code = '';
    for (var i = 0; i < 6; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
  }

  /* 信令主题内的设备到 datachannel 的一对一连接 */
  function PeerLink (pc, channel, meta) {
    this.pc = pc;
    this.channel = channel;
    this.meta = meta || {};
    this.onData = null;      // fn(obj)
    this.onBinary = null;    // fn(ArrayBuffer)
    this.onClose = null;     // fn()
    var self = this;
    channel.binaryType = 'arraybuffer';
    channel.onmessage = function (event) {
      if (event.data instanceof ArrayBuffer) {
        if (self.onBinary) self.onBinary(event.data);
        return;
      }
      var obj;
      try { obj = JSON.parse(event.data); } catch (e) { return; }
      if (self.onData) self.onData(obj);
    };
    channel.onclose = function () {
      if (self.onClose) self.onClose();
    };
  }

  PeerLink.prototype.send = function (obj) {
    try {
      if (this.channel.readyState === 'open') this.channel.send(JSON.stringify(obj));
    } catch (e) { void e; }
  };

  /** 大 payload 分块：meta 帧 + n 个二进制块 */
  PeerLink.prototype.sendBlob = function (name, buffer) {
    var bytes = new Uint8Array(buffer);
    var total = Math.max(1, Math.ceil(bytes.length / CHUNK_SIZE));
    var self = this;
    this.send({t: 'blob-meta', name: name, size: bytes.length, chunks: total});
    var i = 0;
    var step = function () {
      while (i < total) {
        var start = i * CHUNK_SIZE;
        var part = bytes.subarray(start, Math.min(start + CHUNK_SIZE, bytes.length));
        try {
          self.channel.send(part);
        } catch (e) {
          setTimeout(step, 50);
          return;
        }
        i += 1;
      }
    };
    step();
  };

  /** 接收端组装器（单 blob 流假设足够；喂满 chunk 即返回组装结果） */
  function BlobAssembler () {
    this.blobs = {};
  }
  BlobAssembler.prototype.feed = function (obj) {
    if (obj && obj.t === 'blob-meta') {
      this.blobs[obj.name] = {size: obj.size, chunks: obj.chunks, parts: []};
      return true;
    }
    return false;
  };
  BlobAssembler.prototype.binary = function (buffer) {
    for (var name in this.blobs) {
      var entry = this.blobs[name];
      entry.parts.push(buffer);
      if (entry.parts.length < entry.chunks) return null;
      delete this.blobs[name];
      var out = new Uint8Array(entry.size);
      var offset = 0;
      for (var i = 0; i < entry.parts.length; i++) {
        out.set(new Uint8Array(entry.parts[i]), offset);
        offset += entry.parts[i].byteLength;
      }
      return {name: name, buffer: out.buffer};
    }
    return null;
  };

  /* ---------------- 房主 ---------------- */

  /**
   * 开房：监听信令主题，接受任意 join 并与之建立 datachannel。
   * handlers: {onOpen(link), onData(link, obj), onBinary(link, buf), onClose(link), onSignal(msg)}
   */
  function host (room, handlers) {
    var topic = TOPIC_PREFIX + room;
    var links = [];
    var closed = false;

    var api = {
      room: room,
      topic: topic,
      links: links,
      /* 信令就绪（订阅已完成）后手机发来的 join 才能收到 */
      ready: subscribe(topic, function (msg) {
        if (closed) return;
        if (msg.t === 'join') {
          acceptJoin(msg);
        } else if (msg.t === 'answer') {
          // 客人的应答：交给对应 link 完成 handshake
          var answerTarget = null;
          links.forEach(function (l) {
            if (l.meta.peerId === msg.from) answerTarget = l;
          });
          if (answerTarget && answerTarget.pc.signalingState === 'have-local-offer') {
            answerTarget.pc.setRemoteDescription(msg.sdp).catch(function () {});
          }
        } else if (msg.t === 'ice' && msg.to === 'host') {
          var target = null;
          // 通过 from 匹配对应 link（meta.peerId）
          links.forEach(function (l) {
            if (l.meta.peerId === msg.from) target = l;
          });
          if (target && target.pc.signalingState !== 'closed') {
            target.pc.addIceCandidate(msg.cand).catch(function () {});
          }
        } else if (handlers.onSignal) {
          handlers.onSignal(msg);
        }
      }),
      broadcast: function (obj) { links.forEach(function (l) { l.send(obj); }); },
      sendBlobAll: function (name, buffer) {
        links.forEach(function (l) { l.sendBlob(name, buffer); });
      },
      close: function () {
        closed = true;
        unsubscribe(topic);
        links.forEach(function (l) {
          try { l.channel.close(); } catch (e) { void e; }
        });
        publish(topic, {t: 'bye', from: 'host'}).catch(function () {});
      }
    };

    function acceptJoin (msg) {
      if (closed || msg.from === 'host') return;
      // 同一设备会因 join 重试而重复到达：已有 link（或握手中）时直接重发 offer 即可，
      // 否则每次 join 都新建 RTCPeerConnection，会出现「一个 open 一个永久 connecting」。
      var existing = null;
      links.forEach(function (l) {
        if (l.meta.peerId === msg.from) existing = l;
      });
      if (existing) {
        if (existing.channel.readyState === 'open') {
          // 已连通，告知客人握手完成（客人侧可能仍在重试 join）
          existing.send({t: 'welcome', kind: existing.meta.kind});
        } else if (existing.pc.signalingState === 'have-local-offer') {
          publish(topic, {
            t: 'offer', from: 'host', to: msg.from, sdp: existing.pc.localDescription
          }).catch(function () {});
        }
        return;
      }
      var pc;
      try {
        pc = new global.RTCPeerConnection({iceServers: ICE_SERVERS});
      } catch (e) {
        return;
      }
      var channel = pc.createDataChannel('nw', {ordered: true});
      var link = new PeerLink(pc, channel, {peerId: msg.from, kind: msg.kind});
      link.meta.peerId = msg.from;
      links.push(link);
      link.onClose = function () {
        var idx = links.indexOf(link);
        if (idx >= 0) links.splice(idx, 1);
        if (handlers.onClose) handlers.onClose(link);
      };
      if (handlers.onData) link.onData = function (obj) { handlers.onData(link, obj); };
      if (handlers.onBinary) link.onBinary = function (buf) { handlers.onBinary(link, buf); };
      // datachannel 真正打通后才通知上层（推首帧、广播快照等都依赖这个时机）
      channel.onopen = function () {
        if (closed) return;
        if (handlers.onOpen) handlers.onOpen(link);
      };

      pc.onicecandidate = function (event) {
        if (event.candidate) {
          publish(topic, {t: 'ice', from: 'host', to: msg.from, cand: event.candidate.toJSON()}).catch(function () {});
        }
      };
      pc.createOffer().then(function (offer) {
        return pc.setLocalDescription(offer);
      }).then(function () {
        return publish(topic, {t: 'offer', from: 'host', to: msg.from, sdp: pc.localDescription});
      }).catch(function () {
        // 握手失败即丢弃
      });
    }

    return api;
  }

  /* ---------------- 客人 ---------------- */

  /**
   * 加入房间：join → 收 offer → answer → datachannel。
   * handlers: {onOpen(link), onData(link, obj), onBinary(link, buf), onClose(link), onFail(error)}
   */
  function join (room, handlers) {
    var topic = TOPIC_PREFIX + room;
    var closed = false;
    var pc = null;
    var link = null;
    var myId = state.selfId + '-' + Math.random().toString(36).slice(2, 6);
    var joinTimer = null;

    function fail (error) {
      if (joinTimer) clearInterval(joinTimer);
      if (handlers.onFail) handlers.onFail(error);
    }

    subscribe(topic, function (msg) {
      if (closed) return;
      if (msg.t === 'offer' && (msg.to === myId || msg.to === undefined)) {
        if (pc && pc.signalingState !== 'closed') return;
        try {
          pc = new global.RTCPeerConnection({iceServers: ICE_SERVERS});
        } catch (e) { fail(e); return; }
        pc.ondatachannel = function (event) {
          link = new PeerLink(pc, event.channel, {peerId: 'host'});
          if (handlers.onData) link.onData = function (obj) { handlers.onData(link, obj); };
          if (handlers.onBinary) link.onBinary = function (buf) { handlers.onBinary(link, buf); };
          link.onClose = function () {
            if (handlers.onClose) handlers.onClose(link);
          };
          if (handlers.onOpen) handlers.onOpen(link);
        };
        pc.onicecandidate = function (event) {
          if (event.candidate) {
            publish(topic, {t: 'ice', from: myId, to: 'host', cand: event.candidate.toJSON()}).catch(function () {});
          }
        };
        pc.setRemoteDescription(msg.sdp).then(function () {
          return pc.createAnswer();
        }).then(function (answer) {
          return pc.setLocalDescription(answer);
        }).then(function () {
          return publish(topic, {t: 'answer', from: myId, sdp: pc.localDescription});
        }).catch(function (e) { fail(e); });
      } else if (msg.t === 'ice' && msg.to === myId && pc) {
        pc.addIceCandidate(msg.cand).catch(function () {});
      } else if (msg.t === 'welcome') {
        // 房主侧 datachannel 已 open，重试定时器可以停了
        clearInterval(joinTimer);
      } else if (msg.t === 'bye' && msg.from === 'host') {
        if (link) {
          try { link.channel.close(); } catch (e) { void e; }
        }
      }
    });

    publish(topic, {t: 'join', from: myId, kind: 'client'}).catch(function (e) { fail(e); });

    // join 是普通消息：若房主端的信令订阅尚未建立就会丢失，重发直到连接建立
    var joinAttempts = 0;
    joinTimer = setInterval(function () {
      joinAttempts += 1;
      if (closed || link) {
        clearInterval(joinTimer);
        return;
      }
      if (joinAttempts > 8) {
        clearInterval(joinTimer);
        fail(new Error('连接超时，请确认电脑端房间仍开启'));
        return;
      }
      publish(topic, {t: 'join', from: myId, kind: 'client'}).catch(function () {});
    }, 2500);

    // 兜底：45 秒没建立成功视为失败
    setTimeout(function () {
      clearInterval(joinTimer);
      if (!closed && !link) fail(new Error('连接超时，请确认电脑端房间仍开启'));
    }, 45000);

    var api = {
      room: room,
      get link () { return link; },
      send: function (obj) { if (link) link.send(obj); },
      close: function () {
        closed = true;
        unsubscribe(topic);
        if (link) {
          try { link.channel.close(); } catch (e) { void e; }
        }
      }
    };
    return api;
  }

  /* ---------------- 二维码 ---------------- */

  function qrSvg (text) {
    try {
      var qrcodeGen = global.qrcode; // qrcode-generator@1.4.4（ai 页自带）
      if (!qrcodeGen) return null;
      var qr = qrcodeGen(0, 'M');
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({cellSize: 4, margin: 2, scalable: true});
    } catch (e) {
      return null;
    }
  }

  function remoteUrl (path, room, extra) {
    var base = (util && util.base) ? util.base : '/';
    var url = base + path + '?r=' + encodeURIComponent(room);
    if (extra) url += '&' + extra;
    return url;
  }

  global.NW.remote = {
    isAvailable: isAvailable,
    generateRoom: generateRoom,
    host: host,
    join: join,
    qrSvg: qrSvg,
    remoteUrl: remoteUrl,
    BlobAssembler: BlobAssembler,
    CHUNK_SIZE: CHUNK_SIZE,
    /* 调试用（只读快照） */
    _state: state
  };
})(window);

/* 协作窗口渲染逻辑：发起协作 / 加入协作 / 协作聊天 */
(function () {
  'use strict';

  var Preload = window.CollaborationPreload;

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    viewHost: $('view-host'),
    viewJoin: $('view-join'),
    viewChat: $('view-chat'),
    // 发起协作
    hostAddress: $('host-address'),
    btnCopyAddress: $('btn-copy-address'),
    hostNickname: $('host-nickname'),
    hostAvatar: $('host-avatar'),
    hostAvatarPicker: $('host-avatar-picker'),
    hostPassword: $('host-password'),
    hostPort: $('host-port'),
    permAddExtension: $('perm-add-extension'),
    permDeleteExtension: $('perm-delete-extension'),
    permDeleteSprite: $('perm-delete-sprite'),
    hostError: $('host-error'),
    btnStartHost: $('btn-start-host'),
    // 加入协作
    joinNickname: $('join-nickname'),
    joinAvatar: $('join-avatar'),
    joinAvatarPicker: $('join-avatar-picker'),
    btnRefresh: $('btn-refresh'),
    discoveryList: $('discovery-list'),
    joinIp: $('join-ip'),
    joinPort: $('join-port'),
    joinPassword: $('join-password'),
    joinError: $('join-error'),
    btnJoin: $('btn-join'),
    // 聊天
    roomAvatar: $('room-avatar'),
    roomTitle: $('room-title'),
    roomDot: $('room-dot'),
    roomOnline: $('room-online'),
    roomRole: $('room-role'),
    btnMembers: $('btn-members'),
    btnLeave: $('btn-leave'),
    messages: $('messages'),
    chatInput: $('chat-input'),
    charCount: $('char-count'),
    btnSend: $('btn-send'),
    membersPanel: $('members-panel'),
    membersCatcher: $('members-catcher'),
    membersList: $('members-list'),
    membersCount: $('members-count'),
    btnCloseMembers: $('btn-close-members'),
    toast: $('toast'),
    modal: $('modal'),
    modalTitle: $('modal-title'),
    modalText: $('modal-text'),
    modalCancel: $('modal-cancel'),
    modalConfirm: $('modal-confirm')
  };

  var AVATARS = ['🏠', '👤', '🐱', '🐶', '🦊', '🐼', '🐧', '🦁',
    '🐯', '🐸', '🦉', '🦄', '🤖', '🌟', '🚀', '🎮'];

  var state = {
    mode: null,           // 窗口初始模式：'host' / 'join'
    role: null,           // 已连接后的身份：'host' / 'participant'
    hostAvatar: '🏠',
    joinAvatar: '👤',
    localIP: '',
    onlineCount: 1,
    scanning: false,
    selfName: '',
    selfAvatar: '',
    hostName: '',
    /** 成员列表，索引 0 恒为自己 */
    members: []
  };

  /* ===== 通用工具 ===== */

  function setTheme (theme) {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  }

  function showView (name) {
    el.viewHost.classList.toggle('visible', name === 'host');
    el.viewJoin.classList.toggle('visible', name === 'join');
    el.viewChat.classList.toggle('visible', name === 'chat');
  }

  var ERROR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>' +
    '<line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

  function setError (node, message) {
    if (!message) {
      node.textContent = '';
      return;
    }
    node.innerHTML = ERROR_ICON;
    var span = document.createElement('span');
    span.textContent = message;
    node.appendChild(span);
  }

  var toastTimer = null;
  function toast (message) {
    el.toast.textContent = message;
    el.toast.classList.toggle('below-bar', el.viewChat.classList.contains('visible'));
    el.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.remove('show');
    }, 2200);
  }

  function setBusy (button, busy, label) {
    button.disabled = busy;
    button.classList.toggle('busy', busy);
    button.textContent = '';
    if (busy) {
      var spinner = document.createElement('span');
      spinner.className = 'spinner';
      button.appendChild(spinner);
    }
    button.appendChild(document.createTextNode(label));
  }

  /* ===== 确认对话框 ===== */

  var modalResolve = null;

  function confirmDialog (options) {
    el.modalTitle.textContent = options.title;
    el.modalText.textContent = options.text;
    el.modalConfirm.textContent = options.confirmText || '确定';
    el.modalConfirm.classList.toggle('neutral', !!options.neutral);
    el.modal.classList.add('open');
    el.modalConfirm.focus();
    return new Promise(function (resolve) {
      modalResolve = resolve;
    });
  }

  function closeModal (result) {
    el.modal.classList.remove('open');
    if (modalResolve) {
      var resolve = modalResolve;
      modalResolve = null;
      resolve(result);
    }
  }

  el.modalCancel.addEventListener('click', function () { closeModal(false); });
  el.modalConfirm.addEventListener('click', function () { closeModal(true); });
  el.modal.addEventListener('click', function (event) {
    if (event.target === el.modal) closeModal(false);
  });

  /* ===== 头像选择 ===== */

  function buildAvatarPicker (container, preview, selected, onSelect) {
    container.textContent = '';
    AVATARS.forEach(function (emoji) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'avatar-option';
      button.textContent = emoji;
      button.title = emoji;
      button.setAttribute('aria-pressed', String(emoji === selected));
      button.addEventListener('click', function () {
        var options = container.querySelectorAll('.avatar-option');
        for (var i = 0; i < options.length; i++) {
          options[i].setAttribute('aria-pressed', 'false');
        }
        button.setAttribute('aria-pressed', 'true');
        preview.textContent = emoji;
        onSelect(emoji);
      });
      container.appendChild(button);
    });
    preview.textContent = selected;
  }

  buildAvatarPicker(el.hostAvatarPicker, el.hostAvatar, state.hostAvatar, function (emoji) {
    state.hostAvatar = emoji;
  });
  buildAvatarPicker(el.joinAvatarPicker, el.joinAvatar, state.joinAvatar, function (emoji) {
    state.joinAvatar = emoji;
  });

  /* ===== 密码显示切换 ===== */

  Array.prototype.forEach.call(document.querySelectorAll('.reveal'), function (button) {
    button.addEventListener('click', function () {
      var input = $(button.getAttribute('data-target'));
      var reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      button.classList.toggle('on', reveal);
      button.setAttribute('aria-label', reveal ? '隐藏密码' : '显示密码');
      input.focus();
    });
  });

  /* ===== 发起协作 ===== */

  function updateHostAddress () {
    var port = parseInt(el.hostPort.value, 10);
    if (!state.localIP) {
      el.hostAddress.textContent = '获取中…';
      return;
    }
    el.hostAddress.textContent = state.localIP + (port > 0 && port <= 65535 ? ':' + port : '');
  }

  el.hostPort.addEventListener('input', updateHostAddress);

  el.btnCopyAddress.addEventListener('click', function () {
    var address = el.hostAddress.textContent;
    if (!state.localIP) return;
    navigator.clipboard.writeText(address).then(function () {
      el.btnCopyAddress.classList.add('done');
      toast('地址已复制：' + address);
      setTimeout(function () {
        el.btnCopyAddress.classList.remove('done');
      }, 1600);
    }).catch(function () {
      toast('复制失败，请手动选中地址');
    });
  });

  el.btnStartHost.addEventListener('click', function () {
    var password = el.hostPassword.value.trim();
    var port = parseInt(el.hostPort.value, 10);
    if (!password) {
      setError(el.hostError, '请先设置房间密码，协作者需要用它加入');
      el.hostPassword.focus();
      return;
    }
    if (!port || port < 1 || port > 65535) {
      setError(el.hostError, '端口号需要在 1 到 65535 之间');
      el.hostPort.focus();
      return;
    }
    setError(el.hostError, '');
    setBusy(el.btnStartHost, true, '正在启动…');
    Preload.startHost(password, port, {
      allowAddExtension: el.permAddExtension.checked,
      allowDeleteExtension: el.permDeleteExtension.checked,
      allowDeleteSprite: el.permDeleteSprite.checked
    }, el.hostNickname.value.trim(), state.hostAvatar);
  });

  /* ===== 加入协作：局域网发现 ===== */

  function discoveryState (kind, text) {
    el.discoveryList.textContent = '';
    var box = document.createElement('div');
    box.className = 'discovery-state';
    if (kind === 'loading') {
      var spinner = document.createElement('span');
      spinner.className = 'spinner';
      box.appendChild(spinner);
    } else {
      var glyph = document.createElement('span');
      glyph.className = 'glyph';
      glyph.innerHTML = kind === 'error'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/>' +
          '<line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/>' +
          '<line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      box.appendChild(glyph);
    }
    var label = document.createElement('span');
    label.textContent = text;
    box.appendChild(label);
    el.discoveryList.appendChild(box);
  }

  var ARROW_ICONS = '<svg class="icon-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="9 18 15 12 9 6"/></svg>' +
    '<svg class="icon-selected" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="20 6 9 17 4 12"/></svg>';

  function renderDiscovery (sessions) {
    if (!sessions || !sessions.length) {
      discoveryState('empty', '没有找到协作房间。确认主机已经发起协作、端口一致，或在下面手动填写地址。');
      return;
    }
    el.discoveryList.textContent = '';
    sessions.forEach(function (session) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'discovery-item';
      item.setAttribute('aria-pressed', 'false');

      var avatar = document.createElement('div');
      avatar.className = 'discovery-avatar';
      avatar.textContent = session.hostAvatar || '🏠';

      var main = document.createElement('div');
      main.className = 'discovery-main';
      var name = document.createElement('div');
      name.className = 'discovery-name';
      name.textContent = session.roomName || (session.hostName || '主机') + ' 的协作';
      var meta = document.createElement('div');
      meta.className = 'discovery-meta';
      meta.textContent = session.ip + ':' + session.port + ' · ' + (session.onlineCount || 1) + ' 人在线';
      main.appendChild(name);
      main.appendChild(meta);

      var check = document.createElement('div');
      check.className = 'check';
      check.innerHTML = ARROW_ICONS;

      item.appendChild(avatar);
      item.appendChild(main);
      item.appendChild(check);

      item.addEventListener('click', function () {
        var all = el.discoveryList.querySelectorAll('.discovery-item');
        for (var i = 0; i < all.length; i++) {
          all[i].setAttribute('aria-pressed', 'false');
        }
        item.setAttribute('aria-pressed', 'true');
        el.joinIp.value = session.ip;
        el.joinPort.value = session.port;
        setError(el.joinError, '');
        // 先把「手动填写」整卡滚进视野，再聚焦密码框；直接 focus 会让滚动
        // 容器跳到只露出输入行，把上面的房间列表顶出画面。
        el.joinPassword.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'end' });
        el.joinPassword.focus({ preventScroll: true });
        toast('已选择「' + name.textContent + '」，请输入房间密码');
      });

      el.discoveryList.appendChild(item);
    });
  }

  function runDiscovery () {
    if (state.scanning) return;
    state.scanning = true;
    el.btnRefresh.disabled = true;
    el.btnRefresh.classList.add('spinning');
    discoveryState('loading', '正在搜索局域网中的协作房间…');
    Preload.discoverSessions(parseInt(el.joinPort.value, 10) || 8080).then(function (result) {
      if (result && result.success) {
        renderDiscovery(result.sessions);
      } else {
        discoveryState('error', '搜索失败，请重新搜索或在下面手动填写地址。');
      }
    }).catch(function () {
      discoveryState('error', '搜索失败，请重新搜索或在下面手动填写地址。');
    }).then(function () {
      state.scanning = false;
      el.btnRefresh.disabled = false;
      el.btnRefresh.classList.remove('spinning');
    });
  }

  el.btnRefresh.addEventListener('click', runDiscovery);
  el.joinPort.addEventListener('change', runDiscovery);

  el.btnJoin.addEventListener('click', function () {
    var ip = el.joinIp.value.trim();
    var port = parseInt(el.joinPort.value, 10);
    var password = el.joinPassword.value.trim();
    if (!ip) {
      setError(el.joinError, '请选择上面的协作房间，或手动填写 IP 地址');
      el.joinIp.focus();
      return;
    }
    if (!port || port < 1 || port > 65535) {
      setError(el.joinError, '端口号需要在 1 到 65535 之间');
      el.joinPort.focus();
      return;
    }
    if (!password) {
      setError(el.joinError, '请输入房间密码');
      el.joinPassword.focus();
      return;
    }
    setError(el.joinError, '');
    setBusy(el.btnJoin, true, '正在连接…');
    Preload.joinConnect(ip, port, password, el.joinNickname.value.trim(), state.joinAvatar);
  });

  /* ===== 聊天：成员列表 ===== */

  function renderMembers () {
    el.membersCount.textContent = String(state.members.length);
    el.membersList.textContent = '';
    state.members.forEach(function (member, index) {
      var row = document.createElement('div');
      row.className = 'member';

      var avatar = document.createElement('div');
      avatar.className = 'member-avatar';
      avatar.textContent = member.avatar || '👤';

      var main = document.createElement('div');
      main.className = 'member-main';
      var name = document.createElement('div');
      name.className = 'member-name';
      name.textContent = member.name;
      var role = document.createElement('div');
      role.className = 'member-role';
      var labels = [];
      if (member.role === 'host') labels.push('管理员');
      if (index === 0) labels.push('我');
      role.textContent = labels.length ? labels.join(' · ') : '协作者';
      main.appendChild(name);
      main.appendChild(role);

      row.appendChild(avatar);
      row.appendChild(main);
      el.membersList.appendChild(row);
    });
  }

  // 主机与协作者的成员名单都来自主进程；自己始终排在第一位。
  function setRoster (roster) {
    if (!roster || !roster.length) return;
    var selfRole = state.role === 'host' ? 'host' : 'participant';
    var self = null;
    var others = [];
    roster.forEach(function (member) {
      var isSelf = !self && member.role === selfRole &&
        (selfRole === 'host' || member.name === state.selfName);
      if (isSelf) {
        self = member;
      } else {
        others.push(member);
      }
    });
    if (!self) {
      self = { name: state.selfName, avatar: state.selfAvatar, role: selfRole };
    }
    state.members = [self].concat(others);
    renderMembers();
  }

  function setOnlineCount (count) {
    if (typeof count !== 'number' || count < 1) return;
    state.onlineCount = count;
    el.roomOnline.textContent = count + ' 人在线';
  }

  function toggleMembers (open) {
    var next = typeof open === 'boolean' ? open : !el.membersPanel.classList.contains('open');
    el.membersPanel.classList.toggle('open', next);
    el.membersCatcher.classList.toggle('open', next);
    el.btnMembers.classList.toggle('active', next);
    el.btnMembers.setAttribute('aria-expanded', String(next));
    if (!next) el.messages.scrollTop = el.messages.scrollHeight;
  }

  el.btnMembers.addEventListener('click', function () { toggleMembers(); });
  el.btnCloseMembers.addEventListener('click', function () { toggleMembers(false); });
  el.membersCatcher.addEventListener('click', function () { toggleMembers(false); });

  /* ===== 聊天：消息 ===== */

  var GROUP_WINDOW_MS = 3 * 60 * 1000;
  var lastMessage = null;
  var emptyState = null;

  function setChatEmpty (text) {
    el.messages.textContent = '';
    lastMessage = null;
    emptyState = document.createElement('div');
    emptyState.className = 'chat-empty';
    var glyph = document.createElement('div');
    glyph.className = 'glyph';
    glyph.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 ' +
      '8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 ' +
      '0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
    var paragraph = document.createElement('p');
    paragraph.textContent = text;
    emptyState.appendChild(glyph);
    emptyState.appendChild(paragraph);
    el.messages.appendChild(emptyState);
  }

  function clearChatEmpty () {
    if (emptyState) {
      el.messages.removeChild(emptyState);
      emptyState = null;
    }
  }

  function isNearBottom () {
    return el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight < 90;
  }

  function scrollToBottom (force) {
    if (force || isNearBottom()) {
      el.messages.scrollTop = el.messages.scrollHeight;
    }
  }

  function formatTime (ts) {
    var d = new Date(ts);
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function addSystemMessage (text) {
    clearChatEmpty();
    var node = document.createElement('div');
    node.className = 'msg-system';
    node.textContent = text;
    el.messages.appendChild(node);
    lastMessage = null;
    scrollToBottom(true);
  }

  // 同一个人在 3 分钟内连续发言合并成一组：只有首条显示昵称，只有末条显示时间。
  function addChatMessage (data) {
    clearChatEmpty();
    var isSelf = !!data.isSelf;
    var from = data.from || '';
    var time = typeof data.timestamp === 'number' ? data.timestamp : Date.now();
    var grouped = !!lastMessage &&
      lastMessage.isSelf === isSelf &&
      lastMessage.from === from &&
      (time - lastMessage.time) < GROUP_WINDOW_MS;

    var row = document.createElement('div');
    row.className = 'msg ' + (isSelf ? 'out' : 'in') + (grouped ? ' grouped' : '');

    if (!isSelf && !grouped && from) {
      var sender = document.createElement('div');
      sender.className = 'msg-sender';
      var avatar = document.createElement('span');
      avatar.className = 'sender-avatar';
      avatar.textContent = data.avatar || '👤';
      var name = document.createElement('span');
      name.className = 'sender-name';
      name.textContent = from;
      sender.appendChild(avatar);
      sender.appendChild(name);
      row.appendChild(sender);
    }

    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = data.text;
    row.appendChild(bubble);

    var timeNode = document.createElement('div');
    timeNode.className = 'msg-time';
    timeNode.textContent = formatTime(time);
    row.appendChild(timeNode);

    if (grouped && lastMessage.timeNode) {
      lastMessage.timeNode.parentNode.removeChild(lastMessage.timeNode);
    }

    el.messages.appendChild(row);
    lastMessage = { from: from, isSelf: isSelf, time: time, timeNode: timeNode };
    scrollToBottom(isSelf);
  }

  /* ===== 聊天：输入 ===== */

  function refreshComposer () {
    var length = el.chatInput.value.length;
    el.btnSend.disabled = el.chatInput.value.trim().length === 0;
    el.charCount.classList.toggle('show', length >= 400);
    el.charCount.classList.toggle('warn', length >= 480);
    el.charCount.textContent = length + '/500';
  }

  function sendChat () {
    var text = el.chatInput.value.trim();
    if (!text) return;
    Preload.sendMessage(text);
    el.chatInput.value = '';
    refreshComposer();
    el.chatInput.focus();
  }

  el.chatInput.addEventListener('input', refreshComposer);
  el.btnSend.addEventListener('click', sendChat);
  el.chatInput.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    // 中文输入法组词过程中的回车不应发送
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    sendChat();
  });

  /* ===== 会话状态 ===== */

  function enterChat (options) {
    state.role = options.role;
    state.selfName = options.selfName;
    state.selfAvatar = options.selfAvatar;
    state.hostName = options.hostName;
    el.roomTitle.textContent = options.hostName + ' 的协作';
    el.roomAvatar.textContent = options.hostAvatar || '🏠';
    el.roomRole.textContent = options.role === 'host' ? '管理员' : '协作者';
    el.btnLeave.title = options.role === 'host' ? '结束协作' : '退出协作';
    el.btnLeave.setAttribute('aria-label', el.btnLeave.title);
    el.roomDot.classList.remove('offline');
    el.btnLeave.disabled = false;
    el.chatInput.disabled = false;
    setOnlineCount(options.onlineCount || 1);
    setRoster(options.members);
    setChatEmpty(options.emptyText);
    refreshComposer();
    showView('chat');
    setTimeout(function () { el.chatInput.focus(); }, 120);
  }

  function resetSetupButtons () {
    setBusy(el.btnStartHost, false, '发起协作');
    setBusy(el.btnJoin, false, '加入协作');
    setError(el.hostError, '');
    setError(el.joinError, '');
  }

  function leaveSession () {
    var isHost = state.role === 'host';
    confirmDialog({
      title: isHost ? '结束协作' : '退出协作',
      text: isHost
        ? '结束后房间会关闭，所有协作者都将断开连接。'
        : '退出后将不再接收房间里的项目更新。',
      confirmText: isHost ? '结束协作' : '退出'
    }).then(function (confirmed) {
      if (!confirmed) return;
      el.btnLeave.disabled = true;
      var action = isHost ? Preload.endHost() : Preload.leave();
      action.then(function () { Preload.closeWindow(); });
    });
  }

  el.btnLeave.addEventListener('click', leaveSession);

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (el.modal.classList.contains('open')) {
      closeModal(false);
    } else if (el.membersPanel.classList.contains('open')) {
      toggleMembers(false);
    }
  });

  /* ===== 主进程事件 ===== */

  Preload.onHostStarted(function (data) {
    setBusy(el.btnStartHost, false, '发起协作');
    if (!data.success) {
      setError(el.hostError, data.error || '启动失败，请更换端口后重试');
      return;
    }
    enterChat({
      role: 'host',
      selfName: data.nickname,
      selfAvatar: data.avatar,
      hostName: data.nickname,
      hostAvatar: data.avatar,
      onlineCount: data.onlineCount,
      members: data.members,
      emptyText: '协作已启动。把地址 ' + el.hostAddress.textContent + ' 和房间密码发给伙伴，就能一起编程了。'
    });
  });

  Preload.onJoinConnected(function (data) {
    setBusy(el.btnJoin, false, '加入协作');
    if (!data.success) {
      setError(el.joinError, data.error || '连接失败，请检查地址与密码');
      return;
    }
    enterChat({
      role: 'participant',
      selfName: data.username,
      selfAvatar: data.avatar,
      hostName: data.hostName || '主机',
      hostAvatar: data.hostAvatar,
      onlineCount: data.onlineCount,
      members: data.members,
      emptyText: '已加入房间，项目会自动同步。在这里可以和其他人聊天。'
    });
  });

  Preload.onChatMessage(function (data) {
    if (data && (data.isSystem || data.type === 'system')) {
      addSystemMessage(data.text);
      return;
    }
    addChatMessage(data);
  });

  function handleMemberJoined (data) {
    addSystemMessage(data.username + ' 加入了协作');
    setOnlineCount(data.onlineCount);
    setRoster(data.members);
  }

  function handleMemberLeft (data) {
    addSystemMessage(data.username + ' 离开了协作');
    setOnlineCount(typeof data.onlineCount === 'number' ? data.onlineCount : Math.max(1, state.onlineCount - 1));
    setRoster(data.members);
  }

  Preload.onClientJoin(handleMemberJoined);
  Preload.onClientLeave(handleMemberLeft);
  if (Preload.onMemberJoined) Preload.onMemberJoined(handleMemberJoined);
  if (Preload.onMemberLeft) Preload.onMemberLeft(handleMemberLeft);

  Preload.onCollaborationEnded(function (data) {
    var reasons = {
      'host-ended': '主机已结束本次协作',
      'connection-lost': '与主机的连接已断开'
    };
    var reason = reasons[data && data.reason] || '协作已结束';
    var wasHost = state.role === 'host';
    el.roomDot.classList.add('offline');
    el.chatInput.disabled = true;
    el.btnSend.disabled = true;
    addSystemMessage(reason);
    toggleMembers(false);
    closeModal(false);
    setTimeout(function () {
      confirmDialog({
        title: '协作已结束',
        text: reason + '。可以重新' + (wasHost ? '发起' : '加入') + '协作，或直接关闭窗口。',
        confirmText: '好',
        neutral: true
      }).then(function () {
        el.chatInput.disabled = false;
        el.chatInput.value = '';
        refreshComposer();
        resetSetupButtons();
        state.role = null;
        if (wasHost) {
          showView('host');
        } else {
          showView('join');
          runDiscovery();
        }
      });
    }, 400);
  });

  if (Preload.onFocusChat) {
    Preload.onFocusChat(function () {
      if (el.viewChat.classList.contains('visible')) el.chatInput.focus();
    });
  }

  if (Preload.onEndRequested) {
    Preload.onEndRequested(function () {
      if (state.role !== 'host') return;
      el.btnLeave.disabled = true;
      Preload.endHost().then(function () { Preload.closeWindow(); });
    });
  }

  if (Preload.onLeaveRequested) {
    Preload.onLeaveRequested(function () {
      if (state.role !== 'participant') return;
      Preload.leave().then(function () { Preload.closeWindow(); });
    });
  }

  /* ===== 初始化 ===== */

  if (Preload.getTheme) {
    Preload.getTheme().then(setTheme).catch(function () { setTheme('light'); });
  }
  if (Preload.onThemeChanged) {
    Preload.onThemeChanged(function (data) { setTheme(data && data.theme); });
  }

  Preload.getLocalIP().then(function (ip) {
    state.localIP = ip;
    updateHostAddress();
  }).catch(function () {
    el.hostAddress.textContent = '获取失败';
  });

  refreshComposer();

  Preload.getMode().then(function (mode) {
    state.mode = mode;
    if (mode === 'host') {
      showView('host');
      setTimeout(function () { el.hostPassword.focus(); }, 120);
    } else {
      showView('join');
      runDiscovery();
    }
  });



})();

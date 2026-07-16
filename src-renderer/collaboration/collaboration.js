(function() {
  'use strict';

  var Preload = window.CollaborationPreload;

  // DOM elements
  var hostSetupView = document.getElementById('host-setup-view');
  var joinSetupView = document.getElementById('join-setup-view');
  var collabActiveView = document.getElementById('collab-active-view');

  var hostPassword = document.getElementById('host-password');
  var hostPort = document.getElementById('host-port');
  var permAddExtension = document.getElementById('perm-add-extension');
  var permDeleteExtension = document.getElementById('perm-delete-extension');
  var permDeleteSprite = document.getElementById('perm-delete-sprite');
  var btnStartHost = document.getElementById('btn-start-host');
  var hostError = document.getElementById('host-error');

  var joinIp = document.getElementById('join-ip');
  var joinPort = document.getElementById('join-port');
  var joinPassword = document.getElementById('join-password');
  var btnJoin = document.getElementById('btn-join');
  var joinError = document.getElementById('join-error');

  var collabRoleLabel = document.getElementById('collab-role-label');
  var collabOnlineCount = document.getElementById('collab-online-count');
  var btnEndCollab = document.getElementById('btn-end-collab');
  var chatMessages = document.getElementById('chat-messages');
  var chatInput = document.getElementById('chat-input');
  var btnSend = document.getElementById('btn-send');

  var currentMode = null;
  var onlineCount = 1;

  function showView(view) {
    hostSetupView.style.display = 'none';
    joinSetupView.style.display = 'none';
    collabActiveView.classList.remove('active');
    collabActiveView.style.display = 'none';
    if (view === 'host') {
      hostSetupView.style.display = '';
    } else if (view === 'join') {
      joinSetupView.style.display = '';
    } else if (view === 'active') {
      collabActiveView.style.display = '';
      collabActiveView.classList.add('active');
    }
  }

  function showError(element, msg) {
    element.textContent = msg;
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  function formatTimestamp(ts) {
    var d = new Date(ts);
    var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function renderMessage(data) {
    if (data.isSystem || data.type === 'system') {
      var sysEl = document.createElement('div');
      sysEl.className = 'message-system';
      sysEl.textContent = data.text;
      chatMessages.appendChild(sysEl);
      scrollToBottom();
      return;
    }

    var row = document.createElement('div');
    row.className = 'message-row ' + (data.isSelf ? 'message-self' : 'message-other');

    if (!data.isSelf && data.from) {
      var sender = document.createElement('div');
      sender.className = 'message-sender';
      sender.textContent = data.from;
      row.appendChild(sender);
    }

    var bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = data.text;
    row.appendChild(bubble);

    if (data.timestamp) {
      var time = document.createElement('div');
      time.className = 'message-timestamp';
      time.textContent = formatTimestamp(data.timestamp);
      row.appendChild(time);
    }

    chatMessages.appendChild(row);
    scrollToBottom();
  }

  function updateOnlineCount(count) {
    onlineCount = count;
    collabOnlineCount.textContent = count + ' 人在线';
  }

  function sendChat() {
    var text = chatInput.value.trim();
    if (!text) return;
    Preload.sendMessage(text);
    chatInput.value = '';
    chatInput.focus();
  }

  // Host mode
  btnStartHost.addEventListener('click', function() {
    var password = hostPassword.value.trim();
    var port = parseInt(hostPort.value, 10);
    var permissions = {
      allowAddExtension: permAddExtension.checked,
      allowDeleteExtension: permDeleteExtension.checked,
      allowDeleteSprite: permDeleteSprite.checked
    };

    if (!password) {
      showError(hostError, '请设置密码');
      return;
    }
    if (!port || port < 1 || port > 65535) {
      showError(hostError, '请输入有效端口号 (1-65535)');
      return;
    }

    showError(hostError, '');
    btnStartHost.disabled = true;
    btnStartHost.textContent = '正在启动...';
    Preload.startHost(password, port, permissions);
  });

  // Join mode
  btnJoin.addEventListener('click', function() {
    var ip = joinIp.value.trim();
    var port = parseInt(joinPort.value, 10);
    var password = joinPassword.value.trim();

    if (!ip) {
      showError(joinError, '请输入 IP 地址');
      return;
    }
    if (!port || port < 1 || port > 65535) {
      showError(joinError, '请输入有效端口号 (1-65535)');
      return;
    }
    if (!password) {
      showError(joinError, '请输入密码');
      return;
    }

    showError(joinError, '');
    btnJoin.disabled = true;
    btnJoin.textContent = '正在连接...';
    Preload.joinConnect(ip, port, password);
  });

  // Chat send
  btnSend.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendChat();
    }
  });

  // End / Leave collaboration
  btnEndCollab.addEventListener('click', function() {
    if (currentMode === 'host') {
      btnEndCollab.disabled = true;
      Preload.endHost().then(function() {
        Preload.closeWindow();
      });
    } else if (currentMode === 'join') {
      Preload.leave().then(function() {
        Preload.closeWindow();
      });
    }
  });

  // --- Event listeners ---

  Preload.onHostStarted(function(data) {
    btnStartHost.disabled = false;
    btnStartHost.textContent = '发起协作';
    if (data.success) {
      currentMode = 'host';
      collabRoleLabel.textContent = '管理员';
      btnEndCollab.textContent = '结束协作';
      updateOnlineCount(data.onlineCount || 1);
      showView('active');
      // System welcome message
      renderMessage({ isSystem: true, text: '协作已启动，等待其他人加入...' });
      setTimeout(function() { chatInput.focus(); }, 100);
    } else {
      showError(hostError, data.error || '启动失败');
    }
  });

  Preload.onJoinConnected(function(data) {
    btnJoin.disabled = false;
    btnJoin.textContent = '加入协作';
    if (data.success) {
      currentMode = 'join';
      collabRoleLabel.textContent = '参与者';
      btnEndCollab.textContent = '退出协作';
      updateOnlineCount(1);
      showView('active');
      renderMessage({ isSystem: true, text: '已加入协作房间' });
      setTimeout(function() { chatInput.focus(); }, 100);
    } else {
      showError(joinError, data.error || '连接失败');
    }
  });

  Preload.onChatMessage(function(data) {
    renderMessage(data);
  });

  Preload.onClientJoin(function(data) {
    renderMessage({ isSystem: true, text: data.username + ' 加入了协作' });
    if (data.onlineCount !== undefined) {
      updateOnlineCount(data.onlineCount);
    }
  });

  Preload.onClientLeave(function(data) {
    renderMessage({ isSystem: true, text: data.username + ' 离开了协作' });
    if (data.onlineCount !== undefined) {
      updateOnlineCount(data.onlineCount);
    } else {
      updateOnlineCount(Math.max(1, onlineCount - 1));
    }
  });

  Preload.onCollaborationEnded(function(data) {
    var reason = data.reason === 'host-ended' ? '主机已结束协作' : '协作已结束';
    renderMessage({ isSystem: true, text: reason });
    setTimeout(function() {
      alert(reason);
      // Reset to setup view
      btnStartHost.disabled = false;
      btnStartHost.textContent = '发起协作';
      btnJoin.disabled = false;
      btnJoin.textContent = '加入协作';
      showError(hostError, '');
      showError(joinError, '');
      if (currentMode === 'host') {
        showView('host');
      } else {
        showView('join');
      }
      currentMode = null;
    }, 500);
  });

  if (Preload.onFocusChat) {
    Preload.onFocusChat(function() {
      if (collabActiveView.classList.contains('active')) {
        chatInput.focus();
      }
    });
  }

  // Listen for end/leave requests from editor menu bar
  if (Preload.onEndRequested) {
    Preload.onEndRequested(function() {
      if (currentMode === 'host') {
        btnEndCollab.disabled = true;
        Preload.endHost().then(function() {
          Preload.closeWindow();
        });
      }
    });
  }

  if (Preload.onLeaveRequested) {
    Preload.onLeaveRequested(function() {
      if (currentMode === 'join') {
        Preload.leave().then(function() {
          Preload.closeWindow();
        });
      }
    });
  }

  // Initialize
  Preload.getMode().then(function(mode) {
    currentMode = mode;
    if (mode === 'host') {
      showView('host');
    } else {
      showView('join');
    }
  });
})();

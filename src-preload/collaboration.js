const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('CollaborationPreload', {
  getMode: () => ipcRenderer.invoke('collab-get-mode'),
  startHost: (password, port, permissions) => ipcRenderer.invoke('collab-start-host', { password, port, permissions }),
  endHost: () => ipcRenderer.invoke('collab-end-host'),
  joinConnect: (ip, port, password) => ipcRenderer.invoke('collab-join-connect', { ip, port, password }),
  leave: () => ipcRenderer.invoke('collab-leave'),
  sendMessage: (text) => ipcRenderer.send('collab-send-chat', { text }),
  closeWindow: () => ipcRenderer.invoke('collab-close-window'),
  onHostStarted: (callback) => ipcRenderer.on('collab-host-started', (e, data) => callback(data)),
  onJoinConnected: (callback) => ipcRenderer.on('collab-join-connected', (e, data) => callback(data)),
  onChatMessage: (callback) => ipcRenderer.on('collab-chat-message', (e, data) => callback(data)),
  onClientJoin: (callback) => ipcRenderer.on('collab-client-join', (e, data) => callback(data)),
  onClientLeave: (callback) => ipcRenderer.on('collab-client-leave', (e, data) => callback(data)),
  onCollaborationEnded: (callback) => ipcRenderer.on('collab-collaboration-ended', (e, data) => callback(data)),
  onFocusChat: (callback) => ipcRenderer.on('collab-focus-chat', () => callback()),
  onEndRequested: (callback) => ipcRenderer.on('collab-end-requested', () => callback()),
  onLeaveRequested: (callback) => ipcRenderer.on('collab-leave-requested', () => callback()),
});

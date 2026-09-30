const {contextBridge, ipcRenderer} = require('electron');

let frameCallback = null;
let runStatusCallback = null;
let stateCallback = null;
let overlaysCallback = null;

// SOLO 舞台窗口：显示画面 + 底部控制条（绿旗/暂停/停止）+ 变量监视器/提问框覆盖层。
// 画面帧、运行状态与覆盖层状态由主进程推送，按钮指令与"回答"提交经主进程
// 转发给后台编辑器的 VM。
contextBridge.exposeInMainWorld('SoloStagePreload', {
  onFrame: (callback) => {
    frameCallback = callback;
  },
  onRunStatus: (callback) => {
    runStatusCallback = callback;
  },
  onState: (callback) => {
    stateCallback = callback;
  },
  onOverlays: (callback) => {
    overlaysCallback = callback;
  },
  sendControl: (action) => {
    ipcRenderer.send('solo-stage-window-control', action);
  },
  // 提问框提交"回答"：经主进程转发给后台 VM 的 runtime（ANSWER 事件）
  sendAnswer: (text) => {
    ipcRenderer.send('solo-stage-window-answer', { text: String(text ?? '') });
  },
  ready: () => {
    ipcRenderer.send('solo-stage-window-ready');
  }
});

ipcRenderer.on('solo-stage-window-frame', (event, dataURL) => {
  if (frameCallback) frameCallback(dataURL);
});

ipcRenderer.on('solo-stage-window-run-status', (event, status) => {
  if (runStatusCallback) runStatusCallback(status);
});

ipcRenderer.on('solo-stage-window-state', (event, state) => {
  if (stateCallback) stateCallback(state);
});

ipcRenderer.on('solo-stage-window-overlays', (event, data) => {
  if (overlaysCallback) overlaysCallback(data);
});

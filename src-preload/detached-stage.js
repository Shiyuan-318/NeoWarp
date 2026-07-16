const {contextBridge, ipcRenderer} = require('electron');

let frameCallback = null;
let closeCallback = null;
let dimensionsCallback = null;

contextBridge.exposeInMainWorld('DetachedStagePreload', {
  onFrame: (callback) => {
    frameCallback = callback;
  },
  onClose: (callback) => {
    closeCallback = callback;
  },
  onDimensions: (callback) => {
    dimensionsCallback = callback;
  },
  sendInput: (inputData) => {
    ipcRenderer.send('detached-stage-input', inputData);
  },
  ready: () => {
    ipcRenderer.send('detached-stage-ready');
  }
});

ipcRenderer.on('stage-frame', (event, dataURL) => {
  if (frameCallback) {
    frameCallback(dataURL);
  }
});

ipcRenderer.on('close-detached-stage', () => {
  if (closeCallback) {
    closeCallback();
  }
});

ipcRenderer.on('detached-stage-dimensions', (event, dimensions) => {
  if (dimensionsCallback) {
    dimensionsCallback(dimensions);
  }
});

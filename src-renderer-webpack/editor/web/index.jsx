/**
 * Web 版编辑器入口
 * 替换 Electron preload 为浏览器兼容的 stub 实现
 */

import React from 'react';
import ReactDOM from 'react-dom';
import GUI, {AppStateHOC} from 'scratch-gui';
import ErrorContainerHOC from '../error/error-container-hoc.jsx';

import './normalize.css';
import './gui.css';
import './fonts.css';

// ============ Electron Preload Stubs ============
// 这些全局变量在 Electron 中通过 preload 脚本注入
// Web 版提供兼容的 stub 实现

window.EditorPreload = {
  isInitiallyFullscreen: () => false,
  getInitialFile: async () => null,
  getFile: async () => { throw new Error('Not available in web'); },
  openedFile: async () => {},
  closedFile: async () => {},
  showSaveFilePicker: async (suggestedName) => suggestedName || 'project.sb3',
  showOpenFilePicker: async () => null,
  setLocale: () => ({ strings: {} }),
  setChanged: async () => {},
  openNewWindow: async () => { window.open(location.href, '_blank'); },
  openAddonSettings: async () => {},
  openPackager: async () => {},
  openDesktopSettings: async () => {},
  openPrivacy: async () => {},
  openAbout: async () => {},
  getPreferredMediaDevices: async () => ({ microphone: '', camera: '' }),
  getAdvancedCustomizations: async () => ({ userscript: '', userstyle: '' }),
  setExportForPackager: () => {},
  setIsFullScreen: async () => {},
  getSystemStats: async () => ({}),
  detachStage: async () => {},
  reattachStage: async () => {},
  sendStageFrame: () => {},
  onStageDetached: () => {},
  onStageReattached: () => {},
  onDetachedStageInput: () => {},
  getCodeAreaBackgroundImage: () => null,
  setCodeAreaBackgroundImage: async () => {}
};

window.AddonsPreload = {
  exportSettings: async () => {}
};

window.PromptsPreload = {
  alert: (message) => { window.alert(message); },
  confirm: (message) => window.confirm(message)
};

// ============ Web 版文件操作 ============

const showOpenFilePicker = async () => {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.sb3,.sb2,.sb';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) {
        reject(new DOMException('No file selected', 'AbortError'));
        return;
      }
      resolve(file);
    };
    input.oncancel = () => {
      reject(new DOMException('No file selected', 'AbortError'));
    };
    input.click();
  });
};

const showSaveFilePicker = async (options) => {
  const suggestedName = options?.suggestedName || 'project.sb3';
  return { name: suggestedName };
};

// ============ GUI 组件 ============

const WrappedGUI = ErrorContainerHOC(AppStateHOC(GUI));

const GUIWithProps = () => (
  <WrappedGUI
    isFullScreen={false}
    canEditTitle

    canModifyCloudData
    canUseCloud
    cloudHost="wss://clouddata.turbowarp.org"

    backpackVisible
    backpackHost="https://backpack.turbowarp.org"

    showOpenFilePicker={showOpenFilePicker}
    showSaveFilePicker={showSaveFilePicker}
  />
);

GUIWithProps.setAppElement = GUI.setAppElement;

const appTarget = document.getElementById('app');
document.body.classList.add('tw-loaded');
GUI.setAppElement(appTarget);

ReactDOM.render(<GUIWithProps />, appTarget);

// ============ 运行插件系统 ============

import SettingsStore from 'scratch-gui/src/addons/settings-store-singleton';
import AddonChannels from 'scratch-gui/src/addons/channels';
import runAddons from 'scratch-gui/src/addons/entry.js';

AddonChannels.reloadChannel.addEventListener('message', () => {
  location.reload();
});

AddonChannels.changeChannel.addEventListener('message', e => {
  SettingsStore.setStoreWithVersionCheck(e.data);
});

runAddons();

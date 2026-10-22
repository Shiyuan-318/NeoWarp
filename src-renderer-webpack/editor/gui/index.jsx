import React from 'react';
import ReactDOM from 'react-dom';
import GUI from './gui.jsx';

import './media-device-chooser-impl.js';
import '../prompt/prompt.js';
import {setupWindowControlsOverlay} from './window-titlebar.js';

const appTarget = document.getElementById('app');
document.body.classList.add('tw-loaded');
GUI.setAppElement(appTarget);

// 顶部工具栏高度必须在 React 渲染前落到 <html> 上：scratch-blocks 在
// 组件挂载时（blocks.jsx 的 componentDidMount）就把代码区量好尺寸，
// 之后再改只会让画布和容器对不上。这里同步读一次配置即可。
try {
  const toolbarHeight = EditorPreload.getToolbarHeight();
  document.documentElement.setAttribute(
    'data-toolbar-height', toolbarHeight === 'narrow' ? 'narrow' : 'normal');
} catch (e) {
  // 读不到就用默认的 normal（无对应样式，行为等同未设置）
}

// NeoWarp: Windows 窗口控制覆盖层（「Windows 窗口样式」开关）。同样必须
// React 渲染前处理：normal 模式要画自绘标题条并把 #app 下移补偿，
// Blockly 首次测量前 <html> 属性与布局就必须就位。未启用覆盖层
// （macOS/Linux）时内部直接返回，零影响。
setupWindowControlsOverlay();

ReactDOM.render(<GUI />, appTarget);

require('./addons');

EditorPreload.getAdvancedCustomizations().then(({userscript, userstyle}) => {
  if (userstyle) {
    const style = document.createElement('style');
    style.textContent = userstyle;
    document.body.appendChild(style);
  }

  if (userscript) {
    const script = document.createElement('script');
    script.textContent = userscript;
    document.body.appendChild(script);
  }
});

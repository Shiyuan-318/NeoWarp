/**
 * 编辑器窗口开/关事件总线。
 *
 * 图片编辑器的「导出到 Scratch 项目」入口需要实时跟随已打开的项目：
 * EditorWindow 在创建与关闭时 emit('changed')，ImageEditorWindow 订阅后
 * 通知渲染层刷新项目列表。用独立的 EventEmitter 而不是直接互相 require，
 * 是为了避免 editor <-> image-editor 之间的循环依赖。
 */
const {EventEmitter} = require('events');

const emitter = new EventEmitter();
// 同时开多个编辑器 + 多个图片编辑器窗口时监听器会变多
emitter.setMaxListeners(100);

module.exports = emitter;

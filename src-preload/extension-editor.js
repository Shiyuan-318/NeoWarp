const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('ExtensionEditorPreload', {
  getInitial: () => ipcRenderer.invoke('extension-get-initial'),
  // 保存到指定路径（path 为 null 时主进程会转为另存为）；返回 {path,name} | {error} | null(取消)
  save: (path, content) => ipcRenderer.invoke('extension-save', {path, content}),
  saveAs: (suggestedName, content) => ipcRenderer.invoke('extension-save-as', {suggestedName, content}),
  // 打开文件对话框（可多选）；返回 [{path,name,content}|{path,error}] | null
  openDialog: () => ipcRenderer.invoke('extension-open-dialog'),
  // 关闭未保存标签前确认；返回 'save' | 'discard' | 'cancel'
  confirmClose: (fileName) => ipcRenderer.invoke('extension-confirm-close', fileName),
  // 重命名磁盘文件（保留原目录）；返回 {path,name} | {error}
  rename: (path, newName) => ipcRenderer.invoke('extension-rename', {path, newName}),

  // ── 添加到项目 ──
  // 当前打开的 Scratch 编辑器列表（不含 SOLO 后台宿主）：[{id, title}]
  listProjects: () => ipcRenderer.invoke('extension-list-projects'),
  // 把当前标签代码作为扩展添加到选中的 Scratch 项目；返回 {success} | {error}
  addToProject: (targetId, name, code) => ipcRenderer.invoke('extension-add-to-project', {targetId, name, code}),
  // 打开的 Scratch 项目变化（控制「添加到项目」按钮显隐）
  onProjectsChanged: (callback) => {
    ipcRenderer.on('extension-projects-changed', (event, projects) => callback(projects));
  },

  // ── 我的扩展 ──
  // 把扩展代码写入「我的扩展」（编辑器渲染层 localStorage）；id 为 null 新增，否则更新
  addToMyExtensions: (id, name, code) => ipcRenderer.invoke('extension-save-my-extension', {id, name, code}),
  // 「我的扩展」右键「编辑」投送来的内存文件：{name, content, myExtId}
  onOpenMemoryFiles: (callback) => {
    ipcRenderer.on('extension-open-memory-file', (event, file) => callback(file));
  },
  // 外部路由（双击 .js / 主页打开）投送过来的新文件
  onOpenPaths: (callback) => {
    ipcRenderer.on('extension-open-paths', (event, files) => callback(files));
  },
  // 统一的 AI 模型配置存储（与 AI 助手、SOLO、桌面设置共用）
  getAiModelConfigs: () => ipcRenderer.invoke('ai-get-model-configs'),
  saveAiModelConfigs: (payload) => ipcRenderer.invoke('ai-save-model-configs', payload),
  onAiModelConfigsChanged: (callback) => {
    ipcRenderer.on('ai-model-configs-changed', (event, data) => callback(data));
  },
  openDesktopSettings: () => ipcRenderer.invoke('open-desktop-settings'),

  // ── AI 面板弹出 / 恢复 ──
  // 编辑器侧：请求弹出（state 为交接的聊天状态，null 表示仅聚焦已有弹窗）
  popoutAi: (state) => ipcRenderer.invoke('extension-popout-ai', state),
  // 编辑器侧：弹窗关闭（含恢复停靠）后收到带回来的聊天状态
  onPopoutClosed: (callback) => {
    ipcRenderer.on('ai-popout-closed', (event, state) => callback(state));
  },
  // 编辑器侧：响应弹窗的取代码/插代码请求
  onEditorRequest: (callback) => {
    ipcRenderer.on('extension-editor-request', (event, data) => callback(data));
  },
  sendEditorResponse: (requestId, result) => ipcRenderer.send('extension-editor-response', {requestId, result}),

  // 弹窗侧
  getPopoutInitial: () => ipcRenderer.invoke('ai-popout-get-initial'),
  onPopoutInit: (callback) => {
    ipcRenderer.on('ai-popout-init', (event, state) => callback(state));
  },
  popoutGetCode: () => ipcRenderer.invoke('ai-popout-get-code'),
  popoutInsertCode: (code) => ipcRenderer.invoke('ai-popout-insert-code', code),
  // 用 AI 生成的代码替换编辑器整个文件内容
  popoutReplaceCode: (code) => ipcRenderer.invoke('ai-popout-replace-code', code),
  popoutGetAiModelConfigs: () => ipcRenderer.invoke('ai-get-model-configs'),
  popoutSaveAiModelConfigs: (payload) => ipcRenderer.invoke('ai-save-model-configs', payload),
  reportPopoutState: (state) => ipcRenderer.send('ai-popout-state', state),
  dockBack: (state) => ipcRenderer.invoke('ai-popout-dock-back', state)
});

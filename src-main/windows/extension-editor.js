const path = require('path');
const fsPromises = require('fs/promises');
const {app, BrowserWindow, dialog} = require('electron');
const AbstractWindow = require('./abstract');
const settings = require('../settings');
const {recordRecentProject} = require('../recent-projects');
const {getLocale} = require('../l10n');
const {writeFileAtomic} = require('../atomic-write-stream');
const {APP_NAME} = require('../brand');
const {registerAiModelConfigIpc} = require('../ai-model-configs');

/**
 * Windows 下阻止把文件写进应用安装目录 / userData（覆盖程序自身的风险），
 * 与 editor.js 的防护逻辑一致，这里只保留应用自身的两条。
 */
const getUnsafePaths = () => {
  if (process.platform !== 'win32') {
    return [];
  }
  return [
    path.dirname(app.getPath('exe')),
    app.getPath('userData')
  ];
};

const isChildPath = (parent, child) => {
  const relative = path.relative(parent, child);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * 扩展项目代码编辑器：VS Code 风格界面 + Monaco，单窗口多标签页。
 * 窗口本身只提供文件读写/对话框服务，标签状态由渲染层维护。
 */
/**
 * 向某个编辑器窗口的渲染层发请求并等待回执（渲染层回包需带相同 requestId）。
 * @param {object} editorWin 目标 EditorWindow 实例
 * @param {string} sendChannel 主进程 → 编辑器渲染层
 * @param {string} replyChannel 编辑器渲染层 → 主进程
 * @param {object} payload 请求内容（requestId 自动附加）
 * @param {number} timeoutMs 超时返回 null
 * @returns {Promise<object|null>}
 */
const requestEditorRenderer = (editorWin, sendChannel, replyChannel, payload, timeoutMs = 30000) =>
  new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cleanup = () => {
      clearTimeout(timeout);
      try {
        editorWin.ipc.removeListener(replyChannel, handler);
      } catch (e) {
        // 编辑器窗口可能已销毁
      }
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const handler = (e, data) => {
      if (data && data.requestId === requestId) {
        cleanup();
        resolve(data);
      }
    };
    editorWin.ipc.on(replyChannel, handler);
    editorWin.window.webContents.send(sendChannel, {...payload, requestId});
  });

class ExtensionEditorWindow extends AbstractWindow {
  /**
   * @param {string|null} filePath 已打开的本地文件绝对路径；null 表示新建未命名文件
   * @param {{memoryFile?: {name: string, content: string, myExtId?: string|null}}} [options]
   *   memoryFile：来自「我的扩展」右键编辑的内存文件，不落盘
   */
  constructor (filePath, options = {}) {
    super();

    /** @type {string|null} */
    this.filePath = filePath || null;

    /** @type {{name: string, content: string, myExtId?: string|null}|null} */
    this.memoryFile = options.memoryFile || null;

    /** @type {Electron.BrowserWindow|null} 弹出的独立 AI 窗口 */
    this.aiPopout = null;
    /** 弹窗与侧栏之间交接的聊天状态 */
    this.aiPopoutState = null;

    this.window.setTitle(APP_NAME);
    this.window.on('page-title-updated', (event, title) => {
      event.preventDefault();
      this.window.setTitle(title ? `${title} - ${APP_NAME}` : APP_NAME);
    });

    this.ipc.handle('extension-get-initial', async () => {
      const result = {
        locale: getLocale() || 'en',
        file: null,
        error: null
      };
      if (this.memoryFile) {
        // 「我的扩展」送来的内存文件：path 为 null（未关联磁盘文件），带 myExtId
        result.file = {
          path: null,
          name: this.memoryFile.name,
          content: this.memoryFile.content,
          myExtId: this.memoryFile.myExtId || null
        };
      } else if (this.filePath) {
        try {
          const content = await fsPromises.readFile(this.filePath, 'utf8');
          result.file = {
            path: this.filePath,
            name: path.basename(this.filePath),
            content
          };
        } catch (error) {
          result.error = String((error && error.message) || error);
        }
      }
      return result;
    });

    // 保存到标签页关联的路径；未关联文件时走另存为流程
    this.ipc.handle('extension-save', async (event, payload) => {
      const {path: targetPath, content} = payload || {};
      if (!targetPath) {
        return this.saveAs(undefined, content);
      }
      try {
        await this.writeToFile(targetPath, content);
        return {path: targetPath, name: path.basename(targetPath)};
      } catch (error) {
        return {error: String((error && error.message) || error)};
      }
    });

    this.ipc.handle('extension-save-as', async (event, payload) => {
      const {suggestedName, content} = payload || {};
      return this.saveAs(suggestedName, content);
    });

    // 打开文件对话框（可多选），读取内容后交给渲染层开新标签
    this.ipc.handle('extension-open-dialog', async () => {
      const result = await dialog.showOpenDialog(this.window, {
        properties: ['openFile', 'multiSelections'],
        defaultPath: settings.lastDirectory,
        filters: [
          {
            name: 'JavaScript',
            extensions: ['js']
          }
        ]
      });
      if (result.canceled || !result.filePaths.length) {
        return null;
      }
      settings.lastDirectory = path.dirname(result.filePaths[0]);
      await settings.save();
      for (const filePath of result.filePaths) {
        recordRecentProject(filePath, 'extension');
      }
      return ExtensionEditorWindow.readFiles(result.filePaths);
    });

    // 关闭未保存标签前的确认；返回 'save' | 'discard' | 'cancel'
    this.ipc.handle('extension-confirm-close', async (event, fileName) => {
      const isZh = (getLocale() || 'en').toLowerCase().startsWith('zh');
      const result = await dialog.showMessageBox(this.window, {
        type: 'warning',
        message: isZh ? `「${fileName}」有未保存的更改` : `${fileName} has unsaved changes`,
        detail: isZh ? '关闭标签页前要保存吗？' : 'Do you want to save before closing the tab?',
        buttons: isZh ? ['保存', '不保存', '取消'] : ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      });
      return ['save', 'discard', 'cancel'][result.response];
    });

    // 重命名标签关联的磁盘文件（保留原目录）；返回 {path, name} | {error}
    this.ipc.handle('extension-rename', async (event, payload) => {
      const {path: oldPath, newName} = payload || {};
      const isZh = (getLocale() || 'en').toLowerCase().startsWith('zh');
      try {
        const cleanName = path.basename(String(newName || ''));
        if (!cleanName || cleanName === '.' || cleanName === '..') {
          return {error: isZh ? '无效的文件名' : 'Invalid file name'};
        }
        const target = path.resolve(path.dirname(path.resolve(oldPath)), cleanName);
        for (const unsafe of getUnsafePaths()) {
          if (target === unsafe || isChildPath(unsafe, target)) {
            throw new Error('Refusing to rename inside the application directory');
          }
        }
        try {
          await fsPromises.access(target);
          return {error: isZh ? '同名文件已存在' : 'A file with that name already exists'};
        } catch (e) {
          // 目标不存在才能重命名
        }
        await fsPromises.rename(path.resolve(oldPath), target);
        return {path: target, name: path.basename(target)};
      } catch (error) {
        return {error: String((error && error.message) || error)};
      }
    });

    // ── 「添加到项目」：把当前标签的扩展代码加载进已打开的 Scratch 项目 ──
    // 列出已打开的 Scratch 编辑器（不含 SOLO 的后台隐藏宿主）
    this.ipc.handle('extension-list-projects', () => ExtensionEditorWindow.getOpenProjects());

    // 把扩展代码转发给选中的编辑器窗口，由其渲染层加载进 VM，带回加载结果
    this.ipc.handle('extension-add-to-project', async (event, payload) => {
      const {targetId, name, code} = payload || {};
      const isZh = (getLocale() || 'en').toLowerCase().startsWith('zh');
      // Imported late due to circular dependencies
      const EditorWindow = require('./editor');
      const editorWin = AbstractWindow.getWindowsByClass(EditorWindow)
        .find((win) => !win.window.isDestroyed() &&
          !win.isHiddenHost &&
          win.window.webContents.id === targetId);
      if (!editorWin) {
        return {success: false, error: isZh ? '项目窗口已关闭' : 'The project window was closed'};
      }
      const result = await requestEditorRenderer(
        editorWin, 'extension-add-to-project', 'extension-add-to-project-result', {name, code});
      if (!result) {
        return {success: false, error: isZh ? '添加超时' : 'Timed out'};
      }
      return result;
    });

    // ── 「我的扩展」：把扩展代码写入编辑器渲染层的 localStorage 我的扩展列表 ──
    // id 为空表示新增，否则为更新；取第一个可见编辑器窗口执行（同源共享 localStorage）
    this.ipc.handle('extension-save-my-extension', async (event, payload) => {
      const {id, name, code} = payload || {};
      const isZh = (getLocale() || 'en').toLowerCase().startsWith('zh');
      // Imported late due to circular dependencies
      const EditorWindow = require('./editor');
      const editorWin = AbstractWindow.getWindowsByClass(EditorWindow)
        .find((win) => !win.window.isDestroyed() && !win.isHiddenHost);
      if (!editorWin) {
        return {success: false, error: isZh ? '没有已打开的 Scratch 编辑器' : 'No open Scratch editor'};
      }
      const result = await requestEditorRenderer(
        editorWin, 'my-extensions-upsert', 'my-extensions-upsert-result', {id: id || null, name, code});
      if (!result) {
        return {success: false, error: isZh ? '保存超时' : 'Timed out'};
      }
      return result;
    });

    // AI 模型配置使用统一的中心存储（tw_config.json，与 AI 助手 / SOLO /
    // 桌面设置共用）：读取/保存/广播 + 打开桌面设置窗口
    registerAiModelConfigIpc(this.ipc);

    // AI 面板弹出为独立窗口（state 为侧栏交接过来的聊天状态；null 仅聚焦）
    this.ipc.handle('extension-popout-ai', (event, state) => {
      if (state) {
        this.aiPopoutState = state;
      }
      this.openAiPopout();
      return {success: true};
    });

    // 编辑器窗口关闭时一并关掉它的 AI 弹窗
    this.window.on('closed', () => {
      if (this.aiPopout && !this.aiPopout.isDestroyed()) {
        this.aiPopout.close();
      }
    });

    this.loadURL('tw-extension-editor://./extension-editor.html');
    this.show();
  }

  /**
   * @param {string} filePath 绝对路径
   * @param {string} content 文本内容
   */
  async writeToFile (filePath, content) {
    const target = path.resolve(filePath);
    for (const unsafe of getUnsafePaths()) {
      if (target === unsafe || isChildPath(unsafe, target)) {
        throw new Error('Refusing to write inside the application directory');
      }
    }
    await writeFileAtomic(target, content);
  }

  /**
   * @param {string|undefined} suggestedName
   * @param {string} content
   * @returns {Promise<{path: string, name: string}|{error: string}|null>} null = 用户取消
   */
  async saveAs (suggestedName, content) {
    const defaultPath = path.join(settings.lastDirectory, suggestedName || 'extension.js');
    const result = await dialog.showSaveDialog(this.window, {
      defaultPath,
      filters: [
        {
          name: 'JavaScript',
          extensions: ['js']
        }
      ]
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    try {
      await this.writeToFile(result.filePath, content);
    } catch (error) {
      return {error: String((error && error.message) || error)};
    }
    settings.lastDirectory = path.dirname(result.filePath);
    await settings.save();
    return {path: result.filePath, name: path.basename(result.filePath)};
  }

  /**
   * 读取一组本地文件，返回 [{path, name, content} | {path, error}]。
   * @param {string[]} filePaths
   */
  static async readFiles (filePaths) {
    const files = [];
    for (const filePath of filePaths) {
      try {
        const content = await fsPromises.readFile(filePath, 'utf8');
        files.push({path: filePath, name: path.basename(filePath), content});
      } catch (error) {
        files.push({path: filePath, error: String((error && error.message) || error)});
      }
    }
    return files;
  }

  /**
   * 当前打开的 Scratch 编辑器窗口列表（不含 SOLO 的后台隐藏宿主）。
   * @returns {Array<{id: number, title: string}>} id 为编辑器窗口 webContents.id
   */
  static getOpenProjects () {
    // Imported late due to circular dependencies
    const EditorWindow = require('./editor');
    return AbstractWindow.getWindowsByClass(EditorWindow)
      .filter((win) => !win.window.isDestroyed() && !win.isHiddenHost)
      .map((win) => ({
        id: win.window.webContents.id,
        title: win.projectTitle || ''
      }));
  }

  /**
   * 可见 Scratch 编辑器开/关后，把最新项目列表推给所有扩展编辑窗口，
   * 用于控制「添加到项目」按钮的显隐。由 EditorWindow 调用。
   */
  static notifyProjectsChanged () {
    const projects = ExtensionEditorWindow.getOpenProjects();
    for (const win of AbstractWindow.getWindowsByClass(ExtensionEditorWindow)) {
      if (win.window && !win.window.isDestroyed()) {
        win.window.webContents.send('extension-projects-changed', projects);
      }
    }
  }

  /**
   * 打开（或聚焦）独立 AI 窗口。弹窗复用扩展编辑器的 preload，
   * 其 IPC 注册在弹窗自身的 mainFrame 上。
   */
  openAiPopout () {
    if (this.aiPopout && !this.aiPopout.isDestroyed()) {
      this.aiPopout.show();
      this.aiPopout.focus();
      return;
    }

    const isZh = (getLocale() || 'en').toLowerCase().startsWith('zh');
    const popout = new BrowserWindow({
      width: 460,
      height: 680,
      minWidth: 360,
      minHeight: 420,
      useContentSize: true,
      show: false,
      backgroundColor: '#252526',
      autoHideMenuBar: true,
      title: (isZh ? 'AI 助手' : 'AI Assistant') + ' - ' + APP_NAME,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.resolve(__dirname, '../../src-preload/extension-editor.js')
      }
    });
    this.aiPopout = popout;
    popout.on('page-title-updated', (event) => event.preventDefault());
    popout.setMenuBarVisibility(false);

    const popoutIpc = popout.webContents.mainFrame.ipc;
    popoutIpc.handle('ai-popout-get-initial', () => ({
      locale: getLocale() || 'en'
    }));
    // 统一 AI 模型配置：读取/保存/广播 + 打开桌面设置窗口
    registerAiModelConfigIpc(popoutIpc);
    popoutIpc.handle('ai-popout-get-code', () => this.requestFromRenderer('get-code'));
    popoutIpc.handle('ai-popout-insert-code', (event, code) => this.requestFromRenderer('insert-code', code));
    popoutIpc.handle('ai-popout-replace-code', (event, code) => this.requestFromRenderer('replace-code', code));
    popoutIpc.on('ai-popout-state', (event, state) => {
      this.aiPopoutState = state;
    });
    popoutIpc.handle('ai-popout-dock-back', (event, state) => {
      this.aiPopoutState = state;
      popout.close();
      return {success: true};
    });

    popout.on('closed', () => {
      this.aiPopout = null;
      if (!this.window.isDestroyed()) {
        // 把弹窗带回的聊天状态还给侧栏
        this.window.webContents.send('ai-popout-closed', this.aiPopoutState);
      }
    });

    popout.loadURL('tw-extension-editor://./ai-panel.html');
    popout.webContents.on('did-finish-load', () => {
      popout.webContents.send('ai-popout-init', this.aiPopoutState);
    });
    popout.once('ready-to-show', () => {
      popout.show();
      popout.focus();
    });
  }

  /**
   * 向编辑器渲染层发请求（取当前代码 / 插入代码 / 替换全文），带 5 秒超时。
   * @param {'get-code'|'insert-code'|'replace-code'} type
   * @param {*} [payload]
   */
  requestFromRenderer (type, payload) {
    return new Promise((resolve) => {
      if (this.window.isDestroyed()) {
        resolve(null);
        return;
      }
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timeout = setTimeout(() => {
        this.ipc.removeListener('extension-editor-response', handler);
        resolve(null);
      }, 5000);
      const handler = (event, data) => {
        if (data && data.requestId === requestId) {
          clearTimeout(timeout);
          this.ipc.removeListener('extension-editor-response', handler);
          resolve(data.result);
        }
      };
      this.ipc.on('extension-editor-response', handler);
      this.window.webContents.send('extension-editor-request', {requestId, type, payload});
    });
  }

  getPreload () {
    return 'extension-editor';
  }

  getDimensions () {
    return {
      width: 1280,
      height: 800
    };
  }

  getBackgroundColor () {
    return '#1e1e1e';
  }

  static newWindow () {
    return new ExtensionEditorWindow(null);
  }

  /**
   * 打开来自内存的扩展文件（如「我的扩展」右键编辑）。
   * 已有扩展编辑窗口时投送过去开新标签；否则新建窗口。
   * @param {{name: string, content: string, myExtId?: string|null}} file
   */
  static openMemoryFile (file) {
    const existing = AbstractWindow.getWindowsByClass(ExtensionEditorWindow)
      .find((win) => !win.window.isDestroyed());
    if (!existing) {
      return new ExtensionEditorWindow(null, {memoryFile: file});
    }
    existing.show();
    if (!existing.window.isDestroyed()) {
      existing.window.webContents.send('extension-open-memory-file', file);
    }
    return existing;
  }

  /**
   * 单窗口多标签：已有扩展编辑窗口时，把文件投送过去开新标签；否则新建窗口。
   * @param {string} filePath
   */
  static openFile (filePath) {
    const resolved = path.resolve(filePath);
    recordRecentProject(resolved, 'extension');
    const existing = AbstractWindow.getWindowsByClass(ExtensionEditorWindow)
      .find((win) => !win.window.isDestroyed());
    if (!existing) {
      return new ExtensionEditorWindow(resolved);
    }
    existing.show();
    ExtensionEditorWindow.readFiles([resolved]).then((files) => {
      if (!existing.window.isDestroyed()) {
        existing.window.webContents.send('extension-open-paths', files);
      }
    });
    return existing;
  }
}

module.exports = ExtensionEditorWindow;

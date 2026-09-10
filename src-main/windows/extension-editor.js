const path = require('path');
const fsPromises = require('fs/promises');
const {app, dialog} = require('electron');
const AbstractWindow = require('./abstract');
const settings = require('../settings');
const {getLocale} = require('../l10n');
const {writeFileAtomic} = require('../atomic-write-stream');
const {APP_NAME} = require('../brand');

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
class ExtensionEditorWindow extends AbstractWindow {
  /**
   * @param {string|null} filePath 已打开的本地文件绝对路径；null 表示新建未命名文件
   */
  constructor (filePath) {
    super();

    /** @type {string|null} */
    this.filePath = filePath || null;

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
      if (this.filePath) {
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

    // AI 配置与 AI 助手共用 settings.aiProviders（tw_config.json），
    // 任何一侧保存后向另一侧的所有窗口广播，保持 API Key 实时同步
    this.ipc.handle('extension-get-ai-settings', () => settings.aiProviders || {});

    this.ipc.handle('extension-save-ai-settings', async (event, aiSettings) => {
      settings.aiProviders = aiSettings;
      await settings.save();
      ExtensionEditorWindow.broadcastAiSettingsChanged(aiSettings, this.window.webContents);
      return {success: true};
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
   * 把最新 AI 配置推给所有 AI 助手窗口与其他扩展编辑窗口（发起者除外）。
   * @param {object} aiSettings
   * @param {Electron.WebContents|null} sender
   */
  static broadcastAiSettingsChanged (aiSettings, sender) {
    // Imported late due to circular dependencies
    const AIAssistantWindow = require('./ai-assistant');
    const targets = [
      ...AbstractWindow.getWindowsByClass(AIAssistantWindow),
      ...AbstractWindow.getWindowsByClass(ExtensionEditorWindow)
    ];
    for (const win of targets) {
      if (win.window && !win.window.isDestroyed() && win.window.webContents !== sender) {
        win.window.webContents.send('ai-settings-changed', aiSettings);
      }
    }
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
   * 单窗口多标签：已有扩展编辑窗口时，把文件投送过去开新标签；否则新建窗口。
   * @param {string} filePath
   */
  static openFile (filePath) {
    const resolved = path.resolve(filePath);
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

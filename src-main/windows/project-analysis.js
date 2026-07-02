const AbstractWindow = require('./abstract');
const {ipcMain} = require('electron');

class ProjectAnalysisWindow extends AbstractWindow {
  constructor (editorWindow) {
    super();

    this.editorWindow = editorWindow;

    this.window.on('page-title-updated', event => {
      event.preventDefault();
    });
    this.window.setTitle('项目分析');

    this.ipc.handle('project-analysis-get-data', () => {
      if (!this.editorWindow || this.editorWindow.window.isDestroyed()) {
        return { projectName: '', openTime: null, spriteCount: 0 };
      }
      return new Promise((resolve) => {
        const requestId = Date.now().toString();
        const handler = (event, data) => {
          if (data && data.requestId === requestId) {
            ipcMain.removeListener('project-json-response', handler);
            const openTime = this.editorWindow.openedProjectAt || Date.now();
            const projectTitle = this.editorWindow.projectTitle || '';
            resolve({
              projectJSON: data.projectJSON || null,
              openTime: openTime,
              projectTitle: projectTitle,
              assetSize: data.assetSize || 0
            });
          }
        };
        ipcMain.on('project-json-response', handler);
        this.editorWindow.window.webContents.send('request-project-json', { requestId });
        setTimeout(() => {
          ipcMain.removeListener('project-json-response', handler);
          resolve({ projectJSON: null, openTime: Date.now(), projectTitle: '', assetSize: 0 });
        }, 5000);
      });
    });

    this.ipc.handle('project-analysis-get-theme', () => {
      if (!this.editorWindow || this.editorWindow.window.isDestroyed()) {
        return 'light';
      }
      return new Promise((resolve) => {
        const requestId = Date.now().toString();
        const handler = (event, data) => {
          if (data && data.requestId === requestId) {
            ipcMain.removeListener('theme-response', handler);
            resolve(data.theme || 'light');
          }
        };
        ipcMain.on('theme-response', handler);
        this.editorWindow.window.webContents.send('request-theme', { requestId });
        setTimeout(() => {
          ipcMain.removeListener('theme-response', handler);
          resolve('light');
        }, 3000);
      });
    });

    this.ipc.handle('project-analysis-close-window', () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.close();
      }
      return { success: true };
    });

    this.ipc.handle('project-analysis-save-image', async (event, dataUrl) => {
      const { dialog } = require('electron');
      const fs = require('fs');

      try {
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        const fileName = this.editorWindow && this.editorWindow.projectTitle ?
          `${this.editorWindow.projectTitle}_项目分析.png` :
          '项目分析.png';

        const result = await dialog.showSaveDialog(this.window, {
          title: '导出项目分析图片',
          defaultPath: fileName,
          filters: [
            { name: 'PNG 图片', extensions: ['png'] }
          ]
        });

        if (result.canceled || !result.filePath) {
          return { success: false, canceled: true };
        }

        fs.writeFileSync(result.filePath, buffer);
        return { success: true, filePath: result.filePath };
      } catch (error) {
        console.error('导出图片失败:', error);
        return { success: false, error: error.message };
      }
    });

    this.loadURL('tw-project-analysis://./project-analysis.html');
    this.show();
  }

  getDimensions () {
    return {
      width: 560,
      height: 620
    };
  }

  getPreload () {
    return 'project-analysis';
  }

  isPopup () {
    return true;
  }

  getBackgroundColor () {
    return '#f2f2f7';
  }

  static show (editorWindow) {
    const existing = AbstractWindow.getWindowsByClass(ProjectAnalysisWindow);
    if (existing.length) {
      existing[0].show();
      return existing[0];
    }
    return new ProjectAnalysisWindow(editorWindow);
  }
}

module.exports = ProjectAnalysisWindow;

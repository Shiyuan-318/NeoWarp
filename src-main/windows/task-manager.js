const AbstractWindow = require('./abstract');
const {ipcMain} = require('electron');
const os = require('os');

class TaskManagerWindow extends AbstractWindow {
  constructor (editorWindow) {
    super();

    this.editorWindow = editorWindow;

    this.window.on('page-title-updated', event => {
      event.preventDefault();
    });
    this.window.setTitle('任务管理器');

    // 获取系统级 CPU/RAM 数据
    this.ipc.handle('task-manager-get-system-stats', () => {
      return this._getSystemStats();
    });

    // 获取每个角色的资源数据（从编辑器窗口请求）
    this.ipc.handle('task-manager-get-sprite-stats', () => {
      if (!this.editorWindow || this.editorWindow.window.isDestroyed()) {
        return { sprites: [], totalThreads: 0 };
      }
      return new Promise((resolve) => {
        const requestId = Date.now().toString();
        const handler = (event, data) => {
          if (data && data.requestId === requestId) {
            ipcMain.removeListener('sprite-stats-response', handler);
            resolve(data);
          }
        };
        ipcMain.on('sprite-stats-response', handler);
        this.editorWindow.window.webContents.send('request-sprite-stats', { requestId });
        setTimeout(() => {
          ipcMain.removeListener('sprite-stats-response', handler);
          resolve({ sprites: [], totalThreads: 0 });
        }, 3000);
      });
    });

    // 获取主题
    this.ipc.handle('task-manager-get-theme', () => {
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

    this.loadURL('tw-task-manager://./task-manager.html');
    this.show();
  }

  _getSystemStats () {
    const currentCpuTimes = this._getCpuTimes();

    const idleDiff = currentCpuTimes.idle - (this._lastCpuTimes || currentCpuTimes).idle;
    const totalDiff = currentCpuTimes.total - (this._lastCpuTimes || currentCpuTimes).total;

    let cpuPercent = 0;
    if (totalDiff > 0) {
      cpuPercent = Math.round((1 - idleDiff / totalDiff) * 100);
    }

    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    this._lastCpuTimes = currentCpuTimes;

    return {
      cpuPercent: Math.min(Math.max(cpuPercent, 0), 100),
      ramUsedMB: Math.round(usedMemory / 1024 / 1024),
      ramTotalMB: Math.round(totalMemory / 1024 / 1024)
    };
  }

  _getCpuTimes () {
    const cpus = os.cpus();
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
    for (const cpu of cpus) {
      user += cpu.times.user;
      nice += cpu.times.nice;
      sys += cpu.times.sys;
      idle += cpu.times.idle;
      irq += cpu.times.irq;
    }
    return { user, nice, sys, idle, irq, total: user + nice + sys + idle + irq };
  }

  getDimensions () {
    return {
      width: 520,
      height: 680
    };
  }

  getPreload () {
    return 'task-manager';
  }

  isPopup () {
    return true;
  }

  getBackgroundColor () {
    return '#000000';
  }

  static show (editorWindow) {
    const existing = AbstractWindow.getWindowsByClass(TaskManagerWindow);
    if (existing.length) {
      existing[0].show();
      return existing[0];
    }
    return new TaskManagerWindow(editorWindow);
  }
}

module.exports = TaskManagerWindow;

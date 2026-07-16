const AbstractWindow = require('./abstract');
const { Notification } = require('electron');

class TodoListWindow extends AbstractWindow {
  constructor (editorWindow) {
    super();

    this.editorWindow = editorWindow;
    this.reminders = new Map(); // Map<todoId, { timer, reminderTime }>

    this.window.on('page-title-updated', event => {
      event.preventDefault();
    });
    this.window.setTitle('待办清单');

    this.ipc.handle('todo-get-theme', () => {
      if (!this.editorWindow || this.editorWindow.window.isDestroyed()) {
        return 'light';
      }
      return new Promise((resolve) => {
        const requestId = Date.now().toString();
        const {ipcMain} = require('electron');
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

    this.ipc.handle('todo-close-window', () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.close();
      }
      return { success: true };
    });

    // 设置提醒
    this.ipc.handle('todo-set-reminder', (event, { todoId, todoText, reminderTime }) => {
      this.setReminder(todoId, todoText, reminderTime);
      return { success: true };
    });

    // 取消提醒
    this.ipc.handle('todo-cancel-reminder', (event, { todoId }) => {
      this.cancelReminder(todoId);
      return { success: true };
    });

    // 获取所有提醒
    this.ipc.handle('todo-get-reminders', () => {
      const reminders = {};
      for (const [todoId, data] of this.reminders) {
        reminders[todoId] = {
          reminderTime: data.reminderTime
        };
      }
      return reminders;
    });

    this.loadURL('tw-todo-list://./todo-list.html');
    this.show();
  }

  setReminder(todoId, todoText, reminderTime) {
    // 先取消已有的提醒
    this.cancelReminder(todoId);

    const now = Date.now();
    const targetTime = new Date(reminderTime).getTime();
    const delay = targetTime - now;

    if (delay <= 0) {
      // 时间已过，立即通知
      this.showNotification(todoText);
      return;
    }

    const timer = setTimeout(() => {
      this.showNotification(todoText);
      this.reminders.delete(todoId);
      // 通知渲染进程提醒已触发
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('todo-reminder-triggered', { todoId });
      }
    }, delay);

    this.reminders.set(todoId, { timer, reminderTime });
  }

  cancelReminder(todoId) {
    if (this.reminders.has(todoId)) {
      clearTimeout(this.reminders.get(todoId).timer);
      this.reminders.delete(todoId);
    }
  }

  showNotification(todoText) {
    if (!Notification.isSupported()) {
      return;
    }

    const notification = new Notification({
      title: '待办提醒',
      body: todoText,
      silent: false
    });

    notification.show();
  }

  getDimensions () {
    return {
      width: 480,
      height: 560
    };
  }

  getPreload () {
    return 'todo-list';
  }

  isPopup () {
    return true;
  }

  getBackgroundColor () {
    return '#f5f5f7';
  }

  static show (editorWindow) {
    const existing = AbstractWindow.getWindowsByClass(TodoListWindow);
    if (existing.length) {
      existing[0].show();
      return existing[0];
    }
    return new TodoListWindow(editorWindow);
  }
}

module.exports = TodoListWindow;

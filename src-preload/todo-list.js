const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('TodoListPreload', {
  getTheme: () => ipcRenderer.invoke('todo-get-theme'),
  closeWindow: () => ipcRenderer.invoke('todo-close-window'),
  onThemeChanged: (callback) => {
    ipcRenderer.on('todo-theme-changed', (event, data) => callback(data));
  },
  removeThemeListener: () => {
    ipcRenderer.removeAllListeners('todo-theme-changed');
  },
  // 提醒相关 API
  setReminder: (todoId, todoText, reminderTime) =>
    ipcRenderer.invoke('todo-set-reminder', { todoId, todoText, reminderTime }),
  cancelReminder: (todoId) =>
    ipcRenderer.invoke('todo-cancel-reminder', { todoId }),
  getReminders: () =>
    ipcRenderer.invoke('todo-get-reminders'),
  onReminderTriggered: (callback) => {
    ipcRenderer.on('todo-reminder-triggered', (event, data) => callback(data));
  },
  removeReminderTriggeredListener: () => {
    ipcRenderer.removeAllListeners('todo-reminder-triggered');
  }
});

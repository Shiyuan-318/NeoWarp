const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const MAX_RECENT_PROJECTS = 10;
const MAX_RETURNED = 6;

// 串行化设置写入，避免多处同时打开文件时并发写 tw_config.json
let saveQueue = Promise.resolve();

const notifyHomeWindows = () => {
  // Imported late due to circular dependencies
  const HomeWindow = require('./windows/home');
  HomeWindow.broadcastRecentProjects();
};

/**
 * 记录一次最近打开的本地项目（Scratch 工程或 .js 扩展工程）。
 * 相同路径只保留一条并移到最前；不存在的文件在读取时被过滤。
 * @param {string} filePath 本地文件绝对路径
 * @param {'scratch'|'extension'} type
 */
const recordRecentProject = (filePath, type) => {
  if (typeof filePath !== 'string' || !filePath) {
    return;
  }
  const resolved = path.resolve(filePath);
  const entry = {
    path: resolved,
    type: type === 'extension' ? 'extension' : 'scratch',
    name: path.basename(resolved),
    openedAt: Date.now()
  };

  saveQueue = saveQueue.then(async () => {
    const list = settings.recentProjects.filter((i) => i && i.path !== resolved);
    list.unshift(entry);
    settings.recentProjects = list.slice(0, MAX_RECENT_PROJECTS);
    try {
      await settings.save();
    } catch (e) {
      // 写入失败不影响打开项目
      return;
    }
    notifyHomeWindows();
  });
};

/**
 * 读取最近项目列表，过滤掉已被移动或删除的文件。
 * @returns {Array<{path: string, type: string, name: string, openedAt: number}>}
 */
const getRecentProjects = () => settings.recentProjects.filter((i) => {
  if (!i || typeof i.path !== 'string') {
    return false;
  }
  try {
    return fs.existsSync(i.path);
  } catch (e) {
    return false;
  }
}).slice(0, MAX_RETURNED);

module.exports = {
  recordRecentProject,
  getRecentProjects
};

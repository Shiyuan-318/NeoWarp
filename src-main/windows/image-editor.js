const path = require('path');
const {dialog} = require('electron');
const AbstractWindow = require('./abstract');
const {getEffectiveTheme} = require('../effective-theme');
const fsPromises = require('fs/promises');

const LIGHT_BACKGROUND = '#f2f2f7';
const DARK_BACKGROUND = '#0a0a0d';

class ImageEditorWindow extends AbstractWindow {
  constructor () {
    super();

    this.window.on('page-title-updated', event => {
      event.preventDefault();
    });
    this.window.setTitle('图片编辑器');

    this.ipc.handle('image-editor-get-theme', () => getEffectiveTheme());

    // 渲染进程应用主题后回带，用于同步窗口背景色，避免边缘露底
    this.ipc.on('image-editor-theme-applied', (event, theme) => {
      try {
        this.window.setBackgroundColor(theme === 'light' ? LIGHT_BACKGROUND : DARK_BACKGROUND);
      } catch (e) {
        // window destroyed
      }
    });

    // 打开图片：弹文件对话框，读取为 base64 返回给渲染层
    this.ipc.handle('image-editor-open-file', async () => {
      const result = await dialog.showOpenDialog(this.window, {
        properties: ['openFile'],
        filters: [
          {
            name: 'Image',
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']
          }
        ]
      });
      if (result.canceled || !result.filePaths.length) {
        return null;
      }
      const filePath = result.filePaths[0];
      const data = await fsPromises.readFile(filePath);
      return {
        path: filePath,
        name: path.basename(filePath),
        mime: ImageEditorWindow.mimeForExtension(path.extname(filePath)),
        data: data.toString('base64')
      };
    });

    // 保存/导出：弹保存对话框，写入渲染层传来的二进制数据
    this.ipc.handle('image-editor-save-file', async (event, payload) => {
      const {defaultName, mime, data} = payload || {};
      const extension = ImageEditorWindow.extensionForMime(mime) || 'png';
      const result = await dialog.showSaveDialog(this.window, {
        defaultPath: defaultName || `image.${extension}`,
        filters: [
          {
            name: extension.toUpperCase(),
            extensions: [extension]
          }
        ]
      });
      if (result.canceled || !result.filePath) {
        return 'cancelled';
      }
      let target = result.filePath;
      if (path.extname(target).toLowerCase() !== `.${extension}`) {
        target = `${target}.${extension}`;
      }
      const buffer = Buffer.from(String(data), 'base64');
      await fsPromises.writeFile(target, buffer);
      return 'saved';
    });

    this.loadURL('tw-image-editor://./index.html');
  }

  /**
   * @param {string} extension including the dot, e.g. ".png"
   */
  static mimeForExtension (extension) {
    const map = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.avif': 'image/avif'
    };
    return map[String(extension).toLowerCase()] || 'image/png';
  }

  /**
   * @param {string} mime e.g. "image/png"
   */
  static extensionForMime (mime) {
    const map = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp'
    };
    return map[mime] || null;
  }

  getPreload () {
    return 'image-editor';
  }

  getDimensions () {
    return {
      width: 1240,
      height: 800
    };
  }

  isPopup () {
    return true;
  }

  getBackgroundColor () {
    return DARK_BACKGROUND;
  }

  static show () {
    const existing = AbstractWindow.getWindowsByClass(ImageEditorWindow);
    if (existing.length) {
      existing[0].show();
      return existing[0];
    }
    const window = new ImageEditorWindow();
    window.show();
    return window;
  }
}

module.exports = ImageEditorWindow;

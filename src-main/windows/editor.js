const fsPromises = require('fs/promises');
const path = require('path');
const nodeURL = require('url');
const zlib = require('zlib');
const nodeCrypto = require('crypto');
const {app, dialog} = require('electron');
const os = require('os');
const ProjectRunningWindow = require('./project-running-window');
const AddonsWindow = require('./addons');
const DesktopSettingsWindow = require('./desktop-settings');
const PrivacyWindow = require('./privacy');
const AboutWindow = require('./about');
const ContactWindow = require('./contact');
const PackagerWindow = require('./packager');
const {createAtomicWriteStream} = require('../atomic-write-stream');
const {translate, updateLocale, getStrings} = require('../l10n');
const {APP_NAME} = require('../brand');
const prompts = require('../prompts');
const settings = require('../settings');
const privilegedFetch = require('../fetch');
const RichPresence = require('../rich-presence.js');
const FileAccessWindow = require('./file-access-window.js');
const ExtensionDocumentationWindow = require('./extension-documentation.js');
const DetachedStageWindow = require('./detached-stage.js');
const AIAssistantWindow = require('./ai-assistant');
const TodoListWindow = require('./todo-list');
const ProjectAnalysisWindow = require('./project-analysis');
const TaskManagerWindow = require('./task-manager');
const CollaborationWindow = require('./collaboration');
const AbstractWindow = require('./abstract');

const TYPE_FILE = 'file';
const TYPE_URL = 'url';
const TYPE_SCRATCH = 'scratch';
const TYPE_SAMPLE = 'sample';

// .npnp encrypted file format constants
const NPNP_MAGIC = Buffer.from('NPNP\x01');
const NPNP_SALT_LENGTH = 16;
const NPNP_IV_LENGTH = 12; // For AES-256-GCM
const NPNP_AUTH_TAG_LENGTH = 16;
const NPNP_PBKDF2_ITERATIONS = 100000;

// .viewsb3 encrypted file format constants (fixed-key encryption for view-only sharing)
const VSB3_MAGIC = Buffer.from('VSB3\x01');
const VSB3_SALT = Buffer.from('NeoWarpViewSb3FixedSalt2024', 'utf8');
const VSB3_IV = Buffer.from('ViewSb3FixIV', 'utf8');
const VSB3_PBKDF2_PASSWORD = 'neowarp-viewsb3-viewonly-v1';
const VSB3_PBKDF2_ITERATIONS = 10000;

/**
 * Get the fixed key for viewsb3 encryption/decryption
 * @returns {Buffer} 32-byte key
 */
const getViewSb3Key = () => {
  return nodeCrypto.pbkdf2Sync(VSB3_PBKDF2_PASSWORD, VSB3_SALT, VSB3_PBKDF2_ITERATIONS, 32, 'sha256');
};

/**
 * Encrypt data for .viewsb3 format using AES-256-GCM with a fixed key
 * @param {Buffer} data - The data to encrypt
 * @returns {Buffer} The encrypted data in .viewsb3 format
 */
const encryptViewSb3 = (data) => {
  const key = getViewSb3Key();
  const iv = VSB3_IV;

  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([VSB3_MAGIC, iv, authTag, encrypted]);
};

/**
 * Decrypt .viewsb3 file data
 * @param {Buffer} data - The encrypted file data
 * @returns {Buffer} The decrypted sb3 data
 * @throws {Error} If the file is not a valid .viewsb3 file
 */
const decryptViewSb3 = (data) => {
  if (data.length < 5 + 12 + 16 ||
      !data.slice(0, 5).equals(VSB3_MAGIC)) {
    throw new Error('Not a valid .viewsb3 file');
  }

  const iv = data.slice(5, 5 + 12);
  const authTag = data.slice(5 + 12, 5 + 12 + 16);
  const encrypted = data.slice(5 + 12 + 16);

  const key = getViewSb3Key();

  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (e) {
    throw new Error('Corrupted .viewsb3 file');
  }
};

/**
 * Encrypt data using AES-256-GCM with a password-derived key
 * @param {Buffer} data - The data to encrypt
 * @param {string} password - The encryption password
 * @returns {Buffer} The encrypted data in .npnp format
 */
const encryptNpnp = (data, password) => {
  const salt = nodeCrypto.randomBytes(NPNP_SALT_LENGTH);
  const iv = nodeCrypto.randomBytes(NPNP_IV_LENGTH);

  const key = nodeCrypto.pbkdf2Sync(password, salt, NPNP_PBKDF2_ITERATIONS, 32, 'sha512');

  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([NPNP_MAGIC, salt, iv, authTag, encrypted]);
};

/**
 * Decrypt .npnp file data
 * @param {Buffer} data - The encrypted file data
 * @param {string} password - The decryption password
 * @returns {Buffer} The decrypted sb3 data
 * @throws {Error} If the file is not a valid .npnp file or the password is wrong
 */
const decryptNpnp = (data, password) => {
  // Verify magic bytes
  if (data.length < 5 + NPNP_SALT_LENGTH + NPNP_IV_LENGTH + NPNP_AUTH_TAG_LENGTH ||
      !data.slice(0, 5).equals(NPNP_MAGIC)) {
    throw new Error('Not a valid .npnp file');
  }

  const salt = data.slice(5, 5 + NPNP_SALT_LENGTH);
  const iv = data.slice(5 + NPNP_SALT_LENGTH, 5 + NPNP_SALT_LENGTH + NPNP_IV_LENGTH);
  const authTag = data.slice(5 + NPNP_SALT_LENGTH + NPNP_IV_LENGTH, 5 + NPNP_SALT_LENGTH + NPNP_IV_LENGTH + NPNP_AUTH_TAG_LENGTH);
  const encrypted = data.slice(5 + NPNP_SALT_LENGTH + NPNP_IV_LENGTH + NPNP_AUTH_TAG_LENGTH);

  const key = nodeCrypto.pbkdf2Sync(password, salt, NPNP_PBKDF2_ITERATIONS, 32, 'sha512');

  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (e) {
    throw new Error('Wrong password or corrupted file');
  }
};

class OpenedFile {
  constructor (type, path) {
    /** @type {TYPE_FILE|TYPE_URL|TYPE_SCRATCH|TYPE_SAMPLE} */
    this.type = type;

    /**
     * Absolute file path or URL
     * @type {string}
     */
    this.path = path;
  }

  async read () {
    if (this.type === TYPE_FILE) {
      return {
        name: path.basename(this.path),
        data: await fsPromises.readFile(this.path)
      };
    }

    if (this.type === TYPE_URL) {
      const buffer = await privilegedFetch(this.path);
      return {
        name: decodeURIComponent(path.basename(this.path)),
        data: buffer
      };
    }

    if (this.type === TYPE_SCRATCH) {
      const metadata = await privilegedFetch.json(`https://api.scratch.mit.edu/projects/${this.path}`);
      const token = metadata.project_token;
      const title = metadata.title;

      const projectBuffer = await privilegedFetch(`https://projects.scratch.mit.edu/${this.path}?token=${token}`);
      return {
        name: title,
        data: projectBuffer
      };
    }

    if (this.type === TYPE_SAMPLE) {
      const sampleRoot = path.resolve(__dirname, '../../dist-extensions/samples/');
      const resolvedPath = path.join(sampleRoot, this.path);
      if (resolvedPath.startsWith(sampleRoot)) {
        const compressedPath = `${resolvedPath}.br`;
        const compressedData = await fsPromises.readFile(compressedPath);

        // dist-extensions is all brotli'd; must decompress
        const decompressedData = await new Promise((resolve, reject) => {
          zlib.brotliDecompress(compressedData, (err, res) => {
            if (err) {
              reject(err);
            } else {
              resolve(res);
            }
          });
        });

        return {
          name: this.path,
          data: decompressedData
        };
      }
      throw new Error('Unsafe join');
    }

    throw new Error(`Unknown type: ${this.type}`);
  }
}

/**
 * @param {string} file
 * @param {string|null} workingDirectory
 * @returns {OpenedFile}
 */
const parseOpenedFile = (file, workingDirectory) => {
  let url;
  try {
    url = new URL(file);
  } catch (e) {
    // Error means it was not a valid full URL
  }

  if (url) {
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      // Scratch URLs require special treatment as they are not direct downloads.
      const scratchMatch = file.match(/^https?:\/\/scratch\.mit\.edu\/projects\/(\d+)\/?/);
      if (scratchMatch) {
        return new OpenedFile(TYPE_SCRATCH, scratchMatch[1]);
      }

      // Need to manually redirect extension samples to the copies we already have offline as the
      // fetching code will not go through web request handlers or custom protocols.
      const sampleMatch = file.match(/^https?:\/\/extensions\.turbowarp\.org\/samples\/(.+\.sb3)$/);
      if (sampleMatch) {
        return new OpenedFile(TYPE_SAMPLE, decodeURIComponent(sampleMatch[1]));
      }

      return new OpenedFile(TYPE_URL, file);
    }

    // Parse file:// URLs.
    // Notably we receive these in the flatpak version of the app when we can only access a file through
    // the XDG document portal instead of having direct access with eg. --filesystem=home
    if (url.protocol === 'file:') {
      let filePath;
      try {
        filePath = nodeURL.fileURLToPath(file);
      } catch (e) {
        // Very unlikely but possible
      }

      if (filePath) {
        return new OpenedFile(TYPE_FILE, path.resolve(workingDirectory, filePath));
      }
    }

    // Don't throw an error just because we don't recognize the URL protocol as
    // Windows paths look close enough to real URLs to be parsed successfully.
  }

  return new OpenedFile(TYPE_FILE, path.resolve(workingDirectory, file));
};

/**
 * @returns {Array<{path: string; app: string;}>}
 */
const getUnsafePaths = () => {
  if (process.platform !== 'win32') {
    // This problem doesn't really exist on other platforms
    return [];
  }

  const localPrograms = path.join(app.getPath('home'), 'AppData', 'Local', 'Programs');
  const appData = app.getPath('appData');
  return [
    // Current app, regardless of where it is installed or how modded it is
    {
      path: path.dirname(app.getPath('exe')),
      app: APP_NAME,
    },
    {
      path: app.getPath('userData'),
      app: APP_NAME,
    },

    // TurboWarp Desktop defaults
    {
      path: path.join(appData, 'turbowarp-desktop'),
      app: 'TurboWarp Desktop'
    },
    {
      path: path.join(localPrograms, 'TurboWarp'),
      app: 'TurboWarp Desktop'
    },

    // Scratch Desktop defaults
    {
      path: path.join(appData, 'Scratch'),
      app: 'Scratch Desktop'
    },
    {
      path: path.join(localPrograms, 'Scratch 3'),
      app: 'Scratch Desktop'
    }
  ];
};

/**
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
const isChildPath = (parent, child) => {
  const relative = path.relative(parent, child);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * @returns {string} A unique string.
 */
const generateFileId = () => {
  // Note that we can't use the randomUUID from web crypto as we need to support Electron 22.
  return `desktop_file_id{${nodeCrypto.randomUUID()}}`;
};

class EditorWindow extends ProjectRunningWindow {
  /**
   * @param {OpenedFile|null} initialFile
   * @param {boolean} isInitiallyFullscreen
   */
  constructor (initialFile, isInitiallyFullscreen) {
    super();

    /**
     * Ideally we would revoke access after loading a new project, but our file handle handling in
     * the GUI isn't robust enough for that yet. We do at least use random file handle IDs which
     * makes it much harder for malicious code in the renderer process to enumerate all previously
     * opened IDs and overwrite them.
     * @type {Map<string, OpenedFile>}
     */
    this.openedFiles = new Map();
    this.activeFileId = null;

    if (initialFile !== null) {
      this.activeFileId = generateFileId();
      this.openedFiles.set(this.activeFileId, initialFile);
    }

    this.openedProjectAt = Date.now();

    /**
     * @param {string} id
     * @returns {OpenedFile}
     * @throws if invalid ID
     */
    const getFileById = (id) => {
      if (!this.openedFiles.has(id)) {
        throw new Error('Invalid file ID');
      }
      return this.openedFiles.get(id);
    };

    let processingWillPreventUnload = false;
    this.window.webContents.on('will-prevent-unload', () => {
      // Using showMessageBoxSync synchronously in the event handler causes broken focus on Windows.
      // See https://github.com/TurboWarp/desktop/issues/1245
      // To work around that, we won't cancel that will-prevent-unload event so the window stays
      // open. After a very short delay to let focus get fixed, we'll show a dialog and force close
      // the window ourselves if the user wants.

      // Due to the timeout, this event could theoretically fire multiple times before we show the
      // dialog. Make sure to only show one dialog if that happens.
      if (processingWillPreventUnload) {
        return;
      }
      processingWillPreventUnload = true;

      setTimeout(() => {
        const choice = dialog.showMessageBoxSync(this.window, {
          title: APP_NAME,
          type: 'info',
          buttons: [
            translate('unload.stay'),
            translate('unload.leave')
          ],
          cancelId: 0,
          defaultId: 0,
          message: translate('unload.message'),
          detail: translate('unload.detail'),
          noLink: true
        });
        if (choice === 1) {
          this.window.destroy();
        }
        processingWillPreventUnload = false;
      });
    });

    this.window.on('page-title-updated', (event, title, explicitSet) => {
      event.preventDefault();
      if (explicitSet && title) {
        this.window.setTitle(`${title} - ${APP_NAME}`);
        this.projectTitle = title;
      } else {
        this.window.setTitle(APP_NAME);
        this.projectTitle = '';
      }

      this.updateRichPresence();
    });
    this.window.setTitle(APP_NAME);

    // Clean up collaboration when editor closes
    this.window.on('closed', () => {
      const collabWindows = AbstractWindow.getWindowsByClass(CollaborationWindow);
      for (const cw of collabWindows) {
        cw.forceClose = true;
        if (cw.server) {
          cw.server.end().then(() => { cw.server = null; });
        }
        if (cw.ws) {
          try { cw.ws.close(); } catch (e) {}
          cw.ws = null;
        }
        if (cw.window && !cw.window.isDestroyed()) {
          cw.window.destroy();
        }
      }
    });

    this.window.on('focus', () => {
      this.updateRichPresence();
    });

    this.ipc.on('is-initially-fullscreen', (e) => {
      e.returnValue = isInitiallyFullscreen;
    });

    this.ipc.handle('get-initial-file', () => {
      return this.activeFileId;
    });

    this.ipc.handle('get-file', async (event, id) => {
      const file = getFileById(id);
      const {name, data} = await file.read();

      // Check if this is a .viewsb3 view-only file
      const isViewSb3 = name.endsWith('.viewsb3') ||
        (data && data.length >= 5 && data.slice(0, 5).equals(VSB3_MAGIC));
      if (isViewSb3) {
        try {
          const decrypted = decryptViewSb3(data);
          return {
            name,
            type: file.type,
            data: decrypted,
            isViewOnly: true
          };
        } catch (e) {
          console.error('Failed to decrypt .viewsb3 file:', e.message);
          return {
            name,
            type: file.type,
            data: null,
            isViewOnly: true,
            error: 'Failed to open .viewsb3 file'
          };
        }
      }

      // Check if this is an encrypted .npnp file
      const isNpnp = name.endsWith('.npnp') ||
        (data && data.length >= 5 && data.slice(0, 5).equals(NPNP_MAGIC));
      if (isNpnp) {
        return {
          name,
          type: file.type,
          data: null,
          isEncrypted: true
        };
      }

      return {
        name,
        type: file.type,
        data
      };
    });

    this.ipc.on('set-locale', async (event, locale) => {
      if (settings.locale !== locale) {
        settings.locale = locale;
        updateLocale(locale);

        // Imported late due to circular dependency
        const rebuildMenuBar = require('../menu-bar');
        rebuildMenuBar();

        // Let the save happen in the background, not important
        Promise.resolve().then(() => settings.save());

        // Broadcast locale change to AI assistant window
        const AbstractWindow = require('./abstract');
        const aiWindows = AbstractWindow.getWindowsByClass(AIAssistantWindow);
        aiWindows.forEach((win) => {
          if (win.window && !win.window.isDestroyed()) {
            win.window.webContents.send('ai-locale-changed', { locale });
          }
        });
      }
      event.returnValue = {
        strings: getStrings()
      };
    });

    this.ipc.handle('set-changed', (event, changed) => {
      this.window.setDocumentEdited(changed);
    });

    this.ipc.handle('opened-file', (event, id) => {
      const file = getFileById(id);
      if (file.type !== TYPE_FILE) {
        throw new Error('Not a file');
      }
      this.activeFileId = id;
      this.openedProjectAt = Date.now();
      this.window.setRepresentedFilename(file.path);
    });

    this.ipc.handle('closed-file', () => {
      this.activeFileId = null;
      this.window.setRepresentedFilename('');
    });

    this.ipc.handle('show-open-file-picker', async () => {
      const result = await dialog.showOpenDialog(this.window, {
        properties: ['openFile'],
        defaultPath: settings.lastDirectory,
        filters: [
          {
            name: 'Scratch Project',
            extensions: ['np1', 'sb3', 'sb2', 'sb', 'npnp', 'viewsb3'],
          }
        ]
      });
      if (result.canceled) {
        return null;
      }

      const filePath = result.filePaths[0];
      settings.lastDirectory = path.dirname(filePath);
      await settings.save();

      const id = generateFileId();
      this.openedFiles.set(id, new OpenedFile(TYPE_FILE, filePath));

      return {
        id,
        name: path.basename(filePath)
      };
    });

    this.ipc.handle('show-save-file-picker', async (event, suggestedName) => {
      const result = await dialog.showSaveDialog(this.window, {
        defaultPath: path.join(settings.lastDirectory, suggestedName),
        filters: [
          {
            name: 'NeoWarp Project',
            extensions: ['np1'],
          },
          {
            name: 'Scratch 3 Project',
            extensions: ['sb3'],
          }
        ]
      });
      if (result.canceled) {
        return null;
      }

      const filePath = result.filePath;

      const unsafePath = getUnsafePaths().find(i => isChildPath(i.path, filePath));
      if (unsafePath) {
        // No need to block until the message box is closed
        dialog.showMessageBox(this.window, {
          type: 'error',
          title: APP_NAME,
          message: translate('unsafe-path.title'),
          detail: translate(`unsafe-path.details`)
            .replace('{APP_NAME}', unsafePath.app)
            .replace('{file}', filePath),
          noLink: true
        });  
        return null;
      }

      settings.lastDirectory = path.dirname(filePath);
      await settings.save();

      const id = generateFileId();
      this.openedFiles.set(id, new OpenedFile(TYPE_FILE, filePath));

      return {
        id,
        name: path.basename(filePath)
      };
    });

    this.ipc.handle('get-preferred-media-devices', () => {
      return {
        microphone: settings.microphone,
        camera: settings.camera
      };
    });

    this.ipc.on('start-write-stream', async (startEvent, id) => {
      const file = getFileById(id);
      if (file.type !== TYPE_FILE) {
        throw new Error('Not a file');
      }

      const port = startEvent.ports[0];

      /** @type {NodeJS.WritableStream|null} */
      let writeStream = null;

      const handleError = (error) => {
        console.error('Write stream error', error);
        port.postMessage({
          error
        });

        // Make sure the port is started in case we encounter an error before we normally
        // begin to accept messages.
        port.start();
      };

      try {
        writeStream = await createAtomicWriteStream(file.path);
      } catch (error) {
        handleError(error);
        return;
      }

      writeStream.on('atomic-error', handleError);

      const handleMessage = (data) => {
        if (data.write) {
          if (writeStream.write(data.write)) {
            // Still more space in the buffer. Ask for more immediately.
            return;
          }
          // Wait for the buffer to become empty before asking for more.
          return new Promise(resolve => {
            writeStream.once('drain', resolve);
          });
        } else if (data.finish) {
          // Wait for the atomic file write to complete.
          return new Promise(resolve => {
            writeStream.once('atomic-finish', resolve);
            writeStream.end();
          });
        } else if (data.abort) {
          writeStream.emit('error', new Error('Aborted by renderer process'));
          return;
        }
        throw new Error('Unknown message from renderer');
      };

      port.on('message', async (messageEvent) => {
        try {
          const data = messageEvent.data;
          const id = data.id;
          const result = await handleMessage(data);
          port.postMessage({
            response: {
              id,
              result
            }
          });
        } catch (error) {
          handleError(error);
        }
      });

      port.start();
    });

    this.ipc.on('alert', (event, message) => {
      event.returnValue = prompts.alert(this.window, message);
    });

    this.ipc.on('confirm', (event, message) => {
      event.returnValue = prompts.confirm(this.window, message);
    });

    this.ipc.handle('open-packager', () => {
      PackagerWindow.forEditor(this);
    });

    this.ipc.handle('show-encrypted-save-file-picker', async (event, suggestedName) => {
      const result = await dialog.showSaveDialog(this.window, {
        defaultPath: path.join(settings.lastDirectory, suggestedName + '.npnp'),
        filters: [
          {
            name: 'NeoWarp Encrypted Project',
            extensions: ['npnp'],
          }
        ]
      });
      if (result.canceled) {
        return null;
      }

      const filePath = result.filePath;

      const unsafePath = getUnsafePaths().find(i => isChildPath(i.path, filePath));
      if (unsafePath) {
        dialog.showMessageBox(this.window, {
          type: 'error',
          title: APP_NAME,
          message: translate('unsafe-path.title'),
          detail: translate(`unsafe-path.details`)
            .replace('{APP_NAME}', unsafePath.app)
            .replace('{file}', filePath),
          noLink: true
        });
        return null;
      }

      settings.lastDirectory = path.dirname(filePath);
      await settings.save();

      const id = generateFileId();
      this.openedFiles.set(id, new OpenedFile(TYPE_FILE, filePath));

      return {
        id,
        name: path.basename(filePath)
      };
    });

    this.ipc.handle('encrypt-and-save', async (event, fileId, data, password) => {
      const file = getFileById(fileId);
      if (file.type !== TYPE_FILE) {
        throw new Error('Not a file');
      }

      const encryptedData = encryptNpnp(Buffer.from(data), password);
      await fsPromises.writeFile(file.path, encryptedData);
    });

    this.ipc.handle('decrypt-npnp-file', async (event, fileId, password) => {
      const file = getFileById(fileId);
      const {data} = await file.read();
      return decryptNpnp(data, password);
    });

    this.ipc.handle('show-viewsb3-save-file-picker', async (event, suggestedName) => {
      const result = await dialog.showSaveDialog(this.window, {
        defaultPath: path.join(settings.lastDirectory, suggestedName + '.viewsb3'),
        filters: [
          {
            name: 'NeoWarp View-only Project',
            extensions: ['viewsb3'],
          }
        ]
      });
      if (result.canceled) {
        return null;
      }

      const filePath = result.filePath;

      const unsafePath = getUnsafePaths().find(i => isChildPath(i.path, filePath));
      if (unsafePath) {
        dialog.showMessageBox(this.window, {
          type: 'error',
          title: APP_NAME,
          message: translate('unsafe-path.title'),
          detail: translate('unsafe-path.details')
            .replace('{APP_NAME}', unsafePath.app)
            .replace('{file}', filePath),
          noLink: true
        });
        return null;
      }

      settings.lastDirectory = path.dirname(filePath);
      await settings.save();

      const id = generateFileId();
      this.openedFiles.set(id, new OpenedFile(TYPE_FILE, filePath));

      return {
        id,
        name: path.basename(filePath)
      };
    });

    this.ipc.handle('encrypt-and-save-viewsb3', async (event, fileId, data) => {
      const file = getFileById(fileId);
      if (file.type !== TYPE_FILE) {
        throw new Error('Not a file');
      }

      const encryptedData = encryptViewSb3(Buffer.from(data));
      await fsPromises.writeFile(file.path, encryptedData);
    });

    this.ipc.handle('fetch-image', async (event, url) => {
      try {
        const buffer = await privilegedFetch(url);
        return buffer;
      } catch (e) {
        throw new Error('Failed to fetch image: ' + e.message);
      }
    });

    this.ipc.handle('open-new-window', () => {
      EditorWindow.newWindow();
    });

    this.ipc.handle('open-addon-settings', (event, search) => {
      AddonsWindow.show(search);
    });

    this.ipc.handle('open-desktop-settings', () => {
      DesktopSettingsWindow.show();
    });

    this.ipc.handle('open-privacy', () => {
      PrivacyWindow.show();
    });

    this.ipc.handle('open-about', () => {
      AboutWindow.show();
    });

    this.ipc.handle('open-contact', () => {
      ContactWindow.show();
    });

    this.ipc.handle('open-ai-assistant', () => {
      AIAssistantWindow.show(this);
    });

    this.ipc.handle('open-todo-list', () => {
      TodoListWindow.show(this);
    });

    this.ipc.handle('open-project-analysis', () => {
      ProjectAnalysisWindow.show(this);
    });

    this.ipc.handle('open-task-manager', () => {
      TaskManagerWindow.show(this);
    });

    this.ipc.on('project-json-response', (event, data) => {
      const aiWindows = AbstractWindow.getWindowsByClass(AIAssistantWindow);
      aiWindows.forEach(w => {
        if (!w.window.isDestroyed()) w.window.webContents.send('project-code-response', data);
      });
    });

    this.ipc.on('sprite-library-response', (event, data) => {
      const aiWindows = AbstractWindow.getWindowsByClass(AIAssistantWindow);
      aiWindows.forEach(w => {
        if (!w.window.isDestroyed()) w.window.webContents.send('sprite-library-response', data);
      });
    });

    this.ipc.on('sprite-stats-response', (event, data) => {
      const tmWindows = AbstractWindow.getWindowsByClass(TaskManagerWindow);
      tmWindows.forEach(w => {
        if (!w.window.isDestroyed()) w.window.webContents.send('sprite-stats-response', data);
      });
    });

    this.ipc.on('theme-changed', (event, data) => {
      const aiWindows = AbstractWindow.getWindowsByClass(AIAssistantWindow);
      aiWindows.forEach(w => {
        if (!w.window.isDestroyed()) w.window.webContents.send('ai-theme-changed', data);
      });
      const todoWindows = AbstractWindow.getWindowsByClass(TodoListWindow);
      todoWindows.forEach(w => {
        if (!w.window.isDestroyed()) w.window.webContents.send('todo-theme-changed', data);
      });
      const paWindows = AbstractWindow.getWindowsByClass(ProjectAnalysisWindow);
      paWindows.forEach(w => {
        if (!w.window.isDestroyed()) w.window.webContents.send('pa-theme-changed', data);
      });
      const tmWindows = AbstractWindow.getWindowsByClass(TaskManagerWindow);
      tmWindows.forEach(w => {
        if (!w.window.isDestroyed()) w.window.webContents.send('tm-theme-changed', data);
      });
    });

    this.ipc.handle('get-advanced-customizations', async () => {
      const USERSCRIPT_PATH = path.join(app.getPath('userData'), 'userscript.js');
      const USERSTYLE_PATH = path.join(app.getPath('userData'), 'userstyle.css');

      const [userscript, userstyle] = await Promise.all([
        fsPromises.readFile(USERSCRIPT_PATH, 'utf-8').catch(() => ''),
        fsPromises.readFile(USERSTYLE_PATH, 'utf-8').catch(() => '')
      ]);

      return {
        userscript,
        userstyle
      };
    });

    this.ipc.on('get-code-area-background-image', (event) => {
      event.returnValue = settings.codeAreaBackgroundImage;
    });

    this.ipc.handle('set-code-area-background-image', async (event, imageData) => {
      settings.codeAreaBackgroundImage = imageData;
      AbstractWindow.settingsChanged();
      await settings.save();
    });

    this.ipc.on('get-stage-area-background-image', (event) => {
      event.returnValue = settings.stageAreaBackgroundImage;
    });

    this.ipc.on('get-top-bar-device-stats', (event) => {
      event.returnValue = settings.topBarDeviceStats;
    });

    this.ipc.handle('set-stage-area-background-image', async (event, imageData) => {
      settings.stageAreaBackgroundImage = imageData;
      AbstractWindow.settingsChanged();
      await settings.save();
    });

    this.ipc.handle('check-drag-and-drop-path', (event, filePath) => {
      FileAccessWindow.check(filePath);
    });

    /**
     * Refers to the full screen button in the editor, not the OS-level fullscreen through
     * F11/Alt+Enter (Windows, Linux) or buttons provided by the OS (macOS).
     */
    this.isInEditorFullScreen = false;

    this.ipc.handle('set-is-full-screen', (event, isFullScreen) => {
      this.isInEditorFullScreen = !!isFullScreen;
    });

    // NeoWarp: System stats monitoring
    // Store initial CPU times for calculating usage percentage like Task Manager
    this.lastCpuTimes = this._getCpuTimes();
    this.lastCpuCheckTime = Date.now();
    
    this.ipc.handle('get-system-stats', () => {
      const currentCpuTimes = this._getCpuTimes();
      const currentTime = Date.now();
      const timeDelta = (currentTime - this.lastCpuCheckTime) / 1000; // Convert to seconds
      
      // Calculate CPU usage percentage like Windows Task Manager
      // Formula: (idle time difference / total time difference) * 100
      const idleDiff = currentCpuTimes.idle - this.lastCpuTimes.idle;
      const totalDiff = currentCpuTimes.total - this.lastCpuTimes.total;
      
      let cpuPercent = 0;
      if (totalDiff > 0) {
        cpuPercent = Math.round((1 - idleDiff / totalDiff) * 100);
      }
      
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      
      // Update last values for next calculation
      this.lastCpuTimes = currentCpuTimes;
      this.lastCpuCheckTime = currentTime;
      
      return {
        cpuPercent: Math.min(Math.max(cpuPercent, 0), 100), // Clamp between 0-100
        ramUsedMB: Math.round(usedMemory / 1024 / 1024),
        ramTotalMB: Math.round(totalMemory / 1024 / 1024)
      };
    });

    // NeoWarp: Detached stage window
    this.detachedStageWindow = null;

    // NeoWarp: Collaboration state
    this.collaborationState = {
      isCollaborating: false,
      role: null, // 'host' or 'participant'
      onlineCount: 0,
      permissions: null
    };

    this.ipc.handle('detach-stage', () => {
      if (this.detachedStageWindow) {
        return;
      }
      this.detachedStageWindow = new DetachedStageWindow(this.window, this);
      this.window.webContents.send('stage-detached');
    });

    this.ipc.handle('reattach-stage', () => {
      if (this.detachedStageWindow) {
        this.detachedStageWindow.close();
        this.detachedStageWindow = null;
      }
    });

    this.ipc.on('stage-frame', (event, dataURL) => {
      if (this.detachedStageWindow) {
        this.detachedStageWindow.sendFrame(dataURL);
      }
    });

    // NeoWarp: Collaboration
    this.ipc.handle('open-collaboration-host', () => {
      CollaborationWindow.showHost(this);
    });

    this.ipc.handle('open-collaboration-join', () => {
      CollaborationWindow.showJoin(this);
    });

    this.ipc.handle('end-collaboration', () => {
      // Forward to collaboration window if it exists
      const collabWindows = AbstractWindow.getWindowsByClass(CollaborationWindow);
      if (collabWindows.length > 0) {
        collabWindows[0].window.webContents.send('collab-end-requested');
      }
    });

    this.ipc.handle('leave-collaboration', () => {
      const collabWindows = AbstractWindow.getWindowsByClass(CollaborationWindow);
      if (collabWindows.length > 0) {
        collabWindows[0].window.webContents.send('collab-leave-requested');
      }
    });

    this.ipc.handle('open-collaboration-chat', () => {
      CollaborationWindow.focusChat(this);
    });

    this.ipc.handle('check-collaboration-permission', (event, action) => {
      if (!this.collaborationState.isCollaborating) {
        return { allowed: true };
      }
      // Host always has full permissions
      if (this.collaborationState.role === 'host') {
        return { allowed: true };
      }
      // Participant: check permissions
      const perms = this.collaborationState.permissions || {};
      const permissionMap = {
        'add-extension': perms.allowAddExtension !== false,
        'delete-extension': perms.allowDeleteExtension !== false,
        'delete-sprite': perms.allowDeleteSprite !== false
      };
      return { allowed: permissionMap[action] !== false };
    });

    // Listen for collaboration state changes from collaboration window
    this.ipc.on('collab-state-change', (event, data) => {
      this.collaborationState = {
        isCollaborating: data.isCollaborating,
        role: data.role,
        onlineCount: data.onlineCount || 0,
        permissions: data.permissions || null
      };
      // Push to renderer
      this.window.webContents.send('collaboration-state-changed', this.collaborationState);
    });

    // Listen for chat messages to forward to editor renderer
    this.ipc.on('collab-chat-forward', (event, data) => {
      this.window.webContents.send('collaboration-chat-message', data);
    });

    // Listen for collaboration ended
    this.ipc.on('collab-ended-forward', (event, data) => {
      this.collaborationState = {
        isCollaborating: false,
        role: null,
        onlineCount: 0,
        permissions: null
      };
      this.window.webContents.send('collaboration-ended', data);
      this.window.webContents.send('collaboration-state-changed', this.collaborationState);
    });

    this.loadURL('tw-editor://./gui/gui.html');
    this.show();
  }

  handleDetachedStageClosed() {
    this.detachedStageWindow = null;
    try {
      this.window.webContents.send('stage-reattached');
    } catch (e) {
      // Window might be closing
    }
  }

  handleDetachedStageInput(inputData) {
    try {
      this.window.webContents.send('detached-stage-input', inputData);
    } catch (e) {
      // Window might be closing
    }
  }

  /**
   * Get aggregated CPU times across all cores
   * Similar to how Windows Task Manager calculates CPU usage
   */
  _getCpuTimes() {
    const cpus = os.cpus();
    let user = 0;
    let nice = 0;
    let sys = 0;
    let idle = 0;
    let irq = 0;
    
    for (const cpu of cpus) {
      user += cpu.times.user;
      nice += cpu.times.nice;
      sys += cpu.times.sys;
      idle += cpu.times.idle;
      irq += cpu.times.irq;
    }
    
    return {
      user,
      nice,
      sys,
      idle,
      irq,
      total: user + nice + sys + idle + irq
    };
  }

  getPreload () {
    return 'editor';
  }

  getDimensions () {
    return {
      width: 1280,
      height: 800
    };
  }

  getBackgroundColor () {
    return '#333333';
  }

  applySettings () {
    this.window.webContents.setBackgroundThrottling(settings.backgroundThrottling);
  }

  enumerateMediaDevices () {
    // Used by desktop settings
    return new Promise((resolve, reject) => {
      this.ipc.once('enumerated-media-devices', (event, result) => {
        if (typeof result.error !== 'undefined') {
          reject(result.error);
        } else {
          resolve(result.devices);
        }
      });
      this.window.webContents.send('enumerate-media-devices');
    });
  }

  handleWindowOpen (details) {
    const url = new URL(details.url);
    const params = new URLSearchParams(url.search);

    // Open extension sample projects in-app
    if (
      url.protocol === 'tw-editor:' &&
      url.host === '.' &&
      params.has('project_url')
    ) {
      const projectUrl = params.get('project_url');
      const parsedFile = parseOpenedFile(projectUrl, null);
      if (parsedFile.type === TYPE_SAMPLE) {
        new EditorWindow(parsedFile, null);
        return {
          action: 'deny'
        };
      }
    }

    // Open extension documentation in-app
    const extensionsDocsMatch = details.url.match(
      /^https:\/\/extensions\.turbowarp\.org\/([\w_\-.\/]+)$/
    );
    if (extensionsDocsMatch) {
      ExtensionDocumentationWindow.open(extensionsDocsMatch[1]);
      return {
        action: 'deny'
      };
    }

    return super.handleWindowOpen(details);
  }

  canExitFullscreenByPressingEscape () {
    return !this.isInEditorFullScreen;
  }

  updateRichPresence () {
    RichPresence.setActivity(this.projectTitle, this.openedProjectAt);
  }

  /**
   * @param {string[]} files
   * @param {boolean} fullscreen
   * @param {string|null} workingDirectory
   */
  static openFiles (files, fullscreen, workingDirectory) {
    if (files.length === 0) {
      EditorWindow.newWindow(fullscreen);
    } else {
      for (const file of files) {
        new EditorWindow(parseOpenedFile(file, workingDirectory), fullscreen);
      }
    }
  }

  /**
   * Open a new window with the default project.
   * @param {boolean} fullscreen
   */
  static newWindow (fullscreen) {
    new EditorWindow(null, fullscreen);
  }
}

module.exports = EditorWindow;

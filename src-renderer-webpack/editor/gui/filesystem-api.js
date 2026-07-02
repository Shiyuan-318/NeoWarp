/**
 * Partial reimplementation of the FileSystem API (https://web.dev/file-system-access/)
 * 
 * Unlike the default FileSystem API, we can construct a file handle from an ID from
 * the main process without showing the file picker. The IDs are managed by the main
 * process, so malicious extensions can't abuse this to get arbitrary read/write,
 * and it lets us not share full file paths which could contain eg. the user's name.
 */

/**
 * @param {unknown} contents
 * @returns {Uint8Array}
 */
const toUnit8Array = (contents) => {
  if (contents instanceof Uint8Array) {
    return contents;
  }
  if (contents instanceof Blob) {
    throw new Error('Should never receive a Blob here.');
  }
  return new Uint8Array(contents);
};

class WrappedFileWritable {
  /**
   * @param {string} id File ID from main
   */
  constructor (id) {
    this._channel = new MessageChannel();

    /** @type {Map<string, {resolve: () => void, reject: (error: unknown) => void}>} */
    this._callbacks = new Map();
    this._lastMessageId = 1;

    /**
     * Error from the main process, if any.
     * @type {unknown}
     */
    this._error = null;

    this._channel.port1.onmessage = (event) => {
      const data = event.data;

      const error = data.error;
      if (error) {
        this._error = error;
        for (const handlers of this._callbacks.values()) {
          handlers.reject(error);
        }
        this._callbacks.clear();
      }

      const response = data.response;
      if (response) {
        const id = response.id;
        const handlers = this._callbacks.get(id);
        if (handlers) {
          handlers.resolve(response.result);
          this._callbacks.delete(id);
        }
      }
    };

    // Note that we don't need to wait for the other end before we can start sending data. The messages
    // will just be queued up.
    // We use this weird postMessage because Electron's context bridge doesn't handle the channel objects.
    window.postMessage({
      ipcStartWriteStream: id
    }, window.origin, [this._channel.port2])
  }

  _sendToMainAndWait (message) {
    if (this._error) {
      throw this._error;
    }

    const messageId = this._lastMessageId++;
    message.id = messageId;
    return new Promise((resolve, reject) => {
      this._callbacks.set(messageId, {
        resolve,
        reject
      });
      this._channel.port1.postMessage(message);
    });
  }

  async write (contents) {
    await this._sendToMainAndWait({
      write: toUnit8Array(contents)
    });
  }

  async close () {
    await this._sendToMainAndWait({
      finish: true
    });
  }

  async abort () {
    await this._sendToMainAndWait({
      abort: true
    });
  }
}

class WrappedFileHandle {
  /**
   * @param {string} id File ID from main.
   * @param {string} name Name including file extension.
   */
  constructor (id, name) {
    this.id = id;
    this.name = name;
  }

  async getFile () {
    const result = await EditorPreload.getFile(this.id);

    // Handle encrypted .npnp files
    if (result.isEncrypted) {
      const { showPasswordDialog } = require('../encrypted-save-dialog/encrypted-save-dialog.js');
      let decrypted = false;
      let projectData = null;
      while (!decrypted) {
        const password = await showPasswordDialog();
        if (!password) {
          throw new AbortError('User cancelled password input');
        }
        try {
          projectData = await EditorPreload.decryptNpnpFile(this.id, password);
          decrypted = true;
        } catch (e) {
          // Wrong password, show dialog again
          continue;
        }
      }
      return new File([projectData], this.name);
    }

    // Handle .viewsb3 view-only files (already decrypted by main process)
    if (result.isViewOnly) {
      if (result.error) {
        throw new Error(result.error);
      }
      return new File([result.data], this.name);
    }

    return new File([result.data], this.name);
  }

  async createWritable () {
    return new WrappedFileWritable(this.id);
  }
}

class AbortError extends Error {
  constructor (message) {
    super(message);
    this.name = 'AbortError';
  }
}

const showOpenFilePicker = async () => {
  const result = await EditorPreload.showOpenFilePicker();
  if (result === null) {
    throw new AbortError('No file selected');
  }
  return [new WrappedFileHandle(result.id, result.name)];
};

const showSaveFilePicker = async (options) => {
  const result = await EditorPreload.showSaveFilePicker(options.suggestedName);
  if (result === null) {
    throw new AbortError('No file selected');
  }
  return new WrappedFileHandle(result.id, result.name);
};

const showViewsb3SaveFilePicker = async (suggestedName) => {
  const result = await EditorPreload.showViewsb3SaveFilePicker(suggestedName);
  if (result === null) {
    throw new AbortError('No file selected');
  }
  return new WrappedFileHandle(result.id, result.name);
};

export {
  WrappedFileHandle,
  showOpenFilePicker,
  showSaveFilePicker,
  showViewsb3SaveFilePicker
};

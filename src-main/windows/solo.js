const path = require('path');
const fsPromises = require('fs/promises');
const {app, dialog, ipcMain} = require('electron');
const AbstractWindow = require('./abstract');
const AIAssistantWindow = require('./ai-assistant');
const SoloStageWindow = require('./solo-stage');
const settings = require('../settings');
const {createAtomicWriteStream, writeFileAtomic} = require('../atomic-write-stream');

/**
 * SOLO 里 AI 自主新建 sb3 工程时用：scratch-gui 的默认素材（白背景 + 默认小猫），
 * 组装出一个与编辑器"新建工程"等效的空白 sb3，VM/积木工具都能直接用。
 */
const DEFAULT_BACKDROP_SVG = path.resolve(__dirname, '../../node_modules/scratch-gui/src/lib/default-project/cd21514d0531fdffb22204e0ec5ed84a.svg');
const DEFAULT_COSTUME_SVG = path.resolve(__dirname, '../../node_modules/scratch-gui/src/lib/default-project/dango-cat.svg');

const buildBlankSb3 = () => {
  // 打包后 node_modules 在 asar 里，fs 能照常读；读不到就退回纯 JSON 工程
  //（VM 会以空背景呈现，但工程结构完整，积木工具照常工作）
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  const projectJSON = {
    targets: [
      {
        isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {},
        blocks: {}, comments: {}, currentCostume: 0,
        costumes: [{
          name: 'backdrop1',
          assetId: 'cd21514d0531fdffb22204e0ec5ed84a',
          md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg',
          dataFormat: 'svg',
          rotationCenterX: 240,
          rotationCenterY: 180
        }],
        sounds: [], volume: 100, layerOrder: 0, tempo: 60,
        videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null
      },
      {
        isStage: false, name: 'Sprite1', variables: {}, lists: {}, broadcasts: {},
        blocks: {}, comments: {}, currentCostume: 0,
        costumes: [{
          name: 'costume1',
          assetId: '927d672925e7b99f7813735c484c6922',
          md5ext: '927d672925e7b99f7813735c484c6922.svg',
          dataFormat: 'svg',
          bitmapResolution: 1,
          rotationCenterX: 30.74937882782359,
          rotationCenterY: 45.23841652903746
        }],
        sounds: [], volume: 100, layerOrder: 1, visible: true,
        x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'
      }
    ],
    monitors: [], extensions: [],
    meta: {semver: '3.0.0', vm: '2.3.0', agent: 'NeoWarp'}
  };
  zip.addFile('project.json', Buffer.from(JSON.stringify(projectJSON)));
  try {
    zip.addFile('cd21514d0531fdffb22204e0ec5ed84a.svg', require('fs').readFileSync(DEFAULT_BACKDROP_SVG));
    zip.addFile('927d672925e7b99f7813735c484c6922.svg', require('fs').readFileSync(DEFAULT_COSTUME_SVG));
  } catch (e) {
    // 素材缺失时只写 project.json，costume 加载失败由 Scratch 显示为空白，不阻塞流程
  }
  return zip.toBuffer();
};

/**
 * Windows 下阻止把文件写进应用安装目录 / userData（覆盖程序自身的风险），
 * 与 extension-editor.js 的防护逻辑一致。
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
 * AI 给的工程名转成安全文件名：去掉各平台非法字符与首尾空白，限制长度。
 */
const sanitizeFileName = (name, fallback) => {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
};

const assertSafeWritePath = (filePath) => {
  const target = path.resolve(filePath);
  for (const unsafe of getUnsafePaths()) {
    if (target === unsafe || isChildPath(unsafe, target)) {
      throw new Error('Refusing to write inside the application directory');
    }
  }
  return target;
};

/**
 * 读 js 工程时单次返回给模型的上限，避免几十 MB 文本把上下文撑爆
 */
const JS_READ_LIMIT = 200 * 1024;

/**
 * 从舞台帧 dataURL 的 PNG 头部解析像素尺寸。
 * scratch-render 的 requestSnapshot 输出的是舞台画布原尺寸的 PNG；
 * 只用它的宽高比（决定舞台窗口的形状），即便带 DPI 缩放也不影响结果。
 * @param {string} dataURL
 * @returns {{width: number, height: number}|null}
 */
const parseFrameSize = (dataURL) => {
  if (typeof dataURL !== 'string' || !dataURL.startsWith('data:image/png;base64,')) {
    return null;
  }
  // 只解码头部 64 个 base64 字符（= 48 字节），足够覆盖 PNG 签名 + IHDR
  const head = Buffer.from(dataURL.slice(22, 22 + 64), 'base64');
  if (head.length < 24 || head.readUInt32BE(0) !== 0x89504e47) return null;
  const width = head.readUInt32BE(16);
  const height = head.readUInt32BE(20);
  return width > 0 && height > 0 ? {width, height} : null;
};

/**
 * NeoWarp SOLO：纯 AI 界面的编程工作区，不显示 Scratch 编辑器。
 * 复用 AI 助手的全部 IPC（继承），并额外提供：
 *  - 选择 .sb3 工程：挂一个隐藏的 EditorWindow 作为 VM/工具宿主，AI 照常改工程
 *  - 选择 .js 工程：主进程直接提供文件读写工具，AI 直接改源码
 *  - 保存：把后台工程打包成 sb3 写回源文件（js 则是写工具即存即改）
 */
class SoloWindow extends AIAssistantWindow {
  constructor () {
    // 初始不带编辑器；用户选择 sb3 后才挂隐藏编辑器
    super(null);

    /**
     * 当前选中的工程
     * @type {{type: 'sb3'|'js', name: string, path: string}|null}
     */
    this.soloProject = null;

    /**
     * SOLO 舞台窗口（由侧边栏预览点击弹出）；null 表示没开
     * @type {SoloStageWindow|null}
     */
    this.stageWindow = null;
    // 用户手动暂停状态（与 VM 帧循环是否在跑区分开：stopAll 后帧循环还转着，
    // 但工程不再运行；这里只记录"暂停按钮按下过"）
    this.stagePaused = false;
    // 后台 VM 是否在运行（绿旗按下过且没被停止/暂停）
    this.stageRunning = false;
    // 最近一帧舞台画面的像素尺寸（来自帧 PNG 头），决定弹出的舞台窗口比例
    this.stageFrameSize = null;

    this.window.setTitle('NeoWarp SOLO');

    this.ipc.handle('solo-get-state', () => ({
      project: this.soloProject
    }));

    this.ipc.handle('solo-pick-project', (event, type) => this.pickProject(type));

    this.ipc.handle('solo-save-project', () => this.saveSb3Project());

    // 侧边栏预览区域点击 → 弹出舞台窗口
    this.ipc.handle('solo-open-stage-window', () => this.openStageWindow());

    // 后台编辑器推来的舞台帧 → 广播给 SOLO 页面（预览）和舞台窗口（大画面）
    this.onSoloStageFrame = (event, dataURL) => {
      // 发送方必须是当前隐藏编辑器（别的窗口不该有 solo-stage-frame，防御一下）
      if (!this.editorWindow || this.editorWindow.window.isDestroyed() ||
          event.sender !== this.editorWindow.window.webContents) {
        return;
      }
      // 帧尺寸即舞台画布尺寸：记下来给舞台窗口算比例，比例变了就地调整窗口
      const frameSize = parseFrameSize(dataURL);
      if (frameSize) {
        this.stageFrameSize = frameSize;
        if (this.stageWindow) {
          this.stageWindow.fitToStage(frameSize);
        }
      }
      try {
        this.window.webContents.send('solo-stage-frame', dataURL);
      } catch (e) {
        // Window might be closing
      }
      if (this.stageWindow) {
        this.stageWindow.sendFrame(dataURL);
      }
    };
    ipcMain.on('solo-stage-frame', this.onSoloStageFrame);

    // 后台编辑器上报的运行状态（RUNTIME_STARTED/STOPPED）→ 舞台窗口按钮亮灭
    this.onSoloStageRunStatus = (event, status) => {
      if (!this.editorWindow || this.editorWindow.window.isDestroyed() ||
          event.sender !== this.editorWindow.window.webContents) {
        return;
      }
      if (status && status.running) {
        // 绿旗起跑：之前若是手动暂停挡着，现在解除
        this.stagePaused = false;
        this.stageRunning = true;
      }
      if (this.stageWindow) {
        this.stageWindow.sendRunStatus({
          running: this.stageRunning,
          paused: this.stagePaused
        });
      }
    };
    ipcMain.on('solo-stage-run-status', this.onSoloStageRunStatus);

    // 后台编辑器推来的舞台 DOM 覆盖层（变量监视器 + 提问框）→ 舞台窗口渲染。
    // 这些元素在 scratch-gui 里是 DOM，canvas 快照拍不到，需要单独转发
    this.onSoloStageOverlays = (event, data) => {
      if (!this.editorWindow || this.editorWindow.window.isDestroyed() ||
          event.sender !== this.editorWindow.window.webContents) {
        return;
      }
      if (this.stageWindow) {
        this.stageWindow.sendOverlays(data);
      }
    };
    ipcMain.on('solo-stage-overlays', this.onSoloStageOverlays);

    // 舞台窗口提问框提交的"回答" → 转发给后台编辑器交给 VM
    this.onSoloStageWindowAnswer = (event, data) => {
      if (!this.stageWindow || this.stageWindow.window.isDestroyed() ||
          event.sender !== this.stageWindow.window.webContents) {
        return;
      }
      if (!this.editorWindow || this.editorWindow.window.isDestroyed()) {
        return;
      }
      try {
        this.editorWindow.window.webContents.send('solo-stage-answer', {
          text: String((data && data.text) ?? '')
        });
      } catch (e) {
        // Window might be closing
      }
    };
    ipcMain.on('solo-stage-window-answer', this.onSoloStageWindowAnswer);

    // 舞台窗口按钮（绿旗/暂停/继续/停止）→ 后台编辑器
    this.onSoloStageControl = (event, action) => {
      // 只接受自己舞台窗口发来的指令
      if (!this.stageWindow || this.stageWindow.window.isDestroyed() ||
          event.sender !== this.stageWindow.window.webContents) {
        return;
      }
      this.controlStage(action);
    };
    ipcMain.on('solo-stage-window-control', this.onSoloStageControl);

    this.window.on('closed', () => {
      this.disposeEditor();
      this.removeStageIPC();
    });
  }

  /**
   * 弹出文件选择框并装载工程。
   * @param {'sb3'|'js'} type
   * @returns {Promise<object|null>} 选中的工程信息；取消返回 null
   */
  async pickProject (type) {
    const isJs = type === 'js';
    const result = await dialog.showOpenDialog(this.window, {
      properties: ['openFile'],
      defaultPath: settings.lastDirectory,
      filters: [
        isJs
          ? {name: 'JavaScript', extensions: ['js']}
          : {name: 'Scratch Project', extensions: ['sb3', 'np1', 'sb2', 'sb']}
      ]
    });
    if (result.canceled || !result.filePaths.length) {
      return null;
    }

    const filePath = result.filePaths[0];
    settings.lastDirectory = path.dirname(filePath);
    await settings.save();

    await this.adoptProject(filePath, isJs ? 'js' : 'sb3');
    return this.soloProject;
  }

  /**
   * 让后台编辑器把当前工程打包成 sb3 字节流并写回源文件。
   * @returns {Promise<object>}
   */
  async saveSb3Project () {
    if (!this.soloProject || this.soloProject.type !== 'sb3') {
      return {success: false, error: 'No sb3 project selected'};
    }
    if (!this.editorWindow || this.editorWindow.window.isDestroyed()) {
      return {success: false, error: 'Project is not loaded'};
    }

    const exported = await new Promise((resolve) => {
      const requestId = Date.now().toString() + Math.random().toString(16).slice(2);
      let timer = null;
      const handler = (event, data) => {
        if (data && data.requestId === requestId) {
          ipcMain.removeListener('solo-export-project-response', handler);
          if (timer) clearTimeout(timer);
          resolve(data);
        }
      };
      ipcMain.on('solo-export-project-response', handler);
      this.editorWindow.window.webContents.send('solo-export-project', {requestId});
      // 大工程压缩全部素材可能要很久，给足时间
      timer = setTimeout(() => {
        ipcMain.removeListener('solo-export-project-response', handler);
        resolve(null);
      }, 180000);
    });

    if (!exported) {
      return {success: false, error: 'Export timeout'};
    }
    if (exported.error) {
      return {success: false, error: exported.error};
    }

    try {
      const target = assertSafeWritePath(this.soloProject.path);
      await this.writeBinaryAtomic(target, Buffer.from(exported.data));
      return {success: true, bytes: exported.data.byteLength, path: target};
    } catch (error) {
      return {success: false, error: String((error && error.message) || error)};
    }
  }

  /**
   * @param {string} filePath
   * @param {Buffer} buffer
   */
  async writeBinaryAtomic (filePath, buffer) {
    const stream = await createAtomicWriteStream(filePath);
    return new Promise((resolve, reject) => {
      stream.on('atomic-error', reject);
      stream.once('atomic-finish', resolve);
      // 不能直接把 buffer 塞给 end()：新版 Node 的 end(chunk) 不再经过被
      // createAtomicWriteStream 重写过的 write()，完整性哈希会漏算这段数据
      stream.write(buffer);
      stream.end();
    });
  }

  /**
   * AI 工具分发：js 工程的文件工具在主进程本地处理，其余走父类的编辑器转发。
   * 未选工程时只提供 create_project：AI 自行判断工程类型后在桌面新建。
   * @param {string} toolName
   * @param {object} params
   * @returns {Promise<object>}
   */
  async handleAIToolCall (toolName, params) {
    if (!this.soloProject) {
      if (toolName === 'createProject') {
        return this.createAiProject(params);
      }
      return {success: false, error: 'No project is loaded. Analyze the user request, then call create_project (type "sb3" for Scratch projects, "js" for JavaScript) to create one on the Desktop.'};
    }
    if (this.soloProject.type === 'js') {
      if (toolName === 'readJsFile') {
        return this.jsReadFile();
      }
      if (toolName === 'writeJsFile') {
        return this.jsWriteFile(params && params.content);
      }
      // js 工程没有 Scratch VM，积木类工具必然失败，给个说得明白的错误
      return {success: false, error: 'Current project is a JavaScript file. Use read_js_file / write_js_file to work with it.'};
    }
    return super.handleAIToolCall(toolName, params);
  }

  /**
   * create_project：AI 判断好类型后，在桌面新建工程文件并挂载为当前工程。
   * sb3 → 写一个空白工程（默认小猫），挂隐藏编辑器；js → 写源码文件即可。
   * @param {object} params {type: 'sb3'|'js', name?: string, content?: string}
   * @returns {Promise<object>} data.project 为新工程信息（渲染层据此同步 UI）
   */
  async createAiProject (params) {
    const type = params && params.type === 'js' ? 'js' : params && params.type === 'sb3' ? 'sb3' : null;
    if (!type) {
      return {success: false, error: 'type must be "sb3" or "js"'};
    }

    // 桌面路径：个别系统取不到时退回用户主目录
    let desktop;
    try {
      desktop = app.getPath('desktop');
    } catch (e) {
      desktop = app.getPath('home');
    }

    // 文件名：去掉非法字符，重名自动追加序号，绝不覆盖已有文件
    const base = sanitizeFileName(params && params.name, 'Untitled');
    let candidate = `${base}.${type}`;
    let counter = 2;
    for (;;) {
      try {
        await fsPromises.access(path.join(desktop, candidate));
        candidate = `${base} (${counter}).${type}`;
        counter++;
      } catch (e) {
        break;
      }
    }
    const target = path.join(desktop, candidate);

    try {
      if (type === 'js') {
        const content = typeof (params && params.content) === 'string' && params.content.trim() ?
          params.content :
          `// ${candidate} — NeoWarp SOLO\n// Describe what this extension should do to the AI and it will write the code here.\n`;
        await writeFileAtomic(target, content);
      } else {
        await this.writeBinaryAtomic(target, buildBlankSb3());
      }
    } catch (error) {
      return {success: false, error: 'Failed to create project on Desktop: ' + String((error && error.message) || error)};
    }

    // 挂载为新工程（复用 pickProject 的编辑器挂载逻辑，但不再弹文件对话框）
    await this.adoptProject(target, type);

    return {
      success: true,
      data: {
        project: {...this.soloProject},
        message: `Project created at ${target}. It is now the active project — continue with the regular tools.`
      }
    };
  }

  /**
   * 把一个已存在的工程文件挂为当前工程（选工程与 AI 新建共用）。
   * @param {string} filePath
   * @param {'sb3'|'js'} type
   */
  async adoptProject (filePath, type) {
    // 换工程前清掉旧的隐藏编辑器，避免多个后台 VM 互相抢响应
    this.disposeEditor();
    this.stageRunning = false;
    this.stagePaused = false;
    // 新工程的舞台比例还未知，等帧来了再更新
    this.stageFrameSize = null;

    const isJs = type === 'js';
    if (!isJs) {
      // Imported late due to circular dependencies
      const EditorWindow = require('./editor');
      const editor = EditorWindow.openHidden(filePath);
      this.editorWindow = editor;
      // 隐藏编辑器若意外销毁（渲染进程崩溃等），引用一并清掉，
      // 后续工具调用会得到明确的 "Editor window not available" 而不是打去死窗口
      editor.window.on('closed', () => {
        if (this.editorWindow === editor) {
          this.editorWindow = null;
          this.stopStageStream();
        }
      });
      // 编辑器页面就绪（did-finish-load）后开始转发舞台帧；
      // 太早发指令页面还没挂监听，会白等一轮
      editor.window.webContents.once('did-finish-load', () => {
        this.startStageStream();
      });
    } else {
      // js 工程没有后台 VM，停掉可能残留的舞台帧流并关掉舞台窗口
      this.stopStageStream();
      this.closeStageWindow();
    }

    this.soloProject = {
      type: isJs ? 'js' : 'sb3',
      name: path.basename(filePath),
      path: filePath
    };

    // 页面（以及已连接的手机）立刻同步新工程状态：chip、舞台预览等
    try {
      this.window.webContents.send('solo-project-changed', {project: this.soloProject});
    } catch (e) {
      // Window might be closing
    }
  }

  async jsReadFile () {
    try {
      let content = await fsPromises.readFile(this.soloProject.path, 'utf8');
      let truncated = false;
      if (content.length > JS_READ_LIMIT) {
        content = content.substring(0, JS_READ_LIMIT);
        truncated = true;
      }
      return {
        success: true,
        data: {
          name: this.soloProject.name,
          path: this.soloProject.path,
          content,
          truncated
        }
      };
    } catch (error) {
      return {success: false, error: String((error && error.message) || error)};
    }
  }

  async jsWriteFile (content) {
    if (typeof content !== 'string' || !content.length) {
      return {success: false, error: 'content must be a non-empty string'};
    }
    try {
      const target = assertSafeWritePath(this.soloProject.path);
      await writeFileAtomic(target, content);
      return {success: true, data: {path: target, bytes: Buffer.byteLength(content, 'utf8')}};
    } catch (error) {
      return {success: false, error: String((error && error.message) || error)};
    }
  }

  disposeEditor () {
    if (this.editorWindow && !this.editorWindow.window.isDestroyed()) {
      // destroy 绕过 will-prevent-unload 的未保存确认：
      // SOLO 里保存是用户显式触发的，关窗口不该再弹确认框
      this.stopStageStream();
      this.editorWindow.window.destroy();
    }
    this.editorWindow = null;
    this.closeStageWindow();
  }

  /* ── SOLO 舞台：帧流转发、舞台窗口、控制指令 ── */

  /**
   * 让后台编辑器开始把舞台画面帧发给本窗口。幂等：重复调用没有副作用。
   */
  startStageStream () {
    if (this.editorWindow && !this.editorWindow.window.isDestroyed()) {
      try {
        this.editorWindow.window.webContents.send('solo-stage-stream', {active: true});
      } catch (e) {
        // Window might be closing
      }
    }
  }

  stopStageStream () {
    if (this.editorWindow && !this.editorWindow.window.isDestroyed()) {
      try {
        this.editorWindow.window.webContents.send('solo-stage-stream', {active: false});
      } catch (e) {
        // Window might be closing
      }
    }
  }

  /**
   * 侧边栏预览被点击：弹出（或聚焦已有的）舞台窗口。
   * @returns {{success: boolean, error?: string}}
   */
  openStageWindow () {
    if (!this.soloProject || this.soloProject.type !== 'sb3') {
      return {success: false, error: 'No sb3 project selected'};
    }
    if (!this.editorWindow || this.editorWindow.window.isDestroyed()) {
      return {success: false, error: 'Project is not loaded'};
    }
    this.stageWindow = SoloStageWindow.show(this.window, this);
    return {success: true};
  }

  closeStageWindow () {
    if (this.stageWindow && !this.stageWindow.window.isDestroyed()) {
      this.stageWindow.window.destroy();
    }
    this.stageWindow = null;
  }

  handleStageWindowClosed () {
    this.stageWindow = null;
  }

  /**
   * 最近一帧舞台画面的像素尺寸；还没收到帧（或刚换工程）时为 null，
   * 舞台窗口会退回默认 4:3。
   * @returns {{width: number, height: number}|null}
   */
  getStageFrameSize () {
    return this.stageFrameSize;
  }

  /**
   * 把绿旗/暂停/继续/停止指令发给后台编辑器的 VM，并等待结果。
   * @param {'greenFlag'|'pause'|'resume'|'stop'} action
   * @returns {Promise<object>}
   */
  controlStage (action) {
    if (!this.editorWindow || this.editorWindow.window.isDestroyed()) {
      return Promise.resolve({success: false, error: 'Project is not loaded'});
    }
    if (action === 'pause') this.stagePaused = true;
    if (action === 'resume' || action === 'greenFlag' || action === 'stop') this.stagePaused = false;
    return new Promise((resolve) => {
      const requestId = Date.now().toString() + Math.random().toString(16).slice(2);
      let timer = null;
      const handler = (event, data) => {
        if (data && data.requestId === requestId) {
          ipcMain.removeListener('solo-stage-control-response', handler);
          if (timer) clearTimeout(timer);
          const result = data.result || {success: false, error: 'No response'};
          this.stageRunning = !!(result.data && result.data.running);
          if (this.stageWindow) {
            this.stageWindow.sendRunStatus({
              running: this.stageRunning,
              paused: this.stagePaused
            });
          }
          resolve(result);
        }
      };
      ipcMain.on('solo-stage-control-response', handler);
      this.editorWindow.window.webContents.send('solo-stage-control', {requestId, action});
      timer = setTimeout(() => {
        ipcMain.removeListener('solo-stage-control-response', handler);
        resolve({success: false, error: 'Stage control timeout'});
      }, 5000);
    });
  }

  /**
   * 舞台窗口就绪后主动问一次 VM 运行状态，让按钮摆到正确的档位。
   */
  queryStageRunState () {
    if (!this.stageWindow || this.stageWindow.window.isDestroyed()) return;
    if (!this.editorWindow || this.editorWindow.window.isDestroyed()) return;
    const requestId = Date.now().toString() + Math.random().toString(16).slice(2);
    let timer = null;
    const handler = (event, data) => {
      if (data && data.requestId === requestId) {
        ipcMain.removeListener('solo-stage-control-response', handler);
        if (timer) clearTimeout(timer);
        const result = data.result || {};
        this.stageRunning = !!(result.data && result.data.running);
        this.stageWindow.sendState({
          running: this.stageRunning,
          paused: this.stagePaused
        });
      }
    };
    ipcMain.on('solo-stage-control-response', handler);
    this.editorWindow.window.webContents.send('solo-stage-control', {requestId, action: 'getState'});
    timer = setTimeout(() => {
      ipcMain.removeListener('solo-stage-control-response', handler);
      // 超时也把已知状态发过去，窗口至少能正常显示
      this.stageWindow.sendState({running: !!this.stageRunning, paused: this.stagePaused});
    }, 3000);
  }

  removeStageIPC () {
    ipcMain.removeListener('solo-stage-frame', this.onSoloStageFrame);
    ipcMain.removeListener('solo-stage-run-status', this.onSoloStageRunStatus);
    ipcMain.removeListener('solo-stage-overlays', this.onSoloStageOverlays);
    ipcMain.removeListener('solo-stage-window-answer', this.onSoloStageWindowAnswer);
    ipcMain.removeListener('solo-stage-window-control', this.onSoloStageControl);
    this.closeStageWindow();
  }

  getPageURL () {
    return 'tw-solo://./ai-assistant.html';
  }

  getPreload () {
    return 'solo';
  }

  getDimensions () {
    return {
      width: 1200,
      height: 760
    };
  }

  isPopup () {
    // SOLO 是独立工作区，Esc 不应直接关窗（页面里的 Esc 仍用于中断生成）
    return false;
  }

  static show () {
    const existing = AbstractWindow.getWindowsByClass(SoloWindow);
    if (existing.length) {
      existing[0].show();
      return existing[0];
    }
    return new SoloWindow();
  }
}

module.exports = SoloWindow;

const vm = require('vm');

/**
 * 积木预览：解析 TurboWarp 扩展 JS 代码中 getInfo() 返回的积木定义。
 *
 * 渲染层 CSP 为 script-src 'self'（禁 eval），因此解析在主进程用 node:vm
 * 沙箱执行：mock 掉 Scratch 全局后运行代码，捕获 extensions.register()
 * 收到的扩展对象，再逐个调用 getInfo() 并把结果归一化成纯数据结构，
 * 方便通过 IPC 传给渲染层显示积木预览。
 *
 * 所有执行均带 500ms 超时与 try/catch，恶意/异常代码不会挂死主进程。
 */

const EXEC_TIMEOUT_MS = 500;

const DEFAULT_COLOR1 = '#4C97FF';

const HEX_COLOR_RE = /^#([0-9a-f]{3,8})$/i;

const UNTITLED_EXTENSION_NAME = '未命名扩展';
const UNTITLED_BLOCK_TEXT = '未命名积木';

// 通过 vm 执行 getInfo：扩展对象可能是类（先尝试实例化，失败则直接当对象用），
// 单个 getInfo 抛错或死循环（触发超时）只跳过该项，不影响其它扩展。
const GET_INFO_SCRIPT = `(function () {
  try {
    var o = __extObj;
    if (typeof o === "function") {
      try {
        o = new o();
      } catch (err) {
        /* 实例化失败则直接当对象用 */
      }
    }
    if (o && typeof o.getInfo === "function") {
      return o.getInfo();
    }
    return null;
  } catch (err) {
    return null;
  }
})()`;

/**
 * 万能 stub：可调用、可 new，任意属性链可继续取。
 * Symbol.toPrimitive / toString / valueOf 返回空串，避免字符串拼接等场景崩溃。
 */
const createStub = () => {
  const children = new Map();
  const stubFn = function stub () {};
  return new Proxy(stubFn, {
    get (target, prop) {
      if (prop === Symbol.toPrimitive) {
        return () => '';
      }
      if (prop === 'toString' || prop === 'valueOf') {
        return () => '';
      }
      if (!children.has(prop)) {
        children.set(prop, createStub());
      }
      return children.get(prop);
    },
    apply () {
      return createStub();
    },
    construct () {
      return createStub();
    }
  });
};

/**
 * Scratch 全局 mock。已知常量取 TurboWarp 真实取值；
 * 其余属性（vm、Cast、IconType 等）宽容处理，返回万能 stub。
 * extensions.register 挂在基础对象上，每次 get 返回同一函数。
 */
const createScratchMock = (registered) => {
  const base = {
    ArgumentType: {
      NUMBER: 'number',
      STRING: 'string',
      BOOLEAN: 'Boolean',
      ANGLE: 'angle',
      COLOR: 'color',
      MATRIX: 'matrix'
    },
    BlockType: {
      COMMAND: 'command',
      REPORTER: 'reporter',
      BOOLEAN: 'Boolean',
      HAT: 'hat',
      CONDITIONAL: 'conditional',
      LOOP: 'loop',
      LABEL: 'label'
    },
    CostumeType: {
      BITMAP: 'bitmap',
      VECTOR: 'vector'
    },
    SoundType: {
      WAV: 'wav',
      MP3: 'mp3'
    },
    TargetType: {
      SPRITE: 'sprite',
      STAGE: 'stage'
    },
    extensions: {
      register: (extensionObject) => {
        registered.push(extensionObject);
      },
      unsandboxed: false
    }
  };
  const children = new Map();
  return new Proxy(base, {
    get (target, prop) {
      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        return target[prop];
      }
      if (prop === Symbol.toPrimitive) {
        return () => '';
      }
      if (prop === 'toString' || prop === 'valueOf') {
        return () => '';
      }
      if (!children.has(prop)) {
        children.set(prop, createStub());
      }
      return children.get(prop);
    }
  });
};

/**
 * 在独立 vm 上下文中实例化并调用 getInfo，带超时保护。
 * @param {object|Function} extObject 注册的扩展对象（或类）。
 * @returns {object|null} getInfo 的返回值；失败/超时返回 null。
 */
const callGetInfo = (extObject) => {
  try {
    const context = vm.createContext({__extObj: extObject});
    return vm.runInContext(GET_INFO_SCRIPT, context, {
      timeout: EXEC_TIMEOUT_MS,
      displayErrors: true
    });
  } catch (e) {
    return null;
  }
};

/**
 * 从 locale 键对象中挑选字符串：
 * zh 开头的 locale 依次找以 zh 开头的键，随后回退 en 键、任意第一个 string 值。
 * 其它 locale 同理按前缀匹配。string 原样返回，数组取第一项。
 */
const pickLocalized = (value, locale) => {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return value[0];
  }
  if (value && typeof value === 'object') {
    const prefix = typeof locale === 'string' && locale ?
      locale.toLowerCase().split(/[-_]/)[0] : '';
    const keys = Object.keys(value);
    if (prefix) {
      for (const key of keys) {
        if (
          key.toLowerCase().startsWith(prefix) &&
          typeof value[key] === 'string'
        ) {
          return value[key];
        }
      }
    }
    if (typeof value.en === 'string') {
      return value.en;
    }
    for (const key of keys) {
      if (typeof value[key] === 'string') {
        return value[key];
      }
    }
  }
  return undefined;
};

const isHexColor = (value) =>
  typeof value === 'string' && HEX_COLOR_RE.test(value);

/**
 * 归一化单个积木定义。数组形式 keyOpcode 为 undefined，对象形式为键名。
 * 非对象项返回 null（调用方跳过）。
 */
const normalizeBlock = (block, keyOpcode, locale) => {
  if (!block || typeof block !== 'object') {
    return null;
  }
  const text = pickLocalized(block.text, locale);
  return {
    opcode: block.opcode !== undefined && block.opcode !== null ?
      block.opcode : keyOpcode,
    blockType: String(block.blockType || ''),
    text: typeof text === 'string' ? text : UNTITLED_BLOCK_TEXT,
    arguments: block.arguments && typeof block.arguments === 'object' ?
      block.arguments : undefined
  };
};

/**
 * 归一化 blocks：数组原样逐项处理；对象（opcode 为键）按 Object.entries 展开，
 * 积木 opcode 缺省时用键名补齐。
 */
const normalizeBlocks = (blocks, locale) => {
  const result = [];
  if (Array.isArray(blocks)) {
    for (const item of blocks) {
      const normalized = normalizeBlock(item, undefined, locale);
      if (normalized) {
        result.push(normalized);
      }
    }
  } else if (blocks && typeof blocks === 'object') {
    for (const opcode of Object.keys(blocks)) {
      const normalized = normalizeBlock(blocks[opcode], opcode, locale);
      if (normalized) {
        result.push(normalized);
      }
    }
  }
  return result;
};

/**
 * 归一化单个 getInfo() 返回值，只保留纯数据字段，方便 IPC 结构化克隆。
 */
const normalizeInfo = (info, locale) => {
  const result = {
    id: typeof info.id === 'string' && info.id ? info.id : 'extension',
    name: UNTITLED_EXTENSION_NAME,
    color1: isHexColor(info.color1) ? info.color1 : DEFAULT_COLOR1,
    color2: isHexColor(info.color2) ? info.color2 : undefined,
    blocks: normalizeBlocks(info.blocks, locale)
  };
  const name = pickLocalized(info.name, locale);
  if (typeof name === 'string') {
    result.name = name;
  }
  if (info.menus !== undefined && info.menus !== null) {
    result.menus = info.menus;
  }
  return result;
};

/**
 * 解析扩展代码，提取所有 getInfo() 的积木定义。
 * @param {string} code 扩展 JS 源码。
 * @param {string} locale 用于挑选多语言 name/text 的区域设置（如 'zh-CN'）。
 * @returns {{ok: boolean, extensions: Array|null, error: string|null}}
 */
const extractExtensionInfos = (code, locale) => {
  if (typeof code !== 'string' || code.trim().length === 0) {
    return {ok: false, extensions: null, error: 'empty'};
  }

  const registered = [];
  const mock = createScratchMock(registered);
  try {
    vm.runInNewContext('"use strict";\n' + code, {Scratch: mock}, {
      timeout: EXEC_TIMEOUT_MS,
      displayErrors: true
    });
  } catch (e) {
    return {ok: false, extensions: null, error: String(e && e.message || e)};
  }

  if (registered.length === 0) {
    return {ok: false, extensions: null, error: 'no-register'};
  }

  const infos = [];
  for (let i = 0; i < registered.length; i++) {
    const info = callGetInfo(registered[i]);
    if (info && typeof info === 'object') {
      infos.push(info);
    }
  }
  if (infos.length === 0) {
    return {ok: false, extensions: null, error: 'no-info'};
  }

  return {
    ok: true,
    extensions: infos.map((info) => normalizeInfo(info, locale)),
    error: null
  };
};

module.exports = {extractExtensionInfos};

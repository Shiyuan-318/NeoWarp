'use strict';

// 协作权限的语义判定。
//
// 渲染层对 deleteSprite / loadExtensionURL 的包装只是给本机用户的即时反馈，
// 不能当作安全边界：任何已通过密码认证的参与者都能直接往 WebSocket 里塞
// 一条 project-update。真正决定一次工程更新能否生效的，是这里对
// 「上一份工程 JSON → 这一份工程 JSON」的语义比较。
//
// project-update 是完整快照，所以「语义操作」只能从前后的差得出：
//   - 快照里少了一个角色，且它的内容也没有以新名字留下  → 删除角色
//   - extensions / extensionURLs 多了一个 id          → 添加扩展
//   - extensions / extensionURLs 少了一个 id          → 删除扩展
// 改名（名字变了但角色内容仍在）不算删除，因此不会被误伤。
//
// 本模块不依赖 Node / Electron / VM，主进程和渲染层共用同一套规则。

const OPERATION_DELETE_SPRITE = 'deleteSprite';
const OPERATION_ADD_EXTENSION = 'addExtension';
const OPERATION_DELETE_EXTENSION = 'deleteExtension';
const OPERATION_CHANGE_EXTENSION_URL = 'changeExtensionURL';

const OPERATION_LABELS = {
  [OPERATION_DELETE_SPRITE]: '删除角色',
  [OPERATION_ADD_EXTENSION]: '添加扩展',
  [OPERATION_DELETE_EXTENSION]: '删除扩展',
  // 换掉扩展的加载地址等于让协作者运行另一段代码，按「添加扩展」管
  [OPERATION_CHANGE_EXTENSION_URL]: '修改扩展来源'
};

// 语义操作 → 权限开关。权限缺省视为允许，只有明确写成 false 才拒绝，
// 这样旧版主机（不带权限字段）仍能正常工作。
const OPERATION_PERMISSIONS = {
  [OPERATION_DELETE_SPRITE]: 'allowDeleteSprite',
  [OPERATION_ADD_EXTENSION]: 'allowAddExtension',
  [OPERATION_DELETE_EXTENSION]: 'allowDeleteExtension',
  [OPERATION_CHANGE_EXTENSION_URL]: 'allowAddExtension'
};

const isPlainObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// 一份可用的工程快照至少要有一个舞台目标。
const isProjectSnapshot = project => {
  if (!isPlainObject(project) || !Array.isArray(project.targets) || project.targets.length === 0) {
    return false;
  }
  return project.targets.some(target => isPlainObject(target) && target.isStage === true);
};

const getTargets = project =>
  (isPlainObject(project) && Array.isArray(project.targets) ? project.targets : []);

const getSpriteTargets = project =>
  getTargets(project).filter(target => isPlainObject(target) && target.isStage !== true);

const stableStringify = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

// 角色内容指纹刻意忽略 name：改名只是换名字，被删掉的内容不可能以另一种
// 名字出现在新快照里。
const getTargetFingerprint = target => {
  const rest = {};
  for (const key of Object.keys(target)) {
    if (key === 'name') continue;
    rest[key] = target[key];
  }
  return stableStringify(rest);
};

const getSpriteNames = project => {
  const names = new Set();
  for (const target of getSpriteTargets(project)) {
    if (typeof target.name === 'string' && target.name) names.add(target.name);
  }
  return names;
};

// 与 scratch-vm 的 sb3.js 保持一致：核心积木前缀不算扩展，其余前缀都是扩展。
// 必须从积木 opcode 反推扩展 id，因为反序列化就是这么做的——只信 JSON 里的
// extensions 数组的话，攻击者把它删掉、只留下扩展积木就能绕过检查。
const CORE_EXTENSIONS = new Set([
  'argument',
  'colour',
  'control',
  'data',
  'event',
  'looks',
  'math',
  'motion',
  'operator',
  'procedures',
  'sensing',
  'sound'
]);

const getExtensionIdForOpcode = opcode => {
  if (typeof opcode !== 'string') return null;
  const index = opcode.indexOf('_');
  if (index === -1) return null;
  const prefix = opcode.substring(0, index).replace(/[^\w-]/g, '-');
  if (!prefix || CORE_EXTENSIONS.has(prefix)) return null;
  return prefix;
};

const getExtensionURLMap = project => {
  const urls = new Map();
  if (isPlainObject(project) && isPlainObject(project.extensionURLs)) {
    for (const id of Object.keys(project.extensionURLs)) {
      const url = project.extensionURLs[id];
      if (typeof url === 'string' && url) urls.set(id, url);
    }
  }
  return urls;
};

const collectBlockExtensionIds = (blocks, ids) => {
  if (!isPlainObject(blocks)) return;
  for (const blockId of Object.keys(blocks)) {
    const block = blocks[blockId];
    if (!isPlainObject(block)) continue;
    const extensionId = getExtensionIdForOpcode(block.opcode);
    if (extensionId) ids.add(extensionId);
  }
};

// 工程实际使用的扩展 = 显式声明（extensions / extensionURLs）∪ 积木与监视器
// 的 opcode 前缀。自定义扩展会同时出现在多处，取并集后按 id 比较即可。
const getExtensionIds = project => {
  const ids = new Set();
  if (isPlainObject(project) && Array.isArray(project.extensions)) {
    for (const id of project.extensions) {
      if (typeof id === 'string' && id) ids.add(id);
    }
  }
  if (isPlainObject(project) && isPlainObject(project.extensionURLs)) {
    for (const id of Object.keys(project.extensionURLs)) {
      if (id) ids.add(id);
    }
  }
  for (const target of getTargets(project)) {
    if (isPlainObject(target)) collectBlockExtensionIds(target.blocks, ids);
  }
  if (isPlainObject(project) && Array.isArray(project.monitors)) {
    for (const monitor of project.monitors) {
      if (!isPlainObject(monitor)) continue;
      const extensionId = getExtensionIdForOpcode(monitor.opcode);
      if (extensionId) ids.add(extensionId);
    }
  }
  return ids;
};

/**
 * 比较前后两份工程快照，得出这次更新包含的语义操作。
 * @param {object} previous 上一份被认可的工程 JSON
 * @param {object} next 本次更新带来的工程 JSON
 * @returns {Array<{operation: string, detail: string}>}
 */
const diffProjectStates = (previous, next) => {
  const operations = [];

  const previousTargets = getSpriteTargets(previous);
  const nextTargets = getSpriteTargets(next);
  const nextNames = getSpriteNames(next);
  const previousNames = new Set();
  for (const target of previousTargets) {
    if (typeof target.name === 'string' && target.name) previousNames.add(target.name);
  }
  // 只有「名字消失 + 内容也消失」才是删除；内容出现在一个全新的名字下就是
  // 改名。内容出现在一个原本就存在的名字下，说明被删角色只是别人的副本，
  // 依然算删除（角色数减少了）。正常情况下没有名字消失，指纹完全不算。
  const missingTargets = previousTargets.filter(target =>
    typeof target.name === 'string' && target.name && !nextNames.has(target.name));
  if (missingTargets.length > 0) {
    const nextNameByFingerprint = new Map();
    for (const target of nextTargets) {
      nextNameByFingerprint.set(getTargetFingerprint(target), target.name);
    }
    for (const target of missingTargets) {
      const matchName = nextNameByFingerprint.get(getTargetFingerprint(target));
      if (typeof matchName === 'string' && !previousNames.has(matchName)) continue; // 改名
      operations.push({operation: OPERATION_DELETE_SPRITE, detail: target.name});
    }
  }

  const previousExtensions = getExtensionIds(previous);
  const nextExtensions = getExtensionIds(next);
  for (const id of nextExtensions) {
    if (!previousExtensions.has(id)) {
      operations.push({operation: OPERATION_ADD_EXTENSION, detail: id});
    }
  }
  for (const id of previousExtensions) {
    if (!nextExtensions.has(id)) {
      operations.push({operation: OPERATION_DELETE_EXTENSION, detail: id});
    }
  }

  // 同一个 id 换了加载地址：对尚未加载该扩展的协作者来说，等于加载了另一段
  // 代码，必须和「添加扩展」同级对待。
  const previousURLs = getExtensionURLMap(previous);
  const nextURLs = getExtensionURLMap(next);
  for (const [id, url] of nextURLs) {
    if (previousURLs.has(id) && previousURLs.get(id) !== url) {
      operations.push({operation: OPERATION_CHANGE_EXTENSION_URL, detail: id});
    }
  }

  return operations;
};

const describeOperations = operations => {
  const labels = [];
  for (const operation of operations) {
    const label = OPERATION_LABELS[operation.operation];
    if (label && labels.indexOf(label) === -1) labels.push(label);
  }
  return labels.join('、');
};

/**
 * 判断一次来自参与者的工程更新是否满足主机设定的权限。
 *
 * @param {object} options
 * @param {object|null} options.previous 权威工程状态（服务端缓存 / 接收方本地工程）
 * @param {object} options.next 本次更新携带的工程 JSON
 * @param {object|null} options.permissions 主机下发的权限（缺省 = 全部允许）
 * @returns {{allowed: boolean, reason: string, message: string,
 *            operations: Array, violations: Array}}
 */
const evaluateProjectUpdate = ({previous, next, permissions}) => {
  if (!isProjectSnapshot(next)) {
    return {
      allowed: false,
      reason: 'invalid-project',
      message: '项目数据无效，已拒绝同步',
      operations: [],
      violations: []
    };
  }

  if (!isProjectSnapshot(previous)) {
    return {
      allowed: false,
      reason: 'not-synchronized',
      message: '房间项目尚未同步完成，请稍后重试',
      operations: [],
      violations: []
    };
  }

  const perms = isPlainObject(permissions) ? permissions : {};

  // 只读房间：任何快照差异都不允许。这个开关目前没有在界面上暴露，保留是
  // 为了让权限模型完整；没有写死就应该放行，避免把运行时变量值的变化误判。
  if (perms.allowEdit === false) {
    if (stableStringify(previous) !== stableStringify(next)) {
      return {
        allowed: false,
        reason: 'edit-disabled',
        message: '主机不允许协作者修改项目',
        operations: [],
        violations: []
      };
    }
    return {allowed: true, reason: 'ok', message: '', operations: [], violations: []};
  }

  const operations = diffProjectStates(previous, next);
  if (operations.length === 0) {
    // 没有语义变化（例如只有变量值/位置之类的运行时数据），放行。
    return {allowed: true, reason: 'ok', message: '', operations: [], violations: []};
  }

  const violations = operations.filter(operation => {
    const permission = OPERATION_PERMISSIONS[operation.operation];
    return permission && perms[permission] === false;
  });

  if (violations.length > 0) {
    return {
      allowed: false,
      reason: 'permission-denied',
      message: `无权限执行：${describeOperations(violations)}`,
      operations,
      violations
    };
  }

  return {allowed: true, reason: 'ok', message: '', operations, violations: []};
};

module.exports = {
  OPERATION_DELETE_SPRITE,
  OPERATION_ADD_EXTENSION,
  OPERATION_DELETE_EXTENSION,
  OPERATION_PERMISSIONS,
  isProjectSnapshot,
  diffProjectStates,
  evaluateProjectUpdate
};

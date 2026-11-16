/**
 * AI 改动日志 —— 「撤销 AI 更改」的存储层。
 *
 * 旧的撤销做法是在 AI 第一次动手前存一份完整工程（sb3 压缩包），撤销时整体
 * 覆盖回去。那等于「回到过去」，用户在 AI 之后做的手动修改会被一起抹掉。
 *
 * 这里改成记账：AI 每次改动前后各抓一次工程状态，按**改动单元**（一个积木
 * 脚本、一个变量、一个角色属性、一个角色本身……）比对出差异记进日志。
 * 撤销时做三路合并：
 *
 *   之前（before）  ── AI 改动 ──▶  之后（after）  ── 用户改动 ──▶  现在（current）
 *
 * 只有 current 仍然等于 after 的单元才回退到 before；用户后来自己动过的单元
 * 原样保留，并在结果里作为「冲突」上报。所以撤销结果始终是「只撤掉 AI 做的
 * 那部分」，不会碰用户的手工修改。
 *
 * 日志只活在编辑器渲染进程内存里：它服务的是「当前这次对话」，编辑器重开后
 * 本就该失效；也不需要把几 MB 的工程数据经 IPC 搬到 AI 窗口。
 */

const SEP = '\u0001';

/** 工程级单元：整体比对（这些字段整体替换最省事，且 AI 很少只改其中一部分） */
const PROJECT_UNITS = ['monitors', 'extensions', 'extensionURLs', 'customFonts', 'extensionStorage'];

/** 角色/舞台上的标量属性：逐字段记账，撤销粒度更细 */
const TARGET_FIELDS = [
  'name', 'x', 'y', 'size', 'direction', 'visible', 'draggable', 'rotationStyle',
  'layerOrder', 'volume', 'tempo', 'videoState', 'videoTransparency',
  'textToSpeechLanguage', 'currentCostume'
];

/** 顶层脚本以外的散块（通常为空，blockly 偶尔会留下）归到这个伪脚本下 */
const ORPHAN_ROOT = '\u0002';

// 体量上限：一次对话里 AI 改动可能上百次，超过就丢最旧的，避免把内存吃满
const MAX_ENTRIES = 300;
const MAX_SESSIONS = 4;

/**
 * @typedef {object} UnitChange
 * @property {string} key 改动单元标识
 * @property {*} before 改动前的值（null 表示该单元原本不存在）
 * @property {*} after 改动后的值（null 表示该单元被删除）
 * @property {string} [tool] 产生这次改动的工具名
 */

/** @type {Map<string, {entries: Array<{tool: string, at: number, changes: UnitChange[]}>, updatedAt: number}>} */
const journals = new Map();

/* ── 基础工具 ── */

/**
 * 键序无关的序列化：两块数据内容相同就必须得到同一个字符串，
 * 否则 JSON 字段顺序变化会被误判成「用户改过」。
 * @param {*} value 值
 * @returns {string} 稳定字符串
 */
const stableStringify = value => {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + stableStringify(value[key]))
    .join(',') + '}';
};

const clone = value => (value === undefined || value === null ? null : JSON.parse(JSON.stringify(value)));

/* ── 积木脚本切分 ── */

/**
 * 从一个顶层积木出发，收集它整个脚本（next 链 + 所有输入里的子积木）。
 * project.json 里 inputs 是 [type, primary, shadow] 的数组形式，
 * primary/shadow 既可能是积木 id 字符串，也可能是 [12, id, name] 这类嵌套数组。
 * @param {object} blocks 该角色的积木表
 * @param {?string} rootId 顶层积木 id
 * @param {object} out 收集结果
 * @param {Set<string>} seen 已收集的积木
 * @returns {void}
 */
const collectScriptBlocks = (blocks, rootId, out, seen) => {
  if (!rootId || typeof rootId !== 'string' || seen.has(rootId)) return;
  const block = blocks[rootId];
  if (!block) return;
  seen.add(rootId);
  out[rootId] = block;

  collectScriptBlocks(blocks, block.next, out, seen);

  const inputs = block.inputs;
  if (!inputs) return;
  for (const name of Object.keys(inputs)) {
    const input = inputs[name];
    if (!Array.isArray(input)) continue;
    for (let i = 1; i < input.length; i++) {
      const value = input[i];
      if (!value) continue;
      if (typeof value === 'string') {
        collectScriptBlocks(blocks, value, out, seen);
      } else if (Array.isArray(value)) {
        // [12, 变量id, 变量名] / [11, 广播名, 广播id] / [4, "文本"] 等：
        // 只有第二项可能是积木 id，用 blocks 里是否存在来兜底判重
        if (typeof value[1] === 'string') collectScriptBlocks(blocks, value[1], out, seen);
        if (Array.isArray(value[1])) collectScriptBlocks(blocks, value[1][1], out, seen);
        if (typeof value[2] === 'string') collectScriptBlocks(blocks, value[2], out, seen);
      }
    }
  }
};

/**
 * 把积木表切成「一个顶层脚本一个单元」。
 * @param {object} blocks 积木表
 * @returns {Object<string, object>} 顶层积木 id → 该脚本包含的积木
 */
const splitScripts = blocks => {
  const scripts = {};
  const claimed = new Set();
  const all = blocks || {};
  for (const id of Object.keys(all)) {
    const block = all[id];
    if (!block || !block.topLevel) continue;
    const closure = {};
    collectScriptBlocks(all, id, closure, claimed);
    scripts[id] = closure;
  }
  const orphans = {};
  for (const id of Object.keys(all)) {
    if (!claimed.has(id)) orphans[id] = all[id];
  }
  if (Object.keys(orphans).length) scripts[ORPHAN_ROOT] = orphans;
  return scripts;
};

/**
 * 取单个脚本的内容（撤销比对用；不复用 splitScripts，避免每次都扫全表）。
 * @param {object} blocks 积木表
 * @param {string} rootId 顶层积木 id 或 ORPHAN_ROOT
 * @returns {?object} 脚本包含的积木；不存在时 null
 */
const scriptClosure = (blocks, rootId) => {
  if (!blocks) return null;
  if (rootId === ORPHAN_ROOT) {
    const orphans = splitScripts(blocks)[ORPHAN_ROOT];
    return orphans || null;
  }
  if (!blocks[rootId]) return null;
  const out = {};
  collectScriptBlocks(blocks, rootId, out, new Set());
  return out;
};

/* ── 状态捕获与单元表 ── */

/**
 * 抓一份工程状态。raw 留着做「完全没变化」的快速判定，state 供比对用。
 * @param {object} vm VirtualMachine
 * @returns {{raw: string, state: object}}
 */
const captureProjectState = vm => {
  const raw = vm.toJSON();
  return {raw, state: JSON.parse(raw)};
};

/**
 * 把工程状态展开成「改动单元」表：单元标识 → 值。
 * @param {object} state 工程 JSON
 * @returns {Map<string, *>} 单元表
 */
const buildUnits = state => {
  const units = new Map();
  if (!state || typeof state !== 'object') return units;

  for (const key of PROJECT_UNITS) {
    if (state[key] !== undefined) units.set('p' + SEP + key, state[key]);
  }

  const targets = state.targets || [];
  for (const target of targets) {
    if (!target || !target.id) continue;
    const id = target.id;
    // 角色整体：只有「新增/删除角色」才会用到，用来表达整块出现或消失
    units.set('s' + SEP + id, target);

    for (const field of TARGET_FIELDS) {
      if (target[field] !== undefined) units.set('t' + SEP + id + SEP + 'f' + SEP + field, target[field]);
    }

    const variables = target.variables || {};
    for (const varId of Object.keys(variables)) {
      units.set('t' + SEP + id + SEP + 'v' + SEP + varId, variables[varId]);
    }
    const lists = target.lists || {};
    for (const listId of Object.keys(lists)) {
      units.set('t' + SEP + id + SEP + 'l' + SEP + listId, lists[listId]);
    }
    const broadcasts = target.broadcasts || {};
    for (const bcId of Object.keys(broadcasts)) {
      units.set('t' + SEP + id + SEP + 'bc' + SEP + bcId, broadcasts[bcId]);
    }

    const scripts = splitScripts(target.blocks);
    for (const rootId of Object.keys(scripts)) {
      units.set('t' + SEP + id + SEP + 'b' + SEP + rootId, scripts[rootId]);
    }

    if (target.comments && Object.keys(target.comments).length) {
      units.set('t' + SEP + id + SEP + 'c', target.comments);
    }
    if (target.costumes) units.set('t' + SEP + id + SEP + 'cos', target.costumes);
    if (target.sounds) units.set('t' + SEP + id + SEP + 'snd', target.sounds);
  }

  return units;
};

/**
 * 比对前后两份状态，产出改动单元列表。
 * 角色整体的增删会连带产生一堆子单元差异，那些是冗余的：撤销时按角色整体处理，
 * 所以这里直接跳过该角色的子单元，日志也更小。
 * @param {object} beforeState 改动前的工程 JSON
 * @param {object} afterState 改动后的工程 JSON
 * @returns {UnitChange[]} 改动列表
 */
const diffStates = (beforeState, afterState) => {
  const beforeUnits = buildUnits(beforeState);
  const afterUnits = buildUnits(afterState);

  const presenceChanged = new Set();
  const beforeIds = new Set((beforeState.targets || []).map(target => target && target.id));
  const afterIds = new Set((afterState.targets || []).map(target => target && target.id));
  for (const id of new Set([...beforeIds, ...afterIds])) {
    if (beforeIds.has(id) !== afterIds.has(id)) presenceChanged.add(id);
  }

  const changes = [];
  const keys = new Set([...beforeUnits.keys(), ...afterUnits.keys()]);
  for (const key of keys) {
    const parts = key.split(SEP);
    // 角色整体只在「出现 / 消失」时才算改动单元；角色只是被改了几处内容的话，
    // 逐单元记账已经覆盖，再记一条整体会把「用户改过一处」放大成「整个角色都改过」
    if (parts[0] === 's' && !presenceChanged.has(parts[1])) continue;
    if (parts[0] === 't' && presenceChanged.has(parts[1])) continue;

    const before = beforeUnits.has(key) ? beforeUnits.get(key) : null;
    const after = afterUnits.has(key) ? afterUnits.get(key) : null;
    if (stableStringify(before) === stableStringify(after)) continue;
    changes.push({key, before, after});
  }
  return changes;
};

/* ── 单元读写（作用在工程 JSON 上） ── */

const findTarget = (state, targetId) => (state.targets || []).find(target => target && target.id === targetId) || null;

/**
 * 读一个单元当前的值。
 * @param {object} state 工程 JSON
 * @param {string} key 单元标识
 * @returns {*} 单元值；不存在时 null
 */
const getUnitValue = (state, key) => {
  const parts = key.split(SEP);
  if (parts[0] === 'p') return state[parts[1]] === undefined ? null : state[parts[1]];
  if (parts[0] === 's') return findTarget(state, parts[1]);

  const target = findTarget(state, parts[1]);
  if (!target) return null;
  switch (parts[2]) {
  case 'f':
    return target[parts[3]] === undefined ? null : target[parts[3]];
  case 'v':
    return (target.variables || {})[parts[3]] === undefined ? null : target.variables[parts[3]];
  case 'l':
    return (target.lists || {})[parts[3]] === undefined ? null : target.lists[parts[3]];
  case 'bc':
    return (target.broadcasts || {})[parts[3]] === undefined ? null : target.broadcasts[parts[3]];
  case 'b':
    return scriptClosure(target.blocks, parts[3]);
  case 'c': {
    // 空对象等同于「没有注释」，与 buildUnits 里「有注释才建单元」保持一致
    const comments = target.comments;
    return comments && Object.keys(comments).length ? comments : null;
  }
  case 'cos':
    return target.costumes || null;
  case 'snd':
    return target.sounds || null;
  default:
    return null;
  }
};

/**
 * 把一个单元写成指定值（value 为 null 表示删除）。
 * @param {object} state 工程 JSON
 * @param {string} key 单元标识
 * @param {*} value 新值
 * @returns {void}
 */
const setUnitValue = (state, key, value) => {
  const parts = key.split(SEP);

  if (parts[0] === 'p') {
    if (value === null) delete state[parts[1]];
    else state[parts[1]] = clone(value);
    return;
  }

  if (parts[0] === 's') {
    const list = state.targets || (state.targets = []);
    const index = list.findIndex(target => target && target.id === parts[1]);
    if (value === null) {
      if (index >= 0) list.splice(index, 1);
    } else if (index >= 0) {
      list[index] = clone(value);
    } else {
      list.push(clone(value));
    }
    return;
  }

  const target = findTarget(state, parts[1]);
  if (!target) return;

  switch (parts[2]) {
  case 'f':
    if (value === null) delete target[parts[3]];
    else target[parts[3]] = clone(value);
    return;
  case 'v':
  case 'l':
  case 'bc': {
    const field = parts[2] === 'v' ? 'variables' : parts[2] === 'l' ? 'lists' : 'broadcasts';
    const map = target[field] || (target[field] = {});
    if (value === null) delete map[parts[3]];
    else map[parts[3]] = clone(value);
    return;
  }
  case 'b': {
    const blocks = target.blocks || (target.blocks = {});
    // 先把当前这个脚本整段拆掉，再把日志里的版本装回去：插入/删除积木都能覆盖
    const current = parts[3] === ORPHAN_ROOT
      ? (splitScripts(blocks)[ORPHAN_ROOT] || {})
      : (() => {
        const closure = {};
        collectScriptBlocks(blocks, parts[3], closure, new Set());
        return closure;
      })();
    for (const blockId of Object.keys(current)) delete blocks[blockId];
    if (value) Object.assign(blocks, clone(value));
    return;
  }
  case 'c':
    if (value === null || !Object.keys(value).length) delete target.comments;
    else target.comments = clone(value);
    return;
  case 'cos':
    if (value) target.costumes = clone(value);
    return;
  case 'snd':
    if (value) target.sounds = clone(value);
    return;
  default:
  }
};

/** 单元的人话描述，用于撤销结果里的「保留下来的改动」提示 */
const describeUnit = (key, state) => {
  const parts = key.split(SEP);
  if (parts[0] === 'p') return parts[1];
  if (parts[0] === 's') {
    const target = findTarget(state, parts[1]);
    return target ? target.name : parts[1];
  }
  const target = findTarget(state, parts[1]);
  const name = target ? target.name : parts[1];
  switch (parts[2]) {
  case 'f':
    return name + '.' + parts[3];
  case 'v': {
    const variable = target && target.variables ? target.variables[parts[3]] : null;
    return name + ' · 变量 ' + (variable ? variable[0] : parts[3]);
  }
  case 'l': {
    const list = target && target.lists ? target.lists[parts[3]] : null;
    return name + ' · 列表 ' + (list ? list[0] : parts[3]);
  }
  case 'bc': {
    const broadcasts = target && target.broadcasts ? target.broadcasts : {};
    return name + ' · 广播 ' + (broadcasts[parts[3]] || parts[3]);
  }
  case 'b':
    return name + ' · 脚本';
  case 'c':
    return name + ' · 注释';
  case 'cos':
    return name + ' · 造型';
  case 'snd':
    return name + ' · 声音';
  default:
    return name;
  }
};

/* ── 日志读写 ── */

const getJournal = sessionId => {
  const id = sessionId || 'default';
  let journal = journals.get(id);
  if (!journal) {
    journal = {entries: [], updatedAt: 0};
    journals.set(id, journal);
    // 只保留最近几个会话的日志，别的对话的改动没必要一直占着内存
    while (journals.size > MAX_SESSIONS) {
      const oldest = [...journals.entries()]
        .filter(([key]) => key !== id)
        .sort((a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0))[0];
      if (!oldest) break;
      journals.delete(oldest[0]);
    }
  }
  return journal;
};

/**
 * 记录一次 AI 工具调用带来的改动。前后的状态由调用方抓取（必须是同一个 VM 的快照）。
 * @param {string} sessionId 会话 id
 * @param {string} toolName 工具名
 * @param {{raw: string, state: object}} before 调用前状态
 * @param {{raw: string, state: object}} after 调用后状态
 * @returns {number} 记录下来的改动单元数
 */
const recordAIChange = (sessionId, toolName, before, after) => {
  if (!before || !after) return 0;
  // 绝大多数工具调用前后工程一个字都没变，先走这条最便宜的判断
  if (before.raw === after.raw) return 0;

  let changes = [];
  try {
    changes = diffStates(before.state, after.state);
  } catch (error) {
    console.warn('AI undo: failed to diff project state', error);
    return 0;
  }
  if (!changes.length) return 0;

  const journal = getJournal(sessionId);
  // 模型一轮里可能并行发多个工具调用，前后快照会互相覆盖；跟上一条日志里
  // 完全一样的改动没必要重复记（否则撤销时会多报一堆假「冲突」）
  const previous = journal.entries[journal.entries.length - 1];
  if (previous) {
    const seen = new Set(previous.changes.map(change => change.key + '\u0000' + stableStringify(change.after)));
    changes = changes.filter(change => !seen.has(change.key + '\u0000' + stableStringify(change.after)));
    if (!changes.length) return 0;
  }

  for (const change of changes) change.tool = toolName;
  journal.entries.push({tool: toolName, at: Date.now(), changes});
  while (journal.entries.length > MAX_ENTRIES) journal.entries.shift();
  journal.updatedAt = Date.now();
  return changes.length;
};

/**
 * 查询某个会话累积了多少 AI 改动，AI 助手窗口据此决定撤销按钮是否出现。
 * @param {string} sessionId 会话 id
 * @returns {{count: number, toolCount: number, tools: string[], updatedAt: number}}
 */
const getAIChangeStatus = sessionId => {
  const journal = journals.get(sessionId || 'default');
  if (!journal || !journal.entries.length) {
    return {count: 0, toolCount: 0, tools: [], updatedAt: 0};
  }
  // 按「改动单元」去重计数：同一条脚本被 AI 反复改十次，对用户来说仍是「一处」
  const units = new Set();
  const tools = new Set();
  for (const entry of journal.entries) {
    for (const change of entry.changes) units.add(change.key);
    tools.add(entry.tool);
  }
  return {count: units.size, toolCount: journal.entries.length, tools: [...tools], updatedAt: journal.updatedAt};
};

/**
 * 丢弃某个会话的改动日志（会话被删除、或撤销完成后）。
 * @param {string} sessionId 会话 id
 * @returns {boolean} 是否确实有日志被删掉
 */
const dropAIChanges = sessionId => journals.delete(sessionId || 'default');

/**
 * 三路合并：把「仍然保持 AI 改完之后样子」的单元回退到改动前，其余保留。
 * @param {object} currentState 当前工程 JSON
 * @param {UnitChange[]} changes 按时间从旧到新的改动列表
 * @returns {{merged: object, applied: UnitChange[], conflicts: UnitChange[]}}
 */
const revertChanges = (currentState, changes) => {
  const merged = clone(currentState);
  const applied = [];
  const conflicts = [];
  const conflictKeys = new Set();

  // 必须从最新往回退：同一单元被 AI 改过多次时，后一次的值是前一次的「之后」，
  // 顺序反了就只退得掉最后一步。
  for (let i = changes.length - 1; i >= 0; i--) {
    const change = changes[i];
    let current;
    try {
      current = getUnitValue(merged, change.key);
    } catch (error) {
      current = undefined;
    }
    if (stableStringify(current) !== stableStringify(change.after)) {
      // 用户在这之后自己动过：保留用户的版本，记一笔冲突
      if (!conflictKeys.has(change.key)) {
        conflictKeys.add(change.key);
        conflicts.push(change);
      }
      continue;
    }
    setUnitValue(merged, change.key, change.before);
    applied.push(change);
  }

  return {merged, applied, conflicts};
};

/**
 * 把合并后的工程状态装回 VM。
 * 需要整体重载：改动可能横跨任意角色，逐个打补丁反而更容易留下半套状态。
 * @param {object} vm VirtualMachine
 * @param {object} state 工程 JSON
 * @returns {Promise<void>}
 */
const applyProjectState = async (vm, state) => {
  const editingTarget = vm.editingTarget;
  const editingTargetId = editingTarget ? editingTarget.id : null;
  // 重载会给 target 重新生成 id，名字才是跨加载稳定的身份
  const editingTargetName = editingTarget && !editingTarget.isStage ? editingTarget.getName() : null;
  // 先停掉正在跑的脚本：loadProject 会换掉整个 runtime，半路抽走线程会留下悬空引用
  vm.stopAll();
  // 直接传对象：这本来就是 vm.toJSON() 的产物，不必再 stringify 一遍
  try {
    await vm.loadProject(state);
  } catch (error) {
    // 解析器偶尔会挑刺（例如某些 TurboWarp 私有字段）。内容本来就是 vm.toJSON()
    // 产出的合法工程，退回直接反序列化，不让撤销卡在验证这一步。
    const fallback = clone(state);
    fallback.projectVersion = 3;
    await vm.deserializeProject(fallback, null);
    if (vm.runtime && typeof vm.runtime.handleProjectLoaded === 'function') {
      vm.runtime.handleProjectLoaded();
    }
  }
  if (editingTargetId && vm.runtime.getTargetById(editingTargetId)) {
    vm.setEditingTarget(editingTargetId);
  } else if (editingTargetName) {
    // 按名字找回原来选中的角色，别让用户撤销完发现选中的角色被换掉了
    const restored = vm.runtime.targets.find(target =>
      !target.isStage && target.isOriginal && target.getName() === editingTargetName);
    if (restored) vm.setEditingTarget(restored.id);
  }
  vm.runtime.emitProjectChanged();
  vm.emitWorkspaceUpdate();
  vm.emitTargetsUpdate();
};

/**
 * 执行撤销：只回退 AI 做过、且用户没有再次修改的改动。
 * @param {object} vm VirtualMachine
 * @param {string} sessionId 会话 id
 * @returns {Promise<object>} 工具结果
 */
const undoAIChanges = async (vm, sessionId) => {
  const id = sessionId || 'default';
  const journal = journals.get(id);
  if (!journal || !journal.entries.length) {
    return {success: false, error: 'No AI changes to undo in this chat'};
  }

  let current;
  try {
    current = captureProjectState(vm);
  } catch (error) {
    return {success: false, error: 'Failed to read the current project: ' + (error.message || String(error))};
  }

  const changes = [];
  for (const entry of journal.entries) changes.push(...entry.changes);

  const {merged, applied, conflicts} = revertChanges(current.state, changes);
  const conflictDetails = conflicts.slice(0, 20).map(change => ({
    unit: describeUnit(change.key, current.state),
    tool: change.tool || ''
  }));

  if (!applied.length) {
    // 一处都退不掉（用户把 AI 改过的地方全都重做了），日志已无用武之地
    journals.delete(id);
    return {success: true, data: {
      reverted: 0,
      conflicts: conflictDetails.length,
      conflictDetails,
      tools: [...new Set(changes.map(change => change.tool).filter(Boolean))],
      message: 'Every AI change was modified afterwards, so nothing was reverted.'
    }};
  }

  try {
    await applyProjectState(vm, merged);
  } catch (error) {
    return {success: false, error: 'Failed to apply the reverted project: ' + (error.message || String(error))};
  }

  journals.delete(id);
  return {success: true, data: {
    // 同样按单元去重：同一处内容被改过多次只算「一处」
    reverted: new Set(applied.map(change => change.key)).size,
    conflicts: conflictDetails.length,
    conflictDetails,
    tools: [...new Set(applied.map(change => change.tool).filter(Boolean))]
  }};
};

export {
  captureProjectState,
  recordAIChange,
  getAIChangeStatus,
  dropAIChanges,
  undoAIChanges
};

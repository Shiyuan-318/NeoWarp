const settings = require('./settings');
const {getAllowedCallerOrigin, issueToken} = require('./ai-proxy');

/**
 * 统一的 AI 模型配置存储（tw_config.json）。
 *
 * AI 助手、NeoWarp SOLO、扩展编辑器与桌面设置共用同一份模型配置列表与
 * 激活项；任何一侧保存后广播给其余窗口实时同步。配置对象形状与 AI 助手
 * 原有的 savedConfigs 条目一致：
 * {id, name, provider, model, apiKey, apiFormat, customEndpoint,
 *  customModelId, customContextLimit, contextLimit, maxOutput, thinkingLevel}
 *
 * 旧版把扩展编辑器的单条配置存在 settings.aiProviders，首次读取时迁移。
 */

const CONFIG_FIELDS = [
  'id', 'name', 'provider', 'model', 'apiKey', 'apiFormat',
  'customEndpoint', 'customModelId', 'customContextLimit', 'thinkingLevel',
  // 自定义模型在桌面设置里手工声明的能力（覆盖内置目录判断）
  'supportsReasoning', 'supportsVision', 'supportsVideo', 'supportsPdf', 'reasoningLevels',
  // 每个模型独立的上下文上限与最大输出 Token
  'contextLimit', 'maxOutput'
];

/**
 * 规范化自定义端点：兼容用户填 base URL（如 https://api.siliconflow.cn/v1）
 * 或完整端点两种习惯。补全的路径由 API 格式决定，三种格式各有一套：
 * - openai / custom：…/chat/completions（只补这一段，绝不补 /v1；不同厂商
 *   路径前缀不同，自动补 /v1 会弄坏 DeepSeek/Groq 这类端点）
 * - anthropic：…/v1/messages
 * - ollama：…/api/chat
 * 已经带对应聊天路径的完整端点原样返回。
 * @param {string} url
 * @param {'openai'|'anthropic'|'ollama'|'custom'} [apiFormat]
 * @returns {string}
 */
function normalizeCustomEndpoint (url, apiFormat) {
  let u = String(url || '').trim();
  if (!u) return u;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/+$/, '');
  if (apiFormat === 'anthropic') {
    if (/\/v1\/messages$/i.test(u)) return u;
    if (/\/v1$/i.test(u)) return u + '/messages';
    return u + '/v1/messages';
  }
  if (apiFormat === 'ollama') {
    if (/\/api\/chat$/i.test(u)) return u;
    if (!/\/api$/i.test(u)) u += '/api';
    return u + '/chat';
  }
  if (/\/(v1\/messages|api\/chat)$/i.test(u)) return u;
  if (!/\/chat\/completions$/i.test(u)) u += '/chat/completions';
  return u;
}

// ── 内置免费模型（已下线）─────────────────────────────────────
// 历史版本在源码里硬编码了一个官方中转站的免费模型 API Key。硬编码进源码的
// 密钥等同于公开分发（clone 仓库即可白嫖额度），已整体移除：不再注入任何
// 免费配置，也不再保留密钥常量。
// 存量数据兼容：旧版在读取时动态注入 free_* 配置、保存时剥离，理论上没落盘，
// 但不排除用户手动改过 tw_config.json 或旧版本写进过 localStorage，因此读取
// 与保存两侧都再过滤一次，避免旧密钥继续生效。
const isFreeConfigId = (id) => typeof id === 'string' && id.indexOf('free_') === 0;
const isLegacyFreeConfig = (cfg) => !!cfg && (cfg.isFree === true || isFreeConfigId(cfg.id));

/**
 * 计算激活配置 id：沿用调用方传入值，失效时回落到第一条配置。
 * @param {string|null} activeId
 * @param {Array<object>} configs
 * @returns {string|null}
 */
function resolveActiveConfigId (activeId, configs) {
  const id = typeof activeId === 'string' ? activeId : null;
  if (id && configs.some((cfg) => cfg.id === id)) return id;
  return configs.length ? configs[0].id : null;
}

function normalizeConfig (raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const cfg = {};
  for (const key of CONFIG_FIELDS) {
    if (raw[key] !== undefined && raw[key] !== null) {
      cfg[key] = raw[key];
    }
  }
  if (typeof cfg.id !== 'string' || !cfg.id) {
    cfg.id = 'cfg_' + Date.now() + '_' + (index || 0);
  }
  if (typeof cfg.provider !== 'string' || !cfg.provider) cfg.provider = 'openai';
  if (typeof cfg.name !== 'string') cfg.name = '';
  if (typeof cfg.model !== 'string') cfg.model = '';
  if (typeof cfg.apiKey !== 'string') cfg.apiKey = '';
  if (cfg.apiFormat !== 'anthropic' && cfg.apiFormat !== 'ollama' && cfg.apiFormat !== 'custom') {
    cfg.apiFormat = 'openai';
  }
  if (typeof cfg.customEndpoint !== 'string') cfg.customEndpoint = '';
  // 保存入口单点收口：base URL 与完整端点两种填法都规范化成完整端点落盘；
  // 补什么路径取决于 API 格式（/chat/completions、/v1/messages、/api/chat）
  cfg.customEndpoint = normalizeCustomEndpoint(cfg.customEndpoint, cfg.apiFormat);
  if (typeof cfg.customModelId !== 'string') cfg.customModelId = '';
  const ctx = Number(cfg.customContextLimit);
  cfg.customContextLimit = Number.isFinite(ctx) && ctx >= 1000 ? Math.floor(ctx) : 1000000;
  // 每个模型的上下文上限与最大输出（未声明时删除，由使用侧回落到默认值）
  const modelCtx = Number(cfg.contextLimit);
  if (Number.isFinite(modelCtx) && modelCtx >= 1000) cfg.contextLimit = Math.floor(modelCtx);
  else delete cfg.contextLimit;
  const maxOut = Number(cfg.maxOutput);
  if (Number.isFinite(maxOut) && maxOut > 0) cfg.maxOutput = Math.floor(maxOut);
  else delete cfg.maxOutput;
  if (typeof cfg.thinkingLevel !== 'string' || !cfg.thinkingLevel) cfg.thinkingLevel = 'medium';
  // 能力开关只接受布尔值（未声明时保持 undefined，让内置目录的判断生效）
  for (const key of ['supportsReasoning', 'supportsVision', 'supportsVideo', 'supportsPdf']) {
    if (typeof cfg[key] !== 'boolean') delete cfg[key];
  }
  // 推理等级（从低到高）：去空白、去重，最多 8 档；空数组视为未声明
  if (cfg.reasoningLevels !== undefined) {
    const levels = Array.isArray(cfg.reasoningLevels) ? cfg.reasoningLevels : [];
    const cleaned = [];
    for (const item of levels) {
      const name = String(item == null ? '' : item).trim().slice(0, 32);
      if (name && !cleaned.includes(name)) cleaned.push(name);
      if (cleaned.length >= 8) break;
    }
    if (cleaned.length) cfg.reasoningLevels = cleaned;
    else delete cfg.reasoningLevels;
  }
  return cfg;
}

/**
 * 旧版 settings.aiProviders（{provider, apiKey, model, customEndpoint}）迁移
 * 为一条模型配置。仅在统一存储为空时调用一次。
 */
function migrateLegacyAiProviders () {
  const legacy = settings.aiProviders || {};
  if (!legacy.apiKey && !legacy.customEndpoint) return null;
  const isCustom = legacy.provider === 'custom';
  // 构建即经 normalizeConfig 收口，旧数据里的 customEndpoint 也会被一并规范化
  const cfg = normalizeConfig({
    id: 'cfg_' + Date.now(),
    name: '',
    provider: legacy.provider || 'openai',
    model: isCustom ? 'custom' : (legacy.model || ''),
    apiKey: legacy.apiKey || '',
    apiFormat: 'openai',
    customEndpoint: legacy.customEndpoint || '',
    customModelId: isCustom ? (legacy.model || '') : '',
    customContextLimit: 1000000,
    thinkingLevel: 'medium'
  }, 0);
  settings.aiModelConfigs = [cfg];
  settings.activeAiModelConfigId = cfg.id;
  settings.save().catch(() => {});
  return cfg;
}

/**
 * 读取配置列表与激活项；激活项失效时回落到第一条。
 * @returns {{configs: Array<object>, activeId: string|null}}
 */
function getModelConfigs () {
  // load 路径同样跑一遍规范化（旧数据兼容）：存量用户保存过的 base URL
  // 不改配置也能在测试连接/对话里自动取到补全后的端点，
  // 下次任意一侧保存时会随 normalizeConfig 落盘。
  const stored = Array.isArray(settings.aiModelConfigs) ? settings.aiModelConfigs : [];
  let configs = stored
    .map(normalizeConfig)
    .filter(Boolean)
    .filter((cfg) => !isLegacyFreeConfig(cfg));
  // 存量数据里若还留有下线的免费配置（含旧内置密钥），顺手从磁盘清掉
  if (configs.length !== stored.length) {
    settings.aiModelConfigs = configs;
    settings.save().catch(() => {});
  }
  let activeId = settings.activeAiModelConfigId;
  if (!configs.length) {
    const migrated = migrateLegacyAiProviders();
    if (migrated) {
      configs = [migrated];
      activeId = migrated.id;
    }
  }
  return {configs, activeId: resolveActiveConfigId(activeId, configs)};
}

/**
 * 保存配置列表与激活项，并广播给所有 AI 相关窗口。
 * @param {Array<object>} configs
 * @param {string|null} activeId
 * @param {Electron.WebContents|null} sender 发起方的 webContents，广播时跳过
 * @returns {Promise<{configs: Array<object>, activeId: string|null}>}
 */
async function saveModelConfigs (configs, activeId, sender) {
  // configs 缺省表示只改激活项：沿用现有列表，避免调用方漏传清空配置
  const list = configs === undefined || configs === null
    ? settings.aiModelConfigs
    : configs;
  const normalized = (Array.isArray(list) ? list : [])
    .map(normalizeConfig)
    .filter(Boolean)
    // 已下线的内置免费模型不入库（旧渲染端仍可能带着它们回传）
    .filter((cfg) => !isLegacyFreeConfig(cfg));
  const id = resolveActiveConfigId(activeId, normalized);
  settings.aiModelConfigs = normalized;
  settings.activeAiModelConfigId = id;
  await settings.save();
  broadcastAiModelConfigsChanged(sender || null);
  return {configs: normalized, activeId: id};
}

/**
 * 把最新配置推给所有 AI 助手、SOLO、扩展编辑器（含 AI 弹窗）与桌面设置窗口。
 * @param {Electron.WebContents|null} sender 发起方的 webContents，不回推
 */
function broadcastAiModelConfigsChanged (sender) {
  // 窗口类在函数内 late require，避免模块循环依赖（与 windows/*.js 做法一致）
  const AbstractWindow = require('./windows/abstract');
  const AIAssistantWindow = require('./windows/ai-assistant');
  const SoloWindow = require('./windows/solo');
  const ExtensionEditorWindow = require('./windows/extension-editor');
  const DesktopSettingsWindow = require('./windows/desktop-settings');
  const payload = getModelConfigs();
  const targets = [
    ...AbstractWindow.getWindowsByClass(AIAssistantWindow),
    ...AbstractWindow.getWindowsByClass(SoloWindow),
    ...AbstractWindow.getWindowsByClass(ExtensionEditorWindow),
    ...AbstractWindow.getWindowsByClass(DesktopSettingsWindow)
  ];
  for (const win of targets) {
    if (win.window && !win.window.isDestroyed() && win.window.webContents !== sender) {
      win.window.webContents.send('ai-model-configs-changed', payload);
    }
    // 扩展编辑器的 AI 弹窗是独立 webContents，一并同步
    if (win.aiPopout && !win.aiPopout.isDestroyed() && win.aiPopout.webContents !== sender) {
      win.aiPopout.webContents.send('ai-model-configs-changed', payload);
    }
  }
}

/**
 * 在窗口（或 AI 弹窗）自身的 frame ipc 上注册统一配置通道。
 * 各窗口的 frame ipc 相互独立，同名通道互不冲突。
 * @param {Electron.IpcRenderer} ipc 由窗口构造函数传入的 this.ipc
 */
function registerAiModelConfigIpc (ipc) {
  ipc.handle('ai-get-model-configs', () => getModelConfigs());
  ipc.handle('ai-save-model-configs', async (event, payload) => {
    const result = await saveModelConfigs(
      payload && payload.configs,
      payload && payload.activeId,
      event.sender
    );
    // 广播跳过了发起者，这里把最终（含规范化）结果回给发起方
    event.sender.send('ai-model-configs-changed', result);
    return result;
  });
  ipc.handle('open-desktop-settings', (event, section) => {
    const DesktopSettingsWindow = require('./windows/desktop-settings');
    DesktopSettingsWindow.show(section);
    return {success: true};
  });
  // AI 转发协议（tw-ai-proxy）的能力令牌：转发协议是带 SSE 流的裸 HTTP
  // 通道，必须确认调用方身份。主进程按发起窗口的真实 URL 判定，只有 AI
  // 助手 / SOLO / 扩展编辑器 / 桌面设置这几个页面能拿到令牌；令牌同时绑定
  // 页面来源并约束可访问的目标（见 ai-proxy.js）。
  ipc.handle('ai-get-proxy-token', (event, payload) => {
    const frameUrl = (event.senderFrame && event.senderFrame.url) ||
      (event.sender && typeof event.sender.getURL === 'function' ? event.sender.getURL() : '');
    const origin = getAllowedCallerOrigin(frameUrl);
    if (!origin) {
      throw new Error('AI proxy is not allowed on this page');
    }
    const targets = payload && Array.isArray(payload.targets) ? payload.targets : [];
    return issueToken(origin, targets);
  });
}

module.exports = {
  getModelConfigs,
  saveModelConfigs,
  normalizeCustomEndpoint,
  broadcastAiModelConfigsChanged,
  registerAiModelConfigIpc
};

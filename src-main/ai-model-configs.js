const settings = require('./settings');

/**
 * 统一的 AI 模型配置存储（tw_config.json）。
 *
 * AI 助手、NeoWarp SOLO、扩展编辑器与桌面设置共用同一份模型配置列表与
 * 激活项；任何一侧保存后广播给其余窗口实时同步。配置对象形状与 AI 助手
 * 原有的 savedConfigs 条目一致：
 * {id, name, provider, model, apiKey, apiFormat, customEndpoint,
 *  customModelId, customContextLimit, thinkingLevel}
 *
 * 旧版把扩展编辑器的单条配置存在 settings.aiProviders，首次读取时迁移。
 */

const CONFIG_FIELDS = [
  'id', 'name', 'provider', 'model', 'apiKey', 'apiFormat',
  'customEndpoint', 'customModelId', 'customContextLimit', 'thinkingLevel'
];

// ── 官方免费模型 ─────────────────────────────────────────────
// 通过 NeoWarp 中转站免费提供的模型（OpenAI 兼容）。免费配置由主进程在
// 读取时动态注入、保存时剥离：API Key 只存在于本文件，绝不写入
// tw_config.json，也不落任何渲染端存储。
const FREE_MODEL_ENDPOINT = 'https://api.sy1.top/v1/chat/completions';
const FREE_MODEL_API_KEY = 'sk-5oRtURJhbXZ1FyqFq0apMQEnwTSCNTqOGXp3HNZb0Ip7R6Lm';
// 全部免费模型统一 1M 上下文 / 65K 最大输出
const FREE_MODEL_CONTEXT_LIMIT = 1000000;
// 免费活动截止：2026-11-30 12:00:00（UTC+8）＝ 04:00 UTC
const FREE_MODEL_END_AT = Date.UTC(2026, 10, 30, 4, 0, 0);
// id 必须带 free_ 前缀且跨版本稳定：持久化的 activeAiModelConfigId 会引用它
const FREE_MODELS = [
  {id: 'free_deepseek-v4.1-flash', model: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash'},
  {id: 'free_glm-5.3-flash', model: 'glm-5.3-flash', name: 'GLM-5.3 Flash'},
  {id: 'free_sensenova-6.8-flash-lite', model: 'sensenova-6.8-flash-lite', name: 'SenseNova 6.8 Flash Lite'},
  {id: 'free_glm-5.2', model: 'glm-5.2', name: 'GLM-5.2'}
];

const isFreeConfigId = (id) => typeof id === 'string' && id.indexOf('free_') === 0;
const isFreeActivityOver = () => Date.now() >= FREE_MODEL_END_AT;

/**
 * 生成免费模型配置列表（不持久化）。
 * 活动结束后仍返回列表：各界面要继续展示并灰显“免费使用活动已结束”，
 * 此时带 freeExpired 标记；是否可选中由各界面按本地时间与 freeExpired 判定。
 * @returns {Array<object>}
 */
function freeModelConfigs () {
  const expired = isFreeActivityOver();
  return FREE_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    provider: 'free',
    model: m.model,
    apiKey: FREE_MODEL_API_KEY,
    apiFormat: 'openai',
    customEndpoint: '',
    customModelId: '',
    customContextLimit: FREE_MODEL_CONTEXT_LIMIT,
    thinkingLevel: 'medium',
    isFree: true,
    freeExpired: expired
  }));
}

/**
 * 计算激活配置 id：优先沿用调用方传入值；指向免费模型且活动已结束时，
 * 回落到第一条普通配置（避免活动结束后仍默认使用免费中转）。
 * @param {string|null} activeId
 * @param {Array<object>} own 普通配置
 * @param {Array<object>} combined 免费配置在前的完整列表
 * @returns {string|null}
 */
function resolveActiveConfigId (activeId, own, combined) {
  let id = typeof activeId === 'string' ? activeId : null;
  if (id && isFreeConfigId(id) && isFreeActivityOver()) id = null;
  if (id && combined.some((cfg) => cfg.id === id)) return id;
  if (own.length) return own[0].id;
  return combined.length ? combined[0].id : null;
}

/**
 * 免费模型列表 + 过期时间点，供界面展示“活动截止”等文案。
 * @returns {{models: Array<object>, endAt: number, expired: boolean}}
 */
function getFreeModelActivity () {
  return {
    models: FREE_MODELS.map(({id, model, name}) => ({id, model, name})),
    endAt: FREE_MODEL_END_AT,
    endpoint: FREE_MODEL_ENDPOINT,
    expired: isFreeActivityOver()
  };
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
  if (typeof cfg.customModelId !== 'string') cfg.customModelId = '';
  const ctx = Number(cfg.customContextLimit);
  cfg.customContextLimit = Number.isFinite(ctx) && ctx >= 1000 ? Math.floor(ctx) : 32000;
  if (typeof cfg.thinkingLevel !== 'string' || !cfg.thinkingLevel) cfg.thinkingLevel = 'medium';
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
  const cfg = normalizeConfig({
    id: 'cfg_' + Date.now(),
    name: '',
    provider: legacy.provider || 'openai',
    model: isCustom ? 'custom' : (legacy.model || ''),
    apiKey: legacy.apiKey || '',
    apiFormat: 'openai',
    customEndpoint: legacy.customEndpoint || '',
    customModelId: isCustom ? (legacy.model || '') : '',
    customContextLimit: 32000,
    thinkingLevel: 'medium'
  }, 0);
  settings.aiModelConfigs = [cfg];
  settings.activeAiModelConfigId = cfg.id;
  settings.save().catch(() => {});
  return cfg;
}

/**
 * 读取配置列表与激活项；免费模型动态注入在最前，激活项失效时回落。
 * @returns {{configs: Array<object>, activeId: string|null}}
 */
function getModelConfigs () {
  let configs = settings.aiModelConfigs;
  let activeId = settings.activeAiModelConfigId;
  if (!configs.length) {
    const migrated = migrateLegacyAiProviders();
    if (migrated) {
      configs = [migrated];
      activeId = migrated.id;
    }
  }
  const free = freeModelConfigs();
  const combined = free.concat(configs);
  return {configs: combined, activeId: resolveActiveConfigId(activeId, configs, combined)};
}

/**
 * 保存配置列表与激活项，并广播给所有 AI 相关窗口。
 * 渲染端回传的列表会包含动态注入的免费配置：剥离后再持久化，
 * 保证免费 API Key 不落盘；激活项允许指向免费模型（活动内）。
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
    // 免费模型不入库：主进程读取时重新注入（防 Key 落盘，也便于活动下线）
    .filter((cfg) => !cfg.isFree && !isFreeConfigId(cfg.id));
  const free = freeModelConfigs();
  const combined = free.concat(normalized);
  const id = resolveActiveConfigId(activeId, normalized, combined);
  settings.aiModelConfigs = normalized;
  settings.activeAiModelConfigId = id;
  await settings.save();
  broadcastAiModelConfigsChanged(sender || null);
  return {configs: combined, activeId: id};
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
  ipc.handle('open-desktop-settings', () => {
    const DesktopSettingsWindow = require('./windows/desktop-settings');
    DesktopSettingsWindow.show();
    return {success: true};
  });
}

module.exports = {
  getModelConfigs,
  saveModelConfigs,
  getFreeModelActivity,
  broadcastAiModelConfigsChanged,
  registerAiModelConfigIpc
};

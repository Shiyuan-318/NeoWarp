// 免费模型注入/剥离逻辑的桩测试：拦截 electron 与窗口模块，脱离 Electron 运行
const Module = require('module');
const path = require('path');
const assert = require('assert');

const noop = () => {};
const electronStub = {
  app: {getPath: () => require('os').tmpdir(), whenReady: () => Promise.resolve()},
  ipcMain: {handle: noop, on: noop},
  BrowserWindow: class {},
  Menu: {buildFromTemplate: noop, setApplicationMenu: noop},
  nativeTheme: {},
  shell: {openExternal: noop},
  dialog: {showMessageBoxSync: noop},
  crashReporter: {},
  session: {defaultSession: {}}
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub;
  // 广播用到的各窗口类：只用到 getWindowsByClass，返回空列表即可
  if (request.startsWith('./windows/')) {
    return {getWindowsByClass: () => [], show: noop};
  }
  return origLoad.apply(this, arguments);
};

const configs = require('../src-main/ai-model-configs.js');
const settings = require('../src-main/settings.js');

// 临时 userData 里可能残留上次运行写入的配置，先清空保证从零开始
settings.aiModelConfigs = [];
settings.activeAiModelConfigId = null;

// ── 1. 空配置的全新用户：注入 4 条免费配置，激活项默认第一条免费模型 ──
let state = configs.getModelConfigs();
assert.strictEqual(state.configs.length, 4, 'fresh user should get 4 free configs');
assert.ok(state.configs.every((c) => c.isFree && c.id.startsWith('free_')), 'all injected configs flagged free');
assert.strictEqual(state.activeId, 'free_deepseek-v4.1-flash', 'fresh user defaults to first free model');
assert.ok(state.configs[0].apiKey.startsWith('sk-'), 'free configs carry the built-in key');
assert.strictEqual(state.configs[0].provider, 'free');
assert.strictEqual(state.configs[0].customContextLimit, 1000000, 'context limit 1M');
assert.strictEqual(state.configs[0].freeExpired, false, 'activity is live before the deadline');

// ── 2. 已有自有配置的用户：激活项保持不变 ──
settings.aiModelConfigs = [
  {id: 'cfg_mine', name: 'My GPT', provider: 'openai', model: 'gpt-5.4', apiKey: 'sk-user', apiFormat: 'openai', customEndpoint: '', customModelId: '', customContextLimit: 32000, thinkingLevel: 'medium'}
];
settings.activeAiModelConfigId = 'cfg_mine';
state = configs.getModelConfigs();
assert.strictEqual(state.configs.length, 5, '4 free + 1 own');
assert.strictEqual(state.activeId, 'cfg_mine', 'existing active config untouched');
assert.strictEqual(state.configs[0].id, 'free_deepseek-v4.1-flash', 'free configs listed first');

// ── 3. 保存时剥离免费配置：密钥不落盘 ──
configs.saveModelConfigs(state.configs, 'free_glm-5.2', null).then((saved) => {
  const persisted = settings.aiModelConfigs;
  assert.strictEqual(persisted.length, 1, 'only the own config is persisted');
  assert.ok(!JSON.stringify(persisted).includes('sk-5oRt'), 'built-in key never written to settings');
  assert.strictEqual(saved.activeId, 'free_glm-5.2', 'active free model id is preserved in-memory');
  assert.strictEqual(saved.configs.length, 5, 'returned list still contains the 4 free configs');

  // ── 4. 指向无效配置的激活项：回落到第一条自有配置 ──
  state = configs.getModelConfigs();
  // 上面 saveModelConfigs 已把 activeId 存成 free_glm-5.2，读取时应保留
  assert.strictEqual(state.activeId, 'free_glm-5.2', 'valid free active id kept');
  settings.activeAiModelConfigId = 'cfg_gone';
  state = configs.getModelConfigs();
  assert.strictEqual(state.activeId, 'cfg_mine', 'invalid active id falls back to first own config');

  // ── 5. 活动结束（模拟时钟拨过 2026-11-30 12:00 UTC+8）──
  // 免费模型仍注入（供界面灰显“免费使用活动已结束”），带 freeExpired 标记；
  // 激活项停留在免费模型上时自动回落到自有配置；保存仍剥离免费配置。
  const realNow = Date.now;
  Date.now = () => Date.UTC(2026, 11, 30, 5, 0, 0); // 2026-12-30 13:00 UTC+8，已过期
  try {
    settings.activeAiModelConfigId = 'free_glm-5.2';
    state = configs.getModelConfigs();
    assert.strictEqual(state.configs.length, 5, 'expired free configs still injected for gray display');
    assert.ok(state.configs.slice(0, 4).every((c) => c.freeExpired === true), 'expired flag set on all free configs');
    assert.strictEqual(state.activeId, 'cfg_mine', 'active id moved off expired free model');
    settings.activeAiModelConfigId = 'free_deepseek-v4.1-flash';
    return configs.saveModelConfigs(state.configs, 'free_deepseek-v4.1-flash', null).then((saved) => {
      assert.strictEqual(saved.activeId, 'cfg_mine', 'save also refuses expired free active id');
      assert.ok(!JSON.stringify(settings.aiModelConfigs).includes('sk-5oRt'), 'key still never persisted');
      Date.now = realNow;
      console.log('ALL MAIN-PROCESS FREE-MODEL TESTS PASSED');
    });
  } catch (err) {
    Date.now = realNow;
    throw err;
  }
}).catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

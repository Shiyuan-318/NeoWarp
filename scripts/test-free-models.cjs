// 内置免费模型下线后的回归测试：
// 1) 源码里不再保留硬编码的免费中转 API Key
// 2) 主进程不再注入任何免费配置
// 3) 存量数据里的 free_* 配置（旧密钥）在读取/保存时被清理
// 4) 端点规范化按 API 格式补全路径（OpenAI / Anthropic / Ollama）
// 拦截 electron 与窗口模块，脱离 Electron 运行
const Module = require('module');
const fs = require('fs');
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

// ── 1. 源码里不再有内置密钥 ──
const source = fs.readFileSync(path.join(__dirname, '../src-main/ai-model-configs.js'), 'utf8');
assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(source), 'no hardcoded sk- API key in ai-model-configs.js');
assert.ok(!source.includes('api.sy1.top'), 'free relay endpoint removed from ai-model-configs.js');
assert.ok(!/FREE_MODEL_API_KEY/.test(source), 'no FREE_MODEL_API_KEY constant');

const rendererFiles = [
  '../src-renderer/ai-assistant/ai-assistant.html',
  '../src-renderer/desktop-settings/desktop-settings.html',
  '../src-renderer/extension-editor/ai-shared.js'
];
for (const file of rendererFiles) {
  const text = fs.readFileSync(path.join(__dirname, file), 'utf8');
  assert.ok(!text.includes('api.sy1.top'), file + ': free relay endpoint removed');
  assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(text), file + ': no hardcoded API key');
}

// ── 2. 全新用户：不再注入免费配置 ──
settings.aiModelConfigs = [];
settings.activeAiModelConfigId = null;
let state = configs.getModelConfigs();
assert.strictEqual(state.configs.length, 0, 'fresh user gets no injected configs');
assert.strictEqual(state.activeId, null, 'no active config when list is empty');

// ── 3. 存量 free_* 配置（带旧密钥）在读取时被清理 ──
settings.aiModelConfigs = [
  {id: 'free_deepseek-v4.1-flash', name: 'Free', provider: 'free', model: 'deepseek-v4.1-flash', apiKey: 'sk-legacy-free-key', apiFormat: 'openai', customEndpoint: '', customModelId: '', customContextLimit: 1000000, thinkingLevel: 'medium', isFree: true},
  {id: 'cfg_mine', name: 'My GPT', provider: 'openai', model: 'gpt-5.4', apiKey: 'sk-user', apiFormat: 'openai', customEndpoint: '', customModelId: '', customContextLimit: 32000, thinkingLevel: 'medium'}
];
settings.activeAiModelConfigId = 'free_deepseek-v4.1-flash';
state = configs.getModelConfigs();
assert.strictEqual(state.configs.length, 1, 'legacy free config filtered out');
assert.strictEqual(state.configs[0].id, 'cfg_mine');
assert.strictEqual(state.activeId, 'cfg_mine', 'active id falls back to the remaining config');
assert.ok(!JSON.stringify(settings.aiModelConfigs).includes('sk-legacy-free-key'), 'legacy key scrubbed from settings');

// ── 4. 保存时同样剥离免费配置（旧渲染端可能仍回传它们）──
configs.saveModelConfigs(state.configs.concat([
  {id: 'free_glm-5.2', provider: 'free', model: 'glm-5.2', apiKey: 'sk-legacy-free-key', apiFormat: 'openai'}
]), 'free_glm-5.2', null).then((saved) => {
  assert.strictEqual(settings.aiModelConfigs.length, 1, 'only the own config is persisted');
  assert.ok(!JSON.stringify(settings.aiModelConfigs).includes('sk-legacy-free-key'), 'key never written to settings');
  assert.strictEqual(saved.configs.length, 1, 'returned list contains only own configs');
  assert.strictEqual(saved.activeId, 'cfg_mine', 'active id cannot point to a removed free config');

  // ── 5. 端点规范化按格式补路径 ──
  const normalize = configs.normalizeCustomEndpoint;
  assert.strictEqual(normalize('https://api.deepseek.com', 'openai'), 'https://api.deepseek.com/chat/completions');
  assert.strictEqual(normalize('https://api.deepseek.com/v1', 'openai'), 'https://api.deepseek.com/v1/chat/completions');
  assert.strictEqual(normalize('https://api.deepseek.com/chat/completions', 'openai'), 'https://api.deepseek.com/chat/completions');
  assert.strictEqual(normalize('https://api.anthropic.com', 'anthropic'), 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(normalize('https://api.anthropic.com/v1', 'anthropic'), 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(normalize('https://api.anthropic.com/v1/messages', 'anthropic'), 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(normalize('http://localhost:11434', 'ollama'), 'http://localhost:11434/api/chat');
  assert.strictEqual(normalize('http://localhost:11434/api', 'ollama'), 'http://localhost:11434/api/chat');
  assert.strictEqual(normalize('http://localhost:11434/api/chat', 'ollama'), 'http://localhost:11434/api/chat');

  // 保存入口按 apiFormat 落盘（Anthropic 端点不能补成 /chat/completions）
  const saved2 = configs.saveModelConfigs([{
    id: 'cfg_claude',
    name: 'Claude',
    provider: 'custom',
    model: 'custom',
    apiKey: 'sk-ant',
    apiFormat: 'anthropic',
    customEndpoint: 'https://api.anthropic.com',
    customModelId: 'claude-sonnet-4-5',
    customContextLimit: 200000,
    thinkingLevel: 'medium'
  }], 'cfg_claude', null);
  return saved2.then((result) => {
    assert.strictEqual(result.configs[0].customEndpoint, 'https://api.anthropic.com/v1/messages', 'anthropic endpoint normalized at save time');
    console.log('ALL FREE-MODEL REMOVAL TESTS PASSED');
  });
}).catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

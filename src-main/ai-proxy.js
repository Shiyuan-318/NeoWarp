const crypto = require('crypto');

/**
 * AI 转发协议（tw-ai-proxy）的准入与目标策略。
 *
 * 背景：tw-ai-proxy 注册时带 bypassCSP，任何窗口的脚本都能绕过自己页面的
 * connect-src 访问它。若主进程侧不校验来源，它就是「任意域名 + 任意请求头」
 * 的外传通道；而改造前那种「拿不到 Origin/Referer 就放行」的判定更是彻底
 * fail-open，等于给所有窗口开了一扇不设防的门。
 *
 * 这里改用「能力令牌」（capability token）做准入：
 *   1. 令牌只由主进程通过 IPC 签发，且签发前校验发起窗口的真实 URL 必须在
 *      ALLOWED_CALLER_ORIGINS 里——别的窗口连令牌都拿不到；
 *   2. 令牌与签发页面绑定（记录 origin），请求带 Origin/Referer 时必须与
 *      令牌绑定的来源一致，来源对不上直接拒绝；
 *   3. 令牌同时约束「可访问的目标」：内置服务商 + 用户已保存的自定义端点 +
 *      回环地址。页面自身的 connect-src 白名单不再被转发协议绕过，注入到
 *      AI 页面里的脚本也没法把对话内容外传到任意域名。
 *
 * 令牌只存在于内存中，不落盘、不进日志，退出即失效。
 */

// 允许使用转发协议的页面来源（页面协议即来源前缀）
const ALLOWED_CALLER_ORIGINS = [
  'tw-ai-assistant://',
  'tw-solo://',
  'tw-extension-editor://',
  'tw-desktop-settings://'
];

// 内置服务商的 origin。须与 ai-assistant.html 的 PROVIDERS、
// desktop-settings.html 的 AI_PROVIDERS 保持一致（与 protocols.js 的
// AI_CONNECT_SRC 同源）。
const BUILTIN_TARGET_ORIGINS = new Set([
  'https://api.openai.com',
  'https://api.anthropic.com',
  'https://api.deepseek.com',
  'https://open.bigmodel.cn',
  'https://api.moonshot.cn',
  'https://generativelanguage.googleapis.com',
  'https://api.huaweicloud.com',
  'https://dashscope.aliyuncs.com'
]);

// 令牌有效期（毫秒）、单次可申请的额外目标数量上限、令牌表上限
const TOKEN_TTL = 6 * 60 * 60 * 1000;
const MAX_EXTRA_TARGETS = 4;
const MAX_TOKEN_RECORDS = 64;

/**
 * 令牌表：key = `${origin}|${额外目标}`，value = {token, origin, extras, expiresAt}
 * @type {Map<string, {token: string, origin: string, extras: string[], expiresAt: number}>}
 */
const tokenRecords = new Map();

/**
 * 令牌反查表：token -> key
 * @type {Map<string, string>}
 */
const tokenKeys = new Map();

/**
 * 取出 URL 所属的允许来源（页面协议前缀）。
 * @param {string} url 发起窗口的 URL
 * @returns {string|null} 命中的来源前缀，未命中返回 null
 */
const getAllowedCallerOrigin = (url) => {
  const lower = String(url || '').toLowerCase();
  if (!lower) return null;
  return ALLOWED_CALLER_ORIGINS.find((origin) => lower.startsWith(origin)) || null;
};

/**
 * 是否回环地址（本地推理：Ollama / LM Studio / llama.cpp）。
 * @param {string} hostname
 * @returns {boolean}
 */
const isLoopbackHost = (hostname) => {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
};

/**
 * 是否云厂商元数据地址（SSRF 的经典目标，绝不可能是模型端点）。
 * @param {string} hostname
 * @returns {boolean}
 */
const isMetadataHost = (hostname) => {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'metadata.google.internal' || host === 'metadata.goog' || host === 'instance-data') {
    return true;
  }
  if (host === '100.100.100.200') return true; // 阿里云元数据
  if (host === 'fd00:ec2::254') return true; // AWS IPv6 元数据
  return /^169\.254\./.test(host); // 链路本地，含 169.254.169.254
};

/**
 * 是否内网地址（私有网段 / 链路本地 / CGNAT）。
 * @param {string} hostname
 * @returns {boolean}
 */
const isPrivateHost = (hostname) => {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (isLoopbackHost(host)) return false; // 回环单独处理（本地推理是受支持的场景）
  if (isMetadataHost(host)) return true;
  if (/^10\./.test(host)) return true; // 私有 A 段
  if (/^192\.168\./.test(host)) return true; // 私有 C 段
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true; // 私有 B 段
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return true; // CGNAT 100.64/10
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // 唯一本地地址 fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // 链路本地 fe80::/10
  if (host === '0.0.0.0' || host === '::') return true; // 未指定地址
  return false;
};

/**
 * 用户已保存的自定义端点来源集合（AI 助手等页面用的就是这些配置）。
 * 回环地址不算在内：本地推理是内置支持场景，任何端口都允许。
 * @returns {Set<string>}
 */
const getConfiguredTargetOrigins = () => {
  const origins = new Set();
  let configs = [];
  try {
    // 延迟 require：ai-model-configs 也依赖本模块，顶层 require 会形成循环依赖
    const {getModelConfigs} = require('./ai-model-configs');
    configs = (getModelConfigs() || {}).configs || [];
  } catch (error) {
    configs = [];
  }
  for (const config of configs) {
    if (!config || !config.customEndpoint) continue;
    try {
      origins.add(new URL(config.customEndpoint).origin);
    } catch (error) {
      // 端点非法交给渲染层报错，这里忽略
    }
  }
  return origins;
};

/**
 * 计算某个令牌可访问的目标集合。
 * @param {string[]} extras 令牌额外授予的目标来源（如设置页尚未保存的草稿端点）
 * @returns {{allowed: Set<string>, configured: Set<string>}}
 */
const getAllowedTargetOrigins = (extras) => {
  const configured = getConfiguredTargetOrigins();
  const allowed = new Set(BUILTIN_TARGET_ORIGINS);
  for (const origin of configured) allowed.add(origin);
  for (const origin of extras || []) allowed.add(origin);
  return {allowed, configured};
};

/**
 * 签发能力令牌。
 * @param {string} origin 发起页面的来源前缀（必须在白名单里）
 * @param {string[]} [targets] 额外授予的目标 URL（仅取 origin）
 * @returns {string} 令牌
 */
const issueToken = (origin, targets) => {
  if (!ALLOWED_CALLER_ORIGINS.includes(origin)) {
    throw new Error('AI proxy is not allowed on this page');
  }
  const extras = [];
  for (const raw of (Array.isArray(targets) ? targets : []).slice(0, MAX_EXTRA_TARGETS)) {
    let url;
    try {
      url = new URL(String(raw));
    } catch (error) {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    // 元数据地址任何情况下都不放行
    if (isMetadataHost(url.hostname)) continue;
    const extraOrigin = url.origin;
    if (!extras.includes(extraOrigin)) extras.push(extraOrigin);
  }
  const key = `${origin}|${extras.join(',')}`;
  const existing = tokenRecords.get(key);
  if (existing && existing.expiresAt > Date.now()) {
    existing.expiresAt = Date.now() + TOKEN_TTL;
    return existing.token;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  tokenRecords.set(key, {token, origin, extras, expiresAt: Date.now() + TOKEN_TTL});
  tokenKeys.set(token, key);
  // 顺手清掉过期记录，令牌表不会随使用次数无限增长
  for (const [recordKey, record] of tokenRecords) {
    if (record.expiresAt <= Date.now()) {
      tokenRecords.delete(recordKey);
      tokenKeys.delete(record.token);
    }
  }
  // 令牌表上限：同一页面反复换草稿端点也不至于无限堆积
  while (tokenRecords.size > MAX_TOKEN_RECORDS) {
    const oldestKey = tokenRecords.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = tokenRecords.get(oldestKey);
    tokenRecords.delete(oldestKey);
    if (oldest) tokenKeys.delete(oldest.token);
  }
  return token;
};

/**
 * 校验令牌。
 * @param {string} token
 * @returns {{origin: string, extras: string[]}|null} 有效则返回令牌信息
 */
const verifyToken = (token) => {
  if (!token) return null;
  const key = tokenKeys.get(token);
  if (!key) return null;
  const record = tokenRecords.get(key);
  if (!record) return null;
  // 同一个 key 轮换过令牌时，旧令牌必须立即失效
  if (record.token !== token) return null;
  if (record.expiresAt <= Date.now()) {
    tokenRecords.delete(key);
    tokenKeys.delete(token);
    return null;
  }
  return {origin: record.origin, extras: record.extras};
};

/**
 * 目标 URL 是否允许转发。
 * @param {URL} targetURL
 * @param {{origin: string, extras: string[]}} grant 令牌信息
 * @returns {boolean}
 */
const isTargetAllowed = (targetURL, grant) => {
  if (targetURL.protocol !== 'https:' && targetURL.protocol !== 'http:') return false;
  const hostname = targetURL.hostname;
  // 云厂商元数据地址：任何情况下都不允许
  if (isMetadataHost(hostname)) return false;
  const {allowed, configured} = getAllowedTargetOrigins(grant && grant.extras);
  const targetOrigin = targetURL.origin;
  // 回环地址（本地推理）任意端口都放行
  if (isLoopbackHost(hostname)) return true;
  // 其余目标必须在允许集合里：内置服务商 / 用户已保存的自定义端点 /
  // 设置页显式授予的草稿端点
  if (!allowed.has(targetOrigin)) return false;
  // 内网地址只有用户自己在配置里保存过的那个才放行（LAN 推理等场景）
  if (isPrivateHost(hostname) && !configured.has(targetOrigin)) return false;
  return true;
};

/**
 * 请求来源是否与令牌绑定的页面一致。
 *
 * 与改造前的差别：这里不再「拿不到来源头就放行」——放行与否由令牌决定，
 * 来源头只用于「进一步确认」，对不上就拒绝。
 * @param {Request} request
 * @param {{origin: string}} grant
 * @returns {boolean}
 */
const isCallerOriginConsistent = (request, grant) => {
  if (!grant || !grant.origin) return false;
  const origin = String((request.headers && request.headers.get('origin')) || '').toLowerCase();
  const referrer = String((request.referrer || '')).toLowerCase();
  // Origin 为 'null' 表示不透明来源（页面协议未注册为 standard），无法据此
  // 判定身份，跳过比较（令牌本身已经证明了调用方身份）
  if (origin && origin !== 'null' && !origin.startsWith(grant.origin)) return false;
  if (referrer && !referrer.startsWith(grant.origin)) return false;
  return true;
};

module.exports = {
  ALLOWED_CALLER_ORIGINS,
  BUILTIN_TARGET_ORIGINS,
  getAllowedCallerOrigin,
  getAllowedTargetOrigins,
  isCallerOriginConsistent,
  isLoopbackHost,
  isMetadataHost,
  isPrivateHost,
  isTargetAllowed,
  issueToken,
  verifyToken
};

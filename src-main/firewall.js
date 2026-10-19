/*
 * 局域网协作的防火墙放行。
 *
 * 发起协作时本机要监听 TCP 端口，系统防火墙（Windows 防火墙 / ufw /
 * firewalld / macOS 应用防火墙）可能拦截入站连接，导致伙伴搜不到房间、
 * 连不上主机。这里在用户发起协作时检查并（经系统授权弹窗确认）添加
 * 放行规则；加入协作只做出站连接（常见系统默认放行），因此只做静默
 * 检查、能不弹窗就不打扰。
 */
const {spawn} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 规则名刻意不含空格，简化 netsh / PowerShell / shell 的转义
const RULE_NAME_PROGRAM = 'NeoWarp-Collaboration';
const ruleNameForPort = port => `NeoWarp-Collaboration-TCP-${port}`;

// UAC / polkit / 管理员授权对话框约 2 分钟无操作会自动取消
const ELEVATION_TIMEOUT_MS = 150000;
const QUICK_TIMEOUT_MS = 20000;

// 本会话内已确认的结果：避免重复查询，也避免重试连接时反复弹授权窗
const resolvedKeys = new Set();

function runCommand (command, args, timeoutMs = QUICK_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    } catch (e) {
      resolve({code: -1, stdout: '', stderr: String((e && e.message) || e)});
      return;
    }
    let settled = false;
    let stdout = '';
    let stderr = '';
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch (e) {}
      finish({code: -1, stdout, stderr, timedOut: true});
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', e => {
      finish({code: -1, stdout, stderr: String((e && e.message) || e)});
    });
    child.on('close', code => {
      finish({code, stdout, stderr});
    });
  });
}

/* ===== Windows ===== */

// PowerShell 单引号字符串：除 ' 需成对转义外全部按字面处理
const psQuote = value => `'${String(value).replace(/'/g, "''")}'`;
const psEncoded = script => Buffer.from(script, 'utf16le').toString('base64');

function isExeUnderTemp () {
  const exe = path.normalize(process.execPath).toLowerCase();
  const tmp = path.normalize(os.tmpdir()).toLowerCase();
  if (!tmp) return false;
  return exe.startsWith(tmp.endsWith(path.sep) ? tmp : tmp + path.sep);
}

// 便携版每次启动解压到临时目录、路径会变化，按程序放行会失效，
// 因此便携版按端口号放行；安装版按程序放行，一次授权长期有效。
function getRuleName (port) {
  return isExeUnderTemp() ? ruleNameForPort(port) : RULE_NAME_PROGRAM;
}

function buildRuleArgs (ruleName, port) {
  const args = ['advfirewall', 'firewall', 'add', 'rule',
    `name=${ruleName}`, 'dir=in', 'action=allow', 'enable=yes',
    'profile=any', 'protocol=TCP'];
  if (ruleName === ruleNameForPort(port)) {
    args.push(`localport=${port}`);
  } else {
    args.push(`program=${process.execPath}`);
  }
  return args;
}

async function ruleExists (ruleName) {
  const res = await runCommand('netsh',
    ['advfirewall', 'firewall', 'show', 'rule', `name=${ruleName}`]);
  if (res.code !== 0) return false;
  // 程序移动 / 重装后旧的按程序放行规则指向旧路径，视为不存在以便重建
  if (ruleName === RULE_NAME_PROGRAM) {
    return res.stdout.toLowerCase().includes(process.execPath.toLowerCase());
  }
  return true;
}

async function isAdmin () {
  const res = await runCommand('net', ['session']);
  return res.code === 0;
}

async function netshAdd (ruleName, port) {
  // 同名旧规则（如程序移动过）先删除；删除不存在的规则会报错但无碍
  await runCommand('netsh',
    ['advfirewall', 'firewall', 'delete', 'rule', `name=${ruleName}`]);
  const res = await runCommand('netsh', buildRuleArgs(ruleName, port));
  return res.code === 0;
}

// 经 UAC 提权执行 netsh：外层 PowerShell 用 -EncodedCommand 传递脚本
// （Base64 免转义），内层同样以 EncodedCommand 提权运行 netsh。
async function elevatedNetshAdd (ruleName, port) {
  const inner =
    `& netsh @(${['advfirewall', 'firewall', 'delete', 'rule', `name=${ruleName}`].map(psQuote).join(', ')}) | Out-Null; ` +
    `& netsh @(${buildRuleArgs(ruleName, port).map(psQuote).join(', ')}) | Out-Null; ` +
    'exit $LASTEXITCODE';
  const outer =
    '$ErrorActionPreference = "Stop"; ' +
    '$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden ' +
    `-ArgumentList @('-NoProfile', '-NonInteractive', '-EncodedCommand', ${psQuote(psEncoded(inner))}); ` +
    'exit $p.ExitCode';
  const res = await runCommand('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', psEncoded(outer)],
    ELEVATION_TIMEOUT_MS);
  return res.code === 0;
}

async function ensureWindows ({ port, interactive }) {
  // Microsoft Store（AppX）版本由系统打包机制管理网络能力
  if (process.windowsStore) {
    return {status: 'not-needed'};
  }
  const ruleName = getRuleName(port);
  const key = `win32:${ruleName}`;
  if (resolvedKeys.has(key)) return {status: 'allowed'};
  if (await ruleExists(ruleName)) {
    resolvedKeys.add(key);
    return {status: 'allowed'};
  }
  if (await isAdmin()) {
    const added = await netshAdd(ruleName, port);
    if (added && await ruleExists(ruleName)) {
      resolvedKeys.add(key);
      return {status: 'granted'};
    }
    return {status: 'failed', message: '无法添加防火墙规则'};
  }
  if (!interactive) {
    // 静默模式（如加入协作）：不弹 UAC，仅标记未确认
    return {status: 'undetermined'};
  }
  const approved = await elevatedNetshAdd(ruleName, port);
  if (approved && await ruleExists(ruleName)) {
    resolvedKeys.add(key);
    return {status: 'granted'};
  }
  return {status: 'declined'};
}

/* ===== Linux ===== */

const UFW_PATHS = ['/usr/sbin/ufw', '/usr/bin/ufw', '/sbin/ufw'];
const FIREWALLD_PATHS = ['/usr/bin/firewall-cmd', '/usr/local/bin/firewall-cmd'];
const PKEXEC_PATHS = ['/usr/bin/pkexec', '/usr/local/bin/pkexec'];

function firstExisting (candidates) {
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (e) {}
  }
  return null;
}

async function isSystemdUnitActive (unit) {
  const res = await runCommand('systemctl', ['is-active', unit]);
  return res.code === 0 && res.stdout.trim() === 'active';
}

async function ensureLinux ({ port, interactive }) {
  const key = `linux:tcp:${port}`;
  if (resolvedKeys.has(key)) return {status: 'allowed'};

  const ufw = firstExisting(UFW_PATHS);
  const firewalld = firstExisting(FIREWALLD_PATHS);
  // 多数桌面发行版默认未启用防火墙：逐一探测，都未启用则无需处理
  const ufwActive = ufw
    ? (await isSystemdUnitActive('ufw')) ||
      (await runCommand(ufw, ['status'])).stdout.toLowerCase().includes('status: active')
    : false;
  const firewalldActive = firewalld
    ? (await isSystemdUnitActive('firewalld')) ||
      /running/i.test((await runCommand(firewalld, ['--state'])).stdout)
    : false;

  if (!ufwActive && !firewalldActive) {
    resolvedKeys.add(key);
    return {status: 'not-needed'};
  }
  if (!interactive) return {status: 'undetermined'};

  const pkexec = firstExisting(PKEXEC_PATHS);
  if (!pkexec) {
    return {status: 'failed', message: '未找到 pkexec，无法弹出授权窗口'};
  }
  const commands = [];
  if (ufwActive) {
    commands.push([pkexec, [ufw, 'allow', `${port}/tcp`]]);
  }
  if (firewalldActive) {
    commands.push([pkexec, [firewalld, '--permanent', `--add-port=${port}/tcp`]]);
    commands.push([pkexec, [firewalld, '--reload']]);
  }
  for (const [bin, args] of commands) {
    const res = await runCommand(bin, args, ELEVATION_TIMEOUT_MS);
    if (res.code !== 0) return {status: 'declined'};
  }
  resolvedKeys.add(key);
  return {status: 'granted'};
}

/* ===== macOS ===== */

const MAC_SOCKET_FILTER = '/usr/libexec/ApplicationFirewall/socketfilterfw';

function shQuote (value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function ensureMacOS ({ interactive }) {
  const key = 'darwin:application-firewall';
  if (resolvedKeys.has(key)) return {status: 'allowed'};
  if (!fs.existsSync(MAC_SOCKET_FILTER)) return {status: 'not-needed'};
  const state = await runCommand(MAC_SOCKET_FILTER, ['--getglobalstate']);
  if (state.code !== 0 || !/enabled/i.test(state.stdout)) {
    // 应用防火墙未开启：入站默认放行
    resolvedKeys.add(key);
    return {status: 'not-needed'};
  }
  if (!interactive) return {status: 'undetermined'};

  const exe = process.execPath;
  const shell = `${MAC_SOCKET_FILTER} --add ${shQuote(exe)} && ${MAC_SOCKET_FILTER} --unblockapp ${shQuote(exe)}`;
  const res = await runCommand('osascript', ['-e',
    `do shell script ${JSON.stringify(shell)} with prompt "NeoWarp 需要允许传入网络连接，局域网伙伴才能加入协作房间" with administrator privileges`
  ], ELEVATION_TIMEOUT_MS);
  if (res.code === 0) {
    resolvedKeys.add(key);
    return {status: 'granted'};
  }
  return {status: /canceled|cancelled|-128/i.test(res.stderr) ? 'declined' : 'failed'};
}

/**
 * 确保本机防火墙放行局域网协作使用的 TCP 端口。
 *
 * @param {object} options
 * @param {number} options.port 协作端口
 * @param {'host'|'join'} options.mode 发起协作需要入站放行，必要时弹出系统
 *   授权窗口；加入协作仅出站连接，默认静默检查（interactive: false）
 * @returns {Promise<{status: 'allowed'|'granted'|'declined'|'failed'|'not-needed'|'undetermined', message?: string}>}
 *   allowed：规则已存在；granted：本次已添加；declined：用户取消了授权弹窗；
 *   failed：添加失败；not-needed：当前防火墙状态无需处理；undetermined：
 *   静默模式下发现缺少规则、未做处理
 */
async function ensureCollaborationFirewall ({ port, mode, interactive = mode === 'host' }) {
  try {
    if (process.platform === 'win32') return await ensureWindows({port, interactive});
    if (process.platform === 'darwin') return await ensureMacOS({interactive});
    if (process.platform === 'linux') return await ensureLinux({port, interactive});
    return {status: 'not-needed'};
  } catch (e) {
    return {status: 'failed', message: String((e && e.message) || e)};
  }
}

module.exports = {ensureCollaborationFirewall};

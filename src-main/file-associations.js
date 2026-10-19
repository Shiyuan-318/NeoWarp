const {execFile} = require('child_process');
const path = require('path');
const packageJSON = require('../package.json');

// 允许用户在桌面设置中勾选关联/取消关联的扩展名。
// 这两个格式常被其他程序占用（.js 属于文本编辑器、.sb3 属于其他 Scratch 改版），
// 因此提供开关而不是像安装器一样强制关联。
const MANAGED_EXTENSIONS = ['sb3', 'js'];

// 与安装器（NSIS，按用户安装时写入 HKCU）保持一致的键布局：
//   HKCU\Software\Classes\.{ext}             默认值 = ProgID
//   HKCU\Software\Classes\.{ext}\OpenWithProgids   值名 = ProgID
//   HKCU\Software\Classes\{ProgID}           默认值 = 描述
//   HKCU\Software\Classes\{ProgID}\shell\open\command
// ProgID 直接取 package.json build.fileAssociations 的 name 字段，
// 与安装器生成的 FILECLASS 完全一致。
const REG_HKCU_CLASSES = 'HKCU\\Software\\Classes';
const USER_CHOICE_TEMPLATE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.{ext}\\UserChoice';
const REG_EXE = path.join(
  process.env.SystemRoot || process.env.windir || 'C:\\Windows',
  'System32',
  'reg.exe'
);

const isSupported = () => process.platform === 'win32' && !process.windowsStore;

// productName 位于 build 配置内（与 electron-builder 的取值处一致）
const PRODUCT_NAME = (packageJSON.build && packageJSON.build.productName) || packageJSON.name;

/**
 * 从 package.json 的安装器配置中解析出需要管理的扩展名定义。
 * @returns {{ext: string, progId: string, description: string}[]}
 */
const getDefinitions = () => {
  const installerAssociations = (packageJSON.build && packageJSON.build.fileAssociations) || [];
  const definitions = [];
  for (const ext of MANAGED_EXTENSIONS) {
    const item = installerAssociations.find((association) => [].concat(association.ext).includes(ext));
    if (!item) continue;
    definitions.push({
      ext,
      progId: item.name || ext,
      description: item.description || item.name || ext
    });
  }
  return definitions;
};

/**
 * 执行 reg.exe。查询类调用在键/值不存在时（退出码非 0）视为 null 而不是错误。
 * @param {string[]} args
 * @param {boolean} [allowMissing] 键或值不存在时返回 null
 * @returns {Promise<string|null>} stdout
 */
const runReg = (args, allowMissing) => new Promise((resolve, reject) => {
  execFile(REG_EXE, args, (error, stdout, stderr) => {
    if (error) {
      if (allowMissing) {
        resolve(null);
      } else {
        reject(new Error(String(stderr || error.message).trim()));
      }
      return;
    }
    resolve(stdout);
  });
});

/**
 * 读取注册表字符串值（REG_SZ）。键或值不存在时返回 null。
 * reg.exe 的输出格式与系统语言无关的部分是类型名 REG_SZ，据此解析。
 * @param {string} keyPath
 * @param {string|null} valueName null 表示读取默认值
 */
const readRegString = async (keyPath, valueName) => {
  const args = ['query', keyPath];
  if (valueName === null) {
    args.push('/ve');
  } else {
    args.push('/v', valueName);
  }
  const stdout = await runReg(args, true);
  if (stdout === null) return null;
  for (const line of stdout.split(/\r?\n/)) {
    const typeIndex = line.indexOf('REG_SZ');
    if (typeIndex !== -1) {
      return line.slice(typeIndex + 'REG_SZ'.length).trim();
    }
  }
  return null;
};

/**
 * 读取当前实际生效的扩展名 ProgID：优先查 HKCR 合并视图（同时覆盖
 * 按用户安装写入的 HKCU 与按机器安装写入的 HKLM）。
 */
const getEffectiveProgId = async (ext) => {
  const effective = await readRegString(`HKCR\\.${ext}`, null);
  if (effective !== null) return effective;
  const perUser = await readRegString(`${REG_HKCU_CLASSES}\\.${ext}`, null);
  if (perUser !== null) return perUser;
  return readRegString(`HKLM\\Software\\Classes\\.${ext}`, null);
};

/**
 * 读取用户在系统中手动指定的默认程序（“打开方式”→“始终”）。
 * 该键受系统保护无法写入，但可以删除以恢复由 ProgID 默认值决定的行为。
 */
const getUserChoiceProgId = (ext) =>
  readRegString(USER_CHOICE_TEMPLATE.replace('{ext}', ext), 'ProgId');

const removeUserChoice = (ext) =>
  runReg(
    ['delete', USER_CHOICE_TEMPLATE.replace('{ext}', ext), '/f'],
    true
  );

/**
 * 当前是否由 NeoWarp 处理该扩展名：生效 ProgID 匹配，且用户没有在
 * 系统里为它指定其他程序。
 * @param {{ext: string, progId: string}} definition
 * @returns {Promise<boolean>}
 */
const isAssociated = async (definition) => {
  const effectiveProgId = await getEffectiveProgId(definition.ext);
  if (effectiveProgId !== definition.progId) return false;
  const userChoice = await getUserChoiceProgId(definition.ext);
  if (userChoice && userChoice !== definition.progId) return false;
  return true;
};

/**
 * 写入关联，键布局与安装器一致。
 * @param {{ext: string, progId: string, description: string}} definition
 */
const enableAssociation = async (definition) => {
  const exe = process.execPath;
  const commandText = `Open with ${PRODUCT_NAME}`;
  const command = `"${exe}" "%1"`;
  const icon = `"${exe},0"`;
  const extKey = `${REG_HKCU_CLASSES}\\.${definition.ext}`;
  const progIdKey = `${REG_HKCU_CLASSES}\\${definition.progId}`;
  await runReg(['add', extKey, '/ve', '/d', definition.progId, '/f']);
  await runReg(['add', `${extKey}\\OpenWithProgids`, '/v', definition.progId, '/t', 'REG_NONE', '/d', '', '/f']);
  await runReg(['add', progIdKey, '/ve', '/d', definition.description, '/f']);
  await runReg(['add', `${progIdKey}\\DefaultIcon`, '/ve', '/d', icon, '/f']);
  await runReg(['add', `${progIdKey}\\shell`, '/ve', '/d', 'open', '/f']);
  await runReg(['add', `${progIdKey}\\shell\\open`, '/ve', '/d', commandText, '/f']);
  await runReg(['add', `${progIdKey}\\shell\\open\\command`, '/ve', '/d', command, '/f']);
  // 用户曾在系统中指定过其他程序时，UserChoice 优先于 ProgID 默认值，
  // 删除它让刚写入的关联立即生效
  const userChoice = await getUserChoiceProgId(definition.ext);
  if (userChoice && userChoice !== definition.progId) {
    await removeUserChoice(definition.ext);
  }
};

/**
 * 移除关联。只清理属于 NeoWarp 的键，不碰其他程序写入的关联；
 * 按机器安装（关联在 HKLM）时删除按用户键后会回落到 HKLM，
 * 因此写入空的按用户默认值将其屏蔽。
 * @param {{ext: string, progId: string}} definition
 */
const disableAssociation = async (definition) => {
  const extKey = `${REG_HKCU_CLASSES}\\.${definition.ext}`;
  const progIdKey = `${REG_HKCU_CLASSES}\\${definition.progId}`;
  await runReg(['delete', progIdKey, '/f'], true);
  await runReg(['delete', `${extKey}\\OpenWithProgids`, '/v', definition.progId, '/f'], true);
  const perUserProgId = await readRegString(extKey, null);
  if (perUserProgId === definition.progId) {
    await runReg(['delete', extKey, '/ve', '/f'], true);
  }
  const effectiveProgId = await getEffectiveProgId(definition.ext);
  if (effectiveProgId === definition.progId) {
    await runReg(['add', extKey, '/ve', '/d', '', '/f'], true);
  }
  // UserChoice 指向已被删除的 ProgID 时会悬空，删除它让系统重新询问
  const userChoice = await getUserChoiceProgId(definition.ext);
  if (userChoice === definition.progId) {
    await removeUserChoice(definition.ext);
  }
};

/**
 * 查询所有受管扩展名的关联状态。
 * @returns {Promise<{ext: string, associated: boolean}[]>}
 */
const getAssociations = async () => {
  const definitions = getDefinitions();
  return Promise.all(definitions.map(async (definition) => ({
    ext: definition.ext,
    associated: await isAssociated(definition)
  })));
};

/**
 * 启用或禁用一个扩展名的关联。
 * @param {string} ext
 * @param {boolean} enabled
 * @returns {Promise<{ext: string, associated: boolean}[]>} 修改后的全部状态
 */
const setAssociation = async (ext, enabled) => {
  const definition = getDefinitions().find((item) => item.ext === ext);
  if (!definition) {
    throw new Error(`Unknown extension: ${ext}`);
  }
  if (enabled) {
    await enableAssociation(definition);
  } else {
    await disableAssociation(definition);
  }
  return getAssociations();
};

module.exports = {
  isSupported,
  getAssociations,
  setAssociation
};

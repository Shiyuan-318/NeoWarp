/**
 * 角色 / 变量 / 列表工具的行为测试。
 *
 * 这些工具原来的 bug 都不会报错，只会静默做错事（改到局部而非全局变量、
 * 把列表覆盖成字符串、下标越界不提示），所以测试的重点是断言"错误被拦住并
 * 给出可操作的信息"，以及"作用域和类型确实按 Scratch 的规则走"。
 *
 * 与 test-dsl-roundtrip.js 一样，直接从 desktop-hoc.jsx 抽出顶层辅助函数，
 * 配合真实的 scratch-vm target 运行。
 *
 *   node scripts/test-data-tools.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOC = path.join(ROOT, 'src-renderer-webpack/editor/gui/desktop-hoc.jsx');

const VirtualMachine = require(path.join(ROOT, 'node_modules/scratch-vm/src/virtual-machine.js'));
const Sprite = require(path.join(ROOT, 'node_modules/scratch-vm/src/sprites/sprite.js'));
const RenderedTarget = require(path.join(ROOT, 'node_modules/scratch-vm/src/sprites/rendered-target.js'));

function loadHelpers () {
  const src = fs.readFileSync(HOC, 'utf8');
  const cut = src.indexOf('const DesktopHOC = function');
  const head = src.slice(0, cut)
    .replace(/^import[\s\S]*?;$/gm, '')
    .replace(/^const \{[\s\S]*?\} = require\([^)]*\);$/gm, '')
    .replace(/^const [A-Za-z_$][\w$]* = require\([^)]*\);$/gm, '');
  const names = [
    'coerceScratchValue', 'resolveDataTarget', 'findDataVariable', 'closestName',
    'listPreview', 'resolveListIndex', 'OPCODE_SCHEMA'
  ];
  // eslint-disable-next-line no-new-func
  return new Function('require', 'module', 'exports',
    head + '\nreturn {' + names.map(n => n + ': typeof ' + n + " !== 'undefined' ? " + n + ' : undefined').join(', ') + '};'
  )(require, { exports: {} }, {});
}

const H = loadHelpers();

let passed = 0;
const failures = [];
function check (name, cond, detail) {
  if (cond) passed++;
  else failures.push(name + (detail ? '\n      ' + detail : ''));
}

/** 造一个含舞台 + 两个角色的最小工程。 */
function makeProject () {
  const vm = new VirtualMachine();
  const mk = (name, isStage) => {
    const sprite = new Sprite(null, vm.runtime);
    sprite.name = name;
    const target = new RenderedTarget(sprite, vm.runtime);
    target.isStage = !!isStage;
    return target;
  };
  const stage = mk('Stage', true);
  const cat = mk('Cat', false);
  const dog = mk('Dog', false);
  vm.runtime.targets = [stage, cat, dog];
  return { vm, stage, cat, dog };
}

function addVar (target, name, value, type) {
  const id = name + '_' + Math.random().toString(36).slice(2, 8);
  target.createVariable(id, name, type || '', false);
  if (value !== undefined) target.variables[id].value = value;
  return target.variables[id];
}

console.log('--- 目标解析（作用域入口）---');
{
  const { vm, stage, cat } = makeProject();
  check('省略 sprite_name 落在舞台', H.resolveDataTarget(vm, {}).target === stage);
  check('sprite_name=Stage 落在舞台', H.resolveDataTarget(vm, { sprite_name: 'Stage' }).target === stage);
  check('中文"舞台"也识别为舞台', H.resolveDataTarget(vm, { sprite_name: '舞台' }).target === stage);
  check('sprite_name=Cat 落在 Cat', H.resolveDataTarget(vm, { sprite_name: 'Cat' }).target === cat);
  const bad = H.resolveDataTarget(vm, { sprite_name: 'Ct' });
  check('角色不存在时报错并列出可选值',
    !bad.target && /not found/.test(bad.error) && /Cat/.test(bad.error) && /Dog/.test(bad.error),
    bad.error);
}

console.log('--- 变量查找：作用域与类型 ---');
{
  const { vm, stage, cat } = makeProject();
  addVar(stage, 'score', 10);
  addVar(cat, 'health', 3);

  const globalFromSprite = H.findDataVariable(vm, cat, 'score', '');
  check('从角色能读到舞台上的全局变量（原来读不到）',
    globalFromSprite.variable && globalFromSprite.scope === 'global' && globalFromSprite.owner === stage,
    JSON.stringify({ found: !!globalFromSprite.variable, scope: globalFromSprite.scope, err: globalFromSprite.error }));

  const localOne = H.findDataVariable(vm, cat, 'health', '');
  check('角色局部变量作用域标为 local', localOne.variable && localOne.scope === 'local');

  const notInScope = H.findDataVariable(vm, stage, 'health', '');
  check('舞台读不到角色的局部变量', !notInScope.variable, notInScope.error);

  addVar(stage, 'queue', [1, 2], 'list');
  const wrongType = H.findDataVariable(vm, stage, 'queue', '');
  check('把列表当变量取时明确指出类型不符（原来会覆盖数组）',
    !wrongType.variable && /is a list, not a variable/.test(wrongType.error), wrongType.error);
  const wrongType2 = H.findDataVariable(vm, stage, 'score', 'list');
  check('把变量当列表取时同样指出类型不符',
    !wrongType2.variable && /is a variable, not a list/.test(wrongType2.error), wrongType2.error);

  const typo = H.findDataVariable(vm, cat, 'scoer', '');
  check('拼错时给出最接近的候选',
    !typo.variable && /Did you mean "score"/.test(typo.error), typo.error);
  check('并列出作用域内所有可用名字',
    /In scope:/.test(typo.error) && /health/.test(typo.error) && /score/.test(typo.error), typo.error);
}

console.log('--- 同名遮蔽 ---');
{
  const { vm, stage, cat } = makeProject();
  addVar(stage, 'lives', 3);
  addVar(cat, 'lives', 99);
  const fromCat = H.findDataVariable(vm, cat, 'lives', '');
  check('角色的同名变量优先于全局（与 Scratch 一致）',
    fromCat.variable.value === 99 && fromCat.scope === 'local');
  const fromStage = H.findDataVariable(vm, stage, 'lives', '');
  check('舞台仍然读到自己的那个', fromStage.variable.value === 3);
}

console.log('--- 值类型转换 ---');
{
  check('数字字符串转成数字', H.coerceScratchValue('42') === 42);
  check('小数字符串转成数字', H.coerceScratchValue('3.5') === 3.5);
  check('负数字符串转成数字', H.coerceScratchValue('-7') === -7);
  check('非数字字符串保持原样', H.coerceScratchValue('hello') === 'hello');
  check('空字符串保持原样（不变成 0）', H.coerceScratchValue('') === '');
  check('纯空格保持原样', H.coerceScratchValue('  ') === '  ');
  check('数字原样通过', H.coerceScratchValue(5) === 5);
  check('布尔原样通过', H.coerceScratchValue(true) === true);
}

console.log('--- 列表下标解析 ---');
{
  const ok = (raw, len, opts) => H.resolveListIndex(raw, len, opts || {});
  check('1 → 下标 0', ok(1, 3).index === 0);
  check('3 → 下标 2', ok(3, 3).index === 2);
  check('"first" → 下标 0', ok('first', 3).index === 0);
  check('"last" → 最后一项', ok('last', 3).index === 2);
  check('字符串 "2" 也能解析', ok('2', 3).index === 1);
  const zero = ok(0, 3);
  check('0 越界并说明有效范围', zero.index === -1 && /out of range/.test(zero.error) && /1–3/.test(zero.error), zero.error);
  const over = ok(4, 3);
  check('超出长度时报错并给出长度', over.index === -1 && /has 3 item/.test(over.error), over.error);
  const nan = ok('abc', 3);
  check('非数字下标给出可操作提示', nan.index === -1 && /must be a number/.test(nan.error), nan.error);
  check('插入模式允许 length+1', ok(4, 3, { allowAppend: true }).index === 3);
  check('插入模式省略下标即追加末尾', ok(undefined, 3, { allowAppend: true }).index === 3);
  const overAppend = ok(5, 3, { allowAppend: true });
  check('插入模式仍拦住 length+2', overAppend.index === -1, overAppend.error);
  check('空列表 + 插入模式可用', ok(1, 0, { allowAppend: true }).index === 0);
  const emptyRead = ok(1, 0);
  check('空列表读取下标必然越界', emptyRead.index === -1, emptyRead.error);
}

console.log('--- 列表预览 ---');
{
  const short = H.listPreview([1, 2, 3]);
  check('短列表全量返回且不标截断', short.length === 3 && short.items.length === 3 && short.truncated === 0);
  const long = H.listPreview(Array.from({ length: 50 }, (_, i) => i), 10);
  check('超长列表按上限截断', long.items.length === 10 && long.length === 50);
  check('并说明还剩多少条', long.truncated === 40);
  const empty = H.listPreview([]);
  check('空列表长度为 0', empty.length === 0 && empty.items.length === 0);
  const notArray = H.listPreview(undefined);
  check('非数组不抛异常', notArray.length === 0);
}

console.log('--- 名字建议 ---');
{
  check('大小写差异能匹配', H.closestName('cat', ['Cat', 'Dog']) === 'Cat');
  check('缺字符能匹配', H.closestName('scoe', ['score', 'health']) === 'score');
  check('包含关系能匹配', H.closestName('sco', ['score', 'health']) === 'score');
  check('完全无关时不乱猜', H.closestName('zzzz', ['score', 'health']) === null);
  check('候选为空时返回 null', H.closestName('x', []) === null);
}

console.log('--- 作用域名单 ---');
{
  const { vm, stage, cat } = makeProject();
  addVar(stage, 'g1', 1);
  addVar(stage, 'g2', 2);
  addVar(cat, 'l1', 3);
  addVar(stage, 'gl', [], 'list');
  const names = cat.getAllVariableNamesInScopeByType('');
  check('角色作用域含自己的与全局的变量',
    names.indexOf('l1') >= 0 && names.indexOf('g1') >= 0 && names.indexOf('g2') >= 0,
    names.join(','));
  check('作用域名单不混入列表', names.indexOf('gl') < 0, names.join(','));
  const listNames = cat.getAllVariableNamesInScopeByType('list');
  check('列表名单单独可查', listNames.indexOf('gl') >= 0, listNames.join(','));
}

console.log('');
console.log(passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('');
  failures.forEach(f => console.log('  FAIL: ' + f));
  process.exit(1);
}

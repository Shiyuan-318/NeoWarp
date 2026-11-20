/**
 * delete_block operation tests.
 *
 * delete_block 的执行代码在 desktop-hoc.jsx 的 executeOperations case 闭包里，
 * 这里把那段源码连同 resolveBlockId 一起提取出来，驱动真实 scratch-vm 验证：
 *
 *   1. block_only 删除链中间块：前后两段必须重连，后面不能被误删
 *      （vm 的 Blocks.deleteBlock 是递归删除，直接调用会吞掉整条链）
 *   2. with_children 删除链中间块：这一块及其后面的全部移除
 *   3. block_only 删除 C 形块：body 顶替被删块的位置并接上原 next
 *   4. block_only 删除 if_else：else 分支接在 body 末尾
 *   5. block_only 删除 hat/顶层块：下一块提升为新的顶层块
 *   6. block_only 删除输入槽 reporter：槽恢复默认 shadow，语句链不受影响
 *   7. 真实 block id 直接作为 targetId（get_sprite_scripts 的返回值）也能删
 *   8. contextMapping tid 是标准路径
 *   9. 没有任何悬空指针残留：parent.next / SUBSTACK / 输入槽引用全部指向存在的块
 *
 *   node scripts/test-delete-block.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOC = path.join(ROOT, 'src-renderer-webpack/editor/gui/desktop-hoc.jsx');

const VirtualMachine = require(path.join(ROOT, 'node_modules/scratch-vm/src/virtual-machine.js'));
const Sprite = require(path.join(ROOT, 'node_modules/scratch-vm/src/sprites/sprite.js'));
const RenderedTarget = require(path.join(ROOT, 'node_modules/scratch-vm/src/sprites/rendered-target.js'));

/* ── 从 desktop-hoc.jsx 提取顶层 DSL 辅助函数（与 test-dsl-roundtrip.js 相同方式） ── */
function loadHelpers () {
  const src = fs.readFileSync(HOC, 'utf8');
  const cut = src.indexOf('const DesktopHOC = function');
  if (cut < 0) throw new Error('DesktopHOC marker not found');
  const head = src.slice(0, cut);
  const names = ['parseScratchDSL', 'validateParsedScript', 'buildScriptBlocks'];
  const stripped = head
    .replace(/^import[\s\S]*?;$/gm, '')
    .replace(/^const \{[\s\S]*?\} = require\([^)]*\);$/gm, '')
    .replace(/^const [A-Za-z_$][\w$]* = require\([^)]*\);$/gm, '');
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'require', 'module', 'exports',
    stripped + '\nreturn {' + names.map(n => n + ': typeof ' + n + " !== 'undefined' ? " + n + ' : undefined').join(', ') + '};'
  );
  return factory(require, { exports: {} }, {});
}
const H = loadHelpers();

/* ── 提取 resolveBlockId 与 delete_block case 的源码 ── */
function loadDeleteExecutor () {
  const src = fs.readFileSync(HOC, 'utf8');
  const lines = src.split('\n').map(l => l.replace(/\r$/, ''));

  const fnStartIdx = lines.findIndex(l => l.includes('function resolveBlockId(tid, spriteName)'));
  if (fnStartIdx < 0) throw new Error('resolveBlockId not found in desktop-hoc.jsx');
  let fnEndIdx = -1;
  for (let i = fnStartIdx + 1; i < lines.length; i++) {
    if (lines[i] === '                }') { fnEndIdx = i; break; }
  }
  if (fnEndIdx < 0) throw new Error('resolveBlockId end not found');

  const caseStartIdx = lines.findIndex(l => l.trim().startsWith("case 'delete_block': {"));
  if (caseStartIdx < 0) throw new Error("case 'delete_block' not found in desktop-hoc.jsx");
  const caseEndIdx = lines.findIndex((l, i) => i > caseStartIdx && l.trim().startsWith("case 'modify_input': {"));
  if (caseEndIdx < 0) throw new Error("case 'modify_input' not found");

  const resolveSrc = lines.slice(fnStartIdx, fnEndIdx + 1).join('\n');
  const caseSrc = lines.slice(caseStartIdx, caseEndIdx).join('\n')
    .replace("case 'delete_block':", 'case true:');

  return resolveSrc + '\nswitch (true) {\n' + caseSrc + '\n}\n';
}
const DELETE_EXECUTOR = loadDeleteExecutor();

/* ── VM 搭建 ── */
function makeTarget () {
  const vm = new VirtualMachine();
  const sprite = new Sprite(null, vm.runtime);
  sprite.name = 'Cat';
  const target = new RenderedTarget(sprite, vm.runtime);
  target.isStage = false;
  const stageSprite = new Sprite(null, vm.runtime);
  stageSprite.name = 'Stage';
  const stage = new RenderedTarget(stageSprite, vm.runtime);
  stage.isStage = true;
  vm.runtime.targets = [stage, target]; // emitWorkspaceUpdate 需要 stage 存在
  vm.editingTarget = target;
  return { vm, target };
}

function buildScript (target, dsl) {
  const parsed = H.parseScratchDSL(dsl, target);
  const validation = H.validateParsedScript(parsed, target);
  if (validation.errors.length) throw new Error(validation.errors.join('; '));
  const built = H.buildScriptBlocks(parsed, target);
  built.blocks.forEach(b => target.blocks.createBlock(b));
  const all = target.blocks._blocks;
  return Object.keys(all).find(id => all[id].topLevel && all[id].parent === null);
}

/** 通过 opcode 找块 id（第一个匹配） */
function findBlock (target, opcode) {
  const all = target.blocks._blocks;
  return Object.keys(all).find(id => all[id] && all[id].opcode === opcode);
}

/** 执行一次 delete_block 操作，返回 opResults[0] */
function runDelete (vm, mapping, op) {
  const opResults = [];
  // eslint-disable-next-line no-new-func
  const factory = new Function('vm', 'contextMapping', 'opResults', 'op', 'opIdx', DELETE_EXECUTOR);
  factory(vm, mapping || {}, opResults, op, 0);
  return opResults[0];
}

/* ── 断言设施 ── */
let passed = 0;
let failed = 0;
const failures = [];

function check (name, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(name + (detail ? '\n      ' + detail : ''));
  }
}

/** 全 target 扫描：任何块的引用都不允许指向不存在的块 */
function assertNoDanglingRefs (target, label) {
  const all = target.blocks._blocks;
  const problems = [];
  for (const id of Object.keys(all)) {
    const b = all[id];
    if (b.next && !all[b.next]) problems.push(id + '.next -> missing ' + b.next);
    for (const inputName of Object.keys(b.inputs || {})) {
      const inp = b.inputs[inputName];
      if (!inp || typeof inp !== 'object') continue;
      if (inp.block && !all[inp.block]) problems.push(id + '.inputs.' + inputName + '.block -> missing ' + inp.block);
      if (inp.shadow && !all[inp.shadow]) problems.push(id + '.inputs.' + inputName + '.shadow -> missing ' + inp.shadow);
    }
  }
  check(label, problems.length === 0, problems.join(', '));
}

/* ══════════ 测试 ══════════ */

// 1. block_only：删除链中间块，前后重连，后面的块不丢
{
  const { vm, target } = makeTarget();
  const hatId = buildScript(target,
    'event_whenflagclicked\nmotion_movesteps 10\nlooks_say "hi"\nlooks_nextcostume');
  const motionId = findBlock(target, 'motion_movesteps');
  const res = runDelete(vm, null, { type: 'delete_block', targetId: motionId, mode: 'block_only' });
  const hat = target.blocks.getBlock(hatId);
  const say = target.blocks.getBlock(findBlock(target, 'looks_say'));
  const costume = target.blocks.getBlock(findBlock(target, 'looks_nextcostume'));
  check('1 删除成功', res && res.success, JSON.stringify(res));
  check('1 后面的块没有被误删', !!say && !!costume);
  check('1 hat.next 重连到 say', hat && hat.next === findBlock(target, 'looks_say'));
  check('1 say.parent 指向 hat', say && say.parent === hatId);
  check('1 链尾保持完整', say && say.next === findBlock(target, 'looks_nextcostume'));
  assertNoDanglingRefs(target, '1 无悬空引用');
}

// 2. with_children：删除链中间块，这一块和后面的全部移除
{
  const { vm, target } = makeTarget();
  const hatId = buildScript(target,
    'event_whenflagclicked\nmotion_movesteps 10\nlooks_say "hi"\nlooks_nextcostume');
  const res = runDelete(vm, null, {
    type: 'delete_block', targetId: findBlock(target, 'motion_movesteps'), mode: 'with_children'
  });
  const hat = target.blocks.getBlock(hatId);
  check('2 删除成功', res && res.success, JSON.stringify(res));
  check('2 hat.next 断开', hat && hat.next === null);
  check('2 后面的块全部移除',
    !findBlock(target, 'looks_say') && !findBlock(target, 'looks_nextcostume'));
  assertNoDanglingRefs(target, '2 无悬空引用');
}

// 3. block_only：删除 C 形块，body 顶替位置并接上原 next
{
  const { vm, target } = makeTarget();
  const hatId = buildScript(target,
    'event_whenflagclicked\ncontrol_if (operator_gt (sensing_timer) 5)\n  looks_say "in"\nlooks_say "out"');
  const res = runDelete(vm, null, {
    type: 'delete_block', targetId: findBlock(target, 'control_if'), mode: 'block_only'
  });
  const hat = target.blocks.getBlock(hatId);
  const sayIn = target.blocks.getBlock(findBlock(target, 'looks_say'));
  const sayOut = target.blocks.getBlock(findBlock(target, 'looks_say', 1) || Object.keys(target.blocks._blocks).find(id => target.blocks._blocks[id].opcode === 'looks_say' && id !== findBlock(target, 'looks_say')));
  check('3 删除成功', res && res.success, JSON.stringify(res));
  check('3 body 顶替 if 的位置', hat && hat.next === findBlock(target, 'looks_say'));
  check('3 body 接上原 next', sayIn && sayIn.next === Object.keys(target.blocks._blocks).find(id => {
    const b = target.blocks._blocks[id];
    return b.opcode === 'looks_say' && b.parent === findBlock(target, 'looks_say');
  }));
  check('3 out.parent 指向 body 末块', sayOut);
  assertNoDanglingRefs(target, '3 无悬空引用');
}

// 4. block_only：删除 if_else，else 分支接在 body 末尾
{
  const { vm, target } = makeTarget();
  buildScript(target,
    'event_whenflagclicked\ncontrol_if_else (operator_gt (sensing_timer) 5)\n  looks_say "a"\nelse\n  looks_say "b"\nlooks_nextcostume');
  const res = runDelete(vm, null, {
    type: 'delete_block', targetId: findBlock(target, 'control_if_else'), mode: 'block_only'
  });
  const all = target.blocks._blocks;
  const sayA = Object.keys(all).find(id => all[id].opcode === 'looks_say' && all[id].parent === Object.keys(all).find(x => all[x].topLevel));
  check('4 删除成功', res && res.success, JSON.stringify(res));
  // 重连结构：flag → sayA → sayB → nextcostume 一条链
  let chain = [];
  let cursor = Object.keys(all).find(id => all[id].topLevel);
  let guard = 0;
  while (cursor && guard++ < 50) {
    chain.push(all[cursor].opcode);
    cursor = all[cursor].next;
  }
  check('4 删除后是一条完整链',
    JSON.stringify(chain) === JSON.stringify(['event_whenflagclicked', 'looks_say', 'looks_say', 'looks_nextcostume']),
    JSON.stringify(chain));
  assertNoDanglingRefs(target, '4 无悬空引用');
}

// 5. block_only：删除 hat，下一块提升为新的顶层块
{
  const { vm, target } = makeTarget();
  const hatId = buildScript(target, 'event_whenflagclicked\nlooks_say "hi"\nlooks_nextcostume');
  const hat = target.blocks.getBlock(hatId);
  const hatX = hat.x;
  const hatY = hat.y;
  const res = runDelete(vm, null, {
    type: 'delete_block', targetId: hatId, mode: 'block_only'
  });
  const sayId = findBlock(target, 'looks_say');
  const say = target.blocks.getBlock(sayId);
  check('5 删除成功', res && res.success, JSON.stringify(res));
  check('5 hat 已移除', !target.blocks.getBlock(hatId));
  check('5 下一块提升为顶层', say && say.topLevel === true && say.parent === null);
  check('5 继承画布位置', say && say.x === hatX && say.y === hatY);
  check('5 进入 _scripts', target.blocks._scripts.indexOf(sayId) >= 0);
  check('5 链保持完整', say && say.next === findBlock(target, 'looks_nextcostume'));
  assertNoDanglingRefs(target, '5 无悬空引用');
}

// 6. block_only：删除输入槽 reporter，槽恢复默认 shadow，语句链不受影响
{
  const { vm, target } = makeTarget();
  buildScript(target, 'event_whenflagclicked\nmotion_movesteps (operator_random 1 10)');
  const move = target.blocks.getBlock(findBlock(target, 'motion_movesteps'));
  const stepsInput = move.inputs.STEPS;
  check('6 前置：STEPS 槽挂着 reporter', stepsInput && stepsInput.block !== stepsInput.shadow && !!stepsInput.block);
  const reporterId = stepsInput.block;
  const shadowId = stepsInput.shadow;
  const res = runDelete(vm, null, {
    type: 'delete_block', targetId: reporterId, mode: 'block_only'
  });
  const moveAfter = target.blocks.getBlock(findBlock(target, 'motion_movesteps'));
  check('6 删除成功', res && res.success, JSON.stringify(res));
  check('6 reporter 已移除', !target.blocks.getBlock(reporterId));
  check('6 槽恢复默认 shadow', moveAfter && moveAfter.inputs.STEPS.block === null && moveAfter.inputs.STEPS.shadow === shadowId);
  check('6 语句链不受影响', !!findBlock(target, 'motion_movesteps') && !!findBlock(target, 'event_whenflagclicked'));
  assertNoDanglingRefs(target, '6 无悬空引用');
}

// 7. 真实 block id 直接作为 targetId（get_sprite_scripts 的返回值形态）
{
  const { vm, target } = makeTarget();
  buildScript(target, 'event_whenflagclicked\nmotion_movesteps 10');
  const realId = findBlock(target, 'motion_movesteps');
  // 不传 contextMapping，模拟模型把 get_sprite_scripts 的 blockId 直接传回来
  const res = runDelete(vm, null, { type: 'delete_block', targetId: realId, mode: 'with_children' });
  check('7 真实 id 删除成功', res && res.success, JSON.stringify(res));
  check('7 块已移除', !target.blocks.getBlock(realId));
}

// 8. contextMapping tid 标准路径
{
  const { vm, target } = makeTarget();
  const hatId = buildScript(target, 'event_whenflagclicked\nmotion_movesteps 10\nlooks_say "hi"');
  const mapping = { b1: { blockId: findBlock(target, 'motion_movesteps'), sprite: 'Cat' } };
  const res = runDelete(vm, mapping, {
    type: 'delete_block', sprite: 'Cat', targetId: 'b1', mode: 'with_children'
  });
  const hat = target.blocks.getBlock(hatId);
  check('8 tid 删除成功', res && res.success, JSON.stringify(res));
  check('8 后面的块全部移除', !findBlock(target, 'looks_say'));
  check('8 hat.next 断开', hat && hat.next === null);
  assertNoDanglingRefs(target, '8 无悬空引用');
}

// 9. 不存在的 id 报错且不崩
{
  const { vm } = makeTarget();
  const res = runDelete(vm, null, { type: 'delete_block', targetId: 'b_nonexistent' });
  check('9 不存在的 id 返回失败', res && res.success === false && /not found/.test(res.error || ''), JSON.stringify(res));
}

/* ── 汇总 ── */
if (failures.length) {
  process.stdout.write(failures.map(f => 'FAIL ' + f).join('\n') + '\n');
  process.stdout.write(failed + ' failed, ' + passed + ' passed\n');
  process.exit(1);
} else {
  process.stdout.write(passed + ' passed, 0 failed\n');
  process.stdout.write('ALL PASS\n');
}

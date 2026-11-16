/**
 * 「仅撤销 AI 修改」的回归测试。
 *
 * 直接加载编辑器里真实的 ai-undo-journal.js（ESM 源码转成 CJS 后 require），
 * 用假的 VM 驱动，验证三路合并的语义：
 *   - AI 改过、用户没碰过 → 撤销时回退到改动前
 *   - AI 改过、用户后来自己改过 → 保留用户版本，并计为冲突
 *   - 同一处被 AI 连改多次 → 一路退回最初值
 *   - AI 新增角色 → 撤销时删掉；AI 删除角色 → 撤销时连脚本一起还原
 *   - AI 往已有脚本里插积木 → 撤销后脚本恢复原样，指针不断
 *   - 前后状态一致（只读工具）→ 不记账
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const MODULE_PATH = path.join(ROOT, 'src-renderer-webpack/editor/gui/ai-undo-journal.js');

// ── 把 ESM 源码转成能 require 的 CJS 副本 ────────────────────────────────
const source = fs.readFileSync(MODULE_PATH, 'utf8');
if (source.indexOf('export {') < 0) throw new Error('ai-undo-journal.js: export block not found');
const cjsSource = source.replace(/export \{[\s\S]*?\};/, '') +
  '\nmodule.exports = {captureProjectState, recordAIChange, getAIChangeStatus, dropAIChanges, undoAIChanges};\n';
const tmpPath = path.join(os.tmpdir(), 'ai-undo-journal-test-' + process.pid + '.cjs');
fs.writeFileSync(tmpPath, cjsSource);

let journal;
try {
  journal = require(tmpPath);
} catch (error) {
  console.error('failed to load ai-undo-journal.js:', error);
  process.exit(1);
}

let failures = 0;
function check (label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log('FAIL ' + label);
    console.log('  actual  : ' + JSON.stringify(actual));
    console.log('  expected: ' + JSON.stringify(expected));
  } else {
    console.log('ok   ' + label);
  }
}

const clone = value => JSON.parse(JSON.stringify(value));

/** 假 VM：只实现撤销用得到的部分 */
const makeVm = state => {
  const vm = {
    state,
    editingTarget: null,
    toJSON () { return JSON.stringify(vm.state); },
    stopAll () {},
    loadProject (input) {
      vm.state = typeof input === 'string' ? JSON.parse(input) : input;
      return Promise.resolve();
    },
    setEditingTarget () {},
    emitWorkspaceUpdate () {},
    emitTargetsUpdate () {},
    runtime: {
      getTargetById: id => (vm.state.targets || []).find(target => target.id === id) || null,
      emitProjectChanged () {}
    }
  };
  return vm;
};

const baseProject = () => ({
  targets: [
    {
      id: 'stage-id',
      isStage: true,
      name: 'Stage',
      variables: {score: ['score', 0]},
      lists: {items: ['items', []]},
      broadcasts: {},
      blocks: {},
      comments: {},
      currentCostume: 0,
      costumes: [],
      sounds: [],
      volume: 100,
      layerOrder: 0
    },
    {
      id: 'cat-id',
      isStage: false,
      name: 'Cat',
      variables: {},
      lists: {},
      broadcasts: {},
      blocks: {
        hat1: {opcode: 'event_whenflagclicked', next: 'move1', parent: null, inputs: {}, fields: {}, topLevel: true, shadow: false, x: 0, y: 0},
        move1: {opcode: 'motion_movesteps', next: null, parent: 'hat1', inputs: {STEPS: [1, [4, '10']]}, fields: {}, topLevel: false, shadow: false}
      },
      comments: {},
      currentCostume: 0,
      costumes: [],
      sounds: [],
      volume: 100,
      layerOrder: 1,
      visible: true,
      x: 0,
      y: 0,
      size: 100,
      direction: 90,
      draggable: false,
      rotationStyle: 'all around'
    }
  ],
  monitors: [],
  extensions: [],
  meta: {semver: '3.0.0'}
});

/** 让 vm 处于 newState，并抓一份快照（模拟工具执行前/后各抓一次） */
const moveTo = (vm, newState) => {
  vm.state = newState;
  return journal.captureProjectState(vm);
};

async function run () {
  /* 1. 混合改动：AI 改变量/加脚本/挪位置，用户另加变量和脚本 → 只退 AI 的 */
  {
    const vm = makeVm(baseProject());
    const before = journal.captureProjectState(vm);

    const aiState = clone(vm.state);
    aiState.targets[0].variables.score[1] = 10;
    aiState.targets[1].blocks.say1 = {
      opcode: 'looks_say', next: null, parent: null, topLevel: true, shadow: false,
      inputs: {MESSAGE: [1, [10, 'hi']]}, fields: {}, x: 0, y: 200
    };
    aiState.targets[1].x = 40;
    journal.recordAIChange('s1', 'executeOperations', before, moveTo(vm, aiState));
    check('1 记账单元数', journal.getAIChangeStatus('s1').count, 3);

    // 用户手动改动：不碰 AI 改过的东西
    const userState = clone(vm.state);
    userState.targets[0].variables.myVar = ['myVar', 1];
    userState.targets[1].blocks.flag2 = {
      opcode: 'event_whenflagclicked', next: null, parent: null, topLevel: true, shadow: false,
      inputs: {}, fields: {}, x: 0, y: 400
    };
    vm.state = userState;

    const result = await journal.undoAIChanges(vm, 's1');
    check('1 成功', result.success, true);
    check('1 撤销处数', result.data.reverted, 3);
    check('1 冲突处数', result.data.conflicts, 0);
    check('1 变量回退', vm.state.targets[0].variables.score[1], 0);
    check('1 AI 脚本移除', vm.state.targets[1].blocks.say1, undefined);
    check('1 位置回退', vm.state.targets[1].x, 0);
    check('1 用户变量保留', vm.state.targets[0].variables.myVar, ['myVar', 1]);
    check('1 用户脚本保留', !!vm.state.targets[1].blocks.flag2, true);
    check('1 原有脚本完好', !!vm.state.targets[1].blocks.move1, true);
    check('1 日志清空', journal.getAIChangeStatus('s1').count, 0);
  }

  /* 2. 冲突：AI 改过的变量被用户改成别的值 → 保留用户的 */
  {
    const vm = makeVm(baseProject());
    const before = journal.captureProjectState(vm);
    const aiState = clone(vm.state);
    aiState.targets[0].variables.score[1] = 5;
    journal.recordAIChange('s2', 'setVariable', before, moveTo(vm, aiState));

    const userState = clone(vm.state);
    userState.targets[0].variables.score[1] = 99;
    vm.state = userState;

    const result = await journal.undoAIChanges(vm, 's2');
    check('2 撤销处数', result.data.reverted, 0);
    check('2 冲突处数', result.data.conflicts, 1);
    check('2 用户值保留', vm.state.targets[0].variables.score[1], 99);
  }

  /* 3. 同一处被 AI 连改两次 → 一路退回最初值 */
  {
    const vm = makeVm(baseProject());
    for (const value of [5, 7]) {
      const before = journal.captureProjectState(vm);
      const next = clone(vm.state);
      next.targets[0].variables.score[1] = value;
      journal.recordAIChange('s3', 'setVariable', before, moveTo(vm, next));
    }
    check('3 记账处数（去重）', journal.getAIChangeStatus('s3').count, 1);
    const result = await journal.undoAIChanges(vm, 's3');
    check('3 撤销处数', result.data.reverted, 1);
    check('3 回到最初值', vm.state.targets[0].variables.score[1], 0);
  }

  /* 4a. AI 新增角色、用户没碰 → 撤销时整个删掉 */
  {
    const vm = makeVm(baseProject());
    const before = journal.captureProjectState(vm);
    const aiState = clone(vm.state);
    aiState.targets.push(Object.assign(clone(aiState.targets[1]), {id: 'sprite-new', name: 'Dog'}));
    journal.recordAIChange('s4', 'addSprite', before, moveTo(vm, aiState));

    const result = await journal.undoAIChanges(vm, 's4');
    check('4a 撤销处数', result.data.reverted, 1);
    check('4a 角色被移除', vm.state.targets.length, 2);
    check('4a 原有角色完好', vm.state.targets[1].name, 'Cat');
  }

  /* 4b. AI 新增角色、用户改过它 → 保留并报冲突 */
  {
    const vm = makeVm(baseProject());
    const before = journal.captureProjectState(vm);
    const aiState = clone(vm.state);
    aiState.targets.push(Object.assign(clone(aiState.targets[1]), {id: 'sprite-new', name: 'Dog'}));
    journal.recordAIChange('s5', 'addSprite', before, moveTo(vm, aiState));

    const userState = clone(vm.state);
    userState.targets[2].name = 'Doggo';
    vm.state = userState;

    const result = await journal.undoAIChanges(vm, 's5');
    check('4b 冲突处数', result.data.conflicts, 1);
    check('4b 角色保留', vm.state.targets.length, 3);
    check('4b 用户改名保留', vm.state.targets[2].name, 'Doggo');
  }

  /* 5. AI 删角色 → 撤销时角色连脚本一起回来 */
  {
    const vm = makeVm(baseProject());
    const before = journal.captureProjectState(vm);
    const aiState = clone(vm.state);
    aiState.targets = aiState.targets.filter(target => target.id !== 'cat-id');
    journal.recordAIChange('s6', 'deleteSprite', before, moveTo(vm, aiState));

    const result = await journal.undoAIChanges(vm, 's6');
    check('5 撤销处数', result.data.reverted, 1);
    check('5 角色回来', vm.state.targets.length, 2);
    check('5 脚本回来', !!vm.state.targets[1].blocks.move1, true);
  }

  /* 6. 往已有脚本里插积木 → 撤销后脚本恢复原样 */
  {
    const vm = makeVm(baseProject());
    const before = journal.captureProjectState(vm);
    const aiState = clone(vm.state);
    const blocks = aiState.targets[1].blocks;
    blocks.move1.next = 'turn1';
    blocks.turn1 = {opcode: 'motion_turnright', next: null, parent: 'move1', inputs: {}, fields: {}, topLevel: false, shadow: false};
    journal.recordAIChange('s7', 'executeOperations', before, moveTo(vm, aiState));

    const result = await journal.undoAIChanges(vm, 's7');
    check('6 撤销处数', result.data.reverted, 1);
    check('6 插入的积木消失', vm.state.targets[1].blocks.turn1, undefined);
    check('6 next 指针复原', vm.state.targets[1].blocks.move1.next, null);
  }

  /* 7. 用户又改了 AI 改过的脚本 → 保留用户版本，报冲突 */
  {
    const vm = makeVm(baseProject());
    const before = journal.captureProjectState(vm);
    const aiState = clone(vm.state);
    aiState.targets[1].blocks.move1.next = 'turn9';
    aiState.targets[1].blocks.turn9 = {opcode: 'motion_turnright', next: null, parent: 'move1', inputs: {}, fields: {}, topLevel: false, shadow: false};
    journal.recordAIChange('s8', 'executeOperations', before, moveTo(vm, aiState));

    const userState = clone(vm.state);
    userState.targets[1].blocks.turn9.next = 'say9';
    userState.targets[1].blocks.say9 = {opcode: 'looks_say', next: null, parent: 'turn9', inputs: {}, fields: {}, topLevel: true, shadow: false};
    vm.state = userState;

    const result = await journal.undoAIChanges(vm, 's8');
    check('7 冲突处数', result.data.conflicts, 1);
    check('7 撤销处数', result.data.reverted, 0);
    check('7 用户积木保留', !!vm.state.targets[1].blocks.say9, true);
  }

  /* 8. 只读工具：前后一致就不记账 */
  {
    const vm = makeVm(baseProject());
    const before = journal.captureProjectState(vm);
    journal.recordAIChange('s9', 'getAllSprites', before, journal.captureProjectState(vm));
    check('8 不记账', journal.getAIChangeStatus('s9').count, 0);
  }

  /* 9. 会话隔离：撤销只影响自己的会话日志 */
  {
    const vm = makeVm(baseProject());
    const before = journal.captureProjectState(vm);
    const aiState = clone(vm.state);
    aiState.targets[0].variables.score[1] = 3;
    journal.recordAIChange('s10', 'setVariable', before, moveTo(vm, aiState));
    check('9 s10 有记录', journal.getAIChangeStatus('s10').count, 1);
    check('9 s11 无记录', journal.getAIChangeStatus('s11').count, 0);
    check('9 删除日志', journal.dropAIChanges('s10'), true);
    check('9 删除后为空', journal.getAIChangeStatus('s10').count, 0);
  }

  console.log(failures ? '\nFAILURES: ' + failures : '\nALL PASS');
  return failures;
}

run().then(failures => {
  try { fs.unlinkSync(tmpPath); } catch (error) {}
  process.exit(failures ? 1 : 0);
}).catch(error => {
  console.error(error);
  try { fs.unlinkSync(tmpPath); } catch (e) {}
  process.exit(1);
});

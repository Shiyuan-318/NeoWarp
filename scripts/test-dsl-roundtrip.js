/**
 * DSL round-trip and insertion tests.
 *
 * Loads the real helper functions out of desktop-hoc.jsx (they are top-level, so they can be
 * evaluated in isolation) and drives them against scratch-vm's actual Blocks container. This
 * catches the failure mode that motivated the work: a script that "applies successfully" but
 * lands values in the wrong slots, which only shows up when you read the blocks back.
 *
 *   node scripts/test-dsl-roundtrip.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOC = path.join(ROOT, 'src-renderer-webpack/editor/gui/desktop-hoc.jsx');

const VirtualMachine = require(path.join(ROOT, 'node_modules/scratch-vm/src/virtual-machine.js'));
const Sprite = require(path.join(ROOT, 'node_modules/scratch-vm/src/sprites/sprite.js'));
const RenderedTarget = require(path.join(ROOT, 'node_modules/scratch-vm/src/sprites/rendered-target.js'));

/** Pull the standalone helper functions (everything before the React component) out of the JSX. */
function loadHelpers () {
  const src = fs.readFileSync(HOC, 'utf8');
  const cut = src.indexOf('const DesktopHOC = function');
  if (cut < 0) throw new Error('DesktopHOC marker not found');
  const head = src.slice(0, cut);

  const names = [
    'OPCODE_SCHEMA', 'SHADOW_VALUE_FIELD', 'tokenizeArgs', 'argToInputValue',
    'mapArgsToDescriptor', 'parseDslLine', 'convertNode', 'resolveVariableField',
    'resolveBroadcastField', 'schemaArgFor', 'toHexColor', 'createInputShadow',
    'buildBlockStructure', 'buildSubstackChain', 'buildScriptBlocks',
    'spliceBlocksIntoScript', 'validateParsedScript', 'formatValidationError',
    'serializeBlockToDsl', 'convertBlockObjToDsl', 'parseScratchDSL'
  ];

  // The head contains imports and React-only code; keep just what we need by evaluating the
  // whole thing with a stub module system and returning the named helpers.
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
  vm.runtime.targets = [stage, target];
  return { vm, target };
}

/** Apply DSL, read it back, and compare token-for-token. */
function roundTrip (dsl) {
  const { target } = makeTarget();
  const parsed = H.parseScratchDSL(dsl, target);
  const validation = H.validateParsedScript(parsed, target);
  if (validation.errors.length) {
    return { error: validation.errors.join('; ') };
  }
  const built = H.buildScriptBlocks(parsed, target);
  built.blocks.forEach(b => target.blocks.createBlock(b));

  const all = target.blocks._blocks;
  const topId = Object.keys(all).find(id => all[id].topLevel && all[id].parent === null);
  const lines = [];
  const emit = (blk, ind) => {
    lines.push('  '.repeat(ind) + H.serializeBlockToDsl(blk, all, 0));
    if (blk.inputs && blk.inputs.SUBSTACK && blk.inputs.SUBSTACK.block) {
      let sub = all[blk.inputs.SUBSTACK.block];
      while (sub) { emit(sub, ind + 1); sub = sub.next ? all[sub.next] : null; }
    }
    if (blk.inputs && blk.inputs.SUBSTACK2 && blk.inputs.SUBSTACK2.block) {
      lines.push('  '.repeat(ind) + 'else');
      let sub2 = all[blk.inputs.SUBSTACK2.block];
      while (sub2) { emit(sub2, ind + 1); sub2 = sub2.next ? all[sub2.next] : null; }
    }
    if (blk.next && ind === 0) emit(all[blk.next], 0);
  };
  emit(all[topId], 0);
  return { dsl: lines.join('\n'), target, blocks: all, warnings: validation.warnings };
}

console.log('--- round trip ---');
[
  ['simple stack',
    'event_whenflagclicked\nmotion_movesteps 10\nlooks_say "hello"'],
  ['nested C-blocks',
    'event_whenkeypressed "space"\ncontrol_repeat 10\n  motion_changeyby 6\n  control_wait 0.02'],
  ['if/else with reporters',
    'event_whenflagclicked\ncontrol_if_else (operator_gt (sensing_timer) 10)\n  looks_say "up"\nelse\n  looks_say "down"'],
  ['list ops (argument order regression)',
    'event_whenflagclicked\ndata_addtolist "apple" @fruit\ndata_insertatlist "pear" 2 @fruit\ndata_replaceitemoflist 1 @fruit "kiwi"\ndata_deleteoflist 3 @fruit'],
  ['variable ops',
    'event_whenflagclicked\ndata_setvariableto $score 0\ndata_changevariableby $score 5'],
  ['menus and dropdowns',
    'event_whenflagclicked\nmotion_goto "_random_"\nmotion_pointtowards "_mouse_"\nlooks_switchcostumeto "costume1"\ncontrol_stop "this script"'],
  ['layer order (FORWARD_BACKWARD regression)',
    'event_whenflagclicked\nlooks_goforwardbackwardlayers "backward" 3'],
  ['glide (arg order regression)',
    'event_whenflagclicked\nmotion_glideto 1.5 "_mouse_"'],
  ['colour input',
    'event_whenflagclicked\ncontrol_wait_until (sensing_touchingcolor "#ff0000")'],
  ['angle input',
    'event_whenflagclicked\nmotion_pointindirection 45'],
  ['broadcast',
    'event_whenbroadcastreceived "go"\nevent_broadcast "done"'],
  ['deep reporter nesting',
    'event_whenflagclicked\nmotion_movesteps (operator_multiply (operator_add 1 2) (operator_random 1 10))'],
  ['boolean operators',
    'event_whenflagclicked\ncontrol_if (operator_and (sensing_mousedown) (operator_not (sensing_keypressed "a")))\n  looks_say "both"']
].forEach(([name, dsl]) => {
  const out = roundTrip(dsl);
  if (out.error) {
    check(name, false, 'validation rejected: ' + out.error);
    return;
  }
  const norm = s => s.split('\n').map(l => l.replace(/\s+$/, '')).join('\n');
  check(name, norm(out.dsl) === norm(dsl),
    'input:\n' + dsl.split('\n').map(l => '        ' + l).join('\n') +
    '\n      output:\n' + out.dsl.split('\n').map(l => '        ' + l).join('\n'));
});

console.log('--- shadow types ---');
{
  const r = roundTrip('event_whenflagclicked\nmotion_pointindirection 45\nsensing_touchingcolor "#ff0000"\ncontrol_repeat 4\n  looks_say "x"');
  const opcodes = Object.keys(r.blocks).map(id => r.blocks[id].opcode);
  check('math_angle shadow used for DIRECTION', opcodes.indexOf('math_angle') >= 0, 'shadows: ' + opcodes.join(','));
  check('colour_picker shadow used for COLOR', opcodes.indexOf('colour_picker') >= 0, 'shadows: ' + opcodes.join(','));
  check('math_whole_number shadow used for TIMES', opcodes.indexOf('math_whole_number') >= 0, 'shadows: ' + opcodes.join(','));
}
{
  const r = roundTrip('event_whenflagclicked\nsound_play "meow"');
  const opcodes = Object.keys(r.blocks).map(id => r.blocks[id].opcode);
  check('sound menu shadow created', opcodes.indexOf('sound_sounds_menu') >= 0, 'shadows: ' + opcodes.join(','));
}
{
  const r = roundTrip('event_whenflagclicked\nevent_broadcast "go"');
  const ids = Object.keys(r.blocks);
  const menu = ids.map(id => r.blocks[id]).find(b => b.opcode === 'event_broadcast_menu');
  check('broadcast menu shadow created', !!menu);
  check('broadcast bound to a real message id',
    !!(menu && menu.fields.BROADCAST_OPTION && menu.fields.BROADCAST_OPTION.id),
    menu ? JSON.stringify(menu.fields.BROADCAST_OPTION) : 'no menu block');
}
{
  const r = roundTrip('event_whenflagclicked\ncontrol_if (sensing_mousedown)\n  looks_say "x"');
  const ifBlock = Object.keys(r.blocks).map(id => r.blocks[id]).find(b => b.opcode === 'control_if');
  const condition = ifBlock.inputs.CONDITION;
  check('boolean slot holds a reporter, not a shadow',
    condition && condition.block && condition.shadow === null,
    JSON.stringify(condition));
}
{
  const { target } = makeTarget();
  const parsed = H.parseScratchDSL('event_whenflagclicked\ncontrol_if\n  looks_say "x"', target);
  const built = H.buildScriptBlocks(parsed, target);
  built.blocks.forEach(b => target.blocks.createBlock(b));
  const ifBlock = built.blocks.find(b => b.opcode === 'control_if');
  check('empty boolean slot stays empty', !ifBlock.inputs.CONDITION, JSON.stringify(ifBlock.inputs));
}

console.log('--- validation ---');
[
  ['unknown opcode', 'event_whenflagclicked\nmotion_teleport 10', /unknown opcode/],
  ['nested hat block', 'event_whenflagclicked\ncontrol_repeat 2\n  event_whenflagclicked', /hat blocks can only be/],
  ['too many arguments', 'event_whenflagclicked\nmotion_movesteps 10 20 30', /too many arguments/],
  ['body under a non-C block', 'event_whenflagclicked\nlooks_say "x"\n  motion_movesteps 1', /no body slot/],
  ['else on a plain if', 'event_whenflagclicked\ncontrol_if (sensing_mousedown)\n  looks_say "a"\nelse\n  looks_say "b"', /no else branch/]
].forEach(([name, dsl, pattern]) => {
  const { target } = makeTarget();
  let parsed;
  try {
    parsed = H.parseScratchDSL(dsl, target);
  } catch (e) {
    check(name, pattern.test(e.message), 'threw: ' + e.message);
    return;
  }
  const v = H.validateParsedScript(parsed, target);
  check(name, v.errors.some(e => pattern.test(e)),
    'errors: ' + (v.errors.join(' | ') || '(none)'));
});
{
  const { target } = makeTarget();
  const parsed = H.parseScratchDSL('event_whenflagclicked\ncontrol_repeat 5', target);
  const v = H.validateParsedScript(parsed, target);
  check('empty C-block body warns (not an error)',
    v.errors.length === 0 && v.warnings.some(w => /empty body/.test(w)),
    'errors: ' + v.errors.join('|') + ' warnings: ' + v.warnings.join('|'));
}
{
  const { target } = makeTarget();
  const parsed = H.parseScratchDSL('event_whenflagclicked\ncontrol_wait "soon"', target);
  const v = H.validateParsedScript(parsed, target);
  check('text in a number slot warns',
    v.warnings.some(w => /expects a number/.test(w)),
    'warnings: ' + v.warnings.join('|'));
}

console.log('--- insertion ---');
function setupScript (dsl) {
  const { vm, target } = makeTarget();
  const parsed = H.parseScratchDSL(dsl, target);
  const built = H.buildScriptBlocks(parsed, target);
  built.blocks.forEach(b => target.blocks.createBlock(b));
  const all = target.blocks._blocks;
  const topId = Object.keys(all).find(id => all[id].topLevel && all[id].parent === null);
  return { vm, target, all, topId };
}
function readBack (target) {
  const all = target.blocks._blocks;
  const topIds = Object.keys(all).filter(id => all[id].topLevel && all[id].parent === null);
  return topIds.map(topId => {
    const lines = [];
    const emit = (blk, ind) => {
      lines.push('  '.repeat(ind) + H.serializeBlockToDsl(blk, all, 0));
      if (blk.inputs && blk.inputs.SUBSTACK && blk.inputs.SUBSTACK.block) {
        let sub = all[blk.inputs.SUBSTACK.block];
        while (sub) { emit(sub, ind + 1); sub = sub.next ? all[sub.next] : null; }
      }
      if (blk.inputs && blk.inputs.SUBSTACK2 && blk.inputs.SUBSTACK2.block) {
        lines.push('  '.repeat(ind) + 'else');
        let sub2 = all[blk.inputs.SUBSTACK2.block];
        while (sub2) { emit(sub2, ind + 1); sub2 = sub2.next ? all[sub2.next] : null; }
      }
      if (blk.next && ind === 0) emit(all[blk.next], 0);
    };
    emit(all[topId], 0);
    return lines.join('\n');
  });
}
function doInsert (env, anchorId, position, dsl, branch) {
  const parsed = H.parseScratchDSL(dsl, env.target);
  const body = { hat: null, blocks: parsed.blocks, warnings: parsed.warnings };
  const built = H.buildScriptBlocks(body, env.target, { topLevel: false });
  const first = built.blocks.filter(b => !b.shadow)[0];
  return H.spliceBlocksIntoScript(env.target, built.blocks, first.id, built.lastId,
    { position, blockId: anchorId, branch });
}
function findBlock (env, opcode) {
  return Object.keys(env.all).find(id => env.all[id].opcode === opcode);
}

{
  const env = setupScript('event_whenflagclicked\nmotion_movesteps 10\nlooks_say "end"');
  const anchor = findBlock(env, 'motion_movesteps');
  const res = doInsert(env, anchor, 'after', 'control_wait 1');
  check('insert after: ok', res.ok, res.error);
  const scripts = readBack(env.target);
  check('insert after: single script kept', scripts.length === 1, 'got ' + scripts.length + ' scripts');
  check('insert after: order correct',
    scripts[0] === 'event_whenflagclicked\nmotion_movesteps 10\ncontrol_wait 1\nlooks_say "end"',
    JSON.stringify(scripts[0]));
}
{
  const env = setupScript('event_whenflagclicked\nmotion_movesteps 10\nlooks_say "end"');
  const anchor = findBlock(env, 'looks_say');
  const res = doInsert(env, anchor, 'before', 'control_wait 2');
  check('insert before: ok', res.ok, res.error);
  const scripts = readBack(env.target);
  check('insert before: order correct',
    scripts.length === 1 &&
    scripts[0] === 'event_whenflagclicked\nmotion_movesteps 10\ncontrol_wait 2\nlooks_say "end"',
    JSON.stringify(scripts));
}
{
  const env = setupScript('event_whenflagclicked\nmotion_movesteps 10');
  const anchor = findBlock(env, 'event_whenflagclicked');
  const res = doInsert(env, anchor, 'before', 'control_wait 1');
  check('insert before a hat is refused', !res.ok && /hat block/.test(res.error || ''), res.error);
}
{
  const env = setupScript('event_whenflagclicked\ncontrol_repeat 3\n  motion_movesteps 5');
  const anchor = findBlock(env, 'control_repeat');
  const res = doInsert(env, anchor, 'body_start', 'looks_say "first"');
  check('body_start: ok', res.ok, res.error);
  const scripts = readBack(env.target);
  check('body_start: placed at top of body',
    scripts.length === 1 &&
    scripts[0] === 'event_whenflagclicked\ncontrol_repeat 3\n  looks_say "first"\n  motion_movesteps 5',
    JSON.stringify(scripts));
}
{
  const env = setupScript('event_whenflagclicked\ncontrol_repeat 3\n  motion_movesteps 5');
  const anchor = findBlock(env, 'control_repeat');
  const res = doInsert(env, anchor, 'body_end', 'looks_say "last"');
  check('body_end: ok', res.ok, res.error);
  const scripts = readBack(env.target);
  check('body_end: appended to body',
    scripts.length === 1 &&
    scripts[0] === 'event_whenflagclicked\ncontrol_repeat 3\n  motion_movesteps 5\n  looks_say "last"',
    JSON.stringify(scripts));
}
{
  const env = setupScript('event_whenflagclicked\ncontrol_forever');
  const anchor = findBlock(env, 'control_forever');
  const res = doInsert(env, anchor, 'body_end', 'motion_movesteps 1\nmotion_ifonedgebounce');
  check('body_end into empty body: ok', res.ok, res.error);
  const scripts = readBack(env.target);
  check('body_end into empty body: both blocks inside',
    scripts.length === 1 &&
    scripts[0] === 'event_whenflagclicked\ncontrol_forever\n  motion_movesteps 1\n  motion_ifonedgebounce',
    JSON.stringify(scripts));
}
{
  const env = setupScript('event_whenflagclicked\ncontrol_if_else (sensing_mousedown)\n  looks_say "a"\nelse\n  looks_say "b"');
  const anchor = findBlock(env, 'control_if_else');
  const res = doInsert(env, anchor, 'body_end', 'control_wait 1', 'else');
  check('else branch: ok', res.ok, res.error);
  const scripts = readBack(env.target);
  check('else branch: appended to else body',
    scripts.length === 1 &&
    scripts[0] === 'event_whenflagclicked\ncontrol_if_else (sensing_mousedown)\n  looks_say "a"\nelse\n  looks_say "b"\n  control_wait 1',
    JSON.stringify(scripts));
}
{
  const env = setupScript('event_whenflagclicked\nlooks_say "x"');
  const anchor = findBlock(env, 'looks_say');
  const res = doInsert(env, anchor, 'body_start', 'control_wait 1');
  check('body_start on a non-C block is refused',
    !res.ok && /no body slot/.test(res.error || ''), res.error);
}
{
  const env = setupScript('event_whenflagclicked\ncontrol_repeat 2\n  motion_movesteps 1');
  const anchor = findBlock(env, 'motion_movesteps');
  const res = doInsert(env, anchor, 'before', 'looks_say "inner"');
  check('insert before first block of a body: ok', res.ok, res.error);
  const scripts = readBack(env.target);
  check('insert before first block of a body: stays inside',
    scripts.length === 1 &&
    scripts[0] === 'event_whenflagclicked\ncontrol_repeat 2\n  looks_say "inner"\n  motion_movesteps 1',
    JSON.stringify(scripts));
}

console.log('--- JSON block object fallback ---');
{
  const obj = {
    opcode: 'event_whenflagclicked',
    next: { opcode: 'data_addtolist', inputs: { ITEM: 'apple' }, fields: { LIST: 'fruit' } }
  };
  const dsl = H.convertBlockObjToDsl(obj, 0).join('\n');
  check('object → DSL keeps schema order',
    dsl === 'event_whenflagclicked\ndata_addtolist "apple" @fruit',
    JSON.stringify(dsl));
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failures.length) {
  console.log('');
  failures.forEach(f => console.log('  FAIL: ' + f));
  process.exit(1);
}

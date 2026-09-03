/**
 * Generate the block-dictionary section of the AI system prompt from OPCODE_SCHEMA.
 *
 * The prompt used to carry a hand-maintained opcode list whose argument names and order
 * disagreed with the executor in ~20 places, so the model was being told the wrong
 * signature for blocks like data_addtolist and looks_goforwardbackwardlayers. Generating
 * this from the same source the executor validates against removes that class of failure.
 *
 * Prints the dictionary section; scripts/build-system-prompt.js embeds it into the prompt.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOC_FILE = path.join(ROOT, 'src-renderer-webpack/editor/gui/desktop-hoc.jsx');
const BLOCKS_DIR = path.join(ROOT, 'node_modules/scratch-blocks/blocks_vertical');

const START_MARK = '=== BLOCK DICTIONARY (generated from the editor schema — these signatures are exact) ===';

/** Read OPCODE_SCHEMA out of desktop-hoc.jsx without executing the whole module. */
function loadSchema () {
  const src = fs.readFileSync(HOC_FILE, 'utf8');
  const start = src.indexOf('const OPCODE_SCHEMA = {');
  const end = src.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error('OPCODE_SCHEMA not found');
  const literal = src.slice(src.indexOf('{', start), end + 2);
  // eslint-disable-next-line no-new-func
  return new Function('return ' + literal)();
}

/** Dropdown option values per opcode, so the prompt lists exactly the legal choices. */
function loadDropdownOptions () {
  const perOpcode = {};
  const blockRe = /Blockly\.Blocks\['([a-zA-Z0-9_]+)'\]\s*=\s*\{([\s\S]*?)\n\};/g;
  const dropRe = /["']type["']:\s*["']field_dropdown["'],\s*["']name["']:\s*["']([A-Z_0-9]+)["'],\s*["']options["']:\s*\[([\s\S]*?)\n\s*\]/g;
  const valueRe = /,\s*'((?:[^'\\]|\\.)*)'\s*\]/g;

  for (const f of fs.readdirSync(BLOCKS_DIR)) {
    if (!f.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(BLOCKS_DIR, f), 'utf8');
    let block;
    blockRe.lastIndex = 0;
    while ((block = blockRe.exec(src)) !== null) {
      const opcode = block[1];
      const body = block[2];
      let drop;
      dropRe.lastIndex = 0;
      while ((drop = dropRe.exec(body)) !== null) {
        const values = [];
        let v;
        valueRe.lastIndex = 0;
        while ((v = valueRe.exec(drop[2])) !== null) values.push(v[1].replace(/\\'/g, "'"));
        if (!values.length) continue;
        if (!perOpcode[opcode]) perOpcode[opcode] = {};
        perOpcode[opcode][drop[1]] = values;
      }
    }
  }

  // Menus whose contents depend on the project (costume/sound/sprite names) can't be
  // listed as fixed values; the special-value menus can.
  const OVERRIDES = {
    motion_goto: { TO: ['_mouse_', '_random_', '<sprite name>'] },
    motion_glideto: { TO: ['_mouse_', '_random_', '<sprite name>'] },
    motion_pointtowards: { TOWARDS: ['_mouse_', '_random_', '<sprite name>'] },
    control_create_clone_of: { CLONE_OPTION: ['_myself_', '<sprite name>'] },
    control_stop: { STOP_OPTION: ['all', 'this script', 'other scripts in sprite'] },
    sensing_touchingobject: { TOUCHINGOBJECTMENU: ['_mouse_', '_edge_', '<sprite name>'] },
    sensing_distanceto: { DISTANCETOMENU: ['_mouse_', '<sprite name>'] },
    sensing_of: { OBJECT: ['_stage_', '<sprite name>'] },
    looks_switchcostumeto: { COSTUME: ['<costume name>'] },
    looks_switchbackdropto: { BACKDROP: ['<backdrop name>', 'next backdrop', 'previous backdrop', 'random backdrop'] },
    looks_switchbackdroptoandwait: { BACKDROP: ['<backdrop name>'] },
    event_whenbackdropswitchesto: { BACKDROP: ['<backdrop name>'] },
    sound_play: { SOUND_MENU: ['<sound name>'] },
    sound_playuntildone: { SOUND_MENU: ['<sound name>'] },
    pen_changePenColorParamBy: { COLOR_PARAM: ['color', 'saturation', 'brightness', 'transparency'] },
    pen_setPenColorParamTo: { COLOR_PARAM: ['color', 'saturation', 'brightness', 'transparency'] },
    // sensing_keypressed's menu is generated at runtime from the same key list as
    // event_whenkeypressed, so borrow that opcode's options.
    sensing_keypressed: null
  };
  if (perOpcode.event_whenkeypressed && perOpcode.event_whenkeypressed.KEY_OPTION) {
    OVERRIDES.sensing_keypressed = { KEY_OPTION: perOpcode.event_whenkeypressed.KEY_OPTION };
  } else {
    delete OVERRIDES.sensing_keypressed;
  }
  Object.keys(OVERRIDES).forEach(op => {
    perOpcode[op] = Object.assign({}, perOpcode[op], OVERRIDES[op]);
  });
  return perOpcode;
}

const CATEGORIES = [
  ['Motion', /^motion_/],
  ['Looks', /^looks_/],
  ['Sound', /^sound_/],
  ['Events', /^event_/],
  ['Control', /^control_/],
  ['Sensing', /^sensing_/],
  ['Operators', /^operator_/],
  ['Variables & Lists', /^data_/],
  ['Pen (extension)', /^pen_/]
];

/** Human-readable token hint for one argument slot. */
function argHint (opcode, arg, dropdowns) {
  if (arg.bool) return arg.name + ':bool';
  const opts = (dropdowns[opcode] || {})[arg.name];
  if (arg.kind === 'field' || arg.kind === 'menu') {
    if (arg.name === 'VARIABLE') return '$var';
    if (arg.name === 'LIST') return '@list';
    if (arg.name === 'BROADCAST_OPTION' || arg.name === 'BROADCAST_INPUT') return '"message"';
    if (opts) return arg.name + ':' + opts.map(o => '"' + o + '"').join('|');
    return arg.name + ':"name"';
  }
  if (arg.shadow === 'colour_picker') return arg.name + ':"#rrggbb"';
  if (arg.shadow === 'text') return arg.name + ':text';
  if (arg.shadow) return arg.name + ':num';
  return arg.name;
}

function build () {
  const schema = loadSchema();
  const dropdowns = loadDropdownOptions();
  const opcodes = Object.keys(schema).sort();
  const lines = [];

  lines.push(START_MARK);
  lines.push('Each line is: opcode <arg1> <arg2> …  — write the arguments in exactly this order.');
  lines.push('$name = variable, @name = list, "text" = string, bare number = number, (opcode …) = nested reporter.');
  lines.push('[C] marks a C-block: put its body on the following lines, indented two more spaces.');
  lines.push('');

  const seen = new Set();
  for (const [label, pattern] of CATEGORIES) {
    const group = opcodes.filter(op => pattern.test(op));
    if (!group.length) continue;
    lines.push(label + ':');
    for (const op of group) {
      seen.add(op);
      const def = schema[op];
      const hints = def.args.map(a => argHint(op, a, dropdowns));
      let line = '  ' + op + (hints.length ? ' ' + hints.join(' ') : '');
      if (def.substack && def.substack2) line += '  [C + else]';
      else if (def.substack) line += '  [C]';
      lines.push(line);
    }
    lines.push('');
  }
  const rest = opcodes.filter(op => !seen.has(op));
  if (rest.length) {
    lines.push('Other:');
    rest.forEach(op => {
      const def = schema[op];
      const hints = def.args.map(a => argHint(op, a, dropdowns));
      lines.push('  ' + op + (hints.length ? ' ' + hints.join(' ') : ''));
    });
    lines.push('');
  }
  return lines.join('\n');
}

const section = build();
process.stdout.write(section);

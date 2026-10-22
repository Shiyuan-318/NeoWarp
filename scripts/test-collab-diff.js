/*
 * 一次性验证脚本：把 desktop-hoc.jsx 里的协作 diff 辅助函数逐字复制出来，
 * 用构造的场景验证归类逻辑（noop / props / replace / add / delete / stage
 * changes / fullLoad）。运行：node scripts/test-collab-diff.js
 */
/* eslint-disable no-console */

const COLLAB_SPRITE_RUNTIME_PROPS = [
  'x', 'y', 'size', 'direction', 'visible', 'draggable',
  'rotationStyle', 'currentCostume', 'volume'
];

const collabStableStringify = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(collabStableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${collabStableStringify(value[key])}`).join(',')}}`;
};

const collabNormalizeTarget = (targetJson, isStage) => {
  const normalized = JSON.parse(collabStableStringify(targetJson));
  const stripValues = record => {
    const copy = {};
    for (const id of Object.keys(record || {})) {
      const entry = record[id];
      copy[id] = Array.isArray(entry) ? entry.slice(0, 1).concat(entry.slice(2)) : entry;
    }
    return copy;
  };
  normalized.variables = stripValues(normalized.variables);
  normalized.lists = stripValues(normalized.lists);
  if (isStage) {
    for (const key of ['tempo', 'videoState', 'videoTransparency', 'textToSpeechLanguage', 'volume']) {
      delete normalized[key];
    }
  }
  return normalized;
};

const collabSpritesEqual = (localJson, remoteJson) =>
  collabStableStringify(collabNormalizeTarget(localJson, localJson.isStage)) ===
  collabStableStringify(collabNormalizeTarget(remoteJson, remoteJson.isStage));

const collabSpriteRuntimePropsOnly = (localJson, remoteJson) => {
  const stripProps = json => {
    const copy = collabNormalizeTarget(json, json.isStage);
    for (const prop of COLLAB_SPRITE_RUNTIME_PROPS) delete copy[prop];
    return copy;
  };
  if (collabStableStringify(stripProps(localJson)) !== collabStableStringify(stripProps(remoteJson))) {
    return false;
  }
  return COLLAB_SPRITE_RUNTIME_PROPS.some(prop =>
    JSON.stringify(localJson[prop]) !== JSON.stringify(remoteJson[prop]));
};

const collabNormalizeMonitors = monitors =>
  (monitors || []).map(monitor => {
    const copy = {...monitor};
    delete copy.value;
    return copy;
  });

const collabStageChanges = (localStageJson, remoteStageJson) => {
  const stripVariables = stageJson => {
    const copy = collabNormalizeTarget(stageJson, true);
    delete copy.variables;
    delete copy.lists;
    delete copy.broadcasts;
    return copy;
  };
  if (collabStableStringify(stripVariables(localStageJson)) !==
      collabStableStringify(stripVariables(remoteStageJson))) {
    return null;
  }
  const kinds = [
    ['variables', ''],
    ['lists', 'list'],
    ['broadcasts', 'broadcast_msg']
  ];
  const additions = [];
  const deletions = [];
  for (const [field, type] of kinds) {
    const localRecord = localStageJson[field] || {};
    const remoteRecord = remoteStageJson[field] || {};
    for (const id of Object.keys(remoteRecord)) {
      const entry = remoteRecord[id];
      if (Object.prototype.hasOwnProperty.call(localRecord, id)) {
        const localEntry = Array.isArray(localRecord[id])
          ? localRecord[id].slice(0, 1).concat(localRecord[id].slice(2))
          : localRecord[id];
        const remoteEntry = Array.isArray(entry) ? entry.slice(0, 1).concat(entry.slice(2)) : entry;
        if (JSON.stringify(localEntry) !== JSON.stringify(remoteEntry)) return null; // renamed
      } else {
        additions.push({
          id,
          field,
          name: Array.isArray(entry) ? entry[0] : entry,
          type,
          isCloud: Array.isArray(entry) && entry[2] === true
        });
      }
    }
    for (const id of Object.keys(localRecord)) {
      if (Object.prototype.hasOwnProperty.call(remoteRecord, id)) continue;
      const entry = localRecord[id];
      if (field === 'variables' && Array.isArray(entry) && entry[2] === true) {
        return null;
      }
      deletions.push({id, field});
    }
  }
  return {additions, deletions};
};

/* ===== test helpers ===== */

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`FAIL ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${label}`);
  }
};

const sprite = overrides => ({
  isStage: false,
  name: 'Sprite1',
  variables: {v1: ['hp', 100]},
  lists: {},
  broadcasts: {},
  blocks: {b1: {opcode: 'motion_movefront', fields: {}, inputs: {}, topLevel: true, x: 0, y: 0}},
  comments: {},
  currentCostume: 0,
  costumes: [{name: 'c1', md5ext: 'abc.png', dataFormat: 'png', rotationCenterX: 0, rotationCenterY: 0}],
  sounds: [],
  volume: 100,
  layerOrder: 1,
  visible: true,
  x: 0,
  y: 0,
  size: 100,
  direction: 90,
  draggable: false,
  rotationStyle: 'all around',
  ...overrides
});

const stage = overrides => ({
  isStage: true,
  name: 'Stage',
  variables: {},
  lists: {},
  broadcasts: {},
  blocks: {},
  comments: {},
  currentCostume: 0,
  costumes: [{name: 'backdrop1', md5ext: 'def.svg', dataFormat: 'svg', rotationCenterX: 0, rotationCenterY: 0}],
  sounds: [],
  volume: 100,
  layerOrder: 0,
  tempo: 60,
  videoTransparency: 50,
  videoState: 'on',
  textToSpeechLanguage: null,
  ...overrides
});

/* ===== sprite comparisons ===== */

check('identical sprites are equal', collabSpritesEqual(sprite(), sprite({x: 0})), true);
check('variable VALUE differences are not edits',
  collabSpritesEqual(sprite({variables: {v1: ['hp', 42]}}), sprite()), true);
check('variable structure (cloud flag) differences are edits',
  collabSpritesEqual(sprite({variables: {v1: ['hp', 42, true]}}), sprite()), false);
check('list value differences are not edits',
  collabSpritesEqual(sprite({lists: {l1: ['nums', [1, 2, 3]]}}), sprite({lists: {l1: ['nums', [9]]}})), true);

check('x/y-only change is runtime-props-only',
  collabSpriteRuntimePropsOnly(sprite(), sprite({x: 10, y: -20})), true);
check('direction+size-only change is runtime-props-only',
  collabSpriteRuntimePropsOnly(sprite(), sprite({direction: -90, size: 50, currentCostume: 0})), true);
check('costume count change is structural',
  collabSpriteRuntimePropsOnly(sprite(), sprite({
    costumes: [
      {name: 'c1', md5ext: 'abc.png', dataFormat: 'png', rotationCenterX: 0, rotationCenterY: 0},
      {name: 'c2', md5ext: 'ghi.png', dataFormat: 'png', rotationCenterX: 0, rotationCenterY: 0}
    ]
  })), false);
check('block addition is structural',
  collabSpriteRuntimePropsOnly(sprite(), sprite({
    blocks: {
      b1: {opcode: 'motion_movefront', fields: {}, inputs: {}, topLevel: true, x: 0, y: 0},
      b2: {opcode: 'sound_play', fields: {}, inputs: {}, topLevel: true, x: 30, y: 30}
    }
  })), false);
check('x/y change alongside block edit is NOT runtime-props-only (needs replace)',
  collabSpriteRuntimePropsOnly(sprite(), sprite({
    x: 5,
    blocks: {b1: {opcode: 'motion_movefront', fields: {}, inputs: {}, topLevel: true, x: 5, y: 5}}
  })), false);

/* ===== stage changes ===== */

check('stage broadcast addition detected',
  collabStageChanges(stage(), stage({broadcasts: {msg1: 'message1'}})),
  {additions: [{id: 'msg1', field: 'broadcasts', name: 'message1', type: 'broadcast_msg', isCloud: false}], deletions: []});

check('stage variable addition with cloud flag',
  collabStageChanges(stage(), stage({variables: {cv: ['☁ score', 0, true]}})),
  {additions: [{id: 'cv', field: 'variables', name: '☁ score', type: '', isCloud: true}], deletions: []});

check('stage variable deletion detected',
  collabStageChanges(stage({variables: {v1: ['old', 1]}}), stage()),
  {additions: [], deletions: [{id: 'v1', field: 'variables'}]});

check('stage variable rename falls back to full load',
  collabStageChanges(stage({variables: {v1: ['a', 1]}}), stage({variables: {v1: ['b', 1]}})), null);

check('stage cloud variable deletion falls back to full load',
  collabStageChanges(stage({variables: {cv: ['☁ score', 0, true]}}), stage()), null);

check('stage backdrop change falls back to full load',
  collabStageChanges(stage(), stage({
    currentCostume: 1,
    costumes: [
      {name: 'backdrop1', md5ext: 'def.svg', dataFormat: 'svg', rotationCenterX: 0, rotationCenterY: 0},
      {name: 'backdrop2', md5ext: 'xyz.svg', dataFormat: 'svg', rotationCenterX: 0, rotationCenterY: 0}
    ]
  })), null);

check('stage block change falls back to full load',
  collabStageChanges(stage(), stage({blocks: {b9: {opcode: 'event_whenflagclicked', topLevel: true, x: 0, y: 0, fields: {}, inputs: {}}}})), null);

check('runtime tempo/value churn on stage is not a change',
  collabStageChanges(stage({tempo: 999, variables: {v1: ['score', 777]}}), stage({variables: {v1: ['score', 0]}})),
  {additions: [], deletions: []});

/* ===== monitors ===== */

// Copied verbatim from desktop-hoc.jsx: see the comment near the helpers.
const collabMonitorRecordShape = record => {
  const copy = {...record};
  delete copy.value;
  return copy;
};

const collabMonitorChanges = (localMonitors, remoteMonitors) => {
  const localById = new Map((localMonitors || []).map(record => [record.id, record]));
  const remoteById = new Map((remoteMonitors || []).map(record => [record.id, record]));
  const additions = [];
  const updates = [];
  const deletions = [];
  for (const [id, remote] of remoteById) {
    const local = localById.get(id);
    if (!local) {
      additions.push(remote);
      continue;
    }
    if (collabStableStringify(collabMonitorRecordShape(local)) !==
        collabStableStringify(collabMonitorRecordShape(remote))) {
      updates.push(remote);
    }
  }
  for (const [id] of localById) {
    if (!remoteById.has(id)) deletions.push(id);
  }
  return {additions, updates, deletions};
};

const monitor = overrides => ({
  id: 'v1',
  mode: 'default',
  opcode: 'data_variable',
  params: {VARIABLE: 'score'},
  spriteName: null,
  value: 0,
  width: 0,
  height: 0,
  x: 5,
  y: 5,
  visible: true,
  ...overrides
});

check('monitor value churn is not a monitor diff',
  collabMonitorChanges([monitor({value: 5})], [monitor({value: 999})]),
  {additions: [], updates: [], deletions: []});

check('monitor visibility change is an update',
  collabMonitorChanges([monitor()], [monitor({visible: false})]),
  {additions: [], updates: [monitor({visible: false})], deletions: []});

const addAndDeleteResult = collabMonitorChanges(
  [monitor({id: 'keep'}), monitor({id: 'gone', x: 9})],
  [monitor({id: 'keep'}), monitor({id: 'new1', x: 50})]);
check('monitor added on peer is an addition',
  addAndDeleteResult.additions, [monitor({id: 'new1', x: 50})]);
check('monitor removed on peer is a deletion',
  addAndDeleteResult.deletions, ['gone']);

check('monitor drag (x/y) is an update',
  collabMonitorChanges([monitor({x: 5, y: 5})], [monitor({x: 240, y: 12})]),
  {additions: [], updates: [monitor({x: 240, y: 12})], deletions: []});

/* ===== summary ===== */

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nall checks passed');

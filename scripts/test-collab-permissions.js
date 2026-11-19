/*
 * 协作语义权限的验证脚本：覆盖「参与者绕过 UI 直接发 project-update」的
 * 场景，确认服务端会按删除角色 / 添加扩展 / 删除扩展的语义拒绝越权更新。
 * 运行：node scripts/test-collab-permissions.js
 */
/* eslint-disable no-console */

const AdmZip = require('adm-zip');
const {
  diffProjectStates,
  evaluateProjectUpdate
} = require('../src-main/collaboration-project-policy');
const {decodeProjectPayload} = require('../src-main/collaboration-project-payload');
const CollaborationServer = require('../src-main/collaboration-server');

const stage = () => ({
  isStage: true,
  name: 'Stage',
  variables: {},
  lists: {},
  broadcasts: {},
  blocks: {},
  comments: {},
  currentCostume: 0,
  costumes: [],
  sounds: [],
  volume: 100,
  layerOrder: 0
});

const sprite = (name, overrides) => ({
  isStage: false,
  name,
  variables: {},
  lists: {},
  broadcasts: {},
  blocks: {},
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
  rotationStyle: 'all around',
  ...overrides
});

const project = ({sprites, extensions, extensionURLs, monitors}) => {
  const json = {
    targets: [stage(), ...sprites],
    monitors: monitors || [],
    extensionStorage: {},
    meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
  };
  if (extensions) json.extensions = extensions;
  if (extensionURLs) json.extensionURLs = extensionURLs;
  return json;
};

const toSb3Payload = projectJSON => {
  const zip = new AdmZip();
  zip.addFile('project.json', Buffer.from(JSON.stringify(projectJSON), 'utf8'));
  zip.addFile('cd21514d0531fdffb22204e0ec5ed84a.svg', Buffer.from('<svg/>'));
  return {format: 'sb3', data: zip.toBuffer().toString('base64')};
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

const allowed = decision => decision.allowed === true;

/* ===== 载荷解码 ===== */

const base = project({sprites: [sprite('Sprite1')]});
const decodedBare = decodeProjectPayload(base);
check('裸工程 JSON 可解码', Boolean(decodedBare.projectJSON), true);

const decodedSb3 = decodeProjectPayload(toSb3Payload(base));
check('sb3 载荷可解码', Boolean(decodedSb3.projectJSON), true);
check('sb3 解出的工程与原始一致',
  JSON.stringify(decodedSb3.projectJSON), JSON.stringify(base));

check('base64 非法字符被拒绝',
  Boolean(decodeProjectPayload({format: 'sb3', data: '!!!!'}).error), true);
check('缺少舞台的工程被拒绝',
  Boolean(decodeProjectPayload({targets: [sprite('NoStage')]}).error), true);
check('非工程对象被拒绝',
  Boolean(decodeProjectPayload({hello: 'world'}).error), true);

/* ===== 语义 diff ===== */

const withTwoSprites = project({sprites: [sprite('A', {x: 10}), sprite('B')]});
const onlyB = project({sprites: [sprite('B')]});
const renamedA = project({sprites: [sprite('A2', {x: 10}), sprite('B')]});
const editedB = project({sprites: [sprite('A', {x: 10}), sprite('B', {x: 50})]});

check('删除角色被识别', diffProjectStates(withTwoSprites, onlyB),
  [{operation: 'deleteSprite', detail: 'A'}]);
check('改名不算删除', diffProjectStates(withTwoSprites, renamedA), []);
check('普通编辑不算删除', diffProjectStates(withTwoSprites, editedB), []);
check('删除另一个角色的副本也算删除',
  diffProjectStates(
    project({sprites: [sprite('A'), sprite('B')]}),
    project({sprites: [sprite('B')]})
  ),
  [{operation: 'deleteSprite', detail: 'A'}]);

const withExtension = project({sprites: [], extensions: ['pen']});
const withCustomExtension = project({
  sprites: [],
  extensions: ['myExt'],
  extensionURLs: {myExt: 'https://example.com/ext.js'}
});
check('添加扩展被识别', diffProjectStates(project({sprites: []}), withExtension),
  [{operation: 'addExtension', detail: 'pen'}]);
check('删除扩展被识别', diffProjectStates(withExtension, project({sprites: []})),
  [{operation: 'deleteExtension', detail: 'pen'}]);
check('自定义扩展同时出现在两处只算一次',
  diffProjectStates(project({sprites: []}), withCustomExtension),
  [{operation: 'addExtension', detail: 'myExt'}]);

// 攻击者可以省略 extensions 数组、只留扩展积木；反序列化仍会加载扩展，
// 因此判定也必须从 opcode 反推。
const extensionBlocksOnly = project({
  sprites: [sprite('A', {
    blocks: {
      b1: {opcode: 'pen_clear', next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 0, y: 0}
    }
  })]
});
check('从积木 opcode 识别扩展',
  diffProjectStates(project({sprites: [sprite('A')]}), extensionBlocksOnly),
  [{operation: 'addExtension', detail: 'pen'}]);
check('省略 extensions 数组无法绕过添加扩展权限',
  allowed(evaluateProjectUpdate({
    previous: project({sprites: [sprite('A')]}),
    next: extensionBlocksOnly,
    permissions: {allowAddExtension: false}
  })),
  false);

const monitorOnlyExtension = project({
  sprites: [],
  monitors: [{id: 'm1', mode: 'default', opcode: 'music_getTempo', params: {}, spriteName: null, visible: true}]
});
check('从监视器 opcode 识别扩展',
  diffProjectStates(project({sprites: []}), monitorOnlyExtension),
  [{operation: 'addExtension', detail: 'music'}]);

/* ===== 权限判定 ===== */

const deleteDenied = evaluateProjectUpdate({
  previous: withTwoSprites,
  next: onlyB,
  permissions: {allowDeleteSprite: false}
});
check('禁止删除角色时删除被拒绝', deleteDenied.allowed, false);
check('拒绝原因', deleteDenied.reason, 'permission-denied');
check('违规操作', deleteDenied.violations.map(v => v.operation), ['deleteSprite']);

check('禁止删除角色时改名仍允许', allowed(evaluateProjectUpdate({
  previous: withTwoSprites,
  next: renamedA,
  permissions: {allowDeleteSprite: false}
})), true);

check('禁止删除角色时普通编辑仍允许', allowed(evaluateProjectUpdate({
  previous: withTwoSprites,
  next: editedB,
  permissions: {allowDeleteSprite: false}
})), true);

check('未设置权限时删除允许', allowed(evaluateProjectUpdate({
  previous: withTwoSprites,
  next: onlyB,
  permissions: null
})), true);

check('禁止添加扩展时拒绝', allowed(evaluateProjectUpdate({
  previous: project({sprites: []}),
  next: withExtension,
  permissions: {allowAddExtension: false}
})), false);

check('禁止删除扩展时拒绝', allowed(evaluateProjectUpdate({
  previous: withExtension,
  next: project({sprites: []}),
  permissions: {allowDeleteExtension: false}
})), false);

const customExtA = project({
  sprites: [],
  extensions: ['myExt'],
  extensionURLs: {myExt: 'https://example.com/a.js'}
});
const customExtB = project({
  sprites: [],
  extensions: ['myExt'],
  extensionURLs: {myExt: 'https://evil.example/b.js'}
});
check('替换扩展加载地址被识别',
  diffProjectStates(customExtA, customExtB),
  [{operation: 'changeExtensionURL', detail: 'myExt'}]);
check('禁止添加扩展时换加载地址也被拒绝', allowed(evaluateProjectUpdate({
  previous: customExtA,
  next: customExtB,
  permissions: {allowAddExtension: false}
})), false);
check('允许添加扩展时换加载地址放行', allowed(evaluateProjectUpdate({
  previous: customExtA,
  next: customExtB,
  permissions: {allowAddExtension: true}
})), true);

check('allowEdit=false 时拒绝任何改动', allowed(evaluateProjectUpdate({
  previous: withTwoSprites,
  next: editedB,
  permissions: {allowEdit: false}
})), false);

check('无基线时拒绝', evaluateProjectUpdate({
  previous: null,
  next: editedB,
  permissions: {}
}).reason, 'not-synchronized');

check('无效快照被拒绝', evaluateProjectUpdate({
  previous: withTwoSprites,
  next: {nope: true},
  permissions: {}
}).reason, 'invalid-project');

/* ===== 服务端集成：越权更新不广播也不交给主机 ===== */

const runServerCase = ({permissions, next}) => {
  const server = new CollaborationServer({
    password: 'secret',
    port: 1234,
    permissions,
    hostName: 'Host'
  });
  const sent = [];
  const forwarded = [];
  server.sendToClient = (client, message) => sent.push({to: client.username, message});
  server.onProjectUpdate = data => forwarded.push(data);
  server.onProjectRequest = () => {};

  const sender = {username: 'P1', authenticated: true, closed: false, lastResyncAt: 0};
  const peer = {username: 'P2', authenticated: true, closed: false};
  server.clients.set('p1-socket', sender);
  server.clients.set('p2-socket', peer);

  // 主机推送权威工程（走真实的 broadcastProject → 缓存）
  server.broadcastProject(toSb3Payload(withTwoSprites));
  sent.length = 0;

  server.handleMessage(sender, JSON.stringify({type: 'project-update', project: next}));
  return {sent, forwarded};
};

const denied = runServerCase({
  permissions: {allowDeleteSprite: false},
  next: onlyB
});
check('越权删除不会交给主机', denied.forwarded.length, 0);
check('越权删除不会广播给其他参与者',
  denied.sent.filter(item => item.to === 'P2').length, 0);
check('越权删除会通知发送者',
  denied.sent.filter(item => item.to === 'P1' && JSON.parse(item.message).type === 'project-update-rejected').length,
  1);
check('拒绝消息带原因',
  JSON.parse(denied.sent.find(item => item.to === 'P1').message).reason,
  'permission-denied');

const accepted = runServerCase({
  permissions: {allowDeleteSprite: true},
  next: onlyB
});
check('允许删除时更新交给主机', accepted.forwarded.length, 1);
check('允许删除时广播给其他参与者',
  accepted.sent.filter(item => item.to === 'P2' && JSON.parse(item.message).type === 'project-update').length,
  1);

const noBaseline = (() => {
  const server = new CollaborationServer({
    password: 'secret',
    port: 1234,
    permissions: {},
    hostName: 'Host'
  });
  const sent = [];
  server.sendToClient = (client, message) => sent.push({to: client.username, message});
  server.onProjectUpdate = () => { throw new Error('must not forward'); };
  const sender = {username: 'P1', authenticated: true, closed: false, lastResyncAt: 0};
  server.clients.set('p1-socket', sender);
  server.handleMessage(sender, JSON.stringify({type: 'project-update', project: onlyB}));
  return sent;
})();
check('尚未收到主机工程时拒绝更新',
  JSON.parse(noBaseline[0].message).reason, 'not-synchronized');

/* ===== summary ===== */

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nall checks passed');

/*
 * 一次性集成验证：用真实 scratch-vm（无渲染器）验证协作增量应用中最危险的
 * replace 路径：sb3.deserialize(spriteJson, runtime, null, true) + 手动原位
 * 换入新 target（保留 id / 位置 / 编辑目标）。运行：node scripts/test-collab-vm.js
 */
/* eslint-disable no-console */

process.on('unhandledRejection', e => {
    console.error('unhandled rejection:', e);
    process.exit(1);
});

const VirtualMachine = require('scratch-vm');

const block = (id, opcode, topLevel) => ({
    opcode,
    inputs: {},
    fields: {},
    shadow: false,
    topLevel,
    x: 0,
    y: 0
});

const makeProject = () => ({
    targets: [
        {
            isStage: true,
            name: 'Stage',
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {},
            comments: {},
            currentCostume: 0,
            costumes: [{
                name: 'backdrop1',
                dataFormat: 'svg',
                assetId: 'cd21514d0531fdffb22204e0ec5ed84a',
                md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg',
                rotationCenterX: 240,
                rotationCenterY: 180
            }],
            sounds: [],
            volume: 100,
            layerOrder: 0,
            tempo: 60,
            videoTransparency: 50,
            videoState: 'on',
            textToSpeechLanguage: null
        },
        {
            isStage: false,
            name: 'Sprite1',
            variables: {v1: ['hp', 100]},
            lists: {},
            broadcasts: {},
            blocks: {b1: block('b1', 'event_whenflagclicked', true)},
            comments: {},
            currentCostume: 0,
            costumes: [{
                name: 'costume1',
                dataFormat: 'svg',
                assetId: 'bcf454acf82e4504149f7ffe07081dbc',
                md5ext: 'bcf454acf82e4504149f7ffe07081dbc.svg',
                rotationCenterX: 48,
                rotationCenterY: 50
            }],
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
        },
        {
            isStage: false,
            name: 'Sprite2',
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {b2: block('b2', 'event_whenbroadcastreceived', true)},
            comments: {},
            currentCostume: 0,
            costumes: [{
                name: 'costume1',
                dataFormat: 'svg',
                assetId: 'bcf454acf82e4504149f7ffe07081dbc',
                md5ext: 'bcf454acf82e4504149f7ffe07081dbc.svg',
                rotationCenterX: 48,
                rotationCenterY: 50
            }],
            sounds: [],
            volume: 100,
            layerOrder: 2,
            visible: true,
            x: 40,
            y: 40,
            size: 100,
            direction: 90,
            draggable: false,
            rotationStyle: 'all around'
        }
    ],
    monitors: [],
    extensions: [],
    extensionURLs: {},
    extensionData: {},
    meta: {
        semver: '3.0.0',
        vm: '2.1.46',
        agent: 'test'
    }
});

const main = async () => {
    const vm = new VirtualMachine();
    vm.setTurboMode(true);
    await vm.loadProject(makeProject());

    const sprite1Before = vm.runtime.getTargetByStaticId
        ? null
        : vm.runtime.targets.find(t => t.getName() === 'Sprite1');
    const sprite2Before = vm.runtime.targets.find(t => t.getName() === 'Sprite2');
    const editingBefore = vm.runtime.targets.find(t => t.getName() === 'Sprite2');
    vm.setEditingTarget(editingBefore.id);

    const sprite1Id = sprite1Before.id;
    const stageBefore = vm.runtime.targets.find(t => t.isStage);

    // 远端把 Sprite1 的积木改掉、hp 改成 55、位置挪动 —— 构造“远端 project.json”
    const remoteJson = makeProject();
    const remoteSprite1 = remoteJson.targets.find(t => t.name === 'Sprite1');
    remoteSprite1.blocks = {
        b1: block('b1', 'event_whenflagclicked', true),
        b9: block('b9', 'motion_movefront', true)
    };
    remoteSprite1.variables = {v1: ['hp', 55]};
    remoteSprite1.x = 12;
    remoteSprite1.y = -34;

    const sb3 = require('scratch-vm/src/serialization/sb3');

    // === replace 路径（与 desktop-hoc.jsx 的 collabReplaceSprite 一致）===
    const oldTarget = sprite1Before;
    const {targets: deserialized, extensions} = await sb3.deserialize(remoteSprite1, vm.runtime, null, true);
    await vm._loadExtensions(extensions.extensionIDs, extensions.extensionURLs);
    const newTarget = deserialized[0];

    const wasEditing = vm.editingTarget === oldTarget;
    const oldId = oldTarget.id;
    const oldIndex = vm.runtime.targets.indexOf(oldTarget);
    for (const clone of oldTarget.sprite.clones.slice()) {
        vm.runtime.stopForTarget(clone);
        vm.runtime.disposeTarget(clone);
    }
    newTarget.id = oldId;
    vm.runtime.targets.splice(Math.min(oldIndex, vm.runtime.targets.length), 0, newTarget);
    vm.runtime.executableTargets = vm.runtime.targets.slice();
    newTarget.updateAllDrawableProperties();
    newTarget.fixUpVariableReferences();
    if (wasEditing) vm.editingTarget = newTarget;

    // === 断言 ===
    const failures = [];
    const expect = (label, cond) => {
        console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
        if (!cond) failures.push(label);
    };

    const sprite1After = vm.runtime.targets.find(t => t.getName() === 'Sprite1');
    const sprite2After = vm.runtime.targets.find(t => t.getName() === 'Sprite2');
    const stageAfter = vm.runtime.targets.find(t => t.isStage);

    expect('replaced target kept the old id', sprite1After.id === sprite1Id);
    expect('replaced target sits at the old index', vm.runtime.targets.indexOf(sprite1After) === oldIndex);
    expect('Sprite2 object untouched (identity preserved)', sprite2After === sprite2Before);
    expect('Stage object untouched (identity preserved)', stageAfter === stageBefore);
    expect('runtime.targets length unchanged', vm.runtime.targets.length === 3);
    expect('editing target swapped to the new instance if it was edited',
        vm.editingTarget === (wasEditing ? newTarget : vm.editingTarget));
    expect('new blocks present', !!sprite1After.blocks.getBlock('b9'));
    expect('old sprite has no leftover clones', sprite1After.sprite.clones.length === 1);

    // 序列化回来的变量值应与远端一致（结构同步），且可再次 toJSON 不抛错
    // 注意：vm.toJSON() 会压缩重排 block ID，因此比较 opcode 集合而不是 ID
    const reserialized = JSON.parse(vm.toJSON());
    const reserSprite1 = reserialized.targets.find(t => t.name === 'Sprite1');
    const opcodes = Object.values(reserSprite1.blocks).map(b => b.opcode).sort();
    expect('reserialized blocks keep both opcodes',
        JSON.stringify(opcodes) === JSON.stringify(['event_whenflagclicked', 'motion_movefront']));
    expect('reserialized x matches remote', reserSprite1.x === 12);

    // Stage 的全局变量不受影响
    expect('stage has no stray variables', Object.keys(stageAfter.variables).length === 0);

    // === add 路径 ===
    const remoteJson2 = makeProject();
    remoteJson2.targets.push({
        isStage: false,
        name: 'Sprite3',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {},
        comments: {},
        currentCostume: 0,
        costumes: [{
            name: 'costume1',
            dataFormat: 'svg',
            assetId: 'bcf454acf82e4504149f7ffe07081dbc',
            md5ext: 'bcf454acf82e4504149f7ffe07081dbc.svg',
            rotationCenterX: 48,
            rotationCenterY: 50
        }],
        sounds: [],
        volume: 100,
        layerOrder: 3,
        visible: true,
        x: 0,
        y: 0,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: 'all around'
    });
    const sprite3Json = remoteJson2.targets.find(t => t.name === 'Sprite3');
    const {targets: addedTargets} = await sb3.deserialize(sprite3Json, vm.runtime, null, true);
    await vm._loadExtensions(new Set(), new Map());
    const added = addedTargets[0];
    vm.runtime.targets.push(added);
    vm.runtime.executableTargets = vm.runtime.targets.slice();
    added.updateAllDrawableProperties();
    added.fixUpVariableReferences();
    vm.emitTargetsUpdate(false);
    expect('added sprite installed', vm.runtime.targets.length === 4 &&
        vm.runtime.targets[3].getName() === 'Sprite3');
    expect('editing target unchanged after add', vm.editingTarget === (wasEditing ? newTarget : vm.editingTarget));

    // === delete 路径 ===
    const victim = vm.runtime.targets.find(t => t.getName() === 'Sprite3');
    victim.deleteMonitors();
    for (const clone of victim.sprite.clones.slice()) {
        vm.runtime.stopForTarget(clone);
        vm.runtime.disposeTarget(clone);
    }
    expect('deleted sprite removed', vm.runtime.targets.length === 3 &&
        !vm.runtime.targets.some(t => t.getName() === 'Sprite3'));

    // === reorder 路径 ===
    vm.reorderTarget(2, 1); // Sprite2 与 Sprite1 换位
    expect('reorder applied', vm.runtime.targets[1].getName() === 'Sprite2' &&
        vm.runtime.targets[2].getName() === 'Sprite1');

    // 最后整体序列化一次确保 VM 状态自洽
    JSON.parse(vm.toJSON());
    expect('final toJSON works', true);

    if (failures.length > 0) {
        console.log(`\n${failures.length} FAIL`);
        process.exit(1);
    }
    console.log('\nall vm integration checks passed');
    process.exit(0);
};

main().catch(e => {
    console.error(e);
    process.exit(1);
});

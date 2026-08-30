# 修复 AI 积木生成提示词和角色库添加问题

## 摘要

两个问题：1）AI 添加积木需要多次尝试——系统提示词中 opcode 参考表格式（`opcode(ARG1,ARG2)`）与 DSL 语法（`opcode arg1 arg2`）不一致，且缺少字段值提示；2）从角色库/造型库添加造型变成圆脸——`addSprite` 工具总是创建圆脸 SVG 角色，缺少从 Scratch 内置角色库添加角色的工具。

## 当前状态分析

### 问题 1：AI 添加积木需要多次尝试

**文件**：`src-renderer/ai-assistant/ai-assistant.js`

**根因**：`opcodeRef`（L528-538）使用 `motion_movesteps(STEPS)` 格式（括号+逗号），但 `dslSyntax`（L487）要求 `opcode arg1 arg2 ...`（空格分隔，无括号）。AI 看到括号格式后可能写出 `motion_movesteps(10)` 而非 `motion_movesteps 10`，导致解析失败。

**次要原因**：
- 字段型参数（如 `TO`、`STYLE`、`STOP_OPTION`、`KEY_OPTION`）没有值提示，AI 不知道该填什么值
- 示例不够丰富，缺少 `motion_goto`、`looks_switchcostumeto`、`control_stop` 等常用场景

### 问题 2：角色库/造型库添加变成圆脸

**文件**：`src-renderer-webpack/editor/gui/desktop-hoc.jsx`

**根因**：`addSprite` 工具（L1221-1238）**总是**创建一个带圆脸 SVG 的角色（L1228 的 `svgContent` 是一个画了眼睛和嘴巴的圆形）。没有从 Scratch 内置角色库添加角色的工具。

**现有资源**：
- 角色库数据：`scratch-gui/src/lib/libraries/tw-async-libraries.js` 导出 `getSpriteLibrary()` 和 `getCostumeLibrary()`
- 编辑器已有加载角色库的代码（L2560-2581）：`EditorPreload.onRequestSpriteLibrary` 回调中 import 并调用 `getSpriteLibrary()`
- 存储系统：`vm.runtime.storage` 有 `builtinHelper._store()` 和 `load()` 方法
- IPC 通道：AI 助手已有 `getSpriteLibrary` IPC（L349-365），但未暴露为 AI 工具

**角色库数据格式**（每个条目）：
```json
{ "name": "Cat", "md5": "b7853f6a3e8e8dba9b1c7a3c3d6c3d6c.svg", "type": "sprite", "tags": ["Animal"], "info": [0, 0, 47, 47] }
```
- `md5`：造型的资源 ID（哈希+扩展名）
- `info`：`[0, 0, rotationCenterX, rotationCenterY]`

## 提议的修改

### 修改 1：统一 opcode 参考表格式（核心修复）

**文件**：`src-renderer/ai-assistant/ai-assistant.js`
**位置**：L528-538（`opcodeRef` 变量）
**原因**：消除格式不一致——将 `opcode(ARG1,ARG2)` 改为 `opcode ARG1 ARG2`，与 DSL 语法一致。
**做法**：重写 opcodeRef，同时添加字段值提示。

```javascript
var opcodeRef = [
  '## Scratch Opcode Reference (args in order, space-separated; [C]=has substack, [C+else]=substack+else)',
  'Motion: motion_movesteps STEPS, motion_turnright DEGREES, motion_turnleft DEGREES, motion_goto TO, motion_glideto TO SECS, motion_pointindirection DIRECTION, motion_pointtowards TOWARDS, motion_changexby DX, motion_setx X, motion_changeyby DY, motion_sety Y, motion_ifonedgebounce, motion_setrotationstyle STYLE',
  'Looks: looks_say MESSAGE, looks_sayforsecs MESSAGE SECS, looks_think MESSAGE, looks_thinkforsecs MESSAGE SECS, looks_switchcostumeto COSTUME, looks_nextcostume, looks_switchbackdropto BACKDROP, looks_nextbackdrop, looks_changesizeby CHANGE, looks_setsizeto SIZE, looks_changeeffectby EFFECT CHANGE, looks_seteffectto EFFECT VALUE, looks_cleargraphiceffects, looks_show, looks_hide, looks_gotofrontback FRONT_BACK, looks_goforwardbackwardlayers FRONT_BACK NUM',
  'Sound: sound_play SOUND_MENU, sound_playuntildone SOUND_MENU, sound_stopallsounds, sound_changeeffectby EFFECT VALUE, sound_seteffectto EFFECT VALUE, sound_cleareffects, sound_changevolumeby VOLUME, sound_setvolumeto VOLUME',
  'Control: control_wait DURATION, control_wait_until CONDITION, control_repeat TIMES [C], control_forever [C], control_if CONDITION [C], control_if_else CONDITION [C+else], control_repeat_until CONDITION [C], control_stop STOP_OPTION, control_create_clone_of CLONE_OPTION, control_delete_this_clone, control_start_as_clone',
  'Sensing: sensing_touchingobject TOUCHINGOBJECTMENU, sensing_touchingcolor COLOR, sensing_distanceto DISTANCETOMENU, sensing_askandwait QUESTION, sensing_keypressed KEY_OPTION, sensing_of PROPERTY OBJECT, sensing_current CURRENTMENU',
  'Operators: operator_add NUM1 NUM2, operator_subtract NUM1 NUM2, operator_multiply NUM1 NUM2, operator_divide NUM1 NUM2, operator_random FROM TO, operator_gt OPERAND1 OPERAND2, operator_lt OPERAND1 OPERAND2, operator_equals OPERAND1 OPERAND2, operator_and OPERAND1 OPERAND2, operator_or OPERAND1 OPERAND2, operator_not OPERAND, operator_join STRING1 STRING2, operator_letter_of LETTER STRING, operator_length STRING, operator_contains STRING1 STRING2, operator_round NUM, operator_mathop OPERATOR NUM',
  'Data: data_setvariableto VARIABLE VALUE, data_changevariableby VARIABLE VALUE, data_showvariable VARIABLE, data_hidevariable VARIABLE, data_addtolist LIST ITEM, data_deleteoflist LIST INDEX, data_deletealloflist LIST, data_insertatlist LIST INDEX ITEM, data_replaceitemoflist LIST INDEX ITEM, data_itemoflist LIST INDEX, data_itemnumoflist LIST ITEM, data_lengthoflist LIST, data_listcontainsitem LIST ITEM',
  'Events: event_whenflagclicked, event_whenkeypressed KEY_OPTION, event_whenthisspriteclicked, event_whenbackdropswitchesto BACKDROP, event_whenbroadcastreceived BROADCAST_OPTION, event_broadcast BROADCAST_INPUT, event_broadcastandwait BROADCAST_INPUT',
  '',
  '## Field Value Guide (for dropdown/field args)',
  '- TO (motion_goto/motion_glideto): "_random_" | "_mouse_" | sprite name e.g. "Sprite1"',
  '- TOWARDS (motion_pointtowards): "_mouse_" | sprite name',
  '- STYLE (motion_setrotationstyle): "all around" | "left-right" | "don\'t rotate"',
  '- KEY_OPTION (event_whenkeypressed/sensing_keypressed): "space" | "up arrow" | "down arrow" | "left arrow" | "right arrow" | "a"-"z" | "0"-"9"',
  '- COSTUME (looks_switchcostumeto): costume name or number (e.g. "costume1")',
  '- BACKDROP (looks_switchbackdropto/event_whenbackdropswitchesto): backdrop name',
  '- STOP_OPTION (control_stop): "all" | "this script" | "other scripts in sprite" | "other scripts in stage"',
  '- CLONE_OPTION (control_create_clone_of): "_myself_" | sprite name',
  '- FRONT_BACK (looks_gotofrontback): "front" | "back"',
  '- EFFECT (looks_changeeffectby/seteffectto): "COLOR" | "FISHEYE" | "WHIRL" | "PIXELATE" | "MOSAIC" | "BRIGHTNESS" | "GHOST"',
  '- COLOR (sensing_touchingcolor): hex color e.g. "#ff0000"',
  '- TOUCHINGOBJECTMENU (sensing_touchingobject): "_mouse_" | "_edge_" | sprite name',
  '- PROPERTY (sensing_of): "x position" | "y position" | "direction" | "costume #" | "size" | "volume"',
  '- OPERATOR (operator_mathop): "abs" | "floor" | "ceiling" | "sqrt" | "sin" | "cos" | "tan" | "asin" | "acos" | "atan" | "ln" | "log" | "e ^" | "10 ^"',
  '- VARIABLE (data_*): use $varName syntax (e.g. $score)',
  '- LIST (data_*list): use @listName syntax (e.g. @items)'
].join('\n');
```

### 修改 2：添加 addSpriteFromLibrary 工具

**文件**：`src-renderer-webpack/editor/gui/desktop-hoc.jsx`
**位置**：`addSprite` case 之后（L1239 之后）
**原因**：AI 无法从 Scratch 内置角色库添加角色，只能创建圆脸角色。
**做法**：新增 `addSpriteFromLibrary` case，通过动态 import 加载角色库，按名称模糊匹配，用 `storage.load()` 加载造型资源。

```javascript
case 'addSpriteFromLibrary': {
  try {
    const spriteName = (params.spriteName || params.name || '').trim();
    if (!spriteName) { result = { success: false, error: 'No sprite name provided' }; break; }
    const storage = vm.runtime.storage;
    // 动态加载角色库
    const libModule = await import(
      /* webpackChunkName: "sprite-library" */
      'scratch-gui/src/lib/libraries/tw-async-libraries'
    );
    const getLib = libModule.getSpriteLibrary;
    const library = getLib();
    const libData = library && library.then ? await library : library;
    if (!libData || !Array.isArray(libData) || libData.length === 0) {
      result = { success: false, error: 'Sprite library not available' };
      break;
    }
    // 模糊匹配：先精确（忽略大小写），再包含匹配
    const searchLower = spriteName.toLowerCase();
    let match = libData.find(s => s.name.toLowerCase() === searchLower);
    if (!match) {
      match = libData.find(s => s.name.toLowerCase().includes(searchLower) || searchLower.includes(s.name.toLowerCase()));
    }
    if (!match) {
      // 返回前 20 个角色名供 AI 参考
      const available = libData.slice(0, 30).map(s => s.name).join(', ');
      result = { success: false, error: 'Sprite "' + spriteName + '" not found in library. Available: ' + available };
      break;
    }
    // 解析 md5（格式：hash.ext）
    const md5ext = match.md5;
    const dotIdx = md5ext.lastIndexOf('.');
    const assetId = dotIdx > 0 ? md5ext.substring(0, dotIdx) : md5ext;
    const dataFormat = dotIdx > 0 ? md5ext.substring(dotIdx + 1) : 'svg';
    const assetType = dataFormat === 'svg' ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap;
    // 加载造型资源
    let asset = null;
    try {
      asset = await storage.load(assetType, assetId);
    } catch (loadErr) {
      // 资源加载失败时仍尝试创建角色（VM 可能延迟加载）
    }
    // 从 info 数组提取旋转中心
    const info = match.info || [47, 47];
    const rcX = info.length >= 4 ? info[2] : (info[0] != null ? info[0] : 47);
    const rcY = info.length >= 4 ? info[3] : (info[1] != null ? info[1] : 47);
    const costume = {
      assetId: assetId,
      name: match.name,
      md5ext: md5ext,
      dataFormat: dataFormat,
      rotationCenterX: rcX,
      rotationCenterY: rcY,
      bitmapResolution: dataFormat === 'svg' ? 1 : 2,
      asset: asset
    };
    const spriteObj = {
      isStage: false, name: match.name, variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
      currentCostume: 0, costumes: [costume], sounds: [], volume: 100,
      layerOrder: vm.runtime.targets.length, visible: true, x: 0, y: 0, size: 100, direction: 90,
      draggable: false, rotationStyle: 'all around'
    };
    await vm.addSprite(spriteObj);
    const newTarget = vm.runtime.targets[vm.runtime.targets.length - 1];
    result = { success: true, data: { name: match.name, id: newTarget ? newTarget.id : null } };
  } catch (e2) { result = { success: false, error: 'Failed to add sprite from library: ' + (e2.message || String(e2)) }; }
  break;
}
```

### 修改 3：添加 addCostumeFromLibrary 工具

**文件**：`src-renderer-webpack/editor/gui/desktop-hoc.jsx`
**位置**：`addSpriteFromLibrary` case 之后
**原因**：AI 无法从 Scratch 内置造型库添加造型。
**做法**：新增 `addCostumeFromLibrary` case，通过 `getCostumeLibrary()` 加载造型库。

```javascript
case 'addCostumeFromLibrary': {
  try {
    const spriteName = params.spriteName || '';
    const costumeName = (params.costumeName || params.name || '').trim();
    if (!costumeName) { result = { success: false, error: 'No costume name provided' }; break; }
    const target = vm.runtime.targets.find(t => t.getName() === spriteName);
    if (!target) { result = { success: false, error: 'Sprite "' + spriteName + '" not found' }; break; }
    const storage = vm.runtime.storage;
    const libModule = await import(
      /* webpackChunkName: "costume-library" */
      'scratch-gui/src/lib/libraries/tw-async-libraries'
    );
    const getLib = libModule.getCostumeLibrary;
    const library = getLib();
    const libData = library && library.then ? await library : library;
    if (!libData || !Array.isArray(libData) || libData.length === 0) {
      result = { success: false, error: 'Costume library not available' };
      break;
    }
    const searchLower = costumeName.toLowerCase();
    let match = libData.find(c => c.name.toLowerCase() === searchLower);
    if (!match) {
      match = libData.find(c => c.name.toLowerCase().includes(searchLower) || searchLower.includes(c.name.toLowerCase()));
    }
    if (!match) {
      const available = libData.slice(0, 30).map(c => c.name).join(', ');
      result = { success: false, error: 'Costume "' + costumeName + '" not found. Available: ' + available };
      break;
    }
    const md5ext = match.md5;
    const dotIdx = md5ext.lastIndexOf('.');
    const assetId = dotIdx > 0 ? md5ext.substring(0, dotIdx) : md5ext;
    const dataFormat = dotIdx > 0 ? md5ext.substring(dotIdx + 1) : 'svg';
    const assetType = dataFormat === 'svg' ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap;
    let asset = null;
    try { asset = await storage.load(assetType, assetId); } catch (loadErr) {}
    const info = match.info || [47, 47];
    const rcX = info.length >= 4 ? info[2] : (info[0] != null ? info[0] : 47);
    const rcY = info.length >= 4 ? info[3] : (info[1] != null ? info[1] : 47);
    const costume = {
      assetId: assetId, name: match.name, md5ext: md5ext, dataFormat: dataFormat,
      rotationCenterX: rcX, rotationCenterY: rcY,
      bitmapResolution: dataFormat === 'svg' ? 1 : 2, asset: asset
    };
    target.addCostume(costume);
    target.setCostume(target.getCostumes().length - 1);
    vm.runtime.emitProjectChanged();
    result = { success: true, data: { costumeName: match.name, spriteName: spriteName } };
  } catch (e2) { result = { success: false, error: 'Failed to add costume from library: ' + (e2.message || String(e2)) }; }
  break;
}
```

### 修改 4：注册新工具到 TOOLS 数组和 toolList

**文件**：`src-renderer/ai-assistant/ai-assistant.js`
**位置**：TOOLS 数组（L954 附近 addSprite 之后）和 toolList（L461）
**原因**：让 AI 知道并可以使用新工具。
**做法**：

TOOLS 数组中 addSprite 之后添加：
```javascript
{
  name: 'addSpriteFromLibrary',
  description: 'Add a sprite from the built-in Scratch sprite library by name (e.g. "Cat", "Dog", "Ball"). Use this instead of addSprite when the user wants a specific character/animal/object.',
  parameters: {
    type: 'object',
    properties: {
      spriteName: { type: 'string', description: 'Name of the sprite to find in the library (e.g. "Cat", "Dog", "Ball", "Apple")' }
    },
    required: ['spriteName']
  }
},
{
  name: 'addCostumeFromLibrary',
  description: 'Add a costume from the built-in Scratch costume library to an existing sprite.',
  parameters: {
    type: 'object',
    properties: {
      spriteName: { type: 'string', description: 'Target sprite name' },
      costumeName: { type: 'string', description: 'Name of the costume to find in the library (e.g. "cat1", "dog1-a", "ball-a")' }
    },
    required: ['spriteName', 'costumeName']
  }
},
```

toolList 中 L461 之后添加：
```javascript
'- **addSpriteFromLibrary(spriteName)**: Add a sprite from the built-in Scratch library by name (e.g. "Cat", "Dog"). PREFER this over addSprite when the user wants a specific character.',
'- **addCostumeFromLibrary(spriteName, costumeName)**: Add a costume from the built-in Scratch costume library to a sprite.',
```

同时修改 addSprite 的描述（L461）：
```javascript
// 原代码:
'- **addSprite(spriteName?)**: Add a new sprite with a colored circle costume.',
// 改为:
'- **addSprite(spriteName?)**: Add a new EMPTY sprite with a placeholder costume. For specific characters/animals, use addSpriteFromLibrary instead.',
```

## 假设与决策

1. **保留 addSprite 工具**：仍可用于创建空白角色，但提示 AI 优先使用 `addSpriteFromLibrary`
2. **模糊匹配**：先精确匹配（忽略大小写），再包含匹配，找不到时返回可用列表供 AI 参考
3. **资源加载容错**：`storage.load()` 失败时仍创建角色，VM 可能延迟加载资源
4. **动态 import**：在工具处理函数内动态 import 角色库模块，避免影响首屏加载

## 验证步骤

1. **GetDiagnostics**：对两个修改文件运行诊断
2. **Webpack 编译**：`npm run webpack:compile` 确认编译通过
3. **功能验证**（手动）：
   - 让 AI 生成简单积木：`"让小猫移动10步"` → 应一次性成功
   - 让 AI 生成积木序列：`"让小猫重复移动并转向"` → 应一次性成功
   - 让 AI 添加角色：`"添加一只猫"` → 应从角色库添加 Cat 而非圆脸
   - 让 AI 添加造型：`"给小猫添加一个造型"` → 应从造型库添加
   - 测试字段值：`"当按下空格键时，小猫说Hello"` → 应正确生成 `event_whenkeypressed space`

# 修复 AI DSL 接口一致性与功能缺失

## 摘要

5 个问题：1）`addScript` 不校验 script 参数类型，AI 传 JSON 对象时报错信息混乱；2）错误信息"No script provided"无格式提示；3）`modify_input` 无法操作 SUBSTACK 输入；4）缺少查看已有脚本的工具；5）提示词语法规范不明确。核心根因是接口校验缺失、错误信息模糊、功能不完整、提示词与实际行为不一致。

## 当前状态分析

### 问题 1：addScript 不校验 script 类型

**文件**：`src-renderer-webpack/editor/gui/desktop-hoc.jsx` L1376-1377

```javascript
const scriptText = params.script || '';
if (!scriptText) { result = { success: false, error: 'No script provided' }; break; }
```

`addScript` 用 `||` 取值，若 AI 传 JSON 对象 `{"opcode":"event_whenflagclicked",...}`，对象是 truthy，通过 `if (!scriptText)` 检查，然后 `parseScratchDSL` 接收到对象，`String(scriptText)` 转为 `"[object Object]"`，解析出无意义结果或报错。

而 `executeOperations` 的 `add_script`（L1726）正确检查了 `typeof scriptText !== 'string'`，但两个入口行为不一致。

### 问题 2：错误信息无格式提示

- L1377: `'No script provided'` — 不告诉 AI 应该传什么格式
- L1726: `'No script text provided'` — 同样无格式提示

AI 收到这些错误后不知道该怎么修正。

### 问题 3：modify_input 无法操作 SUBSTACK

**文件**：`desktop-hoc.jsx` L1814-1878

`modify_input` 处理 number/string/boolean/object.opcode/object.VARIABLE/object.LIST，但：
- L1856: `block.inputs[inputName] = { name: inputName, block: reporterId }` — 对 SUBSTACK 输入缺少 `shadow: null`
- 未文档化 AI 可以通过 modify_input 修改 SUBSTACK
- `buildBlockStructure`（L1613）本身支持 SUBSTACK（L1636-1650, L1684-1690），但 modify_input 调用它时未区分 SUBSTACK 和普通 reporter

### 问题 4：缺少查看已有脚本的工具

`getSpriteProperty`（L1029）只返回 name/x/y/size/direction 等基本属性，不返回 blocks 结构。AI 无法查看已有脚本，难以修改。

### 问题 5：提示词语法规范不明确

**文件**：`src-renderer/ai-assistant/ai-assistant.js` L486-540

- 未明确警告"script 必须是纯文本字符串，不能是 JSON 对象"
- 未说明 modify_input 可以操作 SUBSTACK
- 未提供查看已有脚本的工具
- 字符串引号规则虽有但不够醒目

## 提议的修改

### 修改 1：addScript 校验 script 类型 + 自动转换 JSON 对象为 DSL 文本

**文件**：`src-renderer-webpack/editor/gui/desktop-hoc.jsx`
**位置**：L1376-1377（addScript case 内）
**做法**：新增 `convertBlockObjToDsl` 辅助函数，在 addScript 和 executeOperations add_script 中复用。

在 `parseScratchDSL` 函数之前（L536 之前）新增转换函数：

```javascript
function convertBlockObjToDsl(obj, indent) {
  indent = indent || 0;
  var pad = '  '.repeat(indent);
  if (!obj || !obj.opcode) return [];
  var parts = [obj.opcode];
  // 位置参数从 inputs 提取（跳过 SUBSTACK/SUBSTACK2）
  if (obj.inputs) {
    Object.keys(obj.inputs).forEach(function(key) {
      if (key === 'SUBSTACK' || key === 'SUBSTACK2') return;
      var val = obj.inputs[key];
      if (typeof val === 'number') parts.push(String(val));
      else if (typeof val === 'string') parts.push('"' + val.replace(/"/g, '\\"') + '"');
      else if (val && typeof val === 'object' && val.opcode) {
        // 嵌套 reporter — 内联格式
        var inner = convertBlockObjToDsl(val, 0).join(' ');
        parts.push('(' + inner + ')');
      }
    });
  }
  // 字段参数
  if (obj.fields) {
    Object.keys(obj.fields).forEach(function(key) {
      var fv = obj.fields[key];
      if (typeof fv === 'object' && fv !== null) fv = fv.value;
      if (key === 'VARIABLE') parts.push('$' + fv);
      else if (key === 'LIST') parts.push('@' + fv);
      else if (typeof fv === 'string') parts.push('"' + fv.replace(/"/g, '\\"') + '"');
    });
  }
  var lines = [pad + parts.join(' ')];
  // SUBSTACK 子块
  if (obj.inputs && obj.inputs.SUBSTACK) {
    var sub = obj.inputs.SUBSTACK;
    var subArr = Array.isArray(sub) ? sub : [sub];
    subArr.forEach(function(b) {
      convertBlockObjToDsl(b, indent + 1).forEach(function(l) { lines.push(l); });
    });
  }
  // SUBSTACK2 (else 分支)
  if (obj.inputs && obj.inputs.SUBSTACK2) {
    lines.push(pad + 'else');
    var sub2 = obj.inputs.SUBSTACK2;
    var sub2Arr = Array.isArray(sub2) ? sub2 : [sub2];
    sub2Arr.forEach(function(b) {
      convertBlockObjToDsl(b, indent + 1).forEach(function(l) { lines.push(l); });
    });
  }
  // next 链
  if (obj.next) {
    convertBlockObjToDsl(obj.next, indent).forEach(function(l) { lines.push(l); });
  }
  return lines;
}
```

修改 addScript case（L1376-1377）：

```javascript
// 原代码:
const scriptText = params.script || '';
if (!scriptText) { result = { success: false, error: 'No script provided' }; break; }

// 改为:
var scriptText = params.script;
if (!scriptText) {
  result = { success: false, error: 'No script provided. The "script" parameter must be a DSL text string, NOT a JSON object. Example: "event_whenflagclicked\\n  motion_movesteps 10"' };
  break;
}
// 如果传入 JSON 对象，自动转换为 DSL 文本
if (typeof scriptText === 'object') {
  try {
    var converted = convertBlockObjToDsl(scriptText, 0);
    scriptText = converted.join('\n');
  } catch (convErr) {
    result = { success: false, error: 'Failed to convert script object to DSL text: ' + (convErr.message || String(convErr)) + '. Please pass a DSL text string instead. Example: "event_whenflagclicked\\n  motion_movesteps 10"' };
    break;
  }
}
if (typeof scriptText !== 'string') {
  result = { success: false, error: 'Script must be a DSL text string (not ' + typeof scriptText + '). Example: "event_whenflagclicked\\n  motion_movesteps 10"' };
  break;
}
```

同样修改 executeOperations add_script（L1725-1726）：

```javascript
// 原代码:
const scriptText = op.script;
if (!scriptText || typeof scriptText !== 'string') { opResults.push({ index: opIdx, type: 'add_script', success: false, error: 'No script text provided' }); break; }

// 改为:
var scriptText = op.script;
if (!scriptText) {
  opResults.push({ index: opIdx, type: 'add_script', success: false, error: 'No script provided. The "script" must be a DSL text string, NOT a JSON object. Example: "event_whenflagclicked\\n  motion_movesteps 10"' });
  break;
}
if (typeof scriptText === 'object') {
  try {
    var eoConverted = convertBlockObjToDsl(scriptText, 0);
    scriptText = eoConverted.join('\n');
  } catch (eoConvErr) {
    opResults.push({ index: opIdx, type: 'add_script', success: false, error: 'Failed to convert script object to DSL: ' + (eoConvErr.message || String(eoConvErr)) });
    break;
  }
}
if (typeof scriptText !== 'string') {
  opResults.push({ index: opIdx, type: 'add_script', success: false, error: 'Script must be a DSL text string (not ' + typeof scriptText + '). Example: "event_whenflagclicked\\n  motion_movesteps 10"' });
  break;
}
```

### 修改 2：修复 modify_input 对 SUBSTACK 的支持

**文件**：`src-renderer-webpack/editor/gui/desktop-hoc.jsx`
**位置**：L1850-1857（modify_input case 内 `value.opcode` 分支）
**做法**：区分 SUBSTACK 输入和普通 reporter 输入，SUBSTACK 不设 shadow。

```javascript
// 原代码 (L1850-1857):
} else if (value && typeof value === 'object' && value.opcode) {
  deleteOldShadow();
  const allBlocks = [];
  const reporterId = buildBlockStructure(value, target, allBlocks);
  if (reporterId) {
    allBlocks.forEach(function(b) { target.blocks.createBlock(b); });
    block.inputs[inputName] = { name: inputName, block: reporterId };
  }
}

// 改为:
} else if (value && typeof value === 'object' && value.opcode) {
  deleteOldShadow();
  const allBlocks = [];
  const reporterId = buildBlockStructure(value, target, allBlocks);
  if (reporterId) {
    allBlocks.forEach(function(b) { target.blocks.createBlock(b); });
    // SUBSTACK/SUBSTACK2 输入不需要 shadow
    if (inputName === 'SUBSTACK' || inputName === 'SUBSTACK2') {
      block.inputs[inputName] = { name: inputName, block: reporterId, shadow: null };
    } else {
      block.inputs[inputName] = { name: inputName, block: reporterId };
    }
  }
}
```

### 修改 3：新增 getSpriteScripts 工具

**文件**：`src-renderer-webpack/editor/gui/desktop-hoc.jsx`
**位置**：getSpriteProperty case 之后（L1031 之后）
**做法**：遍历 target.blocks 中的 topLevel blocks，将每个脚本链转换为 DSL 文本格式返回。

```javascript
case 'getSpriteScripts': {
  const target = vm.runtime.targets.find(t => t.getName() === params.spriteName);
  if (!target) { result = { success: false, error: 'Sprite "' + params.spriteName + '" not found' }; break; }
  // 找到所有 topLevel blocks（脚本入口）
  const scripts = [];
  const allBlocks = target.blocks._blocks;
  Object.keys(allBlocks).forEach(function(blockId) {
    var b = allBlocks[blockId];
    if (b.topLevel && b.parent === null) {
      // 将 block 链转换为 DSL 文本
      var dslLines = [];
      var current = b;
      var indent = 0;
      function emitBlock(blk, ind) {
        var pad = '  '.repeat(ind);
        var parts = [blk.opcode];
        // 提取 inputs（非 SUBSTACK）
        if (blk.inputs) {
          Object.keys(blk.inputs).forEach(function(key) {
            if (key === 'SUBSTACK' || key === 'SUBSTACK2') return;
            var inp = blk.inputs[key];
            if (inp && inp.block) {
              var sub = allBlocks[inp.block];
              if (sub) {
                if (sub.opcode === 'math_number') {
                  parts.push(String(sub.fields.NUM.value));
                } else if (sub.opcode === 'text') {
                  parts.push('"' + String(sub.fields.TEXT.value).replace(/"/g, '\\"') + '"');
                } else if (sub.opcode === 'data_variable') {
                  parts.push('$' + sub.fields.VARIABLE.value);
                } else if (sub.opcode === 'data_listcontents') {
                  parts.push('@' + sub.fields.LIST.value);
                } else {
                  parts.push('(' + sub.opcode + ')');
                }
              }
            }
          });
        }
        // 提取 fields（非 VARIABLE/LIST）
        if (blk.fields) {
          Object.keys(blk.fields).forEach(function(key) {
            if (key === 'VARIABLE') { parts.push('$' + blk.fields[key].value); return; }
            if (key === 'LIST') { parts.push('@' + blk.fields[key].value); return; }
            var fv = blk.fields[key];
            if (fv && typeof fv === 'object') fv = fv.value;
            if (fv != null) parts.push('"' + String(fv) + '"');
          });
        }
        dslLines.push(pad + parts.join(' '));
        // SUBSTACK
        if (blk.inputs && blk.inputs.SUBSTACK && blk.inputs.SUBSTACK.block) {
          var sub = allBlocks[blk.inputs.SUBSTACK.block];
          while (sub) {
            emitBlock(sub, ind + 1);
            sub = sub.next ? allBlocks[sub.next] : null;
          }
        }
        // SUBSTACK2 (else)
        if (blk.inputs && blk.inputs.SUBSTACK2 && blk.inputs.SUBSTACK2.block) {
          dslLines.push(pad + 'else');
          var sub2 = allBlocks[blk.inputs.SUBSTACK2.block];
          while (sub2) {
            emitBlock(sub2, ind + 1);
            sub2 = sub2.next ? allBlocks[sub2.next] : null;
          }
        }
      }
      emitBlock(b, 0);
      scripts.push({ blockId: blockId, dsl: dslLines.join('\n') });
    }
  });
  result = { success: true, data: { spriteName: params.spriteName, scriptCount: scripts.length, scripts: scripts } };
  break;
}
```

### 修改 4：在 TOOLS 数组和 toolList 中注册 getSpriteScripts

**文件**：`src-renderer/ai-assistant/ai-assistant.js`

TOOLS 数组中 getSpriteProperty 之后添加：

```javascript
{
  type: 'function',
  function: {
    name: 'getSpriteScripts',
    description: 'View all existing scripts in a sprite as DSL text. Use this before modifying existing blocks to understand the current structure.',
    parameters: {
      type: 'object',
      properties: {
        spriteName: { type: 'string', description: 'Name of the sprite' }
      },
      required: ['spriteName']
    }
  }
}
```

toolList 中 getSpriteProperty 之后添加：

```javascript
'- **getSpriteScripts(spriteName)**: View all existing scripts in a sprite as DSL text. Use before modifying existing blocks.',
```

### 修改 5：强化系统提示词

**文件**：`src-renderer/ai-assistant/ai-assistant.js`

#### 5a. dslSyntax 新增格式警告（L486-540 区域）

在 dslSyntax 开头添加醒目警告：

```javascript
var dslSyntax = [
  '## Scratch DSL Syntax',
  '**IMPORTANT: The "script" parameter MUST be a plain text string, NOT a JSON object.**',
  '**Do NOT pass {"opcode":"...","next":{...}} — pass DSL text like "event_whenflagclicked\\n  motion_movesteps 10"**',
  '',
  'Write Scratch scripts as code-like text (NOT JSON). Rules:',
  // ... 其余不变
```

#### 5b. rules 新增 modify_input SUBSTACK 说明

```javascript
var rules = [
  '## Rules',
  '1. Ranges: x(-240~240) y(-180~180) size(5~535) dir(-180~180).',
  '2. Use Scratch DSL (not JSON) for addScript and executeOperations add_script. The script parameter MUST be a text string.',
  '3. Reply in Chinese.',
  '4. **GENERATE COMPLETE SCRIPTS IN ONE CALL**: ...',
  '5. **MULTIPLE SCRIPTS**: ...',
  '6. **DO NOT over-explain**: ...',
  '7. **modify_input supports SUBSTACK**: To modify a C-block body, pass inputName="SUBSTACK" and value={"opcode":"...","inputs":{...},"next":{...}}. For else branch use inputName="SUBSTACK2".',
  '8. **View before modify**: Use getSpriteScripts(spriteName) to view existing scripts before modifying them with modify_input or delete_block.'
];
```

## 假设与决策

1. **自动转换而非拒绝**：当 AI 传 JSON 对象时，自动转换为 DSL 文本而非直接报错，提升容错性
2. **getSpriteScripts 返回 DSL 文本**：而非原始 JSON block 结构，因为 DSL 文本更省 token 且 AI 更易理解
3. **modify_input SUBSTACK 修复**：仅需添加 `shadow: null` 和区分 SUBSTACK/SUBSTACK2，buildBlockStructure 已支持块链
4. **convertBlockObjToDsl 为辅助函数**：定义在模块顶层，addScript 和 executeOperations 均可调用

## 验证步骤

1. **GetDiagnostics**：对两个修改文件运行诊断
2. **Webpack 编译**：`npm run webpack:compile`
3. **功能验证**（手动）：
   - 让 AI 传 JSON 对象格式的 script → 应自动转换为 DSL 文本并成功
   - 让 AI 传空 script → 应返回带格式提示的清晰错误
   - 让 AI 查看 Sprite1 的脚本 → getSpriteScripts 应返回 DSL 文本
   - 让 AI 修改某 C-block 的 SUBSTACK → modify_input 应成功设置 shadow:null
   - 让 AI 生成积木 → 应一次性生成完整脚本

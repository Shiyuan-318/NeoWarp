# 修复 C 型积木 SUBSTACK 挂载 bug + 版本号升级

## 概述

修复 AI 助手 `add_script` 处理 C 型积木（control_forever/control_repeat/control_if 等）substack 数组时的严重 bug：substack 内的块虽被创建并计入数量，但未正确挂载到 C 型积木的 SUBSTACK 插槽，导致重复执行体内为空。同时将版本号从 1.0.17 升级至 1.0.17.1。

## 当前状态分析

### 数据流回顾

1. `parseScratchDSL` 解析 DSL 文本 → `{hat, blocks, warnings}`
2. `convertNode`（L536）把树节点转为 descriptor：`{opcode, inputs, fields, substack?, substack2?}`
   - `substack` 是**顶层属性**（由 `node.substack.map(convertNode)` 生成），**不在 `inputs` 里**
3. `buildBlockStructure(descriptor, allBlocks)` 构建块：
   - 遍历 `descriptor.inputs`（不含 SUBSTACK）
   - 检查 `descriptor.substack` 顶层属性 → 调用 `buildSubstackChain` → 设置 `blockDef.inputs.SUBSTACK`

### Bug 根因

代码中存在**两个** `buildBlockStructure` + `buildSubstackChain` 实现：
- **addScript 版本**（L1599, L1671）：在 `addScript` case 内
- **executeOperations 版本**（L1778, L1866）：在 `executeOperations` case 内

两者都有相同的两个 bug：

#### Bug 1（核心，导致症状）：SUBSTACK input 缺少 `shadow: null`

当前代码（addScript 版 L1655, L1659；executeOperations 版 L1851, L1855）：
```javascript
blockDef.inputs.SUBSTACK = { name: 'SUBSTACK', block: substackId };
blockDef.inputs.SUBSTACK2 = { name: 'SUBSTACK2', block: substack2Id };
```

Scratch VM 对 C 型积木的 SUBSTACK input 要求格式为 `{ name, block, shadow: null }`。`shadow: null` 明确表示"无默认空 substack 阴影块"。缺少 `shadow` 字段时，VM 视其为 `undefined`，**不认为 SUBSTACK 有效连接**，导致执行时循环体为空——这正是用户描述的"重复执行体内啥玩意也没有"。

**证据**：本项目 `modify_input` 修复（L2038, L2052）已正确使用 `shadow: null`；`createShadowBlock` 对空 input 也返回 `shadow: null`（L1593 等）。

#### Bug 2：substack 子块 parent 未正确设置

- **addScript 版 `buildSubstackChain`（L1671-1688）**：`if (prevId)` 块内设置非首块 parent，但**首块 parent 保持 null**（应为 C 型积木 id）
- **executeOperations 版 `buildSubstackChain`（L1866-1881）**：**完全不设置任何子块 parent**（只有 `prevDef.next = subId`，无 `curDef.parent` 赋值），比 addScript 版更严重

后果：substack 内块的 parent 关系断裂，可能导致 VM 遍历/渲染异常。

### 为什么"顶层 next 链正常"

`addScript` 的 L1701-1710 和 `executeOperations` 的对应代码正确设置 next 链块的 parent（`curBlock.parent = prevId`），所以顶层序列 b1→b2→b3→b4 正常。但 substack 内的块走 `buildSubstackChain`，该函数有上述 bug。

## 修改方案

### 修改 1：版本号升级（package.json L4）

```json
"version": "1.0.17.1",
```

### 修改 2：addScript 版 buildBlockStructure 添加 shadow: null（desktop-hoc.jsx L1655, L1659）

```javascript
// L1655
if (substackId) blockDef.inputs.SUBSTACK = { name: 'SUBSTACK', block: substackId, shadow: null };
// L1659
if (substack2Id) blockDef.inputs.SUBSTACK2 = { name: 'SUBSTACK2', block: substack2Id, shadow: null };
```

### 修改 3：addScript 版 buildSubstackChain 设置首块 parent（desktop-hoc.jsx L1671-1688）

修改函数签名增加 `parentBlockId` 参数，并在构建首块时设置 parent：

```javascript
function buildSubstackChain(substackArray, allBlocks, parentBlockId) {
  if (!Array.isArray(substackArray) || substackArray.length === 0) return null;
  var firstId = null;
  var prevId = null;
  for (var si = 0; si < substackArray.length; si++) {
    var subId = buildBlockStructure(substackArray[si], allBlocks);
    if (!subId) continue;
    if (firstId === null) firstId = subId;
    var curDef = allBlocks.find(ab => ab.id === subId);
    if (curDef) curDef.parent = prevId || parentBlockId;
    if (prevId) {
      var prevDef = allBlocks.find(ab => ab.id === prevId);
      if (prevDef) prevDef.next = subId;
    }
    prevId = subId;
  }
  return firstId;
}
```

调用处（L1654, L1658）传入 `blockId`：
```javascript
const substackId = buildSubstackChain(scriptObj.substack, allBlocks, blockId);
const substack2Id = buildSubstackChain(scriptObj.substack2, allBlocks, blockId);
```

### 修改 4：executeOperations 版 buildBlockStructure 添加 shadow: null（desktop-hoc.jsx L1851, L1855）

```javascript
// L1851
if (substackId) blockDef.inputs.SUBSTACK = { name: 'SUBSTACK', block: substackId, shadow: null };
// L1855
if (substack2Id) blockDef.inputs.SUBSTACK2 = { name: 'SUBSTACK2', block: substack2Id, shadow: null };
```

### 修改 5：executeOperations 版 buildSubstackChain 设置 parent（desktop-hoc.jsx L1866-1881）

修改函数签名增加 `parentBlockId` 参数，并设置所有子块 parent：

```javascript
function buildSubstackChain(substackArray, target, allBlocks, parentBlockId) {
  if (!Array.isArray(substackArray) || substackArray.length === 0) return null;
  var firstId = null;
  var prevId = null;
  for (var si = 0; si < substackArray.length; si++) {
    var subId = buildBlockStructure(substackArray[si], target, allBlocks);
    if (!subId) continue;
    if (firstId === null) firstId = subId;
    var curDef = allBlocks.find(function(ab) { return ab.id === subId; });
    if (curDef) curDef.parent = prevId || parentBlockId;
    if (prevId) {
      var prevDef = allBlocks.find(function(ab) { return ab.id === prevId; });
      if (prevDef) prevDef.next = subId;
    }
    prevId = subId;
  }
  return firstId;
}
```

调用处（L1850, L1854）传入 `blockId`：
```javascript
const substackId = buildSubstackChain(scriptObj.substack, target, allBlocks, blockId);
const substack2Id = buildSubstackChain(scriptObj.substack2, target, allBlocks, blockId);
```

## 假设与决策

1. **`shadow: null` 是必需的**：基于 Scratch 3.0 block JSON 规范和本项目 `modify_input` 修复的先例。C 型积木的 SUBSTACK input 必须有 `shadow: null`，否则 VM 视为未连接。
2. **不合并两个 buildBlockStructure**：虽然两个版本代码重复，但合并涉及大面积重构，超出本次修复范围。本次仅修复 bug，保持现有结构。
3. **parent 关系修复**：首块 parent 设为 C 型积木 id，非首块 parent 设为前一块 id。这符合 Scratch block 树结构规范。
4. **版本号 1.0.17.1**：用户明确要求，遵循语义化版本补丁号。

## 验证步骤

1. `GetDiagnostics` 检查 desktop-hoc.jsx 无语法错误
2. `npm run webpack:prod` 编译通过
3. 更新 `.trae/developlog/log.md` 开发日志
4. `npm run electron:build` 打包验证（可选，用户可能要求）
5. 测试用例（需启动应用）：
   - 让 AI 生成 `control_forever` 含循环体的脚本，验证循环体块实际执行
   - 让 AI 生成 `control_if_else` 含 if/else 体的脚本，验证两分支都有块
   - 检查生成的 block JSON，确认 SUBSTACK input 有 `shadow: null` 且子块 parent 正确

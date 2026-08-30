# 修复 AI 助手 DSL 积木生成问题（v2）

## 摘要

AI 助手使用 DSL（类 Python 缩进语法）生成 Scratch 积木时存在三个严重问题：1）无法正常生成积木；2）无法正常生成一段积木（多块连续积木）；3）给 AI 的报错反馈异常。经过深入代码分析，根本原因集中在 **JSON 字符串转义困难**、**DSL 语法歧义**、**错误反馈不完整** 三个方面。

## 当前状态分析

### 涉及文件

1. **`src-renderer/ai-assistant/ai-assistant.js`** — AI 对话循环、工具调用、系统提示词
   - `runConversationLoop`（L1231）：处理流式响应和工具调用
   - `TOOLS` 数组（L606）：工具定义，含 `addScript`（L917）和 `executeOperations`（L932）
   - `buildSystemPrompt`（L427）：系统提示词，含 DSL 语法说明（L484-523）
   - JSON 参数解析（L1329-1346）：已有 Change 1 修复（返回解析错误给 AI）

2. **`src-renderer-webpack/editor/gui/desktop-hoc.jsx`** — DSL 解析器、积木创建
   - `OPCODE_SCHEMA`（L234-370）：opcode → 参数 schema 注册表
   - `tokenizeArgs`（L374-453）：参数分词器
   - `parseScratchDSL`（L536-631）：DSL 文本 → 树结构，已有 Change 2 修复（Tab 归一化）
   - `addScript` 处理器（L1251-1430）：含 `buildBlockStructure`（L1311，**已有** opcode 检查）
   - `executeOperations` 处理器（L1431+）：含 `buildBlockStructure`（L1483，**缺少** opcode 检查）

### 已完成的修复（上一轮）

| 修复 | 状态 | 位置 |
|------|------|------|
| Change 1: JSON 解析失败时返回错误给 AI | ✅ 已完成 | ai-assistant.js L1329-1346 |
| Change 2: Tab 缩进归一化为 2 空格 | ✅ 已完成 | desktop-hoc.jsx L542-545 |
| Change 3: DSL 错误消息含行内容上下文 | ⚠️ 部分完成 | addScript 已做（L1262），executeOperations 未做（L1601） |
| Change 4: executeOperations buildBlockStructure opcode 检查 | ❌ 未完成 | desktop-hoc.jsx L1484 |
| Change 5: 系统提示词增强 | ❌ 未完成 | ai-assistant.js L484-523 |

### 根本原因分析

**问题 1：无法正常生成积木**

- **根因 A（最关键）**：AI 生成的工具调用 JSON 参数中，`script` 字段是多行文本，需要将换行符转义为 `\n`、引号转义为 `\"`。很多 LLM（尤其是中小模型）无法正确转义，导致 `JSON.parse` 失败。Change 1 虽然返回了错误信息，但 AI 往往反复犯同样的错误，陷入循环。
- **根因 B**：`executeOperations` 的 `buildBlockStructure`（L1484）缺少 `!scriptObj.opcode` 检查，当传入空对象时会创建 `opcode: undefined` 的积木，导致 `createBlock` 抛出异常。
- **根因 C**：系统提示词的 DSL 语法说明不够明确，AI 不清楚参数是位置参数（按顺序排列），也不清楚 JSON 字符串转义要求。

**问题 2：无法正常生成一段积木**

- **根因 D**：多行脚本（积木序列）比单块积木更容易触发 JSON 转义问题——行数越多，AI 越容易写出未转义的实际换行符。
- **根因 E**：系统提示词缺少"连续积木序列"的完整示例，AI 可能不理解多条积木如何用缩进表示同一层级。

**问题 3：给 AI 的报错反馈异常**

- **根因 F**：`executeOperations` 的 `add_script` catch（L1601）不包含 DSL 源文本，AI 无法看到自己写了什么，难以修正。
- **根因 G**：当 `target.blocks.createBlock(b)` 抛出异常时，catch 块（L1428, L1601）只返回 `'Failed to add blocks: ' + e2.message`，不包含是哪块积木出错、什么 opcode。
- **根因 H**：当 AI 使用未知 opcode（不在 `OPCODE_SCHEMA` 中）时，`mapArgsToDescriptor` 静默回退到 `ARG1/ARG2` 输入名，AI 收到 `success: true` 但积木实际上是坏的。

## 提议的修改

### 修改 1：宽松 JSON 解析（核心修复）

**文件**：`src-renderer/ai-assistant/ai-assistant.js`
**位置**：L1329-1346（`runConversationLoop` 内的工具调用处理）
**原因**：解决根因 A——AI 最常见的错误是在 JSON 字符串值内使用实际换行符而非 `\n`。
**做法**：在严格 `JSON.parse` 失败后，尝试一次"宽松修复"：扫描字符串，仅对字符串值内部的 `\n`/`\r`/`\t` 进行转义，然后重新解析。如果仍然失败，才返回错误。

```javascript
// 替换 L1329-1346 的 toolPromises 逻辑
var toolPromises = pendingToolCalls.map(function(tc) {
  var args;
  var parseError = null;
  try {
    args = JSON.parse(tc.arguments);
  } catch (e) {
    // 宽松修复：将字符串值内部的实际换行符/制表符转义
    try {
      args = JSON.parse(lenientFixJsonStrings(tc.arguments));
    } catch (e2) {
      parseError = e2.message;
      args = {};
    }
  }
  if (parseError) {
    return Promise.resolve({
      toolCallId: tc.id,
      name: tc.name,
      result: {
        success: false,
        error: 'JSON 参数解析失败: ' + parseError + '\n' +
          '提示: script 参数中的换行必须写成 \\n，引号必须写成 \\"\n' +
          '原始参数(前500字符): ' + (tc.arguments || '').substring(0, 500)
      }
    });
  }
  return executeToolCall(tc.name, args).then(function(result) {
    return { toolCallId: tc.id, name: tc.name, result: result };
  });
});
```

新增辅助函数 `lenientFixJsonStrings`（放在 `runConversationLoop` 之前）：

```javascript
// 宽松修复 JSON 字符串：仅转义字符串值内部的裸换行符和制表符
function lenientFixJsonStrings(str) {
  var result = '';
  var inString = false;
  var escaped = false;
  for (var i = 0; i < str.length; i++) {
    var ch = str[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\' && inString) { result += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString) {
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    }
    result += ch;
  }
  return result;
}
```

### 修改 2：完成 executeOperations 错误上下文（Change 3 续）

**文件**：`src-renderer-webpack/editor/gui/desktop-hoc.jsx`
**位置**：L1600-1602（`executeOperations` 的 `add_script` catch）
**原因**：解决根因 F——AI 收到 DSL 解析错误时看不到自己写的脚本。
**做法**：在错误消息中附加 DSL 源文本（与 addScript L1262 保持一致）。

```javascript
// L1601 原代码:
opResults.push({ index: opIdx, type: 'add_script', success: false, error: 'DSL parse error: ' + (parseErr.message || String(parseErr)) });

// 改为:
opResults.push({ index: opIdx, type: 'add_script', success: false, error: 'DSL parse error: ' + (parseErr.message || String(parseErr)) + '\nScript text (first 500 chars):\n' + scriptText.substring(0, 500) });
```

### 修改 3：修复 executeOperations opcode 检查（Change 4）

**文件**：`src-renderer-webpack/editor/gui/desktop-hoc.jsx`
**位置**：L1484（`executeOperations` 的 `buildBlockStructure` 函数开头）
**原因**：解决根因 B——空对象导致创建 `opcode: undefined` 积木。
**做法**：与 addScript 版本（L1312）保持一致。

```javascript
// L1484 原代码:
if (!scriptObj) return null;

// 改为:
if (!scriptObj || !scriptObj.opcode) return null;
```

### 修改 4：增强 createBlock 异常反馈

**文件**：`src-renderer-webpack/editor/gui/desktop-hoc.jsx`
**位置**：L1428（addScript catch）、L1601 附近（executeOperations add_script 的外层 catch）
**原因**：解决根因 G——AI 不知道是哪块积木出错。
**做法**：在 catch 块中附加出错的 opcode 和积木数量信息。

addScript catch（L1428）：
```javascript
// 原代码:
} catch (e2) { result = { success: false, error: 'Failed to add blocks: ' + (e2.message || String(e2)) }; }

// 改为:
} catch (e2) {
  result = {
    success: false,
    error: 'Failed to add blocks: ' + (e2.message || String(e2)) +
      '\nBlocks attempted: ' + (allBlocks ? allBlocks.length : 0) +
      '\nLast opcode: ' + (allBlocks && allBlocks.length > 0 ? allBlocks[allBlocks.length - 1].opcode : 'unknown')
  };
}
```

executeOperations add_script（在 `allBlocks.forEach(function(b) { target.blocks.createBlock(b); });` L1626 处添加 try-catch）：
```javascript
// 原代码:
if (allBlocks.length > 0) {
  allBlocks.forEach(function(b) { target.blocks.createBlock(b); });
  // ...
}

// 改为:
if (allBlocks.length > 0) {
  try {
    allBlocks.forEach(function(b) { target.blocks.createBlock(b); });
    vm.runtime.emitProjectChanged();
    vm.emitWorkspaceUpdate();
    vm.emitTargetsUpdate();
  } catch (createErr) {
    opResults.push({
      index: opIdx,
      type: 'add_script',
      success: false,
      error: 'createBlock failed: ' + (createErr.message || String(createErr)) +
        '\nBlocks attempted: ' + allBlocks.length +
        '\nLast opcode: ' + (allBlocks.length > 0 ? allBlocks[allBlocks.length - 1].opcode : 'unknown')
    });
    break;
  }
}
```

### 修改 5：未知 opcode 验证反馈

**文件**：`src-renderer-webpack/editor/gui/desktop-hoc.jsx`
**位置**：`parseScratchDSL` 函数内（L598 附近，`const schema = OPCODE_SCHEMA[parsed.opcode];` 之后）
**原因**：解决根因 H——AI 使用未知 opcode 时静默成功。
**做法**：当 opcode 不在 `OPCODE_SCHEMA` 中时，收集警告信息，最终附加到返回结果中。

在 `parseScratchDSL` 返回值中新增 `warnings` 字段：
```javascript
// L598 之后添加:
const warnings = []; // 在函数开头声明

// L598 处:
const schema = OPCODE_SCHEMA[parsed.opcode];
if (!schema) {
  warnings.push('line ' + lineNo + ': unknown opcode "' + parsed.opcode + '" (not in OPCODE_SCHEMA, block may not work correctly)');
}
```

L630 返回值改为：
```javascript
return { hat: hatDescriptor, blocks, warnings };
```

addScript 处理器（L1260 之后）添加警告检查：
```javascript
parsed = parseScratchDSL(scriptText, target);
var warningStr = (parsed.warnings && parsed.warnings.length > 0)
  ? '\nWarnings: ' + parsed.warnings.join('; ')
  : '';
// ... 在 result = { success: true, ... } 中附加 warnings
result = { success: true, data: { targetName: targetName, blocksAdded: allBlocks.length, warnings: warningStr || undefined } };
```

executeOperations add_script 同理（L1599 之后）。

### 修改 6：增强系统提示词（Change 5）

**文件**：`src-renderer/ai-assistant/ai-assistant.js`
**位置**：L484-523（`dslSyntax` 变量）
**原因**：解决根因 C、D、E——AI 不清楚 JSON 转义、位置参数、连续积木序列。
**做法**：在 DSL 语法说明中添加三条关键提示。

在 L496（`'- Comments: lines starting with #'` 之后）添加：
```javascript
'- Args are POSITIONAL (in the order shown in the Opcode Reference below), no arg names needed',
'- In JSON tool calls, the "script" param is a single string: use \\n for newlines and \\" for quotes inside it. Example: "event_whenflagclicked\\n  motion_movesteps 10"',
'- Multiple blocks at the same indent level = a sequence (they chain via "next")',
```

## 假设与决策

1. **保留 DSL 方案**：用户原始要求是"尽量不让 AI 写 JSON"，DSL 方案符合此要求。工具调用的 JSON 参数是 LLM API 的约束，无法避免。
2. **宽松解析优先于严格报错**：与其让 AI 反复失败，不如自动修复最常见的转义问题（字符串内裸换行符），减少对话轮次。
3. **不修改工具 schema**：不将 `script` 改为数组格式，保持向后兼容，改动最小化。
4. **警告而非报错**：未知 opcode 只产生警告不阻断执行，因为某些扩展 opcode 可能不在 OPCODE_SCHEMA 中但仍可工作。

## 验证步骤

1. **代码诊断**：对两个修改文件运行 `GetDiagnostics`，确保无语法错误
2. **Webpack 编译**：执行 `npm run webpack:compile`，确认编译通过
3. **功能验证**（需手动）：
   - 启动 Electron，打开 AI 助手
   - 让 AI 生成简单积木：`"让小猫移动10步"` → 应生成 `motion_movesteps 10`
   - 让 AI 生成积木序列：`"让小猫重复移动并转向"` → 应生成 `control_forever` 含子积木
   - 让 AI 生成含字符串的积木：`"让小猫说Hello World"` → 应生成 `looks_say "Hello World"`
   - 故意让 AI 生成错误脚本，检查错误反馈是否包含 DSL 源文本

# 修复 AI 助手 DSL 积木生成问题

## Summary
AI 助手使用新的 DSL 语法生成 Scratch 积木时存在三个问题：无法正常生成积木、无法正常生成积木序列、错误反馈异常。经过代码分析，发现根因是：(1) JSON 解析失败被静默吞没，AI 收到无意义的"No script provided"错误；(2) Tab 缩进未被正确处理，导致 C 型积木嵌套断裂；(3) 错误信息缺少上下文（DSL 原文、具体出错位置），AI 无法自我纠正。

## Current State Analysis

### 问题 1：JSON 解析失败被吞没（最严重）
[ai-assistant.js:1331](file:///d:/Shiyuan/NeoWarp/src-renderer/ai-assistant/ai-assistant.js#L1331):
```javascript
try { args = JSON.parse(tc.arguments); } catch(e) { args = {}; }
```
当 AI 生成的 DSL 字符串包含未转义换行或引号时，`JSON.parse` 抛出异常，但被 catch 吞没为 `args = {}`。AI 收到 `{success: false, error: 'No script provided'}`，完全不知道是 JSON 格式错误。这导致 AI 反复尝试同样的格式，表现为"无法正常生成积木"。

### 问题 2：Tab 缩进破坏嵌套
[desktop-hoc.jsx:544](file:///d:/Shiyuan/NeoWarp/src-renderer-webpack/editor/gui/desktop-hoc.jsx#L544):
```javascript
const indentSpaces = line.length - line.replace(/^\s+/, '').length;
const indent = Math.floor(indentSpaces / 2);
```
`\s+` 匹配 tab，但 `line.length` 按字符计数（1 tab = 1 字符）。单个 tab → `indentSpaces=1` → `indent=0`，tab 缩进的块被当作根级块，C 型积木的 substack 为空。表现为"无法正常生成一段积木"。

### 问题 3：错误反馈缺少可操作信息
- DSL 解析错误只含行号和错误类型，不含 DSL 原文，AI 无法定位是哪次调用出错
- `buildBlockStructure` 创建积木失败时只返回 `'Failed to add blocks: ' + e.message`，不含是哪个 opcode 出错
- 未知 opcode 被静默接受为 ARG1/ARG2/... 回退，但后续 VM 创建积木时可能失败，错误信息不指明是 opcode 无效

### 问题 4：executeOperations 的 buildBlockStructure 缺少 opcode 检查
[desktop-hoc.jsx:1481](file:///d:/Shiyuan/NeoWarp/src-renderer-webpack/editor/gui/desktop-hoc.jsx#L1481):
```javascript
if (!scriptObj) return null;  // 缺少 || !scriptObj.opcode 检查
```
对比 addScript 版本 [desktop-hoc.jsx:1309](file:///d:/Shiyuan/NeoWarp/src-renderer-webpack/editor/gui/desktop-hoc.jsx#L1309):
```javascript
if (!scriptObj || !scriptObj.opcode) return null;
```

## Proposed Changes

### Change 1: 修复 JSON 解析失败处理（ai-assistant.js）
**文件**: `src-renderer/ai-assistant/ai-assistant.js`
**位置**: 第 1329-1335 行
**What**: 当 `JSON.parse(tc.arguments)` 失败时，不再吞没错误，而是构造一个明确的错误结果返回给 AI。

**改法**:
```javascript
var toolPromises = pendingToolCalls.map(function(tc) {
  var args;
  var parseError = null;
  try { args = JSON.parse(tc.arguments); } catch(e) { parseError = e.message; args = {}; }
  if (parseError) {
    return Promise.resolve({
      toolCallId: tc.id,
      name: tc.name,
      result: {
        success: false,
        error: 'JSON arguments parse error: ' + parseError + '. Your tool call arguments must be valid JSON. For the "script" parameter, use \\n for newlines and \\" for quotes inside the string. Raw arguments: ' + tc.arguments.substring(0, 500)
      }
    });
  }
  return executeToolCall(tc.name, args).then(function(result) {
    return { toolCallId: tc.id, name: tc.name, result: result };
  });
});
```

**Why**: AI 需要知道是 JSON 格式错误而非脚本内容错误，才能正确修正（用 `\n` 转义换行、`\"` 转义引号）。

### Change 2: 修复 Tab 缩进处理（desktop-hoc.jsx）
**文件**: `src-renderer-webpack/editor/gui/desktop-hoc.jsx`
**位置**: `parseScratchDSL` 函数内，第 540-546 行
**What**: 在计算缩进前，将行首的 tab 转换为 2 个空格。

**改法**:
```javascript
for (let li = 0; li < rawLines.length; li++) {
  const line = rawLines[li];
  // Normalize: convert leading tabs to 2 spaces each for indent calculation
  const indentMatch = line.match(/^[\t ]*/);
  const indentRaw = indentMatch ? indentMatch[0] : '';
  const indentSpaces = indentRaw.replace(/\t/g, '  ').length;
  const indent = Math.floor(indentSpaces / 2);
  const trimmed = line.replace(/^[\t ]+/, '').replace(/\s+$/, '');
  if (trimmed.length === 0 || trimmed.charAt(0) === '#') continue;
  parsedLines.push({ indent, content: trimmed, lineNo: li + 1 });
}
```

**Why**: AI 代码生成常使用 tab 缩进。将 tab 视为 2 空格可兼容 tab 和空格混用的情况。

### Change 3: 增强 DSL 解析错误信息（desktop-hoc.jsx）
**文件**: `src-renderer-webpack/editor/gui/desktop-hoc.jsx`
**位置**: `parseScratchDSL` 函数，以及 addScript/executeOperations 的 catch 块
**What**: 
1. `parseScratchDSL` 在解析失败时，在错误信息中附加上下文行内容
2. addScript 的 DSL parse error 返回值中附带 DSL 原文前 500 字符
3. 在 `mapArgsToDescriptor` 中，当 opcode 不在 OPCODE_SCHEMA 中时，在 descriptor 上设置 `__unknown: true` 标记
4. 在 `buildBlockStructure` 中，如果遇到 `__unknown` 标记，在控制台输出警告（不阻断）

**具体改动**:
- `parseScratchDSL` 的 throw 处增加行内容：`throw new Error('line ' + lineNo + ': ' + e.message + ' (near: "' + content.substring(0, 60) + '")');`
- addScript 的 catch：`error: 'DSL parse error: ' + (parseErr.message || String(parseErr)) + '\nScript text (first 500 chars):\n' + scriptText.substring(0, 500)`
- executeOperations add_script 的 catch：同上

### Change 4: 修复 executeOperations 的 opcode 检查（desktop-hoc.jsx）
**文件**: `src-renderer-webpack/editor/gui/desktop-hoc.jsx`
**位置**: 第 1481 行
**What**: 补充 opcode 检查
**改法**: `if (!scriptObj || !scriptObj.opcode) return null;`

### Change 5: 增强系统提示词的 DSL 说明（ai-assistant.js）
**文件**: `src-renderer/ai-assistant/ai-assistant.js`
**位置**: `buildSystemPrompt` 的 `dslSyntax` 变量
**What**: 
1. 强调参数是**位置参数**（按顺序），不是命名参数
2. 强调 JSON 字符串中的换行必须用 `\n` 转义
3. 在 opcode 参考表中标注参数是 input 还是 field（对 $var/@list 的行为有影响）

**具体改动**: 在 dslSyntax 数组中添加：
```
'- IMPORTANT: Arguments are POSITIONAL (in order), not named. Write `motion_movesteps 10`, NOT `motion_movesteps STEPS=10`.',
'- IMPORTANT: In the JSON tool call, newlines in the script string MUST be escaped as \\n. Example: "event_whenflagclicked\\n  motion_movesteps 10"',
```

## Assumptions & Decisions
1. **不修改 buildBlockStructure / createShadowBlock / buildSubstackChain 的核心逻辑** — 这些函数在 DSL 之前就存在且工作正常，DSL 解析器的输出格式已与它们兼容
2. **不为未知 opcode 抛出错误** — 扩展积木的 opcode 不在 OPCODE_SCHEMA 中，应通过回退机制处理，只输出警告
3. **不改变 DSL 语法本身** — 语法设计已通过 spec 审批，只修复实现 bug 和提示词
4. **Tab 转换为 2 空格** — 与系统提示词中"2-space indentation"一致

## Verification Steps
1. 用 tab 缩进的 DSL 脚本能正确解析 C 型积木嵌套
2. AI 发送 malformed JSON 时，错误信息包含原始参数和修复建议
3. DSL 解析失败时，错误信息包含行内容上下文和 DSL 原文
4. `executeOperations` 的 `add_script` 能正确处理无 opcode 的描述符（返回 null 而非崩溃）
5. 现有 addScript 功能不受影响（用空格缩进的脚本仍正常工作）
6. 系统提示词中明确说明位置参数和 JSON 转义要求

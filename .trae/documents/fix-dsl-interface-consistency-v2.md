# DSL 接口一致性修复 v2

## 概述

用户反馈 AI Scratch DSL 接口存在 5 类问题：格式不一致、错误信息模糊、modify_input SUBSTACK 不可用、缺少查看脚本工具（实际已存在但 AI 不知晓）、文本格式健壮性不足。核心根因是**系统提示词与实际行为不一致**，导致 AI 产生错误格式的工具调用。

## 当前状态分析

经过代码审查，发现以下现状：

### 已实现但提示词未充分说明
- `convertBlockObjToDsl` 函数已存在（L535-582），能将 JSON 对象转为 DSL 文本
- `addScript`/`executeOperations` 已有类型校验和自动转换（L1492-1503, L1851-1862）
- `getSpriteScripts` 工具已实现（L1081-1146）并已注册到 TOOLS（L916-929）和 toolList（L456）
- `modify_input` 已处理 SUBSTACK/SUBSTACK2 的 `shadow: null`（L1992-1996）
- `tokenizeArgs` 已支持双引号字符串、`$变量`、`@列表`、`(opcode args)` 嵌套报告块

### 存在的缺陷
1. **dslSyntax 开头无醒目格式警告**：仅有一行 "(NOT JSON)"，不够强势，AI 仍会传 JSON 对象
2. **tokenizeArgs 不支持转义引号**：`\"` 会被当作字符串结束符，导致含引号的字符串解析错误（round-trip bug：`convertBlockObjToDsl` 输出 `\"` 但 `tokenizeArgs` 无法解析）
3. **modify_input 不接受 DSL 文本**：仅接受对象/数字/字符串标量，AI 无法用文本格式传入 SUBSTACK 脚本链
4. **modify_input 未设置 parent**：构建 SUBSTACK 块链时，首块的 parent 未设为被修改的 C 块
5. **getSpriteScripts 报告块输出不完整**：嵌套报告块仅输出 `(opcode)`，丢失参数（L1109）
6. **提示词缺少 modify_input 用法文档**：AI 不知道如何操作 SUBSTACK
7. **错误信息未包含实际接收值**：仅说 "No script provided"，未告诉 AI 它传了什么类型

## 修改方案

### 修改 1：强化 dslSyntax 格式警告（ai-assistant.js L487-489）

在 `dslSyntax` 数组开头添加 3 行醒目的粗体警告：

```javascript
var dslSyntax = [
  '## Scratch DSL Syntax',
  '**CRITICAL: The "script" parameter MUST be a plain text string, NOT a JSON object.**',
  '**WRONG: {"script": {"opcode":"event_whenflagclicked","next":{...}}} — this will FAIL.**',
  '**RIGHT: {"script": "event_whenflagclicked\\n  motion_movesteps 10"} — DSL text with \\n for newlines.**',
  '',
  'Write Scratch scripts as code-like text (NOT JSON). Rules:',
  // ... 其余不变
```

### 修改 2：新增 modify_input 用法文档（ai-assistant.js，在 rules 之后插入）

在 `baseSections` 组装前，新增 `modifyInputGuide` 变量并插入到 `rules` 与 `opcodeRef` 之间：

```javascript
var modifyInputGuide = [
  '## modify_input Usage (inside executeOperations)',
  'Modify an existing block\'s input. The `value` field accepts multiple formats:',
  '',
  '### Scalar inputs (numbers, strings, booleans)',
  '```json',
  '{"type":"modify_input","targetId":"b1","inputName":"STEPS","value":10}',
  '{"type":"modify_input","targetId":"b2","inputName":"MESSAGE","value":"Hello"}',
  '```',
  '',
  '### Reporter block input (pass as object)',
  '```json',
  '{"type":"modify_input","targetId":"b3","inputName":"OPERAND1","value":{"opcode":"operator_random","inputs":{"FROM":1,"TO":10}}}',
  '```',
  '',
  '### SUBSTACK / SUBSTACK2 input (pass as DSL text string)',
  'To replace the body of a C-block (if/forever/repeat), pass DSL text with 2-space indentation:',
  '```json',
  '{"type":"modify_input","targetId":"b4","inputName":"SUBSTACK","value":"motion_movesteps 10\\n  looks_say \\"Hi\\""}',
  '```',
  'For the else branch of control_if_else, use inputName="SUBSTACK2".',
  '',
  '### Variable / List input',
  '```json',
  '{"type":"modify_input","targetId":"b5","inputName":"VALUE","value":{"VARIABLE":"score"}}',
  '{"type":"modify_input","targetId":"b6","inputName":"ITEM","value":{"LIST":"items"}}',
  '```'
].join('\n');
```

修改 `baseSections` 组装：
```javascript
var baseSections = '\n\n' + toolList + '\n\n' + dslSyntax + '\n\n' + rules + '\n\n' + modifyInputGuide + '\n\n' + opcodeRef;
```

### 修改 3：新增 rules 7-9（ai-assistant.js L574-582）

在 `rules` 数组末尾添加 3 条规则：

```javascript
'7. **modify_input SUBSTACK**: To modify a C-block body, pass inputName="SUBSTACK" and value=<DSL text string>. For else branch use inputName="SUBSTACK2". Example: {"type":"modify_input","targetId":"b1","inputName":"SUBSTACK","value":"motion_movesteps 10\\n  looks_say \\"Hi\\""}.',
'8. **View before modify**: Use getSpriteScripts(spriteName) to view existing scripts BEFORE modifying them. You need the blockId from the result to target specific blocks with modify_input or delete_block.',
'9. **Format rule**: ALWAYS pass "script" as a DSL text string (e.g. "event_whenflagclicked\\n  motion_movesteps 10"). NEVER pass a JSON object like {"opcode":"...","next":{...}}. If you pass an object, the system will auto-convert it, but this may lose information — always use text.'
```

### 修改 4：修复 tokenizeArgs 转义引号（desktop-hoc.jsx L384-395）

当前代码 `while (i < n && s[i] !== '"')` 无法处理字符串内的 `\"`。修改为支持反斜杠转义：

```javascript
    if (ch === '"') {
      i++; // skip opening quote
      let str = '';
      while (i < n) {
        if (s[i] === '\\' && i + 1 < n && (s[i+1] === '"' || s[i+1] === '\\')) {
          str += s[i+1]; // unescape \" → " and \\ → \
          i += 2;
          continue;
        }
        if (s[i] === '"') break;
        str += s[i];
        i++;
      }
      if (i >= n) {
        throw new Error('Unclosed string literal: "' + str + '"');
      }
      i++; // skip closing quote
      args.push(str);
    }
```

### 修改 5：modify_input 支持 DSL 文本（desktop-hoc.jsx L1950-2019）

在 `modify_input` case 中，在现有 `typeof value === 'object'` 分支之前，新增对字符串值的 SUBSTACK 处理。同时为对象格式 SUBSTACK 补设 parent。

新增辅助逻辑（在 `} else if (typeof value === 'number')` 之前插入）：

```javascript
                        // DSL text string for SUBSTACK/SUBSTACK2: parse and build chain
                        if (typeof value === 'string' && (inputName === 'SUBSTACK' || inputName === 'SUBSTACK2')) {
                          deleteOldShadow();
                          let parsedSub;
                          try {
                            parsedSub = parseScratchDSL(value, target);
                          } catch (parseErr) {
                            opResults.push({ index: opIdx, type: 'modify_input', success: false, error: 'SUBSTACK DSL parse error: ' + (parseErr.message || String(parseErr)) + '\nText (first 300 chars): ' + value.substring(0, 300) });
                            break;
                          }
                          const subAllBlocks = [];
                          let subFirstId = null;
                          let subPrevId = null;
                          parsedSub.blocks.forEach(function(blk) {
                            const subId = buildBlockStructure(blk, target, subAllBlocks);
                            if (subId) {
                              const subDef = subAllBlocks.find(function(ab) { return ab.id === subId; });
                              if (subDef) subDef.parent = subPrevId || blockId;
                              if (!subFirstId) subFirstId = subId;
                              if (subPrevId) {
                                const prevDef = subAllBlocks.find(function(ab) { return ab.id === subPrevId; });
                                if (prevDef) prevDef.next = subId;
                              }
                              subPrevId = subId;
                            }
                          });
                          if (subFirstId) {
                            subAllBlocks.forEach(function(b) { target.blocks.createBlock(b); });
                            block.inputs[inputName] = { name: inputName, block: subFirstId, shadow: null };
                          } else {
                            opResults.push({ index: opIdx, type: 'modify_input', success: false, error: 'SUBSTACK DSL produced no blocks. Text was: ' + value.substring(0, 200) });
                            break;
                          }
                        } else if (value && typeof value === 'object' && value.opcode && (inputName === 'SUBSTACK' || inputName === 'SUBSTACK2')) {
                          // Object format for SUBSTACK: build chain and set parent
                          deleteOldShadow();
                          const subAllBlocks = [];
                          const reporterId = buildBlockStructure(value, target, subAllBlocks);
                          if (reporterId) {
                            const firstDef = subAllBlocks.find(function(ab) { return ab.id === reporterId; });
                            if (firstDef) firstDef.parent = blockId;
                            subAllBlocks.forEach(function(b) { target.blocks.createBlock(b); });
                            block.inputs[inputName] = { name: inputName, block: reporterId, shadow: null };
                          }
                        } else if (typeof value === 'number') {
                          // ... 现有代码不变
```

注意：需要将现有的 `} else if (value && typeof value === 'object' && value.opcode) {` 分支限定为非 SUBSTACK 情况（因为 SUBSTACK 已由上面的分支处理）。即改为：
```javascript
                        } else if (value && typeof value === 'object' && value.opcode && inputName !== 'SUBSTACK' && inputName !== 'SUBSTACK2') {
```

### 修改 6：改进 getSpriteScripts 报告块输出（desktop-hoc.jsx L1108-1110）

当前嵌套报告块仅输出 `(opcode)`，丢失参数。修改为递归输出完整参数：

```javascript
                            } else {
                              // Recursively emit reporter args
                              var subParts = [sub.opcode];
                              if (sub.inputs) {
                                Object.keys(sub.inputs).forEach(function(iKey) {
                                  if (iKey === 'SUBSTACK' || iKey === 'SUBSTACK2') return;
                                  var iInp = sub.inputs[iKey];
                                  if (iInp && iInp.block) {
                                    var iSub = allBlocks[iInp.block];
                                    if (iSub) {
                                      if (iSub.opcode === 'math_number') subParts.push(String(iSub.fields.NUM.value));
                                      else if (iSub.opcode === 'text') subParts.push('"' + String(iSub.fields.TEXT.value).replace(/"/g, '\\"') + '"');
                                      else if (iSub.opcode === 'data_variable') subParts.push('$' + iSub.fields.VARIABLE.value);
                                      else if (iSub.opcode === 'data_listcontents') subParts.push('@' + iSub.fields.LIST.value);
                                      else subParts.push('(' + iSub.opcode + ')');
                                    }
                                  }
                                });
                              }
                              if (sub.fields) {
                                Object.keys(sub.fields).forEach(function(fKey) {
                                  if (fKey === 'VARIABLE') { subParts.push('$' + sub.fields[fKey].value); return; }
                                  if (fKey === 'LIST') { subParts.push('@' + sub.fields[fKey].value); return; }
                                  var ffv = sub.fields[fKey];
                                  if (ffv && typeof ffv === 'object') ffv = ffv.value;
                                  if (ffv != null) subParts.push('"' + String(ffv) + '"');
                                });
                              }
                              parts.push('(' + subParts.join(' ') + ')');
                            }
```

### 修改 7：增强错误信息包含实际接收值（desktop-hoc.jsx）

在 `addScript` 和 `executeOperations` 的 `add_script` 错误分支中，附加实际接收到的类型和预览。

**addScript (L1493)**：
```javascript
if (!scriptText) { result = { success: false, error: 'No script provided. You passed: ' + JSON.stringify(params).substring(0, 200) + '. The "script" parameter MUST be a DSL text string like "event_whenflagclicked\\n  motion_movesteps 10", NOT a JSON object.' }; break; }
```

**executeOperations add_script (L1852)**：
```javascript
if (!scriptText) { opResults.push({ index: opIdx, type: 'add_script', success: false, error: 'No script provided. You passed: ' + JSON.stringify(op).substring(0, 200) + '. The "script" field MUST be a DSL text string like "event_whenflagclicked\\n  motion_movesteps 10", NOT a JSON object.' }); break; }
```

## 假设与决策

1. **统一为文本格式为主**：DSL 文本是唯一推荐格式，JSON 对象仅作为兼容后备（自动转换）。提示词明确强调文本格式。
2. **modify_input 双格式支持**：SUBSTACK 既接受 DSL 文本字符串（推荐），也接受 JSON 对象（兼容）。这满足用户"允许混用对象和文本"的要求。
3. **不修改 OPCODE_SCHEMA**：现有 schema 已足够，问题在提示词而非数据。
4. **不修改 lenientFixJsonStrings**：该函数处理 JSON 字符串内的裸换行符，与 DSL 解析无关，保持现状。
5. **getSpriteScripts 递归深度**：报告块参数递归输出，但不递归嵌套报告块的嵌套（即只展开一层），避免过度复杂。若需要更深嵌套，后续可扩展。

## 验证步骤

1. 对两个文件运行 `GetDiagnostics` 检查语法错误
2. 运行 webpack 编译验证构建通过
3. 更新开发日志 `.trae/developlog/log.md`，记录本次修改的时间、内容、文件
4. 启动 Electron 测试：
   - 让 AI 生成一个含 if/else 的完整脚本（验证文本格式）
   - 让 AI 故意传 JSON 对象格式（验证自动转换+警告）
   - 让 AI 用 modify_input 修改 SUBSTACK（验证新功能）
   - 让 AI 用 getSpriteScripts 查看脚本（验证输出完整性）

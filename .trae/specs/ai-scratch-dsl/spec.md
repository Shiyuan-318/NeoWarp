# AI Scratch 积木 DSL 编写方案 Spec

## Why
当前 AI 助手编写 Scratch 积木时必须输出 JSON 对象数组（`blocks` 参数），每个积木需写 `{opcode, inputs, fields}` 结构。这导致三个问题：
1. **Token 消耗大**：大量花括号、引号、键名（`opcode`、`inputs`、`fields`）占用 token，一个简单的"移动10步并说Hello"脚本需 ~100 字符的 JSON。
2. **AI 编写困难**：AI 需区分 `inputs` 与 `fields`、记住 `SUBSTACK`/`SUBSTACK2` 键名、处理菜单阴影积木（menu shadow），容易出错。
3. **嵌套结构不直观**：C 型积木（if/forever/repeat）的子堆栈在 JSON 中用 `substack` 数组表示，深层嵌套时 JSON 层级混乱，AI 难以正确生成。

通过引入一种类代码的 DSL（Domain-Specific Language），让 AI 像写 Python 一样用缩进表示嵌套、每行一个积木，可显著降低 token 消耗（预计节省 50%+）、提升生成正确率。

## What Changes
- **新增 Scratch 积木 DSL 解析器**：在 `desktop-hoc.jsx` 中实现 `parseScratchDSL(scriptText, target)` 函数，将 DSL 文本转换为现有的 block descriptor 格式（`{opcode, inputs, fields, substack}`），复用已有的 `buildBlockStructure` 逻辑。
- **修改 `addScript` 工具**：`blocks` 参数（array）改为 `script` 参数（string），接受 DSL 文本。**BREAKING**：工具签名变更，但 AI 是唯一消费者，同步更新系统提示词即可。
- **修改 `executeOperations` 工具**：`add_script` 操作的 `script` 字段改为接受 DSL 文本（而非单个 block descriptor 对象）。
- **更新系统提示词**：在 `buildSystemPrompt()` 中用 DSL 语法说明和示例替换现有的 JSON 格式说明，大幅简化 opcode 参考表（加入参数顺序）。
- **新增 opcode schema 注册表**：在解析器中维护核心 opcode 的参数 schema（参数名、类型：input/field、顺序），用于将 DSL 的位置参数映射到正确的 input/field 名。

## Impact
- Affected code:
  - `src-renderer-webpack/editor/gui/desktop-hoc.jsx` — 新增 `parseScratchDSL()` 解析器及 opcode schema；修改 `addScript` 和 `executeOperations` 的 case 分支以调用解析器
  - `src-renderer/ai-assistant/ai-assistant.js` — 修改 `TOOLS` 数组中 `addScript` 和 `executeOperations` 的参数声明；修改 `buildSystemPrompt()` 中的工具说明和 opcode 参考表
- 不受影响：现有的 `buildBlockStructure`、`createShadowBlock`、`buildSubstackChain` 辅助函数保持不变，解析器输出格式与它们兼容。

## DSL 语法规范

### 基本格式
```
<hat_opcode> [args...]
  <opcode> [args...]
  <opcode> [args...]
  <c_block_opcode> [args...]
    <opcode> [args...]
    <opcode> [args...]
  <opcode> [args...]
```

### 规则
1. **每行一个积木**：格式为 `opcode arg1 arg2 ...`，参数以空格分隔。
2. **缩进表示嵌套**：2 个空格为一级缩进。缩进级数大于上一行的积木，归入上一行 C 型积木的 SUBSTACK。
3. **帽子积木**：第一行（缩进级 0）为帽子积木。若省略帽子积木，默认使用 `event_whenflagclicked`。
4. **else 关键字**：对于 `control_if_else`，在 if 体结束后用 `else`（与 `control_if_else` 同级缩进）分隔 SUBSTACK2。
5. **参数类型**：
   - 数字：`10`、`-5`、`3.14`（裸写）
   - 字符串：`"Hello!"`（双引号包裹）
   - 变量：`$varName`（美元符号前缀，解析为 `data_variable` 报告块）
   - 列表：`@listName`（@ 符号前缀，解析为 `data_listcontents` 报告块）
   - 嵌套报告块：`(opcode args...)`（圆括号包裹，如 `(operator_add 5 10)`）
   - 布尔报告块：同嵌套报告块语法，如 `(operator_equals $x 0)`
6. **注释**：以 `#` 开头的行为注释，解析时忽略。
7. **空行**：忽略。

### 示例

**简单脚本：**
```
event_whenflagclicked
  motion_movesteps 10
  looks_say "Hello World"
  control_wait 1
```
等价 JSON：
```json
{"hat":"event_whenflagclicked","blocks":[
  {"opcode":"motion_movesteps","inputs":{"STEPS":10}},
  {"opcode":"looks_say","inputs":{"MESSAGE":"Hello World"}},
  {"opcode":"control_wait","inputs":{"DURATION":1}}
]}
```

**带条件和循环：**
```
event_whenflagclicked
  control_if operator_equals $score 10
    looks_say "You win!"
    control_stop all
  control_forever
    motion_turnright 15
    control_wait 0.5
```

**if-else：**
```
event_whenflagclicked
  control_if_else operator_gt $lives 0
    looks_say "Still alive!"
  else
    looks_say "Game over!"
    control_stop all
```

**嵌套报告块：**
```
event_whenflagclicked
  motion_movesteps operator_random 1 10
  data_setvariableto $counter operator_add $counter 1
  looks_say operator_join "Score: " $score
```

**变量与列表操作：**
```
event_whenflagclicked
  data_setvariableto $counter 0
  data_addtolist @myList "first item"
  looks_say data_itemoflist @myList 1
```

## ADDED Requirements

### Requirement: Scratch DSL 解析器
系统 SHALL 在 `desktop-hoc.jsx` 中实现 `parseScratchDSL(scriptText, target)` 函数，将 DSL 文本转换为 block descriptor 数组，格式与现有 `buildBlockStructure` 的输入兼容。

#### 解析器行为
- 按 `\n` 分割行，去除空行和注释行（`#` 开头）
- 计算每行缩进级数（空格数 / 2）
- 构建缩进树：缩进级 > 上一行的行归入上一行 C 型积木的 SUBSTACK
- 对每行的 `opcode args` 进行词法分析：识别数字、字符串、变量（`$`）、列表（`@`）、嵌套报告块（`()`）
- 查询 opcode schema 将位置参数映射到 input/field 名
- 处理 `else` 关键字：标记 `control_if_else` 的 SUBSTACK2

#### Opcode Schema
解析器 SHALL 维护一个 opcode schema 注册表，记录每个 opcode 的：
- 参数列表（按视觉顺序），每项含 `name`、`kind`（`input` 或 `field`）
- 是否有 SUBSTACK（`substack: true`）
- 是否有 SUBSTACK2（`substack2: true`）

注册表 SHALL 覆盖以下分类的核心 opcode：
- Motion（motion_movesteps, motion_turnright, motion_turnleft, motion_goto, motion_glideto, motion_pointindirection, motion_pointtowards, motion_changexby, motion_setx, motion_changeyby, motion_sety, motion_ifonedgebounce, motion_setrotationstyle）
- Looks（looks_say, looks_sayforsecs, looks_think, looks_thinkforsecs, looks_switchcostumeto, looks_nextcostume, looks_switchbackdropto, looks_nextbackdrop, looks_changesizeby, looks_setsizeto, looks_changeeffectby, looks_seteffectto, looks_cleargraphiceffects, looks_show, looks_hide, looks_gotofrontback, looks_goforwardbackwardlayers）
- Sound（sound_play, sound_playuntildone, sound_stopallsounds, sound_setvolumeto, sound_changevolumeby）
- Control（control_wait, control_wait_until, control_repeat, control_forever, control_if, control_if_else, control_repeat_until, control_stop, control_create_clone_of, control_delete_this_clone, control_start_as_clone）
- Sensing（sensing_touchingobject, sensing_touchingcolor, sensing_distanceto, sensing_askandwait, sensing_keypressed, sensing_mousedown, sensing_mousex, sensing_mousey, sensing_loudness, sensing_timer, sensing_resettimer, sensing_of, sensing_current）
- Operators（operator_add, operator_subtract, operator_multiply, operator_divide, operator_random, operator_gt, operator_lt, operator_equals, operator_and, operator_or, operator_not, operator_join, operator_letter_of, operator_length, operator_contains, operator_round, operator_mathop）
- Data（data_setvariableto, data_changevariableby, data_showvariable, data_hidevariable, data_addtolist, data_deleteoflist, data_deletealloflist, data_insertatlist, data_replaceitemoflist, data_itemoflist, data_itemnumoflist, data_lengthoflist, data_listcontainsitem）
- Events（event_whenflagclicked, event_whenkeypressed, event_whenthisspriteclicked, event_whenbackdropswitchesto, event_whenbroadcastreceived, event_broadcast, event_broadcastandwait）

对于未在注册表中的 opcode（如扩展积木），解析器 SHALL 将所有位置参数视为 input，使用 `ARG1`、`ARG2`、... 作为 input 名。

#### Scenario: 解析简单脚本
- **GIVEN** DSL 文本：
  ```
  event_whenflagclicked
    motion_movesteps 10
    looks_say "Hello"
  ```
- **WHEN** 调用 `parseScratchDSL`
- **THEN** 返回 hat descriptor `{opcode:"event_whenflagclicked", inputs:{}, fields:{}}` 和 blocks 数组 `[{opcode:"motion_movesteps",inputs:{STEPS:10},fields:{}},{opcode:"looks_say",inputs:{MESSAGE:"Hello"},fields:{}}]`

#### Scenario: 解析 C 型积木嵌套
- **GIVEN** DSL 文本：
  ```
  event_whenflagclicked
    control_forever
      motion_turnright 15
  ```
- **WHEN** 调用 `parseScratchDSL`
- **THEN** 返回 blocks 数组含一个 `{opcode:"control_forever", inputs:{}, fields:{}, substack:[{opcode:"motion_turnright",inputs:{DEGREES:15},fields:{}}]}`

#### Scenario: 解析 if-else
- **GIVEN** DSL 文本含 `control_if_else` 和 `else` 关键字
- **WHEN** 调用 `parseScratchDSL`
- **THEN** `else` 之前的缩进行归入 `substack`，之后的归入 `substack2`

#### Scenario: 解析嵌套报告块
- **GIVEN** DSL 行 `motion_movesteps (operator_random 1 10)`
- **WHEN** 调用 `parseScratchDSL`
- **THEN** 返回 `{opcode:"motion_movesteps", inputs:{STEPS:{opcode:"operator_random",inputs:{FROM:1,TO:10},fields:{}}}, fields:{}}`

#### Scenario: 解析变量引用
- **GIVEN** DSL 行 `data_setvariableto $counter 5`
- **WHEN** 调用 `parseScratchDSL`
- **THEN** 返回 `{opcode:"data_setvariableto", inputs:{VALUE:5}, fields:{VARIABLE:"counter"}}`

#### Scenario: 未知 opcode 回退
- **GIVEN** DSL 行 `custom_extension_block "text" 42`
- **WHEN** 该 opcode 不在 schema 注册表中
- **THEN** 返回 `{opcode:"custom_extension_block", inputs:{ARG1:"text", ARG2:42}, fields:{}}`

### Requirement: addScript 工具接受 DSL 文本
`addScript` 工具 SHALL 将 `blocks` 参数替换为 `script` 参数（string），接受 DSL 格式的脚本文本。

#### Scenario: AI 使用 DSL 添加脚本
- **WHEN** AI 调用 `addScript(spriteName="Sprite1", script="event_whenflagclicked\n  motion_movesteps 10\n  looks_say \"Hello\"")`
- **THEN** 解析器将 DSL 转换为 block descriptors
- **AND** 调用 `buildBlockStructure` 构建 Scratch VM 积木
- **AND** 积木添加到指定精灵，工作区刷新

#### Scenario: 帽子积木自动识别
- **WHEN** DSL 第一行为 `event_whenkeypressed space`
- **THEN** 解析器识别 `event_whenkeypressed` 为帽子积木，`space` 映射到 `KEY_OPTION` field
- **AND** 构建正确的帽子积木

### Requirement: executeOperations 的 add_script 接受 DSL
`executeOperations` 的 `add_script` 操作 SHALL 接受 `script` 字段为 DSL 文本字符串（而非 block descriptor 对象）。

#### Scenario: 批量操作中使用 DSL
- **WHEN** AI 调用 `executeOperations(operations=[{type:"add_script", sprite:"Sprite1", script:"event_whenflagclicked\n  motion_movesteps 10"}])`
- **THEN** 解析 DSL 并添加脚本到 Sprite1

## MODIFIED Requirements

### Requirement: addScript 工具声明
`TOOLS` 数组中 `addScript` 的参数 SHALL 变更为：
- `spriteName`（string, required）：精灵名或 "Stage"
- `script`（string, required）：DSL 格式的脚本文本。第一行为帽子积木，后续行为脚本体（2空格缩进表示嵌套）
- 删除 `hat`、`blocks`、`hatKey`、`hatMessage`、`hatBackdrop` 参数（帽子积木在 DSL 首行指定）

### Requirement: executeOperations 工具声明
`executeOperations` 的 `operations` 描述 SHALL 更新 `add_script` 操作的 `script` 字段说明为"DSL 格式的脚本文本字符串"。

### Requirement: buildSystemPrompt 工具说明
系统提示词 SHALL：
- 更新 `addScript` 的工具说明为 DSL 格式
- 用 DSL 语法说明和示例替换现有的 JSON 格式说明
- 在 opcode 参考表中为每个 opcode 标注参数顺序（如 `motion_movesteps STEPS`、`control_if CONDITION`）
- 标注哪些 opcode 是 C 型积木（含 SUBSTACK）

### Requirement: buildSystemPrompt opcode 参考表
opcode 参考表 SHALL 从纯 opcode 列表升级为"opcode + 参数名 + C型标记"格式，例如：
```
Motion: motion_movesteps(STEPS), motion_turnright(DEGREES), ...
Control: control_wait(DURATION), control_if(CONDITION)[C], control_if_else(CONDITION)[C+else], control_repeat(TIMES)[C], control_forever[C], ...
Data: data_setvariableto(VARIABLE, VALUE), data_changevariableby(VARIABLE, VALUE), data_addtolist(LIST, ITEM), ...
```
其中 `[C]` 表示有 SUBSTACK，`[C+else]` 表示有 SUBSTACK 和 SUBSTACK2。

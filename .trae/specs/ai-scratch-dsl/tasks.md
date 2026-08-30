# Tasks

- [x] Task 1: 实现 opcode schema 注册表
  - [x] SubTask 1.1: 在 `desktop-hoc.jsx` 中定义 `OPCODE_SCHEMA` 常量对象，覆盖 Motion、Looks、Sound、Control、Sensing、Operators、Data、Events 分类下所有核心 opcode。每个条目含 `args` 数组（每项 `{name, kind}`，kind 为 `input` 或 `field`，按视觉顺序排列）和可选的 `substack: true`、`substack2: true` 标记
  - [x] SubTask 1.2: 对于有菜单阴影（menu shadow）的 opcode（如 motion_goto 的 TO、sensing_keypressed 的 KEY_OPTION），在 schema 中将对应参数标记为 `kind: 'field'`（与现有 `MENU_SHADOW_OPCODES` 映射保持一致），确保解析器生成的 block descriptor 能正确触发 `buildBlockStructure` 中的菜单阴影逻辑

- [x] Task 2: 实现 DSL 词法分析器
  - [x] SubTask 2.1: 实现 `tokenizeArgs(argsStr)` 函数：从一行 DSL 文本中提取 opcode 和参数列表。支持识别：裸数字（含负数和小数）、双引号字符串（支持空格）、`$varName` 变量、`@listName` 列表、`(opcode args...)` 嵌套报告块（递归调用 tokenizeArgs）
  - [x] SubTask 2.2: 嵌套报告块 `(opcode args...)` 的解析需处理括号内引号字符串中的空格和嵌套括号，确保 `operator_join "Hello " "(operator_add 1 2)"` 等情况正确解析

- [x] Task 3: 实现 DSL 缩进树解析
  - [x] SubTask 3.1: 实现 `parseScratchDSL(scriptText, target)` 主函数：按 `\n` 分割行，去除空行和 `#` 注释行，计算每行缩进级数（前导空格数 / 2）
  - [x] SubTask 3.2: 实现缩进树构建逻辑：使用栈维护当前缩进路径。遇到比栈顶缩进更大的行，归入栈顶 C 型积木的 `substack` 数组；遇到 `else` 关键字（与栈顶 control_if_else 同级），后续行归入 `substack2`；遇到同级或更小缩进，弹出栈至同级
  - [x] SubTask 3.3: 将每个 tokenized line 的位置参数通过 `OPCODE_SCHEMA` 映射为 `{inputs, fields}` 对象。`$varName` 映射到 `{VARIABLE: "varName"}`（data_* 类积木作为 field）或 `{opcode:"data_variable",fields:{VARIABLE:"varName"}}`（作为嵌套报告块 input）；`@listName` 类似
  - [x] SubTask 3.4: 处理帽子积木：第一行（缩进 0）的 opcode 若为 hat 类（event_* 或 control_start_as_clone），作为 hat descriptor 单独返回；若第一行不是 hat，默认添加 `event_whenflagclicked` 作为 hat。hat 的参数（如 event_whenkeypressed 的 KEY_OPTION）正确映射到 fields
  - [x] SubTask 3.5: 未知 opcode 回退：当 opcode 不在 `OPCODE_SCHEMA` 中，将所有位置参数视为 input，命名为 `ARG1`、`ARG2`、...

- [x] Task 4: 修改 addScript case 分支调用 DSL 解析器
  - [x] SubTask 4.1: 在 `desktop-hoc.jsx` 的 `addScript` case 中，将 `params.blocks`（array）改为 `params.script`（string），调用 `parseScratchDSL(params.script, target)` 获取 hat descriptor 和 blocks 数组
  - [x] SubTask 4.2: 将解析器输出的 hat descriptor 用于构建帽子积木（设置 topLevel、fields 等），blocks 数组逐个调用 `buildBlockStructure` 构建并链接 next/parent
  - [x] SubTask 4.3: 错误处理：DSL 解析失败时返回 `{success: false, error: "DSL parse error: " + message}`，包含行号信息便于调试

- [x] Task 5: 修改 executeOperations 的 add_script case
  - [x] SubTask 5.1: 在 `executeOperations` 的 `add_script` case 中，将 `op.script`（原为单个 block descriptor 对象）改为接受 DSL 文本字符串，调用 `parseScratchDSL` 解析
  - [x] SubTask 5.2: 解析后调用 `buildBlockStructure` 构建积木，将首个 block 设为 topLevel 并设置随机 x/y 坐标

- [x] Task 6: 修改 TOOLS 数组中的工具声明
  - [x] SubTask 6.1: 修改 `ai-assistant.js` 中 `addScript` 工具声明：删除 `hat`、`blocks`、`hatKey`、`hatMessage`、`hatBackdrop` 参数，新增 `script` 参数（type: string, required），description 说明为"DSL format script text. First line is the hat block, subsequent lines are script body (2-space indent for nesting). Example: 'event_whenflagclicked\\n  motion_movesteps 10\\n  looks_say \"Hello\"'"
  - [x] SubTask 6.2: 修改 `executeOperations` 工具声明中 operations 描述：将 `add_script` 操作的 `script` 字段说明改为"DSL format script text string"

- [x] Task 7: 修改 buildSystemPrompt 系统提示词
  - [x] SubTask 7.1: 在 `buildSystemPrompt()` 的 toolList 中，更新 `addScript` 的说明为 DSL 格式，附简要语法说明和示例
  - [x] SubTask 7.2: 新增 "## Scratch DSL Syntax" 章节，放在 opcode 参考表之前，说明 DSL 规则（每行一个积木、2空格缩进嵌套、参数类型：数字裸写/字符串引号/$变量/@列表/(嵌套报告块)、else 关键字、# 注释）和 3-4 个示例
  - [x] SubTask 7.3: 将 opcode 参考表从纯 opcode 列表升级为"opcode(PARAM1, PARAM2)[C]"格式，标注参数顺序和 C 型积木标记。如 `Control: control_wait(DURATION), control_if(CONDITION)[C], control_if_else(CONDITION)[C+else], control_repeat(TIMES)[C], control_forever[C], control_repeat_until(CONDITION)[C]`
  - [x] SubTask 7.4: 删除 rules 中关于 JSON block 格式的旧说明（"Blocks: opcode, next, parent, inputs, fields, shadow, topLevel, x, y."），替换为指向 DSL 语法的说明

# Task Dependencies
- Task 2 依赖 Task 1（词法分析器需要查询 opcode schema 确定参数类型）
- Task 3 依赖 Task 1 和 Task 2（缩进树解析需要词法分析器和 opcode schema）
- Task 4 和 Task 5 依赖 Task 3（需要 parseScratchDSL 函数）
- Task 6 和 Task 7 可并行执行，但 Task 7 的 SubTask 7.1 依赖 Task 6 的 SubTask 6.1（工具声明与提示词一致）
- Task 1、Task 2、Task 3 为串行依赖链；Task 6、Task 7 可与 Task 1-5 并行

# AI 助手逻辑与 UI 大幅重构 Spec

## Why
当前 AI 助手（实际生效文件为 `src-renderer/ai-assistant/ai-assistant.html`，旧的 `.js` 文件已废弃不再加载）存在以下痛点：上下文按"消息条数"截断（默认 20 条）而非按模型真实 Token 上限管理，长任务易丢失关键信息且无使用量可见；`max_tokens` 被硬编码为 65536，部分模型会直接报 `Error: Param Incorrect`；`tool_calls` 消息在历史切片时其配对的 `tool` 结果可能被切掉，触发 `An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'` 报错；待办清单（`plan_todos`/`update_todo`）为扁平列表，无分步折叠与完成耗时反馈；输入框无毛玻璃质感、不支持文件附件；思考强度被写死为 `high`，用户无法调节。本次重构统一解决以上问题，使 AI 助手在上下文管理、任务编排可视化、输入交互、文件输入与稳定性上达到一线体验。

## What Changes
- **上下文按模型 Token 上限管理**：为 `PROVIDERS` 各模型新增 `contextLimit`（Token 上限），默认使用模型最大上下文；发送前基于 Token 估算进行智能压缩，并在每条 AI 回复底部显示"上下文使用 X% · 已用/上限 Token"。
- **待办清单改为分步折叠样式**：`plan_todos` 渲染为"每一步一个可折叠下拉（details/summary 风格）"，步骤进行中自动展开、完成后自动折叠该步骤。
- **任务完成后折叠过程并显示耗时**：当一张待办清单全部完成时，折叠其下所有编写过程（工具调用、推理、中间结果），仅保留清单与"总耗时"摘要。
- **输入框圆角毛玻璃 + 自适应增高**：输入框改为圆角矩形并叠加毛玻璃效果，随文本行数自动增高（已有 `autoResize`，需校验上限与平滑过渡）。
- **新增文件附件**：支持给 AI 添加 `md`/`txt`/`pdf`/`csv` 文件，提取文本内容随消息发送。
- **新增思考模式拖动轴**：输入框底部新增思考强度选择，拖动轴分"低/中/高/最高"四档，达到"最高"时拖动轴呈现粒子效果（参考 Claude Code），并据此设置各 provider 的 `reasoning_effort`/`thinking`。
- **修复长输出与 tool_calls 报错**：按模型实际上限动态设置 `max_tokens`；在历史切片时保证 `assistant.tool_calls` 与其全部 `tool` 结果成对保留或成对丢弃，消除 `insufficient tool messages following tool_calls` 报错。

## Impact
- Affected specs: `optimize-ai-tools`（上下文/历史管理逻辑被本 spec 取代为 Token 级管理）、`fix-ai-tool-bugs`（无冲突，其工具修复保留）。
- Affected code（全部集中在生效文件 `src-renderer/ai-assistant/ai-assistant.html`）：
  - `PROVIDERS`（~2439 行）：为每个模型追加 `contextLimit`。
  - `TOOLS` 中 `plan_todos` / `update_todo`（~2888-2922 行）描述微调以引导分步执行。
  - `createTodoCard` / `updateTodoCard`（~4058 行起）：重写为分步折叠卡片 + 完成折叠 + 耗时。
  - `buildApiMessages`（~4683 行）：改为 Token 级上下文管理 + `tool_calls`/`tool` 成对一致性保证。
  - `runConversationLoop` 请求体构造（~4584-4595 行）：`max_tokens` 动态化、思考强度按用户档位设置。
  - 输入区 HTML/CSS（~1101 行 `.input-area`、~2357 行 `<div class="input-area">`）：毛玻璃 + 文件上传按钮 + 思考拖动轴。
  - 新增：Token 估算函数、文件解析（md/txt/csv 直读文本，pdf 用 pdf.js 或主进程解析）、思考档位粒子效果。

## ADDED Requirements

### Requirement: 模型上下文上限配置
系统 SHALL 在 `PROVIDERS` 中为每个模型对象新增 `contextLimit` 字段（单位：Token，整数），表示该模型的最大上下文窗口。默认值即模型最大上下文。实现时 SHALL 联网核实各模型当前真实上限并填入，已知参考值（需联网核实）：
- OpenAI `gpt-5.x` 系列、DeepSeek `deepseek-v4-*`、GLM `glm-5.x`、Kimi `kimi-k3`（≈100K）、`kimi-k2.7-code`/`kimi-k2.6`、MiMo `mimo-v2.5*`（≈1M）、Qwen `qwen3.x`、华为 `pangu-2.0-*`、Custom。
- `custom` 提供商模型 SHALL 允许用户在设置中手动填写 `contextLimit`。

#### Scenario: 默认使用模型最大上下文
- **GIVEN** 用户选中 Kimi K3（`contextLimit` 标注为 100000）
- **WHEN** 发送消息
- **THEN** 系统按 100000 Token 上限管理上下文，不使用固定 20 条消息截断

#### Scenario: Custom 模型可填上下文上限
- **WHEN** 用户在设置中编辑 Custom 模型
- **THEN** 表单包含"上下文上限（Token）"字段，默认 32000，可修改并持久化

### Requirement: Token 级上下文管理与压缩
系统 SHALL 用 Token 估算（字符数近似或轻量分词）替代"消息条数"截断：
- 组装 `apiMessages` 时，从最新消息向前累加 Token 估算值，直到累计达到 `contextLimit * 0.8`（留 20% 余量给系统提示词与回复）即停止，更早的消息被丢弃。
- **当累计 Token 达到 `contextLimit * 0.8` 仍需保留更多上下文时**，触发压缩：将较早的成对 `user`/`assistant` 文本消息合并为一条"历史摘要"（保留要点与关键决策），工具调用结果按现有逻辑截断至 4000 字符。
- 压缩 SHALL 保证 `assistant.tool_calls` 与其全部 `tool` 结果成对保留或成对丢弃，绝不出现"有 tool_calls 无对应 tool 结果"的残缺序列。

#### Scenario: 上下文未超限时保留全部历史
- **GIVEN** 累计 Token 远低于 `contextLimit * 0.8`
- **WHEN** 组装请求
- **THEN** `apiMessages` 包含 `chatHistory` 全部消息

#### Scenario: 上下文接近上限时压缩
- **GIVEN** 累计 Token 超过 `contextLimit * 0.8`
- **WHEN** 组装请求
- **THEN** 较早的文本消息被合并为历史摘要
- **AND** 任意 `assistant.tool_calls` 与其全部 `tool` 结果要么整体保留、要么整体丢弃
- **AND** 不抛出 `insufficient tool messages following tool_calls` 错误

### Requirement: 上下文使用量展示
系统 SHALL 在每条 AI 回复消息气泡底部显示当前上下文使用情况，格式为"上下文 · 已用 X / Y Token（Z%）"，其中 Y 为当前模型 `contextLimit`，X 为本次请求 `apiMessages` 的 Token 估算总量。
- 使用量以次要文字色（`--text-tertiary`）小字号呈现，不干扰正文。
- 当 Z ≥ 80% 时以警告色（橙/红）高亮百分比。

#### Scenario: 显示使用量
- **WHEN** AI 完成一条回复
- **THEN** 该消息气泡底部显示"上下文 · 已用 12500 / 100000 Token（12%）"

#### Scenario: 接近上限高亮
- **WHEN** Z ≥ 80%
- **THEN** 百分比以警告色显示

### Requirement: 待办清单分步折叠样式
系统 SHALL 重写 `plan_todos` 渲染逻辑：清单中每一个步骤为一个可折叠区块（`<details>`/`<summary>` 语义或等效自定义结构），区块标题显示步骤序号、标题与状态图标。
- 步骤进入 `doing` 时自动展开该步骤区块，并将后续相关工具调用 / AI 输出归入该步骤区块内展示。
- 步骤变为 `done` 时自动折叠该步骤区块（仅保留标题与完成状态）。
- 清单顶部保留总进度条与"X/Y"计数。

#### Scenario: 步骤进行中自动展开
- **WHEN** `update_todo(index=2, status='doing')` 被调用
- **THEN** 第 2 步区块展开，状态图标显示进行中旋转动画

#### Scenario: 步骤完成自动折叠
- **WHEN** `update_todo(index=2, status='done')` 被调用
- **THEN** 第 2 步区块自动折叠为标题行，状态图标变为完成勾选

### Requirement: 任务完成折叠过程并显示耗时
系统 SHALL 在一张待办清单全部步骤完成（所有 `done`）时：
- 折叠该清单下方所有"编写过程"（工具调用卡片、推理框、工具结果、生成指示器等中间过程节点）。
- 在清单卡片上显示"总耗时 · mm:ss"，从清单创建到全部完成的时间差。
- 保留清单卡片本身与最终 AI 回复可见。

#### Scenario: 全部完成折叠过程
- **GIVEN** 清单共 3 步且第 3 步标记为 `done`
- **WHEN** `update_todo(index=3, status='done')` 触发"全部完成"
- **THEN** 清单下方的工具调用/推理/结果节点被折叠隐藏
- **AND** 清单卡片显示"总耗时 · 01:23"

### Requirement: 输入框圆角毛玻璃自适应增高
系统 SHALL 将输入框 `.input-wrapper` 设计为圆角矩形并叠加毛玻璃效果（`backdrop-filter: saturate(180%) blur()` + 半透明背景），随文本行数自动增高：
- 最小 1 行，最大高度限制（如 40vh 或 240px），超出后内部滚动。
- 高度变化使用平滑过渡，与现有 `autoResize` 衔接。
- 浅色与暗色模式均有对应毛玻璃配色。

#### Scenario: 多行文本自动增高
- **WHEN** 用户在输入框粘贴 8 行文本
- **THEN** 输入框高度增长至容纳 8 行（不超过最大高度），毛玻璃背景透出下方内容

### Requirement: 文件附件支持
系统 SHALL 在输入区新增"添加文件"按钮，支持选择 `.md`/`.txt`/`.pdf`/`.csv` 文件：
- `md`/`txt`/`csv`：直接读取文本内容。
- `pdf`：通过 `pdf.js`（或主进程 IPC 解析）提取纯文本。
- 文件以预览卡片形式展示在输入框上方（复用 `image-preview-bar` 模式），可移除。
- 发送时，文件文本内容以"附件：<文件名>\n<内容>"形式拼入用户消息（多文件依次拼接，单文件内容超过上限时截断并标注）。

#### Scenario: 添加 txt 文件并发送
- **WHEN** 用户选择 `notes.txt`（内容为"Hello"）并发送"总结这个文件"
- **THEN** 用户消息内容包含"附件：notes.txt\nHello"前缀，AI 据此回复总结

#### Scenario: 添加 pdf 文件
- **WHEN** 用户选择 `report.pdf`
- **THEN** 系统提取 PDF 纯文本，作为附件内容随消息发送

### Requirement: 思考模式拖动轴
系统 SHALL 在输入框底部新增思考强度选择控件，为一根可拖动轴，档位为"低 / 中 / 高 / 最高"：
- 拖动到"最高"档时，拖动轴呈现粒子动效（沿轴流动的发光粒子，参考 Claude Code 风格）。
- 选中档位映射到请求参数：
  - OpenAI / Kimi：`reasoning_effort` 分别为 `low` / `medium` / `high` / `max`（不支持 `max` 的模型回退为 `high`）。
  - DeepSeek / MiMo：`thinking = { type: 'enabled' }`（仅"低"档为不启用，其余启用；最高档无法差异化时与高档一致）。
  - GLM / Qwen / Pangu：按其文档设置对应参数，不支持时忽略档位。
- 不支持思考的模型（`supportsReasoning: false`）SHALL 隐藏该控件。
- 档位选择持久化到当前配置。

#### Scenario: 选择最高档产生粒子效果
- **WHEN** 用户将思考轴拖到"最高"档
- **THEN** 拖动轴出现发光粒子流动动效
- **AND** 发送时请求体 `reasoning_effort` 设为 `max`（OpenAI/Kimi）

#### Scenario: 不支持思考的模型隐藏控件
- **GIVEN** 当前模型 `supportsReasoning: false`
- **THEN** 思考模式拖动轴不显示

### Requirement: 修复 max_tokens 与 tool_calls 报错
系统 SHALL：
- 按当前模型 `contextLimit` 动态设置 `max_tokens`（取 `min(contextLimit - 估算输入Token, 模型输出上限)` 的安全值，且不再硬编码 65536），避免 `Error: Param Incorrect`。
- 在 `buildApiMessages` 历史切片后做一致性校验：遍历 `apiMessages`，对每个含 `tool_calls` 的 `assistant` 消息，确认其后紧跟且仅紧跟对其每个 `tool_call_id` 的 `tool` 消息；若 `tool` 结果缺失则连同该 `assistant` 消息一并从本次请求剔除（不写入 `chatHistory`），杜绝 `insufficient tool messages following tool_calls` 报错。

#### Scenario: 模型不支持大 max_tokens
- **GIVEN** 某模型 `contextLimit` 为 32000，输入估算 8000 Token
- **WHEN** 构造请求
- **THEN** `max_tokens` 设为不超过 24000 的安全值，不触发 `Param Incorrect`

#### Scenario: 历史切片切断 tool_calls 配对
- **GIVEN** `chatHistory` 中存在 `assistant.tool_calls` + 2 条 `tool` 结果，切片后仅保留 `assistant.tool_calls` 而丢失 2 条 `tool` 结果
- **WHEN** 组装 `apiMessages`
- **THEN** 该 `assistant.tool_calls` 消息被一并剔除
- **AND** 请求成功发送，不抛出 `insufficient tool messages following tool_calls`

## MODIFIED Requirements

### Requirement: buildApiMessages 上下文组装
`buildApiMessages()` SHALL 改为基于 Token 估算从最新消息向前组装，达到 `contextLimit * 0.8` 停止；超过阈值时压缩较早消息为摘要；并保证 `tool_calls`/`tool` 成对一致性（见 ADDED Requirement: Token 级上下文管理与压缩）。原"按 `contextWindow` 消息条数切片"逻辑被取代。

### Requirement: runConversationLoop 请求体
`runConversationLoop` 请求体 SHALL：
- `max_tokens` 动态计算，不再硬编码。
- `reasoning_effort` / `thinking` 按用户思考档位选择设置，不再固定 `high`。

### Requirement: plan_todos / update_todo 工具描述
`plan_todos` 工具描述 SHALL 引导 AI"按步骤逐条执行，配合 update_todo 在开始一步时标记 doing、完成时标记 done"；`update_todo` 描述保持不变。渲染逻辑改为分步折叠（见 ADDED Requirement: 待办清单分步折叠样式）。

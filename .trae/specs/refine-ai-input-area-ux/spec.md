# AI 输入区与工具调用稳定性精修 Spec

## Why
上一轮 `redesign-ai-assistant-ux` 完成后仍存在两类问题：① 工具调用递归流程中 `buildApiMessages` 与 tool 结果入栈顺序缺陷，导致 `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'` 报错；② 输入区布局、思考模式控件、文件按钮位置、上下文展示位置需进一步向 Codex / Claude Code 风格精修。

## What Changes
- **修复 tool_calls 配对缺陷**：调整工具调用递归流程，先入栈 tool 结果再 `buildApiMessages`，消除孤儿 tool 消息
- **上下文使用量移出气泡**：移除 AI 回复气泡内的 `formatUsageFooter`，改为输入区底部细状态行展示
- **输入区布局重构（Codex/Claude Code 风格）**：增大输入框面积；发送按钮与新增"配置按钮"内嵌输入框右下角；文件按钮移至输入框左侧
- **新增配置菜单**：点击配置按钮在旁边弹出小菜单，含模型选择与思考模式（原顶部模型按钮与输入区思考控件移入菜单）
- **思考模式拖动轴重新设计**：加粗、从左到右渐变填充；最高档时渐变变为多个圆角矩形进行高级闪烁动效（替换当前粒子点动效）
- **BREAKING**：移除顶部 `modelSelectBtn` 模型按钮与输入区独立 `thinkingControl` 控件（功能并入配置菜单）

## Impact
- Affected specs: `redesign-ai-assistant-ux`（其 checklist 中"思考模式拖动轴"与"输入框"相关条目将被本 spec 修改覆盖）
- Affected code: `src-renderer/ai-assistant/ai-assistant.html`（HTML 结构、CSS、JS：`doApiCall` 工具调用处理、`buildApiMessages` 调用时机、`formatUsageFooter` 调用点、输入区事件绑定、思考轴 CSS 与动效）

## ADDED Requirements

### Requirement: 配置菜单
系统应在输入框内右下角的"配置按钮"被点击时，于按钮旁边弹出一个浮层菜单，包含模型选择入口与思考模式控件。

#### Scenario: 打开配置菜单
- **WHEN** 用户点击输入框右下角的配置按钮
- **THEN** 在配置按钮旁边（上方/右侧）弹出浮层菜单，含「模型选择」区块与「思考模式」拖动轴

#### Scenario: 关闭配置菜单
- **WHEN** 用户点击菜单外区域或再次点击配置按钮
- **THEN** 浮层菜单关闭

### Requirement: 思考模式拖动轴新视觉
系统应将思考模式拖动轴重新设计为加粗的渐变条，并在最高档呈现圆角矩形高级闪烁动效。

#### Scenario: 低/中/高档
- **WHEN** 拖动轴停留在低、中、高三档
- **THEN** 轴体加粗，填充呈从左到右的渐变色（如蓝→紫），thumb 指示当前档位

#### Scenario: 最高档高级闪烁
- **WHEN** 拖动至"最高"档
- **THEN** 渐变填充变为多个圆角矩形片段，按顺序进行高级闪烁动效（渐变流动 + 明暗交替），不再使用原粒子点动效

## MODIFIED Requirements

### Requirement: 工具调用消息配对一致性
工具调用递归流程（`doApiCall` 中 `result.type === 'tool_calls'` 分支）在调用 `buildApiMessages` 重建消息前，必须先将所有 tool 结果入栈 `chatHistory`，使 `sanitizeToolCallPairs` 能正确配对 assistant.tool_calls 与 tool 消息，避免丢弃 assistant 后产生孤儿 tool。

#### Scenario: 多轮工具调用
- **WHEN** AI 返回 tool_calls，工具执行完毕后递归发起下一轮请求
- **THEN** 重建 API 消息时 chatHistory 已含完整 assistant.tool_calls + tool 结果对，sanitize 保留二者，不再出现孤儿 tool，不再抛出 `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`

### Requirement: 上下文使用量展示位置
上下文使用量不再渲染到 AI 回复气泡内部，改由输入区底部状态行展示。

#### Scenario: AI 回复气泡
- **WHEN** AI 回复（流式或历史回放）渲染
- **THEN** 气泡内仅含正文与时间，不含上下文使用量 footer

#### Scenario: 输入区状态行
- **WHEN** 一次请求完成（含 tokenCount）
- **THEN** 输入区底部状态行显示"上下文 · 已用 X / Y Token（Z%）"，Z≥80% 警告色

### Requirement: 输入区布局（Codex/Claude Code 风格）
输入框面积增大，文件按钮位于输入框内左侧，发送按钮与配置按钮位于输入框内右下角。

#### Scenario: 输入框内部布局
- **WHEN** 渲染输入区
- **THEN** `.input-wrapper` 内部左侧为文件按钮（含图片上传按钮），右侧底部为配置按钮 + 发送按钮；textarea 占满中间区域并可随文本增高

## REMOVED Requirements

### Requirement: 顶部模型选择按钮与输入区独立思考控件
**Reason**: 功能并入配置菜单，顶部模型按钮与输入区独立思考控件不再需要
**Migration**: 模型选择与思考模式统一通过配置菜单访问；模型名缩略显示移至配置按钮或状态行

# AI 输入区与会话体验精修 Spec

## Why
上一轮 `refine-ai-input-area-ux` 完成后，用户在实际使用中提出 8 项体验精修：思考轴动效偏稀疏、上下文展示位置不对、placeholder 偏低、菜单圆角、对话独立上下文、对话自动命名、任务完成过程折叠、输入区背景过重。

## What Changes
- **思考轴密集化**：最高档圆角矩形片段由单行 8 个增至多行密集排布
- **上下文展示位置调整**：从输入区状态行移到 AI 回复消息最底部（消息 wrapper 下方，不在气泡内，不在输入框上）
- **placeholder 垂直对齐**：调整 textarea padding/line-height 使"输入消息"占位文字垂直居中不偏低
- **菜单圆角化**：配置菜单中模型选择按钮与模型列表项改为圆角
- **每对话独立上下文**：切换对话时重算该对话的上下文使用量并更新展示
- **对话自动命名**：用户首次发送消息后，单独开一个独立 AI 线程（独立 API 请求）让 AI 生成简短标题，替换对话列表"新对话"；不写入主对话提示词
- **任务完成过程折叠**：todo 卡片全部完成时，折叠其下所有过程节点（推理框/工具卡/生成指示器），保留最终 AI 总结文本可见，提供"展开过程"按钮
- **输入区去背景**：移除 `.input-area` 背景与毛玻璃，仅保留 `.input-wrapper` 圆角输入框

## Impact
- Affected specs: `refine-ai-input-area-ux`（上下文展示位置由"输入区状态行"改为"AI 消息底部"）
- Affected code: `src-renderer/ai-assistant/ai-assistant.html`（CSS：思考轴、输入区、菜单圆角、placeholder；JS：上下文展示位置、对话切换重算、自动命名、任务折叠）

## ADDED Requirements

### Requirement: 对话自动命名
用户在某个对话首次发送消息后，系统应通过独立 AI 线程（独立 API 请求，不复用主对话上下文）生成简短标题，替换对话列表中"新对话"。

#### Scenario: 首条消息后命名
- **WHEN** 用户在"新对话"中发送首条消息并开始收到 AI 回复
- **THEN** 后台发起独立 API 请求（仅含系统指令+用户首条消息），让 AI 生成 ≤12 字标题
- **AND** 标题返回后更新对话 `title`、刷新对话列表、持久化
- **AND** 该请求不写入主对话 chatHistory，不影响主对话上下文

#### Scenario: 命名失败
- **WHEN** 命名请求失败或超时
- **THEN** 保留"新对话"标题，不影响主对话流程

### Requirement: 任务完成过程折叠与展开
todo 卡片全部步骤完成时，折叠其下所有过程节点（推理框、工具卡、生成指示器、工具结果），保留最终 AI 总结文本可见，并提供"展开过程"按钮。

#### Scenario: 全部完成折叠
- **WHEN** todo 卡片所有步骤 done
- **THEN** 折叠该卡片下方的所有过程节点（隐藏），保留卡片本身与最终 AI 文本回复可见
- **AND** 卡片上显示"展开过程"按钮

#### Scenario: 展开过程
- **WHEN** 用户点击"展开过程"按钮
- **THEN** 显示该卡片下方被折叠的过程节点
- **AND** 按钮变为"折叠过程"，再次点击重新折叠

## MODIFIED Requirements

### Requirement: 上下文使用量展示位置
上下文使用量不再在输入区状态行展示，改为在 AI 回复消息的最底部（消息 wrapper 下方，气泡外）展示。

#### Scenario: AI 回复完成
- **WHEN** AI 回复完成（流式 text 或工具调用递归完成）
- **THEN** 在该 AI 回复消息 wrapper 下方渲染上下文使用量"已用 X / Y Token（Z%）"
- **AND** 不在输入框区域展示

#### Scenario: 切换对话
- **WHEN** 用户切换到其他对话
- **THEN** 该对话的 AI 回复底部各自显示其上下文使用量（基于各自历史）

### Requirement: 思考轴最高档动效密集化
最高档圆角矩形片段由单行 8 个改为多行密集排布。

#### Scenario: 最高档动效
- **WHEN** 拖动至"最高"档
- **THEN** 渐变填充上叠加多行（≥3 行）圆角矩形片段，按序高级闪烁，视觉密集

### Requirement: 输入区去背景
`.input-area` 移除背景与毛玻璃，仅保留 `.input-wrapper` 圆角输入框。

#### Scenario: 输入区外观
- **WHEN** 渲染输入区
- **THEN** `.input-area` 背景透明、无毛玻璃、无边框分割线
- **AND** 仅 `.input-wrapper` 呈现圆角输入框（保留毛玻璃）

## REMOVED Requirements

### Requirement: 输入区底部上下文状态行
**Reason**: 上下文展示位置移到 AI 回复消息底部
**Migration**: 移除 `.context-status-bar` 元素与相关调用，改为在 AI 回复 wrapper 下方渲染

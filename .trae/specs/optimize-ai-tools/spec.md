# 优化 AI 写 Scratch 代码与网络搜索工具 Spec

## Why
当前 AI 助手在编辑器侧已实现约 40+ 个工具，但仅有 22 个通过 `TOOLS` 数组暴露给 LLM，导致 LLM 无法使用 `addScript`（添加积木脚本）、`executeOperations`（批量原子操作）、`addSprite`、`addBackdrop`、`developExtension`（扩展开发）等核心能力。同时，系统提示词将完整项目 JSON 全量注入，Token 消耗大且工具描述不完整。Web 搜索依赖正则解析 HTML，脆弱且无法获取页面内容摘要，影响搜索资料的实用性。

## What Changes
- 将编辑器侧已实现但未暴露的关键工具加入 `TOOLS` 数组，使 LLM 可调用全部能力
- 优化 `buildSystemPrompt()`：压缩项目 JSON 注入量、同步工具描述、增加 Scratch 积木 opcode 参考表
- 优化 Web 搜索：增加结果页面内容抓取与摘要、改进搜索结果格式化
- 优化对话循环：增加聊天历史智能截断、工具执行结果大小限制

## Impact
- Affected code:
  - `src-renderer/ai-assistant/ai-assistant.js` — `TOOLS` 数组、`buildSystemPrompt()`、`executeToolCall()`、`runConversationLoop()`
  - `src-main/windows/ai-assistant.js` — `webSearch()` 函数及辅助函数
  - `src-renderer-webpack/editor/gui/desktop-hoc.jsx` — 工具实现（仅读取，无需改动）

## ADDED Requirements

### Requirement: 暴露全部已实现工具给 LLM
系统 SHALL 将编辑器侧已实现但未在 `TOOLS` 数组中声明的工具全部加入声明，包括：
- `addScript(spriteName, hat, blocks, hatKey?, hatMessage?, hatBackdrop?)` — 向精灵添加积木脚本
- `executeOperations(operations, contextMapping?)` — 批量原子操作（添加/删除/修改积木、添加/删除注释）
- `addSprite(spriteName?, color?)` — 添加新精灵
- `addBackdrop(backdropName?, color?)` — 添加新背景
- `deleteSprite(spriteName)` — 删除精灵
- `changeCostume(spriteName, costumeName)` — 切换精灵造型
- `changeBackdrop(backdropName)` — 切换背景
- `getStageInfo()` — 获取舞台信息
- `getStageScreenshot()` — 获取舞台截图
- `getInstalledExtensions()` — 获取已安装扩展列表
- `searchExtensions(query)` — 搜索可用扩展
- `developExtension(code)` — 动态加载用户编写的扩展代码
- `installExtension(extensionId)` — 安装扩展
- `addCostumeFromUrl(spriteName, url)` — 从 URL 添加造型
- `searchAndAddCostume(spriteName, query)` — 搜索并添加造型
- `addSpriteFromUrl(url, spriteName?)` — 从 URL 添加精灵
- `setStageSize(width, height)` — 设置舞台尺寸
- `renameProject(name)` — 重命名项目
- `getSystemTime()` — 获取系统时间
- `getSystemInfo()` — 获取系统信息

#### Scenario: LLM 调用 addScript 工具
- **WHEN** 用户要求 AI "给我的精灵添加一个移动脚本"
- **THEN** LLM 调用 `addScript` 工具，传入 spriteName、hat 和 blocks 参数
- **AND** 编辑器侧执行脚本添加，返回成功结果
- **AND** 工作区刷新显示新积木

#### Scenario: LLM 调用 executeOperations 批量操作
- **WHEN** 用户要求 AI 一次性添加多个脚本或修改多个积木
- **THEN** LLM 调用 `executeOperations` 工具，传入 operations 数组
- **AND** 编辑器侧按顺序执行所有操作，返回每个操作的结果

### Requirement: 优化系统提示词
系统 SHALL 优化 `buildSystemPrompt()` 以减少 Token 消耗并提升 LLM 对工具的理解：

#### 项目 JSON 压缩
- 当项目 JSON 超过 5000 字符时，仅注入项目摘要（精灵名、位置、积木数、变量/列表名），不注入完整 JSON
- 当项目 JSON ≤ 5000 字符时，保持全量注入

#### 工具描述同步
- 系统提示词中的工具列表 SHALL 与 `TOOLS` 数组完全同步
- 为 `addScript` 和 `executeOperations` 提供详细的参数说明和 Scratch opcode 参考表

#### Scenario: 大项目提示词压缩
- **GIVEN** 一个包含 10 个精灵、100+ 积木的项目
- **WHEN** 构建系统提示词
- **THEN** 项目 JSON 被替换为结构化摘要，Token 消耗显著降低
- **AND** 摘要包含每个精灵的名称、位置、大小、方向、积木数、变量列表

### Requirement: Web 搜索增加页面内容抓取
系统 SHALL 在 Web 搜索返回结果后，对排名前 3 的结果页面进行内容抓取，提取正文摘要（每页最多 2000 字符），附加到搜索结果中返回给 LLM。

#### Scenario: 搜索并抓取页面内容
- **WHEN** LLM 调用 `web_search("Scratch 积木编程教程")`
- **THEN** 系统返回搜索结果列表
- **AND** 排名前 3 的结果包含 `content` 字段，为页面正文的纯文本摘要（≤ 2000 字符）
- **AND** 内容抓取失败时静默跳过，不影响其他结果

### Requirement: 优化对话历史管理
系统 SHALL 优化聊天历史的截断策略：
- 保持当前 20 条消息的上限
- 当系统提示词中项目 JSON 被压缩时，将消息上限提升至 30 条
- 工具调用结果超过 4000 字符时，截断并附加 `[结果已截断]` 提示

#### Scenario: 长对话不丢失关键上下文
- **GIVEN** 一个超过 20 轮的对话
- **WHEN** 项目 JSON 被压缩（摘要模式）
- **THEN** 保留最近 30 条消息，而非 20 条

## MODIFIED Requirements

### Requirement: buildSystemPrompt 工具列表
系统提示词中的工具列表 SHALL 与 `TOOLS` 数组保持同步，包含所有已暴露工具的描述。新增工具（addScript、executeOperations 等）的描述 SHALL 包含参数格式说明和 Scratch opcode 示例。

### Requirement: webSearch 结果格式
`webSearch()` 返回的每条结果 SHALL 包含 `{title, url, snippet, source, content?}` 字段。`content` 字段为可选，仅对排名前 3 的结果存在。

### Requirement: runConversationLoop 工具结果处理
工具执行结果在追加到 messages 前，SHALL 检查 JSON 字符串长度。超过 4000 字符时截断至 4000 字符并追加 `\n[结果已截断]`。

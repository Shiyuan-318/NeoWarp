# Checklist

## 上下文管理
- [x] `PROVIDERS` 中每个模型对象含 `contextLimit`（Token 整数）字段，取值经联网核实（Kimi K3=1000000、MiMo≈1000000 等）
- [x] Custom 模型设置表单含"上下文上限（Token）"输入项，默认 32000，可修改并持久化
- [x] `estimateTokens(text)` 函数实现，对消息数组累计估算 Token
- [x] `buildApiMessages` 改为从最新消息向前按 Token 累加，达 `contextLimit * 0.8` 停止；超限压缩较早消息为摘要
- [x] 每条 AI 回复底部显示"上下文 · 已用 X / Y Token（Z%）"，Z≥80% 警告色高亮
- [x] Y 取当前模型 `contextLimit`，X 取本次 `apiMessages` 估算总量

## tool_calls 稳定性
- [x] `buildApiMessages` 切片后对每个含 `tool_calls` 的 assistant 消息，确认其后紧跟对其全部 `tool_call_id` 的 tool 消息；缺失则连同 assistant 一并剔除
- [x] 孤儿 tool 消息（无前置 assistant）与新校验合并为统一成对一致性保证
- [x] 长对话（>20 轮含工具调用）不再抛出 `insufficient tool messages following tool_calls`

## max_tokens 修复
- [x] 请求体 `max_tokens` 按 `min(contextLimit - 估算输入Token, 模型安全输出上限)` 动态计算，不再硬编码 65536
- [x] 不再出现 `Error: Param Incorrect`

## 待办清单分步折叠
- [x] `createTodoCard` 每个步骤为可折叠区块（`.todo-step`），含序号/标题/状态图标
- [x] `update_todo(status='doing')` 时对应步骤区块自动展开
- [x] `update_todo(status='done')` 时对应步骤区块自动折叠为标题行
- [x] 进行中步骤区块能容纳后续工具调用/结果节点
- [x] 清单顶部保留进度条与"X/Y"计数
- [x] `plan_todos` 工具描述引导 AI 分步执行

## 任务完成折叠与耗时
- [x] 清单创建时记录起始时间戳（`_todoStartTime`）
- [x] 全部步骤 `done` 时计算耗时并在卡片显示"总耗时 · mm:ss"
- [x] 全部完成时折叠所有步骤 body 并清空 `activeTodoStepBody`
- [x] 清单卡片本身与最终 AI 回复保持可见

## 输入框圆角毛玻璃自适应增高
- [x] `.input-wrapper` 为圆角矩形 + 毛玻璃（`backdrop-filter: saturate(180%) blur(var(--glass-blur))` + 半透明背景）
- [x] 浅色与暗色模式均有对应毛玻璃配色
- [x] 随文本行数自动增高，最小 1 行、最大 240px，超出内部滚动
- [x] 高度变化有平滑过渡

## 文件附件
- [x] 输入区含"添加文件"按钮，`accept=".md,.txt,.pdf,.csv" multiple`
- [x] md/txt/csv 用 `FileReader.readAsText` 读取
- [x] pdf 用 `pdf.js`（cdnjs 3.11.174）提取纯文本
- [x] 文件预览卡片显示在输入框上方，可移除
- [x] 发送时以"附件：<文件名>\n<内容>"前缀拼入用户消息，多文件依次拼接，单文件超上限截断并标注

## 思考模式拖动轴
- [x] 输入框底部含思考强度拖动轴，4 档"低/中/高/最高"
- [x] 档位持久化到 `currentConfig.thinkingLevel`
- [x] "最高"档呈现粒子流动动效（参考 Claude Code）
- [x] OpenAI/Kimi 映射 `reasoning_effort` 为 low/medium/high/max（不支持 max 回退 high）
- [x] DeepSeek/MiMo 映射 `thinking`（低档不启用，其余启用）
- [x] 不支持思考的模型（`supportsReasoning:false`）隐藏控件（`updateThinkingControlVisibility`）
- [x] `runConversationLoop` 读取档位设置请求体（`applyThinkingParams`），不再固定 `high`

## 收尾
- [x] 旧的 `src-renderer/ai-assistant/ai-assistant.js` 未被加载/影响（按 developlog 该文件已废弃）
- [ ] `.trae/developlog/log.md` 追加本次开发日志（用户取消，跳过）
- [x] 现有工具（addScript、executeOperations 等）功能不受影响
- [x] 现有图片上传、会话保存、多 provider 配置等功能不受影响

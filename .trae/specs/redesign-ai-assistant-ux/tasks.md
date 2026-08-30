# Tasks

- [x] Task 1: 为模型配置上下文上限并联网核实
  - [x] SubTask 1.1: 联网搜索各模型真实最大上下文 Token 上限（Kimi K3=1M 官方纠正、MiMo=1M、Pangu=512K 等）
  - [x] SubTask 1.2: 在 PROVIDERS 每个模型对象新增 contextLimit（与 maxOutput）字段
  - [x] SubTask 1.3: Custom 模型设置表单新增"上下文上限（Token）"输入项，默认 32000，纳入 currentConfig 与持久化

- [x] Task 2: Token 估算与上下文使用量展示
  - [x] SubTask 2.1: 新增 estimateTokens / estimateMessagesTokens 函数
  - [x] SubTask 2.2: AI 回复气泡底部追加"上下文 · 已用 X / Y Token（Z%）"，Z≥80% 警告色
  - [x] SubTask 2.3: buildApiMessages 返回 tokenCount 供展示使用

- [x] Task 3: 重写 buildApiMessages 为 Token 级管理 + tool_calls 成对一致性
  - [x] SubTask 3.1: 从 chatHistory 末尾向前按 Token 累加，达 contextLimit*0.8 停止；超限插入历史摘要
  - [x] SubTask 3.2: sanitizeToolCallPairs 校验 tool_calls/tool 成对，缺失则一并剔除
  - [x] SubTask 3.3: 合并原 foundToolWithoutCalls 修复为统一 sanitize 函数

- [x] Task 4: 修复 max_tokens 与思考参数动态化
  - [x] SubTask 4.1: max_tokens 改为 min(contextLimit - 估算输入 - 512, 模型 maxOutput)，<1024 兜底，删除硬编码 65536
  - [x] SubTask 4.2: reasoning_effort/thinking 按 currentConfig.thinkingLevel 设置（applyThinkingParams）

- [x] Task 5: 待办清单分步折叠样式
  - [x] SubTask 5.1: 重写 createTodoCard：每个步骤为可折叠区块，含序号/标题/状态图标；保留进度条与"X/Y"
  - [x] SubTask 5.2: 重写 updateTodoCard：doing 时展开该区块，done 时自动折叠为标题行
  - [x] SubTask 5.3: executeToolCall 分发 update_todo 调用新区块折叠逻辑，进行中步骤容纳后续工具调用
  - [x] SubTask 5.4: 微调 plan_todos 工具描述引导分步执行

- [x] Task 6: 任务完成折叠过程并显示耗时
  - [x] SubTask 6.1: createTodoCard 记录起始时间戳；全部 done 时计算耗时写入"总耗时 · mm:ss"
  - [x] SubTask 6.2: 全部完成时折叠清单下方所有过程节点（工具卡片、推理框、生成指示器、工具结果）

- [x] Task 7: 输入框圆角毛玻璃 + 自适应增高
  - [x] SubTask 7.1: .input-wrapper 圆角矩形 + 毛玻璃，浅/暗模式配色
  - [x] SubTask 7.2: 校验/增强 autoResize：最小 1 行、最大 240px，超出内部滚动，加 transition

- [x] Task 8: 新增文件附件（md/txt/pdf/csv）
  - [x] SubTask 8.1: 输入区新增"添加文件"按钮，accept=".md,.txt,.pdf,.csv" multiple
  - [x] SubTask 8.2: 读取文件：md/txt/csv 用 FileReader.readAsText；pdf 用 pdf.js 提取纯文本
  - [x] SubTask 8.3: 文件预览卡片显示在输入框上方，可移除
  - [x] SubTask 8.4: 发送时以"附件：<文件名>\n<内容>"前缀拼入用户消息，多文件依次拼接，单文件超上限截断并标注

- [x] Task 9: 思考模式拖动轴
  - [x] SubTask 9.1: 输入框底部新增思考强度拖动轴，4 档"低/中/高/最高"，档位持久化到 currentConfig.thinkingLevel
  - [x] SubTask 9.2: "最高"档粒子动效（沿轴流动发光粒子，参考 Claude Code）
  - [x] SubTask 9.3: 档位映射请求参数（OpenAI/Kimi→reasoning_effort；DeepSeek/MiMo→thinking；不支持思考的模型隐藏控件）
  - [x] SubTask 9.4: runConversationLoop 读取 currentConfig.thinkingLevel 设置请求体（applyThinkingParams，已在 Task 4 完成）

- [ ] Task 10: 验证与日志
  - [ ] SubTask 10.1: 用 Kimi K3 长对话验证上下文压缩与使用量展示，无 insufficient tool messages 报错
  - [ ] SubTask 10.2: plan_todos + 多步 update_todo 验证分步折叠、完成后折叠与耗时
  - [ ] SubTask 10.3: 验证文件附件、思考拖动轴四档（含最高粒子）、输入框毛玻璃自适应增高
  - [ ] SubTask 10.4: .trae/developlog/log.md 追加开发日志

# Task Dependencies
- Task 2 依赖 Task 1（已完成）
- Task 3 依赖 Task 2（已完成）
- Task 4.2/9.4 已完成
- Task 6 依赖 Task 5
- Task 1-4 已完成；Task 5、Task 7、Task 8、Task 9.1-9.3 可并行

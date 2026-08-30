# Tasks

- [x] Task 1: 修复工具调用递归流程中 tool 消息孤儿报错
  - [x] SubTask 1.1: 在 `doApiCall` 的 `tool_calls` 分支 `Promise.all` 回调中，调整顺序：先 `chatHistory.push` 所有 tool 结果与 tool_result，再调用 `buildApiMessages` 重建消息
  - [x] SubTask 1.2: 截图工具的多模态 content 处理改为：buildApiMessages 后在返回的 `toolMessages` 中按 `tool_call_id` 定位对应 tool 消息并替换其 content 为多模态数组
  - [x] SubTask 1.3: 验证多轮工具调用不再抛出 `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`

- [x] Task 2: 上下文使用量移出回复气泡
  - [x] SubTask 2.1: 移除 `appendAIMessage`（历史回放）与流式 `result.type === 'text'` 分支中 `formatUsageFooter` 拼接到 bubble 的调用
  - [x] SubTask 2.2: 新增输入区底部状态行元素（`.context-status-bar`），在请求完成时写入"上下文 · 已用 X / Y Token（Z%）"，Z≥80% 警告色

- [x] Task 3: 输入区布局重构（Codex/Claude Code 风格）
  - [x] SubTask 3.1: 重构 `.input-area` HTML：`.input-wrapper` 内左侧放文件按钮（+图片按钮），右下角放配置按钮 + 发送按钮；移除顶部 `modelSelectBtn` 与输入区独立 `thinkingControl`
  - [x] SubTask 3.2: 增大 textarea 面积，调整 padding/最小高度，保留毛玻璃与自适应增高（最大 240px）
  - [x] SubTask 3.3: 调整 CSS 使内部按钮绝对/弹性定位到输入框左/右下角，不遮挡文本

- [x] Task 4: 新增配置菜单浮层
  - [x] SubTask 4.1: 新增配置按钮（齿轮/滑块图标），点击在旁边弹出浮层菜单
  - [x] SubTask 4.2: 菜单含「模型选择」区块（复用现有模型下拉列表逻辑）与「思考模式」区块
  - [x] SubTask 4.3: 点击菜单外或再次点击配置按钮关闭菜单；菜单关闭不影响已选档位/模型

- [x] Task 5: 思考模式拖动轴重新设计
  - [x] SubTask 5.1: 重写思考轴 CSS：加粗 track，填充为从左到右渐变（如 `linear-gradient(90deg, #3b82f6, #8b5cf6)`），thumb 指示档位
  - [x] SubTask 5.2: 最高档时移除原粒子点动效，改为多个圆角矩形片段按序高级闪烁（渐变流动 + 明暗交替 keyframes）
  - [x] SubTask 5.3: 拖动轴移入配置菜单内，保留 pointer 拖动与档位持久化逻辑

- [x] Task 6: 文件按钮移至输入框左侧
  - [x] SubTask 6.1: 将 `fileUploadBtn`（与 `imageUploadBtn`）从 `.input-left-actions` 移入 `.input-wrapper` 内部左侧
  - [x] SubTask 6.2: 调整 CSS 使按钮在输入框内左下角，textarea 左侧留出空间不重叠

- [x] Task 7: 验证与收尾
  - [x] SubTask 7.1: 多轮工具调用（含截图工具）验证无报错（静态验证代码顺序正确，运行时需用户实测）
  - [x] SubTask 7.2: 验证输入区布局：文件按钮左、配置+发送按钮右下内嵌、textarea 自适应
  - [x] SubTask 7.3: 验证配置菜单模型切换与思考轴四档（含最高圆角矩形闪烁）
  - [x] SubTask 7.4: 验证上下文使用量在输入区状态行展示，气泡内无 footer
  - [x] SubTask 7.5: 保留现有功能：图片上传、会话保存、多 provider、工具不受影响
  - [ ] SubTask 7.6: `.trae/developlog/log.md` 追加本次开发日志（用户已要求跳过）

# Task Dependencies
- Task 2、Task 3、Task 6 可并行
- Task 4 依赖 Task 3（输入区结构）
- Task 5 依赖 Task 4（菜单容器）
- Task 1 独立，可最先进行
- Task 7 依赖全部完成

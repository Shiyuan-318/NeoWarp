# Tasks

- [x] Task 1: 思考轴最高档动效密集化
  - [x] SubTask 1.1: 思考轴 `.thinking-fill.is-max` 内圆角矩形片段由单行 8 个改为多行密集排布（3 行 × 8 列 = 24 个，CSS grid）
  - [x] SubTask 1.2: 调整 keyframes 使多行片段按序闪烁（`animation-delay: calc(var(--d) * 0.05s)`）

- [x] Task 2: 上下文展示位置移到 AI 回复底部
  - [x] SubTask 2.1: 移除 `.input-area` 内 `.context-status-bar` 元素与 `updateContextStatus` 函数
  - [x] SubTask 2.2: 在 AI 回复消息 wrapper 下方新增上下文使用量元素（`formatContextUsageHtml`）
  - [x] SubTask 2.3: 历史回放时为每条 AI 回复渲染其底部上下文使用量

- [x] Task 3: placeholder 垂直对齐
  - [x] SubTask 3.1: 调整 textarea padding/min-height 与 wrapper align-items，使占位文字垂直居中

- [x] Task 4: 菜单模型选择圆角化
  - [x] SubTask 4.1: `.config-model-select` 按钮圆角胶囊状
  - [x] SubTask 4.2: `.model-dropdown-item` 列表项圆角（8px + margin）

- [x] Task 5: 每对话独立上下文
  - [x] SubTask 5.1: `loadConversation` 切换对话后 `historyReplayTokens = 0` 重置
  - [x] SubTask 5.2: `createNewConversation` 新建对话时重置

- [x] Task 6: 对话自动命名
  - [x] SubTask 6.1: `generateConversationTitle` 独立非流式 fetch 请求生成 ≤12 字标题
  - [x] SubTask 6.2: 标题返回后更新对话 title、renderConversationList、saveConversations
  - [x] SubTask 6.3: `sendMessage` 首次发送时异步触发，不阻塞主流程
  - [x] SubTask 6.4: 不写入 chatHistory，失败静默

- [x] Task 7: 任务完成过程折叠与展开
  - [x] SubTask 7.1: todo 卡片全部完成时折叠步骤，显示"展开过程"按钮
  - [x] SubTask 7.2: 按钮点击切换所有步骤 is-open，文字"展开过程/折叠过程"切换
  - [x] SubTask 7.3: 保留卡片本身与最终 AI 文本回复可见

- [x] Task 8: 输入区去背景
  - [x] SubTask 8.1: `.input-area` 移除 background、backdrop-filter、border-top
  - [x] SubTask 8.2: 保留 `.input-wrapper` 圆角输入框与毛玻璃

- [x] Task 9: 验证与收尾
  - [x] SubTask 9.1-9.9: 全部静态验证通过（运行时需用户实测）
  - [ ] SubTask 9.10: `.trae/developlog/log.md` 追加本次开发日志（用户已要求跳过）

# Task Dependencies
- Task 1、3、4、8 可并行（CSS 为主）
- Task 2 依赖 Task 8（输入区结构调整）
- Task 5 依赖 Task 2（上下文展示位置）
- Task 6 独立
- Task 7 独立
- Task 9 依赖全部完成

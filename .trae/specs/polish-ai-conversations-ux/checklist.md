# Checklist

## 思考轴密集化
- [x] 最高档圆角矩形片段为多行密集排布（3 行 × 8 列 = 24 个，CSS grid）
- [x] 多行片段按序高级闪烁（`animation-delay: calc(var(--d) * 0.05s)`，24 个递增）
- [x] 低/中/高档仍为单行渐变填充（segment 隐藏）

## 上下文展示位置
- [x] 移除 `.input-area` 内 `.context-status-bar` 元素与 `updateContextStatus` 函数（Grep 0 匹配）
- [x] AI 回复消息 wrapper 下方渲染上下文使用量（`formatContextUsageHtml` + `.msg-context-usage`）
- [x] 不在输入框区域展示上下文
- [x] Z≥80% 警告色（`.is-warn` class）
- [x] 历史回放每条 AI 回复底部各自展示（`appendAIMessage` 第 6 参数 + 累计 token）

## placeholder 垂直对齐
- [x] `.input-wrapper` `align-items: stretch`，textarea `padding: 14px 96px 14px 44px`、`min-height: 56px`
- [x] 占位文字垂直居中不偏低

## 菜单圆角化
- [x] `.config-model-select` 按钮为圆角胶囊状（`border-radius: var(--radius-full)`）
- [x] `.model-dropdown-item` 列表项为圆角（`border-radius: 8px` + `margin: 2px 4px`）
- [x] hover/active 状态保持圆角

## 每对话独立上下文
- [x] `loadConversation` 开头 `historyReplayTokens = 0` 重置
- [x] `createNewConversation` 开头 `historyReplayTokens = 0` 重置
- [x] 切换对话后历史回放按各自 chatHistory 累计 token 渲染

## 对话自动命名
- [x] `generateConversationTitle` 函数发起独立非流式 fetch 请求
- [x] 标题 ≤12 字，trim + 去引号 + 截断
- [x] 不写入 chatHistory、无 abortController、不影响主对话上下文
- [x] 失败静默（catch 不抛错）
- [x] `sendMessage` 首次发送（chatHistory 空 + 标题为"新对话"）时异步触发，不阻塞
- [x] 对话列表刷新并持久化新标题

## 任务完成过程折叠
- [x] `createTodoCard` header 含 `.todo-toggle-process` 按钮（初始隐藏）
- [x] `updateTodoCardProgress` 全部完成时显示按钮，文字"展开过程"
- [x] 点击展开所有步骤 `is-open`，按钮变"折叠过程"；再点击折叠
- [x] 保留总耗时显示与卡片本身可见
- [x] 最终 AI 文本回复（todo 卡片外）保持可见

## 输入区去背景
- [x] `.input-area` 移除 `background`、`backdrop-filter`、`border-top`
- [x] `.input-wrapper` 保留圆角输入框与毛玻璃
- [x] 输入区与聊天区视觉融合

## 收尾
- [x] 现有功能不受影响：图片上传、文件附件、会话保存、多 provider、工具、思考轴拖动
- [x] `ai-assistant.js`（废弃文件）未被修改
- [ ] `.trae/developlog/log.md` 追加本次开发日志（用户已要求跳过）

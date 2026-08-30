# Checklist

## 工具调用稳定性
- [x] `doApiCall` 的 `tool_calls` 分支中，`buildApiMessages` 在所有 tool 结果 `chatHistory.push` 之后调用
- [x] 截图工具的多模态 content 通过 `tool_call_id` 在 `toolMessages` 中定位替换，不破坏配对
- [x] 多轮工具调用（>3 轮，含截图）不再抛出 `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`（静态验证代码顺序正确，运行时需用户实测）
- [x] `sanitizeToolCallPairs` 不再丢弃带 tool_calls 的 assistant（因 tool 结果已入栈配对）

## 上下文使用量移出气泡
- [x] AI 回复气泡（流式与历史回放）内不再含 `formatUsageFooter` 输出（函数已删除，Grep 0 匹配）
- [x] 输入区底部新增状态行元素（`#contextStatusBar`），请求完成时显示"上下文 · 已用 X / Y Token（Z%）"
- [x] Z≥80% 警告色高亮
- [x] 历史回放也通过状态行展示（`updateContextStatus(historyReplayTokens)`）

## 输入区布局（Codex/Claude Code 风格）
- [x] `.input-wrapper` 面积增大（min-height 56px），textarea 占主区域
- [x] 文件按钮位于输入框内左侧（图片按钮同侧）
- [x] 发送按钮位于输入框内右下角
- [x] 配置按钮位于发送按钮左侧、输入框内右下角
- [x] 内部按钮不遮挡 textarea 文本（padding `12px 96px 12px 44px` 留出空间）
- [x] 移除顶部 `modelSelectBtn` 与输入区独立 `thinkingControl`（Grep `$('modelSelectBtn')` 0 匹配）

## 配置菜单
- [x] 点击配置按钮在旁边弹出浮层菜单（`configMenu` 绝对定位）
- [x] 菜单含模型选择区块（复用 `populateModelDropdownForChat`，`modelDropdown` 移入菜单）
- [x] 菜单含思考模式拖动轴
- [x] 点击菜单外或再次点击配置按钮关闭菜单（document click + Escape 监听）
- [x] 菜单关闭后已选模型/档位保持

## 思考模式拖动轴新视觉
- [x] 拖动轴 track 加粗（高度 14px）
- [x] 填充为从左到右渐变（`linear-gradient(90deg, #3b82f6, #8b5cf6)`）
- [x] thumb 指示当前档位（18px 圆点）
- [x] 最高档时渐变变为多个圆角矩形片段（8 个 `.thinking-segment`）
- [x] 最高档圆角矩形按序高级闪烁（`thinkingSegmentGlow` + `thinkingGradientFlow` keyframes，delay 递增 0.1s）
- [x] 原粒子点动效已移除（`spawnThinkingParticles`/`thinkingParticles` Grep 0 匹配）
- [x] 拖动轴 pointer 拖动与档位持久化逻辑保留

## 文件按钮位置
- [x] `fileUploadBtn` 与 `imageUploadBtn` 位于 `.input-wrapper` 内部 `.input-left-actions`
- [x] 按钮 CSS 定位不遮挡文本（绝对定位 left:10px bottom:10px）
- [x] 文件选择与预览逻辑不受影响（`handleFileSelect` 等保留）

## 收尾
- [x] 现有功能不受影响：图片上传、会话保存、多 provider、addScript/executeOperations 等工具
- [x] `ai-assistant.js`（废弃文件）未被修改
- [ ] `.trae/developlog/log.md` 追加本次开发日志（用户已要求跳过）

# Tasks
- [x] Task 1: 收紧 `.modal-content` 圆角规则作用域，仅对全屏模态保持直角
  - [x] SubTask 1.1: 在 `src-renderer-webpack/editor/gui/gui.css` 中，将 `:global([class*="modal-content"])` 规则内的 `border-radius: 0 !important;` 与 `box-shadow: none !important;` 抽离到 `:global([class*="modal-content"][class*="full-screen"])` 选择器下（保留 `border: none`、`background`、`color`、`overflow: hidden` 在原通用规则中，因为这两项对全屏与非全屏模态均适用）
  - [x] SubTask 1.2: 为非全屏模态（高级设置弹窗）补充圆角规则，例如 `:global([class*="modal-content"]:not([class*="full-screen"]))` 设置 `border-radius: 12px !important;`、`box-shadow: 0 8px 24px rgba(0,0,0,0.18) !important;`，与项目其他圆角元素（右键菜单 12px）保持一致
- [x] Task 2: 收紧 `.modal-content .header` 标题栏主题色规则作用域，不再影响 `.body` 内的分节 header
  - [x] SubTask 2.1: 在 `src-renderer-webpack/editor/gui/gui.css` 中，将现有的 `:global([class*="modal-content"] [class*="header"])` 标题栏样式规则改为仅匹配模态标题栏。采用"`body` 内的 header 重置"策略：保留原规则作用于所有 header（标题栏与分节 header 均先套用），随后追加 `:global([class*="modal-content"] [class*="body"] [class*="header"])` 重置规则，将分节 header 的 `background`、`backdrop-filter`、`-webkit-backdrop-filter`、`border-bottom`、`color` 还原为分节标题应有的样式（透明背景、无模糊、无下边框、文字颜色跟随 `--text-primary`），并保留 `font-weight: 600` 与原 `letter-spacing` 视情况而定
  - [x] SubTask 2.2: 验证重置规则不误伤扩展库（library modal）——扩展库的 `.body` 内不存在 `.header` 元素（其内部为 filter-bar 与 library-scroll-grid），因此重置规则不会影响扩展库现有外观
- [x] Task 3: 验证修改结果
  - [x] SubTask 3.1: 运行 `npm run webpack:compile` 构建确认无错误（exit code 0，仅有 pre-existing 的 index.js 文件名冲突警告，与本次修改无关）
  - [x] SubTask 3.2: 通过 GetDiagnostics 检查 `gui.css` 无 CSS 诊断错误（diagnostics 为空数组）
  - [x] SubTask 3.3: 验证构建产物中已注入新规则——通过 Grep 检查 `dist-renderer-webpack/editor/gui/index.js` 第 60112 行，确认编译产物包含三段 `.modal-content` 规则（通用/全屏/非全屏）与新增的 `.modal-content .body .header` 重置规则
  - [x] SubTask 3.4: 静态确认扩展库（library modal）外观未受影响——`[class*="full-screen"]` 选择器精确命中扩展库全屏模态，重置规则 `.body .header` 不匹配扩展库（其 body 内无 .header 元素）
- [x] Task 4: 在 `.trae/developlog/log.md` 中追加本次修改的开发日志（时间、修改内容、修改文件）

# Task Dependencies
- Task 2 依赖 Task 1（同文件顺序修改，避免冲突）
- Task 3 依赖 Task 1 与 Task 2 完成
- Task 4 依赖 Task 3 验证通过

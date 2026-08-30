# Tasks

- [x] Task 1: 版本号升级至 1.0.19
  - [x] SubTask 1.1: 修改 `package.json` 中 version 字段从 "1.0.18" 改为 "1.0.19"

- [x] Task 2: 造型区圆角矩形曲率/半径调整功能补丁 + 标签汉化
  - [x] SubTask 2.1: 修改 `node_modules/scratch-paint/src/containers/corner-settings-indicator.jsx`，将 messages.radius 的 defaultMessage 从 "Radius" 改为 "半径"，messages.curvature 的 defaultMessage 从 "Curvature" 改为 "曲率"
  - [x] SubTask 2.2: 将 `node_modules/scratch-paint/src/helper/tools/rounded-rect-tool.js`（含 createRoundedRectPath、isRoundedRectPath、getRoundedRectParams、getRoundedRectInfo、rebuildRoundedRectPath 函数及 RoundedRectTool 类的 setCornerRadius/setCornerCurvature 方法和 data 标记逻辑）的完整内容追加到 `patches/scratch-paint+2.1.61.patch`
  - [x] SubTask 2.3: 将 `node_modules/scratch-paint/src/containers/rounded-rect-mode.jsx`（含 cornerCurvature/cornerRadius 的 mapStateToProps/mapDispatchToProps）的修改追加到 patch
  - [x] SubTask 2.4: 将 `node_modules/scratch-paint/src/containers/corner-settings-indicator.jsx`（含汉化后的 messages）的修改追加到 patch
  - [x] SubTask 2.5: 将 `node_modules/scratch-paint/src/components/corner-settings-indicator.jsx` 的修改追加到 patch
  - [x] SubTask 2.6: 将 `node_modules/scratch-paint/src/reducers/rounded-rect.js`（含 MAX_CORNER_CURVATURE、changeCornerCurvature、CHANGE_CORNER_CURVATURE）的修改追加到 patch
  - [x] SubTask 2.7: 将 `node_modules/scratch-paint/src/components/paint-editor/paint-editor.jsx` 中引入 CornerSettingsIndicator 的修改追加到 patch

- [x] Task 3: 修复项目分析内存占用数值异常
  - [x] SubTask 3.1: 修改 `src-renderer/project-analysis/project-analysis.html` 的 analyzeProject 函数（约 703-708 行），将 `JSON.stringify(target.blocks).length` 改为仅统计非影子积木的字节数（过滤 block.shadow，使用 Blob 或 TextEncoder 估算 UTF-8 字节长度）
  - [x] SubTask 3.2: 优化 renderHealth 函数（约 979 行）的内存百分比上限，将固定 80MB 改为更合理的动态上限或提高至合理值（如 200MB），避免显示 >100% 或异常偏高

- [x] Task 4: TurboWarp 设置弹窗外观分区汉化
  - [x] SubTask 4.1: 修改 `node_modules/scratch-gui/src/components/tw-settings-modal/settings-modal.jsx`，将以下 FormattedMessage 的 defaultMessage 改为中文：
    - "Appearance" → "外观" (id: neowarp.settingsModal.appearance, 约 657 行)
    - "Code Area Background:" → "代码区背景：" (id: neowarp.settingsModal.codeAreaBackground, 约 452 行)
    - "Select Image" → "选择图片" (id: neowarp.settingsModal.selectBackground, 约 472/533 行，2 处)
    - "Set a custom background image for the code area (blocks workspace)." → "为代码区（积木工作区）设置自定义背景图片。" (id: neowarp.settingsModal.codeAreaBackgroundHelp, 约 494 行)
    - "Stage Area Background:" → "舞台区背景：" (id: neowarp.settingsModal.stageAreaBackground, 约 513 行)
    - "Set a custom background image for the stage area." → "为舞台区设置自定义背景图片。" (id: neowarp.settingsModal.stageAreaBackgroundHelp, 约 555 行)
    - "Clear" → "清除" (id: neowarp.settingsModal.clearBackground, 约 484/545 行，2 处)
  - [x] SubTask 4.2: 将 settings-modal.jsx 中外观分区相关修改（CodeAreaBackground、StageAreaBackground 组件、Appearance 标题、相关 propTypes 和 props 传递）追加到 `patches/scratch-gui+3.2.37.patch`

- [x] Task 5: 积木区复选框圆形化
  - [x] SubTask 5.1: 修改 `node_modules/scratch-blocks/core/flyout_vertical.js` 第 116 行，将 `Blockly.VerticalFlyout.prototype.CHECKBOX_CORNER_RADIUS = 5;` 改为 `Blockly.VerticalFlyout.prototype.CHECKBOX_CORNER_RADIUS = Blockly.VerticalFlyout.prototype.CHECKBOX_SIZE / 2;`
  - [x] SubTask 5.2: 运行 `npx patch-package scratch-blocks` 生成 `patches/scratch-blocks+<version>.patch` 文件

- [x] Task 6: 更新开发日志
  - [x] SubTask 6.1: 在 `.trae/developlog/log.md` 中追加本次开发记录，包含时间、开发内容、修改的文件列表

# Task Dependencies
- Task 2 的 SubTask 2.1 必须在 SubTask 2.4 之前完成（先汉化再写 patch）
- Task 4 的 SubTask 4.1 必须在 SubTask 4.2 之前完成（先汉化再写 patch）
- Task 5 的 SubTask 5.1 必须在 SubTask 5.2 之前完成（先改代码再生成 patch）
- Task 1、Task 2、Task 3、Task 4、Task 5 相互独立，可并行
- Task 6 依赖所有其他任务完成

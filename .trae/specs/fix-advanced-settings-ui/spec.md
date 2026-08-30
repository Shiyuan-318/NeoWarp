# 修复高级设置页 UI 问题 Spec

## Why
高级设置弹窗（SettingsModalComponent，文件号 `tw-settings-modal`，对应"Advanced Settings"标题）当前存在两个 UI 缺陷：
1. 弹窗四角为直角，与项目其他圆角风格（如右键菜单、扩展库卡片）不一致。
2. 弹窗中"特色"、"移除限制"、"危险功能"、"外观"四个分节标题行被错误地套用了标题栏（title bar）的毛玻璃主题色背景，导致配色异常。

根因均来自 `src-renderer-webpack/editor/gui/gui.css` 中为扩展库（library modal）设计的全局覆盖规则作用域过宽，误伤了高级设置弹窗。

## What Changes
- 收紧 gui.css 中 `.modal-content` 的 `border-radius: 0 !important` 规则作用域，仅对全屏（full-screen）模态生效，使非全屏的高级设置弹窗恢复圆角。
- 收紧 gui.css 中 `.modal-content .header` 的标题栏主题色规则作用域，仅作用于模态标题栏（直接子级 header），不再影响 `.body` 内的分节 header。
- 为高级设置弹窗的圆角与外观补充必要的最小样式（如保留柔和阴影），保持与项目其他圆角风格统一。
- 不修改 scratch-gui 源码、patch 文件及高级设置弹窗的功能逻辑。

## Impact
- Affected specs: 无
- Affected code:
  - `src-renderer-webpack/editor/gui/gui.css`（核心修改点，仅 CSS）
  - 不影响 `node_modules/scratch-gui/src/components/tw-settings-modal/settings-modal.jsx`
  - 不影响 `patches/scratch-gui+3.2.37.patch`
  - 不影响扩展库（library modal）的现有外观——其全屏直角与标题栏毛玻璃效果保持不变

## ADDED Requirements
### Requirement: 高级设置弹窗圆角
The system SHALL 使高级设置弹窗（非全屏模态）四角呈现圆角，圆角半径与项目其他圆角元素（如右键菜单 12px、扩展库卡片 16px）风格协调。

#### Scenario: 高级设置弹窗显示圆角
- **WHEN** 用户在编辑器中打开"高级设置"（Advanced Settings）弹窗
- **THEN** 弹窗四角为圆角（与全屏扩展库面板的直角不同）
- **AND** 弹窗内容（标题栏 + body）被 `overflow: hidden` 裁剪至圆角范围内

#### Scenario: 扩展库面板保持全屏直角
- **WHEN** 用户打开扩展库或造型库等全屏模态
- **THEN** 该面板保持原有的直角（`border-radius: 0`）全屏贴边布局
- **AND** 标题栏毛玻璃主题色效果不受影响

### Requirement: 高级设置分节标题行配色正确
The system SHALL 使高级设置弹窗内"特色"、"移除限制"、"危险功能"、"外观"四个分节标题行（`.body` 内的 `.header`）不套用模态标题栏的毛玻璃主题色背景，而是保持分节标题的简洁样式（透明背景 + 粗体 + 分隔线）。

#### Scenario: 分节标题行不再显示标题栏背景
- **WHEN** 用户打开高级设置弹窗
- **THEN** "特色"、"移除限制"、"危险功能"、"外观"四个分节标题行显示为透明背景
- **AND** 不出现 `--ui-modal-header-background` 的毛玻璃主题色
- **AND** 不出现 `backdrop-filter` 模糊效果
- **AND** 标题文字保持粗体，右侧保持 dashed 分隔线

#### Scenario: 模态标题栏样式保持不变
- **WHEN** 用户打开高级设置弹窗
- **THEN** 弹窗顶部的标题栏（"Advanced Settings"行）保持毛玻璃主题色背景
- **AND** 标题栏底部边框、字重、字距等样式不受影响

# 修复亮色主题下顶栏背景显示为黑色 Spec

## Why
在亮色主题（light GUI theme）下，NeoWarp 顶部圆角工具栏（menu-bar）背景渲染为黑色，而非预期的紫色 accent。该问题源自 `var(--menu-bar-background)` 在亮色主题下被解析为嵌套 `var()` 引用 `var(--looks-secondary)`，而 gui.css 中没有任何 fallback 值；当嵌套 var 解析失败（或变量尚未通过 `applyGuiColors` 注入到 documentElement.style 时），`background-color` 退化为 invalid at computed-value time，最终回退到 `transparent`，与下层深色背景叠加后视觉上呈现为黑色。

## What Changes
- 修改 `src-renderer-webpack/editor/gui/gui.css` 中 `:global([class*="menu-bar_menu-bar_"])` 的 `background-color` 规则：
  - **BREAKING**（仅针对该选择器的样式行为）：不再依赖单一 `var(--menu-bar-background)` 解析嵌套 var，改为带 fallback 的链式引用：`var(--menu-bar-background, var(--looks-secondary, hsla(260, 60%, 60%, 1)))`。
  - 在亮色模式下（`@media (prefers-color-scheme: light)` 或默认分支）显式提供紫色 fallback；在深色模式下保留 `#333333` 兜底，与 scratch-gui dark.js 一致。
- 不修改 scratch-gui 源码或 patch 文件；不动 menu-bar 内部菜单逻辑、高度、圆角、阴影等其他样式。

## Impact
- Affected specs: 无（本次为样式 bug 修复，不涉及既有 spec 文档）
- Affected code:
  - `src-renderer-webpack/editor/gui/gui.css` — `:global([class*="menu-bar_menu-bar_"])` 选择器的 `background-color` 与 `@media (prefers-color-scheme: dark)` 块

## ADDED Requirements
### Requirement: 顶栏背景色 fallback 链
The system SHALL 在 `:global([class*="menu-bar_menu-bar_"])` 选择器中为 `background-color` 提供多层 fallback，依次尝试 `--menu-bar-background` → `--looks-secondary` → 显式 hsla 紫色常量，确保即使任一 CSS 变量未注入或嵌套解析失败，顶栏仍能显示正确的主题色。

#### Scenario: 亮色主题下顶栏显示紫色
- **WHEN** 用户选择亮色 GUI 主题（`tw:theme` 为 light 或系统偏好为 light）
- **AND** scratch-gui 的 `applyGuiColors` 已注入 `--menu-bar-background: var(--looks-secondary)` 与 `--looks-secondary: hsla(260, 60%, 60%, 1)`
- **THEN** 顶栏圆角工具栏背景渲染为紫色 `hsla(260, 60%, 60%, 1)`（约 #855CD6）
- **AND** 不出现黑色或透明背景

#### Scenario: 变量未注入时的兜底
- **WHEN** 页面初始渲染且 `applyGuiColors` 尚未执行
- **OR** `--menu-bar-background` 与 `--looks-secondary` 均未定义
- **THEN** 顶栏背景渲染为 fallback 链最末端的紫色 `hsla(260, 60%, 60%, 1)`
- **AND** 不出现黑色或透明背景

## MODIFIED Requirements
### Requirement: 深色模式顶栏样式
原有 `@media (prefers-color-scheme: dark)` 块仅修改 box-shadow。修改后，深色模式分支额外覆盖 `background-color` 为 `var(--menu-bar-background, #333333)`，确保深色主题下即使 `--menu-bar-background` 解析失败，仍回退到 `#333333` 而非黑色。

#### Scenario: 深色主题下顶栏显示深灰
- **WHEN** 用户选择深色 GUI 主题
- **THEN** 顶栏背景渲染为 `#333333`（或 `--menu-bar-background` 的解析值）
- **AND** 阴影与描边保持原有深色模式样式不变

## REMOVED Requirements
无（本次不删除任何既有需求或样式）。

# 角色与造型右键菜单圆角化 Spec

## Why
NeoWarp 已将 Blockly 积木右键菜单（`.blocklyContextMenu`）圆角化为 12px 并配合圆角菜单项，形成了统一的圆角设计语言。但角色列表与造型列表的右键上下文菜单（由 `react-contextmenu` + scratch-gui 的 `context-menu.css` 渲染）仍保留原生 Scratch 的小圆角（`calc($space / 2)` ≈ 4px）容器与直角矩形菜单项，hover 高亮为直角色块，视觉上与项目其他圆角控件不一致。本次统一将其圆角化。

## What Changes
- 在 `src-renderer-webpack/editor/gui/gui.css` 中新增一段 NeoWarp 覆盖样式，针对 `react-contextmenu` 渲染出的菜单容器与菜单项：
  - **菜单容器**：`border-radius: 12px`、`overflow: hidden`（使内部 hover 色块被圆角裁剪）、柔和阴影、细边框，与现有 Blockly 右键菜单样式保持一致。
  - **菜单项**：`border-radius: 8px`、`margin: 2px 4px`，使 hover 高亮呈圆角胶囊状，而非贴边的直角色块。
- 不修改 scratch-gui 源码、不新增 patch 文件；仅通过 `:global(...)` 属性选择器在 gui.css 中覆盖（CSS Modules 编译后类名带 hash，使用 `[class*="context-menu_context-menu_"]` 形式匹配，与现有 `[class*="menu-bar_menu-bar_"]` 写法一致）。
- 不改变菜单项的文字、功能、分隔线逻辑、z-index 与触发行为。

## Impact
- Affected specs: 无
- Affected code:
  - `src-renderer-webpack/editor/gui/gui.css` — 新增 react-contextmenu 容器与菜单项的圆角覆盖规则
  - `.trae/developlog/log.md` — 开发日志
- 作用范围说明：该 `ContextMenu` 组件为共享组件，角色列表与造型列表的右键菜单均通过 `SpriteSelectorItem` 使用它（`asset-panel/selector.jsx` 与 `sprite-selector` 均渲染 `SpriteSelectorItem`）。舞台监视器（monitor）的右键菜单也复用同一组件，本次覆盖会使其一并圆角化，这与项目整体圆角设计语言一致，属于预期内、可接受的一致性效果，不视为破坏性变更。

## ADDED Requirements

### Requirement: 角色与造型右键菜单容器圆角
系统 SHALL 将角色列表与造型列表右键弹出的上下文菜单容器渲染为圆角矩形（`border-radius` 不小于 12px），并通过 `overflow: hidden` 保证内部 hover 高亮背景被容器圆角裁剪，不出现直角溢出。

#### Scenario: 右键角色弹出菜单外观
- **WHEN** 用户在角色列表中右键点击某个角色
- **THEN** 弹出的上下文菜单容器四角为圆角（约 12px）
- **AND** 容器边框与阴影柔和，与 Blockly 右键菜单观感一致
- **AND** 鼠标悬停某菜单项时，该项的高亮背景为圆角胶囊状，不超出容器圆角边界

#### Scenario: 右键造型弹出菜单外观
- **WHEN** 用户在造型列表中右键点击某个造型
- **THEN** 弹出的上下文菜单与角色右键菜单观感一致（圆角容器 + 圆角菜单项）
- **AND** 包含分隔线的菜单（如"删除"项上方的分隔线）分隔线随菜单项内缩，呈现代代感的内嵌分隔效果

#### Scenario: 深浅主题适配
- **WHEN** 用户切换 GUI 主题为亮色或深色
- **THEN** 右键菜单容器与菜单项保持圆角形状不变
- **AND** 背景色、hover 色、边框沿用 scratch-gui 既有主题变量，不因圆角覆盖而出现配色异常

### Requirement: 右键菜单项圆角胶囊化
系统 SHALL 将右键菜单中的每个菜单项（含普通项、带分隔线项、危险操作项）渲染为圆角矩形（`border-radius` 约 8px），并在项与容器边缘之间留出约 4px 水平外边距，使 hover 高亮呈独立圆角胶囊，而非贯穿容器宽度的直角条。

#### Scenario: 菜单项 hover 高亮形状
- **WHEN** 鼠标悬停在右键菜单的某一菜单项上
- **THEN** 该项高亮背景四角为圆角
- **AND** 高亮背景左右两侧与容器边缘之间存在留白
- **AND** 危险操作项（如"删除"）hover 时的高亮（红色）同样为圆角胶囊

# 扩展页标签切换过渡动画

## Summary

为扩展库面板（点击"添加扩展"打开的全屏 Modal）增加切换分类标签时的过渡动画：
- 卡片错落淡入（前 10 张以 40ms 步进延迟依次淡入上滑）
- 被激活的标签按钮添加轻微回弹缩放动画

## Current State Analysis

### 扩展页架构
- 扩展库面板使用 `scratch-gui/src/components/library/library.jsx` 的 `LibraryComponent`
- 点击"添加扩展"按钮打开，顶部为 `filter-bar`（含搜索框 + `tag-button` 分类标签），下方为 `library-scroll-grid`（扩展卡片网格）
- 标签按钮通过 `handleTagClick` → `setState({selectedTag})` 切换分类，`getFilteredData()` 按 `selectedTag` 过滤数据

### 现有动画（src-renderer-webpack/editor/gui/gui.css）
1. **tag-button**（L102-124）：已有 `transition: background/color/border-color/transform/box-shadow 0.22s ease`，active 态切换蓝色背景。但无"激活瞬间"的回弹动画。
2. **neowarpLibraryFadeIn**（L126-134）：已定义卡片淡入 keyframe（opacity 0→1 + translateY 6px→0，0.25s ease，`backwards` fill mode）。

### 核心问题
`LibraryComponent` 中 `library-scroll-grid` div 没有 `key` 绑定到 `selectedTag`。切换标签时 React 按 `dataItem.name`/`rawURL` 作为 key 复用已有 DOM：
- 两标签共有的卡片：原地不动，**不触发**淡入动画
- 仅新标签有的卡片：mount 时触发淡入
- 仅旧标签有的卡片：直接消失

结果：切换标签时视觉不一致，部分卡片闪现、部分不动、部分消失，缺少整体过渡感。

## Proposed Changes

### Change 1: 为 library-scroll-grid 绑定 key 触发重挂载

**文件**: `node_modules/scratch-gui/src/components/library/library.jsx`（L344-349）

**修改**: 在 `library-scroll-grid` div 上添加 `key={this.state.selectedTag}`

**修改前**:
```jsx
<div
    className={classNames(styles.libraryScrollGrid, {
        [styles.withFilterBar]: this.props.filterable || this.props.tags
    })}
    ref={this.setFilteredDataRef}
>
```

**修改后**:
```jsx
<div
    key={this.state.selectedTag}
    className={classNames(styles.libraryScrollGrid, {
        [styles.withFilterBar]: this.props.filterable || this.props.tags
    })}
    ref={this.setFilteredDataRef}
>
```

**Why**: `key` 变化时 React 会卸载旧 div、挂载新 div，所有子卡片重新 mount，从而触发 CSS `animation`。搜索框输入时 `filterQuery` 变化但 `selectedTag` 不变，不会重挂载，避免每次按键都播放动画。`componentDidUpdate` 中的 `scrollToTop` 在新 div 挂载后调用，`this.filteredDataRef` 已指向新 div，滚动重置行为不受影响。

### Change 2: 重新生成 patch 文件

**文件**: `patches/scratch-gui+3.2.37.patch`

**操作**: 修改 library.jsx 后运行 `npx patch-package scratch-gui` 自动追加该文件的 diff 到现有 patch。项目已配置 `postinstall: patch-package`，重装依赖时会自动应用。

### Change 3: 增强卡片错落淡入动画

**文件**: `src-renderer-webpack/editor/gui/gui.css`（L126-134）

**修改前**:
```css
/* 切换顶部分类时，卡片网格内容淡入过渡 */
@keyframes :global(neowarpLibraryFadeIn) {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
:global([class*="library-scroll-grid"] > [class*="library-item"]),
:global([class*="library-scroll-grid"] > [class*="featured-item"]) {
  animation: neowarpLibraryFadeIn 0.25s ease backwards;
}
```

**修改后**:
```css
/* 切换顶部分类时，卡片网格内容错落淡入过渡 */
@keyframes :global(neowarpLibraryFadeIn) {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
:global([class*="library-scroll-grid"] > [class*="library-item"]),
:global([class*="library-scroll-grid"] > [class*="featured-item"]) {
  animation: neowarpLibraryFadeIn 0.32s cubic-bezier(0.22, 0.61, 0.36, 1) backwards;
}

/* 前 10 张卡片错开延迟营造瀑布感；超出部分立即播放避免等待过久。
   注意 :nth-child 基于"父元素的子元素位置"，Separator 分隔符也计入计数，
   但视觉上仍能呈现自然的错落效果，无需精确按可见卡片序号延迟。 */
:global([class*="library-scroll-grid"] > [class*="library-item"]:nth-child(1)),
:global([class*="library-scroll-grid"] > [class*="featured-item"]:nth-child(1)) { animation-delay: 0ms; }
:global([class*="library-scroll-grid"] > [class*="library-item"]:nth-child(2)),
:global([class*="library-scroll-grid"] > [class*="featured-item"]:nth-child(2)) { animation-delay: 40ms; }
:global([class*="library-scroll-grid"] > [class*="library-item"]:nth-child(3)),
:global([class*="library-scroll-grid"] > [class*="featured-item"]:nth-child(3)) { animation-delay: 80ms; }
:global([class*="library-scroll-grid"] > [class*="library-item"]:nth-child(4)),
:global([class*="library-scroll-grid"] > [class*="featured-item"]:nth-child(4)) { animation-delay: 120ms; }
:global([class*="library-scroll-grid"] > [class*="library-item"]:nth-child(5)),
:global([class*="library-scroll-grid"] > [class*="featured-item"]:nth-child(5)) { animation-delay: 160ms; }
:global([class*="library-scroll-grid"] > [class*="library-item"]:nth-child(6)),
:global([class*="library-scroll-grid"] > [class*="featured-item"]:nth-child(6)) { animation-delay: 200ms; }
:global([class*="library-scroll-grid"] > [class*="library-item"]:nth-child(7)),
:global([class*="library-scroll-grid"] > [class*="featured-item"]:nth-child(7)) { animation-delay: 240ms; }
:global([class*="library-scroll-grid"] > [class*="library-item"]:nth-child(8)),
:global([class*="library-scroll-grid"] > [class*="featured-item"]:nth-child(8)) { animation-delay: 280ms; }
:global([class*="library-scroll-grid"] > [class*="library-item"]:nth-child(9)),
:global([class*="library-scroll-grid"] > [class*="featured-item"]:nth-child(9)) { animation-delay: 320ms; }
:global([class*="library-scroll-grid"] > [class*="library-item"]:nth-child(10)),
:global([class*="library-scroll-grid"] > [class*="featured-item"]:nth-child(10)) { animation-delay: 360ms; }
```

**Why**:
- keyframe 增加 `scale(0.98→1)` 让卡片有"轻微放大 settle"的精致感
- `cubic-bezier(0.22, 0.61, 0.36, 1)`（ease-out-cubic 变体）比线性 ease 更自然
- `:nth-child` 错开延迟：前 10 张每张 +40ms，第 10 张延迟 360ms，总动画时长约 680ms（360+320），在感知上"流畅但不拖沓"
- 超过 10 张的卡片 `animation-delay` 回落为 0（由 `backwards` fill mode 保证初始不可见，立即播放），避免长列表末尾卡片等待过久
- `backwards` fill mode 保证延迟期间卡片保持 `from` 状态（opacity:0），不会先闪现再消失

### Change 4: 标签按钮激活回弹动画

**文件**: `src-renderer-webpack/editor/gui/gui.css`（L119-124 active 规则块）

**修改前**:
```css
:global([class*="tag-button"][class*="active"]) {
  background: var(--looks-secondary) !important;
  color: #ffffff !important;
  border-color: transparent !important;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--looks-secondary) 35%, transparent) !important;
}
```

**修改后**:
```css
@keyframes :global(neowarpTagPop) {
  0% { transform: scale(0.92); }
  60% { transform: scale(1.06); }
  100% { transform: scale(1); }
}
:global([class*="tag-button"][class*="active"]) {
  background: var(--looks-secondary) !important;
  color: #ffffff !important;
  border-color: transparent !important;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--looks-secondary) 35%, transparent) !important;
  animation: neowarpTagPop 0.32s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
}
```

**Why**:
- `neowarpTagPop` keyframe：0% scale(0.92) 呼应按下动作 → 60% scale(1.06) 轻微 overshoot → 100% scale(1) 回正
- `cubic-bezier(0.34, 1.56, 0.64, 1)` 是 spring 弹性曲线，强化回弹感
- CSS animation 仅在 `active` 类被添加时触发（animation 属性从 none → 有值），React 重新渲染同一按钮不会重复触发
- `!important` 与该规则块其他属性一致，确保覆盖基础 `tag-button` 的 `transition: transform 0.12s ease`（animation 优先级高于 transition）
- 失活按钮（active 类移除）无动画，瞬间恢复未选中态，避免双向弹动干扰

### Change 5: 更新开发日志

**文件**: `.trae/developlog/log.md`

**操作**: 追加日志条目，记录时间、开发内容、修改文件（按工作区规则要求）。

## Assumptions & Decisions

1. **"扩展页"= 扩展库 Modal**：经探索，编辑器内点击"添加扩展"打开的 `LibraryComponent` 是唯一同时具有"标签 + 卡片网格"结构的扩展相关页面。addon 设置页（`addons/index.jsx`）无标签结构，`tw-my-extension-modal` 是表单弹窗无标签，故确认扩展库 Modal 为目标。

2. **采用 patch-package 修改 library.jsx**：NeoWarp 已通过 `patches/scratch-gui+3.2.37.patch` 定制 scratch-gui（如 settings-modal.jsx），补丁方式是项目既定约定。`key` prop 是最小侵入修改，不影响其他逻辑。

3. **`:nth-child` 而非精确可见序号**：Separator 分隔符也计入 `:nth-child` 计数，但视觉上不影响错落效果。精确按可见卡片序号需要 JS 注入 index，过度工程化。

4. **仅前 10 张延迟**：扩展库单屏通常显示 6-8 张卡片，10 张覆盖首屏 + 滚动起始位置，超出部分立即播放避免长列表等待。

5. **不添加滑动指示条**：用户选定方案 1（错落淡入 + 微弹），不含滑动指示条。指示条需要 JS 追踪按钮位置、窗口缩放时重定位，复杂度与所选方案不匹配。

## Verification

1. 运行 `npx patch-package scratch-gui` 确认 patch 文件成功追加 library.jsx 的 diff
2. 运行 `npm run webpack:watch`（或 `webpack:prod`）确认无编译错误
3. 运行 `npm run electron:start` 启动应用
4. 在编辑器点击"添加扩展"按钮打开扩展库面板，验证：
   - **初始打开**：卡片错落淡入（已有行为，应保持）
   - **切换标签**：新分类下所有卡片重新错落淡入；被点击的标签按钮有回弹缩放
   - **搜索框输入**：卡片不播放淡入动画（filterQuery 不触发 key 变化）
   - **滚动重置**：切换标签后滚动位置回到顶部（`scrollToTop` 仍生效）
   - **深色模式**：动画在深浅主题下均正常
   - **快速连续切换标签**：无卡顿或动画堆叠异常

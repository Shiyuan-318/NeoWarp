# v1.0.19 改进 Spec

## Why
版本 1.0.18 发布后，用户反馈以下问题：造型区圆角矩形绘制后无法调整曲率和半径、项目分析内存占用数值异常偏高、TurboWarp 设置弹窗中外观分区文字未汉化、积木区报告积木前的复选框为圆角矩形而非圆形。本次更新统一修复这些问题。

## What Changes
- 版本号升级至 1.0.19
- **造型区圆角矩形调整**：在 `patches/scratch-paint+2.1.61.patch` 中补全圆角矩形曲率/半径调整功能的补丁（功能已在 node_modules 中实现但未持久化到 patch），并将 `corner-settings-indicator.jsx` 中的标签 "Radius" 汉化为 "半径"、"Curvature" 汉化为 "曲率"
- **项目分析内存占用修复**：修复 `src-renderer/project-analysis/project-analysis.html` 中内存占用计算包含影子积木导致数值偏大的问题，并优化内存百分比计算逻辑
- **设置弹窗外观分区汉化**：将 `node_modules/scratch-gui/src/components/tw-settings-modal/settings-modal.jsx` 中以下英文文字汉化为中文（并补全到 patch 文件）：
  - "Appearance" → "外观"
  - "Code Area Background:" → "代码区背景："
  - "Select Image" → "选择图片"
  - "Set a custom background image for the code area (blocks workspace)." → "为代码区（积木工作区）设置自定义背景图片。"
  - "Stage Area Background:" → "舞台区背景："
  - "Set a custom background image for the stage area." → "为舞台区设置自定义背景图片。"
  - "Clear" → "清除"
- **积木区复选框圆形化**：新增 `patches/scratch-blocks+12.0.0.patch`（版本号以实际安装版本为准），将 `node_modules/scratch-blocks/core/flyout_vertical.js` 中 `CHECKBOX_CORNER_RADIUS` 从 5 改为 `CHECKBOX_SIZE / 2`（12.5），使报告积木前的复选框从圆角矩形变为正圆形

## Impact
- Affected specs: 无
- Affected code:
  - `package.json` - 版本号
  - `patches/scratch-paint+2.1.61.patch` - 补全圆角矩形调整功能 + 汉化标签
  - `patches/scratch-gui+3.2.37.patch` - 补全外观分区汉化（settings-modal.jsx 的 defaultMessage 改中文）
  - `patches/scratch-blocks+*.patch` - 新增补丁，复选框圆形化
  - `src-renderer/project-analysis/project-analysis.html` - 修复内存占用计算
  - `node_modules/scratch-paint/src/containers/corner-settings-indicator.jsx` - 汉化标签 defaultMessage
  - `node_modules/scratch-gui/src/components/tw-settings-modal/settings-modal.jsx` - 汉化 defaultMessage
  - `node_modules/scratch-blocks/core/flyout_vertical.js` - 复选框圆角改半径
  - `.trae/developlog/log.md` - 开发日志

## ADDED Requirements

### Requirement: 圆角矩形曲率与半径调整
系统 SHALL 在造型绘制区提供已绘制圆角矩形的曲率和圆角半径调整能力，用户选中圆角矩形后通过滑块实时调整参数，并重建路径保持位置/旋转/样式不变。

#### Scenario: 选中已绘制圆角矩形后调整半径
- **WHEN** 用户在造型区选中一个已绘制的圆角矩形
- **THEN** 在画布旁显示"半径"和"曲率"两个滑块，初始值取自该圆角矩形的当前参数
- **WHEN** 用户拖动"半径"滑块
- **THEN** 圆角矩形的圆角半径实时更新，保持外接矩形、旋转角度和样式不变

#### Scenario: 绘制模式下调整默认参数
- **WHEN** 用户激活圆角矩形工具（未选中任何图形）
- **THEN** 显示"半径"和"曲率"滑块，调整后将作为后续新绘制图形的默认参数

### Requirement: 复选框圆形化
系统 SHALL 将积木区（flyout）中报告积木前的复选框渲染为正圆形（rx = ry = size/2），而非圆角矩形。

#### Scenario: 报告积木复选框外观
- **WHEN** 积木区显示报告积木（如 x 坐标、y 坐标、方向等）
- **THEN** 积木左侧的复选框为正圆形，边角半径等于尺寸的一半

## MODIFIED Requirements

### Requirement: 项目分析内存占用计算
内存占用 SHALL 仅统计实际资源字节数与非影子积木的 JSON 字符串字节数，百分比计算 SHALL 使用合理的上限，避免异常偏高的数值。

#### Scenario: 内存占用计算
- **WHEN** 项目分析计算内存占用
- **THEN** 资源部分使用 assetSize（已正确转换为字节数）
- **AND** 积木部分仅统计非影子积木的 JSON 字符串长度（按 UTF-8 字节估算）
- **AND** 内存百分比上限合理，避免显示异常

### Requirement: 设置弹窗外观分区汉化
TurboWarp 设置弹窗中外观分区 SHALL 使用中文显示所有标签、按钮和帮助文字。

#### Scenario: 外观分区显示
- **WHEN** 用户打开设置弹窗并滚动到外观分区
- **THEN** 标题显示"外观"，代码区背景标签显示"代码区背景："，按钮显示"选择图片"，帮助文字显示中文描述
- **AND** 舞台区背景标签显示"舞台区背景："，清除按钮显示"清除"

# 修复压缩版积木区复选框仍为圆角矩形 Spec

## Why
在 v1.0.19 的 `v1-0-19-improvements` 变更中，已将 `node_modules/scratch-blocks/core/flyout_vertical.js` 的 `CHECKBOX_CORNER_RADIUS` 从 `5` 改为 `CHECKBOX_SIZE / 2`，意图让积木区报告积木前的复选框变为正圆形。但实际运行时发现复选框仍是圆角矩形，原因是 scratch-blocks 运行时加载的是压缩后的 `blockly_compressed_vertical.js`，该文件中 `CHECKBOX_CORNER_RADIUS` 仍为 `5`，导致源文件修改未生效。

## What Changes
- 修改 `node_modules/scratch-blocks/blockly_compressed_vertical.js` 中 `Blockly.VerticalFlyout.prototype.CHECKBOX_CORNER_RADIUS` 的值，从 `5` 改为 `Blockly.VerticalFlyout.prototype.CHECKBOX_SIZE / 2`。
- 同步更新 `patches/scratch-blocks+0.1.0.patch`，将压缩文件中的对应修改追加进去，确保 `npm install` 后 patch-package 能正确还原。
- 重新运行 `npm run webpack:compile`，使修改进入构建产物。
- 不修改 scratch-gui 源码，不改变复选框尺寸、勾选行为、事件逻辑。

## Impact
- Affected specs: `v1-0-19-improvements`（本次为它的补全修复）
- Affected code:
  - `node_modules/scratch-blocks/blockly_compressed_vertical.js` — 修正运行时实际使用的 `CHECKBOX_CORNER_RADIUS`
  - `patches/scratch-blocks+0.1.0.patch` — 追加压缩文件修改
  - `.trae/developlog/log.md` — 开发日志

## ADDED Requirements

### Requirement: 运行时复选框渲染为正圆形
系统 SHALL 确保积木区 flyout 中报告积木、变量、列表等前方的复选框在运行时渲染为正圆形（rx = ry = CHECKBOX_SIZE / 2），而非圆角矩形。

#### Scenario: 压缩版本生效
- **WHEN** 用户打开编辑器并查看积木区 flyout 中的报告积木/变量/列表
- **THEN** 每个复选框为正圆形
- **AND** 勾选后的对勾位置居中、显示正常

#### Scenario: 重新安装依赖后仍保持圆形
- **WHEN** 执行 `npm install` 后 patch-package 自动应用补丁
- **THEN** `blockly_compressed_vertical.js` 中的 `CHECKBOX_CORNER_RADIUS` 仍为 `CHECKBOX_SIZE / 2`
- **AND** 复选框在编辑器中仍显示为正圆形

# 修复 AI 工具脚本信息返回问题 Spec

## Why
`getSpriteScripts` 返回的 DSL 文本存在字段重复输出、菜单阴影块处理不当的问题，导致 AI 看到的脚本信息不准确；`getProjectSummary` 不包含脚本概要信息，AI 无法在项目概览中了解脚本存在情况。

## What Changes
- 修复 `getSpriteScripts` 的 `emitBlock` 函数中 input/fields 重复输出和菜单阴影块处理问题
- 在 `getProjectSummary` 中为每个 sprite 增加脚本概要（脚本数量和帽子积木类型）

## Impact
- Affected code: `src-renderer-webpack/editor/gui/desktop-hoc.jsx`（getSpriteScripts case、getProjectSummary case）
- 无 breaking change，仅修复/增强返回数据

## ADDED Requirements
### Requirement: getSpriteScripts 菜单阴影块正确输出
系统 SHALL 在 emitBlock 中正确处理菜单阴影块（如 `motion_goto_menu`、`sensing_keyoptions`）：当 input 的 `block === shadow` 时，提取阴影块的 field 值作为参数输出，而非将其作为通用 reporter 处理。

#### Scenario: sensing_keypressed 块输出
- **WHEN** 脚本中有 `sensing_keypressed` 块，KEY_OPTION 值为 "space"
- **THEN** 输出 `sensing_keypressed "space"`，而非 `sensing_keypressed (sensing_keyoptions "space")` 或重复输出

### Requirement: getSpriteScripts 不重复输出 fields
系统 SHALL 在 emitBlock 中跳过已被 input 阴影块输出的字段，避免同一值出现两次。

#### Scenario: motion_goto 块输出
- **WHEN** 脚本中有 `motion_goto` 块，TO 字段值为 "_mouse_"
- **THEN** 输出 `motion_goto "_mouse_"`，而非 `motion_goto "_mouse_" "_mouse_"`

### Requirement: getProjectSummary 包含脚本概要
系统 SHALL 在 getProjectSummary 返回的每个 sprite 中增加 `scriptCount` 和 `scripts`（帽子积木类型列表）字段。

#### Scenario: AI 查看项目概览
- **WHEN** AI 调用 getProjectSummary
- **THEN** 每个 sprite 包含 `scriptCount: 2, scripts: ["event_whenflagclicked", "event_whenkeypressed"]` 信息，使 AI 了解脚本情况而无需逐一调用 getSpriteScripts

## MODIFIED Requirements
### Requirement: getSpriteScripts DSL 输出
修正 emitBlock 的 input/fields 处理逻辑：
1. 遍历 inputs 时，当 `inp.block === inp.shadow`（菜单阴影块），提取阴影块 field 值直接输出，跳过 reporter 逻辑
2. 记录已通过 input 输出的字段名（field name），在遍历 fields 时跳过这些已处理的字段
3. 深层嵌套 reporter（`inp.block !== inp.shadow`）保持现有的递归输出逻辑

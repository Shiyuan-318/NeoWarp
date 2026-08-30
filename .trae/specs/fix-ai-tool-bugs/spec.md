# 修复 AI 工具三个 Bug Spec

## Why
AI 助手暴露给 LLM 的三个工具在实际调用时全部失败或返回错误数据，直接影响 LLM 对编辑器的操控能力：
- `duplicate_sprite` 调用时服务端报 "Unknown tool: duplicateSprite"，工具完全不可用
- `get_system_info` 调用时报 "fi.userInfo is not a function"，工具直接抛异常
- `set_stage_size` 虽然实际修改了舞台尺寸，但返回值是 "Green flag clicked" 而非尺寸信息，导致 LLM 误判执行结果

## What Changes
- 在 `desktop-hoc.jsx` 的 `onAIToolCall` switch 语句中新增 `case 'duplicateSprite'` 分支，调用 `vm.duplicateSprite(targetId)` 实现角色复制并重命名
- 在 `desktop-hoc.jsx` 的 `case 'getSystemInfo'` 中移除 `require('os')`（webpack 会解析为 `os-browserify` 浏览器 polyfill，缺少 `userInfo()`），改为通过 `EditorPreload` 调用主进程 IPC 获取真实系统信息
- 在主进程 `src-main/windows/editor.js` 中新增 `get-ai-system-info` IPC handler，使用 Node.js 原生 `os` 模块返回完整系统信息
- 在 `src-preload/editor.js` 中暴露 `getAISystemInfo` 方法
- 修复 `case 'setStageSize'` 返回值：增加 `message` 字段描述舞台尺寸变更结果，确保返回数据清晰标识操作内容，避免与 `clickGreenFlag` 的返回值混淆

## Impact
- Affected code:
  - `src-renderer-webpack/editor/gui/desktop-hoc.jsx` — 新增 `duplicateSprite` case、重写 `getSystemInfo` case 改用 IPC、修正 `setStageSize` case 返回值
  - `src-main/windows/editor.js` — 新增 `get-ai-system-info` IPC handler
  - `src-preload/editor.js` — 暴露 `getAISystemInfo` 方法
- Affected specs: `optimize-ai-tools`（这些工具在 optimize-ai-tools 中被暴露给 LLM，本次修复使其真正可用）

## ADDED Requirements

### Requirement: duplicate_sprite 工具可用
系统 SHALL 在 `desktop-hoc.jsx` 的 `onAIToolCall` switch 语句中实现 `case 'duplicateSprite'` 分支，使 LLM 调用 `duplicate_sprite` 工具时能正确复制角色。

#### Scenario: LLM 调用 duplicate_sprite 复制角色
- **WHEN** LLM 调用 `duplicate_sprite(source_name="Sprite1", new_name="Sprite2")`
- **THEN** 编辑器侧根据 `sourceName` 查找目标精灵
- **AND** 调用 `vm.duplicateSprite(target.id)` 复制精灵（含所有造型、声音、脚本、变量）
- **AND** 调用 `vm.renameSprite(newTarget.id, newName)` 重命名新精灵
- **AND** 返回 `{ success: true, data: { sourceName, newName, message: '...' } }`

#### Scenario: 源精灵不存在
- **WHEN** LLM 调用 `duplicate_sprite(source_name="NonExistent", new_name="Copy")`
- **THEN** 返回 `{ success: false, error: 'Sprite "NonExistent" not found' }`

### Requirement: get_system_info 通过主进程 IPC 获取真实系统信息
系统 SHALL 在主进程中使用 Node.js 原生 `os` 模块获取系统信息，通过 IPC 返回给渲染进程，而非在渲染进程中使用被 webpack polyfill 的 `require('os')`。

#### Scenario: LLM 调用 get_system_info
- **WHEN** LLM 调用 `get_system_info()`
- **THEN** 渲染进程通过 `EditorPreload.getAISystemInfo()` 发起 IPC 调用
- **AND** 主进程使用 Node.js 原生 `os` 模块获取 CPU、内存、架构、平台、用户名等信息
- **AND** 返回 `{ success: true, data: { model, cores, speed, architecture, platform, release, hostname, totalMemory, freeMemory, uptime, userInfo, homedir, endianness } }`

#### Scenario: 主进程获取系统信息失败
- **WHEN** 主进程 `os` 模块调用抛出异常
- **THEN** 返回 `{ success: false, error: 'Failed to get system info: ...' }`

## MODIFIED Requirements

### Requirement: set_stage_size 返回值
`case 'setStageSize'` 的返回值 SHALL 包含 `message` 字段，明确描述舞台尺寸变更结果，使 LLM 能正确区分此结果与 `clickGreenFlag` 的返回值。

#### Scenario: 成功设置舞台尺寸
- **WHEN** LLM 调用 `set_stage_size(width=640, height=480)`
- **THEN** 调用 `vm.setStageSize(640, 480)` 修改舞台尺寸
- **AND** 返回 `{ success: true, data: { width: 640, height: 480, message: 'Stage size set to 640x480' } }`

#### Scenario: 无效舞台尺寸
- **WHEN** LLM 调用 `set_stage_size(width=100, height=100)`
- **THEN** 返回 `{ success: false, error: 'Invalid stage size. Width must be >= 240, height >= 180.' }`

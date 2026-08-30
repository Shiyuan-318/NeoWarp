# 修复 AI 添加角色/造型显示圆脸笑脸 Spec

## Why
AI 调用 `addSpriteFromLibrary` 或 `addCostumeFromLibrary` 时，`storage.load()` 在 Electron 离线环境下失败（Scratch 资源服务器 `assets.scratch.mit.edu` 不可达或网络受限），错误被 `try-catch` 静默吞掉，`asset` 保持 null 但继续创建角色/造型。VM 加载该 costume 时因 `costume.asset` 为 null 会回退到默认资源；同时 AI 在某些场景下也会退而调用 `addSprite`（其内部生成彩色圆脸 SVG 占位符，根据 spriteName 哈希取色，所以每个角色颜色不同），导致用户看到的是圆脸笑脸而非角色库中的实际角色。

## What Changes
- 修复 `addSpriteFromLibrary`：`storage.load()` 失败时通过 Electron 主进程 `EditorPreload.fetchImage()` 下载资源（URL 为 `https://assets.scratch.mit.edu/internalapi/asset/{md5ext}/get/`），用 `storage.builtinHelper._store()` 本地存储字节数据后填入 `costume.asset`；若下载仍失败则返回明确错误，不再静默继续
- 修复 `addCostumeFromLibrary`：同上逻辑，使用 `fetchImage` 下载 + `builtinHelper._store` 本地存储
- 强化提示词：在 `addSprite` 工具描述和 toolList 中明确禁止用于具名角色，AI 必须用 `addSpriteFromLibrary`

## Impact
- Affected code: `src-renderer-webpack/editor/gui/desktop-hoc.jsx`（addSpriteFromLibrary case、addCostumeFromLibrary case）、`src-renderer\ai-assistant\ai-assistant.js`（提示词）
- Affected specs: fix-get-project-info（同文件无冲突）
- 无 breaking change

## ADDED Requirements
### Requirement: addSpriteFromLibrary 资源加载回退机制
系统 SHALL 在 `storage.load()` 失败时，通过 Electron 主进程 `EditorPreload.fetchImage()` 从 `https://assets.scratch.mit.edu/internalapi/asset/{md5ext}/get/` 下载资源，并用 `storage.builtinHelper._store()` 本地存储字节数据，确保 `costume.asset` 不为 null。

#### Scenario: 离线环境下添加 Cat 角色
- **WHEN** AI 调用 `addSpriteFromLibrary("Cat")`，且 `storage.load()` 失败
- **THEN** 系统通过 `fetchImage` 下载 Cat 的 SVG 资源，本地存储后填入 costume.asset，角色正常显示为 Cat 而非圆脸

#### Scenario: 资源完全不可达时返回错误
- **WHEN** `storage.load()` 和 `fetchImage()` 均失败
- **THEN** 返回 `{success: false, error: "Failed to load sprite asset: ..."}`，不创建空 asset 的角色

### Requirement: addCostumeFromLibrary 资源加载回退机制
系统 SHALL 在 `storage.load()` 失败时使用 `fetchImage` 下载 + `builtinHelper._store` 本地存储，失败时返回错误。

#### Scenario: 添加造型库造型
- **WHEN** AI 调用 `addCostumeFromLibrary(spriteName, costumeName)`，且 `storage.load()` 失败
- **THEN** 系统通过 `fetchImage` 下载造型资源，本地存储后添加到角色

### Requirement: 提示词禁止 addSprite 用于具名角色
系统 SHALL 在提示词中明确：当用户要求添加具名角色（如 "Cat"、"Dog"、"Ball"）时，AI 必须使用 `addSpriteFromLibrary`，禁止使用 `addSprite`。

#### Scenario: AI 添加具名角色
- **WHEN** 用户要求"添加一个 Cat 角色"
- **THEN** AI 调用 `addSpriteFromLibrary("Cat")`，不调用 `addSprite`

## MODIFIED Requirements
### Requirement: addSpriteFromLibrary 实现
修改 `addSpriteFromLibrary` case（约 L1427-1488）：
1. 移除 `try { asset = await storage.load(...) } catch {}` 静默吞错
2. 改为：先尝试 `storage.load()`，失败时用 `EditorPreload.fetchImage()` 从 `https://assets.scratch.mit.edu/internalapi/asset/{md5ext}/get/` 下载，用 `storage.builtinHelper._store(assetType, dataFormat, new Uint8Array(buffer), null)` 存储，得到完整 asset 对象
3. 两种加载方式都失败时返回错误，不创建角色

### Requirement: addCostumeFromLibrary 实现
修改 `addCostumeFromLibrary` case（约 L1489-1539）：同 addSpriteFromLibrary 的回退逻辑

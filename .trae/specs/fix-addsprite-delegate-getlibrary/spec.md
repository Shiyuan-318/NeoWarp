# 修复 addSprite 委托逻辑 + 新增 getSpriteLibrary 工具 Spec

## Why
LLM 调用 `addSprite` 时传入了具名角色名称（如 "Cat"），但当前 `addSprite` 实现拒绝具名角色并报错 "Use addSpriteFromLibrary instead"，LLM 收到错误后不一定能正确切换工具。同时 AI 不知道有哪些角色可用，需要浏览角色库。

## What Changes
- 修改 `addSprite` 后端实现：传了 spriteName 时自动委托给 `addSpriteFromLibrary` 逻辑，而非报错拒绝
- 从 TOOLS 数组中移除 `addSpriteFromLibrary` 工具定义（合并进 `addSprite`，减少 LLM 混淆）
- 新增 `getSpriteLibrary` 工具：返回内置角色库列表（name + tags），让 AI 先浏览再选择
- 更新提示词中 toolList 描述

## Impact
- Affected code: `src-renderer-webpack/editor/gui/desktop-hoc.jsx`（addSprite case 合并 addSpriteFromLibrary 逻辑）、`src-renderer/ai-assistant/ai-assistant.js`（TOOLS 数组、toolList）
- **BREAKING**: 移除 `addSpriteFromLibrary` 工具（合并进 `addSprite`）

## ADDED Requirements
### Requirement: getSpriteLibrary 工具
系统 SHALL 提供 `getSpriteLibrary` 工具，返回 Scratch 内置角色库的所有角色名称和标签，让 AI 能先浏览可用角色再决定添加哪个。

#### Scenario: AI 浏览角色库
- **WHEN** AI 调用 `getSpriteLibrary()`
- **THEN** 返回 `{success: true, data: {count: N, sprites: [{name: "Cat", tags: ["animals"]}, ...]}}`

### Requirement: addSprite 合并 addSpriteFromLibrary
系统 SHALL 在 `addSprite` 传入 spriteName 时自动委托给原 `addSpriteFromLibrary` 的逻辑（角色库查找 + 资源加载），而非报错拒绝。

#### Scenario: LLM 调用 addSprite("Cat")
- **WHEN** AI 调用 `addSprite(spriteName="Cat")`
- **THEN** 系统从角色库查找 Cat 并加载，角色正常显示为 Cat

#### Scenario: LLM 调用 addSprite() 不传名字
- **WHEN** AI 调用 `addSprite()` 无 spriteName
- **THEN** 系统创建空白矩形角色

## MODIFIED Requirements
### Requirement: addSprite 工具
- 描述改为 "Add a sprite. If spriteName is provided (e.g. 'Cat'), loads from the built-in Scratch library. If not, creates a blank sprite."
- 传了 spriteName 时执行原 `addSpriteFromLibrary` 的完整逻辑（角色库查找 + 资源加载 + fetchImage 回退）
- 未传 spriteName 时创建空白矩形角色

### Requirement: addSpriteFromLibrary 工具
- 从 TOOLS 数组中移除（功能已合并到 addSprite）
- 后端 `case 'addSpriteFromLibrary'` 保留但标记为兼容（LLM 仍可能调用）

## REMOVED Requirements
无（addSpriteFromLibrary 后端 case 保留做兼容）

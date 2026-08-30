# 修复 addSprite 数据结构 bug + 资源 URL 多源回退 Spec

## Why
LLM 调用 `addSprite` 添加角色时报错 `Cannot read properties of undefined (reading 'lastIndexOf')`。根因是 sprites.json 的角色对象数据结构为 `{name, tags, costumes: [{assetId, md5ext, name, rotationCenterX/Y, ...}], sounds, ...}`，**没有顶层 `md5` 字段**。代码 L1454 用 `match.md5`（不存在）得到 undefined，`undefined.lastIndexOf('.')` 报错。同时 `assets.scratch.mit.edu` 在中国大陆无法访问，需要多源回退。

## What Changes
- 修复 `addSprite` case 数据结构访问：从 `match.md5` 改为 `match.costumes[0].md5ext`，从 `match.info` 改为 `match.costumes[0].rotationCenterX/Y`
- 修复 `addCostumeFromLibrary` case 同样的数据结构问题（如果存在）
- 资源 URL 改为多源回退：`assets.scratch.mit.edu` → `cdn.assets.scratch.mit.edu` → `assets.scratch.mit.edu`（IP 直连）

## Impact
- Affected code: `src-renderer-webpack/editor/gui/desktop-hoc.jsx`（addSprite case L1454-1490、addCostumeFromLibrary case L1600-1660）
- 无 breaking change

## ADDED Requirements
### Requirement: 多源资源 URL 回退
系统 SHALL 在 `EditorPreload.fetchImage()` 下载资源时，依次尝试多个镜像源：`assets.scratch.mit.edu` → `cdn.assets.scratch.mit.edu`，任一成功即返回。

#### Scenario: assets.scratch.mit.edu 不可达
- **WHEN** `https://assets.scratch.mit.edu/internalapi/asset/{md5ext}/get/` 超时或失败
- **THEN** 自动重试 `https://cdn.assets.scratch.mit.edu/internalapi/asset/{md5ext}/get/`，成功则返回资源

## MODIFIED Requirements
### Requirement: addSprite 数据结构访问
修改 `addSprite` case（约 L1454-1490）：
- `match.md5` → `match.costumes[0].md5ext`（实际数据结构是 costumes 数组）
- `match.info` → `[match.costumes[0].rotationCenterX, match.costumes[0].rotationCenterY]`
- 多造型加载从 `match.costumes` 数组直接遍历（不再依赖 `match.json`）
- 资源 URL 使用多源回退

### Requirement: addCostumeFromLibrary 数据结构访问
修改 `addCostumeFromLibrary` case（约 L1600-1660）：
- 同样的数据结构修复（如果有类似问题）
- 资源 URL 使用多源回退

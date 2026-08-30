# Tasks
- [x] Task 1: 修复 addSprite case 数据结构访问（desktop-hoc.jsx L1454-1490）
  - [x] 1.1: `match.md5` → `match.costumes[0].md5ext`
  - [x] 1.2: `match.info` → `[match.costumes[0].rotationCenterX, match.costumes[0].rotationCenterY]`
  - [x] 1.3: 多造型加载从 `match.costumes` 数组遍历，不依赖 `match.json`
- [x] Task 2: 资源 URL 多源回退（desktop-hoc.jsx）
  - [x] 2.1: 新增 `fetchAssetMultiSource(md5ext)` 辅助函数，依次尝试 `assets.scratch.mit.edu` → `cdn.assets.scratch.mit.edu`
  - [x] 2.2: addSprite case 中 `fetchImage(assetUrl)` 改为 `fetchAssetMultiSource(md5ext)`
  - [x] 2.3: addCostumeFromLibrary case 同样改为 `fetchAssetMultiSource(md5ext)`
- [x] Task 3: 修复 addCostumeFromLibrary case 数据结构（如果有类似问题）
- [x] Task 4: 更新开发日志

# Task Dependencies
- Task 1 和 Task 2 可并行（同文件不同修改点）
- Task 3 依赖 Task 1（确认数据结构问题）
- Task 4 依赖全部完成

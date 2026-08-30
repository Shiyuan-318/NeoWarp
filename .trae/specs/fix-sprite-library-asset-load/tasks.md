# Tasks
- [x] Task 1: 修复 addSpriteFromLibrary 资源加载（desktop-hoc.jsx L1427-1488）
  - [x] 1.1: storage.load 失败时通过 EditorPreload.fetchImage 下载资源（URL: https://assets.scratch.mit.edu/internalapi/asset/{md5ext}/get/）
  - [x] 1.2: 用 storage.builtinHelper._store 本地存储字节数据，得到 asset 对象填入 costume.asset
  - [x] 1.3: 两种加载都失败时返回错误，不创建角色
- [x] Task 2: 修复 addCostumeFromLibrary 资源加载（desktop-hoc.jsx L1489-1539）
  - [x] 2.1: 同 Task 1 的 fetchImage 回退逻辑
  - [x] 2.2: 失败时返回错误，不添加造型
- [x] Task 3: 强化提示词（ai-assistant.js）
  - [x] 3.1: addSprite 工具描述明确"仅用于空白角色，禁止用于具名角色（如 Cat/Dog），具名角色必须用 addSpriteFromLibrary"
  - [x] 3.2: toolList 中 addSprite 描述同步强化
- [x] Task 4: 更新开发日志

# Task Dependencies
- Task 1 和 Task 2 可并行
- Task 3 独立
- Task 4 依赖 Task 1-3 完成

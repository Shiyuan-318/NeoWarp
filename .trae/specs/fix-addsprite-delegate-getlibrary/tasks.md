# Tasks
- [x] Task 1: 修改 addSprite 后端实现（desktop-hoc.jsx）
  - [x] 1.1: 传了 spriteName 时，将原 `addSpriteFromLibrary` case 的完整逻辑（角色库查找 + 资源加载 + fetchImage 回退）复制到 `addSprite` case 中
  - [x] 1.2: 未传 spriteName 时保留空白矩形角色逻辑
- [x] Task 2: 新增 getSpriteLibrary 后端 handler（desktop-hoc.jsx）
  - [x] 2.1: 添加 `case 'getSpriteLibrary'`，import tw-async-libraries，返回角色名+标签列表
- [x] Task 3: 更新 TOOLS 数组和提示词（ai-assistant.js）
  - [x] 3.1: addSprite 工具描述改为 "If spriteName is provided, loads from built-in library; otherwise creates blank sprite"
  - [x] 3.2: addSpriteFromLibrary 从 TOOLS 数组移除
  - [x] 3.3: 新增 getSpriteLibrary 工具到 TOOLS 数组
  - [x] 3.4: 更新 toolList 描述（移除 addSpriteFromLibrary，新增 getSpriteLibrary）
- [x] Task 4: 更新开发日志

# Task Dependencies
- Task 1 和 Task 2 可并行（同文件但不同 case）
- Task 3 依赖 Task 1-2 完成（描述需与实际行为一致）
- Task 4 依赖全部完成

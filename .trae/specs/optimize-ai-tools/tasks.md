# Tasks

- [x] Task 1: 暴露未声明的工具到 TOOLS 数组
  - [x] SubTask 1.1: 在 `src-renderer/ai-assistant/ai-assistant.js` 的 `TOOLS` 数组中添加 `addScript` 工具声明，包含详细参数说明（spriteName, hat, blocks, hatKey, hatMessage, hatBackdrop）和 Scratch opcode 参考表示例
  - [x] SubTask 1.2: 添加 `executeOperations` 工具声明，包含 operations 数组格式说明（add_script, delete_block, modify_input, add_comment, delete_comment, explain）和 contextMapping 说明
  - [x] SubTask 1.3: 添加 `addSprite`、`addBackdrop`、`deleteSprite` 工具声明
  - [x] SubTask 1.4: 添加 `changeCostume`、`changeBackdrop`、`getStageInfo`、`getStageScreenshot` 工具声明
  - [x] SubTask 1.5: 添加 `getInstalledExtensions`、`searchExtensions`、`developExtension`、`installExtension` 工具声明
  - [x] SubTask 1.6: 添加 `addCostumeFromUrl`、`searchAndAddCostume`、`addSpriteFromUrl` 工具声明
  - [x] SubTask 1.7: 添加 `setStageSize`、`renameProject`、`getSystemTime`、`getSystemInfo` 工具声明

- [x] Task 2: 优化 buildSystemPrompt 系统提示词
  - [x] SubTask 2.1: 实现项目 JSON 大小检测与压缩逻辑：超过 5000 字符时仅注入结构化摘要（精灵名、位置、大小、方向、积木数、变量/列表名）
  - [x] SubTask 2.2: 同步系统提示词中的工具列表描述，使其与扩展后的 TOOLS 数组一致
  - [x] SubTask 2.3: 在系统提示词中增加 Scratch 常用 opcode 参考表（motion, looks, sound, control, sensing, operators, data 等分类的常用 opcode），帮助 LLM 正确生成 addScript 和 executeOperations 参数
  - [x] SubTask 2.4: 增加项目压缩状态标记，供对话历史截断逻辑使用

- [x] Task 3: 优化 Web 搜索功能
  - [x] SubTask 3.1: 在 `src-main/windows/ai-assistant.js` 的 `webSearch()` 函数中，对排名前 3 的搜索结果 URL 进行页面内容抓取
  - [x] SubTask 3.2: 实现页面正文提取函数 `extractPageContent(html)`：去除 HTML 标签、script/style/nav/footer 等噪声，提取正文纯文本，截断至 2000 字符
  - [x] SubTask 3.3: 将抓取的 content 字段附加到搜索结果对象中，抓取失败时静默跳过

- [x] Task 4: 优化对话循环与历史管理
  - [x] SubTask 4.1: 在 `runConversationLoop()` 中，工具结果追加到 messages 前检查 JSON 字符串长度，超过 4000 字符时截断并附加 `[结果已截断]`
  - [x] SubTask 4.2: 根据 `buildSystemPrompt()` 返回的压缩状态，动态调整 `chatHistory.slice()` 的截断数量（压缩模式 30 条，全量模式 20 条）

# Task Dependencies
- Task 2 依赖 Task 1（工具描述需与 TOOLS 数组同步）
- Task 4 的 SubTask 4.2 依赖 Task 2 的 SubTask 2.4（需要压缩状态标记）
- Task 1 和 Task 3 可并行执行

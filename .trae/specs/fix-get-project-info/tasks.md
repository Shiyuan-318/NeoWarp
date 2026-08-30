# Tasks
- [x] Task 1: 修复 getSpriteScripts 的 emitBlock 函数
  - [x] 1.1: 遍历 inputs 时，检测 `inp.block === inp.shadow` 的菜单阴影块，提取其 field 值直接输出
  - [x] 1.2: 用 Set 记录已通过 input 输出的 field name，在遍历 fields 时跳过
  - [x] 1.3: 保持 `inp.block !== inp.shadow` 的 reporter 递归输出逻辑不变
- [x] Task 2: 在 getProjectSummary 中为每个 sprite 增加脚本概要（scriptCount + scripts 帽子积木类型列表）
- [x] Task 3: 更新开发日志

# Task Dependencies
- Task 2 independent of Task 1
- Task 3 depends on Task 1 and Task 2

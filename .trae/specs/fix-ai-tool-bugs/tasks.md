# Tasks

- [x] Task 1: 修复 duplicate_sprite 工具 — 在 desktop-hoc.jsx 新增 duplicateSprite case
  - [x] SubTask 1.1: 在 `src-renderer-webpack/editor/gui/desktop-hoc.jsx` 的 `onAIToolCall` switch 语句中（`default` case 之前）新增 `case 'duplicateSprite'` 分支
  - [x] SubTask 1.2: 实现逻辑：根据 `params.sourceName` 查找目标精灵（`vm.runtime.targets.find(t => t.getName() === params.sourceName)`），找不到时返回 `{ success: false, error: 'Sprite "..." not found' }`
  - [x] SubTask 1.3: 调用 `await vm.duplicateSprite(target.id)` 复制精灵，然后调用 `vm.renameSprite(vm.editingTarget.id, params.newName)` 重命名新精灵（duplicateSprite 会通过 setEditingTarget 将新精灵设为当前编辑目标）
  - [x] SubTask 1.4: 返回 `{ success: true, data: { sourceName, newName, message: 'Sprite "' + sourceName + '" duplicated as "' + newName + '"' } }`，异常时返回 `{ success: false, error: 'Failed to duplicate sprite: ' + e.message }`

- [x] Task 2: 修复 get_system_info 工具 — 改用主进程 IPC 获取真实系统信息
  - [x] SubTask 2.1: 在 `src-main/windows/editor.js` 中新增 `this.ipc.handle('get-ai-system-info', ...)` handler，使用文件顶部已 require 的 `os` 模块（Node.js 原生）返回完整系统信息：CPU model/cores/speed、architecture、platform、release、hostname、totalMemory、freeMemory、uptime、userInfo (os.userInfo().username)、homedir、endianness
  - [x] SubTask 2.2: 在 `src-preload/editor.js` 的 `EditorPreload` 对象中新增 `getAISystemInfo: () => ipcRenderer.invoke('get-ai-system-info')`
  - [x] SubTask 2.3: 在 `src-renderer-webpack/editor/gui/desktop-hoc.jsx` 的 `case 'getSystemInfo'` 中，移除 `const os = require('os')` 及所有 `os.xxx()` 调用，改为 `const info = await EditorPreload.getAISystemInfo()`，将返回值直接作为 `result.data`
  - [x] SubTask 2.4: 异常处理：IPC 调用失败时返回 `{ success: false, error: 'Failed to get system info: ' + e.message }`

- [x] Task 3: 修复 set_stage_size 返回值 — 增加 message 字段
  - [x] SubTask 3.1: 在 `src-renderer-webpack/editor/gui/desktop-hoc.jsx` 的 `case 'setStageSize'` 中，将 `result = { success: true, data: { width: width, height: height } }` 改为 `result = { success: true, data: { width: width, height: height, message: 'Stage size set to ' + width + 'x' + height } }`
  - [x] SubTask 3.2: 确认 `break` 语句位置正确（在 try-catch 之外），不存在 fallthrough 到 `clickGreenFlag` 的风险

# Task Dependencies
- Task 2 的 SubTask 2.1（主进程 IPC）和 SubTask 2.2（preload 暴露）需先完成，SubTask 2.3（渲染进程调用）才能实现
- Task 1、Task 2、Task 3 相互独立，可并行执行

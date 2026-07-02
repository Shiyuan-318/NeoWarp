# Debug: AI Assistant Button Click Issues

## Status: [OPEN]

## Problem Description
AI助手页面中：
1. 无法点击设置按钮（settingsBtn）
2. 无法点击新增对话按钮（newChatBtn）- 应弹出AICode/ScratchAgent选择下拉

## Reproduction Steps
1. 打开NeoWarp应用
2. 打开AI助手窗口
3. 尝试点击右上角设置齿轮图标 → 无反应
4. 尝试点击侧边栏顶部的+按钮 → 无反应

## Environment
- Electron with sandbox: true, contextIsolation: true
- Custom protocol: tw-ai-assistant://
- CSP: script-src 'unsafe-inline' allowed
- Window: 1040x640

## Hypotheses
| ID | Hypothesis | Likelihood | Effort | Expected Signal |
|----|------------|------------|--------|-----------------|
| A | Element covered by overlay (z-index/pointer-events issue) | High | Low | Click event not reaching button, elementFromPoint returns different element |
| B | JS error prevents event listener binding | Medium | Low | setupEvents/setupSidebarEvents not called or throws |
| C | CSS overflow:hidden clips interactive elements | Medium | Low | getBoundingClientRect shows 0 size or offscreen position |
| D | Electron sandbox blocks click events | Low | Medium | addEventListener succeeds but callback never fires |

## Progress
- Step 1-2: Initialized
- Step 3-4: Instrumentation pending

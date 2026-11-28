/* NeoWarp 扩展编辑器 —— AI 面板共享模块
 * 同一个面板工厂同时服务两个场景：
 *  - 停靠在扩展编辑器右侧的侧栏（extension-editor.html）
 *  - 弹出的独立 AI 窗口（ai-panel.html）
 * 调用方通过 options 注入差异点：取代码、插入代码、设置读写、状态变化上报。
 */
(function () {
  'use strict';

  var STRINGS = {
    zh: {
      aiTitle: 'AI 助手',
      saved: '已保存',
      aiSettings: 'AI 设置',
      clearChat: '清空对话',
      model: '模型',
      channel: '渠道',
      openSettings: '打开设置',
      manageHint: '模型与 API Key 在「设置 → AI 模型」中管理，与 AI 助手、NeoWarp SOLO 共用。',
      noConfigs: '还没有模型配置，点「打开设置」添加',
      freeModelsTitle: '免费模型',
      myModelsTitle: '我的模型',
      freeEnded: '免费使用活动已结束',
      inputPlaceholder: '询问关于代码的问题…',
      send: '发送',
      stop: '停止生成',
      noApiKey: '请先在设置中选择模型并填写 API Key',
      insertCode: '插入',
      replaceCode: '替换全文',
      confirmReplace: '确认替换？',
      copyCode: '复制',
      copied: '已复制到剪贴板',
      copiedShort: '已复制',
      inserted: '代码已插入编辑器',
      requestFailed: '请求失败：',
      reasoningTitle: '思考过程',
      noAnswer: '模型没有给出最终回答，可在上方「思考过程」中查看它的推理。',
      welcomeTitle: '扩展开发助手',
      welcome: '我会自动读取编辑器里的当前代码，并可直接把修改写入编辑器（Ctrl+Z 可撤销）。试试下面的快捷操作：',
      quickExplain: '解释当前代码',
      quickOptimize: '优化这段代码',
      quickAddBlock: '添加一个积木',
      quickFix: '检查并修复问题',
      quickEdit: '直接改代码',
      promptExplain: '请解释当前代码的功能和整体结构。',
      promptOptimize: '请审查当前代码，指出可以优化的地方，并给出修改后的代码。',
      promptAddBlock: '请基于当前扩展，帮我再添加一个实用的积木（Block），给出完整代码。',
      promptFix: '请检查当前代码是否存在问题（语法、逻辑、API 用法），并给出修复方案。',
      promptEdit: '请帮我完善当前扩展：补充一个实用的积木并修复潜在问题，直接修改代码。',
      autoApplyLabel: '允许 AI 直接改代码',
      autoApplyHint: '开启后，AI 的修改会自动写入编辑器，随时可以 Ctrl+Z 撤销',
      editCard: '直接修改',
      editReplace: '替换全文',
      editInsert: '插入光标处',
      editPatch: '局部替换',
      editApplying: '正在应用…',
      editApplied: '已写入编辑器',
      editFailed: '应用失败',
      editDisabled: '自动修改已关闭',
      editApply: '应用此修改',
      systemPrompt: '你是 NeoWarp 的扩展开发助手，帮助用户编写和调试 TurboWarp/Scratch 扩展的 JavaScript 代码。' +
        '回答使用简体中文，代码注释可使用中文。给出代码时使用 Markdown 代码块。\n' +
        '\n' +
        '## TurboWarp 扩展开发规范教程\n' +
        '\n' +
        '### 1. 扩展基本结构\n' +
        '扩展是一个对象，通过 getInfo() 描述自己，并交给 Scratch.extensions.register 注册：\n' +
        '```javascript\n' +
        '(function (Scratch) {\n' +
        "  'use strict';\n" +
        '  class MyExtension {\n' +
        '    constructor (runtime) {\n' +
        '      this.runtime = runtime;\n' +
        '    }\n' +
        '    getInfo () {\n' +
        '      return {\n' +
        "        id: 'myextension',  // 全局唯一 ID，只能用小写字母和数字\n" +
        "        name: '我的扩展',\n" +
        "        color1: '#4C97FF',  // 积木主色\n" +
        "        color2: '#3373CC',  // 积木深色（可选）\n" +
        '        blocks: [],         // 积木定义\n' +
        '        menus: {}           // 下拉菜单（可选）\n' +
        '      };\n' +
        '    }\n' +
        '  }\n' +
        '  Scratch.extensions.register(new MyExtension());\n' +
        '})(Scratch);\n' +
        '```\n' +
        '如需访问网络、DOM 等浏览器能力，必须声明未沙盒化（在 register 之前）：\n' +
        '`Scratch.extensions.unsandboxed = true;`\n' +
        '\n' +
        '### 2. 积木定义\n' +
        'blocks 数组的每一项可以用数组简写或对象形式，五类积木：\n' +
        '- 命令块：`[\'opcode\', \'command\', \'显示文本 [ARG]\']`\n' +
        '- 返回块（数值/字符串）：`[\'opcode\', \'reporter\', \'…\']`\n' +
        '- 布尔块：`[\'opcode\', \'boolean\', \'…\']`\n' +
        '- 帽子块：`[\'opcode\', \'hat\', \'当 …\']`\n' +
        '- 分隔标签：`[\'---\', \'label\', \'分组文字\']`\n' +
        '显示文本中 `[ARG]` 是参数占位符。对象形式用 arguments 描述参数：\n' +
        '```javascript\n' +
        '{\n' +
        "  opcode: 'myBlock',\n" +
        '  blockType: Scratch.BlockType.COMMAND,\n' +
        "  text: '设置 [NAME] 为 [VALUE]',\n" +
        '  arguments: {\n' +
        '    NAME: {type: Scratch.ArgumentType.STRING, defaultValue: "score"},\n' +
        '    VALUE: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0}\n' +
        '  }\n' +
        '}\n' +
        '```\n' +
        '参数类型：NUMBER、STRING、BOOLEAN（六边形输入框）、ANGLE、COLOR、COSTUME、SOUND、BROADCAST、MATRIX、NOTE 等。\n' +
        '\n' +
        '### 3. 下拉菜单\n' +
        '```javascript\n' +
        'menus: {\n' +
        '  choices: {\n' +
        '    acceptReporters: true,          // 是否允许塞入返回块\n' +
        "    items: ['选项A', '选项B']        // 也可以是 () => [...] 动态返回\n" +
        '  }\n' +
        '}\n' +
        '```\n' +
        '菜单参数在 arguments 中写成 `{type: Scratch.ArgumentType.STRING, menu: "choices"}`。\n' +
        '\n' +
        '### 4. 积木实现\n' +
        '方法名与 opcode 一致，第一个参数是 args 对象（键为参数名），this 指向扩展实例：\n' +
        '```javascript\n' +
        'myBlock (args) {\n' +
        '  const name = String(args.NAME);\n' +
        '  const value = Number(args.VALUE);\n' +
        '  // 读写舞台数据：\n' +
        '  const stage = this.runtime.getTargetForStage();\n' +
        '  // 所有角色：this.runtime.targets\n' +
        '  // 触发帽子块：this.runtime.startHats(...)\n' +
        '  // 修改扩展数据后通知运行时：this.runtime.emitProjectChanged()\n' +
        '}\n' +
        '```\n' +
        '\n' +
        '### 5. 常用 API 与注意事项\n' +
        '- `Scratch.vm`：虚拟机实例（`Scratch.vm.runtime`、`Scratch.vm.renderer` 等）\n' +
        '- `Scratch.renderer`：渲染器，用于创建/操作皮肤与可绘制对象\n' +
        '- `Scratch.ArgumentType` / `Scratch.BlockType` / `Scratch.extensions.categoryColors`：枚举与配色\n' +
        '- 运行时常用：`runtime.stageWidth/stageHeight`、`runtime.ioDevices`、`runtime.targets`\n' +
        '- 代码必须兼容严格模式，不要使用 alert/confirm 等阻塞式弹窗\n' +
        '- 需要整体重写或大范围修改时，给出修改后的完整文件代码，用户可一键替换编辑器全部内容；小范围修改给出片段即可\n' +
        '写扩展代码时请严格遵循以上规范，确保给出的代码完整、可直接加载运行。\n' +
        '\n' +
        '## 直接修改编辑器代码\n' +
        '当用户要求你编写、补充、优化或修复扩展时，你必须真正修改文件，而不能只给建议。' +
        '先用一两句话说明打算怎么改，然后输出一个或多个修改块；修改块必须原样输出，不能放进 Markdown 代码块，' +
        '也不要用省略号省略代码。编辑器会自动应用这些修改（用户可在 AI 设置里关闭自动应用）。\n' +
        '替换整个文件（大范围修改时使用，必须给出完整文件）：\n' +
        '<neowarp-edit action="replace">\n' +
        '```javascript\n' +
        '完整文件代码\n' +
        '```\n' +
        '</neowarp-edit>\n' +
        '在光标位置插入代码：\n' +
        '<neowarp-edit action="insert">\n' +
        '```javascript\n' +
        '要插入的代码\n' +
        '```\n' +
        '</neowarp-edit>\n' +
        '局部替换（find 内容必须与当前文件里的原文完全一致）：\n' +
        '<neowarp-edit action="patch">\n' +
        '<neowarp-find>\n' +
        '原始代码片段\n' +
        '</neowarp-find>\n' +
        '<neowarp-with>\n' +
        '替换后的代码片段\n' +
        '</neowarp-with>\n' +
        '</neowarp-edit>\n' +
        '用户只是提问、解释、翻译时不要输出修改块。'
    },
    en: {
      aiTitle: 'AI Assistant',
      saved: 'Saved',
      aiSettings: 'AI Settings',
      clearChat: 'Clear chat',
      model: 'Model',
      channel: 'Channel',
      openSettings: 'Open settings',
      manageHint: 'Models and API keys live in Settings → AI Models, shared with the NeoWarp AI assistant and SOLO.',
      noConfigs: 'No model configs yet — open settings to add one',
      freeModelsTitle: 'Free models',
      myModelsTitle: 'My models',
      freeEnded: 'Free offer has ended',
      inputPlaceholder: 'Ask about your code…',
      send: 'Send',
      stop: 'Stop generating',
      noApiKey: 'Pick a model and set an API key in Settings first',
      insertCode: 'Insert',
      replaceCode: 'Replace file',
      confirmReplace: 'Confirm replace?',
      copyCode: 'Copy',
      copied: 'Copied to clipboard',
      copiedShort: 'Copied',
      inserted: 'Code inserted into editor',
      requestFailed: 'Request failed: ',
      reasoningTitle: 'Thinking',
      noAnswer: 'The model returned no final answer; its reasoning is shown above.',
      welcomeTitle: 'Extension Developer Assistant',
      welcome: 'I automatically read the code in the editor and can apply changes directly (undo with Ctrl+Z). Try a quick action:',
      quickExplain: 'Explain this code',
      quickOptimize: 'Optimize this code',
      quickAddBlock: 'Add a block',
      quickFix: 'Check & fix issues',
      quickEdit: 'Edit the code',
      promptExplain: 'Please explain what the current code does and how it is structured.',
      promptOptimize: 'Please review the current code, point out improvements, and provide the revised code.',
      promptAddBlock: 'Based on the current extension, please add one more useful block and give me the complete code.',
      promptFix: 'Please check the current code for problems (syntax, logic, API usage) and provide fixes.',
      promptEdit: 'Improve the current extension: add a useful block, fix potential issues, and edit the code directly.',
      autoApplyLabel: 'Let AI edit code directly',
      autoApplyHint: 'When enabled, AI edits are applied to the editor automatically and can be undone with Ctrl+Z',
      editCard: 'Direct edit',
      editReplace: 'Replace file',
      editInsert: 'Insert at cursor',
      editPatch: 'Replace snippet',
      editApplying: 'Applying…',
      editApplied: 'Applied to editor',
      editFailed: 'Apply failed',
      editDisabled: 'Auto-apply is off',
      editApply: 'Apply this edit',
      systemPrompt: 'You are the NeoWarp extension development assistant. You help users write and debug JavaScript code ' +
        'for TurboWarp/Scratch extensions. Reply in English. Use Markdown code blocks for code.\n' +
        '\n' +
        '## TurboWarp Extension Development Tutorial\n' +
        '\n' +
        '### 1. Basic extension structure\n' +
        'An extension is an object that describes itself through getInfo() and registers itself with Scratch.extensions.register:\n' +
        '```javascript\n' +
        '(function (Scratch) {\n' +
        "  'use strict';\n" +
        '  class MyExtension {\n' +
        '    constructor (runtime) {\n' +
        '      this.runtime = runtime;\n' +
        '    }\n' +
        '    getInfo () {\n' +
        '      return {\n' +
        "        id: 'myextension',  // globally unique ID, lowercase letters and digits only\n" +
        "        name: 'My Extension',\n" +
        "        color1: '#4C97FF',  // primary block color\n" +
        "        color2: '#3373CC',  // darker shade (optional)\n" +
        '        blocks: [],         // block definitions\n' +
        '        menus: {}           // dropdown menus (optional)\n' +
        '      };\n' +
        '    }\n' +
        '  }\n' +
        '  Scratch.extensions.register(new MyExtension());\n' +
        '})(Scratch);\n' +
        '```\n' +
        'To access the network, DOM, and other browser capabilities, declare the extension as unsandboxed (before registering):\n' +
        '`Scratch.extensions.unsandboxed = true;`\n' +
        '\n' +
        '### 2. Block definitions\n' +
        'Each entry in the blocks array can use the array shorthand or the object form. Five block types:\n' +
        '- Command: `[\'opcode\', \'command\', \'text [ARG]\']`\n' +
        '- Reporter (number/string): `[\'opcode\', \'reporter\', \'…\']`\n' +
        '- Boolean: `[\'opcode\', \'boolean\', \'…\']`\n' +
        '- Hat: `[\'opcode\', \'hat\', \'when …\']`\n' +
        '- Label: `[\'---\', \'label\', \'section text\']`\n' +
        '`[ARG]` in the text is a placeholder for an argument. The object form describes arguments via "arguments":\n' +
        '```javascript\n' +
        '{\n' +
        "  opcode: 'myBlock',\n" +
        '  blockType: Scratch.BlockType.COMMAND,\n' +
        "  text: 'set [NAME] to [VALUE]',\n" +
        '  arguments: {\n' +
        '    NAME: {type: Scratch.ArgumentType.STRING, defaultValue: "score"},\n' +
        '    VALUE: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0}\n' +
        '  }\n' +
        '}\n' +
        '```\n' +
        'Argument types: NUMBER, STRING, BOOLEAN (hexagonal input), ANGLE, COLOR, COSTUME, SOUND, BROADCAST, MATRIX, NOTE, etc.\n' +
        '\n' +
        '### 3. Dropdown menus\n' +
        '```javascript\n' +
        'menus: {\n' +
        '  choices: {\n' +
        '    acceptReporters: true,          // allow reporter blocks inside the input\n' +
        "    items: ['Option A', 'Option B'] // or () => [...] for dynamic items\n" +
        '  }\n' +
        '}\n' +
        '```\n' +
        'A menu argument is declared as `{type: Scratch.ArgumentType.STRING, menu: "choices"}`.\n' +
        '\n' +
        '### 4. Block implementation\n' +
        'The method name matches the opcode. The first parameter is the args object (keys are argument names); "this" is the extension instance:\n' +
        '```javascript\n' +
        'myBlock (args) {\n' +
        '  const name = String(args.NAME);\n' +
        '  const value = Number(args.VALUE);\n' +
        '  // Stage data: this.runtime.getTargetForStage()\n' +
        '  // All sprites: this.runtime.targets\n' +
        '  // Trigger hats: this.runtime.startHats(...)\n' +
        '  // Notify the runtime after mutating extension data: this.runtime.emitProjectChanged()\n' +
        '}\n' +
        '```\n' +
        '\n' +
        '### 5. Common APIs and notes\n' +
        '- `Scratch.vm`: the virtual machine (`Scratch.vm.runtime`, `Scratch.vm.renderer`, …)\n' +
        '- `Scratch.renderer`: create/manipulate skins and drawables\n' +
        '- `Scratch.ArgumentType` / `Scratch.BlockType` / `Scratch.extensions.categoryColors`: enums and palette\n' +
        '- Runtime essentials: `runtime.stageWidth/stageHeight`, `runtime.ioDevices`, `runtime.targets`\n' +
        '- Code must be strict-mode compatible; never use alert/confirm or other blocking dialogs\n' +
        '- For full rewrites or sweeping changes, output the complete revised file so the user can replace the editor content in one click; small changes can stay as snippets\n' +
        'Follow this specification strictly so the extension code you produce is complete and loadable as-is.\n' +
        '\n' +
        '## Editing the editor directly\n' +
        'When the user asks you to write, extend, optimize or fix an extension, you must actually change the file instead of only giving advice. ' +
        'Briefly explain the plan in one or two sentences, then emit one or more edit blocks. Emit the blocks verbatim, never wrap them in a Markdown code fence, ' +
        'and never abbreviate the code with ellipses. The editor applies these edits automatically (auto-apply can be disabled in AI settings).\n' +
        'Replace the whole file (use for sweeping changes; include the complete file):\n' +
        '<neowarp-edit action="replace">\n' +
        '```javascript\n' +
        'complete file code\n' +
        '```\n' +
        '</neowarp-edit>\n' +
        'Insert code at the cursor:\n' +
        '<neowarp-edit action="insert">\n' +
        '```javascript\n' +
        'code to insert\n' +
        '```\n' +
        '</neowarp-edit>\n' +
        'Replace a snippet (find must match the existing source exactly):\n' +
        '<neowarp-edit action="patch">\n' +
        '<neowarp-find>\n' +
        'original snippet\n' +
        '</neowarp-find>\n' +
        '<neowarp-with>\n' +
        'replacement snippet\n' +
        '</neowarp-with>\n' +
        '</neowarp-edit>\n' +
        'Do not emit edit blocks when the user only asks a question, an explanation or a translation.'
    }
  };

  // 与 NeoWarp AI 助手（ai-assistant.html）一致的完整服务商/模型表
  // 模型信息更新于 2026-11，来源：各厂商官方模型/定价文档；已停售/退役的
  // 旧模型不再列出（DeepSeek v4-flash、Qwen3.7-max/Qwen3.6 等）。
  var PROVIDERS = {
    openai: {
      name: 'OpenAI',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      models: [
        {id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol'},
        {id: 'gpt-6.2-astra', name: 'GPT-6.2 Astra'},
        {id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol'},
        {id: 'gpt-6-sol', name: 'GPT-6 Sol'},
        {id: 'gpt-6-luna', name: 'GPT-6 Luna'},
        {id: 'gpt-6-astra', name: 'GPT-6 Astra'},
        {id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol'},
        {id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra'},
        {id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna'},
        {id: 'gpt-5.5', name: 'GPT-5.5'},
        {id: 'gpt-5.4', name: 'GPT-5.4'},
        {id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini'},
        {id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano'},
        {id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex'}
      ],
      defaultModel: 'gpt-6.2-sol'
    },
    deepseek: {
      name: 'DeepSeek',
      endpoint: 'https://api.deepseek.com/chat/completions',
      models: [
        {id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro'},
        {id: 'deepseek-flash', name: 'DeepSeek Flash'}
      ],
      defaultModel: 'deepseek-v4-pro'
    },
    glm: {
      name: 'Zhipu GLM',
      endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      models: [
        {id: 'glm-5.4', name: 'GLM-5.4'},
        {id: 'glm-5.3', name: 'GLM-5.3'},
        {id: 'glm-5.3-flash', name: 'GLM-5.3 Flash'},
        {id: 'glm-5.3-flashx', name: 'GLM-5.3 FlashX'},
        {id: 'glm-5.2', name: 'GLM-5.2'}
      ],
      defaultModel: 'glm-5.4'
    },
    kimi: {
      name: 'Kimi (Moonshot)',
      endpoint: 'https://api.moonshot.cn/v1/chat/completions',
      models: [
        {id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro'},
        {id: 'kimi-k3.1-pro-highspeed', name: 'Kimi K3.1 Pro Highspeed'},
        {id: 'kimi-k3', name: 'Kimi K3'},
        {id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code'},
        {id: 'kimi-k2.6', name: 'Kimi K2.6'}
      ],
      defaultModel: 'kimi-k3.1-pro'
    },
    gemini: {
      name: 'Google Gemini',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      models: [
        {id: 'gemini-4-argon', name: 'Gemini 4 Argon'},
        {id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash'}
      ],
      defaultModel: 'gemini-4-argon'
    },
    huaweipangu: {
      name: 'Huawei Pangu',
      endpoint: 'https://api.huaweicloud.com/api/v2/chat/completions',
      models: [
        {id: 'pangu-2.0-pro', name: 'Pangu 2.0 Pro'},
        {id: 'pangu-2.0-flash', name: 'Pangu 2.0 Flash'}
      ],
      defaultModel: 'pangu-2.0-pro'
    },
    qwen: {
      name: 'Qwen',
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      models: [
        {id: 'qwen3.8-max', name: 'Qwen3.8 Max'},
        {id: 'qwen3.8-flash', name: 'Qwen3.8 Flash'},
        {id: 'qwen3.7-plus', name: 'Qwen3.7 Plus'},
        {id: 'qwen3.7-flash', name: 'Qwen3.7 Flash'}
      ],
      defaultModel: 'qwen3.7-plus'
    },
    // Anthropic 原生协议：请求体/鉴权头/流式事件都与 OpenAI 不同
    anthropic: {
      name: 'Anthropic',
      endpoint: 'https://api.anthropic.com/v1/messages',
      apiFormat: 'anthropic',
      models: [
        {id: 'claude-fable-5', name: 'Claude Fable 5'},
        {id: 'claude-opus-5', name: 'Claude Opus 5'},
        {id: 'claude-sonnet-5', name: 'Claude Sonnet 5'},
        {id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5'}
      ],
      defaultModel: 'claude-sonnet-5'
    },
    // Ollama 本地推理（/api/chat）
    ollama: {
      name: 'Ollama',
      endpoint: 'http://localhost:11434/api/chat',
      apiFormat: 'ollama',
      models: [
        {id: 'llama3.3', name: 'Llama 3.3'},
        {id: 'qwen3', name: 'Qwen3'},
        {id: 'deepseek-r1', name: 'DeepSeek R1'},
        {id: 'gemma3', name: 'Gemma 3'}
      ],
      defaultModel: 'llama3.3'
    },
    custom: {
      name: 'Custom',
      nameEn: 'Custom',
      nameZh: '自定义',
      endpoint: '',
      isCustom: true,
      models: [],
      defaultModel: ''
    }
  };

  /**
   * 创建 AI 面板。
   * @param {object} options
   * @param {'zh'|'en'} options.lang
   * @param {() => (Promise<{name: string, content: string}|null>|{name: string, content: string}|null)} options.getCode
   * @param {(code: string) => void} options.insertCode
   * @param {(code: string) => void} [options.replaceCode] 用代码替换编辑器整个文件内容（带二次确认）
   * @param {(edit: {action: string, code?: string, find?: string, with?: string}) => boolean|Promise<boolean>} [options.applyEdit]
   *   应用 AI 编辑指令（replace / insert / patch）；缺省时回退到 replaceCode / insertCode
   * @param {{getSettings: () => Promise<object>, saveSettings: (s: object) => Promise<any>, onChanged: (cb: (s: object) => void) => void}} [options.legacySettingsApi] 已废弃
   * @param {{getConfigs: () => Promise<{configs: Array, activeId: string|null}>, saveActive: (activeId: string, configs: Array) => Promise<any>, onChanged: (cb: (payload: object) => void) => void, openSettings: (section?: string) => void}} options.settingsApi
   *   统一模型配置存储的访问口（AI 助手 / SOLO / 桌面设置共用同一份）
   * @param {(state: {chatHistory: Array}) => void} [options.onStateChanged]
   * @param {() => Promise<string>} [options.getProxyToken] tw-ai-proxy 转发协议的
   *   能力令牌（主进程按窗口来源签发）；缺省走 ExtensionEditorPreload
   */
  function createNeoWarpAiPanel (options) {
    var strings = STRINGS[options.lang] || STRINGS.en;
    var lang = options.lang === 'zh' ? 'zh' : 'en';

    var aiConfig = {provider: 'openai', apiKey: '', model: '', customEndpoint: '', customModelId: '', apiFormat: 'openai'};
    // 统一存储里的全部模型配置与激活项 id
    var modelConfigs = [];
    var activeConfigId = null;
    // 渠道下拉当前选中的 key（会话内记忆，不持久化）
    var currentChannelKey = null;
    var chatHistory = [];
    var streaming = false;
    var abortController = null;

    function $ (id) {
      return document.getElementById(id);
    }

    // 「直接改代码」默认开启；关闭后 AI 仍会给出编辑块，但需手动点卡片上的按钮应用
    var AUTO_APPLY_KEY = 'neowarp.extensionEditor.ai.autoApply';
    function readAutoApply () {
      try {
        var value = window.localStorage.getItem(AUTO_APPLY_KEY);
        return value === null ? true : value === '1';
      } catch (error) {
        return true;
      }
    }
    function writeAutoApply (enabled) {
      try {
        window.localStorage.setItem(AUTO_APPLY_KEY, enabled ? '1' : '0');
      } catch (error) {
        // 隐私模式或自定义协议下 localStorage 不可用时仅保留会话内状态
      }
    }
    function autoApplyEnabled () {
      var checkbox = $('ai-auto-apply');
      return checkbox ? checkbox.checked : true;
    }

    function notifyStateChanged () {
      if (options.onStateChanged) {
        options.onStateChanged(getState());
      }
    }

    // ── Toast ─────────────────────────────────────────────────
    var toastTimer = null;
    function showToast (message) {
      var toast = $('toast');
      if (!toast) return;
      toast.textContent = message;
      toast.classList.add('visible');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toast.classList.remove('visible');
      }, 2600);
    }

    // ── 文案与表单初始化 ──────────────────────────────────────
    function applyStrings () {
      $('ai-title').textContent = strings.aiTitle;
      $('ai-settings-btn').title = strings.aiSettings;
      $('ai-clear-btn').title = strings.clearChat;
      $('ai-model-select-label').textContent = strings.model;
      var channelLabelEl = $('ai-channel-select-label');
      if (channelLabelEl) channelLabelEl.textContent = strings.channel;
      $('ai-open-settings').textContent = strings.openSettings;
      $('ai-settings-hint').textContent = strings.manageHint;
      var autoApplyLabel = $('ai-auto-apply-label');
      if (autoApplyLabel) autoApplyLabel.textContent = strings.autoApplyLabel;
      var autoApplyHint = $('ai-auto-apply-hint');
      if (autoApplyHint) autoApplyHint.textContent = strings.autoApplyHint;
      var autoApplyCheckbox = $('ai-auto-apply');
      if (autoApplyCheckbox) autoApplyCheckbox.checked = readAutoApply();
      $('ai-input').placeholder = strings.inputPlaceholder;
      $('ai-send').title = strings.send;
    }

    function init () {
      applyStrings();

      $('ai-settings-btn').addEventListener('click', toggleSettings);
      $('ai-model-chip').addEventListener('click', toggleSettings);
      $('ai-clear-btn').addEventListener('click', clearChat);
      $('ai-model-select').addEventListener('change', onModelSelectChanged);
      var channelSelectEl = $('ai-channel-select');
      if (channelSelectEl) channelSelectEl.addEventListener('change', onChannelSelectChanged);
      var autoApplyCheckbox = $('ai-auto-apply');
      if (autoApplyCheckbox) {
        autoApplyCheckbox.addEventListener('change', function () {
          writeAutoApply(autoApplyCheckbox.checked);
        });
      }
      $('ai-open-settings').addEventListener('click', openAppSettings);
      $('ai-send').addEventListener('click', onSendClicked);
      $('ai-input').addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          onSendClicked();
        }
      });
      $('ai-input').addEventListener('input', autoResizeInput);

      showWelcome();

      if (options.settingsApi.getConfigs) {
        options.settingsApi.getConfigs().then(applyModelConfigs);
      }
      if (options.settingsApi.onChanged) {
        options.settingsApi.onChanged(applyModelConfigs);
      }
    }

    // 模型与 API Key 的管理入口已移至应用设置（桌面设置窗口 → AI 模型）
    function openAppSettings () {
      if (options.settingsApi.openSettings) {
        // 'ai'：直达桌面设置的 AI 模型页
        options.settingsApi.openSettings('ai');
      }
    }

    function toggleSettings () {
      $('ai-settings').classList.toggle('open');
    }

    function clearChat () {
      chatHistory = [];
      $('ai-messages').innerHTML = '';
      showWelcome();
      notifyStateChanged();
    }

    // 采用统一存储发来的配置列表与激活项（初始化拉取与广播共用）
    function applyModelConfigs (payload) {
      modelConfigs = (payload && payload.configs) || [];
      activeConfigId = (payload && payload.activeId) || null;
      if (!modelConfigs.some(function (c) { return c.id === activeConfigId; })) {
        activeConfigId = modelConfigs.length ? modelConfigs[0].id : null;
      }
      applyActiveToAiConfig(activeConfig());
      fillChannelSelect();
      fillModelSelect();
      updateModelChip();
    }

    function activeConfig () {
      return modelConfigs.find(function (c) { return c.id === activeConfigId; }) ||
        modelConfigs[0] || null;
    }

    function applyActiveToAiConfig (cfg) {
      cfg = cfg || null;
      aiConfig.provider = cfg ? (cfg.provider || 'openai') : 'openai';
      aiConfig.apiKey = cfg ? (cfg.apiKey || '') : '';
      aiConfig.model = cfg ? (cfg.model || '') : '';
      aiConfig.customEndpoint = cfg ? (cfg.customEndpoint || '') : '';
      aiConfig.customModelId = cfg ? (cfg.customModelId || '') : '';
      aiConfig.apiFormat = cfg ? (cfg.apiFormat || 'openai') : 'openai';
    }

    function modelConfigLabel (cfg) {
      // 优先显示模型 ID（与顶部徽标一致），没有再回退渠道名 / 服务商名
      var provider = PROVIDERS[cfg.provider] || {};
      var modelId = provider.isCustom
        ? (cfg.customModelId || cfg.model)
        : cfg.model;
      var providerLabel = (lang === 'zh' ? (provider.nameZh || provider.name) : (provider.nameEn || provider.name)) || 'Model';
      return modelId || cfg.name || providerLabel;
    }

    // ── 免费模型活动 ──
    // 截止时间与主进程 ai-model-configs.js 的 FREE_MODEL_END_AT 一致：
    // 2026-11-30 12:00:00（UTC+8）＝ 04:00 UTC。过期后免费模型禁选。
    var FREE_MODEL_END_AT = Date.UTC(2026, 10, 30, 4, 0, 0);
    function isFreeModelConfig (cfg) {
      return !!cfg && (cfg.isFree === true || String(cfg.id || '').indexOf('free_') === 0);
    }
    function isFreeModelExpired (cfg) {
      return isFreeModelConfig(cfg) && (cfg.freeExpired === true || Date.now() >= FREE_MODEL_END_AT);
    }

    // ── 渠道分组（与 AI 助手选择器同口径）──
    // 渠道 = 同一服务商 / 同一接口地址下的一组模型配置：自定义或带自定义
    // 端点的配置按端点归一化后分组，预设厂商按 provider 分组。
    function normalizeCustomEndpoint (url, apiFormat) {
      var u = String(url || '').trim();
      if (!u) return u;
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      u = u.replace(/\/+$/, '');
      if (apiFormat === 'anthropic') {
        if (/\/v1\/messages$/i.test(u)) return u;
        if (/\/v1$/i.test(u)) return u + '/messages';
        return u + '/v1/messages';
      }
      if (apiFormat === 'ollama') {
        if (/\/api\/chat$/i.test(u)) return u;
        if (!/\/api$/i.test(u)) u += '/api';
        return u + '/chat';
      }
      if (/\/(v1\/messages|api\/chat)$/i.test(u)) return u;
      if (!/\/chat\/completions$/i.test(u)) u += '/chat/completions';
      return u;
    }

    function hostOfEndpoint (url) {
      return String(url || '').replace(/^https?:\/\//i, '').split('/')[0];
    }

    function providerLabel (provider) {
      return (lang === 'zh' ? (provider.nameZh || provider.name) : (provider.nameEn || provider.name)) || '';
    }

    function channelKeyOf (cfg) {
      var provider = PROVIDERS[cfg.provider] || {};
      if (provider.isCustom || cfg.customEndpoint) {
        var apiFormat = (provider.apiFormat === 'anthropic' || provider.apiFormat === 'ollama') ? provider.apiFormat : cfg.apiFormat;
        return 'ep:' + normalizeCustomEndpoint(cfg.customEndpoint || '', apiFormat);
      }
      return 'pr:' + cfg.provider;
    }

    function channelTitleOfGroup (group) {
      for (var i = 0; i < group.configs.length; i++) {
        if (group.configs[i].name) return group.configs[i].name;
      }
      var first = group.configs[0];
      var provider = PROVIDERS[first.provider] || {};
      if (provider.isCustom || first.customEndpoint) {
        var apiFormat = (provider.apiFormat === 'anthropic' || provider.apiFormat === 'ollama') ? provider.apiFormat : first.apiFormat;
        return hostOfEndpoint(normalizeCustomEndpoint(first.customEndpoint || '', apiFormat)) || providerLabel(provider) || 'API';
      }
      return providerLabel(provider) || 'API';
    }

    function buildChannelGroups () {
      var groups = [];
      var index = {};
      modelConfigs.forEach(function (cfg) {
        if (!cfg) return;
        var key = channelKeyOf(cfg);
        if (index[key] === undefined) {
          index[key] = groups.length;
          groups.push({key: key, configs: []});
        }
        groups[index[key]].configs.push(cfg);
      });
      return groups;
    }

    function configsOfChannel (key) {
      var group = buildChannelGroups().find(function (g) { return g.key === key; });
      return group ? group.configs : [];
    }

    function fillChannelSelect () {
      var select = $('ai-channel-select');
      if (!select) return;
      select.innerHTML = '';
      var groups = buildChannelGroups();
      if (!groups.length) {
        var empty = document.createElement('option');
        empty.value = '';
        empty.textContent = strings.noConfigs;
        select.appendChild(empty);
        select.value = '';
        select.disabled = true;
        return;
      }
      select.disabled = false;
      groups.forEach(function (group) {
        var option = document.createElement('option');
        option.value = group.key;
        option.textContent = channelTitleOfGroup(group);
        select.appendChild(option);
      });
      // 当前渠道失效（配置被删除 / 广播更新）时回退：优先激活配置所在渠道
      var valid = groups.some(function (group) { return group.key === currentChannelKey; });
      if (!valid) {
        var activeCfg = activeConfig();
        var activeKey = activeCfg ? channelKeyOf(activeCfg) : null;
        currentChannelKey = groups.some(function (group) { return group.key === activeKey; }) ? activeKey : groups[0].key;
      }
      select.value = currentChannelKey;
    }

    function fillModelSelect () {
      var select = $('ai-model-select');
      if (!select) return;
      select.innerHTML = '';
      var channelConfigs = configsOfChannel(currentChannelKey);
      if (!channelConfigs.length) {
        var empty = document.createElement('option');
        empty.value = '';
        empty.textContent = strings.noConfigs;
        select.appendChild(empty);
        select.value = '';
        select.disabled = true;
        return;
      }
      select.disabled = false;
      // 只列当前渠道下的模型；活动结束的免费模型禁用（无法选中）
      var usable = [];
      channelConfigs.forEach(function (cfg) {
        var option = document.createElement('option');
        option.value = cfg.id;
        var expired = isFreeModelExpired(cfg);
        option.textContent = modelConfigLabel(cfg) + (expired ? '（' + strings.freeEnded + '）' : '');
        option.disabled = expired;
        select.appendChild(option);
        if (!expired) usable.push(cfg);
      });
      // 优先选中激活配置；其不属于该渠道时选第一条可用项
      // （不在此处改激活项，由渠道切换逻辑负责）
      var activeInChannel = usable.some(function (cfg) { return cfg.id === activeConfigId; });
      select.value = activeInChannel ? activeConfigId : (usable.length ? usable[0].id : '');
    }

    // 把激活项写回统一存储（列表一并传回，避免漏传被当成清空）
    function persistActive () {
      if (!options.settingsApi.saveActive) return;
      options.settingsApi.saveActive(activeConfigId, modelConfigs).then(function () {
        showToast(strings.saved || 'Saved');
      });
    }

    // 切换模型：立即生效并写回统一存储
    function onModelSelectChanged () {
      var id = $('ai-model-select').value;
      if (!id || id === activeConfigId) return;
      activeConfigId = id;
      applyActiveToAiConfig(activeConfig());
      updateModelChip();
      persistActive();
    }

    // 切换渠道：若激活配置不属于该渠道，自动切到该渠道第一条可用模型
    function onChannelSelectChanged () {
      currentChannelKey = $('ai-channel-select').value;
      var usable = configsOfChannel(currentChannelKey).filter(function (cfg) {
        return !isFreeModelExpired(cfg);
      });
      var activeInChannel = usable.some(function (cfg) { return cfg.id === activeConfigId; });
      if (!activeInChannel && usable.length) {
        activeConfigId = usable[0].id;
        applyActiveToAiConfig(activeConfig());
        updateModelChip();
        persistActive();
      }
      fillModelSelect();
    }

    function getEffectiveModelId () {
      var provider = PROVIDERS[aiConfig.provider];
      if (!provider) return aiConfig.model || '';
      if (provider.isCustom) {
        return aiConfig.customModelId || aiConfig.model || '';
      }
      var listed = provider.models.some(function (m) { return m.id === aiConfig.model; });
      return listed ? aiConfig.model : provider.defaultModel;
    }

    function getModelDisplayName () {
      var provider = PROVIDERS[aiConfig.provider] || {name: aiConfig.provider};
      var modelId = getEffectiveModelId();
      var found = (provider.models || []).find(function (m) { return m.id === modelId; });
      return found ? found.name : (modelId || provider.name);
    }

    function updateModelChip () {
      var chip = $('ai-model-chip');
      chip.textContent = getModelDisplayName();
      chip.title = getEffectiveModelId();
    }

    // ── 对话 ──────────────────────────────────────────────────
    function onSendClicked () {
      if (streaming) {
        if (abortController) abortController.abort();
        return;
      }
      var input = $('ai-input');
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      autoResizeInput();
      sendChat(text);
    }

    function autoResizeInput () {
      var input = $('ai-input');
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    }

    function buildApiProxyUrl (endpoint, headers, token) {
      var url = 'tw-ai-proxy://request/?u=' + encodeURIComponent(endpoint);
      // 能力令牌：主进程按窗口来源签发，没有令牌的转发请求一律 403
      if (token) url += '&k=' + encodeURIComponent(token);
      if (headers && Object.keys(headers).length) {
        url += '&h=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(headers)))));
      }
      return url;
    }

    // 令牌由主进程签发（有有效期），这里缓存一份；forceRefresh 时重新取
    var proxyTokenCache = null;
    function getProxyToken (forceRefresh) {
      if (forceRefresh) proxyTokenCache = null;
      if (!proxyTokenCache) {
        var bridge = window.ExtensionEditorPreload;
        var getter = options.getProxyToken ||
          (bridge && bridge.getAiProxyToken ? function () { return bridge.getAiProxyToken(); } : null);
        if (!getter) return Promise.reject(new Error('AI proxy bridge unavailable'));
        proxyTokenCache = Promise.resolve(getter()).catch(function (error) {
          proxyTokenCache = null;
          throw error;
        });
      }
      return proxyTokenCache;
    }

    var aiProxyBroken = false;
    async function aiFetch (endpoint, options_) {
      if (aiProxyBroken) return fetch(endpoint, options_);
      try {
        var token = await getProxyToken(false);
        var resp = await fetch(buildApiProxyUrl(endpoint, options_.headers, token), options_);
        if (resp.status === 403) {
          // 令牌可能已过期：作废缓存重取一次再试
          token = await getProxyToken(true);
          resp = await fetch(buildApiProxyUrl(endpoint, options_.headers, token), options_);
        }
        return resp;
      } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        aiProxyBroken = true;
        return fetch(endpoint, options_);
      }
    }

    /**
     * 端点规范化：补什么路径取决于 API 格式。OpenAI 兼容只补
     * /chat/completions（绝不补 /v1），Anthropic 补 /v1/messages，
     * Ollama 补 /api/chat；已带对应聊天路径的端点原样返回。
     * @param {string} url
     * @param {'openai'|'anthropic'|'ollama'} apiFormat
     * @returns {string}
     */
    function normalizeEndpoint (url, apiFormat) {
      var u = String(url || '').trim();
      if (!u) return u;
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      u = u.replace(/\/+$/, '');
      if (apiFormat === 'anthropic') {
        if (/\/v1\/messages$/i.test(u)) return u;
        if (/\/v1$/i.test(u)) return u + '/messages';
        return u + '/v1/messages';
      }
      if (apiFormat === 'ollama') {
        if (/\/api\/chat$/i.test(u)) return u;
        if (!/\/api$/i.test(u)) u += '/api';
        return u + '/chat';
      }
      if (/\/(v1\/messages|api\/chat)$/i.test(u)) return u;
      if (!/\/chat\/completions$/i.test(u)) u += '/chat/completions';
      return u;
    }

    function getRequestTarget () {
      var provider = PROVIDERS[aiConfig.provider] || {};
      // 服务商预设自带格式（Anthropic / Ollama）优先，其次是配置里选定的格式
      var apiFormat = provider.apiFormat === 'anthropic' || provider.apiFormat === 'ollama'
        ? provider.apiFormat
        : (aiConfig.apiFormat === 'anthropic' || aiConfig.apiFormat === 'ollama' ? aiConfig.apiFormat : 'openai');
      var rawEndpoint = aiConfig.customEndpoint || provider.endpoint || '';
      return {
        endpoint: normalizeEndpoint(rawEndpoint, apiFormat),
        model: getEffectiveModelId(),
        apiKey: aiConfig.apiKey,
        apiFormat: apiFormat
      };
    }

    /** 按格式生成鉴权头（Anthropic 用 x-api-key + anthropic-version） */
    function buildAuthHeaders (target) {
      var headers = {'Content-Type': 'application/json'};
      if (target.apiFormat === 'anthropic') {
        if (target.apiKey) headers['x-api-key'] = target.apiKey;
        headers['anthropic-version'] = '2023-06-01';
        headers['anthropic-dangerous-direct-browser-access'] = 'true';
      } else if (target.apiKey) {
        headers['Authorization'] = 'Bearer ' + target.apiKey;
      }
      return headers;
    }

    /** 内部 OpenAI 风格消息 → Anthropic 的 {system, messages} */
    function toAnthropicPayload (apiMessages) {
      var systemParts = [];
      var messages = [];
      (apiMessages || []).forEach(function (m) {
        if (!m || !m.role) return;
        var text = typeof m.content === 'string' ? m.content : String(m.content == null ? '' : m.content);
        if (m.role === 'system') {
          if (text) systemParts.push(text);
          return;
        }
        if (!text) return;
        var role = m.role === 'assistant' ? 'assistant' : 'user';
        var last = messages[messages.length - 1];
        // Anthropic 要求 user / assistant 交替，相邻同角色合并
        if (last && last.role === role) last.content += '\n\n' + text;
        else messages.push({role: role, content: text});
      });
      if (messages.length && messages[0].role !== 'user') {
        messages.unshift({role: 'user', content: 'Continue.'});
      }
      return {system: systemParts.join('\n\n'), messages: messages};
    }

    function toOllamaMessages (apiMessages) {
      return (apiMessages || []).map(function (m) {
        return {
          role: m.role,
          content: typeof m.content === 'string' ? m.content : String(m.content == null ? '' : m.content)
        };
      });
    }

    /** 按格式组装请求体 */
    function buildRequestBody (target, apiMessages) {
      if (target.apiFormat === 'anthropic') {
        var payload = toAnthropicPayload(apiMessages);
        var body = {
          model: target.model,
          max_tokens: 4096,
          stream: true,
          messages: payload.messages
        };
        if (payload.system) body.system = payload.system;
        return body;
      }
      if (target.apiFormat === 'ollama') {
        return {
          model: target.model,
          messages: toOllamaMessages(apiMessages),
          stream: true,
          options: {num_predict: 4096}
        };
      }
      return {model: target.model, messages: apiMessages, stream: true};
    }

    function sendChat (text) {
      var provider = PROVIDERS[aiConfig.provider] || {};
      // Ollama 本地服务默认不校验 Key，不能因为没填 Key 就把对话拦住
      var needsKey = provider.apiFormat !== 'ollama' && aiConfig.apiFormat !== 'ollama';
      if (!aiConfig.apiKey && needsKey) {
        showToast(strings.noApiKey);
        $('ai-settings').classList.add('open');
        return;
      }

      chatHistory.push({role: 'user', content: text});
      addUserBubble(text);

      var target = getRequestTarget();
      var apiMessages = [{role: 'system', content: strings.systemPrompt}];

      var beginRequest = function (codeContext) {
        if (codeContext) {
          apiMessages.push({
            role: 'user',
            content: (lang === 'zh' ? '这是当前文件 ' : 'This is the current file ') + codeContext.name +
              '：\n```javascript\n' + codeContext.content + '\n```'
          });
          apiMessages.push({
            role: 'assistant',
            content: lang === 'zh' ? '好的，我已经阅读了这份代码。' : 'Got it, I have read this code.'
          });
        }
        chatHistory.slice(-10).forEach(function (message) {
          // 只有思考没有正文的历史项不发给模型（空 content 会被部分接口拒绝）
          if (!message.content) return;
          apiMessages.push({role: message.role, content: message.content});
        });
        runStream(target, apiMessages);
      };

      Promise.resolve(options.getCode()).then(beginRequest, function () {
        beginRequest(null);
      });
    }

    // ── AI 编辑指令 ──────────────────────────────────────────
    // 模型在回答里输出 <neowarp-edit> 块；流式结束后由这里解析并写入编辑器。
    // 用文本协议而不是 function calling，兼容 OpenAI / Anthropic / Ollama /
    // 各类中转网关，且不依赖模型是否支持工具调用。
    function stripCodeFence (text) {
      var value = String(text == null ? '' : text).replace(/^\s*\r?\n/, '').replace(/\r?\n\s*$/, '');
      var fenced = /^```[^\n]*\r?\n([\s\S]*?)```\s*$/.exec(value);
      if (fenced) return fenced[1].replace(/\r?\n$/, '');
      return value;
    }

    function parseEditBlock (raw) {
      var head = /<neowarp-edit\b([^>]*)>/i.exec(raw);
      if (!head) return null;
      var actionMatch = /\baction\s*=\s*["']?([a-z-]+)/i.exec(head[1] || '');
      var action = actionMatch ? actionMatch[1].toLowerCase() : 'replace';
      if (action !== 'replace' && action !== 'insert' && action !== 'patch') return null;
      var inner = raw.slice(head.index + head[0].length).replace(/<\/neowarp-edit>\s*$/i, '');
      if (action === 'patch') {
        var findMatch = /<neowarp-find>([\s\S]*?)<\/neowarp-find>/i.exec(inner);
        var withMatch = /<neowarp-with>([\s\S]*?)<\/neowarp-with>/i.exec(inner);
        if (!findMatch || !withMatch) return null;
        var find = stripCodeFence(findMatch[1]);
        if (!find) return null;
        return {action: action, find: find, with: stripCodeFence(withMatch[1])};
      }
      var fenced = /```[^\n]*\r?\n?([\s\S]*?)```/.exec(inner);
      var code = fenced ? fenced[1].replace(/\r?\n$/, '') : stripCodeFence(inner);
      if (!code) return null;
      return {action: action, code: code};
    }

    function parseEditBlocks (text) {
      var blocks = [];
      var regex = /<neowarp-edit\b[^>]*>[\s\S]*?<\/neowarp-edit>/gi;
      var match;
      while ((match = regex.exec(text || '')) !== null) {
        var block = parseEditBlock(match[0]);
        if (block) blocks.push(block);
      }
      return blocks;
    }

    function editStatusText (status) {
      if (status === 'applying') return strings.editApplying;
      if (status === 'applied') return strings.editApplied;
      if (status === 'failed') return strings.editFailed;
      if (status === 'disabled') return strings.editDisabled;
      return '';
    }

    function applyOneEdit (bubble, block, index) {
      var statuses = bubble._editStatuses || [];
      statuses[index] = 'applying';
      renderAssistantContent(bubble, bubble._fullText || '', null);

      var result;
      if (options.applyEdit) {
        result = options.applyEdit({
          action: block.action,
          code: block.code,
          find: block.find,
          with: block.with
        });
      } else if (block.action === 'replace' && options.replaceCode) {
        result = options.replaceCode(block.code);
      } else if (block.action === 'insert') {
        result = options.insertCode(block.code);
      } else {
        result = false;
      }

      return Promise.resolve(result).then(function (ok) {
        statuses[index] = ok === false ? 'failed' : 'applied';
      }, function () {
        statuses[index] = 'failed';
      }).then(function () {
        renderAssistantContent(bubble, bubble._fullText || '', null);
        notifyStateChanged();
        return statuses[index] === 'applied';
      });
    }

    function applyEditBlocks (bubble, blocks) {
      return blocks.reduce(function (chain, block, index) {
        return chain.then(function () {
          return applyOneEdit(bubble, block, index);
        });
      }, Promise.resolve(true));
    }

    /** 流式结束（含用户停止）：解析编辑块、渲染卡片并按需自动应用 */
    function finishAssistantText (bubble, text, reasoning) {
      var displayText = text || (reasoning ? strings.noAnswer : '');
      var blocks = parseEditBlocks(displayText);
      var enabled = autoApplyEnabled();
      bubble._editBlocks = blocks;
      bubble._editStatuses = blocks.map(function () { return enabled ? 'applying' : 'disabled'; });
      if (text || reasoning) {
        chatHistory.push({
          role: 'assistant',
          content: text,
          reasoning: reasoning || undefined,
          edits: bubble._editStatuses
        });
      }
      renderAssistantContent(bubble, displayText, null);
      scrollMessagesToBottom();
      return blocks.length && enabled ? applyEditBlocks(bubble, blocks) : Promise.resolve(false);
    }

    function runStream (target, apiMessages) {
      var bubble = addAssistantBubble('');
      // 首个 token 到达前显示「思考中」指示点
      bubble.classList.add('thinking');
      bubble.innerHTML = '<span class="ai-thinking"><i></i><i></i><i></i></span>';
      scrollMessagesToBottom(true);

      streaming = true;
      updateSendButton();
      abortController = new AbortController();

      var fullText = '';
      var fullReasoning = '';
      var cursor = null;
      var onFirstDelta = function () {
        bubble.classList.remove('thinking');
        cursor = document.createElement('span');
        cursor.className = 'ai-cursor';
      };
      var onReasoningDelta = function (delta) {
        if (!delta) return;
        fullReasoning += delta;
        bubble.classList.remove('thinking');
        clearThinkingDots(bubble);
        appendReasoningDelta(bubble, delta);
        scrollMessagesToBottom();
      };
      // 部分模型把 <think>…</think> 混在正文里，流式拆分后再分别渲染
      var inlineThink = createInlineThinkParser(function (delta) {
        fullText += delta;
        if (!cursor) onFirstDelta();
        renderAssistantContent(bubble, fullText, cursor);
        scrollMessagesToBottom();
      }, onReasoningDelta);
      aiFetch(target.endpoint, {
        method: 'POST',
        headers: buildAuthHeaders(target),
        body: JSON.stringify(buildRequestBody(target, apiMessages)),
        signal: abortController.signal
      }).then(function (response) {
        if (!response.ok) {
          return response.text().then(function (body) {
            throw new Error('HTTP ' + response.status + (body ? ' - ' + body.slice(0, 300) : ''));
          });
        }
        // 与 ai-assistant.html 同一套防护：个别网关用 HTTP 200 应答出错内容
        // （One API / New API 类中转对不带 /v1 的路径会回控制台 HTML），按流
        // 解析永远出不了对话分片，直接呈现原因而不是干等。
        var respCT = String((response.headers && response.headers.get('content-type')) || '');
        if (/text\/html/i.test(respCT)) {
          throw new Error(lang === 'zh'
            ? '端点返回了网页而非对话接口（HTTP 200 + text/html）。One API / New API 类中转的接口地址应带 /v1，例如 https://主机/v1/chat/completions'
            : 'Endpoint returned a webpage instead of a chat API (HTTP 200 + text/html). One API / New API relay endpoints need /v1, e.g. https://host/v1/chat/completions');
        }
        // Ollama 的流式响应是 application/x-ndjson，不能按 application/json 判错
        if (target.apiFormat !== 'ollama' && /^application\/json/i.test(respCT)) {
          return response.json().then(function (j) {
            var msg = (j && j.error && (j.error.message || j.error.type)) ||
              (lang === 'zh' ? '端点返回了 JSON 而非流式响应（HTTP 200），请核对接口地址与 API 格式' : 'Endpoint returned JSON instead of a stream (HTTP 200); check the endpoint and API format');
            throw new Error(msg);
          });
        }
        return readChatStream(response.body.getReader(), target.apiFormat, function (delta) {
          inlineThink.push(delta);
        }, onReasoningDelta).then(inlineThink.flush);
      }).then(function () {
        bubble.classList.remove('thinking');
        if (fullReasoning) finalizeReasoning(bubble);
        return finishAssistantText(bubble, fullText, fullReasoning);
      }).catch(function (error) {
        bubble.classList.remove('thinking');
        if (error && error.name === 'AbortError') {
          inlineThink.flush();
          if (fullReasoning) finalizeReasoning(bubble);
          return finishAssistantText(bubble, fullText, fullReasoning);
        }
        bubble.classList.add('error');
        if (fullReasoning) finalizeReasoning(bubble);
        // 保留已经收到的思考，方便看清失败发生在哪一步
        renderAssistantContent(bubble, strings.requestFailed + String((error && error.message) || error), null);
      }).then(function () {
        streaming = false;
        abortController = null;
        updateSendButton();
        scrollMessagesToBottom();
        notifyStateChanged();
      });
    }

    var OPEN_THINK_TAGS = ['<think>', '<thinking>'];
    var CLOSE_THINK_TAGS = ['</think>', '</thinking>'];

    function findTag (text, tags) {
      var lower = text.toLowerCase();
      var found = null;
      tags.forEach(function (tag) {
        var index = lower.indexOf(tag);
        if (index !== -1 && (!found || index < found.index)) found = {index: index, tag: tag};
      });
      return found;
    }

    function partialTagLength (text, tags) {
      var lower = text.toLowerCase();
      var longest = 0;
      tags.forEach(function (tag) {
        for (var n = Math.min(lower.length, tag.length - 1); n > longest; n--) {
          if (lower.slice(-n) === tag.slice(0, n)) longest = n;
        }
      });
      return longest;
    }

    /**
     * 把正文里混排的 <think>…</think> 拆成思考与回答两路增量。
     * 标签可能跨多个流分片，因此保留「可能是半个标签」的尾巴到下一次。
     */
    function createInlineThinkParser (onText, onReasoning) {
      var buffer = '';
      var inThink = false;
      return {
        push: function (delta) {
          if (!delta) return;
          buffer += delta;
          while (buffer) {
            if (!inThink) {
              var open = findTag(buffer, OPEN_THINK_TAGS);
              if (!open) {
                var keepOpen = partialTagLength(buffer, OPEN_THINK_TAGS);
                var textEnd = buffer.length - keepOpen;
                if (textEnd > 0) {
                  onText(buffer.slice(0, textEnd));
                  buffer = buffer.slice(textEnd);
                }
                break;
              }
              if (open.index > 0) {
                onText(buffer.slice(0, open.index));
                buffer = buffer.slice(open.index);
                continue;
              }
              inThink = true;
              buffer = buffer.slice(open.tag.length);
            } else {
              var close = findTag(buffer, CLOSE_THINK_TAGS);
              if (!close) {
                var keepClose = partialTagLength(buffer, CLOSE_THINK_TAGS);
                var thinkEnd = buffer.length - keepClose;
                if (thinkEnd > 0) {
                  onReasoning(buffer.slice(0, thinkEnd));
                  buffer = buffer.slice(thinkEnd);
                }
                break;
              }
              if (close.index > 0) onReasoning(buffer.slice(0, close.index));
              buffer = buffer.slice(close.index + close.tag.length);
              inThink = false;
            }
          }
        },
        flush: function () {
          if (!buffer) return;
          if (inThink) onReasoning(buffer);
          else onText(buffer);
          buffer = '';
          inThink = false;
        }
      };
    }

    /**
     * 读取流式响应，按格式取出正文与思考增量。
     * - OpenAI 兼容：SSE，choices[0].delta.content / reasoning_content
     * - Anthropic：SSE，content_block_delta 的 text_delta / thinking_delta
     * - Ollama：NDJSON，message.content / message.thinking
     * @param {ReadableStreamDefaultReader} reader
     * @param {'openai'|'anthropic'|'ollama'} apiFormat
     * @param {(delta: string) => void} onDelta
     * @param {(delta: string) => void} onReasoning
     */
    function readChatStream (reader, apiFormat, onDelta, onReasoning) {
      var decoder = new TextDecoder();
      var buffer = '';

      function pump () {
        return reader.read().then(function (result) {
          if (result.done) return;
          buffer += decoder.decode(result.value, {stream: true});
          var lines = buffer.split('\n');
          buffer = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            if (apiFormat === 'ollama') {
              var chunk;
              try {
                chunk = JSON.parse(line);
              } catch (e) {
                continue;
              }
              if (chunk.error) throw new Error(String(chunk.error));
              if (chunk.message) {
                if (chunk.message.thinking) onReasoning(chunk.message.thinking);
                if (chunk.message.reasoning) onReasoning(chunk.message.reasoning);
                if (chunk.message.content) onDelta(chunk.message.content);
              }
              if (chunk.done) return;
              continue;
            }
            if (line.indexOf('data:') !== 0) continue;
            var data = line.slice(5).trim();
            if (!data) continue;
            if (data === '[DONE]') return;
            var json;
            try {
              json = JSON.parse(data);
            } catch (e) {
              // 半截 JSON 等下一批拼上再说（SSE 按行分割，容错跳过即可）
              continue;
            }
            if (apiFormat === 'anthropic') {
              if (json.type === 'error') {
                throw new Error((json.error && (json.error.message || json.error.type)) || 'Anthropic API error');
              }
              if (json.type === 'content_block_start' && json.content_block) {
                if (json.content_block.type === 'text' && json.content_block.text) onDelta(json.content_block.text);
                if (json.content_block.type === 'thinking' && json.content_block.thinking) onReasoning(json.content_block.thinking);
              } else if (json.type === 'content_block_delta' && json.delta) {
                if (json.delta.type === 'text_delta' && json.delta.text) onDelta(json.delta.text);
                else if (json.delta.type === 'thinking_delta' && json.delta.thinking) onReasoning(json.delta.thinking);
              } else if (json.type === 'message_stop') {
                return;
              }
              continue;
            }
            var delta = json.choices && json.choices[0] && json.choices[0].delta;
            if (delta) {
              // DeepSeek 等兼容渠道把推理放在 reasoning_content / reasoning 中
              var reasoning = delta.reasoning_content || delta.reasoning || delta.reasoning_text;
              if (reasoning) onReasoning(reasoning);
              if (delta.content) onDelta(delta.content);
            }
          }
          return pump();
        });
      }

      return pump();
    }

    function updateSendButton () {
      var button = $('ai-send');
      button.title = streaming ? strings.stop : strings.send;
      button.classList.toggle('streaming', streaming);
      $('ai-send-icon').classList.toggle('hidden', streaming);
      $('ai-stop-icon').classList.toggle('hidden', !streaming);
    }

    // ── 消息渲染 ──────────────────────────────────────────────
    var QUICK_ACTIONS = [
      {key: 'explain', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z'},
      {key: 'optimize', icon: 'M7 2v11h3v9l7-12h-4l4-8H7z'},
      {key: 'addBlock', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 11h4v-2h-4V7h-2v4H7v2h4v4h2v-4z'},
      {key: 'fix', icon: 'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z'},
      {key: 'edit', icon: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z'}
    ];

    function showWelcome () {
      var wrap = document.createElement('div');
      wrap.className = 'ai-welcome';

      var avatar = document.createElement('div');
      avatar.className = 'ai-welcome-avatar';
      avatar.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2a1 1 0 0 1 .95.68l1.7 4.67 4.67 1.7a1 1 0 0 1 0 1.9l-4.67 1.7-1.7 4.67a1 1 0 0 1-1.9 0l-1.7-4.67-4.67-1.7a1 1 0 0 1 0-1.9l4.67-1.7 1.7-4.67A1 1 0 0 1 12 2zm7 12a.9.9 0 0 1 .86.61l.85 2.34 2.34.85a.9.9 0 0 1 0 1.71l-2.34.85-.85 2.34a.9.9 0 0 1-1.71 0l-.85-2.34-2.34-.85a.9.9 0 0 1 0-1.71l2.34-.85.85-2.34A.9.9 0 0 1 19 14z"/></svg>';
      wrap.appendChild(avatar);

      var title = document.createElement('div');
      title.className = 'ai-welcome-title';
      title.textContent = strings.welcomeTitle;
      wrap.appendChild(title);

      var desc = document.createElement('div');
      desc.className = 'ai-welcome-desc';
      desc.textContent = strings.welcome;
      wrap.appendChild(desc);

      var actions = document.createElement('div');
      actions.className = 'ai-welcome-actions';
      var prompts = {
        explain: strings.promptExplain,
        optimize: strings.promptOptimize,
        addBlock: strings.promptAddBlock,
        fix: strings.promptFix,
        edit: strings.promptEdit
      };
      var labels = {
        explain: strings.quickExplain,
        optimize: strings.quickOptimize,
        addBlock: strings.quickAddBlock,
        fix: strings.quickFix,
        edit: strings.quickEdit
      };
      QUICK_ACTIONS.forEach(function (action) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'ai-quick-btn' + (action.key === 'edit' ? ' wide' : '');
        button.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + action.icon + '"/></svg>';
        var label = document.createElement('span');
        label.textContent = labels[action.key];
        button.appendChild(label);
        button.addEventListener('click', function () {
          if (streaming) return;
          sendChat(prompts[action.key]);
        });
        actions.appendChild(button);
      });
      wrap.appendChild(actions);
      $('ai-messages').appendChild(wrap);
      scrollMessagesToBottom(true);
    }

    function addUserBubble (text) {
      var bubble = document.createElement('div');
      bubble.className = 'ai-msg user';
      bubble.textContent = text;
      $('ai-messages').appendChild(bubble);
      scrollMessagesToBottom(true);
    }

    // 首个思考/正文增量到来前，气泡里只有「思考中」动画点
    function clearThinkingDots (bubble) {
      if (bubble.querySelector('.ai-reasoning')) return;
      var body = bubble.querySelector('.ai-msg-body');
      if (!body || !body.childNodes.length) bubble.innerHTML = '';
    }

    function ensureAssistantBody (bubble) {
      var body = bubble.querySelector('.ai-msg-body');
      if (!body) {
        body = document.createElement('div');
        body.className = 'ai-msg-body';
        bubble.appendChild(body);
      }
      return body;
    }

    function ensureReasoningBox (bubble) {
      var box = bubble.querySelector('.ai-reasoning');
      if (!box) {
        box = document.createElement('details');
        box.className = 'ai-reasoning';
        box.open = true;
        var summary = document.createElement('summary');
        summary.textContent = strings.reasoningTitle;
        var content = document.createElement('div');
        content.className = 'ai-reasoning-text';
        box.appendChild(summary);
        box.appendChild(content);
        var body = bubble.querySelector('.ai-msg-body');
        if (body) bubble.insertBefore(box, body);
        else bubble.appendChild(box);
      }
      return box;
    }

    function appendReasoningDelta (bubble, delta) {
      var content = ensureReasoningBox(bubble).querySelector('.ai-reasoning-text');
      content.textContent += delta;
    }

    function finalizeReasoning (bubble) {
      var box = bubble.querySelector('.ai-reasoning');
      if (box) box.open = false;
    }

    function addAssistantBubble (text, reasoning, edits) {
      var bubble = document.createElement('div');
      bubble.className = 'ai-msg assistant';
      // 恢复聊天记录时按存档里的状态显示编辑卡片；旧记录默认视为已应用
      bubble._editBlocks = text ? parseEditBlocks(text) : [];
      bubble._editStatuses = (edits && Array.isArray(edits))
        ? edits.slice()
        : bubble._editBlocks.map(function () { return 'applied'; });
      $('ai-messages').appendChild(bubble);
      if (reasoning) {
        appendReasoningDelta(bubble, reasoning);
        finalizeReasoning(bubble);
      }
      if (text) renderAssistantContent(bubble, text, null);
      else if (reasoning) renderAssistantContent(bubble, strings.noAnswer, null);
      scrollMessagesToBottom(true);
      return bubble;
    }

    function scrollMessagesToBottom (smooth) {
      var box = $('ai-messages');
      // 流式输出期间用即时滚动避免抖动；新消息用平滑滚动
      if (smooth) {
        box.scrollTo({top: box.scrollHeight, behavior: 'smooth'});
      } else {
        box.scrollTop = box.scrollHeight;
      }
    }

    function escapeHtml (text) {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function renderAssistantContent (bubble, text, cursor) {
      // 只重绘正文区域，保留旁边的思考折叠框
      var body = ensureAssistantBody(bubble);
      body.innerHTML = '';
      bubble._fullText = text;

      // 编辑块不按普通 Markdown 代码块渲染，而是显示成可追踪状态的卡片
      var editRegex = /<neowarp-edit\b[^>]*>[\s\S]*?<\/neowarp-edit>/gi;
      var lastIndex = 0;
      var editIndex = 0;
      var match;
      while ((match = editRegex.exec(text)) !== null) {
        appendRichText(body, text.slice(lastIndex, match.index));
        var block = parseEditBlock(match[0]);
        if (block) {
          appendEditCard(body, bubble, block, editIndex);
          // 索引需与 parseEditBlocks / 应用状态数组保持一致，跳过无效块
          editIndex++;
        }
        lastIndex = editRegex.lastIndex;
      }
      var tail = text.slice(lastIndex);
      // 流式输出中尚未闭合的编辑块先隐藏，避免把半截代码刷到界面上
      var openIndex = tail.lastIndexOf('<neowarp-edit');
      if (openIndex !== -1 && tail.indexOf('</neowarp-edit>', openIndex) === -1) {
        tail = tail.slice(0, openIndex);
      }
      appendRichText(body, tail);
      if (cursor) body.appendChild(cursor);
    }

    function appendRichText (body, text) {
      var blockRegex = /```(\w*)\n?([\s\S]*?)(?:```|$)/g;
      var lastIndex = 0;
      var match;
      while ((match = blockRegex.exec(text)) !== null) {
        appendTextSegment(body, text.slice(lastIndex, match.index));
        appendCodeBlock(body, match[1], match[2]);
        lastIndex = blockRegex.lastIndex;
      }
      appendTextSegment(body, text.slice(lastIndex));
    }

    function editActionLabel (action) {
      if (action === 'insert') return strings.editInsert;
      if (action === 'patch') return strings.editPatch;
      return strings.editReplace;
    }

    function appendEditCard (body, bubble, block, index) {
      var statuses = bubble._editStatuses || [];
      // 流式中编辑块已完整但尚未到应用阶段；恢复的历史记录默认视为已应用
      var status = statuses[index] || (streaming
        ? (autoApplyEnabled() ? 'applying' : 'disabled')
        : 'applied');

      var card = document.createElement('div');
      card.className = 'ai-edit-card status-' + status;

      var head = document.createElement('div');
      head.className = 'ai-edit-head';
      head.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
      var label = document.createElement('span');
      label.className = 'ai-edit-label';
      label.textContent = strings.editCard + ' · ' + editActionLabel(block.action);
      var statusEl = document.createElement('span');
      statusEl.className = 'ai-edit-status';
      statusEl.textContent = editStatusText(status);
      head.appendChild(label);
      head.appendChild(statusEl);
      card.appendChild(head);

      if (status !== 'applied' && status !== 'applying') {
        var applyButton = document.createElement('button');
        applyButton.type = 'button';
        applyButton.className = 'ai-edit-apply';
        applyButton.textContent = strings.editApply;
        applyButton.addEventListener('click', function () {
          if (streaming) return;
          applyOneEdit(bubble, block, index);
        });
        card.appendChild(applyButton);
      }
      body.appendChild(card);
    }

    function renderInlineMarkdown (text) {
      var html = escapeHtml(text);
      html = html.replace(/`([^`\n]+)`/g, '<code class="md-inline">$1</code>');
      html = html.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
      return html;
    }

    // ── Markdown 表格 ─────────────────────────────────────────
    // 分隔行：| --- | :---: | ---: | 这类
    function isTableSeparatorLine (line) {
      var t = line.trim();
      if (t.indexOf('|') === -1) return false;
      var parts = t.replace(/^\|/, '').replace(/\|$/, '').split('|');
      return parts.length > 0 && parts.every(function (part) {
        return /^\s*:?-+:?\s*$/.test(part);
      });
    }

    // 数据行/表头行：非空、含 '|'、且不是分隔行
    function isTableRowLine (line) {
      var t = line.trim();
      return t.length > 0 && t.indexOf('|') !== -1 && !isTableSeparatorLine(t);
    }

    function parseTableRowCells (line) {
      var t = line.trim();
      if (t.charAt(0) === '|') t = t.slice(1);
      if (t.charAt(t.length - 1) === '|') t = t.slice(0, -1);
      return t.split(/(?<!\\)\|/).map(function (cell) {
        return cell.trim().replace(/\\\|/g, '|');
      });
    }

    function appendTableNode (container, tableLines) {
      var wrapper = document.createElement('div');
      wrapper.className = 'md-table-wrap';
      var table = document.createElement('table');
      table.className = 'md-table';

      var aligns = parseTableRowCells(tableLines[1]).map(function (cell) {
        if (/^:-+:$/.test(cell)) return 'center';
        if (/^-+:$/.test(cell)) return 'right';
        return 'left';
      });

      var thead = document.createElement('thead');
      var headRow = document.createElement('tr');
      parseTableRowCells(tableLines[0]).forEach(function (cell, index) {
        var th = document.createElement('th');
        th.innerHTML = renderInlineMarkdown(cell);
        th.style.textAlign = aligns[index] || 'left';
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');
      tableLines.slice(2).forEach(function (line) {
        if (!line.trim()) return;
        var tr = document.createElement('tr');
        parseTableRowCells(line).forEach(function (cell, index) {
          var td = document.createElement('td');
          td.innerHTML = renderInlineMarkdown(cell);
          td.style.textAlign = aligns[index] || 'left';
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);

      wrapper.appendChild(table);
      container.appendChild(wrapper);
    }

    function appendTextSegment (bubble, segment) {
      if (!segment) return;
      var lines = segment.split('\n');
      var container = document.createElement('span');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        // 表格块：表头行 + 分隔行 + 连续的数据行，整体渲染为 <table>
        if (i + 1 < lines.length &&
            isTableRowLine(line) &&
            isTableSeparatorLine(lines[i + 1])) {
          var tableLines = [line, lines[i + 1]];
          var j = i + 2;
          while (j < lines.length &&
              lines[j].trim() !== '' &&
              isTableRowLine(lines[j])) {
            tableLines.push(lines[j]);
            j++;
          }
          if (container.childNodes.length) {
            container.appendChild(document.createElement('br'));
          }
          appendTableNode(container, tableLines);
          i = j - 1;
          continue;
        }
        if (container.childNodes.length) {
          container.appendChild(document.createElement('br'));
        }
        var trimmed = line.trim();
        var node;
        var headingMatch = /^(#{1,3})\s+(.*)$/.exec(trimmed);
        var ulMatch = /^[-*]\s+(.*)$/.exec(trimmed);
        var olMatch = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
        if (headingMatch) {
          node = document.createElement('div');
          node.className = 'md-h md-h' + headingMatch[1].length;
          node.innerHTML = renderInlineMarkdown(headingMatch[2]);
        } else if (ulMatch) {
          node = document.createElement('span');
          node.className = 'md-li';
          node.innerHTML = renderInlineMarkdown(ulMatch[1]);
        } else if (olMatch) {
          node = document.createElement('span');
          node.className = 'md-li md-ol';
          node.setAttribute('data-index', olMatch[1]);
          node.innerHTML = renderInlineMarkdown(olMatch[2]);
        } else {
          node = document.createElement('span');
          node.innerHTML = renderInlineMarkdown(line);
        }
        container.appendChild(node);
      }
      bubble.appendChild(container);
    }

    function appendCodeBlock (bubble, language, code) {
      var wrapper = document.createElement('div');
      wrapper.className = 'code-block';

      var header = document.createElement('div');
      header.className = 'code-block-header';
      var langLabel = document.createElement('span');
      langLabel.className = 'lang-label';
      langLabel.textContent = language || 'code';
      var spacer = document.createElement('span');
      spacer.className = 'spacer';

      var codeText = code.replace(/\n$/, '');

      var copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'code-action-btn';
      copyButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>' + strings.copyCode;
      copyButton.addEventListener('click', function () {
        copyToClipboard(codeText);
        // 按钮短暂变为「已复制」反馈
        copyButton.classList.add('success');
        copyButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>' + strings.copiedShort;
        setTimeout(function () {
          copyButton.classList.remove('success');
          copyButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>' + strings.copyCode;
        }, 1500);
      });

      var insertButton = document.createElement('button');
      insertButton.type = 'button';
      insertButton.className = 'code-action-btn';
      insertButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>' + strings.insertCode;
      insertButton.addEventListener('click', function () {
        options.insertCode(codeText);
      });

      header.appendChild(langLabel);
      header.appendChild(spacer);
      header.appendChild(copyButton);
      header.appendChild(insertButton);

      // 一键替换整个编辑器文件（二次确认，防止误点覆盖）
      if (options.replaceCode) {
        var replaceButton = document.createElement('button');
        replaceButton.type = 'button';
        replaceButton.className = 'code-action-btn replace';
        var replaceIcon = '<svg viewBox="0 0 24 24"><path d="M17 1h6v6h-2V4.4L14.4 11 13 9.6 19.6 3H17V1zM7 23H1v-6h2v2.6L9.6 13 11 14.4 4.4 21H7v2z"/></svg>';
        var replaceHtml = replaceIcon + strings.replaceCode;
        replaceButton.innerHTML = replaceHtml;
        var confirmTimer = null;
        var resetReplaceButton = function () {
          clearTimeout(confirmTimer);
          replaceButton.classList.remove('confirming');
          replaceButton.innerHTML = replaceHtml;
        };
        replaceButton.addEventListener('click', function () {
          if (replaceButton.classList.contains('confirming')) {
            resetReplaceButton();
            options.replaceCode(codeText);
          } else {
            replaceButton.classList.add('confirming');
            replaceButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z"/></svg>' + strings.confirmReplace;
            confirmTimer = setTimeout(resetReplaceButton, 3000);
          }
        });
        header.appendChild(replaceButton);
      }

      var pre = document.createElement('pre');
      var codeEl = document.createElement('code');
      codeEl.textContent = codeText;
      pre.appendChild(codeEl);

      wrapper.appendChild(header);
      wrapper.appendChild(pre);
      bubble.appendChild(wrapper);
    }

    function copyToClipboard (text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          showToast(strings.copied);
        }, function () {
          fallbackCopy(text);
        });
      } else {
        fallbackCopy(text);
      }
    }

    function fallbackCopy (text) {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(textarea);
      showToast(strings.copied);
    }

    // ── 状态交接（弹出 / 恢复时搬运聊天记录） ─────────────────
    function getState () {
      return {
        chatHistory: chatHistory
      };
    }

    function setState (state) {
      chatHistory = (state && Array.isArray(state.chatHistory)) ? state.chatHistory : [];
      $('ai-messages').innerHTML = '';
      if (!chatHistory.length) {
        showWelcome();
        return;
      }
      chatHistory.forEach(function (message) {
        if (message.role === 'user') {
          addUserBubble(message.content);
        } else {
          addAssistantBubble(message.content, message.reasoning, message.edits);
        }
      });
    }

    init();

    return {
      getState: getState,
      setState: setState,
      isStreaming: function () { return streaming; }
    };
  }

  window.createNeoWarpAiPanel = createNeoWarpAiPanel;
  window.NEO_WARP_AI_PROVIDERS = PROVIDERS;
})();

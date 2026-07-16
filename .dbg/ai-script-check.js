
(function() {
    'use strict';

    var PROVIDERS = {
        openai: {
            name: 'OpenAI', logo: '#10a37f', logoText: 'O',
            endpoint: 'https://api.openai.com/v1/chat/completions',
            supportsVision: true,
            models: [
                { id: 'gpt-5.6', name: 'GPT-5.6', supportsReasoning: true },
                { id: 'gpt-5.5', name: 'GPT-5.5', supportsReasoning: true },
                { id: 'gpt-5.4', name: 'GPT-5.4', supportsReasoning: true },
                { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', supportsReasoning: false },
                { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', supportsReasoning: true }
            ],
            defaultModel: 'gpt-5.4'
        },
        deepseek: {
            name: 'DeepSeek', logo: '#4f46e5', logoText: 'D',
            endpoint: 'https://api.deepseek.com/chat/completions',
            supportsVision: false,
            models: [
                { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', supportsReasoning: true },
                { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', supportsReasoning: true }
            ],
            defaultModel: 'deepseek-v4-pro'
        },
        glm: {
            name: 'Zhipu GLM', logo: '#3859ff', logoText: 'Z',
            endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
            supportsVision: true,
            models: [
                { id: 'glm-5.2', name: 'GLM-5.2', supportsReasoning: true, supportsVision: false },
                { id: 'glm-5.1', name: 'GLM-5.1', supportsReasoning: true }
            ],
            defaultModel: 'glm-5.2'
        },
        kimi: {
            name: 'Kimi (Moonshot)', logo: '#10b981', logoText: 'K',
            endpoint: 'https://api.moonshot.cn/v1/chat/completions',
            supportsVision: true,
            models: [
                { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', supportsReasoning: true, supportsVision: true },
                { id: 'kimi-k2.6', name: 'Kimi K2.6', supportsReasoning: false }
            ],
            defaultModel: 'kimi-k2.7-code'
        },
        huaweipangu: {
            name: 'Huawei Pangu', logo: '#cf0a2c', logoText: 'H',
            endpoint: 'https://api.huaweicloud.com/api/v2/chat/completions',
            models: [
                { id: 'pangu-2.0-pro', name: 'Pangu 2.0 Pro', supportsReasoning: true },
                { id: 'pangu-2.0-flash', name: 'Pangu 2.0 Flash', supportsReasoning: false }
            ],
            defaultModel: 'pangu-2.0-pro'
        },
        qwen: {
            name: 'Qwen', logo: '#6366f1', logoText: 'Q',
            endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
            models: [
                { id: 'qwen-plus', name: 'Qwen Plus', supportsReasoning: false },
                { id: 'qwen-max', name: 'Qwen Max', supportsReasoning: false },
                { id: 'qwen-turbo', name: 'Qwen Turbo', supportsReasoning: false }
            ],
            defaultModel: 'qwen-plus'
        },
        custom: {
            name: 'Custom', logo: '#888', logoText: '?',
            endpoint: '',
            models: [{ id: 'custom', name: 'Custom Model', supportsReasoning: false }],
            defaultModel: 'custom',
            isCustom: true
        }
    };

    var TOOLS = [
        {
            type: 'function',
            function: {
                name: 'get_project_info',
                description: 'Get all information about the current Scratch project: all sprites, their properties (position, size, direction, costumes), all variables, all lists, stage backdrops.',
                parameters: { type: 'object', properties: {}, required: [] }
            }
        },
        {
            type: 'function',
            function: {
                name: 'set_sprite_property',
                description: 'Move, resize, rotate, or change visibility of a sprite. Set any combination of x, y, size, direction, visible properties.',
                parameters: {
                    type: 'object',
                    properties: {
                        sprite_name: { type: 'string', description: 'Name of the sprite to modify' },
                        x: { type: 'number', description: 'X position (-240 to 240)' },
                        y: { type: 'number', description: 'Y position (-180 to 180)' },
                        size: { type: 'number', description: 'Size percentage (5 to 535)' },
                        direction: { type: 'number', description: 'Direction degrees (-180 to 180, 90=right)' },
                        visible: { type: 'boolean', description: 'Show or hide the sprite' }
                    },
                    required: ['sprite_name']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'create_variable',
                description: 'Create a new Scratch variable on a sprite or the stage (global). If the variable already exists, this is a no-op.',
                parameters: {
                    type: 'object',
                    properties: {
                        sprite_name: { type: 'string', description: 'Name of sprite owning the variable. Leave empty or omit for global (stage) variables.' },
                        variable_name: { type: 'string', description: 'Name of the variable to create' },
                        initial_value: { type: 'string', description: 'Initial value of the variable (default: "0")' }
                    },
                    required: ['variable_name']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'create_list',
                description: 'Create a new Scratch list on a sprite or the stage (global). Lists can hold multiple items. If the list already exists, this is a no-op.',
                parameters: {
                    type: 'object',
                    properties: {
                        sprite_name: { type: 'string', description: 'Name of sprite owning the list. Leave empty or omit for global (stage) lists.' },
                        list_name: { type: 'string', description: 'Name of the list to create' }
                    },
                    required: ['list_name']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'set_variable',
                description: 'Set the value of a Scratch variable. Can set sprite-local or global (stage) variables.',
                parameters: {
                    type: 'object',
                    properties: {
                        sprite_name: { type: 'string', description: 'Name of sprite owning the variable. Leave empty for global variables.' },
                        variable_name: { type: 'string', description: 'Name of the variable' },
                        value: { type: 'string', description: 'New value (can be number or text)' }
                    },
                    required: ['variable_name', 'value']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'add_to_list',
                description: 'Add an item to a Scratch list.',
                parameters: {
                    type: 'object',
                    properties: {
                        sprite_name: { type: 'string', description: 'Name of sprite owning the list. Leave empty for stage lists.' },
                        list_name: { type: 'string', description: 'Name of the list' },
                        item: { type: 'string', description: 'Item to add' }
                    },
                    required: ['list_name', 'item']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'delete_from_list',
                description: 'Delete an item from a Scratch list by its position (1-indexed).',
                parameters: {
                    type: 'object',
                    properties: {
                        sprite_name: { type: 'string', description: 'Name of sprite owning the list' },
                        list_name: { type: 'string', description: 'Name of the list' },
                        index: { type: 'number', description: 'Position of item to delete (1=first)' }
                    },
                    required: ['list_name', 'index']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'add_sprite',
                description: 'Add a new sprite from the Scratch sprite library. Search by name or keyword (e.g. "Cat", "Dog", "Ball", "Apple", "Star", "Dinosaur", "Robot", "Dragon", "Car", "Rocket").',
                parameters: {
                    type: 'object',
                    properties: {
                        sprite_name: { type: 'string', description: 'Name or keyword to search in the sprite library' }
                    },
                    required: ['sprite_name']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'delete_sprite',
                description: 'Delete a sprite from the project.',
                parameters: {
                    type: 'object',
                    properties: {
                        sprite_name: { type: 'string', description: 'Name of the sprite to delete' }
                    },
                    required: ['sprite_name']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'change_costume',
                description: 'Change the current costume of a sprite to another costume it already has.',
                parameters: {
                    type: 'object',
                    properties: {
                        sprite_name: { type: 'string', description: 'Name of the sprite' },
                        costume_name: { type: 'string', description: 'Name of the costume to switch to' }
                    },
                    required: ['sprite_name', 'costume_name']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'add_backdrop',
                description: 'Add a new backdrop to the stage from the backdrop library. Search by name or keyword (e.g. "Arctic", "Space", "Underwater", "Castle", "Forest", "City", "Desert").',
                parameters: {
                    type: 'object',
                    properties: {
                        backdrop_name: { type: 'string', description: 'Name or keyword to search in the backdrop library' }
                    },
                    required: ['backdrop_name']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'change_backdrop',
                description: 'Switch to a backdrop that already exists on the stage.',
                parameters: {
                    type: 'object',
                    properties: {
                        backdrop_name: { type: 'string', description: 'Name of the backdrop to switch to' }
                    },
                    required: ['backdrop_name']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'get_installed_extensions',
                description: 'View all currently installed Scratch extensions, their block definitions, and extension code. Returns extension IDs, names, all available blocks with their opcodes and parameters, and the extension source code.',
                parameters: { type: 'object', properties: {}, required: [] }
            }
        },
        {
            type: 'function',
            function: {
                name: 'search_extensions',
                description: 'Search for available Scratch extensions from the extension library. Search by name, keyword, or description. Returns matching extensions with their IDs, names, descriptions, and installation URLs.',
                parameters: {
                    type: 'object',
                    properties: {
                        keyword: { type: 'string', description: 'Search keyword (e.g. "text", "pen", "music", "translate", "AI", "gamepad")' }
                    },
                    required: ['keyword']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'web_search',
                description: 'Search the internet for information, documentation, tutorials, or answers to programming questions. Uses DuckDuckGo and Wikipedia. Returns structured results with title, URL, and snippet. Use this tool to look up Scratch programming techniques, API documentation, sprite design ideas, math formulas, game design patterns, or any general knowledge needed for the project.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Search query in natural language. Be specific about what you need (e.g. "Scratch how to make smooth movement", "JavaScript random number range").' }
                    },
                    required: ['query']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'develop_extension',
                description: 'Create and install a custom Scratch extension from JavaScript code. Write a complete Scratch extension class with getInfo() method defining custom blocks. The extension will be loaded into the project immediately. Must include a valid block definitions and implementation.',
                parameters: {
                    type: 'object',
                    properties: {
                        extension_code: { type: 'string', description: 'Complete JavaScript code for the Scratch extension class. Must define a class with getInfo() method returning blocks array, and implement the block methods. The class will be automatically instantiated.' },
                        extension_name: { type: 'string', description: 'A unique name/ID for this extension (e.g. "myCustomExtension")' }
                    },
                    required: ['extension_code', 'extension_name']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'install_extension',
                description: 'Install a Scratch extension from a URL or known extension ID. The extension will be loaded and its blocks will become available.',
                parameters: {
                    type: 'object',
                    properties: {
                        extension_url: { type: 'string', description: 'URL to the extension JavaScript file, or a known extension ID (e.g. from search_extensions results)' }
                    },
                    required: ['extension_url']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'click_green_flag',
                description: 'Click the green flag to start the project. This runs all "when green flag clicked" scripts.',
                parameters: { type: 'object', properties: {}, required: [] }
            }
        },
        {
            type: 'function',
            function: {
                name: 'rename_project',
                description: 'Rename the current Scratch project.',
                parameters: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'New name for the project' }
                    },
                    required: ['name']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'set_stage_size',
                description: 'Change the stage size in pixels. Default is 480x360. Common presets: 480x360 (standard), 640x480 (larger), 854x480 (widescreen), 960x720 (HD), 1280x720 (HD+). Stage size affects sprite positioning and motion boundaries.',
                parameters: {
                    type: 'object',
                    properties: {
                        width: { type: 'number', description: 'Stage width in pixels (minimum 240)' },
                        height: { type: 'number', description: 'Stage height in pixels (minimum 180)' }
                    },
                    required: ['width', 'height']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'execute_operations',
                description: 'Execute structured operations on the Scratch project. You MUST output a JSON array of operation objects. Each operation has a "type" field. Available types: add_script (add a new complete script), delete_block (delete a block by tid), modify_input (change a block input value), add_comment (add/update a comment on a block or as a standalone workspace comment), delete_comment (remove a comment), explain (display a text explanation to the user). Comments are allowed and encouraged for code documentation. See the system prompt for the full protocol specification including opcode dictionary, nesting rules, and examples.',
                parameters: {
                    type: 'object',
                    properties: {
                        operations: { type: 'string', description: 'JSON string of operation array. Each object must contain "type" field. Example: [{"type":"modify_input","sprite":"Cat","targetId":"b2","inputName":"TIMES","value":20},{"type":"explain","text":"Done."}]' }
                    },
                    required: ['operations']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'add_costume_from_url',
                description: 'Add a new costume to a sprite from an image URL. Supports PNG, JPG, GIF, SVG, and other web image formats. The image will be downloaded and added as a costume to the specified sprite.',
                parameters: {
                    type: 'object',
                    properties: {
                        sprite_name: { type: 'string', description: 'Name of the sprite to add the costume to' },
                        url: { type: 'string', description: 'URL of the image to add as a costume (e.g. https://example.com/image.png)' },
                        costume_name: { type: 'string', description: 'Name for the new costume (default: "costume")' }
                    },
                    required: ['sprite_name', 'url']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'add_sprite_from_url',
                description: 'Add a new sprite with a costume loaded from an image URL. Supports PNG, JPG, GIF, SVG, and other web image formats. A new sprite will be created with the downloaded image as its first costume.',
                parameters: {
                    type: 'object',
                    properties: {
                        sprite_name: { type: 'string', description: 'Name for the new sprite' },
                        url: { type: 'string', description: 'URL of the image to use as the sprite costume (e.g. https://example.com/image.png)' }
                    },
                    required: ['sprite_name', 'url']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'get_stage_screenshot',
                description: 'Capture a screenshot of the current Scratch stage. Returns a base64-encoded PNG image of the stage. Use this tool to visually inspect the current state of the project, check sprite positions, verify visual output, or debug appearance issues. For multimodal models (e.g. GPT-4o, GLM-5.2), the screenshot will be automatically added to the conversation as an image for visual analysis. For text-only models, a text description of the screenshot dimensions is returned.',
                parameters: { type: 'object', properties: {}, required: [] }
            }
        },
        {
            type: 'function',
            function: {
                name: 'duplicate_sprite',
                description: 'Duplicate an existing sprite with all its costumes, sounds, scripts, and variables. The new sprite will have the same properties as the original but with a new name.',
                parameters: {
                    type: 'object',
                    properties: {
                        source_name: { type: 'string', description: 'Name of the existing sprite to duplicate' },
                        new_name: { type: 'string', description: 'Name for the duplicated sprite' }
                    },
                    required: ['source_name', 'new_name']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'get_system_time',
                description: 'Get the current system time including timestamp, date, time, year, month, day, hours, minutes, seconds, weekday, and timezone offset.',
                parameters: { type: 'object', properties: {}, required: [] }
            }
        },
        {
            type: 'function',
            function: {
                name: 'get_system_info',
                description: 'Get system information including CPU model, core count, CPU speed, architecture, platform, OS release, hostname, total memory, free memory, uptime, and username.',
                parameters: { type: 'object', properties: {}, required: [] }
            }
        },
        {
            type: 'function',
            function: {
                name: 'mute_agent',
                description: 'Mute an agent to prevent it from speaking in the meeting. Only the chief agent can use this tool. The muted agent will skip its turns until unmuted.',
                parameters: {
                    type: 'object',
                    properties: {
                        agent_id: { type: 'string', description: 'ID of the agent to mute. Options: planner, searcher, developer, reviewer' }
                    },
                    required: ['agent_id']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'unmute_agent',
                description: 'Unmute an agent to allow it to speak again in the meeting. Only the chief agent can use this tool.',
                parameters: {
                    type: 'object',
                    properties: {
                        agent_id: { type: 'string', description: 'ID of the agent to unmute. Options: planner, searcher, developer, reviewer' }
                    },
                    required: ['agent_id']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'assign_task',
                description: 'Assign a task to a specific agent. This will enable the agent to speak and provide it with custom prompt guidance for the current round. Only the chief agent can use this tool.',
                parameters: {
                    type: 'object',
                    properties: {
                        agent_id: { type: 'string', description: 'ID of the agent to enable. Options: planner, searcher, developer, reviewer' },
                        custom_prompt: { type: 'string', description: 'Custom instructions for the agent, telling them what to focus on in this round' }
                    },
                    required: ['agent_id', 'custom_prompt']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'plan_todos',
                description: '在对话中展示一个待办事项清单卡片。用于复杂的多步骤任务：先用此工具列出所有步骤，然后逐步执行 update_todo 标记进度，配合 execute_operations 等工具逐条完成。调用后会在聊天界面渲染一张待办清单卡片，所有条目初始为待处理状态。',
                parameters: {
                    type: 'object',
                    properties: {
                        title: { type: 'string', description: '清单标题（可选，默认"待办事项"）' },
                        items: {
                            type: 'array',
                            description: '待办条目数组，按执行顺序排列',
                            items: { type: 'string' }
                        }
                    },
                    required: ['items']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'update_todo',
                description: '更新待办清单中某一条目的状态。配合 plan_todos 使用：开始执行某条时标记为 doing，完成后标记为 done，从而实现"列出待办条目，然后一条一条执行"的可见进度。index 为 1 开始的序号。',
                parameters: {
                    type: 'object',
                    properties: {
                        index: { type: 'number', description: '要更新的条目序号（从 1 开始）' },
                        status: { type: 'string', enum: ['pending', 'doing', 'done'], description: '新状态：pending=待处理, doing=进行中, done=已完成' },
                        note: { type: 'string', description: '可选的状态说明（如完成备注或失败原因）' }
                    },
                    required: ['index', 'status']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'pause_output',
                description: '暂停输出一段时间，在聊天界面显示倒计时提示。用于在多步骤任务中给用户阅读时间、等待用户操作、或在连续输出长文本之间添加停顿。暂停期间会在聊天区显示一个带倒计时的暂停指示器。',
                parameters: {
                    type: 'object',
                    properties: {
                        seconds: { type: 'number', description: '暂停时长（秒），范围 1-60' },
                        reason: { type: 'string', description: '暂停原因（可选，会显示给用户）' }
                    },
                    required: ['seconds']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'ask_user',
                description: '当用户的需求过于笼统、模糊或存在多种可行方案时，向用户提问以澄清意图。会在聊天界面渲染一张可交互的问题卡片，包含若干选项供用户点选，以及一个"其他"输入框供用户自定义作答。调用后会阻塞等待用户响应，返回用户的选择结果。请在你不确定用户确切意图时主动使用此工具，而不是基于猜测直接行动。',
                parameters: {
                    type: 'object',
                    properties: {
                        question: { type: 'string', description: '要向用户提出的问题，应清晰具体地说明需要澄清的内容' },
                        options: {
                            type: 'array',
                            description: '供用户选择的预设选项列表（2-4 个）。每个选项需有简明的 label，可选的 description 用于解释该选项的含义或影响',
                            items: {
                                type: 'object',
                                properties: {
                                    label: { type: 'string', description: '选项的简短标签（1-5 个词）' },
                                    description: { type: 'string', description: '选项的说明文字（可选，解释该选择的含义或影响）' }
                                },
                                required: ['label']
                            },
                            minItems: 2,
                            maxItems: 4
                        },
                        multi_select: { type: 'boolean', description: '是否允许多选（默认 false 单选）。当为 true 时用户可选择多个选项' }
                    },
                    required: ['question', 'options']
                }
            }
        }
    ];

    var $ = function(id) { return document.getElementById(id); };
    var chatArea = $('chatArea');
    var welcomeMessage = $('welcomeMessage');
    var messageInput = $('messageInput');
    var sendBtn = $('sendBtn');
    var settingsBtn = $('settingsBtn');
    var settingsOverlay = $('settingsOverlay');
    var settingsPanel = $('settingsPanel');
    var settingsHandle = $('settingsHandle');
    var clearChatBtn = $('clearChatBtn');
    var modelSelectBtn = $('modelSelectBtn');
    var modelDropdown = $('modelDropdown');
    var modelDropdownList = $('modelDropdownList');
    var modelNameDisplay = $('modelNameDisplay');
    var modelShortDisplay = $('modelShortDisplay');
    var modelStatusDot = $('modelStatusDot');
    var settingDot = $('settingDot');
    var toast = $('toast');
    var inputWrapper = $('inputWrapper');
    var imageUploadBtn = $('imageUploadBtn');
    var imageInput = $('imageInput');
    var imagePreviewBar = $('imagePreviewBar');

    var disclaimerOverlay = $('disclaimerOverlay');
    var disclaimerAcceptBtn = $('disclaimerAcceptBtn');
    var disclaimerCountdown = $('disclaimerCountdown');
    var disclaimerExitBtn = $('disclaimerExitBtn');

    var chatHistory = [];
    var savedConfigs = [];
    var activeConfigIndex = -1;
    var currentConfig = { apiKey: '', provider: 'openai', model: 'gpt-5.4', customEndpoint: '', customModelId: '', apiFormat: 'openai', contextWindow: 20, name: '' };
    var isLoading = false;
    var settingsOpen = false;
    var modelDropdownOpen = false;
    var toastTimer = null;
    var abortController = null;
    var projectCodeCache = null;
    var currentContextMapping = {};
    var pendingImages = [];

    var conversations = [];
    var activeConversationId = null;
    var nextConversationId = 1;

    var isScratchRunning = false;
    var scratchEndCondition = 'ai';
    var scratchTimeMinutes = 120;
    var scratchTimerId = null;
    var scratchAgentTimers = [];
    var mutedAgents = {};
    var agentRoundPrompts = {};
    var chiefOnlyMode = true;

    var activeTodoCard = null;

    var BASE_TOOL_INSTRUCTIONS = '【会议规则】\n你现在正在参加一个ScratchAgent项目开发会议。你可以随时调用工具直接操作Scratch项目（通过function calling），不需要等待他人允许。当你需要操作项目时，请直接调用相应工具执行，不要只输出文字描述。每个智能体都可以自主决定何时使用工具。\n\n【工具调用方式】\n你必须在需要操作时直接发起function call，而不是只在文字中描述。例如，要获取项目信息时直接调用 get_project_info 工具，参数为 {}。\n\n【完整工具列表（你可用的工具以系统function定义为准）】\n1. get_project_info - 获取当前项目所有信息（角色、变量、列表、背景等）\n2. set_sprite_property(sprite_name, property, value) - 修改角色属性\n3. create_variable(variable_name, is_for_all_sprites) - 创建变量\n4. create_list(list_name, sprite_name) - 创建列表\n5. set_variable(variable_name, value, sprite_name) - 设置变量值\n6. add_to_list / delete_from_list - 操作列表\n7. add_sprite(name) / delete_sprite(name) - 添加/删除角色\n8. change_costume(sprite_name, costume_name) - 切换造型\n9. add_backdrop(name) / change_backdrop(name) - 添加/切换背景\n10. get_installed_extensions - 查看已安装扩展\n11. search_extensions(query) - 搜索可用扩展\n12. develop_extension / install_extension - 开发或安装扩展\n13. click_green_flag - 点击绿旗运行项目\n14. rename_project(new_name) - 重命名项目\n15. set_stage_size(width, height) - 设置舞台大小\n16. execute_operations(operations) - 执行结构化操作（添加脚本、删除积木、添加注释等）\n17. get_system_time / get_system_info - 获取系统时间/信息\n18. mute_agent(agent_id) / unmute_agent(agent_id) - 总策划专用：禁言/取消禁言智能体\n\
19. duplicate_sprite(source_name, new_name) - 复制角色，复制所有造型、声音、脚本和变量\n\
20. add_costume_from_url(sprite_name, url, costume_name) - 从URL添加造型到角色\n\
21. add_sprite_from_url(sprite_name, url) - 从URL添加角色（图片作为造型）\n\
22. get_stage_screenshot - 获取舞台区截图（多模态模型可用，截图会自动作为图片加入对话）\n23. web_search(query) - 搜索互联网资料，获取技术文档、教程、编程问题解答等\n24. plan_todos(items, title) - 在对话中展示待办事项清单卡片（用于多步骤任务）\n25. update_todo(index, status, note) - 更新待办条目状态（pending/doing/done），配合 plan_todos 逐条执行\n\n【待办清单工作流 - 重要】\n当用户提出**多步骤、复杂任务**时，必须使用待办清单来规划并逐条执行：\n1. 先调用 plan_todos(items: ["步骤1", "步骤2", "步骤3", ...], title: "可选标题") 列出待办条目，卡片会显示在对话中，所有条目初始为待处理。\n2. 然后逐条执行：开始某条时先调用 update_todo(index: i, status: "doing")，接着用 execute_operations 等工具完成该条实际工作，完成后再调用 update_todo(index: i, status: "done")。\n3. 一条完成后再开始下一条，直至全部 done。每完成一条，卡片进度条与计数会实时更新。\n4. 不要把所有步骤塞进一次 execute_operations；要"列出待办条目，然后一条一条执行"，让用户清晰看到进度。\n5. 单步简单任务无需使用待办清单。\n\n【execute_operations 详细说明】\noperations 是数组，每个元素包含：\n{action: "add_script", sprite: "角色名", x: 0, y: 0, blocks: [{type: "event_whenflagclicked"}, {type: "motion_movesteps", params: {STEPS: 10}}, ...]}\n{action: "add_block", sprite: "角色名", blockType: "motion_movesteps", x: 0, y: 0, params: {STEPS: 10}}\n{action: "delete_block", blockId: "xxx"}\n{action: "set_input", blockId: "xxx", inputName: "STEPS", value: 20}\n{action: "add_comment", sprite: "角色名", x: 0, y: 0, text: "注释内容", targetId: "b1"(可选，不填则为独立注释)}\n{action: "delete_comment", commentId: "xxx" 或 targetId: "b1"}\n\n【注释功能】\n你可以在代码中添加注释来解释逻辑。注释有两种形式：\n1. 附加到积木的注释：{action: "add_comment", sprite: "角色名", targetId: "b1", text: "这是移动逻辑"}\n2. 独立的工作区注释：{action: "add_comment", sprite: "角色名", x: 100, y: 100, text: "这是独立注释"}\n注释支持中文内容。\n\n积木类型示例：event_whenflagclicked, motion_movesteps, motion_gotoxy, motion_pointtowards, motion_turnright, motion_ifonedgebounce, looks_sayforsecs, looks_say, looks_show, looks_hide, looks_nextcostume, looks_switchcostumeto, looks_goforwardbackwardlayers, sound_play, sound_playuntildone, event_whenbroadcastreceived, event_broadcast, control_wait, control_repeat, control_forever, control_if, control_if_else, control_wait_until, control_stop, control_create_clone_of, sensing_touchingobject, sensing_touchingcolor, sensing_distanceto, sensing_askandwait, sensing_answer, sensing_mousedown, sensing_mousex, sensing_mousey, sensing_keypressed, operator_add, operator_subtract, operator_multiply, operator_divide, operator_random, operator_equals, operator_lt, operator_gt, operator_and, operator_or, operator_join, operator_letter_of, operator_length_of, operator_contains, operator_mod, operator_round, data_setvariableto, data_changevariableby, data_showvariable, data_hidevariable, data_addtolist, data_deleteoflist, data_deletealloflist, data_insertatlist, data_replaceitemoflist, data_itemoflist, data_itemnumoflist, data_lengthoflist, data_listcontainsitem, procedure_call, procedure_definition\n\n【重要规则 - 避免循环】\n1. 每个智能体每轮必须做出实质性进展，不要重复之前的内容\n2. 如果上一位智能体已经完成了某项工作，你不要重复做同样的事，而是继续下一步\n3. 不要只是表示"同意"或"收到"，必须给出新的分析、建议或执行结果\n4. 如果你发现讨论在原地打转，请明确指出并提出新的方向\n5. 每轮发言必须包含新的信息或行动，不允许空泛的回应\n6. 重要：如果你已经有可用的工具来完成任务（如execute_operations），请直接调用工具，而不是在文字中详细描述代码后再让其他智能体去做';

    var AGENTS = [
        { id: 'chief', name: '总策划', icon: '策', avatarClass: 'chief', labelClass: 'chief',
          tools: ['get_project_info', 'execute_operations', 'web_search', 'get_system_time', 'get_system_info', 'mute_agent', 'unmute_agent', 'assign_task', 'plan_todos', 'update_todo'],
          systemPrompt: '你是ScratchAgent团队的总策划，你是会议主持人。\n\n【核心机制 - 极其重要】\n1. 任务开始时，**只有你（总策划）会发言**\n2. 其他智能体（计划者、资料搜索、代码开发、代码审批）默认处于禁言状态\n3. 你需要通过调用 assign_task 工具来**临时开启**某个智能体发言\n4. 每个被开启的智能体发言后会自动重新进入禁言状态，等待你再次开启\n5. 你可以在开启时通过 custom_prompt 参数给该智能体下达具体指令\n\n【你的工作流程】\n1. 首先分析用户需求，制定整体架构\n2. 调用 assign_task 开启计划者，让他制定详细开发计划\n3. 根据计划，调用 assign_task 开启代码开发，让他实现某个具体部分\n4. 必要时开启资料搜索获取技术支持\n5. 开启代码审批验证结果\n6. 重复以上步骤直到任务完成\n\n【assign_task 用法】\n调用 assign_task 工具，参数：\n- agent_id: planner(计划者)、searcher(资料搜索)、developer(代码开发)、reviewer(代码审批)\n- custom_prompt: 给该智能体的具体指令，例如：\n  * "请制定完整的开发计划，包括角色、变量、消息广播"\n  * "请为角色小猫编写移动和转向的脚本，使用execute_operations工具直接修改项目"\n  * "请检查项目是否实现了碰撞检测逻辑"\n\n' + BASE_TOOL_INSTRUCTIONS + '\n\n【你的专属工具 - 必须直接调用】\n- get_project_info: 查看当前项目状态（无参数）\n- execute_operations: 执行架构层面的调整（参数是operations数组）\n- mute_agent(agent_id): 禁言某个智能体\n- unmute_agent(agent_id): 取消禁言某个智能体\n- assign_task(agent_id, custom_prompt): 临时开启一个智能体发言，并给他具体指令\n- get_system_time / get_system_info: 获取系统信息\n\n作为总策划，请用中文回复。**你必须通过 assign_task 工具来分配工作给其他智能体**，不要在文字中让他们"开始工作"，直接调用 assign_task 工具即可。' },
        { id: 'planner', name: '计划者', icon: '计', avatarClass: 'planner', labelClass: 'planner',
          tools: ['get_project_info', 'execute_operations', 'get_system_time', 'get_system_info'],
          systemPrompt: '你是ScratchAgent团队的计划者。你的职责是：\n1. 根据总策划的方向，制定详细的Scratch开发计划\n2. 分解任务为可执行的步骤（角色创建、脚本编写、变量设置等）\n3. 跟踪开发进度，及时调整计划\n4. 确保Scratch项目的逻辑流程清晰（事件触发→条件判断→动作执行）\n\n' + BASE_TOOL_INSTRUCTIONS + '\n\n【你的专属工具 - 必须直接调用】\n- get_project_info: 查看当前项目状态来跟踪进度（无参数）\n- execute_operations: 执行计划相关的项目调整（参数是operations数组）\n- get_system_time / get_system_info: 获取系统信息\n\n作为计划者，请用中文回复，给出具体的执行步骤和进度跟踪。调用工具时直接发起function call。' },
        { id: 'searcher', name: '资料搜索', icon: '搜', avatarClass: 'searcher', labelClass: 'searcher',
          tools: ['get_project_info', 'search_extensions', 'get_installed_extensions', 'web_search', 'get_system_time', 'get_system_info'],
          systemPrompt: '你是ScratchAgent团队的资料搜索专家。你的职责是：\n1. 提供Scratch 3.0积木的详细使用说明和最佳实践\n2. 搜索并分享实现特定功能所需的积木组合方案\n3. 解释Scratch各类积木的用途：运动、外观、声音、事件、控制、侦测、运算、变量、自定义积木\n4. 提供Scratch项目的优化建议和常见问题解决方案\n5. 通过互联网搜索获取最新的技术资料和编程知识\n\n' + BASE_TOOL_INSTRUCTIONS + '\n\n【你的专属工具 - 必须直接调用】\n- get_project_info: 查看当前项目结构（无参数）\n- search_extensions: 搜索可用扩展（参数：keyword关键词）\n- get_installed_extensions: 查看已安装扩展（无参数）\n- web_search(query): 搜索互联网资料，获取Scratch技术文档、编程教程、游戏设计思路、数学公式等【核心工具】\n- get_system_time / get_system_info: 获取系统信息\n\n作为资料搜索专家，请用中文回复，提供具体的技术资料和积木使用示例。调用工具时直接发起function call。另外，当需要查找外部资料时，务必使用 web_search 工具联网搜索。' },
        { id: 'developer', name: '代码开发', icon: '码', avatarClass: 'developer', labelClass: 'developer',
          tools: ['get_project_info', 'execute_operations', 'create_variable', 'create_list', 'set_variable', 'add_to_list', 'delete_from_list', 'add_sprite', 'delete_sprite', 'duplicate_sprite', 'change_costume', 'add_backdrop', 'change_backdrop', 'set_sprite_property', 'click_green_flag', 'install_extension', 'develop_extension', 'set_stage_size', 'rename_project', 'get_system_time', 'get_system_info', 'add_costume_from_url', 'add_sprite_from_url', 'get_stage_screenshot', 'plan_todos', 'update_todo'],
          systemPrompt: '你是ScratchAgent团队的代码开发工程师。你的职责是：\n1. 根据需求和计划，编写具体的Scratch积木脚本\n2. 为每个角色编写完整的脚本逻辑\n3. 使用Scratch积木语法描述代码（如：当绿旗被点击、重复执行、如果...那么等）\n4. 确保代码逻辑正确，包括事件处理、循环、条件判断、变量操作\n5. 可以添加注释来解释代码逻辑，方便团队协作\n\n' + BASE_TOOL_INSTRUCTIONS + '\n\n【你的专属工具 - 必须直接调用（这是你的核心工作）】\n- execute_operations: 添加/修改积木脚本、添加注释（参数是operations数组，描述见上方）【最常用】\n- create_variable(variable_name, is_for_all_sprites): 创建变量\n- create_list(list_name, sprite_name): 创建列表\n- set_variable(variable_name, value, sprite_name): 设置变量值\n- add_to_list / delete_from_list: 操作列表\n- add_sprite(name) / delete_sprite(name): 添加/删除角色\n\
- duplicate_sprite(source_name, new_name): 复制角色（复制所有造型、声音、脚本和变量）\n\
- add_costume_from_url(sprite_name, url, costume_name): 从URL添加造型到角色\n\
- add_sprite_from_url(sprite_name, url): 从URL添加角色（图片作为造型）\n\
- get_stage_screenshot: 获取舞台区截图（用于视觉检查，多模态模型可用）\n\
- change_costume(sprite_name, costume_name): 切换造型\n- add_backdrop(name) / change_backdrop(name): 添加/切换背景\n- set_sprite_property(sprite_name, property, value): 调整角色属性\n- click_green_flag: 测试运行项目\n- install_extension / develop_extension: 安装或开发扩展\n- set_stage_size(width, height): 设置舞台大小\n- rename_project(new_name): 重命名项目\n- get_project_info: 查看项目信息\n- get_system_time / get_system_info: 获取系统信息\n\n【操作示例】\n- 添加一个绿旗启动脚本到角色"小猫"：调用 execute_operations，参数 operations: [{action: "add_script", sprite: "小猫", x: 0, y: 0, blocks: [{type: "event_whenflagclicked"}, {type: "motion_movesteps", params: {STEPS: 10}}]}]\n- 创建变量"分数"：调用 create_variable(variable_name: "分数", is_for_all_sprites: true)\n- 创建列表"排行榜"：调用 create_list(list_name: "排行榜", sprite_name: "")\n- 添加注释：调用 execute_operations，参数 operations: [{action: "add_comment", sprite: "小猫", targetId: "b1", text: "这是移动逻辑"}]\n- 添加角色"狗"：调用 add_sprite(name: "狗")\n- 添加背景"森林"：调用 add_backdrop(name: "森林")\n- 测试运行：调用 click_green_flag()\n\n作为代码开发工程师，核心工作是直接调用工具修改项目！不要只输出文字描述代码。调用工具时直接发起function call，不要先说"我将调用xxx工具"之类的废话，直接调用即可。请用中文回复。' },
        { id: 'reviewer', name: '代码审批', icon: '审', avatarClass: 'reviewer', labelClass: 'reviewer',
          tools: ['get_project_info', 'execute_operations', 'click_green_flag', 'get_system_time', 'get_system_info', 'get_stage_screenshot'],
          systemPrompt: '你是ScratchAgent团队的代码审批专家。你的职责是：\n1. 审查其他智能体（尤其是代码开发）输出的Scratch积木脚本\n2. 检查逻辑错误、边界条件、性能问题\n3. 确保代码符合Scratch编程规范\n4. 提出具体的修改建议，并验证修改后的代码\n\n' + BASE_TOOL_INSTRUCTIONS + '\n\n【你的专属工具 - 必须直接调用】\n- get_project_info: 查看当前项目代码进行审查（无参数）\n- execute_operations: 直接修复发现的问题（参数是operations数组）\n- click_green_flag: 运行项目测试\n- get_system_time / get_system_info: 获取系统信息\n\n作为代码审批专家，请用中文回复，给出明确的审查结果和修改建议。调用工具时直接发起function call。' },
    ];

    var sharedAgentContext = '';
    var agentOutputs = {};

    var currentLocale = 'en';
    var i18nStrings = {};

    var TRANSLATIONS = {
        en: {
            appTitle: 'AI Assistant',
            sidebarTitle: 'Chats',
            newChat: 'New Chat',
            newChatTooltip: 'New chat',
            menuTooltip: 'Menu',
            clearChat: 'Clear chat',
            settings: 'Settings',
            selectModel: 'Select Model',
            messagePlaceholder: 'Message...',
            send: 'Send',
            stop: 'Stop',
            welcomeTitle: 'AI Programming Assistant',
            welcomeSubtitle: 'Configure an API in Settings to start<br>Supports project code context, streaming, reasoning<br>Click the Settings icon to add models',
            modelSettings: 'Model Settings',
            addModel: 'Add Model',
            editModel: 'Edit Model',
            deleteModel: 'Delete',
            useModel: 'Use',
            save: 'Save',
            cancel: 'Cancel',
            name: 'Name',
            provider: 'Provider',
            model: 'Model',
            apiKey: 'API Key',
            customEndpoint: 'Custom Endpoint',
            active: 'Active',
            unnamed: 'Unnamed',
            noKey: '(No Key)',
            unknown: 'Unknown',
            atLeastOneConfig: 'Keep at least one config',
            configSaved: 'Config saved',
            configDeleted: 'Config deleted',
            switchedTo: 'Switched to',
            modelAdded: 'Model added',
            pleaseEnterApiKey: 'Please enter API Key',
            configureApiKeyFirst: 'Configure API Key first',
            settingsSaved: 'Settings saved',
            chatCleared: 'Chat cleared',
            generationCancelled: 'Generation cancelled',
            copied: 'Copied',
            copy: 'Copy',
            apply: 'Apply',
            applied: 'Applied!',
            applying: 'Applying...',
            projectUpdated: 'Project updated successfully',
            failedToApply: 'Failed to apply project',
            invalidJson: 'Invalid JSON in code block',
            preloadNotAvailable: 'Preload not available',
            currentModelNoVision: 'Current model does not support images',
            error: 'Error',
            thinking: 'Thinking...',
            reasoning: 'Reasoning',
            skillCall: 'Skill Call',
            executing: 'Executing operations...',
            importantNotice: 'Important Notice',
            backupPrompt: 'Please back up your project before proceeding. AI-generated content should be reviewed carefully.',
            backupPromptCn: '请您先备份项目，备份后再使用AI功能，AI生成内容请注意鉴别',
            backupConfirm: 'I have backed up',
            exit: 'Exit',
            deleteConfirm: 'Delete this conversation?',
            conversationDeleted: 'Conversation deleted',
            untitledChat: 'New Chat'
        },
        zh: {
            appTitle: 'AI 助手',
            sidebarTitle: '对话列表',
            newChat: '新建对话',
            newChatTooltip: '新建对话',
            menuTooltip: '菜单',
            clearChat: '清空对话',
            settings: '设置',
            selectModel: '选择模型',
            messagePlaceholder: '输入消息...',
            send: '发送',
            stop: '停止',
            welcomeTitle: 'AI 编程助手',
            welcomeSubtitle: '在设置中配置 API 以开始<br>支持项目代码上下文、流式输出、推理<br>点击设置图标添加模型',
            modelSettings: '模型设置',
            addModel: '添加模型',
            editModel: '编辑模型',
            deleteModel: '删除',
            useModel: '使用',
            save: '保存',
            cancel: '取消',
            name: '名称',
            provider: '提供商',
            model: '模型',
            apiKey: 'API 密钥',
            customEndpoint: '自定义接口',
            active: '当前使用',
            unnamed: '未命名',
            noKey: '(无密钥)',
            unknown: '未知',
            atLeastOneConfig: '至少保留一个配置',
            configSaved: '配置已保存',
            configDeleted: '配置已删除',
            switchedTo: '已切换至',
            modelAdded: '模型已添加',
            pleaseEnterApiKey: '请输入 API 密钥',
            configureApiKeyFirst: '请先配置 API 密钥',
            settingsSaved: '设置已保存',
            chatCleared: '对话已清空',
            generationCancelled: '生成已取消',
            copied: '已复制',
            copy: '复制',
            apply: '应用',
            applied: '已应用!',
            applying: '应用中...',
            projectUpdated: '项目更新成功',
            failedToApply: '应用项目失败',
            invalidJson: '代码块中的 JSON 无效',
            preloadNotAvailable: '预加载不可用',
            currentModelNoVision: '当前模型不支持图片',
            error: '错误',
            thinking: '思考中...',
            reasoning: '推理过程',
            skillCall: '工具调用',
            executing: '正在执行操作...',
            importantNotice: '重要提示',
            backupPrompt: '请在使用前备份您的项目。AI 生成的内容需要仔细审查。',
            backupPromptCn: '请您先备份项目，备份后再使用AI功能，AI生成内容请注意鉴别',
            backupConfirm: '我已完成备份',
            exit: '退出',
            deleteConfirm: '删除此对话？',
            conversationDeleted: '对话已删除',
            untitledChat: '新对话'
        }
    };
    TRANSLATIONS['zh-CN'] = TRANSLATIONS.zh;

    function t(key) {
        var str = (i18nStrings && i18nStrings[key]) || (TRANSLATIONS.en && TRANSLATIONS.en[key]) || key;
        return str;
    }

    function setLocale(locale) {
        currentLocale = locale || 'en';
        var baseLang = currentLocale.split('-')[0];
        if (TRANSLATIONS[currentLocale]) {
            i18nStrings = TRANSLATIONS[currentLocale];
        } else if (TRANSLATIONS[baseLang]) {
            i18nStrings = TRANSLATIONS[baseLang];
        } else {
            i18nStrings = TRANSLATIONS.en;
        }
        updateAllText();
    }

    function updateAllText() {
        var appTitleEl = document.getElementById('appTitle');
        if (appTitleEl) appTitleEl.textContent = t('appTitle');
        var sidebarTitleEl = document.getElementById('sidebarTitle');
        if (sidebarTitleEl) sidebarTitleEl.textContent = t('sidebarTitle');
        var welcomeTitleEl = document.querySelector('.welcome-title');
        if (welcomeTitleEl) welcomeTitleEl.textContent = t('welcomeTitle');
        var welcomeSubtitleEl = document.querySelector('.welcome-subtitle');
        if (welcomeSubtitleEl) welcomeSubtitleEl.innerHTML = t('welcomeSubtitle');
        var settingsTitleEl = document.querySelector('.settings-title');
        if (settingsTitleEl) settingsTitleEl.innerHTML = '&#9881;&#65039; ' + t('modelSettings');
        var addModelBtnEl = document.getElementById('addModelBtn');
        if (addModelBtnEl) {
            var svg = addModelBtnEl.querySelector('svg');
            addModelBtnEl.innerHTML = '';
            if (svg) addModelBtnEl.appendChild(svg);
            addModelBtnEl.appendChild(document.createTextNode(' ' + t('addModel')));
        }
        var msgInput = document.getElementById('messageInput');
        if (msgInput) msgInput.placeholder = t('messagePlaceholder');
        var modelDropdownHeader = document.querySelector('.model-dropdown-header');
        if (modelDropdownHeader) modelDropdownHeader.textContent = t('selectModel');
        var newChatBtn = document.getElementById('newChatBtn');
        if (newChatBtn) newChatBtn.title = t('newChatTooltip');
        var menuToggleBtn = document.getElementById('menuToggleBtn');
        if (menuToggleBtn) menuToggleBtn.title = t('menuTooltip');
        var clearChatBtn = document.getElementById('clearChatBtn');
        if (clearChatBtn) clearChatBtn.title = t('clearChat');
        var settingsBtn = document.getElementById('settingsBtn');
        if (settingsBtn) settingsBtn.title = t('settings');
        var sendBtn = document.getElementById('sendBtn');
        if (sendBtn) {
            if (isLoading) sendBtn.setAttribute('aria-label', t('stop'));
            else sendBtn.setAttribute('aria-label', t('send'));
        }
        var disclaimerTitle = document.querySelector('.disclaimer-title');
        if (disclaimerTitle) disclaimerTitle.textContent = t('importantNotice');
        var disclaimerText = document.querySelector('.disclaimer-text');
        if (disclaimerText) disclaimerText.textContent = t('backupPrompt');
        var disclaimerTextCn = document.querySelector('.disclaimer-text-cn');
        if (disclaimerTextCn) disclaimerTextCn.textContent = t('backupPromptCn');
        var disclaimerAcceptBtn = document.getElementById('disclaimerAcceptBtn');
        if (disclaimerAcceptBtn && !disclaimerAcceptBtn.disabled) {
            disclaimerAcceptBtn.innerHTML = t('backupConfirm');
        }
        var disclaimerExitBtn = document.getElementById('disclaimerExitBtn');
        if (disclaimerExitBtn) disclaimerExitBtn.textContent = t('exit');
        renderConversationList();
    }

    function applyTheme(theme) {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark-mode');
        } else {
            document.documentElement.classList.remove('dark-mode');
        }
    }

    function syncThemeWithNeoWarp() {
        if (!window.AIAssistantPreload) return;
        window.AIAssistantPreload.getTheme().then(function(theme) {
            applyTheme(theme);
        }).catch(function() {
            applyTheme('light');
        });
    }

    function init() {
        try { syncThemeWithNeoWarp(); } catch(e) { console.error('syncTheme error:', e); }
        try {
            if (window.AIAssistantPreload) {
                window.AIAssistantPreload.onThemeChanged(function(data) {
                    applyTheme(data.theme || 'light');
                });
                window.AIAssistantPreload.onLocaleChanged(function(data) {
                    setLocale(data.locale || 'en');
                });
                window.AIAssistantPreload.getLocale().then(function(locale) {
                    setLocale(locale || 'en');
                }).catch(function() {
                    setLocale('en');
                });
            } else {
                setLocale('en');
            }
        } catch(e) { try { setLocale('en'); } catch(e2) {} }
        try { loadConfigs(); } catch(e) { console.error('loadConfigs error:', e); }
        try { loadConversations(); } catch(e) { console.error('loadConversations error:', e); }
        try { autoResize(); } catch(e) { console.error('autoResize error:', e); }
        try { setupDisclaimer(); } catch(e) { console.error('setupDisclaimer error:', e); }
        try { setupSidebarEvents(); } catch(e) { console.error('setupSidebarEvents error:', e); }
    }

    function setupDisclaimer() {
        var acceptedKey = 'neowarp-ai-disclaimer-accepted';
        try {
            if (localStorage.getItem(acceptedKey) === '1') return;
        } catch(e) { return; }
        disclaimerOverlay.style.display = 'flex';
        var countdown = 5;
        disclaimerCountdown.textContent = countdown;
        var timer = setInterval(function() {
            countdown--;
            disclaimerCountdown.textContent = countdown;
            if (countdown <= 0) {
                clearInterval(timer);
                disclaimerAcceptBtn.disabled = false;
                disclaimerCountdown.textContent = '0';
                disclaimerAcceptBtn.textContent = t('backupConfirm');
            }
        }, 1000);
        disclaimerAcceptBtn.addEventListener('click', function() {
            if (disclaimerAcceptBtn.disabled) return;
            clearInterval(timer);
            try { localStorage.setItem(acceptedKey, '1'); } catch(e) {}
            disclaimerOverlay.style.display = 'none';
            setTimeout(function() { messageInput.focus(); }, 100);
        });
        disclaimerExitBtn.addEventListener('click', function() {
            if (window.AIAssistantPreload) {
                window.AIAssistantPreload.closeWindow();
            } else {
                window.close();
            }
        });
    }

    function loadConfigs() {
        try {
            var raw = localStorage.getItem('neowarp_ai_models_v2');
            if (raw) {
                savedConfigs = JSON.parse(raw);
                if (!Array.isArray(savedConfigs)) savedConfigs = [];
            }
        } catch(e) { savedConfigs = []; }
        // Migrate old configs to include new custom model fields
        savedConfigs.forEach(function(cfg) {
            if (cfg.customModelId === undefined) cfg.customModelId = '';
            if (cfg.apiFormat === undefined) cfg.apiFormat = 'openai';
            if (cfg.contextWindow === undefined) cfg.contextWindow = 20;
        });
        if (savedConfigs.length === 0) {
            savedConfigs = [createDefaultConfig()];
            activeConfigIndex = 0;
            saveConfigs();
        } else {
            activeConfigIndex = 0;
        }
        applyActiveConfig();
        updateAllUI();
    }

    function loadConversations() {
        try {
            var raw = localStorage.getItem('neowarp_ai_conversations');
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.conversations)) {
                    conversations = parsed.conversations;
                    activeConversationId = parsed.activeConversationId || null;
                    nextConversationId = parsed.nextConversationId || (conversations.length + 1);
                }
            }
        } catch(e) { conversations = []; }
        if (conversations.length === 0) {
            createNewConversation();
        } else {
            if (!activeConversationId || !conversations.find(function(c) { return c.id === activeConversationId; })) {
                activeConversationId = conversations[0].id;
            }
            loadConversation(activeConversationId);
        }
        renderConversationList();
    }

    function saveConversations() {
        try {
            localStorage.setItem('neowarp_ai_conversations', JSON.stringify({
                conversations: conversations,
                activeConversationId: activeConversationId,
                nextConversationId: nextConversationId
            }));
        } catch(e) {}
    }

    function createNewConversation() {
        if (isScratchRunning) {
            exitSplitLayout();
        }
        var id = 'conv_' + nextConversationId++;
        var conv = {
            id: id,
            title: t('untitledChat'),
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        conversations.unshift(conv);
        activeConversationId = id;
        chatHistory = [];
        renderChatHistory();
        saveConversations();
        renderConversationList();
        updateSendBtn();
        if (messageInput) messageInput.focus();
        return id;
    }

    function loadConversation(id) {
        var conv = conversations.find(function(c) { return c.id === id; });
        if (!conv) return;

        if (isScratchRunning) {
            exitSplitLayout();
        }

        activeConversationId = id;
        chatHistory = conv.messages ? conv.messages.slice() : [];
        renderChatHistory();
        saveConversations();
        renderConversationList();
        updateSendBtn();
        if (messageInput) messageInput.focus();
    }

    function saveCurrentConversation() {
        var conv = conversations.find(function(c) { return c.id === activeConversationId; });
        if (!conv) return;
        conv.messages = chatHistory.slice();
        conv.updatedAt = Date.now();
        saveConversations();
    }

    function customConfirm(message) {
        return new Promise(function(resolve) {
            var overlay = document.createElement('div');
            overlay.className = 'dialog-overlay open';
            overlay.style.zIndex = '300';
            var panel = document.createElement('div');
            panel.className = 'dialog-panel';
            panel.style.maxWidth = '360px';
            panel.innerHTML =
                '<div class="dialog-title">' + escapeHtml(message) + '</div>' +
                '<div style="display:flex;gap:10px;justify-content:center;margin-top:8px;">' +
                '<button class="btn btn-secondary" data-action="cancel" style="flex:0 0 auto;padding:10px 22px;">' + t('cancel') + '</button>' +
                '<button class="btn btn-primary" data-action="ok" style="flex:0 0 auto;padding:10px 22px;background:#e74c3c;color:#fff;">' + t('deleteModel') + '</button>' +
                '</div>';
            overlay.appendChild(panel);
            document.body.appendChild(overlay);
            function close(result) {
                overlay.classList.remove('open');
                setTimeout(function() { if (overlay.parentNode) overlay.remove(); }, 200);
                resolve(result);
            }
            panel.querySelector('[data-action="ok"]').addEventListener('click', function() { close(true); });
            panel.querySelector('[data-action="cancel"]').addEventListener('click', function() { close(false); });
            overlay.addEventListener('click', function(e) { if (e.target === overlay) close(false); });
            document.addEventListener('keydown', function escHandler(e) {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', escHandler);
                    close(false);
                }
            });
        });
    }

    function deleteConversation(id) {
        customConfirm(t('deleteConfirm')).then(function(confirmed) {
            if (!confirmed) return;
            var idx = conversations.findIndex(function(c) { return c.id === id; });
            if (idx === -1) return;
            if (activeConversationId === id && isLoading && abortController) {
                abortController.abort();
            }
            conversations.splice(idx, 1);
            if (activeConversationId === id) {
                if (conversations.length > 0) {
                    activeConversationId = conversations[0].id;
                    loadConversation(activeConversationId);
                } else {
                    createNewConversation();
                }
            }
            saveConversations();
            renderConversationList();
            updateSendBtn();
            showToast(t('conversationDeleted'), 'success');
            setTimeout(function() { if (messageInput) messageInput.focus(); }, 100);
        });
    }

    function renderConversationList() {
        var list = document.getElementById('chatList');
        if (!list) return;
        list.innerHTML = '';
        conversations.forEach(function(conv) {
            var item = document.createElement('div');
            item.className = 'chat-item' + (conv.id === activeConversationId ? ' active' : '');
            var date = new Date(conv.updatedAt);
            var timeStr = ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2);
            item.innerHTML =
                '<svg class="chat-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>' +
                '<div class="chat-item-content">' +
                '<span class="chat-item-title">' + escapeHtml(conv.title || t('untitledChat')) + '</span>' +
                '<span class="chat-item-time">' + timeStr + '</span>' +
                '</div>' +
                '<button class="chat-item-delete" title="' + t('deleteModel') + '">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>' +
                '</button>';
            item.addEventListener('click', function(e) {
                if (e.target.closest('.chat-item-delete')) return;
                if (conv.id !== activeConversationId) {
                    saveCurrentConversation();
                    loadConversation(conv.id);
                }
            });
            var delBtn = item.querySelector('.chat-item-delete');
            if (delBtn) {
                delBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    deleteConversation(conv.id);
                });
            }
            list.appendChild(item);
        });
    }

    function setupSidebarEvents() {
        var newChatBtn = document.getElementById('newChatBtn');
        var newChatDropdown = document.getElementById('newChatDropdown');
        var aicodeOption = document.getElementById('aicodeOption');
        var scratchOption = document.getElementById('scratchOption');

        function openNewChatDropdown() {
            if (newChatDropdown) newChatDropdown.classList.add('open');
        }
        function closeNewChatDropdown() {
            if (newChatDropdown) newChatDropdown.classList.remove('open');
        }

        if (newChatBtn) {
            newChatBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (newChatDropdown && newChatDropdown.classList.contains('open')) {
                    closeNewChatDropdown();
                } else {
                    openNewChatDropdown();
                }
            });
        }

        if (aicodeOption) {
            aicodeOption.addEventListener('click', function() {
                closeNewChatDropdown();
                saveCurrentConversation();
                createNewConversation();
                closeSidebarMobile();
            });
        }

        if (scratchOption) {
            scratchOption.addEventListener('click', function() {
                closeNewChatDropdown();
                openScratchConfigDialog();
                closeSidebarMobile();
            });
        }

        document.addEventListener('click', function(e) {
            if (newChatDropdown && !newChatDropdown.contains(e.target) && e.target !== newChatBtn) {
                closeNewChatDropdown();
            }
        });

        var menuToggleBtn = document.getElementById('menuToggleBtn');
        if (menuToggleBtn) {
            menuToggleBtn.addEventListener('click', function() {
                var sidebar = document.getElementById('sidebar');
                var overlay = document.getElementById('sidebarOverlay');
                if (sidebar.classList.contains('collapsed')) {
                    sidebar.classList.remove('collapsed');
                }
                sidebar.classList.toggle('open');
                overlay.classList.toggle('open');
            });
        }
        var sidebarOverlay = document.getElementById('sidebarOverlay');
        if (sidebarOverlay) {
            sidebarOverlay.addEventListener('click', closeSidebarMobile);
        }
    }

    function closeSidebarMobile() {
        var sidebar = document.getElementById('sidebar');
        var overlay = document.getElementById('sidebarOverlay');
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('open');
    }

    function createDefaultConfig() {
        return { id: 'cfg_' + Date.now(), name: 'Default', provider: 'openai', model: 'gpt-5.4', apiKey: '', customEndpoint: '', customModelId: '', apiFormat: 'openai', contextWindow: 20 };
    }

    function createConfig(name, provider, model) {
        return { id: 'cfg_' + Date.now(), name: name, provider: provider, model: model, apiKey: '', customEndpoint: '', customModelId: '', apiFormat: 'openai', contextWindow: 20 };
    }

    function saveConfigs() {
        try { localStorage.setItem('neowarp_ai_models_v2', JSON.stringify(savedConfigs)); } catch(e) {}
    }

    function applyActiveConfig() {
        if (activeConfigIndex >= 0 && activeConfigIndex < savedConfigs.length) {
            var cfg = savedConfigs[activeConfigIndex];
            currentConfig.apiKey = cfg.apiKey || '';
            currentConfig.provider = cfg.provider || 'openai';
            currentConfig.model = cfg.model || '';
            currentConfig.customEndpoint = cfg.customEndpoint || '';
            currentConfig.customModelId = cfg.customModelId || '';
            currentConfig.apiFormat = cfg.apiFormat || 'openai';
            currentConfig.contextWindow = cfg.contextWindow || 20;
            currentConfig.name = cfg.name || '';
        } else {
            currentConfig.apiKey = '';
            currentConfig.provider = 'openai';
            currentConfig.model = '';
            currentConfig.customEndpoint = '';
            currentConfig.customModelId = '';
            currentConfig.apiFormat = 'openai';
            currentConfig.contextWindow = 20;
            currentConfig.name = '';
        }
    }

    function getModelInfo() {
        var p = PROVIDERS[currentConfig.provider];
        return (p && p.models.find(function(m) { return m.id === currentConfig.model; })) || (p && p.models[0]);
    }

    function updateModelDisplay() {
        var m = getModelInfo();
        var label;
        if (activeConfigIndex >= 0 && savedConfigs[activeConfigIndex]) {
            label = savedConfigs[activeConfigIndex].name || (m ? m.name : 'Model');
        } else {
            label = m ? m.name : 'Model';
        }
        modelNameDisplay.textContent = label;
        modelShortDisplay.textContent = label.length > 8 ? label.substring(0, 7) + '\u2026' : (label || 'Model');
        modelStatusDot.style.display = currentConfig.apiKey ? 'inline-block' : 'none';
        updateSettingDot();
        updateImageUploadVisibility();
    }

    function updateSettingDot() {
        settingDot.classList.toggle('visible', !currentConfig.apiKey);
    }

    function updateImageUploadVisibility() {
        var p = PROVIDERS[currentConfig.provider];
        if (p && p.supportsVision !== false) {
            imageUploadBtn.classList.remove('hidden');
        } else {
            imageUploadBtn.classList.add('hidden');
            pendingImages = [];
            renderImagePreview();
        }
    }

    function updateAllUI() {
        updateModelDisplay();
        populateModelSwitcherDropdown();
        renderModelConfigList();
    }

    function renderModelConfigList() {
        var list = document.getElementById('modelConfigList');
        if (!list) return;
        list.innerHTML = '';
        for (var i = 0; i < savedConfigs.length; i++) {
            (function(idx) {
                var cfg = savedConfigs[idx];
                var p = PROVIDERS[cfg.provider] || {};
                var m = (p.models || []).find(function(x) { return x.id === cfg.model; });
                var isActive = idx === activeConfigIndex;

                var card = document.createElement('div');
                card.className = 'model-config-card' + (isActive ? ' active' : '');

                var nameDisplay = cfg.name || (m ? m.name : 'Unnamed');
                var apiKeyDisplay = cfg.apiKey ? (cfg.apiKey.substring(0, 6) + '...' + cfg.apiKey.substring(cfg.apiKey.length - 4)) : '(No Key)';
                var providerName = p.name || cfg.provider;
                var modelName = m ? m.name : (cfg.model || 'Unknown');
                var displayModelId = cfg.customModelId || cfg.model || 'Unknown';
                var displayEndpoint = cfg.customEndpoint || p.endpoint || '';

                card.innerHTML =
                    '<div class="config-header">' +
                    '<span class="config-name">' + escapeHtml(nameDisplay) + '</span>' +
                    (isActive ? '<span class="config-badge">Active</span>' : '') +
                    '</div>' +
                    '<div class="config-detail">Provider: <span>' + escapeHtml(providerName) + '</span> &nbsp;|&nbsp; Model: <span>' + escapeHtml(modelName) + '</span></div>' +
                    (p.isCustom ? '<div class="config-detail">Model ID: <span>' + escapeHtml(displayModelId) + '</span></div>' : '') +
                    '<div class="config-detail">API Key: <span>' + escapeHtml(apiKeyDisplay) + '</span></div>' +
                    (displayEndpoint ? '<div class="config-detail">Endpoint: <span>' + escapeHtml(displayEndpoint) + '</span></div>' : '') +
                    (cfg.contextWindow ? '<div class="config-detail">Context: <span>' + escapeHtml(String(cfg.contextWindow)) + ' msgs</span></div>' : '') +
                    '<div class="config-actions">' +
                    (!isActive ? '<button class="config-action-btn primary select-cfg-btn">使用</button>' : '') +
                    '<button class="config-action-btn edit-cfg-btn">编辑</button>' +
                    '<button class="config-action-btn danger delete-cfg-btn">删除</button>' +
                    '</div>';

                card.querySelector('.select-cfg-btn') && card.querySelector('.select-cfg-btn').addEventListener('click', function(e) {
                    e.stopPropagation();
                    activeConfigIndex = idx;
                    applyActiveConfig();
                    saveConfigs();
                    updateAllUI();
                    showToast('已切换至 ' + escapeHtml(nameDisplay), 'success');
                });
                card.querySelector('.edit-cfg-btn').addEventListener('click', function(e) {
                    e.stopPropagation();
                    editConfig(idx);
                });
                card.querySelector('.delete-cfg-btn').addEventListener('click', function(e) {
                    e.stopPropagation();
                    deleteConfig(idx);
                });

                list.appendChild(card);
            })(i);
        }
    }

    var API_FORMATS = {
        openai: { name: 'OpenAI 兼容', defaultEndpoint: '' },
        anthropic: { name: 'Anthropic', defaultEndpoint: 'https://api.anthropic.com/v1/messages' },
        ollama: { name: 'Ollama', defaultEndpoint: 'http://localhost:11434/api/chat' },
        custom: { name: '自定义', defaultEndpoint: '' }
    };

    function editConfig(idx) {
        var cfg = savedConfigs[idx];
        var p = PROVIDERS[cfg.provider] || {};
        var isCustom = p.isCustom;

        var dialogOverlay = document.createElement('div');
        dialogOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:200;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);';
        var dialog = document.createElement('div');
        dialog.style.cssText = 'background:var(--surface);border-radius:var(--radius-lg);padding:24px;width:92%;max-width:480px;max-height:88vh;overflow-y:auto;box-shadow:var(--shadow-xl);';

        var provOptions = Object.keys(PROVIDERS).map(function(k) {
            return '<option value="' + k + '"' + (cfg.provider === k ? ' selected' : '') + '>' + PROVIDERS[k].name + '</option>';
        }).join('');

        var apiFormatOptions = Object.keys(API_FORMATS).map(function(k) {
            return '<option value="' + k + '"' + (cfg.apiFormat === k ? ' selected' : '') + '>' + API_FORMATS[k].name + '</option>';
        }).join('');

        var curP = PROVIDERS[cfg.provider] || {};
        var modelOptions = (curP.models || []).map(function(m) {
            return '<option value="' + m.id + '"' + (cfg.model === m.id ? ' selected' : '') + '>' + m.name + '</option>';
        }).join('');

        function field(id, label, type, value, placeholder, hidden) {
            return '<div class="settings-field"' + (hidden ? ' style="display:none;"' : '') + ' id="' + id + 'Row"><label class="settings-field-label">' + label + '</label>' +
                '<input' + (type === 'password' ? ' type="password"' : (type === 'number' ? ' type="number" min="1" max="10000"' : ' type="text"')) + ' id="' + id + '" value="' + escapeHtml(value || '') + '" class="settings-input' + (type === 'text' || type === 'password' ? ' settings-input-mono' : '') + '" placeholder="' + (placeholder || '') + '"></div>';
        }
        function select(id, label, options, hidden) {
            return '<div class="settings-field"' + (hidden ? ' style="display:none;"' : '') + ' id="' + id + 'Row"><label class="settings-field-label">' + label + '</label>' +
                '<select id="' + id + '" class="settings-input">' + options + '</select></div>';
        }

        dialog.innerHTML =
            '<h3 style="margin:0 0 20px;font-size:18px;font-weight:700;letter-spacing:-0.3px;">编辑模型配置</h3>' +
            field('editCfgName', '名称', 'text', cfg.name, 'e.g. My OpenAI') +
            select('editCfgProvider', 'Provider', provOptions) +
            select('editCfgModel', 'Model', modelOptions) +
            select('editCfgApiFormat', 'API 格式', apiFormatOptions, !isCustom) +
            field('editCfgEndpoint', '自定义请求地址', 'text', cfg.customEndpoint, 'https://api.example.com/v1/chat/completions', !isCustom) +
            field('editCfgCustomModelId', '模型 ID', 'text', cfg.customModelId, 'e.g. gpt-4o', !isCustom) +
            field('editCfgApiKey', 'API 密钥', 'password', cfg.apiKey, 'sk-...') +
            field('editCfgContextWindow', '上下文窗口', 'number', cfg.contextWindow, '消息数量，如 20') +
            '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px;">' +
            '<button id="editCancelBtn" class="btn btn-secondary" style="flex:0 0 auto;padding:10px 18px;">取消</button>' +
            '<button id="editSaveBtn" class="btn btn-primary" style="flex:0 0 auto;padding:10px 18px;">保存</button>' +
            '</div>';

        dialogOverlay.appendChild(dialog);
        document.body.appendChild(dialogOverlay);

        var editProv = dialog.querySelector('#editCfgProvider');
        var editModel = dialog.querySelector('#editCfgModel');
        var editApiFormat = dialog.querySelector('#editCfgApiFormat');

        function updateCustomFieldsVisibility() {
            var newP = PROVIDERS[editProv.value] || {};
            var custom = newP.isCustom;
            dialog.querySelector('#editCfgApiFormatRow').style.display = custom ? '' : 'none';
            dialog.querySelector('#editCfgEndpointRow').style.display = custom ? '' : 'none';
            dialog.querySelector('#editCfgCustomModelIdRow').style.display = custom ? '' : 'none';
        }

        editProv.addEventListener('change', function() {
            var newP = PROVIDERS[editProv.value];
            var models = newP ? (newP.models || []) : [];
            editModel.innerHTML = models.map(function(m) { return '<option value="' + m.id + '">' + m.name + '</option>'; }).join('');
            updateCustomFieldsVisibility();
        });

        dialogOverlay.addEventListener('click', function(e) { if (e.target === dialogOverlay) { document.body.removeChild(dialogOverlay); } });
        dialog.querySelector('#editCancelBtn').addEventListener('click', function() { document.body.removeChild(dialogOverlay); });
        dialog.querySelector('#editSaveBtn').addEventListener('click', function() {
            cfg.name = dialog.querySelector('#editCfgName').value.trim() || 'Unnamed';
            cfg.provider = editProv.value;
            cfg.model = editModel.value;
            cfg.apiFormat = editApiFormat.value;
            cfg.customEndpoint = dialog.querySelector('#editCfgEndpoint').value.trim();
            cfg.customModelId = dialog.querySelector('#editCfgCustomModelId').value.trim();
            cfg.apiKey = dialog.querySelector('#editCfgApiKey').value.trim();
            var cw = parseInt(dialog.querySelector('#editCfgContextWindow').value, 10);
            cfg.contextWindow = isNaN(cw) || cw < 1 ? 20 : cw;
            if (idx === activeConfigIndex) applyActiveConfig();
            saveConfigs();
            updateAllUI();
            document.body.removeChild(dialogOverlay);
            showToast('配置已保存', 'success');
        });
    }

    function deleteConfig(idx) {
        if (savedConfigs.length <= 1) {
            showToast('至少保留一个配置', 'error');
            return;
        }
        var name = savedConfigs[idx].name || 'Unnamed';
        savedConfigs.splice(idx, 1);
        if (activeConfigIndex === idx) {
            activeConfigIndex = Math.min(activeConfigIndex, savedConfigs.length - 1);
        } else if (activeConfigIndex > idx) {
            activeConfigIndex--;
        }
        applyActiveConfig();
        saveConfigs();
        updateAllUI();
        showToast('已删除 ' + escapeHtml(name), 'success');
    }

    function populateModelSwitcherDropdown() {
        modelDropdownList.innerHTML = '';
        for (var i = 0; i < savedConfigs.length; i++) {
            (function(idx) {
                var cfg = savedConfigs[idx];
                var p = PROVIDERS[cfg.provider] || {};
                var m = (p.models || []).find(function(x) { return x.id === cfg.model; });
                var item = document.createElement('div');
                item.className = 'model-dropdown-item' + (idx === activeConfigIndex ? ' active' : '');
                item.innerHTML = '<span class="provider-logo" style="background:' + (p.logo || '#888') + ';">' + (p.logoText || '?') + '</span>' +
                    '<span>' + escapeHtml(cfg.name || (m ? m.name : 'Model')) + '</span>' +
                    '<span style="font-size:11px;color:var(--text-tertiary);">' + escapeHtml(p.name || cfg.provider) + '</span>' +
                    '<svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                item.addEventListener('click', function(e) {
                    e.stopPropagation();
                    activeConfigIndex = idx;
                    applyActiveConfig();
                    saveConfigs();
                    updateAllUI();
                    closeModelDropdown();
                    showToast('已切换至 ' + escapeHtml(cfg.name || 'Model'), 'success');
                });
                modelDropdownList.appendChild(item);
            })(i);
        }
    }

    function openModelDropdown() {
        populateModelSwitcherDropdown();
        modelDropdown.style.display = 'block';
        modelSelectBtn.classList.add('open');
        modelDropdownOpen = true;
    }

    function closeModelDropdown() {
        modelDropdown.style.display = 'none';
        modelSelectBtn.classList.remove('open');
        modelDropdownOpen = false;
    }

    function openSettings() {
        settingsOverlay.classList.add('open');
        settingsOpen = true;
        renderModelConfigList();
        closeModelDropdown();
    }

    function closeSettings() {
        settingsOverlay.classList.remove('open');
        settingsOpen = false;
    }

    function showToast(msg, type) {
        if (toastTimer) clearTimeout(toastTimer);
        toast.textContent = msg;
        toast.className = 'toast ' + (type || '') + ' show';
        toastTimer = setTimeout(function() { toast.classList.remove('show'); toast.className = 'toast'; }, 2200);
    }

    function getSystemPromptLanguage() {
        var baseLang = (currentLocale || 'en').split('-')[0];
        if (baseLang === 'zh') return 'Chinese';
        if (baseLang === 'ja') return 'Japanese';
        if (baseLang === 'ko') return 'Korean';
        if (baseLang === 'fr') return 'French';
        if (baseLang === 'de') return 'German';
        if (baseLang === 'es') return 'Spanish';
        if (baseLang === 'ru') return 'Russian';
        if (baseLang === 'pt') return 'Portuguese';
        if (baseLang === 'it') return 'Italian';
        return 'English';
    }

    function clearChat() {
        if (!chatHistory.length || isLoading) return;
        chatHistory = [];
        welcomeMessage.style.display = 'flex';
        renderChatHistory();
        saveCurrentConversation();
        updateSendBtn();
        showToast(t('chatCleared'), 'success');
    }

    function openScratchConfigDialog() {
        var dialog = document.getElementById('scratchConfigDialog');
        if (dialog) dialog.classList.add('open');
        var req = document.getElementById('scratchRequirement');
        if (req) req.value = '';
        var slider = document.getElementById('timeRangeSlider');
        if (slider) slider.value = 120;
        updateTimeRangeValue();
        var tc = document.getElementById('timeRangeContainer');
        if (tc) tc.classList.remove('visible');
        var radios = document.querySelectorAll('#scratchConfigDialog .end-condition-radio');
        radios.forEach(function(r) { r.classList.remove('selected'); });
        if (radios[0]) radios[0].classList.add('selected');
        scratchEndCondition = 'ai';
        populateScratchModelSelect();
    }

    function populateScratchModelSelect() {
        var select = document.getElementById('scratchModelSelect');
        if (!select) return;
        select.innerHTML = '';
        var hasOption = false;
        savedConfigs.forEach(function(cfg, idx) {
            var p = PROVIDERS[cfg.provider] || {};
            var m = (p.models || []).find(function(x) { return x.id === cfg.model; });
            if (cfg.apiKey && m) {
                var option = document.createElement('option');
                option.value = idx;
                option.textContent = (cfg.name || m.name || cfg.model) + ' (' + (p.name || cfg.provider) + ')';
                select.appendChild(option);
                hasOption = true;
            }
        });
        if (!hasOption) {
            var option = document.createElement('option');
            option.value = '';
            option.textContent = '\u8bf7\u5148\u5728\u8bbe\u7f6e\u4e2d\u914d\u7f6e API';
            select.appendChild(option);
        }
    }

    function closeScratchConfigDialog() {
        var dialog = document.getElementById('scratchConfigDialog');
        if (dialog) dialog.classList.remove('open');
    }

    function updateTimeRangeValue() {
        var slider = document.getElementById('timeRangeSlider');
        if (!slider) return;
        var val = parseInt(slider.value);
        scratchTimeMinutes = val;
        var display = '';
        if (val < 60) {
            display = val + '\u5206\u949f';
        } else {
            var hours = Math.floor(val / 60);
            var mins = val % 60;
            if (mins === 0) {
                display = hours + '\u5c0f\u65f6';
            } else {
                display = hours + '\u5c0f\u65f6' + mins + '\u5206\u949f';
            }
        }
        var label = document.getElementById('timeRangeValue');
        if (label) label.textContent = display;
    }

    function startScratchAgent() {
        var reqEl = document.getElementById('scratchRequirement');
        var requirement = reqEl ? reqEl.value.trim() : '';
        if (!requirement) {
            showToast('\u8bf7\u8f93\u5165\u4efb\u52a1\u8981\u6c42', 'error');
            return;
        }
        var modelSelect = document.getElementById('scratchModelSelect');
        var selectedConfigIdx = modelSelect ? parseInt(modelSelect.value) : -1;
        if (isNaN(selectedConfigIdx) || selectedConfigIdx < 0 || selectedConfigIdx >= savedConfigs.length || !savedConfigs[selectedConfigIdx].apiKey) {
            showToast('\u8bf7\u5148\u5728\u8bbe\u7f6e\u4e2d\u914d\u7f6e API Key', 'error');
            return;
        }

        closeScratchConfigDialog();

        activeConfigIndex = selectedConfigIdx;
        applyActiveConfig();
        updateAllUI();

        saveCurrentConversation();
        var id = createNewConversation();
        var conv = conversations.find(function(c) { return c.id === id; });
        if (conv) {
            conv.title = '[ScratchAgent] ' + requirement.substring(0, 20) + (requirement.length > 20 ? '...' : '');
            conv.type = 'scratch';
        }

        var appContainer = document.getElementById('appContainer');
        if (appContainer) appContainer.classList.add('split-layout');
        isScratchRunning = true;
        _agentMessageIds = {};

        buildAgentPanel();
        updateAgentStatuses('idle', '\u7b49\u5f85\u542f\u52a8...');

        var userMsg = {
            role: 'user',
            content: '[ScratchAgent] \u4efb\u52a1\u8981\u6c42\uff1a' + requirement,
            time: formatTime(new Date()),
        };
        chatHistory.push(userMsg);
        appendUserMessage(userMsg.content, userMsg.time, [], true);
        saveCurrentConversation();

        var systemMsg = {
            role: 'assistant',
            content: 'ScratchAgent \u591a\u667a\u80fd\u4f53\u534f\u4f5c\u5df2\u542f\u52a8\uff0c5\u4e2a\u667a\u80fd\u4f53\u6b63\u5728\u534f\u540c\u5de5\u4f5c...',
            time: formatTime(new Date()),
        };
        chatHistory.push(systemMsg);
        appendAIMessage(systemMsg.content, systemMsg.time, '', [], true);
        saveCurrentConversation();
        updateSendBtn();

        if (scratchEndCondition === 'timed') {
            var timeoutMs = scratchTimeMinutes * 60 * 1000;
            scratchTimerId = setTimeout(function() {
                stopScratchAgent('\u5b9a\u65f6\u7ed3\u675f\u65f6\u95f4\u5df2\u5230');
            }, timeoutMs);
        }

        runAgentSimulation(requirement);
    }

    function stopScratchAgent(reason) {
        if (!isScratchRunning) return;
        isScratchRunning = false;
        _agentMessageIds = {};

        scratchAgentTimers.forEach(function(t) {
            clearTimeout(t);
        });
        scratchAgentTimers = [];
        if (scratchTimerId) {
            clearTimeout(scratchTimerId);
            scratchTimerId = null;
        }
        _agentFinishFlags = {};
        mutedAgents = {};
        agentRoundPrompts = {};

        updateAgentStatuses('done', '\u4efb\u52a1\u5b8c\u6210');

        if (scratchEndCondition === 'timed' && reason && reason.indexOf('\u5b9a\u65f6') !== -1) {
            startBonusFeatureDiscussion();
            return;
        }

        var endMsg = {
            role: 'assistant',
            content: 'ScratchAgent \u8fd0\u884c\u7ed3\u675f\u3002' + (reason || '\u4efb\u52a1\u5df2\u5b8c\u6210') + '\n\n\u611f\u8c22\u4f7f\u7528\u591a\u667a\u80fd\u4f53\u534f\u4f5c\u6a21\u5f0f\uff01',
            time: formatTime(new Date()),
        };
        chatHistory.push(endMsg);
        appendAIMessage(endMsg.content, endMsg.time, '', [], true);
        saveCurrentConversation();
    }

    function startBonusFeatureDiscussion() {
        var bonusMsg = {
            role: 'assistant',
            content: '[ScratchAgent] \u4e3b\u4efb\u52a1\u5df2\u5b8c\u6210\uff0c\u73b0\u5728\u8fdb\u5165\u201c\u989d\u5916\u529f\u80fd\u8ba8\u8bba\u201d\u9636\u6bb5\u3002\u603b\u7b56\u5212\u548c\u8ba1\u5212\u8005\u6b63\u5728\u5546\u91cf\u53ef\u4ee5\u4e3a\u7528\u6237\u6dfb\u52a0\u7684\u989d\u5916\u529f\u80fd...',
            time: formatTime(new Date()),
        };
        chatHistory.push(bonusMsg);
        appendAIMessage(bonusMsg.content, bonusMsg.time, '', [], true);
        saveCurrentConversation();

        isScratchRunning = true;
        _agentMessageIds = {};
        var chiefAgent = AGENTS.find(function(a) { return a.id === 'chief'; });
        var plannerAgent = AGENTS.find(function(a) { return a.id === 'planner'; });

        var bonusHistoryContext = '';
        AGENTS.forEach(function(a) {
            var outputs = agentOutputs[a.id];
            if (outputs && outputs.length > 0) {
                bonusHistoryContext += '\n=== ' + a.name + ' \u7684\u53d1\u8a00 ===\n';
                outputs.forEach(function(out, idx) {
                    bonusHistoryContext += '[\u7b2c' + (idx + 1) + '\u8f6e] ' + out + '\n';
                });
            }
        });

        function startBonusAgent(agent) {
            if (!isScratchRunning) return;

            var bonusPrompt = '\u3010\u4efb\u52a1\u8981\u6c42\u3011\n' + sharedAgentContext.split('\n\n')[0].replace('\u4efb\u52a1\u8981\u6c42\uff1a', '') + '\n\n\u3010\u5df2\u5b8c\u6210\u7684\u5de5\u4f5c\u3011\n' + bonusHistoryContext + '\n\n\u4e3b\u4efb\u52a1\u5df2\u7ecf\u5b8c\u6210\u3002\u73b0\u5728\u8fdb\u5165\u201c\u989d\u5916\u529f\u80fd\u8ba8\u8bba\u201d\u9636\u6bb5\u3002\u4f60\u662f\u300c' + agent.name + '\u300d\u3002\u8bf7\u4f60\u548c\u53e6\u4e00\u4f4d\u667a\u80fd\u4f53\u5546\u91cf\uff1a\u6839\u636e\u5df2\u5b8c\u6210\u7684\u4e3b\u4efb\u52a1\uff0c\u8fd8\u53ef\u4ee5\u4e3a\u7528\u6237\u6dfb\u52a0\u4ec0\u4e48\u989d\u5916\u7684\u529f\u80fd\u6216\u4f18\u5316\uff1f\u8bf7\u63d0\u51fa\u5177\u4f53\u7684\u5efa\u8bae\uff0c\u5e76\u76f4\u63a5\u4f7f\u7528\u5de5\u5177\u5b9e\u73b0\u8fd9\u4e9b\u989d\u5916\u529f\u80fd\u3002';

            var agentTools = agent.tools || [];
            var availableTools = TOOLS.filter(function(t) {
                return agentTools.indexOf(t.function.name) !== -1;
            });

            var messages = [
                { role: 'system', content: agent.systemPrompt },
                { role: 'user', content: bonusPrompt }
            ];

            updateAgentStatus(agent.id, 'thinking', '\u6b63\u5728\u8c03\u7528API...');

            var provider = PROVIDERS[currentConfig.provider];
            var endpoint = provider.isCustom ? (currentConfig.customEndpoint || provider.endpoint) : provider.endpoint;
            var modelInfo = getModelInfo();

            var body = { model: getEffectiveModelId(), messages: messages, stream: true, tools: availableTools.length > 0 ? availableTools : TOOLS, tool_choice: 'auto' };
            if ((currentConfig.provider === 'deepseek' || currentConfig.provider === 'glm') && modelInfo && modelInfo.supportsReasoning) {
                body.thinking = { type: 'enabled' };
            }
            if (currentConfig.provider === 'deepseek' && modelInfo && modelInfo.supportsReasoning) {
                body.reasoning_effort = 'high';
            }
            if (currentConfig.provider === 'glm' && currentConfig.model === 'glm-5.2' && modelInfo && modelInfo.supportsReasoning) {
                body.reasoning_effort = 'max';
                body.max_tokens = 65536;
            }
            if (currentConfig.provider === 'openai' && modelInfo && modelInfo.supportsReasoning) body.reasoning_effort = 'high';

            var fetchHeaders = { 'Content-Type': 'application/json' };
            fetchHeaders['Authorization'] = 'Bearer ' + currentConfig.apiKey;

            var fullContent = '';
            var fullReasoning = '';
            var hasOutput = false;
            var isFinished = false;

            updateAgentStatus(agent.id, 'speaking', '\u6b63\u5728\u63a5\u6536\u6d41...');

            fetch(endpoint, {
                method: 'POST',
                headers: fetchHeaders,
                body: JSON.stringify(body)
            }).then(function(resp) {
                if (!resp.ok) {
                    return resp.json().catch(function() { return {}; }).then(function(e) {
                        throw new Error(e.error ? e.error.message : 'HTTP ' + resp.status);
                    });
                }
                var reader = resp.body.getReader();
                var decoder = new TextDecoder();
                var buf = '';

                function read() {
                    reader.read().then(function(r) {
                        if (r.done) {
                            finishBonus();
                            return;
                        }
                        buf += decoder.decode(r.value, { stream: true });
                        var lines = buf.split('\n');
                        buf = lines.pop() || '';
                        lines.forEach(function(l) {
                            l = l.trim();
                            if (!l || !l.startsWith('data: ')) return;
                            var d = l.slice(6);
                            if (d === '[DONE]') { finishBonus(); return; }
                            try {
                                var j = JSON.parse(d);
                                var delta = j.choices && j.choices[0] && j.choices[0].delta;
                                if (!delta) return;
                                if (delta.reasoning_content) {
                                    fullReasoning += delta.reasoning_content;
                                    hasOutput = true;
                                }
                                if (delta.content) {
                                    fullContent += delta.content;
                                    hasOutput = true;
                                }
                            } catch(e) {}
                        });
                        if (hasOutput && fullContent) {
                            var preview = fullContent.length > 60 ? fullContent.substring(0, 60) + '...' : fullContent;
                            updateAgentStatus(agent.id, 'speaking', preview);
                        }
                        read();
                    }).catch(function(err) {
                        updateAgentStatus(agent.id, 'idle', '\u8c03\u7528\u5931\u8d25');
                    });
                }
                read();

                function finishBonus() {
                    if (isFinished) return;
                    isFinished = true;

                    if (fullContent) {
                        agentOutputs[agent.id].push(fullContent);

                        var agentMsg = {
                            role: 'assistant',
                            content: '[' + agent.name + ' - \u989d\u5916\u529f\u80fd\u8ba8\u8bba] ' + fullContent,
                            time: formatTime(new Date()),
                        };
                        chatHistory.push(agentMsg);

                        appendAgentMessage(agent.id, agent.name, agent.labelClass, fullContent, agentMsg.time);
                        saveCurrentConversation();

                        updateAgentStatus(agent.id, 'idle', '\u7b49\u5f85\u4e0b\u4e00\u8f6e');
                    } else {
                        updateAgentStatus(agent.id, 'idle', '\u672a\u8fd4\u56de\u5185\u5bb9');
                    }

                    if (isScratchRunning) {
                        var nextDelay = 5000 + Math.random() * 5000;
                        var nextTimer = setTimeout(function() {
                            if (isScratchRunning) startBonusAgent(agent);
                        }, nextDelay);
                        scratchAgentTimers.push(nextTimer);
                    }
                }
            }).catch(function(err) {
                updateAgentStatus(agent.id, 'idle', '\u8c03\u7528\u5931\u8d25');
            });
        }

        if (chiefAgent) {
            startBonusAgent(chiefAgent);
        }
        if (plannerAgent) {
            setTimeout(function() {
                if (isScratchRunning) startBonusAgent(plannerAgent);
            }, 2000);
        }
    }

    function buildAgentPanel() {
        var panelList = document.getElementById('agentPanelList');
        if (!panelList) return;
        panelList.innerHTML = '';
        AGENTS.forEach(function(agent) {
            var card = document.createElement('div');
            card.className = 'agent-card';
            card.id = 'agent-card-' + agent.id;
            card.innerHTML = '<div class="agent-card-header">' +
                '<div class="agent-avatar ' + agent.avatarClass + '">' + agent.icon + '</div>' +
                '<span class="agent-name">' + agent.name + '</span>' +
                '<span class="agent-status idle" id="agent-status-' + agent.id + '">\u7a7a\u95f2</span>' +
                '</div>' +
                '<div class="agent-card-content" id="agent-content-' + agent.id + '">\u7b49\u5f85\u542f\u52a8...</div>';
            panelList.appendChild(card);
        });
    }

    function updateAgentStatus(agentId, status, content) {
        var statusEl = document.getElementById('agent-status-' + agentId);
        var contentEl = document.getElementById('agent-content-' + agentId);
        var cardEl = document.getElementById('agent-card-' + agentId);

        if (statusEl) {
            statusEl.className = 'agent-status ' + status;
            var statusTextMap = { idle: '\u7a7a\u95f2', thinking: '\u601d\u8003\u4e2d', speaking: '\u53d1\u8a00\u4e2d', done: '\u5df2\u5b8c\u6210', muted: '\u5df2\u7981\u8a00' };
            statusEl.textContent = statusTextMap[status] || status;
        }
        if (contentEl && content !== undefined) {
            contentEl.textContent = content;
        }
        if (cardEl) {
            cardEl.classList.remove('active', 'done', 'muted');
            if (status === 'speaking' || status === 'thinking') {
                cardEl.classList.add('active');
            }
            if (status === 'done') {
                cardEl.classList.add('done');
            }
            if (status === 'muted') {
                cardEl.classList.add('muted');
            }
        }
    }

    function updateAgentStatuses(status, content) {
        AGENTS.forEach(function(agent) {
            updateAgentStatus(agent.id, status, content);
        });
    }

    var _agentMessageIds = {};
    var _agentFinishFlags = {};

    function appendAgentMessage(agentId, agentName, labelClass, content, time) {
        var msgId = agentId + '_' + (time || Date.now()) + '_' + content.substring(0, 30);
        if (_agentMessageIds[msgId]) return;
        _agentMessageIds[msgId] = true;

        welcomeMessage.style.display = 'none';
        var wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper ai';
        wrapper.style.animation = 'fadeInUp 0.35s ease-out';
        wrapper.dataset.agentId = agentId;

        var bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        var label = '<span class="agent-message-label ' + labelClass + '">' + agentName + '</span>';
        bubble.innerHTML = label + '<br>' + formatMarkdown(content);

        var timeEl = document.createElement('div');
        timeEl.className = 'message-time';
        timeEl.textContent = time || formatTime(new Date());
        bubble.appendChild(timeEl);
        wrapper.appendChild(bubble);
        chatArea.appendChild(wrapper);
        scrollToBottom();
    }

    function runAgentSimulation(requirement) {
        sharedAgentContext = '\u4efb\u52a1\u8981\u6c42\uff1a' + requirement + '\n\n';
        agentOutputs = {};
        AGENTS.forEach(function(a) { agentOutputs[a.id] = []; });
        _agentMessageIds = {};
        mutedAgents = {};
        agentRoundPrompts = {};
        chiefOnlyMode = true;

        AGENTS.forEach(function(a) {
            if (a.id !== 'chief') {
                mutedAgents[a.id] = true;
            }
        });

        function startAgent(agent) {
            if (!isScratchRunning) return;

            if (mutedAgents[agent.id]) {
                updateAgentStatus(agent.id, 'muted', '\u7b49\u5f85\u603b\u7b56\u5212\u5206\u914d\u4efb\u52a1');
                if (isScratchRunning) {
                    var muteDelay = 6000 + Math.random() * 6000;
                    var muteTimer = setTimeout(function() {
                        if (isScratchRunning) startAgent(agent);
                    }, muteDelay);
                    scratchAgentTimers.push(muteTimer);
                }
                return;
            }

            var historyContext = '';
            AGENTS.forEach(function(a) {
                var outputs = agentOutputs[a.id];
                if (outputs && outputs.length > 0) {
                    historyContext += '\n=== ' + a.name + ' \u7684\u5386\u53f2\u53d1\u8a00 ===\n';
                    outputs.forEach(function(out, idx) {
                        historyContext += '[\u7b2c' + (idx + 1) + '\u8f6e] ' + out + '\n';
                    });
                }
            });

            var mutedInfo = '';
            var mutedIds = Object.keys(mutedAgents);
            if (mutedIds.length > 0) {
                mutedInfo = '\n\u3010\u5f53\u524d\u88ab\u7981\u8a00\u7684\u667a\u80fd\u4f53\u3011\n';
                mutedIds.forEach(function(mid) {
                    var ma = AGENTS.find(function(a) { return a.id === mid; });
                    if (ma) mutedInfo += '- ' + ma.name + ' (' + mid + ')\n';
                });
            }

            var recentOutputs = agentOutputs[agent.id];
            var lastRoundContent = '';
            if (recentOutputs && recentOutputs.length > 0) {
                lastRoundContent = recentOutputs[recentOutputs.length - 1];
            }

            var userPrompt = '\u3010\u4efb\u52a1\u8981\u6c42\u3011\n' + sharedAgentContext.split('\n\n')[0].replace('\u4efb\u52a1\u8981\u6c42\uff1a', '') + '\n';
            if (historyContext) {
                userPrompt += '\n\u3010\u6240\u6709\u667a\u80fd\u4f53\u7684\u5b8c\u6574\u5386\u53f2\u53d1\u8a00\u3011\n' + historyContext + '\n';
            }
            if (mutedInfo) {
                userPrompt += mutedInfo;
            }
            if (lastRoundContent) {
                userPrompt += '\n\u3010\u4f60\u4e0a\u4e00\u8f6e\u7684\u53d1\u8a00\u3011\n' + lastRoundContent.substring(0, 500) + (lastRoundContent.length > 500 ? '...' : '') + '\n';
            }
            if (agentRoundPrompts[agent.id]) {
                userPrompt += '\n\u3010\u603b\u7b56\u5212\u7ed9\u4f60\u7684\u4e13\u95e8\u6307\u4ee4\u3011\n' + agentRoundPrompts[agent.id] + '\n';
            }
            userPrompt += '\n\u8bf7\u4f60\u4f5c\u4e3a\u300c' + agent.name + '\u300d\u53d1\u8a00\u3002\u57fa\u4e8e\u4ee5\u4e0a\u4efb\u52a1\u8981\u6c42\u548c\u6240\u6709\u5386\u53f2\u8ba8\u8bba\uff0c\u7ed9\u51fa\u4f60\u672c\u8f6e\u7684\u5177\u4f53\u5206\u6790\u3001\u5efa\u8bae\u6216\u6267\u884c\u7ed3\u679c\u3002\n\n\u3010\u5f3a\u5236\u8981\u6c42\u3011\n1. \u4f60\u5fc5\u987b\u505a\u51fa\u5b9e\u8d28\u6027\u8fdb\u5c55\uff0c\u4e0d\u80fd\u91cd\u590d\u4e4b\u524d\u7684\u5185\u5bb9\n2. \u5982\u679c\u4e0a\u4e00\u8f6e\u4f60\u5df2\u7ecf\u8bf4\u8fc7\u67d0\u4e9b\u5185\u5bb9\uff0c\u8fd9\u4e00\u8f6e\u8bf7\u7ee7\u7eed\u5f80\u4e0b\u63a8\u8fdb\uff0c\u4e0d\u8981\u56de\u5934\u91cd\u590d\n3. \u4e0d\u8981\u53ea\u662f\u8868\u793a\u201c\u540c\u610f\u201d\u6216\u201c\u6536\u5230\u201d\uff0c\u5fc5\u987b\u7ed9\u51fa\u65b0\u7684\u5206\u6790\u3001\u5efa\u8bae\u6216\u6267\u884c\u7ed3\u679c\n4. \u5982\u679c\u4f60\u89c9\u5f97\u5df2\u7ecf\u6ca1\u6709\u66f4\u591a\u5de5\u4f5c\u8981\u505a\uff0c\u8bf7\u660e\u786e\u8bf4\u201c\u6211\u8ba4\u4e3a\u5f53\u524d\u9636\u6bb5\u7684\u5de5\u4f5c\u5df2\u5b8c\u6210\u201d\uff0c\u4e0d\u8981\u7a7a\u6cdb\u5730\u91cd\u590d\u4e4b\u524d\u7684\u8bdd';

            var agentTools = agent.tools || [];
            var availableTools = TOOLS.filter(function(t) {
                return agentTools.indexOf(t.function.name) !== -1;
            });

            var messages = [
                { role: 'system', content: agent.systemPrompt },
                { role: 'user', content: userPrompt }
            ];

            updateAgentStatus(agent.id, 'thinking', '\u6b63\u5728\u8c03\u7528API...');

            var provider = PROVIDERS[currentConfig.provider];
            var endpoint = provider.isCustom ? (currentConfig.customEndpoint || provider.endpoint) : provider.endpoint;
            var modelInfo = getModelInfo();

            var body = { model: getEffectiveModelId(), messages: messages, stream: true, tools: availableTools.length > 0 ? availableTools : TOOLS, tool_choice: 'auto' };
            if ((currentConfig.provider === 'deepseek' || currentConfig.provider === 'glm') && modelInfo && modelInfo.supportsReasoning) {
                body.thinking = { type: 'enabled' };
            }
            if (currentConfig.provider === 'deepseek' && modelInfo && modelInfo.supportsReasoning) {
                body.reasoning_effort = 'high';
            }
            if (currentConfig.provider === 'glm' && currentConfig.model === 'glm-5.2' && modelInfo && modelInfo.supportsReasoning) {
                body.reasoning_effort = 'max';
                body.max_tokens = 65536;
            }
            if (currentConfig.provider === 'openai' && modelInfo && modelInfo.supportsReasoning) body.reasoning_effort = 'high';

            var fetchHeaders = { 'Content-Type': 'application/json' };
            fetchHeaders['Authorization'] = 'Bearer ' + currentConfig.apiKey;

            var fullContent = '';
            var fullReasoning = '';
            var hasOutput = false;
            var toolCallsAccum = {};
            var hasToolCall = false;

            updateAgentStatus(agent.id, 'speaking', '\u6b63\u5728\u63a5\u6536\u6d41...');

            fetch(endpoint, {
                method: 'POST',
                headers: fetchHeaders,
                body: JSON.stringify(body)
            }).then(function(resp) {
                if (!resp.ok) {
                    return resp.json().catch(function() { return {}; }).then(function(e) {
                        throw new Error(e.error ? e.error.message : 'HTTP ' + resp.status);
                    });
                }
                var reader = resp.body.getReader();
                var decoder = new TextDecoder();
                var buf = '';

                var isFinished = false;

                function read() {
                    reader.read().then(function(r) {
                        if (r.done) {
                            finish();
                            return;
                        }
                        buf += decoder.decode(r.value, { stream: true });
                        var lines = buf.split('\n');
                        buf = lines.pop() || '';
                        lines.forEach(function(l) {
                            l = l.trim();
                            if (!l || !l.startsWith('data: ')) return;
                            var d = l.slice(6);
                            if (d === '[DONE]') { finish(); return; }
                            try {
                                var j = JSON.parse(d);
                                var delta = j.choices && j.choices[0] && j.choices[0].delta;
                                if (!delta) return;
                                if (delta.reasoning_content) {
                                    fullReasoning += delta.reasoning_content;
                                    hasOutput = true;
                                }
                                if (delta.content) {
                                    fullContent += delta.content;
                                    hasOutput = true;
                                }
                                if (delta.tool_calls) {
                                    delta.tool_calls.forEach(function(tc) {
                                        if (!toolCallsAccum[tc.index]) {
                                            toolCallsAccum[tc.index] = { id: tc.id || '', type: tc.type || 'function', function: { name: '', arguments: '' } };
                                        }
                                        if (tc.id) toolCallsAccum[tc.index].id = tc.id;
                                        if (tc.function) {
                                            if (tc.function.name) toolCallsAccum[tc.index].function.name = tc.function.name;
                                            if (tc.function.arguments) toolCallsAccum[tc.index].function.arguments += tc.function.arguments;
                                        }
                                    });
                                    hasToolCall = true;
                                    hasOutput = true;
                                }
                            } catch(e) {}
                        });
                        if (hasOutput && fullContent) {
                            var preview = fullContent.length > 60 ? fullContent.substring(0, 60) + '...' : fullContent;
                            updateAgentStatus(agent.id, 'speaking', preview);
                        }
                        read();
                    }).catch(function(err) {
                        handleError(err.message);
                    });
                }
                read();

                function finish() {
                    if (isFinished) return;
                    isFinished = true;

                    if (hasToolCall && Object.keys(toolCallsAccum).length > 0) {
                        var toolCalls = [];
                        Object.keys(toolCallsAccum).sort().forEach(function(k) {
                            toolCalls.push(toolCallsAccum[k]);
                        });

                        agentOutputs[agent.id].push(fullContent || '[\u8c03\u7528\u5de5\u5177]');

                        var agentMsg = {
                            role: 'assistant',
                            content: '[' + agent.name + '] ' + (fullContent || '\u6b63\u5728\u6267\u884c\u5de5\u5177...'),
                            time: formatTime(new Date()),
                            tool_calls: toolCalls
                        };
                        chatHistory.push(agentMsg);
                        appendAgentMessage(agent.id, agent.name, agent.labelClass, agentMsg.content, agentMsg.time);
                        saveCurrentConversation();

                        var promises = toolCalls.map(function(tc) {
                            var fname = tc.function.name;
                            var args = {};
                            try { args = JSON.parse(tc.function.arguments || '{}'); } catch(e) {}
                            return executeToolCall(fname, args).then(function(r) {
                                return { tool_call_id: tc.id, name: fname, result: r };
                            });
                        });

                        Promise.all(promises).then(function(toolResults) {
                            toolResults.forEach(function(tr) {
                                var resultStr = JSON.stringify(tr.result);
                                // For get_stage_screenshot, include image as content for multimodal models
                                if (tr.name === 'get_stage_screenshot' && tr.result && tr.result.success && tr.result.data && tr.result.data.image) {
                                    var p = PROVIDERS[currentConfig.provider];
                                    var mi = p && p.models.find(function(m) { return m.id === currentConfig.model; });
                                    var visionOk = p && p.supportsVision !== false && !(mi && mi.supportsVision === false);
                                    if (visionOk) {
                                        chatHistory.push({
                                            role: 'tool',
                                            tool_call_id: tr.tool_call_id,
                                            content: [
                                                { type: 'text', text: 'Stage screenshot captured successfully.' },
                                                { type: 'image_url', image_url: { url: 'data:' + (tr.result.data.mimeType || 'image/png') + ';base64,' + tr.result.data.image } }
                                            ]
                                        });
                                    } else {
                                        chatHistory.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: resultStr });
                                    }
                                } else {
                                    chatHistory.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: resultStr });
                                }
                                appendToolResult(tr.name, tr.result);
                            });
                            saveCurrentConversation();

                            updateAgentStatus(agent.id, 'idle', '\u5de5\u5177\u6267\u884c\u5b8c\u6210\uff0c\u7b49\u5f85\u4e0b\u4e00\u8f6e');

                            if (isScratchRunning) {
                                var nextDelay = 2000 + Math.random() * 3000;
                                var nextTimer = setTimeout(function() {
                                    if (isScratchRunning) startAgent(agent);
                                }, nextDelay);
                                scratchAgentTimers.push(nextTimer);
                            }
                        });
                        return;
                    }

                    if (fullContent) {
                        agentOutputs[agent.id].push(fullContent);

                        var agentMsg = {
                            role: 'assistant',
                            content: '[' + agent.name + '] ' + fullContent,
                            time: formatTime(new Date()),
                        };
                        chatHistory.push(agentMsg);

                        appendAgentMessage(agent.id, agent.name, agent.labelClass, fullContent, agentMsg.time);
                        saveCurrentConversation();

                        updateAgentStatus(agent.id, 'idle', '\u7b49\u5f85\u4e0b\u4e00\u8f6e');
                    } else {
                        updateAgentStatus(agent.id, 'idle', '\u672a\u8fd4\u56de\u5185\u5bb9');
                    }

                    if (isScratchRunning) {
                        var nextDelay = 3000 + Math.random() * 5000;
                        var nextTimer = setTimeout(function() {
                            if (isScratchRunning) startAgent(agent);
                        }, nextDelay);
                        scratchAgentTimers.push(nextTimer);
                    }
                }

                function handleError(msg) {
                    if (isFinished) return;
                    updateAgentStatus(agent.id, 'idle', '\u8c03\u7528\u5931\u8d25\uff0c\u7b49\u5f85\u91cd\u8bd5...');
                    var errorContent = '[' + agent.name + '] \u8c03\u7528API\u5931\u8d25\uff1a' + msg;
                    var agentMsg = {
                        role: 'assistant',
                        content: errorContent,
                        time: formatTime(new Date()),
                    };
                    chatHistory.push(agentMsg);
                    appendAgentMessage(agent.id, agent.name, agent.labelClass, errorContent, agentMsg.time);
                    saveCurrentConversation();

                    if (isScratchRunning) {
                        var retryDelay = 8000 + Math.random() * 7000;
                        var retryTimer = setTimeout(function() {
                            if (isScratchRunning) startAgent(agent);
                        }, retryDelay);
                        scratchAgentTimers.push(retryTimer);
                    }
                }
            }).catch(function(err) {
                if (isFinished) return;
                updateAgentStatus(agent.id, 'idle', '\u8c03\u7528\u5931\u8d25\uff0c\u7b49\u5f85\u91cd\u8bd5...');
                var errorContent = '[' + agent.name + '] \u8c03\u7528API\u5931\u8d25\uff1a' + err.message;
                var agentMsg = {
                    role: 'assistant',
                    content: errorContent,
                    time: formatTime(new Date()),
                };
                chatHistory.push(agentMsg);
                appendAgentMessage(agent.id, agent.name, agent.labelClass, errorContent, agentMsg.time);
                saveCurrentConversation();

                if (isScratchRunning) {
                    var retryDelay2 = 8000 + Math.random() * 7000;
                    var retryTimer2 = setTimeout(function() {
                        if (isScratchRunning) startAgent(agent);
                    }, retryDelay2);
                    scratchAgentTimers.push(retryTimer2);
                }
            });
        }

        var chiefAgent = AGENTS.find(function(a) { return a.id === 'chief'; });
        var otherAgents = AGENTS.filter(function(a) { return a.id !== 'chief'; });

        function startOtherAgents() {
            otherAgents.forEach(function(agent, idx) {
                var initialDelay = 500 + idx * 800 + Math.random() * 1000;
                var initialTimer = setTimeout(function() {
                    if (isScratchRunning) startAgent(agent);
                }, initialDelay);
                scratchAgentTimers.push(initialTimer);
            });
        }

        if (chiefAgent) {
            startAgent(chiefAgent);
        }

        if (scratchEndCondition === 'ai') {
            var chiefAgent = AGENTS.find(function(a) { return a.id === 'chief'; });
            if (chiefAgent) {
                var chiefEndCheck = function() {
                    if (!isScratchRunning) return;
                    var totalMessages = 0;
                    AGENTS.forEach(function(a) {
                        totalMessages += agentOutputs[a.id].length;
                    });
                    if (totalMessages < 10) {
                        var waitTimer = setTimeout(chiefEndCheck, 8000);
                        scratchAgentTimers.push(waitTimer);
                        return;
                    }

                    var historyForCheck = '';
                    AGENTS.forEach(function(a) {
                        var outputs = agentOutputs[a.id];
                        if (outputs && outputs.length > 0) {
                            historyForCheck += '\n=== ' + a.name + ' \u7684\u53d1\u8a00 ===\n';
                            outputs.forEach(function(out, idx) {
                                historyForCheck += '[\u7b2c' + (idx + 1) + '\u8f6e] ' + out + '\n';
                            });
                        }
                    });

                    var endMessages = [
                        { role: 'system', content: chiefAgent.systemPrompt },
                        { role: 'user', content: '\u3010\u4efb\u52a1\u8981\u6c42\u3011\n' + sharedAgentContext.split('\n\n')[0].replace('\u4efb\u52a1\u8981\u6c42\uff1a', '') + '\n\n\u3010\u6240\u6709\u667a\u80fd\u4f53\u7684\u5b8c\u6574\u8ba8\u8bba\u5185\u5bb9\u3011\n' + historyForCheck + '\n\n\u4f60\u662f\u603b\u7b56\u5212\u3002\u8bf7\u4f60\u4ed4\u7ec6\u5ba1\u67e5\u4ee5\u4e0a\u6240\u6709\u667a\u80fd\u4f53\u7684\u8ba8\u8bba\u5185\u5bb9\uff0c\u5224\u65ad\u5f53\u524d\u4efb\u52a1\u662f\u5426\u5df2\u7ecf\u5b8c\u6210\u3002\u5224\u65ad\u6807\u51c6\uff1a\n1. \u8d44\u6599\u641c\u7d22\u662f\u5426\u5df2\u63d0\u4f9b\u5145\u5206\u7684\u6280\u672f\u8d44\u6599\uff1f\n2. \u4ee3\u7801\u5f00\u53d1\u662f\u5426\u5df2\u7f16\u5199\u5b8c\u6574\u7684\u79ef\u6728\u811a\u672c\uff1f\n3. \u4ee3\u7801\u5ba1\u6279\u662f\u5426\u5df2\u786e\u8ba4\u4ee3\u7801\u65e0\u8bef\uff1f\n4. \u8ba1\u5212\u8005\u662f\u5426\u5df2\u786e\u8ba4\u6240\u6709\u6b65\u9aa4\u5b8c\u6210\uff1f\n5. \u662f\u5426\u8fd8\u6709\u660e\u663e\u672a\u5b8c\u6210\u7684\u5b50\u4efb\u52a1\uff1f\n\n\u5982\u679c\u6240\u6709\u5b50\u4efb\u52a1\u90fd\u5df2\u5b8c\u6210\u4e14\u6ca1\u6709\u9057\u7559\u95ee\u9898\uff0c\u8bf7\u56de\u590d\uff1aTASK_COMPLETED\n\u5982\u679c\u8fd8\u6709\u4efb\u4f55\u5b50\u4efb\u52a1\u672a\u5b8c\u6210\u6216\u5b58\u5728\u95ee\u9898\uff0c\u8bf7\u56de\u590d\uff1aTASK_CONTINUE\n\u4e0d\u8981\u8bf4\u5176\u4ed6\u5185\u5bb9\uff0c\u53ea\u56de\u590d\u8fd9\u4e24\u4e2a\u5173\u952e\u8bcd\u4e4b\u4e00\u3002' }
                    ];
                    var provider = PROVIDERS[currentConfig.provider];
                    var endpoint = provider.isCustom ? (currentConfig.customEndpoint || provider.endpoint) : provider.endpoint;
                    var body = { model: getEffectiveModelId(), messages: endMessages, stream: false };
                    var fetchHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentConfig.apiKey };
                    fetch(endpoint, { method: 'POST', headers: fetchHeaders, body: JSON.stringify(body) })
                        .then(function(resp) { return resp.json(); })
                        .then(function(data) {
                            if (!isScratchRunning) return;
                            var content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
                            if (content.indexOf('TASK_COMPLETED') !== -1) {
                                stopScratchAgent('\u603b\u7b56\u5212\u5224\u65ad\u4efb\u52a1\u5df2\u5b8c\u6210');
                            } else {
                                var nextCheckTimer = setTimeout(chiefEndCheck, 15000);
                                scratchAgentTimers.push(nextCheckTimer);
                            }
                        })
                        .catch(function() {
                            if (isScratchRunning) {
                                var retryTimer = setTimeout(chiefEndCheck, 15000);
                                scratchAgentTimers.push(retryTimer);
                            }
                        });
                };
                var initialCheckTimer = setTimeout(chiefEndCheck, 30000);
                scratchAgentTimers.push(initialCheckTimer);
            }
        }
    }

    function exitSplitLayout() {
        var appContainer = document.getElementById('appContainer');
        if (appContainer) appContainer.classList.remove('split-layout');
        if (isScratchRunning) {
            stopScratchAgent('\u7528\u6237\u624b\u52a8\u505c\u6b62');
        }
        isScratchRunning = false;
        _agentMessageIds = {};
        updateSendBtn();
        if (messageInput) messageInput.focus();
    }

    function autoResize() {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
    }

    function updateSendBtn() {
        if (!sendBtn) return;
        if (isLoading) {
            sendBtn.disabled = false;
            sendBtn.classList.add('stop');
            sendBtn.setAttribute('aria-label', 'Stop');
        } else {
            var hasContent = messageInput && (messageInput.value.trim().length > 0 || pendingImages.length > 0);
            sendBtn.disabled = !hasContent;
            sendBtn.classList.remove('stop');
            sendBtn.setAttribute('aria-label', 'Send');
        }
    }

    function formatTime(d) {
        return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    }

    function escapeHtml(t) {
        var div = document.createElement('div');
        div.textContent = t;
        return div.innerHTML;
    }

    function formatMarkdown(t) {
        var html = escapeHtml(t);
        html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function(match, lang, code) {
            var langLower = (lang || '').toLowerCase();
            var trimmedCode = code.trimEnd();
            var isJSON = (langLower === 'json');
            var applyBtn = isJSON ? '<button class="code-apply-btn" onclick="applyCodeBlock(this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>Apply</button>' : '';
            return '<div class="code-block"><div class="code-header"><span class="code-lang">' + (lang || 'text') + '</span><div class="code-header-actions">' + applyBtn + '<button class="code-copy-btn" onclick="copyCode(this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>Copy</button></div></div><pre><code>' + escapeHtml(trimmedCode) + '</code></pre></div>';
        });
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        var lines = html.split(/<br>|\n/);
        var result = [];
        var inList = false;
        var listType = '';
        var tableBuffer = [];
        function flushTable() {
            if (tableBuffer.length < 2) {
                for (var ti = 0; ti < tableBuffer.length; ti++) result.push(tableBuffer[ti]);
                tableBuffer = [];
                return;
            }
            var headerCells = tableBuffer[0].split('|').filter(function(c) { return c.trim() !== ''; });
            var hasHeader = /^\s*\|?[\s\-:]+\|[\s\-:|]+\|?$/.test(tableBuffer[1]);
            var startIdx = hasHeader ? 2 : 1;
            var html2 = '<div class="md-table-wrap"><table class="md-table">';
            if (hasHeader) {
                html2 += '<thead><tr>';
                for (var hi = 0; hi < headerCells.length; hi++) html2 += '<th>' + headerCells[hi].trim() + '</th>';
                html2 += '</tr></thead>';
            }
            html2 += '<tbody>';
            for (var ri = startIdx; ri < tableBuffer.length; ri++) {
                var cells = tableBuffer[ri].split('|').filter(function(c) { return c.trim() !== ''; });
                html2 += '<tr>';
                for (var ci = 0; ci < cells.length; ci++) {
                    var tag = (ri === 0 && !hasHeader) ? 'th' : 'td';
                    html2 += '<' + tag + '>' + cells[ci].trim() + '</' + tag + '>';
                }
                html2 += '</tr>';
            }
            html2 += '</tbody></table></div>';
            result.push(html2);
            tableBuffer = [];
        }
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            var isTableLine = line.indexOf('|') >= 0 && /^\s*\|/.test(line);
            var isSeparator = /^\s*\|?[\s\-:]+\|[\s\-:|]+\|?$/.test(line);
            if (isTableLine || isSeparator) {
                if (inList) { result.push('</' + listType + '>'); inList = false; }
                tableBuffer.push(line);
                continue;
            } else if (tableBuffer.length > 0) {
                flushTable();
            }
            var headingMatch = line.match(/^#{1,4}\s+(.+)/);
            var ulMatch = line.match(/^[\-\*]\s+(.+)/);
            var olMatch = line.match(/^(\d+)\.\s+(.+)/);
            if (headingMatch) {
                if (inList) { result.push('</' + listType + '>'); inList = false; }
                var level = headingMatch[0].match(/^#+/)[0].length;
                result.push('<h' + level + ' class="md-heading">' + headingMatch[1] + '</h' + level + '>');
            } else if (ulMatch) {
                if (!inList || listType !== 'ul') {
                    if (inList) result.push('</' + listType + '>');
                    result.push('<ul class="md-list">');
                    inList = true;
                    listType = 'ul';
                }
                result.push('<li>' + ulMatch[1] + '</li>');
            } else if (olMatch) {
                if (!inList || listType !== 'ol') {
                    if (inList) result.push('</' + listType + '>');
                    result.push('<ol class="md-list">');
                    inList = true;
                    listType = 'ol';
                }
                result.push('<li>' + olMatch[2] + '</li>');
            } else {
                if (inList) { result.push('</' + listType + '>'); inList = false; }
                result.push(line || '&nbsp;');
            }
        }
        flushTable();
        if (inList) { result.push('</' + listType + '>'); }
        return result.join('<br>');
    }

    window.copyCode = function(btn) {
        var code = btn.closest('.code-block').querySelector('code').textContent;
        navigator.clipboard.writeText(code).then(function() {
            btn.classList.add('copied');
            btn.innerHTML = 'Copied';
            setTimeout(function() { btn.classList.remove('copied'); btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>Copy'; }, 2000);
        });
    };

    window.applyCodeBlock = function(btn) {
        var code = btn.closest('.code-block').querySelector('code').textContent;
        try {
            var json = JSON.parse(code);
            if (!window.AIAssistantPreload) {
                showToast('Preload not available', 'error');
                return;
            }
            btn.disabled = true;
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle></svg>Applying...';
            window.AIAssistantPreload.applyProject(json).then(function(result) {
                btn.disabled = false;
                if (result && result.success) {
                    btn.classList.add('applied');
                    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>Applied!';
                    setTimeout(function() { btn.classList.remove('applied'); btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>Apply'; }, 2000);
                    showToast('Project updated successfully', 'success');
                } else {
                    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>Apply';
                    showToast('Failed to apply project', 'error');
                }
            }).catch(function() {
                btn.disabled = false;
                btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>Apply';
                showToast('Failed to apply project', 'error');
            });
        } catch(e) {
            showToast('Invalid JSON in code block', 'error');
        }
    };

    function scrollToBottom() {
        requestAnimationFrame(function() { chatArea.scrollTop = chatArea.scrollHeight; });
    }

    function renderChatHistory() {
        chatArea.querySelectorAll('.message-wrapper, .reasoning-box, .skill-box, .todo-card').forEach(function(m) { m.remove(); });
        activeTodoCard = null;
        if (!chatHistory.length) { welcomeMessage.style.display = 'flex'; return; }
        welcomeMessage.style.display = 'none';
        chatHistory.forEach(function(msg) {
            if (msg.role === 'user') appendUserMessage(msg.content, msg.time, msg.images || [], false);
            else appendAIMessage(msg.content, msg.time, msg.reasoning || '', msg.toolCalls || [], false);
        });
        scrollToBottom();
    }

    function appendUserMessage(content, time, images, animate) {
        welcomeMessage.style.display = 'none';
        var wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper user';
        if (animate) wrapper.style.animation = 'fadeInUp 0.35s ease-out';
        var bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.innerHTML = escapeHtml(content).replace(/\n/g, '<br>');

        if (images && images.length > 0) {
            var imgContainer = document.createElement('div');
            imgContainer.className = 'user-images';
            images.forEach(function(src) {
                var img = document.createElement('img');
                img.className = 'user-image-thumb';
                img.src = src;
                img.onclick = function() { window.open(src, '_blank'); };
                imgContainer.appendChild(img);
            });
            bubble.appendChild(imgContainer);
        }

        var timeEl = document.createElement('div');
        timeEl.className = 'message-time';
        timeEl.textContent = time || formatTime(new Date());
        bubble.appendChild(timeEl);
        wrapper.appendChild(bubble);
        chatArea.appendChild(wrapper);
        scrollToBottom();
    }

    function createTodoCard(title, items) {
        var card = document.createElement('div');
        card.className = 'todo-card';
        var safeTitle = title ? escapeHtml(title) : ((currentLocale || 'en').split('-')[0] === 'zh' ? '待办事项' : 'Tasks');
        var header = '<div class="todo-card-header">' +
            '<div class="todo-card-title-wrap">' +
            '<svg class="todo-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="4" ry="4"></rect><path d="M16 2v4M8 2v4M3 10h18"></path><path d="m9 16 2 2 4-4"></path></svg>' +
            '<span class="todo-card-title">' + safeTitle + '</span>' +
            '</div>' +
            '<span class="todo-card-progress">0/' + items.length + '</span>' +
            '</div>';
        var listHtml = items.map(function(text, i) {
            return '<div class="todo-item" data-idx="' + (i + 1) + '" data-status="pending">' +
                '<span class="todo-circle">' +
                '<svg class="todo-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' +
                '<svg class="todo-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>' +
                '</span>' +
                '<span class="todo-text">' + escapeHtml(text) + '</span>' +
                '<span class="todo-note"></span>' +
                '</div>';
        }).join('');
        card.innerHTML = '<div class="todo-card-inner">' + header + '<div class="todo-card-bar"><span class="todo-card-bar-fill"></span></div><div class="todo-list">' + listHtml + '</div></div>';
        card._todoItems = items.slice();
        card._todoStates = items.map(function() { return 'pending'; });
        updateTodoCardProgress(card);
        return card;
    }

    function updateTodoCard(card, index, status, note) {
        if (!card || !card._todoStates) return;
        if (index < 1 || index > card._todoStates.length) return;
        card._todoStates[index - 1] = status;
        var node = card.querySelector('.todo-item[data-idx="' + index + '"]');
        if (node) {
            node.dataset.status = status;
            node.classList.remove('is-pending', 'is-doing', 'is-done');
            node.classList.add('is-' + status);
            var noteEl = node.querySelector('.todo-note');
            if (noteEl) noteEl.textContent = note || '';
        }
        updateTodoCardProgress(card);
        if (typeof scrollToBottom === 'function') scrollToBottom();
    }

    function updateTodoCardProgress(card) {
        if (!card || !card._todoStates) return;
        var done = card._todoStates.filter(function(s) { return s === 'done'; }).length;
        var total = card._todoStates.length;
        var prog = card.querySelector('.todo-card-progress');
        if (prog) prog.textContent = done + '/' + total;
        var fill = card.querySelector('.todo-card-bar-fill');
        if (fill) fill.style.width = (total > 0 ? Math.round(done / total * 100) : 0) + '%';
        var allDone = total > 0 && done === total;
        card.classList.toggle('all-done', allDone);
    }

    function appendAIMessage(content, time, reasoning, toolCalls, animate) {
        welcomeMessage.style.display = 'none';

        if (toolCalls && toolCalls.length > 0) {
            toolCalls.forEach(function(tc) {
                if (tc.name === 'plan todos') {
                    var items = Array.isArray(tc.args.items) ? tc.args.items.map(function(s) { return String(s); }) : [];
                    activeTodoCard = createTodoCard(tc.args.title ? String(tc.args.title) : '', items);
                    chatArea.appendChild(activeTodoCard);
                    return;
                }
                if (tc.name === 'update todo') {
                    var uIdx = parseInt(tc.args.index, 10);
                    if (!isNaN(uIdx) && uIdx >= 1) {
                        updateTodoCard(activeTodoCard, uIdx, tc.args.status || 'pending', tc.args.note ? String(tc.args.note) : '');
                    }
                    return;
                }
                var skillBox = document.createElement('div');
                skillBox.className = 'skill-box';
                skillBox.innerHTML = '<div class="skill-box-header"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg><span>Skill Call</span><span class="skill-name">' + escapeHtml(tc.name) + '</span></div><div class="skill-args">' + escapeHtml(JSON.stringify(tc.args, null, 2)) + '</div>';
                chatArea.appendChild(skillBox);
            });
        }

        if (reasoning) {
            var rb = document.createElement('div');
            rb.className = 'reasoning-box';
            rb.innerHTML = '<div class="reasoning-box-header" onclick="this.parentElement.classList.toggle(\'collapsed\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg><span>Reasoning</span></div><div class="reasoning-content">' + escapeHtml(reasoning) + '</div>';
            chatArea.appendChild(rb);
        }

        if (!content || !content.trim()) {
            if (toolCalls && toolCalls.length > 0) { scrollToBottom(); return; }
        }

        var wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper ai';
        if (animate) wrapper.style.animation = 'fadeInUp 0.35s ease-out';

        var match = content.match(/^\[([^\]]+)\]\s*(.*)/s);
        if (match) {
            var agentName = match[1];
            var agentContent = match[2];
            var agent = AGENTS.find(function(a) { return a.name === agentName; });
            if (agent) {
                var bubble = document.createElement('div');
                bubble.className = 'message-bubble';
                var label = '<span class="agent-message-label ' + agent.labelClass + '">' + agent.name + '</span>';
                bubble.innerHTML = label + '<br>' + formatMarkdown(agentContent);
                var timeEl = document.createElement('div');
                timeEl.className = 'message-time';
                timeEl.textContent = time || formatTime(new Date());
                bubble.appendChild(timeEl);
                wrapper.appendChild(bubble);
                chatArea.appendChild(wrapper);
                scrollToBottom();
                return;
            }
        }

        var bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.innerHTML = formatMarkdown(content);
        var timeEl = document.createElement('div');
        timeEl.className = 'message-time';
        timeEl.textContent = time || formatTime(new Date());
        bubble.appendChild(timeEl);
        wrapper.appendChild(bubble);
        chatArea.appendChild(wrapper);
        scrollToBottom();
    }

    function updateAIMessageContent(id, content, reasoning) {
        var w = document.getElementById(id);
        if (!w) return;
        var b = w.querySelector('.message-bubble');
        if (b) b.innerHTML = formatMarkdown(content) + '<div class="message-time">' + formatTime(new Date()) + '</div>';
        if (reasoning !== undefined) {
            var rb = w.previousElementSibling;
            if (!rb || !rb.classList.contains('reasoning-box')) {
                rb = document.createElement('div');
                rb.className = 'reasoning-box';
                rb.innerHTML = '<div class="reasoning-box-header" onclick="this.parentElement.classList.toggle(\'collapsed\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg><span>Reasoning</span></div><div class="reasoning-content streaming"></div>';
                w.parentNode.insertBefore(rb, w);
            }
            var rc = rb.querySelector('.reasoning-content');
            if (rc) { rc.textContent = reasoning; rc.classList.add('streaming'); }
        }
        scrollToBottom();
    }

    function showTypingIndicator() {
        var w = document.createElement('div');
        w.className = 'message-wrapper ai';
        w.id = 'typingIndicator';
        var b = document.createElement('div');
        b.className = 'message-bubble';
        b.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        w.appendChild(b);
        chatArea.appendChild(w);
        scrollToBottom();
    }

    function handleImageSelect(e) {
        var files = Array.from(e.target.files);
        if (!files.length) return;
        var model = getModelInfo();
        if (!model || !model.supportsReasoning) {
            showToast('Current model does not support images', 'error');
            return;
        }
        files.forEach(function(file) {
            if (!file.type.startsWith('image/')) return;
            var reader = new FileReader();
            reader.onload = function(ev) {
                pendingImages.push(ev.target.result);
                renderImagePreview();
                imageUploadBtn.classList.toggle('has-image', pendingImages.length > 0);
                updateSendBtn();
            };
            reader.readAsDataURL(file);
        });
        imageInput.value = '';
    }

    function renderImagePreview() {
        imagePreviewBar.innerHTML = '';
        if (pendingImages.length === 0) {
            imagePreviewBar.style.display = 'none';
            imageUploadBtn.classList.remove('has-image');
            return;
        }
        imagePreviewBar.style.display = 'flex';
        pendingImages.forEach(function(src, idx) {
            var item = document.createElement('div');
            item.className = 'image-preview-item';
            item.innerHTML = '<img src="' + src + '" alt="preview"><button class="image-preview-remove" data-idx="' + idx + '">\u00d7</button>';
            imagePreviewBar.appendChild(item);
        });
        imagePreviewBar.querySelectorAll('.image-preview-remove').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                var idx = parseInt(e.target.dataset.idx);
                pendingImages.splice(idx, 1);
                renderImagePreview();
                updateSendBtn();
            });
        });
    }

    function buildSystemPrompt() {
        var lang = getSystemPromptLanguage();
        var desc = 'You are NeoWarp AI, a Scratch 3.0 programming assistant.\n\n=== COMMUNICATION PROTOCOL ===\nYou communicate with the editor through the execute_operations tool. Output a JSON array of operation objects. Each operation must have a "type" field. DO NOT output natural language explanations unless through the "explain" operation type.\n\n=== CONTEXT ===\nThe user message contains a JSON context with the current project state. Blocks use temporary IDs (tid) that you reference in your operations. ONLY use tids from the context — never guess block IDs.\n\n=== OPERATION TYPES ===\n\n1. add_script — Add a new complete script to a sprite\n{\n  "type": "add_script",\n  "sprite": "Cat",\n  "script": {\n    "opcode": "event_whenflagclicked",\n    "fields": {},\n    "inputs": {},\n    "next": {\n      "opcode": "looks_say",\n      "inputs": {"MESSAGE": "Hello"}\n    }\n  }\n}\n- The root block of script must be a hat block (event_whenflagclicked, event_whenkeypressed, etc.)\n- Use "next" to chain blocks. C-blocks use "substack" for inner body.\n- Inputs accept: numbers, strings, or nested reporter block objects\n- Fields accept only strings for dropdown menus\n\n2. delete_block — Delete a block by tid\n{\n  "type": "delete_block",\n  "sprite": "Cat",\n  "targetId": "b2",\n  "mode": "with_children"\n}\n- mode: "with_children" (default) — delete this block, its substack, and next chain\n- mode: "block_only" — delete only this block, connect children to parent\n\n3. modify_input — Change a block\'s input value\n{\n  "type": "modify_input",\n  "sprite": "Cat",\n  "targetId": "b2",\n  "inputName": "TIMES",\n  "value": 20\n}\n- value can be: number, string, boolean, or nested reporter block object\n\n4. add_comment — Add or update a comment. Can be attached to a block or standalone.\nAttached to a block:\n{\n  "type": "add_comment",\n  "sprite": "Cat",\n  "targetId": "b3",\n  "text": "This is the core movement logic",\n  "minimized": false\n}\nStandalone workspace comment (no targetId):\n{\n  "type": "add_comment",\n  "sprite": "Cat",\n  "x": 200,\n  "y": 100,\n  "text": "TODO: add collision detection",\n  "minimized": false\n}\n- minimized: false = expanded, true = collapsed\n- Comments are encouraged to document code logic. Use Chinese text directly.\n\n5. delete_comment — Remove a comment from a block\n{\n  "type": "delete_comment",\n  "sprite": "Cat",\n  "targetId": "b3"\n}\n\n6. explain — Show text explanation to the user (does not modify blocks)\n{\n  "type": "explain",\n  "text": "Modified the repeat count to 20."\n}\n\n=== NESTING RULES ===\n1. Reporter nesting: any inputs value can be a complete reporter block object (e.g. {"opcode":"operator_add","inputs":{"NUM1":5,"NUM2":3}})\n2. Boolean nesting: any condition inputs can be boolean reporter block objects\n3. Substack: C-blocks (repeat/forever/if) have a "substack" array of block objects for their body\n4. If-else: use both "substack" (then) and "substack2" (else)\n5. Hat blocks MUST be at the top of a script, never nested inside other blocks\n\n=== NAMING RULES ===\n- Sprite names: exactly match context names, case-sensitive\n- Variables/lists/broadcasts: first use auto-creates them, use Chinese names directly\n- Costume/sound/backdrop names: case-sensitive exact match\n- tids: ONLY use tids provided in the context\n\n=== BLOCK OPCODE DICTIONARY (Whitelist) ===\n\nMotion:\nmotion_movesteps {STEPS:number} | motion_turnright {DEGREES} | motion_turnleft {DEGREES}\nmotion_goto fields:{TO:"_random_"|"_mouse_"|"sprite_name"}\nmotion_gotoxy {X,Y} | motion_glideto {SECS} fields:{TO}\nmotion_glidesecstoxy {SECS,X,Y} | motion_pointindirection {DIRECTION}\nmotion_pointtowards fields:{TOWARDS:"_mouse_"|"sprite_name"}\nmotion_changexby {DX} | motion_setx {X} | motion_changeyby {DY} | motion_sety {Y}\nmotion_ifonedgebounce (no params) | motion_setrotationstyle fields:{STYLE:"left-right"|"all around"|"don\'t rotate"}\nmotion_xposition reporter | motion_yposition reporter | motion_direction reporter\n\nLooks:\nlooks_sayforsecs {MESSAGE:string,SECS:number} | looks_say {MESSAGE} | looks_thinkforsecs {MESSAGE,SECS} | looks_think {MESSAGE}\nlooks_switchcostumeto fields:{COSTUME:"name"} | looks_nextcostume (no params)\nlooks_switchbackdropto fields:{BACKDROP:"name"} | looks_nextbackdrop (no params)\nlooks_changesizeby {CHANGE} | looks_setsizeto {SIZE}\nlooks_changeeffectby fields:{EFFECT:"COLOR"|"FISHEYE"|"WHIRL"|"PIXELATE"|"MOSAIC"|"BRIGHTNESS"|"GHOST"} {CHANGE}\nlooks_seteffectto fields:{EFFECT} {VALUE} | looks_cleargraphiceffects (no params)\nlooks_show (no params) | looks_hide (no params)\nlooks_gotofrontback fields:{FRONT_BACK:"front"|"back"}\nlooks_goforwardbackwardlayers fields:{FORWARD_BACKWARD:"forward"|"backward"} {NUM}\nlooks_costumenumbername fields:{NUMBER_NAME:"number"|"name"} reporter\nlooks_backdropnumbername fields:{NUMBER_NAME} reporter | looks_size reporter\n\nSound:\nsound_playuntildone fields:{SOUND:"name"} | sound_play fields:{SOUND}\nsound_stopallsounds (no params)\nsound_changeeffectby fields:{EFFECT:"PITCH"|"PAN"} {VALUE}\nsound_seteffectto fields:{EFFECT} {VALUE} | sound_cleareffects (no params)\nsound_changevolumeby {VOL} | sound_setvolumeto {VOL} | sound_volume reporter\n\nEvents (hat blocks, must be at script top):\nevent_whenflagclicked (no params)\nevent_whenkeypressed fields:{KEY:"space"|"up arrow"|"down arrow"|"left arrow"|"right arrow"|"any"|"a".."z"}\nevent_whenthisspriteclicked (no params) | event_whenstageclicked (no params)\nevent_whenbackdropswitchesto fields:{BACKDROP:"name"}\nevent_whengreaterthan fields:{WHENGREATERTHANMENU:"LOUDNESS"|"TIMER"} {VALUE}\nevent_whenbroadcastreceived fields:{BROADCAST_OPTION:"name"}\nevent_broadcast {BROADCAST_INPUT:string} | event_broadcastandwait {BROADCAST_INPUT}\ncontrol_start_as_clone (no params)\n\nControl:\ncontrol_wait {DURATION}\ncontrol_repeat {TIMES} substack:[]\ncontrol_forever substack:[]\ncontrol_if {CONDITION} substack:[]\ncontrol_if_else {CONDITION} substack:[] substack2:[]\ncontrol_wait_until {CONDITION}\ncontrol_repeat_until {CONDITION} substack:[]\ncontrol_while {CONDITION} substack:[] (TurboWarp)\ncontrol_for_each fields:{VARIABLE:"name"} {VALUE} substack:[] (TurboWarp)\ncontrol_stop fields:{STOP_OPTION:"all"|"this script"|"other scripts in sprite"}\ncontrol_create_clone_of fields:{CLONE_OPTION:"_myself_"|"sprite_name"}\ncontrol_delete_this_clone (no params)\ncontrol_all_at_once substack:[] (TurboWarp)\ncontrol_get_counter reporter | control_incr_counter | control_decr_counter | control_clear_counter\n\nSensing:\nsensing_touchingobject fields:{TOUCHINGOBJECTMENU:"_mouse_"|"_edge_"|"sprite_name"} boolean\nsensing_touchingcolor {COLOR:number} boolean (e.g. 16711680 for red)\nsensing_coloristouchingcolor {COLOR,COLOR2} boolean\nsensing_distanceto fields:{DISTANCETOMENU:"_mouse_"|"sprite_name"} reporter\nsensing_askandwait {QUESTION:string} | sensing_answer reporter\nsensing_keypressed fields:{KEY_OPTION:string} boolean\nsensing_mousedown boolean | sensing_mousex reporter | sensing_mousey reporter\nsensing_loudness reporter | sensing_timer reporter | sensing_resettimer\nsensing_of fields:{PROPERTY,OBJECT} reporter\nsensing_current fields:{CURRENTMENU:"YEAR"|"MONTH"|"DATE"|"DAYOFWEEK"|"HOUR"|"MINUTE"|"SECOND"} reporter\nsensing_dayssince2000 reporter | sensing_username reporter\n\nOperators:\noperator_add {NUM1,NUM2} reporter | operator_subtract {NUM1,NUM2} reporter\noperator_multiply {NUM1,NUM2} reporter | operator_divide {NUM1,NUM2} reporter\noperator_random {FROM,TO} reporter\noperator_gt {OPERAND1,OPERAND2} boolean | operator_lt {OPERAND1,OPERAND2} boolean\noperator_equals {OPERAND1,OPERAND2} boolean\noperator_and {OPERAND1,OPERAND2} boolean | operator_or {OPERAND1,OPERAND2} boolean\noperator_not {OPERAND} boolean\noperator_join {STRING1,STRING2} reporter\noperator_letter_of {LETTER,STRING} reporter | operator_length {STRING} reporter\noperator_contains {STRING1,STRING2} boolean\noperator_mod {NUM1,NUM2} reporter | operator_round {NUM} reporter\noperator_mathop fields:{OPERATOR:"abs"|"floor"|"ceiling"|"sqrt"|"sin"|"cos"|"tan"|"asin"|"acos"|"atan"|"ln"|"log"|"e ^"|"10 ^"} {NUM} reporter\n\nVariables:\ndata_setvariableto fields:{VARIABLE:"name"} {VALUE}\ndata_changevariableby fields:{VARIABLE:"name"} {VALUE}\ndata_showvariable fields:{VARIABLE:"name"}\ndata_hidevariable fields:{VARIABLE:"name"}\n\nLists:\ndata_addtolist fields:{LIST:"name"} {ITEM}\ndata_deleteoflist fields:{LIST:"name"} {INDEX}\ndata_deletealloflist fields:{LIST:"name"}\ndata_insertatlist fields:{LIST:"name"} {ITEM,INDEX}\ndata_replaceitemoflist fields:{LIST:"name"} {INDEX,ITEM}\ndata_itemoflist fields:{LIST:"name"} {INDEX} reporter\ndata_itemnumoflist fields:{LIST:"name"} {ITEM} reporter\ndata_lengthoflist fields:{LIST:"name"} reporter\ndata_listcontainsitem fields:{LIST:"name"} {ITEM} boolean\ndata_showlist fields:{LIST:"name"} | data_hidelist fields:{LIST:"name"}\n\nProcedures (custom blocks):\nprocedures_call fields:{custom_block:"name"} — params via inputs arg0, arg1, etc.\n\nTurboWarp:\nlooks_setstretchto {STRETCHX,STRETCHY} | looks_changestretchby {STRETCHX,STRETCHY}\n\n=== PROHIBITED ===\n- DO NOT use opcodes not listed above\n- DO NOT put numbers/expressions in "fields", only strings\n- DO NOT nest hat blocks inside other blocks\n- DO NOT use Scratch internal array format [1,[4,"10"]] for inputs\n- DO NOT fabricate tids — only use tids from the context\n- DO NOT output raw JSON outside of the execute_operations tool call\n\n=== OTHER TOOLS ===\nYou also have access to: get_project_info, set_sprite_property, set_stage_size, create_variable, create_list, set_variable, add_to_list, delete_from_list, add_sprite, delete_sprite, change_costume, add_backdrop, change_backdrop, rename_project, get_installed_extensions, search_extensions, web_search, develop_extension, install_extension, get_system_time, get_system_info, add_costume_from_url, add_sprite_from_url, get_stage_screenshot, pause_output, ask_user.\n\n- create_variable: Create a scalar variable (params: variable_name, sprite_name, initial_value)\n- create_list: Create a list (params: list_name, sprite_name). Use this before add_to_list for explicit list creation.\n- add_to_list: Add an item to a list (auto-creates the list if it does not exist)\n- delete_from_list: Delete an item from a list by 1-based index\n- add_costume_from_url: Add a costume to a sprite from an image URL (params: sprite_name, url, costume_name)\n- add_sprite_from_url: Add a new sprite with a costume from an image URL (params: sprite_name, url)\n- get_stage_screenshot: Capture a screenshot of the current stage (returns base64 PNG image; for multimodal models the screenshot is automatically added as an image to the conversation for visual analysis)\n- web_search: Search the internet for information, documentation, or tutorials. Returns structured results with title, URL, and snippet. Use this to look up Scratch techniques, math formulas, game design patterns, etc.\n- pause_output: Pause output for a specified duration (params: seconds 1-60, reason optional). Shows a countdown indicator in the chat. Use this to give the user time to read important information, wait for user actions, or add natural pauses between steps in multi-step tasks.\n- ask_user: Ask the user a clarifying question when their request is vague, ambiguous, or has multiple valid approaches (params: question, options[2-4] with label+optional description, multi_select optional). Renders an interactive question card in the chat with clickable options and an "Other" text input for custom answers. Blocks until the user responds, returning their selected option(s) or custom text. PROACTIVELY use this tool whenever the user intent is unclear — asking for clarification is always better than guessing and doing the wrong thing.\n\n=== TODO LIST WORKFLOW (IMPORTANT) ===\nFor multi-step or complex tasks, you MUST plan and execute step-by-step using the todo list:\n1. First call plan_todos(items: ["step 1", "step 2", ...], title: "optional title") to display a todo checklist card in the chat. All items start as pending.\n2. Then execute ONE item at a time: before starting an item call update_todo(index: i, status: "doing"), do the actual work with execute_operations or other tools, then call update_todo(index: i, status: "done").\n3. Move to the next item only after the current one is done. The card progress bar and counter update in real time.\n4. Do NOT cram every step into a single execute_operations call. List todos, then execute them one by one so the user can see clear progress.\n5. Simple single-step tasks do not need a todo list.\n\n=== COMMENTS ===\nYou are encouraged to add comments to document code logic. Use the add_comment operation in execute_operations. Comments can be attached to blocks (via targetId) or placed standalone on the workspace (with x/y coordinates). Comments support Chinese text.\n\nReply in ' + lang + '.';
        return desc;
    }

    function fetchProjectCode() {
        if (!window.AIAssistantPreload) return Promise.resolve(null);
        return window.AIAssistantPreload.getProjectCode().then(function(code) {
            if (typeof code === 'string') {
                try { projectCodeCache = JSON.parse(code); } catch(e) { projectCodeCache = null; }
            } else {
                projectCodeCache = code;
            }
            return projectCodeCache;
        });
    }

    function buildProjectContext(userRequest) {
        var ctx = { currentSprite: '', sprites: [], userRequest: userRequest || '' };
        currentContextMapping = {};
        if (!projectCodeCache || !projectCodeCache.targets) return ctx;
        var targets = projectCodeCache.targets;
        var tidCounter = 0;
        function nextTid() { tidCounter++; return 'b' + tidCounter; }
        targets.forEach(function(target) {
            var name = target.name || 'Stage';
            if (target.isStage && !ctx.sprites.length) {
                ctx.currentSprite = name;
            }
            var variables = [];
            var lists = [];
            if (target.variables) {
                var varIds = Object.keys(target.variables);
                for (var vi = 0; vi < varIds.length; vi++) {
                    var v = target.variables[varIds[vi]];
                    if (Array.isArray(v)) {
                        lists.push(v[0]);
                    } else {
                        variables.push(v[0]);
                    }
                }
            }
            var scripts = [];
            if (target.blocks) {
                var blocks = target.blocks;
                var blockIds = Object.keys(blocks);
                var topLevelIds = [];
                for (var bi = 0; bi < blockIds.length; bi++) {
                    var b = blocks[blockIds[bi]];
                    if (b && b.topLevel) topLevelIds.push(blockIds[bi]);
                }
                for (var ti = 0; ti < topLevelIds.length; ti++) {
                    var scriptTidBase = 'scr_' + (ti + 1);
                    var blockList = [];
                    var visited = {};
                    var depth = 0;
                    function walkChain(blockId, d) {
                        if (!blockId || visited[blockId]) return;
                        var block = blocks[blockId];
                        if (!block || !block.opcode) return;
                        visited[blockId] = true;
                        var tid = nextTid();
                        currentContextMapping[tid] = { blockId: blockId, sprite: name };
                        var entry = { tid: tid, opcode: block.opcode, depth: d };
                        if (block.inputs && Object.keys(block.inputs).length > 0) {
                            entry.inputs = {};
                            Object.keys(block.inputs).forEach(function(inKey) {
                                var inp = block.inputs[inKey];
                                if (inp && typeof inp === 'object' && inp.block) {
                                    var subBlock = blocks[inp.block];
                                    if (subBlock) {
                                        entry.inputs[inKey] = '#reporter:' + subBlock.opcode;
                                    }
                                } else {
                                    entry.inputs[inKey] = '(value)';
                                }
                            });
                        }
                        if (block.fields && Object.keys(block.fields).length > 0) {
                            entry.fields = {};
                            Object.keys(block.fields).forEach(function(fk) {
                                entry.fields[fk] = block.fields[fk].value || '';
                            });
                        }
                        blockList.push(entry);
                        if (block.next) walkChain(block.next, d);
                        if (block.inputs && block.inputs.SUBSTACK && block.inputs.SUBSTACK.block) {
                            walkChain(block.inputs.SUBSTACK.block, d + 1);
                        }
                        if (block.inputs && block.inputs.SUBSTACK2 && block.inputs.SUBSTACK2.block) {
                            walkChain(block.inputs.SUBSTACK2.block, d + 1);
                        }
                    }
                    if (topLevelIds[ti]) walkChain(topLevelIds[ti], 0);
                    scripts.push({ tid: scriptTidBase, blocks: blockList });
                }
            }
            ctx.sprites.push({ name: name, variables: variables, lists: lists, scripts: scripts });
        });
        return ctx;
    }

    function showPauseIndicator(seconds, reason) {
        return new Promise(function(resolve) {
            var wrapper = document.createElement('div');
            wrapper.className = 'message-wrapper system';
            wrapper.id = 'pause-' + Date.now();
            var reasonText = reason ? escapeHtml(reason) : '\u6682\u505c\u8f93\u51fa\u4e2d';
            wrapper.innerHTML = '<div class="pause-indicator"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg><span class="pause-reason">' + reasonText + '</span><span class="pause-countdown">' + seconds + 's</span></div>';
            chatArea.appendChild(wrapper);
            scrollToBottom();
            var remaining = seconds;
            var countdownEl = wrapper.querySelector('.pause-countdown');
            var timer = setInterval(function() {
                remaining--;
                if (countdownEl) countdownEl.textContent = remaining + 's';
                if (remaining <= 0) {
                    clearInterval(timer);
                    if (wrapper && wrapper.parentNode) wrapper.remove();
                    resolve({ success: true, message: '\u5df2\u6682\u505c ' + seconds + ' \u79d2' });
                }
            }, 1000);
        });
    }

    function executeToolCall(toolName, params) {
        if (!window.AIAssistantPreload) return Promise.resolve({ success: false, error: 'No preload' });
        var mappedName = toolName;
        switch (toolName) {
            case 'get_project_info': mappedName = 'getProjectSummary'; break;
            case 'set_sprite_property': mappedName = 'setSpriteProperty'; break;
            case 'set_variable': mappedName = 'setVariable'; break;
            case 'create_variable': mappedName = 'createVariable'; break;
            case 'create_list': mappedName = 'createList'; break;
            case 'add_to_list': mappedName = 'addToList'; break;
            case 'delete_from_list': mappedName = 'deleteFromList'; break;
            case 'add_sprite': mappedName = 'addSprite'; break;
            case 'delete_sprite': mappedName = 'deleteSprite'; break;
            case 'change_costume': mappedName = 'changeCostume'; break;
            case 'add_backdrop': mappedName = 'addBackdrop'; break;
            case 'change_backdrop': mappedName = 'changeBackdrop'; break;
            case 'get_installed_extensions': mappedName = 'getInstalledExtensions'; break;
            case 'search_extensions': mappedName = 'searchExtensions'; break;
            case 'develop_extension': mappedName = 'developExtension'; break;
            case 'install_extension': mappedName = 'installExtension'; break;
            case 'rename_project': mappedName = 'renameProject'; break;
            case 'click_green_flag': mappedName = 'clickGreenFlag'; break;
            case 'set_stage_size': mappedName = 'setStageSize'; break;
            case 'execute_operations': mappedName = 'executeOperations'; break;
            case 'get_system_time': mappedName = 'getSystemTime'; break;
            case 'get_system_info': mappedName = 'getSystemInfo'; break;
            case 'duplicate_sprite': mappedName = 'duplicateSprite'; break;
            case 'add_costume_from_url': mappedName = 'addCostumeFromUrl'; break;
            case 'add_sprite_from_url': mappedName = 'addSpriteFromUrl'; break;
            case 'get_stage_screenshot': mappedName = 'getStageScreenshot'; break;
        }
        if (toolName === 'web_search') {
            return window.AIAssistantPreload.webSearch(params.query || '');
        }
        if (toolName === 'execute_operations') {
            params.contextMapping = currentContextMapping;
        }
        if (toolName === 'pause_output') {
            var pauseSeconds = Math.max(1, Math.min(60, parseInt(params.seconds, 10) || 1));
            var pauseReason = params.reason || '';
            return showPauseIndicator(pauseSeconds, pauseReason);
        }
        if (toolName === 'mute_agent') {
            var targetId = params.agent_id;
            if (targetId && AGENTS.find(function(a) { return a.id === targetId && a.id !== 'chief'; })) {
                mutedAgents[targetId] = true;
                return Promise.resolve({ success: true, message: '已禁言智能体: ' + targetId });
            }
            return Promise.resolve({ success: false, error: '无效的智能体ID: ' + targetId });
        }
        if (toolName === 'unmute_agent') {
            var unmuteId = params.agent_id;
            if (unmuteId && mutedAgents[unmuteId]) {
                delete mutedAgents[unmuteId];
                return Promise.resolve({ success: true, message: '已取消禁言智能体: ' + unmuteId });
            }
            return Promise.resolve({ success: false, error: '该智能体未被禁言或ID无效: ' + unmuteId });
        }
        if (toolName === 'assign_task') {
            var targetAgentId = params.agent_id;
            var customPrompt = params.custom_prompt || '';
            if (targetAgentId && AGENTS.find(function(a) { return a.id === targetAgentId && a.id !== 'chief'; })) {
                delete mutedAgents[targetAgentId];
                agentRoundPrompts[targetAgentId] = customPrompt;
                var delayMs = 2000;
                var assignTimer = setTimeout(function() {
                    if (isScratchRunning) {
                        var targetAgent = AGENTS.find(function(a) { return a.id === targetAgentId; });
                        if (targetAgent) startAgent(targetAgent);
                    }
                }, delayMs);
                scratchAgentTimers.push(assignTimer);
                return Promise.resolve({ success: true, message: '已开启智能体: ' + targetAgentId + '，指令：' + customPrompt });
            }
            return Promise.resolve({ success: false, error: '无效的智能体ID: ' + targetAgentId });
        }
        if (toolName === 'plan_todos') {
            return Promise.resolve({ success: true, count: Array.isArray(params.items) ? params.items.length : 0 });
        }
        if (toolName === 'update_todo') {
            var idx = parseInt(params.index, 10);
            if (isNaN(idx) || idx < 1) return Promise.resolve({ success: false, error: '无效的条目序号' });
            return Promise.resolve({ success: true, index: idx, status: params.status || 'pending' });
        }
        if (toolName === 'ask_user') {
            return showAskUserCard(params);
        }
        return window.AIAssistantPreload.callTool(mappedName, params);
    }

    function showAskUserCard(params) {
        return new Promise(function(resolve) {
            var question = params.question || '请选择';
            var options = Array.isArray(params.options) ? params.options : [];
            var multiSelect = !!params.multi_select;
            var selected = {};

            var wrapper = document.createElement('div');
            wrapper.className = 'message-wrapper ai';
            wrapper.id = 'ask-user-' + Date.now();

            var card = document.createElement('div');
            card.className = 'ask-user-card';

            var header = document.createElement('div');
            header.className = 'ask-user-header';
            header.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg><span>AI 想了解一下</span>';
            card.appendChild(header);

            var q = document.createElement('div');
            q.className = 'ask-user-question';
            q.textContent = question;
            card.appendChild(q);

            var optionsWrap = document.createElement('div');
            optionsWrap.className = 'ask-user-options';

            var validOptions = options.filter(function(o) { return o && typeof o.label === 'string' && o.label.trim(); }).slice(0, 4);
            validOptions.forEach(function(opt, i) {
                var btn = document.createElement('div');
                btn.className = 'ask-user-option';
                btn.setAttribute('data-index', i);
                btn.innerHTML = '<div class="ask-user-option-radio"></div><div class="ask-user-option-text"><div class="ask-user-option-label"></div>' + (opt.description ? '<div class="ask-user-option-desc"></div>' : '') + '</div>';
                btn.querySelector('.ask-user-option-label').textContent = opt.label;
                if (opt.description) btn.querySelector('.ask-user-option-desc').textContent = opt.description;
                btn.addEventListener('click', function() {
                    if (multiSelect) {
                        if (selected[i]) {
                            delete selected[i];
                            btn.classList.remove('selected');
                        } else {
                            selected[i] = true;
                            btn.classList.add('selected');
                        }
                        submitBtn.disabled = Object.keys(selected).length === 0 && !otherInput.value.trim();
                    } else {
                        optionsWrap.querySelectorAll('.ask-user-option').forEach(function(el) { el.classList.remove('selected'); });
                        selected = {};
                        selected[i] = true;
                        btn.classList.add('selected');
                        otherInput.value = '';
                        otherWrap.classList.remove('selected');
                        selectedOther = false;
                        submitBtn.disabled = false;
                    }
                });
                optionsWrap.appendChild(btn);
            });

            var selectedOther = false;
            var otherWrap = document.createElement('div');
            otherWrap.className = 'ask-user-option ask-user-other';
            otherWrap.innerHTML = '<div class="ask-user-option-radio"></div><div class="ask-user-option-text"><div class="ask-user-option-label">其他</div></div>';
            var otherInput = document.createElement('textarea');
            otherInput.className = 'ask-user-other-input';
            otherInput.placeholder = '请输入你的回答...';
            otherInput.rows = 2;
            otherWrap.appendChild(otherInput);
            otherWrap.addEventListener('click', function(e) {
                if (e.target === otherInput) return;
                if (multiSelect) {
                    if (selectedOther) {
                        selectedOther = false;
                        otherWrap.classList.remove('selected');
                    } else {
                        selectedOther = true;
                        otherWrap.classList.add('selected');
                        otherInput.focus();
                    }
                    submitBtn.disabled = Object.keys(selected).length === 0 && !selectedOther;
                } else {
                    optionsWrap.querySelectorAll('.ask-user-option').forEach(function(el) { el.classList.remove('selected'); });
                    selected = {};
                    otherWrap.classList.add('selected');
                    selectedOther = true;
                    otherInput.focus();
                    submitBtn.disabled = false;
                }
            });
            otherInput.addEventListener('input', function() {
                if (otherInput.value.trim()) {
                    if (!multiSelect) {
                        optionsWrap.querySelectorAll('.ask-user-option').forEach(function(el) { el.classList.remove('selected'); });
                        selected = {};
                    }
                    otherWrap.classList.add('selected');
                    selectedOther = true;
                }
                submitBtn.disabled = Object.keys(selected).length === 0 && !selectedOther;
            });
            otherInput.addEventListener('click', function(e) { e.stopPropagation(); });
            card.appendChild(optionsWrap);
            card.appendChild(otherWrap);

            var actions = document.createElement('div');
            actions.className = 'ask-user-actions';
            var submitBtn = document.createElement('button');
            submitBtn.className = 'btn btn-primary ask-user-submit';
            submitBtn.textContent = multiSelect ? '提交选择' : '确认';
            submitBtn.disabled = true;
            submitBtn.addEventListener('click', function() {
                var chosenLabels = [];
                Object.keys(selected).forEach(function(k) {
                    var idx = parseInt(k, 10);
                    if (validOptions[idx]) chosenLabels.push(validOptions[idx].label);
                });
                var otherText = (selectedOther && otherInput.value.trim()) ? otherInput.value.trim() : '';
                if (otherText) chosenLabels.push(otherText);

                card.querySelectorAll('.ask-user-option').forEach(function(el) { el.style.pointerEvents = 'none'; });
                otherInput.disabled = true;
                submitBtn.disabled = true;
                submitBtn.textContent = '已提交';

                var summary = document.createElement('div');
                summary.className = 'ask-user-answer';
                summary.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span>' + escapeHtml(chosenLabels.join('、')) + '</span>';
                card.appendChild(summary);

                resolve({
                    success: true,
                    selected: chosenLabels,
                    selected_labels: chosenLabels,
                    other_text: otherText,
                    multi_select: multiSelect
                });
            });
            actions.appendChild(submitBtn);
            card.appendChild(actions);

            wrapper.appendChild(card);
            chatArea.appendChild(wrapper);
            scrollToBottom();
        });
    }

    var currentStreamingWrapper = null;

    function updateStreamingReasoning(wrapper, reasoning) {
        var rb = wrapper.previousElementSibling;
        if (!rb || !rb.classList.contains('reasoning-box')) {
            rb = document.createElement('div');
            rb.className = 'reasoning-box';
            rb.innerHTML = '<div class="reasoning-box-header" onclick="this.parentElement.classList.toggle(\'collapsed\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg><span>Reasoning</span></div><div class="reasoning-content streaming"></div>';
            wrapper.parentNode.insertBefore(rb, wrapper);
        }
        var rc = rb.querySelector('.reasoning-content');
        if (rc) { rc.textContent = reasoning; rc.classList.add('streaming'); }
    }

    function getEffectiveModelId() {
        var provider = PROVIDERS[currentConfig.provider];
        if (provider && provider.isCustom && currentConfig.customModelId) {
            return currentConfig.customModelId;
        }
        return currentConfig.model;
    }

    function doApiCall(messages, callback) {
        var provider = PROVIDERS[currentConfig.provider];
        var endpoint;
        endpoint = provider.isCustom ? (currentConfig.customEndpoint || provider.endpoint) : provider.endpoint;
        var modelInfo = getModelInfo();

        var body = { model: getEffectiveModelId(), messages: messages, stream: true, tools: TOOLS, tool_choice: 'auto' };
        if ((currentConfig.provider === 'deepseek' || currentConfig.provider === 'glm') && modelInfo && modelInfo.supportsReasoning) {
            body.thinking = { type: 'enabled' };
        }
        if (currentConfig.provider === 'deepseek' && modelInfo && modelInfo.supportsReasoning) {
            body.reasoning_effort = 'high';
        }
        if (currentConfig.provider === 'glm' && currentConfig.model === 'glm-5.2' && modelInfo && modelInfo.supportsReasoning) {
            body.reasoning_effort = 'max';
            body.max_tokens = 65536;
        }
        if (currentConfig.provider === 'openai' && modelInfo && modelInfo.supportsReasoning) body.reasoning_effort = 'high';

        abortController = new AbortController();
        var fullContent = '';
        var fullReasoning = '';
        var toolCallsAccum = {};
        var hasToolCall = false;

        var fetchHeaders = { 'Content-Type': 'application/json' };
        fetchHeaders['Authorization'] = 'Bearer ' + currentConfig.apiKey;

        fetch(endpoint, {
            method: 'POST',
            headers: fetchHeaders,
            body: JSON.stringify(body),
            signal: abortController.signal
        }).then(function(resp) {
            if (!resp.ok) return resp.json().catch(function() { return {}; }).then(function(e) { throw new Error(e.error ? e.error.message : 'HTTP ' + resp.status); });
            var reader = resp.body.getReader();
            var decoder = new TextDecoder();
            var buf = '';
            function read() {
                reader.read().then(function(r) {
                    if (r.done) { finish(); return; }
                    buf += decoder.decode(r.value, { stream: true });
                    var lines = buf.split('\n');
                    buf = lines.pop() || '';
                    lines.forEach(function(l) {
                        l = l.trim();
                        if (!l || !l.startsWith('data: ')) return;
                        var d = l.slice(6);
                        if (d === '[DONE]') { finish(); return; }
                        try {
                            var j = JSON.parse(d);
                            var delta = j.choices && j.choices[0] && j.choices[0].delta;
                            if (!delta) return;
                            if (delta.reasoning_content) {
                                fullReasoning += delta.reasoning_content;
                                hasOutput = true;
                            }
                            if (delta.content) {
                                fullContent += delta.content;
                                hasOutput = true;
                            }
                            if (delta.tool_calls) {
                                delta.tool_calls.forEach(function(tc) {
                                    if (!toolCallsAccum[tc.index]) {
                                        toolCallsAccum[tc.index] = { id: tc.id || '', type: tc.type || 'function', function: { name: '', arguments: '' } };
                                    }
                                    if (tc.id) toolCallsAccum[tc.index].id = tc.id;
                                    if (tc.function) {
                                        if (tc.function.name) toolCallsAccum[tc.index].function.name = tc.function.name;
                                        if (tc.function.arguments) toolCallsAccum[tc.index].function.arguments += tc.function.arguments;
                                    }
                                });
                                hasToolCall = true;
                                hasOutput = true;
                            }
                        } catch(e) {}
                    });
                    callback({ type: 'chunk', fullContent: fullContent, fullReasoning: fullReasoning });
                    read();
                }).catch(function(err) {
                    callback({ type: 'error', error: err });
                });
            }
            read();
        }).catch(function(err) {
            callback({ type: 'error', error: err });
        });

        var finished = false;
        function finish() {
            if (finished) return;
            finished = true;
            if (hasToolCall && Object.keys(toolCallsAccum).length > 0) {
                var toolCalls = [];
                Object.keys(toolCallsAccum).sort().forEach(function(k) {
                    toolCalls.push(toolCallsAccum[k]);
                });
                callback({ type: 'tool_calls', toolCalls: toolCalls, content: fullContent, reasoning: fullReasoning });
            } else {
                callback({ type: 'text', content: fullContent, reasoning: fullReasoning });
            }
        }

        var hasOutput = false;
    }

    function buildApiMessages() {
        var systemPrompt = buildSystemPrompt();
        var apiMessages = [{ role: 'system', content: systemPrompt }];
        var provider = PROVIDERS[currentConfig.provider];
        var contextWindow = currentConfig.contextWindow || 20;
        var sliceCount = -Math.max(1, contextWindow);
        chatHistory.slice(sliceCount).forEach(function(m) {
            if (m.role === 'tool_result') return;
            if (m.role === 'user' && m.images && m.images.length > 0) {
                var contentArr = [{ type: 'text', text: m.content }];
                m.images.forEach(function(img) {
                    contentArr.push({ type: 'image_url', image_url: { url: img } });
                });
                apiMessages.push({ role: m.role, content: contentArr });
            } else if (m.role === 'tool') {
                apiMessages.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content });
            } else if (m.role === 'assistant' && m.tool_calls) {
                var assistantMsg = { role: 'assistant', content: m.content || '', tool_calls: m.tool_calls };
                if (m.reasoning) assistantMsg.reasoning_content = m.reasoning;
                apiMessages.push(assistantMsg);
            } else {
                var msg = { role: m.role, content: m.content };
                if (m.role === 'assistant' && m.reasoning) msg.reasoning_content = m.reasoning;
                apiMessages.push(msg);
            }
        });
        var foundToolWithoutCalls = false;
        var hasToolCallsBefore = false;
        for (var i = 0; i < apiMessages.length; i++) {
            if (apiMessages[i].role === 'assistant' && apiMessages[i].tool_calls) {
                hasToolCallsBefore = true;
            }
            if (apiMessages[i].role === 'tool' && !hasToolCallsBefore) {
                foundToolWithoutCalls = true;
                break;
            }
        }
        if (foundToolWithoutCalls) {
            var missingAssistant = null;
            for (var j = chatHistory.length - 1; j >= 0; j--) {
                if (chatHistory[j].role === 'assistant' && chatHistory[j].tool_calls) {
                    missingAssistant = chatHistory[j];
                    break;
                }
            }
            if (missingAssistant) {
                var amsg = { role: 'assistant', content: missingAssistant.content || '', tool_calls: missingAssistant.tool_calls };
                if (missingAssistant.reasoning) amsg.reasoning_content = missingAssistant.reasoning;
                for (var k = 0; k < apiMessages.length; k++) {
                    if (apiMessages[k].role === 'tool') {
                        apiMessages.splice(k, 0, amsg);
                        break;
                    }
                }
            }
        }
        return apiMessages;
    }

    function sendMessage(previousMessages) {
        if (!previousMessages && isLoading) return;
        var isInitial = !previousMessages;

        if (isInitial) {
            var content = messageInput.value.trim();
            if (!content && pendingImages.length === 0) return;
            if (!currentConfig.apiKey) { showToast('Configure API Key first', 'error'); openSettings(); return; }

            var msg = { role: 'user', content: content, time: formatTime(new Date()), images: pendingImages.length > 0 ? pendingImages.slice() : undefined };
            chatHistory.push(msg);
            saveCurrentConversation();
            appendUserMessage(content, msg.time, msg.images, true);
            messageInput.value = '';
            autoResize();
            updateSendBtn();
            pendingImages = [];
            renderImagePreview();

            isLoading = true;
            updateSendBtn();
            showTypingIndicator();
        }

        fetchProjectCode().then(function() {
            var apiMessages = previousMessages || buildApiMessages();
            if (!Array.isArray(apiMessages)) apiMessages = buildApiMessages();

            if (isInitial) {
                var lastUserContent = '';
                for (var ui = apiMessages.length - 1; ui >= 0; ui--) {
                    if (apiMessages[ui].role === 'user') {
                        lastUserContent = typeof apiMessages[ui].content === 'string' ? apiMessages[ui].content : '';
                        break;
                    }
                }
                var ctx = buildProjectContext(lastUserContent);
                var ctxJson = JSON.stringify(ctx);
                for (var uj = apiMessages.length - 1; uj >= 0; uj--) {
                    if (apiMessages[uj].role === 'user') {
                        if (typeof apiMessages[uj].content === 'string') {
                            apiMessages[uj].content = ctxJson + '\n\n' + apiMessages[uj].content;
                        }
                        break;
                    }
                }
            }

            var typingEl = document.getElementById('typingIndicator');
            if (typingEl) typingEl.remove();

            welcomeMessage.style.display = 'none';
            var streamingWrapper = document.createElement('div');
            streamingWrapper.className = 'message-wrapper ai';
            streamingWrapper.id = 'streaming-' + Date.now();
            var streamingBubble = document.createElement('div');
            streamingBubble.className = 'message-bubble';
            streamingBubble.innerHTML = '<span style="opacity:0.5">Thinking...</span>';
            streamingWrapper.appendChild(streamingBubble);
            chatArea.appendChild(streamingWrapper);
            scrollToBottom();

            var lastContent = '';
            var lastReasoning = '';

            doApiCall(apiMessages, function(result) {
                if (result.type === 'chunk') {
                    if (result.fullContent !== lastContent) {
                        lastContent = result.fullContent;
                        streamingBubble.innerHTML = formatMarkdown(lastContent) + '<div class="message-time">' + formatTime(new Date()) + '</div>';
                        scrollToBottom();
                    }
                    if (result.fullReasoning !== lastReasoning) {
                        lastReasoning = result.fullReasoning;
                        updateStreamingReasoning(streamingWrapper, lastReasoning);
                    }
                } else if (result.type === 'error') {
                    streamingWrapper.remove();
                    if (result.error.name === 'AbortError') {
                        chatArea.querySelectorAll('.reasoning-box').forEach(function(el) {
                            if (el.nextElementSibling === streamingWrapper || !el.nextElementSibling) el.remove();
                        });
                    } else {
                        var em = { role: 'assistant', content: 'Error: ' + result.error.message, time: formatTime(new Date()) };
                        chatHistory.push(em);
                        appendAIMessage(em.content, em.time, '', [], true);
                    }
                    isLoading = false;
                    abortController = null;
                    updateSendBtn();
                } else if (result.type === 'tool_calls') {
                    streamingWrapper.remove();
                    chatArea.querySelectorAll('.reasoning-box').forEach(function(el) {
                        if (el.nextElementSibling === streamingWrapper || !el.nextElementSibling) el.remove();
                    });

                    var tcDisplay = [];
                    result.toolCalls.forEach(function(tc) {
                        var tcDisplayName = tc.function.name.replace(/_/g, ' ');
                        var argsObj = {};
                        try { argsObj = JSON.parse(tc.function.arguments || '{}'); } catch(e) {}
                        tcDisplay.push({ name: tcDisplayName, args: argsObj, raw: tc });
                    });

                    var aiMsg = {
                        role: 'assistant',
                        content: result.content || '',
                        time: formatTime(new Date()),
                        reasoning: result.reasoning || '',
                        tool_calls: result.toolCalls,
                        toolCalls: tcDisplay
                    };
                    chatHistory.push(aiMsg);
                    saveCurrentConversation();
                    appendAIMessage(aiMsg.content, aiMsg.time, aiMsg.reasoning, tcDisplay, true);

                    var genWrapper = document.createElement('div');
                    genWrapper.className = 'message-wrapper system';
                    genWrapper.id = 'gen-' + Date.now();
                    genWrapper.innerHTML = '<div class="generating-indicator"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg><span>' + t('executing') + '</span><div class="dot-bounce"><span></span><span></span><span></span></div></div>';
                    chatArea.appendChild(genWrapper);
                    scrollToBottom();

                    var promises = result.toolCalls.map(function(tc) {
                        var fname = tc.function.name;
                        var args = {};
                        try { args = JSON.parse(tc.function.arguments || '{}'); } catch(e) {}
                        return executeToolCall(fname, args).then(function(r) {
                            return { tool_call_id: tc.id, name: fname, result: r };
                        });
                    });

                    Promise.all(promises).then(function(toolResults) {
                        if (genWrapper && genWrapper.parentNode) genWrapper.remove();

                        var toolMessages = buildApiMessages();

                        toolResults.forEach(function(tr) {
                            var resultStr = JSON.stringify(tr.result);
                            // For get_stage_screenshot, include image as content for multimodal models
                            if (tr.name === 'get_stage_screenshot' && tr.result && tr.result.success && tr.result.data && tr.result.data.image) {
                                var p = PROVIDERS[currentConfig.provider];
                                var mi = p && p.models.find(function(m) { return m.id === currentConfig.model; });
                                var visionOk = p && p.supportsVision !== false && !(mi && mi.supportsVision === false);
                                if (visionOk) {
                                    toolMessages.push({
                                        role: 'tool',
                                        tool_call_id: tr.tool_call_id,
                                        content: [
                                            { type: 'text', text: 'Stage screenshot captured successfully.' },
                                            { type: 'image_url', image_url: { url: 'data:' + (tr.result.data.mimeType || 'image/png') + ';base64,' + tr.result.data.image } }
                                        ]
                                    });
                                } else {
                                    toolMessages.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: resultStr });
                                }
                            } else {
                                toolMessages.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: resultStr });
                            }

                            chatHistory.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: resultStr });
                            var tcMsg = { role: 'tool_result', name: tr.name, result: tr.result, tool_call_id: tr.tool_call_id, time: formatTime(new Date()) };
                            chatHistory.push(tcMsg);
                            appendToolResult(tr.name, tr.result);
                        });
                        saveCurrentConversation();

                        isLoading = true;
                        sendMessage(toolMessages);
                    });
                } else if (result.type === 'text') {
                    streamingWrapper.id = '';
                    streamingBubble.innerHTML = formatMarkdown(result.content) + '<div class="message-time">' + formatTime(new Date()) + '</div>';
                    chatArea.querySelectorAll('.reasoning-box').forEach(function(el) {
                        var rc = el.querySelector('.reasoning-content');
                        if (rc) rc.classList.remove('streaming');
                    });

                    var aiMsg = { role: 'assistant', content: result.content, time: formatTime(new Date()), reasoning: result.reasoning || undefined };
                    chatHistory.push(aiMsg);
                    saveCurrentConversation();
                    isLoading = false;
                    abortController = null;
                    updateSendBtn();
                }
            });
        }).catch(function(err) {
            var typingEl = document.getElementById('typingIndicator');
            if (typingEl) typingEl.remove();
            var em = { role: 'assistant', content: 'Error: ' + err.message, time: formatTime(new Date()) };
            chatHistory.push(em);
            saveCurrentConversation();
            appendAIMessage(em.content, em.time, '', [], true);
            isLoading = false;
            updateSendBtn();
        });
    }

    function appendToolResult(toolName, result) {
        var wrapper = document.createElement('div');
        wrapper.className = 'skill-box';
        wrapper.style.maxWidth = '88%';
        wrapper.style.marginBottom = '8px';
        if (!result.success) wrapper.style.borderColor = '#ef4444';
        var resultStr = result.success ? (result.data ? JSON.stringify(result.data, null, 2) : 'Done') : (result.error || 'Failed');
        // For screenshot, show image preview instead of raw base64
        var extraHtml = '';
        if (toolName === 'get_stage_screenshot' && result.success && result.data && result.data.image) {
            extraHtml = '<div style="margin-top:8px;"><img src="data:' + (result.data.mimeType || 'image/png') + ';base64,' + result.data.image + '" style="max-width:100%;border-radius:6px;border:1px solid rgba(0,0,0,0.1);" /></div>';
            resultStr = 'Stage screenshot captured (PNG image)';
        }
        wrapper.innerHTML = '<div class="skill-box-header"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Tool: ' + escapeHtml(toolName) + '</span></div><div class="skill-args">' + escapeHtml(resultStr) + '</div>' + extraHtml;
        chatArea.appendChild(wrapper);
        scrollToBottom();
    }

    function setupEvents() {
        if (sendBtn) sendBtn.addEventListener('click', function() {
            if (isLoading && abortController) {
                abortController.abort();
                return;
            }
            if (!sendBtn.disabled) sendMessage();
        });
        if (messageInput) {
            messageInput.addEventListener('input', function() { updateSendBtn(); autoResize(); });
            messageInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) { 
                    e.preventDefault();
                    if (isLoading && abortController) { abortController.abort(); return; }
                    if (!sendBtn.disabled) sendMessage(); 
                }
            });
        }
        if (settingsBtn) settingsBtn.addEventListener('click', function() { settingsOpen ? closeSettings() : openSettings(); });
        if (settingsOverlay) settingsOverlay.addEventListener('click', function(e) { if (e.target === settingsOverlay) closeSettings(); });
        if (settingsHandle) settingsHandle.addEventListener('click', closeSettings);
        if (clearChatBtn) clearChatBtn.addEventListener('click', clearChat);
        var addModelBtn = document.getElementById('addModelBtn');
        if (addModelBtn) addModelBtn.addEventListener('click', function() {
            var dlg = document.createElement('div');
            dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:200;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);';
            var inner = document.createElement('div');
            inner.style.cssText = 'background:var(--surface);border-radius:var(--radius-lg);padding:24px;width:92%;max-width:480px;max-height:88vh;overflow-y:auto;box-shadow:var(--shadow-xl);';
            var provOpts = Object.keys(PROVIDERS).map(function(k) { return '<option value="' + k + '">' + PROVIDERS[k].name + '</option>'; }).join('');
            var apiFormatOpts = Object.keys(API_FORMATS).map(function(k) { return '<option value="' + k + '">' + API_FORMATS[k].name + '</option>'; }).join('');

            function addField(id, label, type, placeholder, hidden) {
                return '<div class="settings-field"' + (hidden ? ' style="display:none;"' : '') + ' id="' + id + 'Row"><label class="settings-field-label">' + label + '</label>' +
                    '<input' + (type === 'password' ? ' type="password"' : (type === 'number' ? ' type="number" min="1" max="10000"' : ' type="text"')) + ' id="' + id + '" class="settings-input' + (type === 'text' || type === 'password' ? ' settings-input-mono' : '') + '" placeholder="' + (placeholder || '') + '"></div>';
            }
            function addSelect(id, label, options, hidden) {
                return '<div class="settings-field"' + (hidden ? ' style="display:none;"' : '') + ' id="' + id + 'Row"><label class="settings-field-label">' + label + '</label>' +
                    '<select id="' + id + '" class="settings-input">' + options + '</select></div>';
            }

            inner.innerHTML =
                '<h3 style="margin:0 0 20px;font-size:18px;font-weight:700;letter-spacing:-0.3px;">添加新模型</h3>' +
                addSelect('addProv', 'Provider', provOpts) +
                addSelect('addModel', 'Model', '', false) +
                addSelect('addApiFormat', 'API 格式', apiFormatOpts, true) +
                addField('addEndpoint', '自定义请求地址', 'text', 'https://api.example.com/v1/chat/completions', true) +
                addField('addCustomModelId', '模型 ID', 'text', 'e.g. gpt-4o', true) +
                addField('addApiKey', 'API 密钥', 'password', 'sk-...') +
                addField('addContextWindow', '上下文窗口', 'number', '消息数量，如 2000') +
                '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px;">' +
                '<button id="addCancel" class="btn btn-secondary" style="flex:0 0 auto;padding:10px 18px;">取消</button>' +
                '<button id="addSave" class="btn btn-primary" style="flex:0 0 auto;padding:10px 18px;">添加</button></div>';
            dlg.appendChild(inner); document.body.appendChild(dlg);
            var addProv = inner.querySelector('#addProv'), addModel = inner.querySelector('#addModel'), addApiFormat = inner.querySelector('#addApiFormat');
            function populateModels() {
                var p = PROVIDERS[addProv.value]; var models = (p && p.models) ? p.models : [];
                addModel.innerHTML = models.map(function(m) { return '<option value="' + m.id + '">' + m.name + '</option>'; }).join('');
            }
            function updateAddCustomFields() {
                var p = PROVIDERS[addProv.value] || {};
                var custom = p.isCustom;
                inner.querySelector('#addApiFormatRow').style.display = custom ? '' : 'none';
                inner.querySelector('#addEndpointRow').style.display = custom ? '' : 'none';
                inner.querySelector('#addCustomModelIdRow').style.display = custom ? '' : 'none';
            }
            populateModels();
            updateAddCustomFields();
            inner.querySelector('#addContextWindow').value = 2000;
            addProv.addEventListener('change', function() { populateModels(); updateAddCustomFields(); });
            dlg.addEventListener('click', function(e) { if (e.target === dlg) { document.body.removeChild(dlg); } });
            inner.querySelector('#addCancel').addEventListener('click', function() { document.body.removeChild(dlg); });
            inner.querySelector('#addSave').addEventListener('click', function() {
                var prov = addProv.value, model = addModel.value;
                var key = inner.querySelector('#addApiKey').value.trim();
                var cw = parseInt(inner.querySelector('#addContextWindow').value, 10);
                var p = PROVIDERS[prov] || {};
                var newCfg = {
                    id: 'cfg_' + Date.now(),
                    name: p.name || 'New Model',
                    provider: prov,
                    model: model,
                    apiKey: key,
                    customEndpoint: p.isCustom ? inner.querySelector('#addEndpoint').value.trim() : '',
                    customModelId: p.isCustom ? inner.querySelector('#addCustomModelId').value.trim() : '',
                    apiFormat: p.isCustom ? addApiFormat.value : 'openai',
                    contextWindow: isNaN(cw) || cw < 1 ? 2000 : cw
                };
                savedConfigs.push(newCfg);
                activeConfigIndex = savedConfigs.length - 1;
                applyActiveConfig();
                saveConfigs();
                updateAllUI();
                document.body.removeChild(dlg);
                showToast('模型已添加', 'success');
            });
        });
        if (modelSelectBtn) modelSelectBtn.addEventListener('click', function(e) { e.stopPropagation(); modelDropdownOpen ? closeModelDropdown() : openModelDropdown(); });
        if (imageInput) imageInput.addEventListener('change', handleImageSelect);

        document.addEventListener('click', function(e) {
            if (modelDropdownOpen && !modelDropdown.contains(e.target) && e.target !== modelSelectBtn && !modelSelectBtn.contains(e.target)) closeModelDropdown();
        });

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                if (settingsOpen) closeSettings();
                if (modelDropdownOpen) closeModelDropdown();
                var scratchDlg = document.getElementById('scratchConfigDialog');
                if (scratchDlg && scratchDlg.classList.contains('open')) closeScratchConfigDialog();
                if (isLoading && abortController) { abortController.abort(); showToast('Generation cancelled', 'success'); }
            }
        });

        window.addEventListener('resize', scrollToBottom);

        var scratchConfigDialog = document.getElementById('scratchConfigDialog');
        if (scratchConfigDialog) {
            scratchConfigDialog.addEventListener('click', function(e) {
                if (e.target === this) closeScratchConfigDialog();
            });
        }
        var cancelScratchBtn = document.getElementById('cancelScratchBtn');
        if (cancelScratchBtn) cancelScratchBtn.addEventListener('click', closeScratchConfigDialog);
        var startScratchBtn = document.getElementById('startScratchBtn');
        if (startScratchBtn) startScratchBtn.addEventListener('click', startScratchAgent);
        var timeRangeSlider = document.getElementById('timeRangeSlider');
        if (timeRangeSlider) timeRangeSlider.addEventListener('input', updateTimeRangeValue);
        var endConditionRadios = document.querySelectorAll('#scratchConfigDialog .end-condition-radio');
        endConditionRadios.forEach(function(radio) {
            radio.addEventListener('click', function() {
                endConditionRadios.forEach(function(r) { r.classList.remove('selected'); });
                this.classList.add('selected');
                scratchEndCondition = this.dataset.condition;
                var timeContainer = document.getElementById('timeRangeContainer');
                if (timeContainer) {
                    if (scratchEndCondition === 'timed') {
                        timeContainer.classList.add('visible');
                    } else {
                        timeContainer.classList.remove('visible');
                    }
                }
            });
        });
        var agentStopBtn = document.getElementById('agentStopBtn');
        if (agentStopBtn) {
            agentStopBtn.addEventListener('click', function() {
                exitSplitLayout();
                showToast('ScratchAgent \u5df2\u505c\u6b62', 'success');
            });
        }
    }

    setupEvents();
    init();
    updateSendBtn();
    populateModelSwitcherDropdown();
    if (!currentConfig.apiKey) setTimeout(function() { settingDot.classList.add('visible'); }, 500);
})();

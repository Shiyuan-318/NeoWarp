(function () {
  'use strict';

  var PROVIDERS = {
    openai: {
      name: 'OpenAI', logo: '#10a37f', logoText: 'O',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      models: [
        { id: 'gpt-4.1', name: 'GPT-4.1', supportsReasoning: true },
        { id: 'gpt-4o', name: 'GPT-4o', supportsReasoning: false },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', supportsReasoning: false },
        { id: 'o3-mini', name: 'o3-mini', supportsReasoning: true }
      ],
      defaultModel: 'gpt-4o'
    },
    deepseek: {
      name: 'DeepSeek', logo: '#4f46e5', logoText: 'D',
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek V3', supportsReasoning: false },
        { id: 'deepseek-reasoner', name: 'DeepSeek R1', supportsReasoning: true }
      ],
      defaultModel: 'deepseek-chat'
    },
    glm: {
      name: 'Zhipu GLM', logo: '#3859ff', logoText: 'Z',
      endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      models: [
        { id: 'glm-4-plus', name: 'GLM-4 Plus', supportsReasoning: false },
        { id: 'glm-4-flash', name: 'GLM-4 Flash', supportsReasoning: false }
      ],
      defaultModel: 'glm-4-plus'
    },
    kimi: {
      name: 'Kimi (Moonshot)', logo: '#10b981', logoText: 'K',
      endpoint: 'https://api.moonshot.cn/v1/chat/completions',
      models: [
        { id: 'moonshot-v1-8k', name: 'Kimi 8K', supportsReasoning: false },
        { id: 'moonshot-v1-32k', name: 'Kimi 32K', supportsReasoning: false },
        { id: 'moonshot-v1-128k', name: 'Kimi 128K', supportsReasoning: false }
      ],
      defaultModel: 'moonshot-v1-32k'
    },
    qwen: {
      name: 'Qwen (通义千问)', logo: '#6366f1', logoText: 'Q',
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

  var $ = function(id) { return document.getElementById(id); };
  var chatArea = $('chatArea');
  var welcomeMessage = $('welcomeMessage');
  var messageInput = $('messageInput');
  var sendBtn = $('sendBtn');
  var settingsBtn = $('settingsBtn');
  var settingsOverlay = $('settingsOverlay');
  var settingsPanel = $('settingsPanel');
  var settingsHandle = $('settingsHandle');
  var apiKeyInput = $('apiKeyInput');
  var saveSettingsBtn = $('saveSettingsBtn');
  var cancelSettingsBtn = $('cancelSettingsBtn');
  var clearChatBtn = $('clearChatBtn');
  var modelSelectBtn = $('modelSelectBtn');
  var modelDropdown = $('modelDropdown');
  var modelDropdownList = $('modelDropdownList');
  var modelNameDisplay = $('modelNameDisplay');
  var modelShortDisplay = $('modelShortDisplay');
  var modelStatusDot = $('modelStatusDot');
  var settingDot = $('settingDot');
  var toast = $('toast');
  var customEndpointSection = $('customEndpointSection');
  var customEndpointInput = $('customEndpointInput');
  var inputWrapper = $('inputWrapper');

  var providerSelect = $('providerSelect');
  var providerTrigger = $('providerTrigger');
  var providerTriggerText = $('providerTriggerText');
  var providerDropdown = $('providerDropdown');
  var modelSelect_inSettings = $('modelSelect_inSettings');
  var modelTrigger = $('modelTrigger');
  var modelTriggerText = $('modelTriggerText');
  var modelDropdown_inSettings = $('modelDropdown_inSettings');

  var chatHistory = [];
  var currentConfig = { apiKey: '', provider: 'openai', model: 'gpt-4o', customEndpoint: '' };
  var isLoading = false;
  var settingsOpen = false;
  var modelDropdownOpen = false;
  var toastTimer = null;
  var abortController = null;
  var projectCodeCache = null;

  function init () {
    loadConfig();
    updateModelDisplay();
    updateSettingDot();
    populateProviderDropdown();
    populateSettingsModelDropdown();
    syncSettingsUI();
    setupEvents();
    autoResize();
  }

  function loadConfig () {
    if (!window.AIAssistantPreload) return;
    window.AIAssistantPreload.getSettings().then(function (s) {
      if (s) {
        if (s.apiKey) currentConfig.apiKey = s.apiKey;
        if (s.provider && PROVIDERS[s.provider]) currentConfig.provider = s.provider;
        if (s.model) currentConfig.model = s.model;
        if (s.customEndpoint) currentConfig.customEndpoint = s.customEndpoint;
      }
      updateModelDisplay();
      updateSettingDot();
      populateProviderDropdown();
      populateSettingsModelDropdown();
      syncSettingsUI();
    });
  }

  function saveConfig () {
    if (!window.AIAssistantPreload) return;
    window.AIAssistantPreload.saveSettings({
      apiKey: currentConfig.apiKey,
      provider: currentConfig.provider,
      model: currentConfig.model,
      customEndpoint: currentConfig.customEndpoint
    });
  }

  function getModelInfo () {
    var p = PROVIDERS[currentConfig.provider];
    return (p && p.models.find(function(m) { return m.id === currentConfig.model; })) || (p && p.models[0]);
  }

  function updateModelDisplay () {
    var m = getModelInfo();
    var name = m ? m.name : currentConfig.model;
    modelNameDisplay.textContent = name;
    modelShortDisplay.textContent = name.length > 8 ? name.substring(0, 7) + '\u2026' : (name || 'Model');
    modelStatusDot.style.display = currentConfig.apiKey ? 'inline-block' : 'none';
  }

  function updateSettingDot () {
    settingDot.classList.toggle('visible', !currentConfig.apiKey);
  }

  function syncSettingsUI () {
    apiKeyInput.value = currentConfig.apiKey || '';
    providerTriggerText.textContent = (PROVIDERS[currentConfig.provider] || {}).name || 'OpenAI';
    var p = PROVIDERS[currentConfig.provider];
    var mi = p && p.models.find(function(m) { return m.id === currentConfig.model; });
    modelTriggerText.textContent = mi ? mi.name : (currentConfig.model || (p && p.defaultModel));
    customEndpointInput.value = currentConfig.customEndpoint || '';
    customEndpointSection.style.display = p && p.isCustom ? 'block' : 'none';
    populateSettingsModelDropdown();
    updateModelDisplay();
  }

  function populateProviderDropdown () {
    providerDropdown.innerHTML = '';
    Object.keys(PROVIDERS).forEach(function (key) {
      var p = PROVIDERS[key];
      var opt = document.createElement('div');
      opt.className = 'custom-select-option' + (key === currentConfig.provider ? ' selected' : '');
      opt.innerHTML = '<span class="provider-logo" style="background:' + p.logo + ';">' + p.logoText + '</span><span>' + p.name + '</span>';
      opt.addEventListener('click', function (e) { e.stopPropagation(); selectProvider(key); });
      providerDropdown.appendChild(opt);
    });
  }

  function populateSettingsModelDropdown () {
    var p = PROVIDERS[currentConfig.provider];
    var models = p ? p.models : [];
    modelDropdown_inSettings.innerHTML = '';
    models.forEach(function (m) {
      var opt = document.createElement('div');
      opt.className = 'custom-select-option' + (m.id === currentConfig.model ? ' selected' : '');
      opt.innerHTML = '<span>' + m.name + '</span>' + (m.supportsReasoning ? '<span class="model-tag">R</span>' : '');
      opt.addEventListener('click', function (e) { e.stopPropagation(); selectModelInSettings(m.id); });
      modelDropdown_inSettings.appendChild(opt);
    });
    var cur = models.find(function(m) { return m.id === currentConfig.model; });
    modelTriggerText.textContent = cur ? cur.name : (models[0] ? models[0].name : 'Model');
  }

  function populateModelDropdownForChat () {
    var p = PROVIDERS[currentConfig.provider];
    var models = p ? p.models : [];
    modelDropdownList.innerHTML = '';
    models.forEach(function (m) {
      var item = document.createElement('div');
      item.className = 'model-dropdown-item' + (m.id === currentConfig.model ? ' active' : '');
      item.innerHTML = '<span>' + m.name + '</span>' + (m.supportsReasoning ? '<span class="model-tag">R</span>' : '') + '<svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        currentConfig.model = m.id;
        saveConfig();
        updateModelDisplay();
        populateModelDropdownForChat();
        closeModelDropdown();
        showToast('Switched to ' + m.name, 'success');
      });
      modelDropdownList.appendChild(item);
    });
  }

  function selectProvider (key) {
    currentConfig.provider = key;
    var p = PROVIDERS[key];
    currentConfig.model = p.defaultModel;
    if (p.isCustom) {
      customEndpointSection.style.display = 'block';
    } else {
      customEndpointSection.style.display = 'none';
      currentConfig.customEndpoint = '';
    }
    providerTriggerText.textContent = p.name;
    populateProviderDropdown();
    populateSettingsModelDropdown();
    providerSelect.classList.remove('open');
  }

  function selectModelInSettings (modelId) {
    currentConfig.model = modelId;
    var p = PROVIDERS[currentConfig.provider];
    var m = p.models.find(function(m2) { return m2.id === modelId; });
    modelTriggerText.textContent = m ? m.name : modelId;
    populateSettingsModelDropdown();
    modelSelect_inSettings.classList.remove('open');
  }

  function openSettings () {
    settingsOverlay.classList.add('open');
    settingsOpen = true;
    syncSettingsUI();
    populateProviderDropdown();
    populateSettingsModelDropdown();
    closeModelDropdown();
  }

  function closeSettings () {
    settingsOverlay.classList.remove('open');
    settingsOpen = false;
    providerSelect.classList.remove('open');
    modelSelect_inSettings.classList.remove('open');
  }

  function saveSettings () {
    var apiKey = apiKeyInput.value.trim();
    if (!apiKey) { showToast('Please enter API Key', 'error'); apiKeyInput.focus(); return; }
    currentConfig.apiKey = apiKey;
    currentConfig.customEndpoint = customEndpointInput.value.trim();
    saveConfig();
    updateModelDisplay();
    updateSettingDot();
    populateModelDropdownForChat();
    closeSettings();
    showToast('Settings saved', 'success');
  }

  function openModelDropdown () {
    populateModelDropdownForChat();
    modelDropdown.style.display = 'block';
    modelSelectBtn.classList.add('open');
    modelDropdownOpen = true;
  }

  function closeModelDropdown () {
    modelDropdown.style.display = 'none';
    modelSelectBtn.classList.remove('open');
    modelDropdownOpen = false;
  }

  function showToast (msg, type) {
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.className = 'toast ' + (type || '') + ' show';
    toastTimer = setTimeout(function () { toast.classList.remove('show'); toast.className = 'toast'; }, 2200);
  }

  function clearChat () {
    if (!chatHistory.length || isLoading) return;
    chatHistory = [];
    renderChatHistory();
    showToast('Chat cleared', 'success');
  }

  function autoResize () {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
  }

  function updateSendBtn () {
    sendBtn.disabled = !(messageInput.value.trim().length > 0) || isLoading;
  }

  function formatTime (d) {
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function escapeHtml (t) {
    var div = document.createElement('div');
    div.textContent = t;
    return div.innerHTML;
  }

  function formatMarkdown (t) {
    var html = escapeHtml(t);
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function(match, lang, code) {
      return '<div class="code-block"><div class="code-header"><span class="code-lang">' + (lang || 'text') + '</span><button class="code-copy-btn" onclick="copyCode(this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>Copy</button></div><pre><code>' + escapeHtml(code.trimEnd()) + '</code></pre></div>';
    });
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  window.copyCode = function(btn) {
    var code = btn.closest('.code-block').querySelector('code').textContent;
    navigator.clipboard.writeText(code).then(function() {
      btn.classList.add('copied');
      btn.innerHTML = 'Copied';
      setTimeout(function() { btn.classList.remove('copied'); btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>Copy'; }, 2000);
    });
  };

  function scrollToBottom () {
    requestAnimationFrame(function() { chatArea.scrollTop = chatArea.scrollHeight; });
  }

  function renderChatHistory () {
    chatArea.querySelectorAll('.message-wrapper, .reasoning-box').forEach(function(m) { m.remove(); });
    if (!chatHistory.length) { welcomeMessage.style.display = 'block'; return; }
    welcomeMessage.style.display = 'none';
    chatHistory.forEach(function(msg) {
      if (msg.role === 'user') appendUserMessage(msg.content, msg.time, false);
      else appendAIMessage(msg.content, msg.time, msg.reasoning || '', false);
    });
    scrollToBottom();
  }

  function appendUserMessage (content, time, animate) {
    welcomeMessage.style.display = 'none';
    var wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper user';
    if (animate) wrapper.style.animation = 'fadeInUp 0.35s ease-out';
    var bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = escapeHtml(content).replace(/\n/g, '<br>');
    var timeEl = document.createElement('div');
    timeEl.className = 'message-time';
    timeEl.textContent = time || formatTime(new Date());
    bubble.appendChild(timeEl);
    wrapper.appendChild(bubble);
    chatArea.appendChild(wrapper);
    scrollToBottom();
  }

  function appendAIMessage (content, time, reasoning, animate) {
    welcomeMessage.style.display = 'none';
    if (reasoning) {
      var rb = document.createElement('div');
      rb.className = 'reasoning-box';
      rb.innerHTML = '<div class="reasoning-box-header" onclick="this.parentElement.classList.toggle(\'collapsed\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg><span>Reasoning</span></div><div class="reasoning-content">' + escapeHtml(reasoning) + '</div>';
      chatArea.appendChild(rb);
    }
    var wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper ai';
    if (animate) wrapper.style.animation = 'fadeInUp 0.35s ease-out';
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

  function updateAIMessageContent (id, content, reasoning) {
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

  function showTypingIndicator () {
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

  function buildSystemPrompt () {
    var fallback = 'You are an AI programming assistant for NeoWarp (Scratch 3.0). Help with Scratch projects. Be concise. Reply in Chinese.';
    if (!projectCodeCache || !projectCodeCache.targets) return { prompt: fallback, compressed: false };

    var targets = projectCodeCache.targets;
    var sprites = targets.filter(function(t) { return !t.isStage; });
    var stage = targets.find(function(t) { return t.isStage; });

    var toolList = [
      '## Available Tools',
      'You have access to the following tools via function calling:',
      '- **clickStage(x, y)**: Click the stage at Scratch coordinates. x: -240~240, y: -180~180.',
      '- **setFramerate(fps)**: Set frame rate (1-240 FPS). Default 30, use 60 for smooth animations.',
      '- **clickGreenFlag()**: Start the project.',
      '- **createVariable(variableName, initial_value?, spriteName?)**: Create a variable.',
      '- **setVariable(variableName, value, spriteName?)**: Set a variable value.',
      '- **getVariable(variableName, spriteName?)**: Get a variable value.',
      '- **getAllVariables()**: List all variables.',
      '- **createList(listName, items?, spriteName?)**: Create a list with optional initial items.',
      '- **addToList(listName, item, spriteName?)**: Add item to end of list.',
      '- **deleteFromList(listName, index, spriteName?)**: Delete item (1-based index, "last", or "all").',
      '- **setListItem(listName, index, item, spriteName?)**: Set item at 1-based index.',
      '- **insertToList(listName, item, index?, spriteName?)**: Insert item at position ("first", "last", or 1-based index).',
      '- **clearList(listName, spriteName?)**: Clear all items from a list.',
      '- **getList(listName, spriteName?)**: Get list contents.',
      '- **getAllLists()**: List all lists.',
      '- **getAllSprites()**: List all sprites with properties.',
      '- **setSpriteProperty(spriteName, x?, y?, size?, direction?, visible?, ...)**: Set sprite properties.',
      '- **getSpriteProperty(spriteName)**: Get sprite properties.',
      '- **getProjectSummary()**: Get project summary.',
      '- **getExtensionCode(extensionId?, extensionName?)**: View the JavaScript source code of a loaded extension. Provide the extension ID/URL or name.',
      '- **sendKeyToStage(key, duration?)**: Send a keyboard key press to the stage (e.g., "a", "space", "up", "enter"). Duration in ms (default 100).',
      '- **addScript(spriteName, hat, blocks, hatKey?, hatMessage?, hatBackdrop?)**: Add a script to a sprite/stage. hat defaults to "event_whenflagclicked".',
      '- **executeOperations(operations, contextMapping?)**: Batch operations: add_script, delete_block, modify_input, add_comment, delete_comment, explain.',
      '- **addSprite(spriteName?)**: Add a new sprite with a colored circle costume.',
      '- **addBackdrop(backdropName?)**: Add a new backdrop with gradient color.',
      '- **deleteSprite(spriteName)**: Delete a sprite.',
      '- **changeCostume(spriteName, costumeName)**: Switch sprite costume by name.',
      '- **changeBackdrop(backdropName)**: Switch backdrop by name.',
      '- **getStageInfo()**: Get stage info (current backdrop, all backdrops).',
      '- **getStageScreenshot()**: Capture stage screenshot as base64 PNG.',
      '- **getInstalledExtensions()**: List installed extensions with blocks and menus.',
      '- **searchExtensions(keyword)**: Search TurboWarp extensions by keyword.',
      '- **developExtension(extension_code, extension_name?)**: Load custom extension JS code.',
      '- **installExtension(extension_url)**: Install extension by URL or known ID.',
      '- **addCostumeFromUrl(spriteName, url, costumeName?)**: Add costume from image URL.',
      '- **searchAndAddCostume(spriteName, query, costumeName?)**: Search Wikimedia Commons and add costume.',
      '- **addSpriteFromUrl(url, spriteName?)**: Create new sprite from image URL.',
      '- **setStageSize(width, height)**: Set stage dimensions (min 240x180).',
      '- **renameProject(name)**: Rename the project.',
      '- **getSystemTime()**: Get current system time and date.',
      '- **getSystemInfo()**: Get system hardware and OS info.',
      '- **web_search(query)**: Search the web.',
      '',
      'When spriteName is omitted for variable/list operations, the stage (global) scope is used.'
    ].join('\n');

    var opcodeRef = [
      '## Scratch Opcode Reference',
      'Motion: motion_movesteps, motion_turnright, motion_turnleft, motion_goto, motion_glideto, motion_pointindirection, motion_pointtowards, motion_changexby, motion_setx, motion_changeyby, motion_sety, motion_ifonedgebounce, motion_setrotationstyle',
      'Looks: looks_sayforsecs, looks_say, looks_thinkforsecs, looks_think, looks_switchcostumeto, looks_nextcostume, looks_switchbackdropto, looks_nextbackdrop, looks_changesizeby, looket_setsizeto, looks_changeeffectby, looks_seteffectto, looks_cleargraphiceffects, looks_show, looks_hide, looks_gotofrontback, looks_goforwardbackwardlayers',
      'Sound: sound_playuntildone, sound_play, sound_stopallsounds, sound_changeeffectby, sound_seteffectto, sound_cleareffects, sound_changevolumeby, sound_setvolumeto',
      'Control: control_wait, control_wait_until, control_repeat, control_forever, control_if, control_if_else, control_repeat_until, control_stop, control_start_as_clone, control_create_clone_of, control_delete_this_clone',
      'Sensing: sensing_touchingobject, sensing_touchingcolor, sensing_coloristouchingcolor, sensing_distanceto, sensing_askandwait, sensing_answer, sensing_keypressed, sensing_mousedown, sensing_mousex, sensing_mousey, sensing_loudness, sensing_timer, sensing_resettimer, sensing_of, sensing_current',
      'Operators: operator_add, operator_subtract, operator_multiply, operator_divide, operator_random, operator_gt, operator_lt, operator_equals, operator_and, operator_or, operator_not, operator_join, operator_letter_of, operator_length, operator_contains, operator_round, operator_mathop',
      'Data: data_setvariableto, data_changevariableby, data_showvariable, data_hidevariable, data_addtolist, data_deleteoflist, data_deletealloflist, data_insertatlist, data_replaceitemoflist, data_itemoflist, data_itemnumoflist, data_lengthoflist, data_listcontainsitem',
      'Events: event_whenflagclicked, event_whenkeypressed, event_whenthisspriteclicked, event_whenbackdropswitchesto, event_whengreaterthan, event_whenbroadcastreceived, event_broadcast, event_broadcastandwait'
    ].join('\n');

    var rules = [
      '## Rules',
      '1. Ranges: x(-240~240) y(-180~180) size(5~535) dir(-180~180).',
      '2. Blocks: opcode, next, parent, inputs, fields, shadow, topLevel, x, y.',
      '3. Reply in Chinese.'
    ].join('\n');

    var baseSections = '\n\n' + toolList + '\n\n' + rules + '\n\n' + opcodeRef;
    var projectJsonStr = JSON.stringify(projectCodeCache, null, 2);

    if (projectJsonStr.length > 5000) {
      var summary = ['## Project Summary (Compressed - full JSON omitted to save context)'];
      summary.push('Sprites count: ' + sprites.length);
      if (stage && stage.costumes) {
        summary.push('Backdrops count: ' + stage.costumes.length);
      }
      summary.push('');
      summary.push('### Sprites');
      sprites.forEach(function(s) {
        var bc = s.blocks ? Object.keys(s.blocks).length : 0;
        var line = '- "' + s.name + '" pos(' + (s.x || 0) + ',' + (s.y || 0) + ') size:' + (s.size || 100) + '% dir:' + (s.direction || 90) + 'deg blocks:' + bc;
        var allVars = s.variables ? Object.values(s.variables) : [];
        var varNames = allVars.filter(function(v) { return v.type !== 'list'; }).map(function(v) { return v.name; });
        var listNames = allVars.filter(function(v) { return v.type === 'list'; }).map(function(v) { return v.name; });
        if (varNames.length) line += ' vars:[' + varNames.join(', ') + ']';
        if (listNames.length) line += ' lists:[' + listNames.join(', ') + ']';
        summary.push(line);
      });
      if (stage) {
        summary.push('');
        summary.push('### Stage');
        var allStageVars = stage.variables ? Object.values(stage.variables) : [];
        var stageVarNames = allStageVars.filter(function(v) { return v.type !== 'list'; }).map(function(v) { return v.name; });
        var stageListNames = allStageVars.filter(function(v) { return v.type === 'list'; }).map(function(v) { return v.name; });
        summary.push('Variables: [' + stageVarNames.join(', ') + ']');
        summary.push('Lists: [' + stageListNames.join(', ') + ']');
      }

      return {
        prompt: 'You are NeoWarp AI coding assistant.\n\n' + summary.join('\n') + baseSections,
        compressed: true
      };
    }

    var lines = ['Sprites: ' + sprites.length];
    if (stage && stage.costumes) lines.push('Backdrops: ' + stage.costumes.length);
    sprites.forEach(function(s) {
      var bc = s.blocks ? Object.keys(s.blocks).length : 0;
      lines.push('"' + s.name + '" pos(' + (s.x||0) + ',' + (s.y||0) + ') size:' + (s.size||100) + '% dir:' + (s.direction||90) + 'deg blocks:' + bc);
    });

    return {
      prompt: 'You are NeoWarp AI coding assistant.\n\n## Project JSON\n```json\n' + projectJsonStr + '\n```\n\n## Summary\n' + lines.join('\n') + baseSections,
      compressed: false
    };
  }

  function fetchProjectCode () {
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

  var TOOLS = [
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web for information. Use this when you need to find current information, look up facts, or research topics that you are not certain about.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'clickStage',
        description: 'Simulate a mouse click on the stage at the given Scratch coordinates. x ranges from -240 (left) to 240 (right), y ranges from -180 (bottom) to 180 (top). Center is (0, 0).',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X coordinate in Scratch coordinate system (-240 to 240)' },
            y: { type: 'number', description: 'Y coordinate in Scratch coordinate system (-180 to 180)' }
          },
          required: ['x', 'y']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'setFramerate',
        description: 'Set the project frame rate (FPS). Default is 30. Higher values make the project run faster (e.g., 60 for smooth animations). Range: 1-240.',
        parameters: {
          type: 'object',
          properties: {
            fps: { type: 'number', description: 'Target frame rate in FPS (1-240)' }
          },
          required: ['fps']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'clickGreenFlag',
        description: 'Click the green flag to start running the project.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'createVariable',
        description: 'Create a new variable. If the variable already exists, returns its current value. If spriteName is omitted, creates a stage (global) variable.',
        parameters: {
          type: 'object',
          properties: {
            variableName: { type: 'string', description: 'Name of the variable to create' },
            initial_value: { type: 'string', description: 'Initial value (optional, defaults to 0)' },
            spriteName: { type: 'string', description: 'Sprite name for local variable. Omit for stage/global variable.' }
          },
          required: ['variableName']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'setVariable',
        description: 'Set the value of an existing variable. If spriteName is omitted, operates on the stage (global) variable.',
        parameters: {
          type: 'object',
          properties: {
            variableName: { type: 'string', description: 'Name of the variable' },
            value: { type: 'string', description: 'New value (number or string)' },
            spriteName: { type: 'string', description: 'Sprite name for local variable. Omit for stage/global variable.' }
          },
          required: ['variableName', 'value']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getVariable',
        description: 'Get the value of a variable. If spriteName is omitted, reads from the stage (global) variable.',
        parameters: {
          type: 'object',
          properties: {
            variableName: { type: 'string', description: 'Name of the variable' },
            spriteName: { type: 'string', description: 'Sprite name for local variable. Omit for stage/global variable.' }
          },
          required: ['variableName']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getAllVariables',
        description: 'Get all variables in the project, including their target (sprite/stage), name, value, and cloud status.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'createList',
        description: 'Create a new list. If the list already exists, returns its current length. If spriteName is omitted, creates a stage (global) list.',
        parameters: {
          type: 'object',
          properties: {
            listName: { type: 'string', description: 'Name of the list to create' },
            items: { type: 'array', items: { type: 'string' }, description: 'Initial items for the list (optional)' },
            spriteName: { type: 'string', description: 'Sprite name for local list. Omit for stage/global list.' }
          },
          required: ['listName']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'addToList',
        description: 'Add an item to the end of a list. Creates the list if it does not exist. If spriteName is omitted, operates on the stage (global) list.',
        parameters: {
          type: 'object',
          properties: {
            listName: { type: 'string', description: 'Name of the list' },
            item: { type: 'string', description: 'Item to add (number or string)' },
            spriteName: { type: 'string', description: 'Sprite name for local list. Omit for stage/global list.' }
          },
          required: ['listName', 'item']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'deleteFromList',
        description: 'Delete an item from a list. index is 1-based. Use "last" to delete the last item, "all" to clear the list. If spriteName is omitted, operates on the stage (global) list.',
        parameters: {
          type: 'object',
          properties: {
            listName: { type: 'string', description: 'Name of the list' },
            index: { type: 'string', description: '1-based index, "last", or "all"' },
            spriteName: { type: 'string', description: 'Sprite name for local list. Omit for stage/global list.' }
          },
          required: ['listName', 'index']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'setListItem',
        description: 'Set the value of an item at a specific index in a list. index is 1-based. If spriteName is omitted, operates on the stage (global) list.',
        parameters: {
          type: 'object',
          properties: {
            listName: { type: 'string', description: 'Name of the list' },
            index: { type: 'number', description: '1-based index of the item to set' },
            item: { type: 'string', description: 'New value (number or string)' },
            spriteName: { type: 'string', description: 'Sprite name for local list. Omit for stage/global list.' }
          },
          required: ['listName', 'index', 'item']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'insertToList',
        description: 'Insert an item at a specific position in a list. index is 1-based. Use "first" to insert at the beginning, "last" to append. If spriteName is omitted, operates on the stage (global) list.',
        parameters: {
          type: 'object',
          properties: {
            listName: { type: 'string', description: 'Name of the list' },
            index: { type: 'string', description: '1-based index, "first", or "last"' },
            item: { type: 'string', description: 'Item to insert (number or string)' },
            spriteName: { type: 'string', description: 'Sprite name for local list. Omit for stage/global list.' }
          },
          required: ['listName', 'item']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'clearList',
        description: 'Remove all items from a list. If spriteName is omitted, operates on the stage (global) list.',
        parameters: {
          type: 'object',
          properties: {
            listName: { type: 'string', description: 'Name of the list' },
            spriteName: { type: 'string', description: 'Sprite name for local list. Omit for stage/global list.' }
          },
          required: ['listName']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getList',
        description: 'Get the contents of a list. If spriteName is omitted, reads from the stage (global) list.',
        parameters: {
          type: 'object',
          properties: {
            listName: { type: 'string', description: 'Name of the list' },
            spriteName: { type: 'string', description: 'Sprite name for local list. Omit for stage/global list.' }
          },
          required: ['listName']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getAllLists',
        description: 'Get all lists in the project, including their target (sprite/stage), name, value, and length.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getAllSprites',
        description: 'Get all sprites in the project with their properties (position, size, direction, visibility, costumes, variables, lists).',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'setSpriteProperty',
        description: 'Set properties of a sprite. Only provide the properties you want to change. x: -240~240, y: -180~180, size: 5~535, direction: -180~180.',
        parameters: {
          type: 'object',
          properties: {
            spriteName: { type: 'string', description: 'Name of the sprite' },
            x: { type: 'number', description: 'X position (-240 to 240)' },
            y: { type: 'number', description: 'Y position (-180 to 180)' },
            size: { type: 'number', description: 'Size percentage (5 to 535)' },
            direction: { type: 'number', description: 'Direction in degrees (-180 to 180)' },
            visible: { type: 'boolean', description: 'Visibility' },
            draggable: { type: 'boolean', description: 'Whether sprite is draggable' },
            rotationStyle: { type: 'string', description: 'Rotation style: "all around", "left-right", or "don\'t rotate"' }
          },
          required: ['spriteName']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getSpriteProperty',
        description: 'Get all properties of a sprite (position, size, direction, visibility, costumes, etc.).',
        parameters: {
          type: 'object',
          properties: {
            spriteName: { type: 'string', description: 'Name of the sprite' }
          },
          required: ['spriteName']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getProjectSummary',
        description: 'Get a summary of the project including sprite count, all sprites with their variables and lists, and stage variables.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getExtensionCode',
        description: 'View the source code of a loaded extension. Provide extensionId (the extension URL or ID) or extensionName (the display name). Returns the JavaScript source code. Useful for understanding how an extension works or debugging it.',
        parameters: {
          type: 'object',
          properties: {
            extensionId: { type: 'string', description: 'Extension ID or URL (e.g., "text", "https://extensions.turbowarp.org/text.js")' },
            extensionName: { type: 'string', description: 'Extension display name (e.g., "Text", "Pen")' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'sendKeyToStage',
        description: 'Send a keyboard key press to the stage. Simulates pressing and releasing a key. Useful for testing projects that respond to keyboard input. Keys: single characters (a-z, 0-9), or special keys: space, enter, tab, escape, backspace, delete, up, down, left, right, shift, control, alt, home, end, page up, page down.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Key to press (e.g., "a", "space", "up", "enter")' },
            duration: { type: 'number', description: 'How long to hold the key in milliseconds (default: 100)' }
          },
          required: ['key']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'addScript',
        description: 'Add a script (blocks) to a sprite or stage. Creates a hat block followed by the specified blocks.',
        parameters: {
          type: 'object',
          properties: {
            spriteName: { type: 'string', description: 'Name of the sprite or "Stage"' },
            hat: { type: 'string', description: 'Hat block opcode. Default "event_whenflagclicked". Other options: "event_whenkeypressed" (requires hatKey), "event_whenthisspriteclicked", "event_whenbroadcastreceived" (requires hatMessage), "event_whenbackdropswitchesto" (requires hatBackdrop), "control_start_as_clone"' },
            blocks: {
              type: 'array',
              description: 'Array of block objects. Each block has: opcode (string, format: "category_action" e.g. "motion_movesteps", "looks_say", "control_wait"), inputs (object mapping input name to value - number/string/boolean/{VARIABLE:name}/{LIST:name}), fields (object mapping field name to value). Example: [{opcode:"motion_movesteps",inputs:{STEPS:10}},{opcode:"looks_say",inputs:{MESSAGE:"Hello!"}},{opcode:"control_wait",inputs:{DURATION:1}}]',
              items: { type: 'object' }
            },
            hatKey: { type: 'string', description: 'Key for event_whenkeypressed (e.g., "a", "space", "up arrow")' },
            hatMessage: { type: 'string', description: 'Broadcast message name for event_whenbroadcastreceived' },
            hatBackdrop: { type: 'string', description: 'Backdrop name for event_whenbackdropswitchesto' }
          },
          required: ['spriteName', 'blocks']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'executeOperations',
        description: 'Execute a batch of operations atomically. Supports: add_script, delete_block, modify_input, add_comment, delete_comment, explain.',
        parameters: {
          type: 'object',
          properties: {
            operations: {
              type: 'array',
              description: 'Array of operation objects. Each operation has a "type" field: "add_script" (fields: sprite, script), "delete_block" (fields: targetId, mode), "modify_input" (fields: targetId, inputName, value), "add_comment" (fields: sprite, text, targetId, x, y, minimized), "delete_comment" (fields: sprite, targetId, commentId), "explain" (fields: text)',
              items: { type: 'object' }
            },
            contextMapping: { type: 'object', description: 'Map of temporary block IDs to {sprite, blockId} for cross-operation references' }
          },
          required: ['operations']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'addSprite',
        description: 'Add a new sprite with a colored circle costume.',
        parameters: {
          type: 'object',
          properties: {
            spriteName: { type: 'string', description: 'Name for the new sprite. Default "Sprite"' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'addBackdrop',
        description: 'Add a new backdrop with a gradient color.',
        parameters: {
          type: 'object',
          properties: {
            backdropName: { type: 'string', description: 'Name for the new backdrop. Default "Backdrop"' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'deleteSprite',
        description: 'Delete a sprite by name.',
        parameters: {
          type: 'object',
          properties: {
            spriteName: { type: 'string', description: 'Name of the sprite to delete' }
          },
          required: ['spriteName']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'changeCostume',
        description: 'Switch to a costume by name.',
        parameters: {
          type: 'object',
          properties: {
            spriteName: { type: 'string', description: 'Name of the sprite' },
            costumeName: { type: 'string', description: 'Name of the costume to switch to' }
          },
          required: ['spriteName', 'costumeName']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'changeBackdrop',
        description: 'Switch to a backdrop by name.',
        parameters: {
          type: 'object',
          properties: {
            backdropName: { type: 'string', description: 'Name of the backdrop to switch to' }
          },
          required: ['backdropName']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getStageInfo',
        description: 'Get stage information including current backdrop and all backdrops.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getStageScreenshot',
        description: 'Capture a screenshot of the current stage. Returns base64 PNG image data.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getInstalledExtensions',
        description: 'List all installed extensions with their blocks and menus.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'searchExtensions',
        description: 'Search for available TurboWarp extensions by keyword.',
        parameters: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: 'Search keyword (e.g., "text", "pen", "physics")' }
          },
          required: ['keyword']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'developExtension',
        description: 'Load custom extension code dynamically.',
        parameters: {
          type: 'object',
          properties: {
            extension_code: { type: 'string', description: 'JavaScript source code of the extension class/function' },
            extension_name: { type: 'string', description: 'Name for the extension. Default "custom_extension_<timestamp>"' }
          },
          required: ['extension_code']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'installExtension',
        description: 'Install an extension by URL or known ID.',
        parameters: {
          type: 'object',
          properties: {
            extension_url: { type: 'string', description: 'Full URL to extension .js file, or a known extension ID (e.g., "text", "pen", "music")' }
          },
          required: ['extension_url']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'addCostumeFromUrl',
        description: 'Add a costume to a sprite from an image URL.',
        parameters: {
          type: 'object',
          properties: {
            spriteName: { type: 'string', description: 'Name of the sprite' },
            url: { type: 'string', description: 'URL of the image (png, jpg, svg, gif, bmp)' },
            costumeName: { type: 'string', description: 'Name for the costume. Default "costume"' }
          },
          required: ['spriteName', 'url']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'searchAndAddCostume',
        description: 'Search Wikimedia Commons for an image and add it as a costume.',
        parameters: {
          type: 'object',
          properties: {
            spriteName: { type: 'string', description: 'Name of the sprite' },
            query: { type: 'string', description: 'Search query for the image' },
            costumeName: { type: 'string', description: 'Name for the costume. Defaults to the query' }
          },
          required: ['spriteName', 'query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'addSpriteFromUrl',
        description: 'Create a new sprite from an image URL.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL of the image' },
            spriteName: { type: 'string', description: 'Name for the new sprite. Default "Sprite"' }
          },
          required: ['url']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'setStageSize',
        description: 'Set the stage dimensions.',
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
        name: 'renameProject',
        description: 'Rename the project.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'New project name' }
          },
          required: ['name']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getSystemTime',
        description: 'Get current system time and date.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'getSystemInfo',
        description: 'Get system hardware and OS information.',
        parameters: { type: 'object', properties: {} }
      }
    }
  ];

  function executeToolCall (toolName, args) {
    if (toolName === 'web_search') {
      if (!window.AIAssistantPreload) return Promise.resolve({ success: false, error: 'Preload not available' });
      return window.AIAssistantPreload.webSearch(args.query || '');
    }
    // Route all other tools through callTool (goes to editor window via IPC)
    if (!window.AIAssistantPreload || !window.AIAssistantPreload.callTool) {
      return Promise.resolve({ success: false, error: 'Editor not available' });
    }
    return window.AIAssistantPreload.callTool(toolName, args || {});
  }

  function sendMessage () {
    if (isLoading) return;
    var content = messageInput.value.trim();
    if (!content) return;
    if (!currentConfig.apiKey) { showToast('Configure API Key first', 'error'); openSettings(); return; }

    var msg = { role: 'user', content: content, time: formatTime(new Date()) };
    chatHistory.push(msg);
    appendUserMessage(content, msg.time, true);
    messageInput.value = '';
    autoResize();
    updateSendBtn();

    isLoading = true;
    sendBtn.disabled = true;
    showTypingIndicator();

    var provider = PROVIDERS[currentConfig.provider];
    var endpoint = provider.isCustom ? (currentConfig.customEndpoint || provider.endpoint) : provider.endpoint;
    var modelInfo = getModelInfo();

    fetchProjectCode().then(function() {
      var promptResult = buildSystemPrompt();
      var historyLimit = promptResult.compressed ? 30 : 20;
      var messages = [{ role: 'system', content: promptResult.prompt }].concat(chatHistory.slice(-historyLimit).map(function(m) {
        return { role: m.role, content: m.content };
      }));
      runConversationLoop(endpoint, messages, modelInfo);
    }).catch(function(err) {
      var typingEl = document.getElementById('typingIndicator');
      if (typingEl) typingEl.remove();
      var em = { role: 'assistant', content: 'Error: ' + err.message, time: formatTime(new Date()) };
      chatHistory.push(em);
      appendAIMessage(em.content, em.time, '', true);
      isLoading = false;
      updateSendBtn();
    });
  }

  function runConversationLoop (endpoint, messages, modelInfo) {
    var body = { model: currentConfig.model, messages: messages, stream: true, tools: TOOLS };
    if (currentConfig.provider === 'deepseek' && modelInfo && modelInfo.supportsReasoning) body.thinking = true;
    if (currentConfig.provider === 'openai' && modelInfo && modelInfo.supportsReasoning) body.reasoning_effort = 'high';

    var typingEl = document.getElementById('typingIndicator');
    if (typingEl) typingEl.remove();

    var wrapperId = 'ai-' + Date.now();
    var wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper ai';
    wrapper.id = wrapperId;
    var bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = '<span style="opacity:0.5">Thinking...</span>';
    wrapper.appendChild(bubble);
    chatArea.appendChild(wrapper);
    scrollToBottom();

    abortController = new AbortController();
    var fullContent = '';
    var fullReasoning = '';
    var toolCallsMap = {};
    var hasToolCalls = false;
    var finishReason = '';

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + currentConfig.apiKey },
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
              var choice = j.choices && j.choices[0];
              if (!choice) return;
              var delta = choice.delta;
              if (!delta) return;
              if (delta.reasoning_content) { fullReasoning += delta.reasoning_content; updateAIMessageContent(wrapperId, fullContent, fullReasoning); }
              if (delta.content) { fullContent += delta.content; updateAIMessageContent(wrapperId, fullContent, fullReasoning); }
              if (delta.tool_calls) {
                hasToolCalls = true;
                delta.tool_calls.forEach(function(tc) {
                  if (!toolCallsMap[tc.index]) toolCallsMap[tc.index] = { id: '', name: '', arguments: '' };
                  if (tc.id) toolCallsMap[tc.index].id = tc.id;
                  if (tc.function) {
                    if (tc.function.name) toolCallsMap[tc.index].name += tc.function.name;
                    if (tc.function.arguments) toolCallsMap[tc.index].arguments += tc.function.arguments;
                  }
                });
                if (!fullContent) updateAIMessageContent(wrapperId, 'Searching the web...', fullReasoning);
              }
              if (choice.finish_reason) finishReason = choice.finish_reason;
            } catch(e) {}
          });
          read();
        }).catch(function(err) { finishError(err); });
      }
      read();
    }).catch(function(err) { finishError(err); });

    function finish() {
      var pendingToolCalls = Object.keys(toolCallsMap).sort(function(a,b){return a-b;}).map(function(k) { return toolCallsMap[k]; });

      if (pendingToolCalls.length > 0 && (finishReason === 'tool_calls' || hasToolCalls)) {
        wrapper.remove();
        chatArea.querySelectorAll('.reasoning-box').forEach(function(el) {
          var rc = el.querySelector('.reasoning-content');
          if (rc) rc.classList.remove('streaming');
        });

        // Show tool execution indicator
        var searchIndicator = document.createElement('div');
        searchIndicator.className = 'message-wrapper ai';
        searchIndicator.id = 'toolIndicator';
        var searchBubble = document.createElement('div');
        searchBubble.className = 'message-bubble';
        var toolNames = pendingToolCalls.map(function(tc) { return tc.name; }).join(', ');
        searchBubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div><span style="opacity:0.6;margin-left:8px">Executing ' + escapeHtml(toolNames) + '...</span>';
        searchIndicator.appendChild(searchBubble);
        chatArea.appendChild(searchIndicator);
        scrollToBottom();

        var toolPromises = pendingToolCalls.map(function(tc) {
          var args;
          try { args = JSON.parse(tc.arguments); } catch(e) { args = {}; }
          return executeToolCall(tc.name, args).then(function(result) {
            return { toolCallId: tc.id, name: tc.name, result: result };
          });
        });

        Promise.all(toolPromises).then(function(results) {
          // Remove tool indicator
          var ti = document.getElementById('toolIndicator');
          if (ti) ti.remove();

          // Add assistant message with tool_calls
          var assistantMsg = {
            role: 'assistant',
            content: fullContent || null,
            tool_calls: pendingToolCalls.map(function(tc) {
              return { id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } };
            })
          };
          messages.push(assistantMsg);

          // Add tool results
          results.forEach(function(r) {
            var resultStr = JSON.stringify(r.result);
            if (resultStr.length > 4000) {
              resultStr = resultStr.substring(0, 4000) + '\n[结果已截断]';
            }
            messages.push({
              role: 'tool',
              tool_call_id: r.toolCallId,
              content: resultStr
            });
          });

          // Continue conversation loop
          runConversationLoop(endpoint, messages, modelInfo);
        }).catch(function(err) {
          var ti = document.getElementById('toolIndicator');
          if (ti) ti.remove();
          finishError(err);
        });
      } else {
        wrapper.remove();
        chatArea.querySelectorAll('.reasoning-box').forEach(function(el) {
          var rc = el.querySelector('.reasoning-content');
          if (rc) rc.classList.remove('streaming');
        });
        var aiMsg = { role: 'assistant', content: fullContent, time: formatTime(new Date()), reasoning: fullReasoning || undefined };
        chatHistory.push(aiMsg);
        appendAIMessage(aiMsg.content, aiMsg.time, aiMsg.reasoning, true);
        isLoading = false;
        abortController = null;
        updateSendBtn();
      }
    }

    function finishError(err) {
      if (err.name === 'AbortError') { wrapper.remove(); }
      else {
        wrapper.remove();
        var em = { role: 'assistant', content: 'Error: ' + err.message, time: formatTime(new Date()) };
        chatHistory.push(em);
        appendAIMessage(em.content, em.time, '', true);
      }
      isLoading = false;
      abortController = null;
      updateSendBtn();
    }
  }

  function setupEvents () {
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('input', function() { updateSendBtn(); autoResize(); });
    messageInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) sendMessage(); }
    });
    settingsBtn.addEventListener('click', function() { settingsOpen ? closeSettings() : openSettings(); });
    settingsOverlay.addEventListener('click', function(e) { if (e.target === settingsOverlay) closeSettings(); });
    settingsHandle.addEventListener('click', closeSettings);
    saveSettingsBtn.addEventListener('click', saveSettings);
    cancelSettingsBtn.addEventListener('click', closeSettings);
    clearChatBtn.addEventListener('click', clearChat);
    modelSelectBtn.addEventListener('click', function(e) { e.stopPropagation(); modelDropdownOpen ? closeModelDropdown() : openModelDropdown(); });
    providerTrigger.addEventListener('click', function(e) { e.stopPropagation(); modelSelect_inSettings.classList.remove('open'); closeModelDropdown(); providerSelect.classList.toggle('open'); });
    modelTrigger.addEventListener('click', function(e) { e.stopPropagation(); providerSelect.classList.remove('open'); closeModelDropdown(); modelSelect_inSettings.classList.toggle('open'); });

    document.addEventListener('click', function(e) {
      if (modelDropdownOpen && !modelDropdown.contains(e.target) && e.target !== modelSelectBtn && !modelSelectBtn.contains(e.target)) closeModelDropdown();
      if (!providerSelect.contains(e.target) && e.target !== providerTrigger) providerSelect.classList.remove('open');
      if (!modelSelect_inSettings.contains(e.target) && e.target !== modelTrigger) modelSelect_inSettings.classList.remove('open');
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        if (settingsOpen) closeSettings();
        if (modelDropdownOpen) closeModelDropdown();
        providerSelect.classList.remove('open');
        modelSelect_inSettings.classList.remove('open');
        if (isLoading && abortController) { abortController.abort(); showToast('Generation cancelled', 'success'); }
      }
    });

    window.addEventListener('resize', scrollToBottom);
  }

  init();
  updateSendBtn();
  populateModelDropdownForChat();
  if (!currentConfig.apiKey) setTimeout(function() { settingDot.classList.add('visible'); }, 500);
})();
/* NeoWarp 扩展编辑器：Monaco 多标签 + AI 面板（逻辑在 ai-shared.js） */
(function () {
  'use strict';

  var P = window.ExtensionEditorPreload;

  // ── 多语言（编辑器部分；AI 面板文案在 ai-shared.js） ────────
  var STRINGS = {
    zh: {
      untitled: '未命名.js',
      save: '保存',
      saveAs: '另存为',
      addToProject: '添加到项目',
      addToMyExtensions: '添加到我的扩展',
      updateMyExtensions: '更新我的扩展',
      addedToMyExtensions: '已添加到我的扩展',
      updatedToMyExtensions: '我的扩展已更新',
      myExtFailed: '保存到我的扩展失败：',
      untitledProject: '未命名项目',
      noOpenProjects: '没有已打开的 Scratch 项目',
      adding: '正在添加…',
      added: '已添加到项目',
      addFailed: '添加失败：',
      cancel: '取消',
      newTab: '新建标签页 (Ctrl+T)',
      openFiles: '打开文件 (Ctrl+O)',
      saved: '已保存',
      saveFailed: '保存失败：',
      openFailed: '文件打开失败：',
      unsaved: '未保存',
      close: '关闭',
      renameFailed: '重命名失败：',
      emptyHint: '按 Ctrl+T 新建标签页，或 Ctrl+O 打开文件',
      inserted: '代码已插入编辑器',
      replaced: '已替换编辑器全部内容（Ctrl+Z 可撤销）',
      popout: '弹出为独立窗口',
      statusNotSaved: '尚未保存',
      spaces: '空格：',
      newFileTemplate: [
        '// NeoWarp 扩展模板',
        '(function (Scratch) {',
        '  \'use strict\';',
        '',
        '  class MyExtension {',
        '    getInfo () {',
        '      return {',
        '        id: \'myExtension\',',
        '        name: \'My Extension\',',
        '        blocks: [',
        '          {',
        '            opcode: \'hello\',',
        '            blockType: Scratch.BlockType.REPORTER,',
        '            text: \'你好\'',
        '          }',
        '        ]',
        '      };',
        '    }',
        '',
        '    hello () {',
        '      return \'Hello, NeoWarp!\';',
        '    }',
        '  }',
        '',
        '  Scratch.extensions.register(new MyExtension());',
        '})(Scratch);',
        ''
      ].join('\n')
    },
    en: {
      untitled: 'untitled.js',
      save: 'Save',
      saveAs: 'Save As',
      addToProject: 'Add to Project',
      addToMyExtensions: 'Add to My Extensions',
      updateMyExtensions: 'Update My Extension',
      addedToMyExtensions: 'Added to My Extensions',
      updatedToMyExtensions: 'My Extension updated',
      myExtFailed: 'Failed to save to My Extensions: ',
      untitledProject: 'Untitled project',
      noOpenProjects: 'No open Scratch projects',
      adding: 'Adding…',
      added: 'Added to project',
      addFailed: 'Failed to add: ',
      cancel: 'Cancel',
      newTab: 'New Tab (Ctrl+T)',
      openFiles: 'Open File (Ctrl+O)',
      saved: 'Saved',
      saveFailed: 'Save failed: ',
      openFailed: 'Failed to open file: ',
      unsaved: 'Unsaved',
      close: 'Close',
      renameFailed: 'Rename failed: ',
      emptyHint: 'Press Ctrl+T for a new tab, or Ctrl+O to open the file',
      inserted: 'Code inserted into editor',
      replaced: 'Editor content replaced (Ctrl+Z to undo)',
      popout: 'Pop out to separate window',
      statusNotSaved: 'Not saved yet',
      spaces: 'Spaces: ',
      newFileTemplate: [
        '// NeoWarp extension template',
        '(function (Scratch) {',
        '  \'use strict\';',
        '',
        '  class MyExtension {',
        '    getInfo () {',
        '      return {',
        '        id: \'myExtension\',',
        '        name: \'My Extension\',',
        '        blocks: [',
        '          {',
        '            opcode: \'hello\',',
        '            blockType: Scratch.BlockType.REPORTER,',
        '            text: \'hello\'',
        '          }',
        '        ]',
        '      };',
        '    }',
        '',
        '    hello () {',
        '      return \'Hello, NeoWarp!\';',
        '    }',
        '  }',
        '',
        '  Scratch.extensions.register(new MyExtension());',
        '})(Scratch);',
        ''
      ].join('\n')
    }
  };

  var lang = 'en';
  var strings = STRINGS.en;

  // ── 编辑器状态（多标签） ────────────────────────────────────
  var editor = null;
  // {id, path, name, model, viewState, dirty, myExtId}
  // myExtId：来自「我的扩展」右键编辑的标签，保存回对应条目
  var tabs = [];
  var activeTabId = null;
  var nextTabId = 1;
  var untitledCounter = 0;
  // 正在就地重命名的标签 id；null 表示没有进行中的重命名
  var renamingTabId = null;

  function $ (id) {
    return document.getElementById(id);
  }

  function activeTab () {
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].id === activeTabId) return tabs[i];
    }
    return null;
  }

  function makeUntitledName () {
    untitledCounter++;
    if (untitledCounter === 1) return strings.untitled;
    return strings.untitled.replace(/\.js$/, '') + '-' + untitledCounter + '.js';
  }

  /** 新建标签并激活；path 相同的已开文件只切换不重复打开。 */
  function createTab (options) {
    if (options.path) {
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].path === options.path) {
          activateTab(tabs[i].id);
          return tabs[i];
        }
      }
    }
    // 「我的扩展」来的内存文件按 myExtId 去重：未修改时刷新为最新代码，有改动则保留
    if (options.myExtId) {
      for (var j = 0; j < tabs.length; j++) {
        if (tabs[j].myExtId === options.myExtId) {
          var existing = tabs[j];
          activateTab(existing.id);
          if (!existing.dirty &&
              typeof options.content === 'string' &&
              existing.model.getValue() !== options.content) {
            existing.model.setValue(options.content);
            existing.dirty = false;
            renderTabsBar();
            updateTitle();
          }
          return existing;
        }
      }
    }
    var tab = {
      id: nextTabId++,
      path: options.path || null,
      name: options.name || makeUntitledName(),
      model: window.monaco.editor.createModel(options.content || '', 'javascript'),
      viewState: null,
      dirty: false,
      myExtId: options.myExtId || null
    };
    tabs.push(tab);
    activateTab(tab.id);
    return tab;
  }

  function activateTab (id) {
    var previous = activeTab();
    if (previous && editor && previous.id !== id) {
      previous.viewState = editor.saveViewState();
    }
    activeTabId = id;
    var tab = activeTab();
    if (editor && tab) {
      editor.setModel(tab.model);
      if (tab.viewState) {
        editor.restoreViewState(tab.viewState);
      }
      editor.focus();
    }
    renderTabsBar();
    updateTitle();
    updateStatusPath();
    updateMyExtButtonLabel();
    updateEditorEmptyState();
  }

  /** 没有任何标签时在编辑器区域显示空状态提示 */
  function updateEditorEmptyState () {
    var empty = !tabs.length;
    $('editor-empty').classList.toggle('hidden', !empty);
    if (empty && $('editor-empty-text').textContent === '') {
      $('editor-empty-text').textContent = strings.emptyHint;
    }
  }

  function closeTab (id) {
    var tab = null;
    var index = -1;
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].id === id) { tab = tabs[i]; index = i; break; }
    }
    if (!tab) return;

    var doClose = function () {
      tab.model.dispose();
      tabs.splice(index, 1);
      if (!tabs.length) {
        // 全部关闭后保留空编辑器，不再自动新建文件
        activeTabId = null;
        if (editor) editor.setModel(null);
        renderTabsBar();
        updateTitle();
        updateStatusPath();
        updateMyExtButtonLabel();
        updateEditorEmptyState();
        return;
      }
      if (activeTabId === id) {
        activateTab(tabs[Math.max(0, index - 1)].id);
      } else {
        renderTabsBar();
      }
    };

    if (!tab.dirty) {
      doClose();
      return;
    }
    P.confirmClose(tab.name).then(function (choice) {
      if (choice === 'cancel') return;
      if (choice === 'discard') {
        doClose();
        return;
      }
      // 'save'：保存成功才关闭
      saveTab(tab).then(function (saved) {
        if (saved) doClose();
      });
    });
  }

  /** 渲染标签栏 DOM */
  function renderTabsBar () {
    var bar = $('tabs-bar');
    bar.innerHTML = '';
    tabs.forEach(function (tab) {
      var el = document.createElement('div');
      el.className = 'file-tab' + (tab.id === activeTabId ? ' active' : '') + (tab.dirty ? ' dirty' : '');
      el.title = tab.path || tab.name;

      var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('class', 'file-icon');
      var iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      iconPath.setAttribute('d', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 3.5 18.5 8H14V3.5z');
      iconPath.setAttribute('fill', '#e8d44d');
      icon.appendChild(iconPath);

      var name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = tab.name;

      var dirtyDot = document.createElement('span');
      dirtyDot.className = 'tab-dirty';
      dirtyDot.title = strings.unsaved;

      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'tab-close';
      closeBtn.textContent = '×';
      closeBtn.title = strings.close;
      closeBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        closeTab(tab.id);
      });

      // 双击标签名进入就地重命名
      name.addEventListener('dblclick', function (event) {
        event.stopPropagation();
        startRename(tab);
      });

      if (tab.id === renamingTabId) {
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'tab-rename-input';
        input.value = tab.name;
        input.spellcheck = false;
        input.addEventListener('keydown', function (event) {
          event.stopPropagation();
          if (event.key === 'Enter') {
            finishRename(tab, input.value, true);
          } else if (event.key === 'Escape') {
            finishRename(tab, input.value, false);
          }
        });
        input.addEventListener('blur', function () {
          finishRename(tab, input.value, true);
        });
        input.addEventListener('input', function () {
          input.style.width = Math.max(4, input.value.length) + 'ch';
        });
        el.appendChild(icon);
        el.appendChild(input);
        el.appendChild(dirtyDot);
        el.appendChild(closeBtn);
        // 让输入框先完成挂载再聚焦选中
        setTimeout(function () {
          input.focus();
          input.select();
        }, 0);
        bar.appendChild(el);
        return;
      }

      el.appendChild(icon);
      el.appendChild(name);
      el.appendChild(dirtyDot);
      el.appendChild(closeBtn);
      el.addEventListener('click', function () {
        if (activeTabId !== tab.id) activateTab(tab.id);
      });
      bar.appendChild(el);
    });
  }

  function markActiveTabDirty () {
    var tab = activeTab();
    if (!tab || tab.dirty) return;
    tab.dirty = true;
    renderTabsBar();
    updateTitle();
  }

  // ── 双击标签名就地重命名 ────────────────────────────────────
  function startRename (tab) {
    if (renamingTabId !== null) return;
    renamingTabId = tab.id;
    renderTabsBar();
  }

  /**
   * 结束重命名。commit 为 false（Esc）或名字未变化时直接还原。
   * 已关联磁盘文件的标签在主进程重命名文件；未命名的内存标签只改标签名；
   * 来自「我的扩展」的标签同时更新对应条目的名字。
   */
  function finishRename (tab, rawName, commit) {
    if (renamingTabId !== tab.id) return;
    renamingTabId = null;
    var newName = (rawName || '').trim();
    if (!commit || !newName || newName === tab.name) {
      renderTabsBar();
      return;
    }
    if (!/\.js$/i.test(newName)) {
      newName += '.js';
    }
    if (newName === tab.name) {
      renderTabsBar();
      return;
    }
    if (tab.path) {
      P.rename(tab.path, newName).then(function (result) {
        if (result && !result.error) {
          tabs.forEach(function (other) {
            if (other.path === tab.path) {
              other.path = result.path;
              other.name = result.name;
            }
          });
        } else {
          showToast(strings.renameFailed + ((result && result.error) || ''));
        }
        renderTabsBar();
        updateTitle();
        updateStatusPath();
      });
      return;
    }
    tab.name = newName;
    if (tab.myExtId) {
      // 同步更新「我的扩展」条目名（代码不变）
      P.addToMyExtensions(tab.myExtId, newName.replace(/\.js$/i, '') || newName, tab.model.getValue());
    }
    renderTabsBar();
    updateTitle();
    updateStatusPath();
  }

  // ── Toast ───────────────────────────────────────────────────
  var toastTimer = null;
  function showToast (message) {
    var toast = $('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('visible');
    }, 2600);
  }

  // ── 初始化 ──────────────────────────────────────────────────
  P.getInitial().then(function (initial) {
    lang = (initial.locale || 'en').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
    strings = STRINGS[lang];
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    applyStrings();
    initEditor(initial);
    initAiPanel();
  }).catch(function (error) {
    document.body.textContent = 'Failed to initialize: ' + error;
  });

  function applyStrings () {
    $('btn-add-to-project-label').textContent = strings.addToProject;
    $('btn-add-to-project').title = strings.addToProject;
    updateMyExtButtonLabel();
    $('project-picker-title').textContent = strings.addToProject;
    $('project-picker-cancel').textContent = strings.cancel;
    $('btn-save-label').textContent = strings.save;
    $('btn-save-as-label').textContent = strings.saveAs;
    $('btn-save').title = strings.save + ' (Ctrl+S)';
    $('btn-save-as').title = strings.saveAs + ' (Ctrl+Shift+S)';
    $('btn-new-tab').title = strings.newTab;
    $('btn-open-file').title = strings.openFiles;
    $('ai-popout-btn').title = strings.popout;
    $('activity-ai').title = 'AI';
    $('status-lang').textContent = 'JavaScript';
    $('status-indent').textContent = strings.spaces + '2';
    $('status-cursor').textContent = 'Ln 1, Col 1';
  }

  // ── 标题 / 状态栏 ───────────────────────────────────────────
  function updateTitle () {
    var tab = activeTab();
    if (!tab) {
      document.title = 'NeoWarp';
      return;
    }
    document.title = tab.name + (tab.dirty ? ' •' : '');
  }

  function updateStatusPath () {
    var tab = activeTab();
    $('status-path').textContent = tab ? ((tab && tab.path) || strings.statusNotSaved) : '';
  }

  // ── Monaco ──────────────────────────────────────────────────
  function initEditor (initial) {
    window.require.config({paths: {vs: './vs'}});
    window.require(['vs/editor/editor.main'], function () {
      // 首个标签：外部传入的文件，或新文件模板
      if (initial.file) {
        createTab({
          path: initial.file.path,
          name: initial.file.name,
          content: initial.file.content,
          myExtId: initial.file.myExtId || null
        });
      } else {
        if (initial.error) {
          showToast(strings.openFailed + initial.error);
        }
        createTab({content: strings.newFileTemplate});
      }

      editor = window.monaco.editor.create($('editor-container'), {
        model: activeTab().model,
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        fontFamily: 'Consolas, "Courier New", monospace',
        tabSize: 2,
        insertSpaces: true,
        minimap: {enabled: true},
        renderIndentGuides: true,
        scrollBeyondLastLine: false,
        padding: {top: 8}
      });

      editor.addCommand(window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.KeyS, saveFile);
      editor.addCommand(
        window.monaco.KeyMod.CtrlCmd | window.monaco.KeyMod.Shift | window.monaco.KeyCode.KeyS,
        saveFileAs
      );

      editor.onDidChangeModelContent(function () {
        markActiveTabDirty();
      });
      editor.onDidChangeCursorPosition(function (e) {
        $('status-cursor').textContent = 'Ln ' + e.position.lineNumber + ', Col ' + e.position.column;
      });
      editor.focus();
    });
  }

  // Monaco 自带查找控件；焦点在 AI 面板等处时把常用快捷键也路由过去
  document.addEventListener('keydown', function (event) {
    var key = (event.key || '').toLowerCase();
    if (!(event.ctrlKey || event.metaKey)) return;
    if (key === 's') {
      event.preventDefault();
      if (event.shiftKey) {
        saveFileAs();
      } else {
        saveFile();
      }
    } else if (key === 'f' && editor) {
      event.preventDefault();
      editor.getAction('actions.find').run();
    } else if (key === 'o') {
      event.preventDefault();
      openFilesViaDialog();
    } else if (key === 't') {
      event.preventDefault();
      createTab({content: strings.newFileTemplate});
    } else if (key === 'w') {
      event.preventDefault();
      if (activeTabId !== null) closeTab(activeTabId);
    } else if (key === 'tab' && tabs.length > 1) {
      event.preventDefault();
      cycleTab(event.shiftKey ? -1 : 1);
    }
  });

  function cycleTab (direction) {
    var index = tabs.findIndex(function (tab) { return tab.id === activeTabId; });
    if (index === -1) return;
    var next = (index + direction + tabs.length) % tabs.length;
    activateTab(tabs[next].id);
  }

  $('btn-save').addEventListener('click', saveFile);
  $('btn-save-as').addEventListener('click', saveFileAs);
  $('btn-new-tab').addEventListener('click', function () {
    createTab({content: strings.newFileTemplate});
  });
  $('btn-open-file').addEventListener('click', openFilesViaDialog);

  // ── 添加到项目 / 添加到我的扩展 ─────────────────────────────
  // 两个按钮的显隐都跟随已打开的 Scratch 编辑器（主进程在编辑器开/关时广播；
  // SOLO 的后台宿主不在列表里，不算数——「我的扩展」数据也存放在编辑器里）
  function updateProjectButtons (projects) {
    var has = !!(projects && projects.length);
    $('btn-add-to-project').classList.toggle('hidden', !has);
    $('btn-add-to-my-extensions').classList.toggle('hidden', !has);
  }
  P.listProjects().then(updateProjectButtons).catch(function () {});
  P.onProjectsChanged(updateProjectButtons);

  // 当前标签来自「我的扩展」时按钮变为「更新我的扩展」
  function updateMyExtButtonLabel () {
    var tab = activeTab();
    var isUpdate = !!(tab && tab.myExtId);
    var label = isUpdate ? strings.updateMyExtensions : strings.addToMyExtensions;
    $('btn-add-to-my-extensions-label').textContent = label;
    $('btn-add-to-my-extensions').title = label;
  }

  $('btn-add-to-project').addEventListener('click', openProjectPicker);
  $('btn-add-to-my-extensions').addEventListener('click', addToMyExtensions);
  $('project-picker-cancel').addEventListener('click', function () {
    showProjectPicker(false);
  });
  $('project-picker-backdrop').addEventListener('click', function () {
    showProjectPicker(false);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      showProjectPicker(false);
    }
  });

  function showProjectPicker (visible) {
    $('project-picker').classList.toggle('hidden', !visible);
  }

  function projectDisplayName (project) {
    return project.title || strings.untitledProject;
  }

  function renderProjectPickerList (projects) {
    var list = $('project-picker-list');
    list.innerHTML = '';
    projects.forEach(function (project) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'picker-item';
      item.title = projectDisplayName(project);

      var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      var iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      iconPath.setAttribute('d', 'M21 3H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H3V5h18v14z');
      icon.appendChild(iconPath);

      var name = document.createElement('span');
      name.className = 'picker-item-name';
      name.textContent = projectDisplayName(project);

      item.appendChild(icon);
      item.appendChild(name);
      item.addEventListener('click', function () {
        addActiveTabToProject(project);
      });
      list.appendChild(item);
    });
  }

  function openProjectPicker () {
    P.listProjects().then(function (projects) {
      projects = projects || [];
      if (!projects.length) {
        showToast(strings.noOpenProjects);
        return;
      }
      renderProjectPickerList(projects);
      showProjectPicker(true);
    });
  }

  function showPickerLoading () {
    var list = $('project-picker-list');
    list.innerHTML = '';
    var row = document.createElement('div');
    row.className = 'picker-loading';
    var spinner = document.createElement('div');
    spinner.className = 'picker-spinner';
    var text = document.createElement('span');
    text.textContent = strings.adding;
    row.appendChild(spinner);
    row.appendChild(text);
    list.appendChild(row);
  }

  function addActiveTabToProject (project) {
    var tab = activeTab();
    if (!tab) {
      showProjectPicker(false);
      return;
    }
    showPickerLoading();
    P.addToProject(project.id, tab.name, tab.model.getValue()).then(function (result) {
      showProjectPicker(false);
      if (result && result.success) {
        showToast(strings.added);
      } else {
        showToast(strings.addFailed + ((result && result.error) || ''));
      }
    }).catch(function (error) {
      showProjectPicker(false);
      showToast(strings.addFailed + error);
    });
  }

  // 把当前标签代码写入「我的扩展」；标签来自「我的扩展」时为更新对应条目，
  // 成功后把返回的条目 id 记到标签上，后续再点就是更新而不是重复新增
  function addToMyExtensions () {
    var tab = activeTab();
    if (!tab) return;
    var isUpdate = !!tab.myExtId;
    var name = tab.name.replace(/\.js$/i, '') || tab.name;
    P.addToMyExtensions(tab.myExtId || null, name, tab.model.getValue()).then(function (result) {
      if (result && result.success) {
        if (!isUpdate && result.data && result.data.id) {
          tab.myExtId = result.data.id;
          updateMyExtButtonLabel();
        }
        showToast(isUpdate ? strings.updatedToMyExtensions : strings.addedToMyExtensions);
      } else {
        showToast(strings.myExtFailed + ((result && result.error) || ''));
      }
    }).catch(function (error) {
      showToast(strings.myExtFailed + error);
    });
  }

  function openFilesViaDialog () {
    P.openDialog().then(function (files) {
      if (!files) return;
      addFileTabs(files);
    });
  }

  /** 把读取到的文件数组开成标签；读失败的提示原因。 */
  function addFileTabs (files) {
    files.forEach(function (file) {
      if (file.error) {
        showToast(strings.openFailed + file.error);
        return;
      }
      createTab({path: file.path, name: file.name, content: file.content});
    });
  }

  /** 「我的扩展」右键「编辑」投送来的内存文件（无磁盘路径，带 myExtId）。 */
  function addMemoryFileTab (file) {
    if (!file) return;
    createTab({
      name: file.name,
      content: file.content,
      myExtId: file.myExtId || null
    });
  }

  // 外部路由（双击 .js / 主页「从文件中打开」）投送过来的文件
  P.onOpenPaths(function (files) {
    addFileTabs(files || []);
  });

  P.onOpenMemoryFiles(addMemoryFileTab);

  /**
   * 保存指定标签；成功返回 true 并更新标签的路径/文件名/脏标记。
   * @returns {Promise<boolean>}
   */
  function saveTab (tab) {
    if (!tab) return Promise.resolve(false);
    var content = tab.model.getValue();
    var request = tab.path ? P.save(tab.path, content) : P.saveAs(tab.name, content);
    return request.then(function (result) {
      if (result === null) return false; // 用户取消
      if (result.error) {
        showToast(strings.saveFailed + result.error);
        return false;
      }
      tab.path = result.path;
      tab.name = result.name;
      tab.dirty = false;
      renderTabsBar();
      updateTitle();
      updateStatusPath();
      showToast(strings.saved);
      return true;
    });
  }

  function saveFile () {
    saveTab(activeTab());
  }

  function saveFileAs () {
    var tab = activeTab();
    if (!tab) return;
    P.saveAs(tab.name, tab.model.getValue()).then(function (result) {
      if (result === null) return;
      if (result.error) {
        showToast(strings.saveFailed + result.error);
        return;
      }
      tab.path = result.path;
      tab.name = result.name;
      tab.dirty = false;
      renderTabsBar();
      updateTitle();
      updateStatusPath();
      showToast(strings.saved);
    });
  }

  function insertIntoEditor (code) {
    if (!editor) return;
    var selection = editor.getSelection();
    editor.executeEdits('ai-insert', [{
      range: selection,
      text: code,
      forceMoveMarkers: true
    }]);
    editor.focus();
    showToast(strings.inserted);
  }

  /** 用 AI 生成的代码替换当前标签全部内容（走 Monaco 编辑事务，Ctrl+Z 可撤销） */
  function replaceIntoEditor (code) {
    if (!editor || !editor.getModel()) return;
    editor.executeEdits('ai-replace', [{
      range: editor.getModel().getFullModelRange(),
      text: code,
      forceMoveMarkers: true
    }]);
    editor.focus();
    showToast(strings.replaced);
  }

  // ── AI 面板（逻辑在 ai-shared.js；此处负责停靠/弹出接线） ───
  var aiPanel = null;
  var aiPoppedOut = false;

  function initAiPanel () {
    aiPanel = window.createNeoWarpAiPanel({
      lang: lang,
      getCode: function () {
        var tab = activeTab();
        return tab ? {name: tab.name, content: tab.model.getValue()} : null;
      },
      insertCode: insertIntoEditor,
      replaceCode: replaceIntoEditor,
      settingsApi: {
        getConfigs: P.getAiModelConfigs,
        saveActive: function (activeId, configs) {
          return P.saveAiModelConfigs({configs: configs, activeId: activeId});
        },
        onChanged: P.onAiModelConfigsChanged,
        openSettings: P.openDesktopSettings
      }
    });

    $('activity-ai').addEventListener('click', function () {
      if (aiPoppedOut) {
        // 已弹出时点击侧栏图标：聚焦独立窗口
        P.popoutAi(null);
        return;
      }
      toggleAiPanel();
    });
    $('ai-close-btn').addEventListener('click', toggleAiPanel);
    $('ai-popout-btn').addEventListener('click', popoutAi);

    // 独立窗口关闭（含点「恢复停靠」）：把聊天状态带回来并重新停靠
    P.onPopoutClosed(function (state) {
      aiPoppedOut = false;
      $('activity-ai').classList.remove('popped-out');
      if (state) {
        aiPanel.setState(state);
      }
      setAiPanelOpen(true);
    });

    // 独立窗口请求当前代码 / 插入代码 / 替换全文的中继
    P.onEditorRequest(function (data) {
      if (!data) return;
      var result = null;
      if (data.type === 'get-code') {
        var tab = activeTab();
        result = tab ? {name: tab.name, content: tab.model.getValue()} : null;
      } else if (data.type === 'insert-code') {
        insertIntoEditor(data.payload);
        result = true;
      } else if (data.type === 'replace-code') {
        replaceIntoEditor(data.payload);
        result = true;
      }
      P.sendEditorResponse(data.requestId, result);
    });
  }

  // 面板开合走宽度过渡（.closed），同时同步活动栏高亮
  function setAiPanelOpen (open) {
    $('ai-panel').classList.toggle('closed', !open);
    $('activity-ai').classList.toggle('active', open);
  }

  function toggleAiPanel () {
    setAiPanelOpen($('ai-panel').classList.contains('closed'));
  }

  function popoutAi () {
    if (aiPoppedOut) {
      P.popoutAi(null);
      return;
    }
    aiPoppedOut = true;
    // 聊天状态随交接传给独立窗口
    P.popoutAi(aiPanel.getState());
    setAiPanelOpen(false);
    $('activity-ai').classList.remove('active');
    $('activity-ai').classList.add('popped-out');
  }
})();

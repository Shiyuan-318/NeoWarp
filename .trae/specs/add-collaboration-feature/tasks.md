# Tasks

- [x] Task 1: 注册 `tw-collaboration` 协议与窗口基础设施
  - [x] SubTask 1.1: 在 `src-main/protocols.js` 中注册 `tw-collaboration` 协议，指向 `src-renderer/collaboration`
  - [x] SubTask 1.2: 创建 `src-main/windows/collaboration.js`，实现 `CollaborationWindow` 类（继承 `AbstractWindow`），提供 `showHost(editorWindow)` 与 `showJoin(editorWindow)` 静态方法
  - [x] SubTask 1.3: 创建 `src-preload/collaboration.js`，通过 `contextBridge` 暴露协作 IPC API
  - [x] SubTask 1.4: 创建 `src-renderer/collaboration/collaboration.html`、`collaboration.css`、`collaboration.js` 基础页面骨架

- [x] Task 2: 实现协作服务端逻辑（发起者）
  - [x] SubTask 2.1: 创建 `src-main/collaboration-server.js`，实现基于 `http` + 原生 WebSocket 协议的协作服务器类 `CollaborationServer`，支持启动监听、密码校验、客户端管理、消息广播
  - [x] SubTask 2.2: 在 `CollaborationServer` 中实现权限配置项（allowAddExtension、allowDeleteExtension、allowDeleteSprite 等）的存储与下发
  - [x] SubTask 2.3: 在 `CollaborationServer` 中实现端口占用检测与启动失败回调
  - [x] SubTask 2.4: 在 `CollaborationServer` 中实现结束协作时关闭服务器并通知所有客户端的逻辑

- [x] Task 3: 实现协作客户端逻辑（参与者）
  - [x] SubTask 3.1: 在 `CollaborationWindow` 中实现 WebSocket 客户端连接逻辑，支持 IP:端口 + 密码连接
  - [x] SubTask 3.2: 处理连接成功、密码错误、连接失败的回传状态
  - [x] SubTask 3.3: 实现接收服务端广播消息（聊天、状态变更、协作结束通知）的分发

- [x] Task 4: 在 `EditorWindow` 中接入协作 IPC 与状态管理
  - [x] SubTask 4.1: 在 `src-main/windows/editor.js` 中新增 `open-collaboration-host`、`open-collaboration-join`、`end-collaboration`、`leave-collaboration` IPC 处理器
  - [x] SubTask 4.2: 在 `EditorWindow` 中维护协作状态字段（isCollaborating、role、onlineCount、permissions）并通过 `webContents.send` 推送状态变更给渲染层
  - [x] SubTask 4.3: 在 `src-preload/editor.js` 中暴露 `openCollaborationHost`、`openCollaborationJoin`、`endCollaboration`、`leaveCollaboration`、`onCollaborationStateChange` 等 API

- [x] Task 5: 实现"更多"菜单下的协作子菜单入口
  - [x] SubTask 5.1: 在 `node_modules/scratch-gui/src/components/menu-bar/menu-bar.jsx` 的"更多"菜单中新增协作菜单项
  - [x] SubTask 5.2: 新增 `onClickCollaborationHost`、`onClickCollaborationJoin` props 与对应 handle 方法
  - [x] SubTask 5.3: 在 `src-renderer-webpack/editor/gui/desktop-hoc.jsx` 中传递 `onClickCollaborationHost`、`onClickCollaborationJoin` 及协作状态 props
  - [x] SubTask 5.4: 实现协作中按钮文字切换逻辑（"发起协作"→"结束协作"、"加入协作"→"退出协作"），依据 `collaborationState` prop

- [x] Task 6: 实现协作状态顶栏显示
  - [x] SubTask 6.1: 在 menu-bar.jsx 顶栏最左侧新增协作状态显示区域，发起者显示"协作中-管理员-在线人数 : N"，参与者显示"协作中-参与者"
  - [x] SubTask 6.2: 点击该状态区域调用打开聊天区回调（`onClickCollaborationChat`）
  - [x] SubTask 6.3: 非协作状态下隐藏该区域

- [x] Task 7: 实现发起协作设置界面
  - [x] SubTask 7.1: 在 `src-renderer/collaboration/collaboration.html` 与 `collaboration.js` 中实现"发起协作"模式界面：密码输入、端口输入、权限勾选项（添加扩展/删除扩展/删除角色等）、发起按钮
  - [x] SubTask 7.2: 发起成功后界面切换为"协作进行中"管理视图，展示在线人数与"结束协作"按钮
  - [x] SubTask 7.3: 发起失败时显示错误提示（端口占用/密码为空）

- [x] Task 8: 实现加入协作界面
  - [x] SubTask 8.1: 在协作窗口的"加入"模式界面实现：IP 输入、密码输入、加入按钮
  - [x] SubTask 8.2: 加入成功后切换为"协作进行中（参与者）"视图，显示"退出协作"按钮
  - [x] SubTask 8.3: 加入失败时显示错误提示（密码错误/无法连接）

- [x] Task 9: 实现 iOS 风格聊天区
  - [x] SubTask 9.1: 在协作窗口中实现聊天消息列表，参考 iOS 风格（圆角气泡、本人右侧、他人左侧、毛玻璃背景、时间戳）
  - [x] SubTask 9.2: 实现消息输入框与发送按钮，发送后通过 WebSocket 广播
  - [x] SubTask 9.3: 实现接收消息的渲染（区分发送者标识）
  - [x] SubTask 9.4: 实现系统消息（加入/离开/结束协作）的样式区分

- [x] Task 10: 实现协作者权限控制
  - [x] SubTask 10.1: 参与者执行受限操作时（删除角色、添加/删除扩展等），由渲染层拦截并提示"无权限执行此操作"
  - [x] SubTask 10.2: 发起者本地操作不受权限限制

# Task Dependencies
- Task 2、Task 3 依赖 Task 1
- Task 4 依赖 Task 1、Task 2、Task 3
- Task 5 依赖 Task 4
- Task 6 依赖 Task 4、Task 5
- Task 7、Task 8 依赖 Task 1、Task 4
- Task 9 依赖 Task 1、Task 4
- Task 10 依赖 Task 2、Task 4

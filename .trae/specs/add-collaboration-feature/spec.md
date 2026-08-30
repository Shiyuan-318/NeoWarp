# 协作功能 (Collaboration Feature) Spec

## Why
NeoWarp 当前仅支持单机编辑，缺少多人协作能力。通过内网（LAN）实现"发起者-参与者"模式的实时协作，可以让多人在同一项目上协同编辑、聊天交流，显著提升团队创作效率。

## What Changes
- 在编辑器顶栏"更多"下拉菜单下新增"协作"入口，包含两个子菜单项："加入协作"、"发起协作"
- 新增协作主进程窗口 `CollaborationWindow`（基于 `AbstractWindow`），承载协作服务端/客户端逻辑与聊天 UI
- 新增 `tw-collaboration` 自定义协议与对应的渲染层（HTML/CSS/JS）
- 新增 preload 脚本暴露协作相关 IPC API
- 在 `EditorWindow` 中新增 IPC 处理器：`open-collaboration-host`、`open-collaboration-join`、`end-collaboration`、`leave-collaboration`
- 发起协作时在主进程启动 HTTP + WebSocket 服务器（监听指定端口），管理参与者连接、权限校验、消息广播
- 加入协作时作为 WebSocket 客户端连接到目标 IP:端口
- 协作状态下顶栏左侧显示状态标识；点击进入聊天区
- 聊天区 UI 参考 iOS 风格（圆角气泡、左右分列、毛玻璃背景）
- 发起者菜单按钮变为"结束协作"；参与者按钮变为"退出协作"

## Impact
- Affected code:
  - `src-main/windows/editor.js`（新增 IPC 处理器与协作状态管理）
  - `src-main/windows/abstract.js`（可能复用窗口管理）
  - `src-main/protocols.js`（新增 `tw-collaboration` 协议）
  - `src-main/entrypoint.js`（注册新窗口/协议）
  - `src-preload/editor.js`（暴露协作 IPC API）
  - `src-renderer-webpack/editor/gui/desktop-hoc.jsx`（传递协作相关 props 与顶栏状态）
  - `node_modules/scratch-gui/src/components/menu-bar/menu-bar.jsx`（新增菜单项与状态显示；**需通过 patch 或运行时注入**）
  - 新增 `src-main/windows/collaboration.js`
  - 新增 `src-preload/collaboration.js`
  - 新增 `src-renderer/collaboration/`（HTML/CSS/JS）
  - 新增 `src-main/collaboration-server.js`（WebSocket 服务端逻辑）

## ADDED Requirements

### Requirement: 协作入口菜单
系统 SHALL 在编辑器顶栏"更多"下拉菜单中提供"协作"入口，该入口 SHALL 包含两个子菜单项："发起协作"与"加入协作"。

#### Scenario: 未处于协作状态
- **WHEN** 用户打开"更多"菜单
- **THEN** 可见"协作"项，展开后可见"发起协作"与"加入协作"两个子项

#### Scenario: 发起者协作中
- **WHEN** 发起者已成功发起协作
- **THEN** 原"协作"按钮文字变为"结束协作"，点击后结束协作并恢复原菜单

#### Scenario: 参与者协作中
- **WHEN** 参与者已成功加入协作
- **THEN** 原"协作"按钮文字变为"退出协作"，点击后退出协作并恢复原菜单

### Requirement: 发起协作
系统 SHALL 允许用户发起协作，发起时需设置：密码、端口号、协作者权限（至少包含：是否允许添加扩展、删除扩展、删除角色）。

#### Scenario: 发起协作成功
- **WHEN** 用户填写密码、端口（可用且未被占用）、权限配置后点击发起
- **THEN** 系统在本地启动 WebSocket 服务器监听该端口，用户成为"管理员（发起者）"，顶栏左侧显示"协作中-管理员-在线人数 : N"

#### Scenario: 端口被占用
- **WHEN** 用户填写的端口号已被占用
- **THEN** 系统提示"端口被占用，请更换端口"，不启动协作

#### Scenario: 密码为空
- **WHEN** 用户未填写密码即点击发起
- **THEN** 系统阻止发起并提示"请设置密码"

### Requirement: 加入协作
系统 SHALL 允许用户通过输入目标 IP 与密码加入局域网内已发起的协作。

#### Scenario: 加入成功
- **WHEN** 用户输入正确 IP、密码并点击加入
- **THEN** 系统作为客户端连接到目标 WebSocket 服务器，用户成为"参与者"，顶栏左侧显示"协作中-参与者"

#### Scenario: 密码错误
- **WHEN** 用户输入的密码与服务端不符
- **THEN** 系统提示"密码错误，加入失败"

#### Scenario: 无法连接
- **WHEN** 目标 IP 不可达或端口未开放
- **THEN** 系统提示"无法连接到目标主机"

### Requirement: 协作者权限控制
系统 SHALL 根据发起者设置的权限，限制参与者的部分操作（添加扩展、删除扩展、删除角色等）。

#### Scenario: 参与者被禁止删除角色
- **WHEN** 发起者未授予"删除角色"权限，参与者尝试删除角色
- **THEN** 操作被拦截并向参与者提示"无权限执行此操作"

#### Scenario: 参与者被允许添加扩展
- **WHEN** 发起者授予"添加扩展"权限，参与者尝试添加扩展
- **THEN** 操作正常执行

### Requirement: 协作状态顶栏显示
系统 SHALL 在协作进行中于顶栏最左侧显示协作状态标识。

#### Scenario: 发起者状态显示
- **WHEN** 发起者处于协作中
- **THEN** 顶栏最左侧显示"协作中-管理员-在线人数 : N"，N 为实时在线人数

#### Scenario: 参与者状态显示
- **WHEN** 参与者处于协作中
- **THEN** 顶栏最左侧显示"协作中-参与者"

### Requirement: 聊天区（iOS 风格）
系统 SHALL 在协作中提供聊天功能，点击顶栏协作状态按钮打开聊天区，UI 参考 iOS 风格（圆角气泡、左右分列、毛玻璃背景）。

#### Scenario: 发送消息
- **WHEN** 用户在聊天区输入文本并发送
- **THEN** 消息以右侧气泡显示，并广播给所有协作者

#### Scenario: 接收消息
- **WHEN** 收到其他协作者发送的消息
- **THEN** 消息以左侧气泡显示，包含发送者标识

### Requirement: 结束/退出协作
系统 SHALL 提供结束（发起者）与退出（参与者）协作的能力。

#### Scenario: 发起者结束协作
- **WHEN** 发起者点击"结束协作"
- **THEN** 关闭 WebSocket 服务器，断开所有参与者连接，通知所有参与者协作已结束，本地恢复为非协作状态

#### Scenario: 参与者退出协作
- **WHEN** 参与者点击"退出协作"
- **THEN** 断开与服务端的连接，本地恢复为非协作状态，发起端在线人数减一

#### Scenario: 发起者结束协作时通知参与者
- **WHEN** 发起者结束协作
- **THEN** 所有参与者收到"协作已结束"通知并被退出协作状态

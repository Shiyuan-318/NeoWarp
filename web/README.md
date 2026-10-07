# NeoWarp 网页版（Web Runtime）

把 NeoWarp（基于 TurboWarp 二次开发的 Scratch 桌面应用）搬到浏览器里直接使用，
功能与桌面离线版保持一致。本目录是网页版的**全部改造层源码**，不改动桌面版原有代码。

## 目录结构

```
web/
├─ build.mjs              构建脚本（生成可部署的静态站点）
├─ src/
│  ├─ core/               运行时核心（宿主层 + RPC + 存储 + 远程通道）
│  │  ├─ 00-util.js       通用工具（路径解析、toast、剪贴板…）
│  │  ├─ 10-rpc.js        同源 postMessage RPC + BroadcastChannel 跨标签页通道
│  │  ├─ 20-storage.js    IndexedDB（待处理文件 / 虚拟文件系统 / 最近项目句柄）
│  │  ├─ 30-host.js       能力宿主（原 Electron 主进程职责的浏览器等价物）
│  │  ├─ 35-extepop.js    扩展弹窗桥接
│  │  ├─ 36-app-windows.js 应用路由表（主页/编辑器共用的窗口清单）
│  │  ├─ 40-window-manager.js 页内浮层窗口管理器
│  │  ├─ 50-dispatch.js   全局分发
│  │  ├─ 50-remote.js     远程通道：MQTT 信令 + WebRTC datachannel（P2P）
│  │  ├─ 51-remote-bridge.js 协作素材注入 + 手机远控请求网关
│  │  └─ 52-phone-sync.js AI 手机远控宿主（电脑端）
│  ├─ shims/              各页面的 preload 兼容层（把 Electron preload API 映射到宿主 RPC）
│  └─ pwa/                Service Worker / manifest / 部署头
├─ remote-src/            手机端「观看舞台」页面（构建时输出到 remote/index.html）
└─ vendor/                离线依赖：mqtt.min.js、qrcode.min.js
```

## 构建

网页版复用 scratch-gui 的 webpack 产物作为编辑器主体，构建时把它与 `web/` 下的改造层组装到一起：

```bash
# 1) 先构建 GUI（仓库根目录）
npm ci
npm run webpack:prod        # 产物：dist-renderer-webpack/editor

# 2) 组装网页版静态站点
node web/build.mjs --gui dist-renderer-webpack/editor --out dist-web
```

参数说明：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--gui` | `dist-renderer-webpack/editor` | scratch-gui 产物目录，兼容 `<dir>/gui/index.js` 与 `<dir>/index.js` 两种布局 |
| `--out` | `dist-web` | 输出目录（会先清空） |
| `--version` | 时间戳 | 写入 `version.json`，用于绕过 Service Worker 缓存 |

> 注意：`--gui` 指向的目录不能位于 `--out` 之内，否则会被清空。

产物结构：

```
dist-web/
├─ index.html                  主页
├─ gui/                        编辑器（GUI bundle + 注入的 shim）
├─ ai/、extension-editor/、image-editor/、desktop-settings/…
├─ mobile-preview/、task-manager/、todo-list/、project-analysis/…
├─ remote/index.html           手机端观看舞台页
├─ assets/
│  ├─ nw-core.js               运行时核心（core/*.js 合并）
│  ├─ shims/*.js               各页面 preload 兼容层
│  └─ vendor/                  mqtt / qrcode 本地依赖
├─ sw.js、pwa.js、manifest.webmanifest
└─ _headers
```

## 部署

产物是纯静态站点，可直接托管在任意静态服务器 / CDN 上。仓库使用 `gh-pages` 分支：

```bash
node web/build.mjs --gui dist-renderer-webpack/editor --out dist-web
# 将 dist-web/ 内容推到 gh-pages 分支根目录
```

## 网页版与桌面版的对应关系

桌面版依赖 Electron 主进程 / preload 的能力，在网页版里统一替换为「宿主层 + RPC」：

| 桌面版 | 网页版等价实现 |
| --- | --- |
| Electron 主进程 IPC | 同源 `postMessage` RPC（`NW.host` / `NW.rpc`） |
| 多 BrowserWindow | 主页入口开独立标签页；设置等轻量面板用页内浮层窗口 |
| 本地文件读写 | File System Access API + IndexedDB 句柄持久化 |
| 局域网 HTTP/WS 服务（远控） | 公共 MQTT broker 信令 + WebRTC datachannel P2P |
| Electron 主进程 SSE 推流 | datachannel 承载 `phone-push` 事件，`EventSource` 被等价替换 |

### 远控功能

桌面版的三类远控（AI 手机编程、手机观看舞台、多人协作）在网页版**全部可用**，统一走：

```
公共 MQTT broker（仅交换 SDP/ICE 信令）
        ↓
WebRTC datachannel（业务数据 P2P 直连，不经第三方服务器）
```

- **AI 手机远控**：AI 助手页「手机远控」生成房间二维码 → 手机扫码打开同页 `?r=<room>`，
  手机端复用桌面版 `remote-bridge.js`（网页版用 datachannel 替换 SSE + POST）。
- **手机观看舞台**：编辑器「手机预览」生成扫码链接 → 手机打开 `remote/index.html?r=<room>`，
  收到 8fps 舞台帧与监视器覆盖层，并可绿旗/暂停/继续/停止。
- **多人协作**：房主建房 → 参与者输入房间号加入（星型拓扑，房主中转）。

### 协作「素材不互通」修复

Scratch 项目 JSON 里的造型/声音只是 md5 引用，加载时按 md5 去 `assets.scratch.mit.edu` 拉取。
房主的自定义素材不在官方 CDN 上，协作对端就会丢素材（桌面版同样存在此问题）。

网页版的修复方式：房主把素材本体随项目一并 P2P 传输，对端在 `NW.collabAssets` 注册后，
由 `fetch` 拦截命中 md5 的官方素材请求，直接以本地数据应答。

## 浏览器要求

- 支持 WebGL（舞台渲染必需）
- 支持 WebRTC / RTCDataChannel（远控功能）
- 支持 File System Access API（本地文件读写；不支持时自动回落到下载/上传）

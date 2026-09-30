[中文](README.md) | [English](README_en.md)

<div align="center">

<img src="Logo.png" width="140" alt="NeoWarp Logo"/>

# NeoWarp

**基于 [TurboWarp Desktop](https://github.com/TurboWarp/desktop) 二次开发的全功能 Scratch 编辑器**

在保留 TurboWarp 高性能编译器与扩展生态的基础上，加入了 AI 编程助手、多人协作、手机编程、全套效率工具，以及更现代的视觉体验。

![License](https://img.shields.io/badge/License-GPL--3.0-blue)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Electron](https://img.shields.io/badge/Electron-41-47848F)
![Based on](https://img.shields.io/badge/Based%20on-TurboWarp%20Desktop-ff4c4c)

</div>

---

## 📖 项目简介

**NeoWarp** 是一个使用 Electron 构建的离线 Scratch 3 编辑器，基于 [TurboWarp/desktop](https://github.com/TurboWarp/desktop) 二次开发。
它完整继承了 TurboWarp 的 JS / Wasm 编译器、海量扩展、Addon 插件、Packager 打包器、深色模式等核心能力，并在此之上针对 **AI 辅助创作**、**多人协作**、**工作流** 与 **视觉体验** 进行了大量增强与定制。

适用于：

- 需要离线编写、运行 Scratch 项目的用户
- 希望用 AI 辅助编写和修改积木脚本的创作者
- 需要多设备、多人协同创作的小团队与课堂
- 对编辑器视觉与交互有更高要求的使用者

---

## ✨ 功能总览

### 🤖 AI 助手（NeoWarp AI）

通过独立窗口与编辑器深度联动的 AI 编程助手：

- **44 个内置工具**：读取项目结构、增删改积木脚本、管理造型 / 声音 / 变量 / 列表、安装与热加载自定义扩展、点击绿旗运行、舞台截图、联网搜索等
- **自研积木 DSL**：AI 以 `opcode 参数` 的文本形式精确描述积木脚本，经编辑器 opcode schema 校验后才应用到工作区，支持新增、插入、修改输入、删除等增量操作，修改精确落到具体积木
- **一键撤销 AI 修改**：每次改动前自动保存项目快照，随时恢复到对话前状态
- **多模态支持**：可将舞台截图发给模型"看到"运行效果，支持图片与 `.md` / `.txt` / `.pdf` / `.csv` 文件附件
- **内置联网搜索**：DuckDuckGo / Bing / Wikipedia 多源聚合
- **从 URL 添加素材**：直接通过图片 URL 添加造型与精灵
- **待办联动**：复杂任务自动拆解为步骤卡片，执行进度实时更新
- 多会话管理、思维链展示、流式输出、JSON 一键应用、用量统计、思考强度调节

### 🎤 NeoWarp SOLO

一个"纯 AI"工作台，没有传统编辑器界面：

- 直接对 `.sb3` 或 JavaScript 扩展项目下达 AI 指令，由后台隐藏编辑器提供 VM 与工具支持
- 独立舞台弹窗：绿旗 / 暂停 / 停止控制、变量监视器、项目"询问并等待"问答框
- 修改结果直接保存回原文件

### 🤝 多人协作

- **发起 / 加入**：一端作为主机开启房间（默认端口 8080，需设置房间密码），其他设备输入地址加入，也可**自动扫描发现**同一局域网内的房间
- **权限控制**：主机可为访客配置"添加扩展 / 删除扩展 / 删除精灵"等权限
- **实时聊天**：内置 iOS 风格聊天区，协作沟通无需离开编辑器
- **项目实时同步**：任何一端的修改即时同步给所有人
- **稳定连接**：SHA-256 密码校验、心跳检测、认证超时与超大帧防护

### 📱 手机编程

- **扫码即连**：AI 助手一键生成二维码，手机扫码后在浏览器中获得与桌面**完全一致**的 AI 聊天界面
- **桌面为唯一数据源**：手机端的对话、流式输出与命令执行全部实时同步回桌面编辑器，躺着也能给项目下发积木指令
- **手机预览**：通过局域网（默认端口 8601）将当前项目导出为独立播放器，手机扫码即可试玩运行效果

### 🏠 主页（Home）

应用启动页与调度中心：

- 快速操作：NeoWarp SOLO、新建项目 / 新建扩展、打开文件、图像编辑器、发起 / 加入协作
- 最近项目列表、时段问候语
- 可在桌面设置中自定义主页 Logo、文字与背景图

### 🧩 扩展编辑器

面向扩展开发者的内置 IDE：

- 基于 **Monaco**（VS Code 同款内核）的多标签 JavaScript 编辑器，内置 NeoWarp 扩展模板
- 一键"添加到项目"（注入到任意打开的编辑器窗口）或存入"我的扩展"库
- 右侧 **AI 面板**可弹出 / 停靠，帮你编写和调试 TurboWarp 扩展

### 🖼 图像编辑器

独立的图片编辑窗口：形状绘制、裁剪、旋转翻转、图层管理，亮度 / 对比度 / 色相 / 饱和度等调整与多款滤镜，并支持独有的**毛玻璃 / 液态玻璃**形状特效（SVG 位移滤镜）。

### 🧰 效率工具窗口

- **待办清单**：轻量待办事项，支持到点系统通知提醒
- **项目分析**：积木分类占比环形图、复杂度 / 代码质量 / 健康度评估，可导出为图片
- **任务管理器**：系统 CPU / 内存实时曲线，以及每个精灵的 CPU 占用排行
- **独立舞台（Detached Stage）**：将舞台弹出为独立窗口（2x 缩放、输入回传），适合双屏演示与调试
- **数据预览**：以独立小窗口预览项目产生的 `data:` URL 内容

### 🎨 编辑器视觉与个性化（对上游的深度定制）

- **积木圆角半径可调**，运行时即时生效；扩展勾选框改为圆形
- **代码区 / 舞台区自定义背景图**
- **"无限画布绘制"**选项（解除画图编辑器画布尺寸限制）
- 素材库支持**固定（置顶）**与右键菜单
- **从 URL 添加精灵 / 造型**（支持本地路径、全角标点自动纠正、魔数格式识别）
- 画图编辑器增强：**智能对齐参考线**、箭头 / 双箭头 / 心形 / 梯形 / 三角形等新形状工具、圆角矩形圆角与曲率可调
- 全套 **"液态玻璃" UI**：主页、AI 助手、待办清单、任务管理器等界面采用毛玻璃质感与过渡动画

### 🧠 AI 模型支持

- **内置免费模型**（无需 API Key）：DeepSeek V4.1 Flash、GLM-5.3 Flash、SenseNova 6.8 Flash Lite、GLM-5.2（免费活动截止 2026-11-30）
- 支持 **OpenAI / Anthropic / Ollama / 自定义** API 格式，预设 DeepSeek、智谱 GLM、Kimi、小米 MiMo、华为盘古、通义千问、SenseNova 等品牌
- API Key 仅保存在本地 `tw_config.json`，AI 请求经主进程代理转发，不经过第三方服务器
- AI 助手 / SOLO / 扩展编辑器**共享同一套模型配置**，在桌面设置中统一管理

### 🧱 兼容与生态

- 完整保留 TurboWarp：**JS / Wasm 编译器**、深色模式、**Addon 插件系统**、**Packager 打包器**（离线内置，可打包 HTML / ZIP / EXE 等）、全部官方扩展
- 扩展文档、素材库、打包器全部**本地化**，离线可用
- **NeoWarp Expands 本地扩展库**：放在 `Expands/` 目录下的自定义扩展通过 `nw-expands://` 协议加载，出现在扩展库的"NeoWarp"标签页（附带 Punycode 转换扩展示例）

### 🖥 桌面集成

- 每日更新检查（GitHub Releases，可关闭），更新提示窗口附带更新日志
- **Discord Rich Presence**：向 Discord 展示当前项目名与创作时长
- 最近项目记录（可在主页一键打开）
- 桌面设置：浅色 / 深色 / 跟随系统主题、摄像头与麦克风选择、硬件加速、后台节流、绕过 CORS、拼写检查等

---

## 📁 文件格式

原生支持打开 / 关联以下格式：

| 扩展名 | 说明 |
| --- | --- |
| `.np1` | NeoWarp 项目（未压缩，**默认保存格式**） |
| `.npnp` | NeoWarp 加密项目（AES-256-GCM + PBKDF2 密码加密） |
| `.viewsb3` | NeoWarp 只读项目（仅供查看，适合分享展示） |
| `.sb3` | Scratch 3 Project |
| `.sb2` | Scratch 2 Project |
| `.sb` | Scratch 1 Project |
| `.js` | NeoWarp 扩展（由扩展编辑器打开） |

> `.viewsb3` 目前仅在应用内打开对话框中支持，未注册系统级文件关联。

---

## 🏗 架构与安全

- 编辑器、主页、AI 助手、协作、SOLO 等 **20 余种窗口**全部通过 `tw-*` 自定义协议加载，与主进程解耦；本地素材库（`tw-library`）与扩展画廊（`tw-extensions`）以 Brotli 压缩内置，离线可用
- 全进程启用 **Electron 沙箱**，禁用 webview，剪贴板 / 通知等敏感权限逐窗口审批
- AI 请求经 `tw-ai-proxy` 主进程代理转发（绕过 CORS），密钥不出本机

---

## 🚀 下载与安装

请前往项目的 [Releases](https://github.com/Shiyuan-318/NeoWarp/releases) 页面下载与系统匹配的安装包：

| 平台 | 安装包 |
| --- | --- |
| **Windows** | `NeoWarp-Setup-x.y.z-x64.exe`（NSIS 安装版）/ `NeoWarp Portable x.y.z x64.exe`（便携版，解压即用） |
| **macOS** | `NeoWarp-Setup-x.y.z.dmg`（Universal，支持深色模式） |
| **Linux** | `NeoWarp-linux-x64-x.y.z.deb` / `.AppImage` / `.tar.gz` |

> 由于本项目是个人二次开发作品，发布渠道与签名策略可能与上游 TurboWarp 不同，请以实际发布的 Releases 为准。

---

## 🧑‍💻 从源码构建

```bash
git clone --recursive https://github.com/Shiyuan-318/NeoWarp.git
cd NeoWarp
npm install              # 安装依赖（自动执行 patch-package 应用补丁）
npm run fetch            # 下载素材库、打包器与扩展资源
npm run webpack:compile  # 编译渲染进程（开发时可改用 webpack:watch）
npm run electron:start   # 启动编辑器
npm run electron:build   # 打包安装程序
```

> 需要 Node.js 与 npm；`docs/screenshots` 为 git 子模块，若克隆时未加 `--recursive`，请补执行 `git submodule update --init`。

AI 助手工具链脚本：

| 命令 | 说明 |
| --- | --- |
| `npm run ai:schema` | 从 scratch-blocks 生成积木 opcode schema 并写入编辑器 |
| `npm run ai:prompt` | 构建并写入 AI 系统提示词 |
| `npm run ai:check` | 校验 schema 与系统提示词是否为最新 |
| `npm run ai:test` | 运行 DSL 往返、数据工具与流式重试测试 |

---

## 🗂 项目结构

```
├── src-main/              # Electron 主进程：窗口、协议、协作服务器、手机同步、AI 模型配置
│   └── windows/           # 20+ 种窗口（编辑器、主页、SOLO、AI 助手、协作、扩展编辑器……）
├── src-preload/           # 各窗口的 contextBridge 预加载脚本
├── src-renderer/          # 各窗口页面（HTML / CSS / JS）
├── src-renderer-webpack/  # 内嵌 scratch-gui 编辑器源码（含 AI 工具执行器 desktop-hoc.jsx）
├── patches/               # patch-package 补丁（scratch-gui / scratch-vm / scratch-blocks / scratch-paint）
├── Expands/               # NeoWarp 本地扩展库（nw-expands:// 协议提供）
├── scripts/               # 构建、资源下载与 AI DSL 工具链脚本
├── docs/                  # 官网、隐私政策、更新日志等静态页面
└── release-automation/    # 多平台打包与发布自动化
```

---

## 🤝 致谢

- [TurboWarp / desktop](https://github.com/TurboWarp/desktop) — 提供了本项目绝大部分基础能力
- [TurboWarp / scratch-gui](https://github.com/TurboWarp/scratch-gui) — 编辑器界面
- [TurboWarp / extensions](https://github.com/TurboWarp/extensions) — 扩展生态
- [Scratch Team](https://scratch.mit.edu) — 创造了 Scratch
- [Electron](https://www.electronjs.org/) / [React](https://react.dev/) / [Webpack](https://webpack.js.org/) / [Monaco Editor](https://microsoft.github.io/monaco-editor/) 等开源项目

---

## 📜 许可证

本项目基于 **GNU General Public License v3.0** 发布，详见 [LICENSE](./LICENSE) 文件。

---

## 📬 联系

- 作者：Shiyuan
- GitHub：[Shiyuan-318/NeoWarp](https://github.com/Shiyuan-318/NeoWarp)
- 网站：[np.sy1.top](https://np.sy1.top)
- QQ 交流群：**517453896**

> 如果你发现了 Bug 或有功能建议，欢迎提交 Issue 或 Pull Request，或加入 QQ 群与作者直接交流。

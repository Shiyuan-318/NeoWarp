[中文](README.md) | [English](README_en.md)

# NeoWarp

> 一款基于 **TurboWarp Desktop** 二次开发的 Scratch 编辑器
> 在保留 TurboWarp 高性能编译器、扩展生态等特性的基础上，加入了更现代的视觉效果与多项实用功能。


---

## 📖 项目简介

**NeoWarp** 是一个使用 Electron 构建的离线 Scratch 3 编辑器，基于 [TurboWarp/desktop](https://github.com/TurboWarp/desktop) 进行二次开发。
它继承了 TurboWarp 的 JS / Wasm 编译器、海量扩展、Addon 插件、Packager 打包器、深色模式等核心能力，并在此之上针对**视觉体验**与**工作流**进行了多项增强与定制。

适用于：
- 需要离线编写、运行 Scratch 项目的用户
- 对编辑器视觉与交互有更高要求的使用者
- 希望通过 AI 辅助 / 待办清单等工具提升创作效率的开发者

---

## ✨ 与原版的不同

### 🎨 视觉与交互增强
- **毛玻璃效果**：编辑器、设置窗口、扩展文档等界面多处加入 Acrylic / Frosted Glass 风格
- **过渡动画**：菜单、面板、弹窗的打开/关闭具有自然的过渡
- **圆角绘制**：积木、角色面板、按钮等元素采用统一圆角，外观更现代
- **内存与 CPU 占用率监控**：实时显示编辑器的资源占用情况
- **分离舞台 (Detached Stage)**：可将舞台弹出为独立窗口，便于在多屏幕场景下进行演示或调试

### 🛠 功能增强
- **AI 助手 (AI Assistant)**：通过独立窗口提供 AI 辅助能力，可读取当前项目结构、应用修改到工程或精灵
- **待办清单 (Todo List)**：内置轻量级待办事项窗口，便于在创作过程中记录思路与任务
- **项目分析 (Project Analysis)**：提供对项目结构的分析视图
- **数据预览 (Data Preview)**：方便快速预览项目中的数据资源
- **协议化窗口**：编辑器、AI 助手、待办清单、扩展文档等均以 `tw-*` 自定义协议加载，与主进程解耦

### 🧩 兼容与生态
- 支持原版 TurboWarp 的 **所有扩展**（`@turbowarp/extensions`）
- 支持 **Addon 插件** 系统
- 支持 **Packager 打包**，可将项目打包为可分发的离线 HTML / ZIP / EXE 等格式

### 📁 文件格式
原生支持打开 / 关联以下格式：

| 扩展名 | 说明 |
| --- | --- |
| `.viewsb3` | NeoWarp Project（仅供查看的项目） |
| `.npnp` | NeoWarp Project（加密保存的项目） |
| `.np1` | NeoWarp Project（未压缩工程） |
| `.sb3` | Scratch 3 Project |
| `.sb2` | Scratch 2 Project |
| `.sb` | Scratch 1 Project |

---

## 🚀 下载与安装

请前往项目的 [Releases](https://github.com/Shiyuan-318/Neowarp/releases) 页面下载与系统匹配的安装包：

| 平台 | 安装包 | 备注 |
| --- | --- | --- |
| **Windows** | `NeoWarp-Setup-x.y.z-x64.exe` | NSIS 安装包 |
| **Windows** | `NeoWarp Portable x.y.z x64.exe` | 便携版（解压即用） |


> 由于本项目是个人二次开发作品，发布渠道与签名策略可能与上游 TurboWarp 不同，请以实际发布的 Releases 为准。



## 🤝 致谢

- [TurboWarp / desktop](https://github.com/TurboWarp/desktop) — 提供了本项目绝大部分基础能力
- [TurboWarp / scratch-gui](https://github.com/TurboWarp/scratch-gui) — 编辑器界面
- [TurboWarp / extensions](https://github.com/TurboWarp/extensions) — 扩展生态
- [Scratch Team](https://scratch.mit.edu) — 创造了 Scratch
- [Electron](https://www.electronjs.org/) / [React](https://react.dev/) / [Webpack](https://webpack.js.org/) 等开源项目

---

## 📜 许可证

本项目基于 **GNU General Public License v3.0** 发布，详见 [LICENSE](./LICENSE) 文件。

---

## 📬 联系

- 作者：Shiyuan
- GitHub：[Shiyuan-318/Neowarp](https://github.com/Shiyuan-318/Neowarp)
- QQ 交流群：**517453896**

> 如果你发现了 Bug 或有功能建议，欢迎提交 Issue 或 Pull Request，或加入 QQ 群与作者直接交流。

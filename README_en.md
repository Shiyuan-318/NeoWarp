[中文](README.md) | [English](README_en.md)

# NeoWarp

> A Scratch editor based on **TurboWarp Desktop** with secondary development
> While retaining TurboWarp's high-performance compiler and extension ecosystem, it features modern visual effects and numerous practical functions.


---

## 📖 Introduction

**NeoWarp** is an offline Scratch 3 editor built with Electron, based on [TurboWarp/desktop](https://github.com/TurboWarp/desktop).
It inherits TurboWarp's core capabilities including JS / Wasm compiler, massive extensions, Addon plugins, Packager, dark mode, and enhances **visual experience** and **workflow** on top of that.

Suitable for:
- Users who need to write and run Scratch projects offline
- Users with higher requirements for editor visual and interaction
- Developers who want to improve creation efficiency through AI assistance / todo lists

---

## ✨ Differences from Original

### 🎨 Visual & Interaction Enhancements
- **Frosted Glass Effect**: Acrylic / Frosted Glass style added to editor, settings window, extension docs and other interfaces
- **Transition Animations**: Natural transitions for opening/closing menus, panels, and popups
- **Rounded Corners**: Unified rounded corners for blocks, sprite panels, buttons, and other elements for a modern appearance
- **Memory & CPU Monitoring**: Real-time display of editor resource usage
- **Detached Stage**: Stage can be popped out as an independent window, convenient for multi-screen demonstrations or debugging

### 🛠 Functional Enhancements
- **AI Assistant**: Provides AI-assisted capabilities through an independent window, can read current project structure and apply modifications to projects or sprites
- **Todo List**: Built-in lightweight todo window for recording ideas and tasks during creation
- **Project Analysis**: Provides analysis view of project structure
- **Data Preview**: Convenient for quickly previewing data resources in projects
- **Protocol-based Windows**: Editor, AI assistant, todo list, extension docs are all loaded via `tw-*` custom protocols, decoupled from main process

### 🧩 Compatibility & Ecosystem
- Supports **all extensions** from original TurboWarp (`@turbowarp/extensions`)
- Supports **Addon plugin** system
- Supports **Packager**, can package projects as distributable offline HTML / ZIP / EXE formats

### 📁 File Formats
Natively supports opening / associating the following formats:

| Extension | Description |
| --- | --- |
| `.viewsb3` | NeoWarp Project (view only) |
| `.npnp` | NeoWarp Project (encrypted) |
| `.np1` | NeoWarp Project (uncompressed) |
| `.sb3` | Scratch 3 Project |
| `.sb2` | Scratch 2 Project |
| `.sb` | Scratch 1 Project |

---

## 🚀 Download & Installation

Please visit the project's [Releases](https://github.com/Shiyuan-318/Neowarp/releases) page to download the installer matching your system:

| Platform | Package | Note |
| --- | --- | --- |
| **Windows** | `NeoWarp-Setup-x.y.z-x64.exe` | NSIS installer |
| **Windows** | `NeoWarp Portable x.y.z x64.exe` | Portable version (unzip and run) |

> Since this project is a personal secondary development work, the release channel and signing policy may differ from upstream TurboWarp, please refer to actual published Releases.

---

## 🤝 Acknowledgments

- [TurboWarp / desktop](https://github.com/TurboWarp/desktop) — Provides most of the basic capabilities for this project
- [TurboWarp / scratch-gui](https://github.com/TurboWarp/scratch-gui) — Editor interface
- [TurboWarp / extensions](https://github.com/TurboWarp/extensions) — Extension ecosystem
- [Scratch Team](https://scratch.mit.edu) — Created Scratch
- [Electron](https://www.electronjs.org/) / [React](https://react.dev/) / [Webpack](https://webpack.js.org/) and other open source projects

---

## 📜 License

This project is released under **GNU General Public License v3.0**, see [LICENSE](./LICENSE) file for details.

---

## 📬 Contact

- Author: Shiyuan
- GitHub: [Shiyuan-318/Neowarp](https://github.com/Shiyuan-318/Neowarp)
- QQ Group: **517453896**

> If you find bugs or have feature suggestions, feel free to submit Issues or Pull Requests, or join the QQ group to communicate directly with the author.
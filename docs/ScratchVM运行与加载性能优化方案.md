# NeoWarp ScratchVM 性能优化方案

> 版本：v2.0 ｜ 适用版本：NeoWarp 2.0.0（TurboWarp scratch-vm 2.1.46）
> 本文档仅制定方案，不包含具体代码实现。
> 范围限定：只覆盖 **ScratchVM 本身** 的两个专项——① 点击绿旗后的运行期占用；② `vm.loadProject` 的项目加载速度。Electron 宿主、IPC、窗口、打包等宿主层问题不属于本文范围。

---

## 一、现状基线

### 1.1 VM 构成与定制情况

| 组件 | 版本 | 本地定制 |
|------|------|---------|
| scratch-vm | 2.1.46（TurboWarp develop fork） | `patches/scratch-vm+2.1.46.patch`，仅 14 行放开扩展 URL 白名单（`nw-expands:`），**引擎零改动** |
| scratch-render | 0.1.0（TurboWarp develop） | 无补丁 |
| scratch-audio | 0.1.0（TurboWarp develop） | 无补丁 |

**结论**：引擎行为与 TurboWarp 上游一致，优化空间在"调度参数调优 + 调度层增强 + 加载路径加速"，不重写引擎内核；确需改动的一律走 patch-package，保持与上游可合并。

### 1.2 绿旗执行链路（已核实）

```
controls.jsx:25-36（绿旗点击）
  → vm.start()     → runtime.start()  → frameLoop.start()   (runtime.js:3375)
  → vm.greenFlag() → runtime.greenFlag()                    (runtime.js:2442)
                                                              ↓
tw-frame-loop.js：setInterval(1000/framerate) + rAF 包装（Chromium 下 noop rAF 保帧）
  → runtime._step() (runtime.js:2511)
      → sequencer.stepThreads() (runtime.js:2544)   ← CPU 消耗主体
      → renderer.draw()（仅 redrawRequested 时）
```

VM 实例由 redux store 创建（`reducers/vm.js:6-9`），默认 `setCompatibilityMode(true)`（30fps）。

**已有的可调旋钮（无需新造，优化以"用好它们"为先）**：

| 旋钮 | 位置 | 作用 |
|------|------|------|
| `setFramerate(30–250)` | runtime.js:2652 | 步进帧率，默认 30（兼容模式） |
| `setInterpolation` | runtime.js:2667 | 高帧率下渲染插值补间，CPU 代价远低于真高帧率步进 |
| `setCompilerOptions`（warp timer / 关闭编译器） | tw-settings-modal.jsx:99-104 | 编译器默认开启 |
| 项目元数据帧率 | sb3 `tw:` 元数据 | 项目可自带帧率偏好 |
| 桌面端 `setFramerate` IPC | desktop-hoc.jsx:4041-4056 | 外部/AI 调帧率入口 |

### 1.3 项目加载链路（VM 侧，已核实）

```
vm.loadProject(projectData)                    (virtual-machine.js:458)
  → sb3.deserialize
      → jszip 解压 .sb3（project.json + 全部素材）
      → JSON.parse
      → 素材经 @turbowarp/scratch-storage 逐个加载（按 assetId 去重）
      → extension-manager 加载项目引用的扩展（含 nw-expands: 本地扩展）
  → resolve → 加载遮罩消失 → 首帧由正常帧循环绘制
```

桌面端加载调用点：`desktop-hoc.jsx:4508`（打开文件）、`:2039`（AI 应用 projectJSON）、`:4343`（快照恢复）。

---

## 二、优化目标（可度量）

| 指标 | 现状（估算） | 目标 |
|------|------------|------|
| 绿旗后空闲态（无脚本运行）VM 线程 CPU | 30fps 空转唤醒 | 降低 50%+ |
| 运行期 CPU（重计算项目，同帧率） | 基线 | 降低 15%+，或帧时间 P99 改善 30%+ |
| `vm.loadProject` 耗时（10MB 典型项目） | 0.5–2s（反序列化段） | ≤0.5s |
| 二次加载同一项目 | 与首次相同 | ≤0.2s（缓存命中） |
| 大项目反复加载（AI 修改/快照恢复）后内存增长 | 未度量 | 20 轮后 RSS 增长 <20% |

---

## 三、专项一：绿旗后的运行期占用优化

### 3.1 空闲态降频（收益最直接，语义风险需控制）

**问题**：`frameLoop.start()` 之后，即使没有任何活跃线程（用户点了绿旗但无 hat 触发，或脚本已全部结束），`setInterval` 仍以设定帧率唤醒 `runtime._step()`，sequencer 每帧空转。30fps 下每秒 30 次无效唤醒，60/250fps 下浪费成倍。

**方案**：
1. **空闲检测**：在 `_step()` 出口统计"本帧无活跃线程、无 redraw 请求、无新事件"的连续帧数；超过阈值（如 30 帧）即进入低功耗态。
2. **低功耗态行为**：帧循环降到 4–10fps，或以事件驱动唤醒——以下任一事件立即恢复原帧率：
   - 任何线程变为活跃（绿旗、广播、克隆启动、事件 hat 命中）；
   - 键盘/鼠标输入（`runtime.ioDevices` 事件）；
   - 监视器值变化、扩展的 peripheral 心跳（视频/语音类扩展后台采样）。
3. **必须保持的语义**：
   - 计时器积木（timer）精度：低功耗态下 timer 仍按真实时钟推进（`runtime.currentMSecs` 本来就是墙钟，不受影响），但"当计时器 > x"类 hat 的触发粒度变粗，阈值内需评估；
   - 本项目"停止=冻结"语义（`desktop-hoc.jsx:218`）：降频只减少后台唤醒，不改变舞台画面保持的逻辑；
   - 事件 hat（当按下按键/当角色被点击）必须即时唤醒，这是回归测试重点。
4. **实现位置**：`tw-frame-loop.js`（TurboWarp 自有调度模块，改动面小）+ runtime 层提供空闲状态查询；以 patch 管理。

### 3.2 帧调度策略调优

1. **优先推荐插帧而非真高帧率**：对追求流畅的用户项目，60fps 步进意味着 sequencer 工作量翻倍；而开启 30fps + interpolation 用渲染层插值补间即可视觉流畅，CPU 代价低得多。方案：文档/设置说明中明确这一取舍，引导项目元数据使用"30fps + 插帧"作为高性能档位（不改变 UI，仅用说明文案）。
2. **调度器抖动评估**：`setInterval` 在 Windows 上约有 1–4ms 粒度误差，30fps（33.3ms 周期）下表现为帧时间抖动；60fps+ 时 interval 与 rAF 包装叠加可能抢帧。方案：评估将主调度改为 **rAF 主导 + setInterval 兜底**（页面可见用 rAF 对齐 vsync，被节流时回退 interval）。此项改动调度核心，放第三阶段评估，须配合帧时间 P99 度量验证收益。
3. **warp timer 语义确认**：warp（不刷新屏幕运行）积木下 sequencer 满载是预期行为，不做限制；确认设置弹窗中 warp timer 选项默认值与文档一致，避免用户误开导致感知卡顿。
4. **编译器路径核对**：确认编译器未被任何调用路径意外禁用（`setCompilerOptions` 的调用点：tw-settings-modal.jsx:104、desktop-hoc.jsx 的 AI 工具链），保证 `warpTimer`、编译开关按用户设置正确传递；编译器开启是 TurboWarp 性能的根本，属于"不许回退"的基线。

### 3.3 运行期内存与资源管理

1. **克隆体与列表上限核对**：确认 runtime 默认 `MAX_CLONES`（300）等保护未被本项目放宽；若有放宽，评估失控项目的内存风险，恢复默认或改为设置项。
2. **停止/绿旗时的资源回收核对**：绿旗与停止全部路径上确认——
   - audio engine `stopAllSounds` 完整调用，无残留 sound player；
   - pen 层（renderer 的 canvas 叠加层，大舞台下内存可观）按预期清理；
   - 克隆体销毁后 drawable/skin 引用释放，无泄漏。
3. **反复 loadProject 的内存压测**：AI 修改（`desktop-hoc.jsx:2039`）与快照恢复（`:4343`）路径会反复 `loadProject`，需确认旧项目的 target、素材引用被完全释放（storage 层按 assetId 去重是加分项，但 target/线程/监视器对象需验证）。度量方法见第五节。
4. **监视器（monitor）刷新优化**：舞台上的变量监视器在值变化时会请求 redraw，高频变化变量（如每帧更新的计分）会迫使渲染层每帧工作。方案：监视器 DOM 更新做差量（值未变跳过）、同帧多次变化合并为一次刷新。
5. **本地扩展性能审计**：`nw-expands:` 扩展中的积木若为同步阻塞实现（同步 IO、重计算），会卡住整帧乃至整帧循环。方案：建立扩展开发规范——耗时操作必须返回 Promise（VM 会挂起该线程而非阻塞全局）；对现有本地扩展逐个审计执行耗时。

### 3.4 不做的事

- 不重写 sequencer/compiler/tw-frame-loop 内核算法——TurboWarp 的编译执行已是行业最高水平，重写风险远大于收益；
- 不为了降占用牺牲兼容性语义（计时器、事件、停止冻结）；
- warp 模式满载、高帧率模式高占用属于用户明确选择的预期行为，不"优化"掉。

---

## 四、专项二：`vm.loadProject` 加载速度优化

### 4.1 VM 侧加载阶段拆解与预算

| 阶段 | 内容 | 现状估算 | 预算 |
|------|------|---------|------|
| D1. 解压 | jszip 解压 zip 容器 | 大项目占比高 | ↓ 30–50% |
| D2. 解析 | JSON.parse + 积木/target 反序列化 | 与项目规模线性 | 结构优化空间有限 |
| D3. 素材 | 图片/音频经 storage 加载（含 SVG 解析、音频解码） | 素材多时主导 | 并行 + 缓存 |
| D4. 扩展 | extension-manager 加载扩展代码 | 多扩展项目数百 ms | 缓存 + 并行 |

### 4.2 D1/D2：解压与反序列化

1. **jszip 升级/替换评估**：scratch-vm 依赖的 jszip 版本较旧，解压是单线程同步热点。评估升级 jszip 3.x 或替换为 fflate（解压快数倍、体积更小、支持流式）。改动点集中在 `sb3.js`/`sb2.js` 的 zip 读取处，以 patch 管理。**回归重点**：含中文文件名素材的项目、损坏 zip 的错误路径、含目录结构的 sb3。若评估风险不可接受则放弃本项，以 4.4 缓存弥补。
2. **zip 条目级 Worker 池并行解压（多线程载入，可行性见附录 A）**：zip 各条目 deflate 流相互独立，主线程只读中央目录，将各条目压缩字节分发至 Web Worker 池并行 inflate，Transferable ArrayBuffer 零拷贝回传；`project.json` 单条目单独在一个 Worker 解压，主线程全程不阻塞。大项目收益显著，小项目通信开销可能抵消收益——按项目大小设阈值（如 >5MB）启用。可与上一项（fflate）合并实施：fflate 体积小，适合打进 Worker。
2. **project.json 解析**：JSON.parse 本身是瓶颈时（超大项目）评估流式解析收益；一般项目不必做。

### 4.3 D3：素材加载

1. **并行加载核对**：确认 deserialize 中素材请求是否并发；若存在串行 await 链（尤其音频解码），改为有限并发（4–8 路）批量加载。
2. **SVG 素材处理**：矢量素材加载涉及 XML 解析与可能的字体/分辨率处理，确认未在加载路径做超出首帧需要的预处理；位图素材确认按 `bitmapResolution` 正确处理，避免加载期无谓的重采样。

### 4.4 D4：扩展加载与缓存体系

1. **扩展并行加载**：项目引用多个扩展时确认 extension-manager 并行加载；若串行改 `Promise.all`（保留有依赖关系的扩展顺序语义）。
2. **本地扩展（nw-expands:）缓存**：扩展 JS 每次加载重新读盘 + 编译执行。方案：按"路径 + mtime"缓存扩展源码与编译产物，二次加载免读盘免编译。
3. **素材级缓存（跨加载复用）**：建立 assetId → 已加载素材的 LRU 缓存（storage 层之上）。AI 反复修改、快照恢复、关闭重开同一项目时，素材命中缓存可省掉解压 + 加载全过程。缓存设总量上限（如 256MB）防内存膨胀；assetId 内容寻址天然无失效问题。

### 4.5 加载完成时机

核对 `vm.loadProject` 的 resolve 时机：反序列化全部完成即 resolve，让调用方尽早结束加载态；首帧绘制交给正常帧循环异步补上，不把首帧等进 resolve 路径。若当前实现晚于反序列化完成点，前置 resolve。

---

## 五、度量与验证方法

1. **运行期 CPU 分解**：Chrome DevTools Performance 面板录制 10s 绿旗运行，按 sequencer / renderer / 其他 三类归因，改动前后同项目对比。
2. **帧时间稳定性**：在 frameLoop 内打点帧间隔（`performance.now()` 差值），统计 P50/P99 与 1% low；空闲降频项需额外验证事件唤醒延迟（按键到 hat 触发 < 50ms）。
3. **VM 内部分析**：TurboWarp runtime 自带 profiler（`runtime.profiler`），开发版开启后定位线程执行热点积木，用于验证编译器路径与扩展耗时。
4. **加载埋点**：`vm.loadProject` 调用前后 + 内部 D1–D4 各阶段 `performance.mark`，建立三个基准项目（小 <1MB / 中 10MB / 大 50MB+，含中文素材名与多扩展）作为固定回归样本。
5. **内存**：`webContents.getProcessMemoryInfo()` 在绿旗前 / 运行 5 分钟 / 停止后三点采样；反复 loadProject 20 轮后 RSS 增长 <20% 为合格。
6. **回归路径**：每次改动后跑通——打开工程、绿旗运行（30/60/自定义帧率 + 插帧）、停止冻结语义、事件 hat 即时响应、计时器积木精度、监视器刷新、多扩展项目、AI 修改与快照恢复。

---

## 六、实施路线图

### 第一阶段（1–2 周，低风险）

1. 建立加载埋点（D1–D4）与基准项目集、帧时间打点（第五节）——先量化再优化；
2. 扩展并行加载 + 本地扩展源码/编译缓存（4.4-1 / 4.4-2）；
3. 素材并行加载核对与改造（4.3-1）；
4. 编译器路径、克隆体上限、停止回收三项核对（3.2-4 / 3.3-1 / 3.3-2）；
5. 监视器差量刷新（3.3-4）。

### 第二阶段（2–4 周，结构性）

1. 空闲态降频 + 事件驱动唤醒（3.1）——语义风险最高，编译期开关灰度，回归通过前不默认开启；
2. 素材级 LRU 缓存（4.4-3）；
3. `loadProject` resolve 时机前置（4.5）；
4. 反复 loadProject 内存压测与泄漏修复（3.3-3）。

### 第三阶段（4 周以上，需评估）

1. rAF 主导调度替换（3.2-2）；
2. jszip 升级 / fflate 替换（4.2-1）；
3. zip 条目级 Worker 池并行解压（4.2-2，附录 A）；
4. 耗时积木/扩展 Worker 化（附录 A.2 折中路径 1）；
5. 超大 project.json Worker 内解析（附录 A.1，按需）。

---

## 七、风险与注意事项

- **空闲降频（3.1）语义风险最高**：必须穷举"无活跃线程但需响应"的状态——键盘/鼠标事件 hat、广播等待、计时器 hat、视频/语音扩展后台采样、克隆体 deferred 清理。先灰度开关，回归清单全绿前不默认开启。
- **调度器替换（3.2-2）**：rAF 在页面被节流/最小化时暂停，若项目依赖帧循环持续推进，必须保留 setInterval 兜底分支并联合验证。
- **jszip 替换（4.2-1）**：触碰反序列化核心，风险高；不通过则以缓存层（4.4）弥补，放弃该收益。
- **所有 scratch-vm / scratch-render 内改动一律走 patch-package**（与现有 patch 同机制），禁止直接改 node_modules，保持与 TurboWarp develop 上游可合并。
- **缓存类优化统一带总量上限与失效键**（路径 + mtime / assetId），防内存膨胀与"改了扩展不生效"两类回归。

---

## 附录 A：多线程载入与多线程运行可行性评估

> 结论先行：**多线程载入可行且值得做**（有明确实现路径）；**多线程运行不建议**（与 Scratch 执行语义冲突，工程代价大于收益），但存在三条语义安全的折中路径。

### A.1 多线程载入 sb3：可行

sb3 是 zip 容器，**各条目的 deflate 流相互独立**，这是载入可并行化的结构性基础。分环节评估：

| 环节 | 可否多线程 | 评估 |
|------|-----------|------|
| zip 解压 | **可以，值得做** | 主线程只读中央目录，各条目压缩字节分发至 Web Worker 池并行 inflate，Transferable ArrayBuffer 零拷贝回传。`project.json` 为单条目无法切分（deflate 流式依赖字典），单独占用一个 Worker 即可。收益与项目规模成正比，建议按大小设阈值启用（如 >5MB） |
| JSON.parse | 可以，一般不值得 | Worker 内 parse 后结构化克隆回传，大对象图克隆成本可能抵消收益；仅超大项目考虑 |
| 图片/音频解码 | **浏览器已隐式多线程** | `createImageBitmap` 与 `decodeAudioData` 本就在浏览器内部线程解码；需核对加载路径使用的是 `createImageBitmap` 而非触发主线程解码的 `Image` 元素 |
| SVG 栅格化、WebGL 纹理上传 | 不可以 | 只能在主线程，属载入尾段的固定成本 |

### A.2 多线程运行 sb3：不建议

**原因一：语义冲突（致命）**。Scratch 是协作式单线程模型：积木原子执行、线程只在循环/等待处让出。广播并等待、变量/列表、角色位置、笔层全部是共享可变状态。多 Worker 并行执行脚本会破坏积木原子性假设，项目行为不可复现——兼容性倒退比性能问题更致命。

**原因二：工程代价大于收益**。Worker 间共享可变状态只有两条路：

1. SharedArrayBuffer + Atomics——要求 cross-origin isolation，需给 `tw-editor://` 自定义协议响应加 COOP/COEP 头，影响面波及全部窗口与资源加载；
2. 状态分片 + 每帧消息同步——Scratch 负载多为渲染/事件驱动而非 CPU 密集，每帧同步开销大概率吃掉并行收益。

**折中路径（语义安全，推荐第 1 条）**：

1. **耗时积木/扩展 Worker 化**：本地扩展中的重计算（图像处理、大列表运算等）封装为 Worker 任务，积木返回 Promise——VM 挂起该脚本线程等待结果，其余脚本照常推进。不改 VM 内核、不碰共享状态，语义完全安全；
2. **渲染线程化（远期评估）**：Chromium 支持 Worker 内 OffscreenCanvas 跑 WebGL，理论上可将 scratch-render 挪出主线程；与 GUI 层交互点众多，工程量大，仅作记录；
3. **多项目并行 = 多进程而非多线程**：同时运行多个项目应开多个窗口/VM 实例，现有架构已支持，无需任何改造。

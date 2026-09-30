# sb3 多线程载入方案

> 版本：v1.0 ｜ 适用版本：NeoWarp 2.0.0（TurboWarp scratch-vm 2.1.46，jszip 2.x）
> 本文档仅制定方案，不包含具体代码实现。
> 上位文档：《ScratchVM运行与加载性能优化方案.md》附录 A.1 的展开，对应其路线图第三阶段第 3 项（4.2-2）。

---

## 一、目标与结论

**结论：多线程载入 sb3 可行且值得做。** sb3 是 zip 容器，各条目的 deflate 流相互独立，天然可按条目并行解压；将解压从渲染主线程移至 Web Worker 池后，大项目的载入耗时与主线程卡顿同步改善。

| 指标 | 现状（估算） | 目标 |
|------|------------|------|
| D1 解压耗时（50MB+ 大项目） | 单线程 jszip，数百 ms–数 s | 降低 40–60% |
| 解压期间主线程最长阻塞 | 与解压耗时同量级 | < 50ms（主线程只读中央目录） |
| 小项目（<5MB）载入 | 现状可接受 | 不回退（阈值下走原路径） |
| np1（未压缩 sb3）载入 | 与 sb3 同走 jszip 完整解析 | 零拷贝直通，D1 解压段 ≈ 0，且无大小阈值 |
| 二次载入同一项目 | 走素材缓存（上位方案 4.4-3） | 本方案不重复覆盖 |

**不优化小项目**：Worker 通信与任务分发有固定开销（数 ms–十几 ms），小项目走原 jszip 路径反而更快。

**np1 单独成为最快路径**：np1 全部条目不压缩（见 2.5），没有 inflate 可并行，Worker 池对它无意义——正确做法是绕过 Worker 直接零拷贝直通，收益比 Worker 池更大且无阈值限制。

---

## 二、可行性基础

1. **zip 结构允许条目级并行**：zip 中央目录（End of Central Directory → Central Directory）记录每个条目的压缩方法、CRC32、本地头偏移与压缩尺寸；各条目 deflate 流互相独立，可任意切分并行 inflate，不存在跨条目依赖。
2. **唯一的例外是 project.json**：单个条目的 deflate 流依赖滑动字典，无法内部切分。处理方式是它单独占用一个 Worker 与素材条目并行——它往往是最重的单条目（大项目可达数 MB→数十 MB JSON），但依然不阻塞主线程。
3. **解码环节浏览器已隐式多线程**：`createImageBitmap`（图片）与 `decodeAudioData`（音频）在浏览器内部线程解码，不在本方案范围内；SVG 栅格化与 WebGL 纹理上传只能主线程，属载入尾段固定成本。
4. **Electron 环境支持**：沙箱渲染进程内 Web Worker 可正常创建（Chromium 沙箱不限制 Worker）；Worker 脚本可通过 webpack `worker-loader`/webpack5 `new Worker(new URL(...))` 打包，或 Blob URL 内联。需确认 `tw-editor://` 自定义协议页面的 CSP 允许 `worker-src`/`blob:`（若走 Blob 内联方案）。
5. **np1 格式 = 全 STORE 条目的 sb3（已核实）**：TurboWarp 上游 VM 自带 np1 保存实现——`virtual-machine.js:610` `_saveProjectNp1Zip()` 对每个条目设置 `compression: 'STORE'`（method=0，不压缩），对外方法 `saveProjectNp1()`（`:631`）。加载侧与 sb3 共用 `sb3.deserialize` → `JSZip.loadAsync`（jszip 对 STORE 条目透明处理）。NeoWarp 桌面端已把 np1 作为一级格式：打开/保存对话框均含 np1（`editor.js:558,585`、`home.js:51`、`solo.js:223`）。**含义**：np1 的 D1 阶段没有 inflate 工作，只剩"按偏移切片"这一 memcpy 级操作，甚至可零拷贝。

---

## 三、总体设计

### 3.1 架构

```
vm.loadProject(arrayBuffer)                     (virtual-machine.js:458)
  └─ sb3.deserialize 入口处（patch 注入分支）
        │  统一先解析中央目录（主线程只读，<5ms）
        │  得到条目表 [{name, offset, compressedSize, method, crc32}]
        │
        ├─ 全为 STORE（method=0，即 np1）→ StoreFastPath
        │     主线程直接按偏移零拷贝切片，不进 Worker、无大小阈值
        │
        ├─ 文件 < 阈值(5MB) 或 Worker 不可用 → 原 JSZip.loadAsync 路径（零变化回退）
        │
        └─ ≥ 阈值且含 DEFLATE 条目（典型 sb3）→ WorkerUnzipper
              ① 按条目压缩字节切片，round-robin 分发至 Worker 池
                 （project.json 固定派给 Worker-0 并标记最高优先级）
              ② Worker 内：fflate inflate（个别 STORE 条目直接透传）
                 结果以 Transferable ArrayBuffer 零拷贝回传，附 CRC32 校验结果
              ③ 主线程聚合为 Map<name, Uint8Array>

        三条路径最终统一：
              以 JSZip API 兼容层包装 Map，交给 sb3.js 下游流程
              （素材加载、JSON.parse、扩展加载等完全无感）
```

**分流依据是中央目录的 method 字段，不是文件后缀**——用户可手动把 deflate 的 sb3 改名为 .np1（反之亦然），后缀不可信；中央目录解析三条路径共用，本身也是 Worker 池分发的前置步骤，无重复开销。

### 3.2 关键设计决策

| 决策点 | 方案 | 理由 |
|--------|------|------|
| 解压库 | fflate（Worker 内） | 体积约 8KB（jszip 的 1/10）、纯 inflate 快数倍、无依赖，适合打进 Worker；store（method=0）条目直接透传不解压 |
| 集成点 | patch `sb3.js` 的 zip 读取处 | 保持 `vm.loadProject` 对外签名不变；下游（素材 storage、扩展管理器）零改动；与现有 `patches/scratch-vm+2.1.46.patch` 同机制管理 |
| 兼容层 | 实现 sb3.js 实际用到的 JSZip API 子集（`file(name).async('uint8array'|'text')`、`files` 遍历） | 避免全量替换 JSZip；sb2 路径（`sb2.js`）继续走原 jszip，不受影响 |
| Worker 池大小 | `min(hardwareConcurrency - 1, 4)`，常驻复用 | 池在编辑器窗口生命周期内复用，避免每次载入重建；窗口关闭时 terminate |
| 任务分发 | 按压缩尺寸 round-robin 均衡 | 素材大小差异大，按字节均衡优于按条数 |
| 回传方式 | Transferable ArrayBuffer + 回传后立即释放压缩切片 | 零拷贝；压缩切片用后即弃，控制内存峰值 |
| 启用阈值 | 压缩包 ≥ 5MB 才走 Worker 池 | 小项目通信开销抵消收益；阈值以实测数据校准 |
| 降级链 | Worker 创建失败 / inflate 报错 / CRC 不符 → 整包回退 jszip 单线程路径 | 任何异常都不改变"能打开"这一底线 |
| np1（全 STORE） | StoreFastPath：主线程按偏移切片，优先 `Uint8Array.subarray` 零拷贝视图 | STORE 下整文件 ≈ 全部条目之和，视图钉住整包不造成额外内存浪费；无需 inflate，Worker 池对纯 STORE 无收益 |
| 零拷贝的安全性 | 若下游（storage、音频解码、AI 工具链）存在就地修改 buffer 的行为，降级为逐条目 `slice()` 拷贝 | STORE 条目的唯一成本就是 memcpy（数 GB/s，50MB 约 10–20ms），拷贝方案同样远快于 jszip 现状 |
| 格式识别 | 读中央目录 method 字段分流，不读文件后缀 | 后缀可被用户手动更改，method 字段才是事实；.npnp/.viewsb3 解密后进入同一分流逻辑 |

### 3.3 project.json 的特殊处理

- sb3 路径：固定派给 Worker-0 并最先分发——它是后续素材加载的依赖（sb3.deserialize 先读 project.json 再按引用取素材），早完成可让下游 JSON.parse 尽早开始；
- np1 路径：project.json 提取是零成本的 subarray 切片，无需任何特殊调度；
- JSON.parse 仍在主线程执行（结构化克隆大对象图的成本通常高于 parse 本身，Worker 化收益为负，见上位方案附录 A.1）；仅当出现实测瓶颈（超大 project.json，如 >50MB JSON）再单独评估。**注意 np1 不改善 D2**：JSON 内容与 sb3 相同，parse 耗时不变——np1 的收益全部在 D1。

### 3.4 内存控制

- sb3 路径：载入期间峰值内存 ≈ 压缩包 + 全量解压产物，与原 jszip 路径同量级（jszip 同样全量驻留），无新增数量级风险；
- np1 路径（零拷贝）：峰值内存 ≈ 文件本身一份，优于 sb3 现状——STORE 下条目视图钉住的整包本来就是"全部条目"，无额外驻留；若降级为逐条目拷贝，则峰值 ≈ 2×文件，仍在 jszip 现状量级内；
- 压缩切片随分发即弃、解压结果经 Transferable 转移所有权，Worker 侧不累积；
- 与上位方案 4.4-3 的素材 LRU 缓存衔接时，注意解压产物移交缓存后释放 Map 引用，避免双重持有。

---

## 四、回归与兼容性清单

实施前后必须用以下样本回归（与上位方案第五节的基准项目集共用）：

1. 含**中文文件名素材**的项目（zip 条目名 UTF-8 标志位与 CP437 回退两种编码都要覆盖）；
2. 含目录结构 / 嵌套路径的 sb3；
3. **损坏 zip**（截断、CRC 错误、中央目录损坏）——必须走降级链且不崩溃、错误提示与原路径一致；
4. method=0（store，未压缩存储）条目——直接透传分支；
5. **np1 格式专项**：大体积 np1、含中文素材名 np1、np1 走全部三条 `loadProject` 调用路径（打开文件 / AI 应用 projectJSON / 快照恢复）；
6. **伪装后缀**：deflate 压缩的 sb3 手动改名 .np1、STORE 存储的 zip 改名 .sb3——必须按中央目录 method 字段正确分流，均不得出错；
7. 超大 project.json 项目（>50MB JSON）；
8. 空素材项目、单素材项目（边界）；
9. .sb2 旧格式项目——确认完全不受影响（原 jszip 路径）；
10. 桌面端三条 `loadProject` 调用路径全过：打开文件（`desktop-hoc.jsx:4508`）、AI 应用 projectJSON（`:2039`）、快照恢复（`:4343`）；
11. Worker 池复用验证：同一窗口连续载入 20 个项目，无 Worker 泄漏、无内存持续增长。

---

## 五、度量方法

1. 在 `sb3.js` 解压入口/出口埋点（`performance.mark`），分离统计：中央目录解析 / Worker 分发等待 / 纯解压 / 聚合四个子段；
2. 与上位方案一致的三个基准项目（小 <1MB / 中 10MB / 大 50MB+），各跑 10 次取 P50/P99，对比原 jszip 路径；**另加同内容项目的 .np1 版本**——验证 StoreFastPath 的 D1 耗时降至 memcpy 量级（50MB np1 预期 <30ms），且小体积 np1 同样走直通（无阈值）；
3. 校准阈值：在 1MB / 3MB / 5MB / 10MB 四档项目上做两条路径的交叉对比，确定 5MB 阈值是否需调整；
4. 主线程阻塞：Long Task API（`PerformanceObserver` `longtask`）记录解压期间 >50ms 任务数，目标为 0。

---

## 六、实施步骤（建议顺序）

1. **第一步：埋点与基线**——先在原路径上加解压计时与基准项目集，拿到"现状"数据（没有基线不开始改造）；
2. **第二步：WorkerUnzipper 独立实现**——含中央目录解析、Worker 池、fflate inflate、CRC32 校验、降级链，以纯函数形式自测（Node 环境可单测中央目录解析与 inflate 正确性）；
3. **第三步：JSZip 兼容层 + patch 接入 sb3.js**——阈值开关默认关闭（灰度），回归清单全绿后默认开启；
4. **第四步：阈值校准与调优**——按第五节数据定阈值与池大小；
5. **第五步（可选）**：与 fflate 全面替换 jszip（上位方案 4.2-1）合并评估——若 Worker 池路径稳定，主线程回退路径也可换 fflate，最终移除 jszip 依赖。

---

## 七、风险与注意事项

- **编码兼容性**：zip 条目文件名编码（UTF-8 标志位 vs CP437）是自研中央目录解析最容易踩的坑，中文素材项目必须进回归清单；
- **CSP/协议限制**：Worker 脚本在 `tw-editor://` 自定义协议页面下的加载方式（独立文件 vs Blob 内联）需先行验证，Blocked by CSP 时调整 `worker-src`；
- **内存峰值**：超大项目（100MB+）载入期间压缩包 + 解压产物双份驻留，虽与原路径同量级，仍需在低内存机器上实测；
- **np1 文件体积副作用**：np1 不压缩、文件显著大于同内容 sb3，读盘 IO 阶段耗时更长——该阶段在主进程读文件处（`editor.js:165-171`），不在本方案范围，但端到端对比时应预期"np1 读盘慢、VM 内解压快"，避免误判本方案收益；
- **不破坏对外契约**：`vm.loadProject` 的输入输出、错误类型、事件序列（`PROJECT_CHANGED` 等）必须与原路径完全一致——调用方（desktop-hoc 三处、AI 工具链）零感知；
- **patch 管理**：对 `sb3.js` 的改动一律走 patch-package，保持与 TurboWarp develop 上游可合并；WorkerUnzipper 本体放在桌面端源码（`src-renderer-webpack/editor/`）而非 VM 内，VM 侧 patch 仅留注入点。

/**
 * 依赖定制点校验：确认升级上游依赖后，NeoWarp 的定制仍然完整。
 *
 * 用法：node scripts/sync-upstream/verify-deps.mjs
 * 退出码 0 表示全部通过，1 表示存在缺失项。
 */
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.join(import.meta.dirname, '../..'));

/**
 * @param {string} relativePath 相对仓库根的路径
 * @param {string} pattern 需要出现的文本
 */
const check = (relativePath, pattern, label) => {
    const filePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(filePath)) {
        return {ok: false, label, detail: '文件不存在'};
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const ok = pattern instanceof RegExp
        ? pattern.test(content)
        : content.includes(pattern);
    return {ok, label, detail: ok ? '' : '定制内容缺失'};
};

const checks = [
    // ===== scratch-vm 定制 =====
    check('node_modules/scratch-vm/src/engine/tw-platform.js', 'NeoWarp', 'VM 品牌为 NeoWarp'),
    check('node_modules/scratch-vm/src/extension-support/extension-manager.js', 'nw-expands:', 'VM 支持 nw-expands: 协议'),
    check('node_modules/scratch-vm/src/extension-support/extension-manager.js', /filename=js\/extension-worker\/extension-worker\.\[contenthash\]\.js/, 'VM worker-loader webpack5 适配'),
    check('node_modules/scratch-vm/src/extension-support/tw-load-script-as-plain-text.js', 'createChildCompiler', 'VM 子编译器 webpack5 适配'),
    check('node_modules/scratch-vm/src/virtual-machine.js', 'saveProjectNp1', 'VM 提供 np1 导出 API'),
    check('node_modules/scratch-vm/src/virtual-machine.js', 'saveProjectNp1Stream', 'VM 提供 np1 流式导出 API'),
    check('node_modules/scratch-vm/src/engine/runtime.js', 'RUNTIME_DISPOSED', 'VM 提供 RUNTIME_DISPOSED 事件（权限丢弃联动依赖）'),

    // ===== scratch-blocks 圆角定制 =====
    check('node_modules/scratch-blocks/core/block_render_svg_vertical.js', 'TOP_LEFT_CORNER_START', 'blocks 垂直圆角 getter'),
    check('node_modules/scratch-blocks/core/block_render_svg_horizontal.js', 'TOP_LEFT_CORNER_START', 'blocks 水平圆角 getter'),
    check('node_modules/scratch-blocks/blockly_compressed_vertical.js', 'TOP_LEFT_CORNER_START', 'blocks 垂直压缩产物圆角注入'),
    check('node_modules/scratch-blocks/blockly_compressed_horizontal.js', 'TOP_LEFT_CORNER_START', 'blocks 水平压缩产物圆角注入'),

    // ===== scratch-storage worker-loader 适配 =====
    check('node_modules/@turbowarp/scratch-storage/src/FetchWorkerTool.js', '"inline":"fallback"', 'storage worker-loader 适配'),

    // ===== scratch-gui 定制 =====
    check('node_modules/scratch-gui/src/lib/brand.js', /neowarp/i, 'GUI 品牌为 NeoWarp'),
    check('node_modules/scratch-gui/src/lib/tw-neowarp-extensions.js', 'extension', 'GUI 自研扩展库模块存在'),
    check('node_modules/scratch-gui/src/lib/tw-my-extensions.js', 'extension', 'GUI 我的扩展模块存在'),
    check('node_modules/scratch-gui/src/components/tw-my-extension-modal/my-extension-modal.jsx', 'Modal', 'GUI 我的扩展弹窗存在'),
    check('node_modules/scratch-gui/src/containers/extension-library.css', '.', 'GUI 扩展库样式存在'),
    check('node_modules/scratch-gui/src/components/menu-bar/menu-bar.jsx', 'NeoWarp', 'GUI 菜单栏 NeoWarp 定制'),
    check('node_modules/scratch-gui/src/containers/sb3-downloader.jsx', 'viewsb3', 'GUI 下载器支持 NeoWarp 文件格式'),
    check('node_modules/scratch-gui/src/lib/tw-fetch-image-from-url.js', 'fetch', 'GUI 图片抓取模块存在'),

    // ===== 上游新特性 =====
    check('node_modules/scratch-gui/src/addons/addons/debugger/performance.js', 'performance', '上游 debugger 性能分析页存在'),
    check('node_modules/scratch-gui/src/addons/addons/debugger/timing/SamplingProfiler.js', 'SamplingProfiler', '上游采样分析器存在'),
    check('node_modules/scratch-gui/src/addons/addons/debugger/timing/InterpreterProfiler.js', 'InterpreterProfiler', '上游解释器分析器存在')
];

// 品牌文件与二进制资源单独确认存在
const extraFiles = [
    'node_modules/scratch-gui/src/components/loader/logo.png',
    'node_modules/scratch-gui/src/components/menu-bar/ai-icon.svg',
    'node_modules/scratch-gui/src/components/stage-header/icon--detach.svg'
];

console.log('=== 依赖定制点校验 ===');
let failed = 0;
for (const item of checks) {
    if (item.ok) {
        console.log(`  ✓ ${item.label}`);
    } else {
        failed++;
        console.log(`  ✗ ${item.label}（${item.detail}）`);
    }
}
for (const file of extraFiles) {
    const exists = fs.existsSync(path.join(repoRoot, file));
    if (exists) {
        console.log(`  ✓ 资源存在: ${path.basename(file)}`);
    } else {
        failed++;
        console.log(`  ✗ 资源缺失: ${file}`);
    }
}

// 依赖版本一览
console.log('\n=== 依赖版本 ===');
const packages = [
    'scratch-gui',
    'scratch-vm',
    'scratch-blocks',
    'scratch-render',
    'scratch-paint',
    '@turbowarp/scratch-storage',
    '@turbowarp/scratch-svg-renderer'
];
for (const pkg of packages) {
    const pkgPath = path.join(repoRoot, 'node_modules', pkg, 'package.json');
    if (fs.existsSync(pkgPath)) {
        const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
        console.log(`  ${pkg}@${version}`);
    } else {
        console.log(`  ${pkg}: 缺失`);
    }
}

console.log(`\n汇总: ${checks.length + extraFiles.length - failed} 项通过, ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);

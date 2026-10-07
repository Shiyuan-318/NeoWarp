/**
 * NeoWarp 网页版构建脚本
 *
 * 把桌面版源码里的渲染层页面（src-renderer/*）与 webpack 产物组装成
 * 一个可直接部署的静态站点，并为每个页面注入浏览器版 preload 兼容层。
 *
 * 用法：
 *   node web/build.mjs
 *   node web/build.mjs --gui ../dist-renderer-webpack/editor
 *   node web/build.mjs --out dist-web --version 2.0.0
 *
 * 参数：
 *   --root   仓库根目录，默认为脚本所在目录的上一级
 *   --out    输出目录，默认 <root>/dist-web
 *   --gui    scratch-gui webpack 产物目录（dist-renderer-webpack/editor）
 *   --version 版本号，默认读取 package.json
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs (argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      i++;
    } else {
      result[key] = true;
    }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(args.root || path.join(__dirname, '..'));
const OUT = path.resolve(args.out || path.join(ROOT, 'dist-web'));
const GUI_DIR = args.gui ? path.resolve(args.gui) : path.join(ROOT, 'dist-renderer-webpack', 'editor');
const MONACO_VERSION = '0.52.2';
const MONACO_CDNS = [
  `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`,
  `https://unpkg.com/monaco-editor@${MONACO_VERSION}/min/vs`
];

const packageJsonPath = path.join(ROOT, 'package.json');
const VERSION = typeof args.version === 'string'
  ? args.version
  : (fs.existsSync(packageJsonPath) ? JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).version : '2.0.0');

/* ------------------------------ 基础工具 ------------------------------ */
function ensureDir (dir) {
  fs.mkdirSync(dir, {recursive: true});
}

function copyFile (from, to) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function copyDir (from, to, filter) {
  if (!fs.existsSync(from)) return false;
  fs.cpSync(from, to, {
    recursive: true,
    filter: (source) => filter ? filter(source) : !source.endsWith('.map')
  });
  return true;
}

function readIfExists (filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return fs.readFileSync(filePath, 'utf-8');
}

let copiedFiles = 0;

function track (to) {
  copiedFiles++;
  return to;
}

/* --------------------------- 注入 preload shim --------------------------- */
/**
 * 在 </head> 前注入脚本。所有的 preload 对象必须在页面自身脚本执行前就绪。
 * extraHead（如翻译数据）先于脚本注入，保证 shim 加载时即可读取。
 */
function injectScripts (html, scripts, extraHead = '') {
  const tags = scripts.map((src) => `<script src="${src}"></script>`).join('\n    ');
  const block = `    ${extraHead ? `${extraHead}\n    ` : ''}${tags}\n  `;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${block}</head>`);
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<head>\n  ${block}</head>\n<body$1>`);
  }
  return html.replace(/<html[^>]*>/i, `$&<head>\n  ${block}</head>`);
}

/**
 * 计算某个页面引用运行时资源所需的相对路径
 * @param {string} outPath 相对输出目录的页面路径
 * @param {string[]} shimNames 需要注入的 shim 名称（不含 .js）
 */
function pageAssets (outPath, shimNames = [], vendorNames = []) {
  const depth = outPath.split('/').length - 1;
  const prefix = depth === 0 ? './assets' : '../'.repeat(depth) + 'assets';
  return [
    ...vendorNames.map((name) => `${prefix}/vendor/${name}`),
    `${prefix}/nw-core.js`,
    ...shimNames.map((name) => `${prefix}/shims/${name}.js`)
  ];
}

function buildPage ({
  source, target, scripts, head = '', transform
}) {
  let html = fs.readFileSync(source, 'utf-8');
  if (transform) html = transform(html);
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, injectScripts(html, scripts, head), 'utf-8');
  track(target);
}

/* ------------------------------ 开始构建 ------------------------------ */
console.log(`[NeoWarp Web] 源码根目录：${ROOT}`);
console.log(`[NeoWarp Web] 输出目录：${OUT}`);

if (fs.existsSync(OUT)) fs.rmSync(OUT, {recursive: true, force: true});
ensureDir(OUT);

const webSrc = path.join(ROOT, 'web', 'src');
const overlay = path.join(ROOT, 'web', 'overlay');
const srcRenderer = path.join(ROOT, 'src-renderer');

/* ---------- 1. 运行时核心：把 core/*.js 拼成一个 nw-core.js ---------- */
const coreDir = path.join(webSrc, 'core');
const coreFiles = fs.readdirSync(coreDir).filter((f) => f.endsWith('.js')).sort();
if (!coreFiles.length) throw new Error('没有找到运行时源码：' + coreDir);
const core = [
  '/* NeoWarp Web Runtime — 由 web/build.mjs 自动生成，请勿直接修改 */',
  '(function () {',
  '  window.NW_VERSION = ' + JSON.stringify(VERSION) + ';',
  '  window.NW_MONACO_CDNS = ' + JSON.stringify(MONACO_CDNS) + ';',
  '})();',
  ...coreFiles.map((f) => `/* ===== ${f} ===== */\n${fs.readFileSync(path.join(coreDir, f), 'utf-8')}`)
].join('\n');
ensureDir(path.join(OUT, 'assets'));
fs.writeFileSync(path.join(OUT, 'assets', 'nw-core.js'), core, 'utf-8');
console.log(`[NeoWarp Web] 运行时核心已生成（${coreFiles.length} 个模块）`);

/* ---------- 2. shims ---------- */
const shimDir = path.join(webSrc, 'shims');
const shimTargets = path.join(OUT, 'assets', 'shims');
copyDir(shimDir, shimTargets);
console.log('[NeoWarp Web] preload 兼容层已复制');

/* ---------- 2.5 WebRTC 信令与二维码等浏览器库（nw-core 前加载） ---------- */
const vendorDir = path.join(ROOT, 'web', 'vendor');
const vendorsOut = path.join(OUT, 'assets', 'vendor');
ensureDir(vendorsOut);
for (const vendor of fs.readdirSync(vendorDir)) {
  copyFile(path.join(vendorDir, vendor), path.join(vendorsOut, vendor));
}

/* ---------- 3. 主页 ---------- */
/**
 * 优先使用桌面版真源码（src-renderer/home/home.html），
 * web/overlay/ 仅作为「源码里没有该页面」时的兜底。
 */
const HOME_HEAD = [
  '<link rel="manifest" href="manifest.webmanifest">',
  '<meta name="theme-color" content="#ff4c4c">'
].join('\n    ');

const homeSource = [
  path.join(srcRenderer, 'home', 'home.html'),
  path.join(overlay, 'index.html')
].find((p) => fs.existsSync(p));

/** 桌面版用 shell.openExternal 打开外链；网页版必须避免把用户从应用里带走 */
const fixHomeLinks = (html) => html
  .replace(/<a(\s+id="github-button"[^>]*)>/g, '<a$1 target="_blank" rel="noopener noreferrer">');

if (homeSource) {
  buildPage({
    source: homeSource,
    target: path.join(OUT, 'index.html'),
    scripts: ['./assets/nw-core.js', './assets/shims/home.js', './pwa.js'],
    head: HOME_HEAD,
    transform: fixHomeLinks
  });
  console.log(`[NeoWarp Web] 主页来源：${path.relative(ROOT, homeSource)}`);
} else {
  console.warn('[NeoWarp Web] 缺少主页源码，已跳过');
}

const logoSource = [
  path.join(srcRenderer, 'home', 'logo.png'),
  path.join(overlay, 'logo.png')
].find((p) => fs.existsSync(p));
if (logoSource) copyFile(logoSource, path.join(OUT, 'logo.png'));

const iconSource = [path.join(ROOT, 'Logo.png'), path.join(ROOT, 'art', 'icon.png')]
  .find((p) => fs.existsSync(p));
if (iconSource) copyFile(iconSource, path.join(OUT, 'favicon.png'));

/* ---------- 4. PWA / Service Worker / manifest ---------- */
const pwaFiles = ['sw.js', 'pwa.js', 'manifest.webmanifest', 'version.json', '_headers'];
const BUILT_AT = new Date().toISOString().slice(0, 10);
const PWA_TEMPLATE_FILES = new Set(['sw.js', 'pwa.js', 'version.json', 'manifest.webmanifest']);
for (const file of pwaFiles) {
  const from = path.join(webSrc, 'pwa', file);
  if (!fs.existsSync(from)) {
    console.warn(`[NeoWarp Web] 缺少 PWA 文件：${file}`);
    continue;
  }
  if (PWA_TEMPLATE_FILES.has(file)) {
    fs.writeFileSync(
      path.join(OUT, file),
      fs.readFileSync(from, 'utf-8')
        .replace(/__VERSION__/g, VERSION)
        .replace(/__BUILT_AT__/g, BUILT_AT),
      'utf-8'
    );
  } else {
    copyFile(from, path.join(OUT, file));
  }
}

/* CNAME：只有显式提供时才写入，避免误改用户的自定义域名 */
const cnameSources = [
  typeof args.cname === 'string' ? null : path.join(overlay, 'CNAME'),
  typeof args.cname === 'string' ? path.resolve(args.cname) : null
].filter(Boolean);
const cnameSource = cnameSources.find((p) => fs.existsSync(p));
if (typeof args.cname === 'string' && !cnameSource) {
  fs.writeFileSync(path.join(OUT, 'CNAME'), `${args.cname}\n`, 'utf-8');
} else if (cnameSource) {
  copyFile(cnameSource, path.join(OUT, 'CNAME'));
}

/* ---------- 5. 静态页面 Defs ---------- */
const MISC_SHIM = ['../assets/shims/misc.js'];

/** 手机预览面板：网页版是 WebRTC 实时串流而非局域网独立副本，调整说明文案 */
function enhanceMobilePreview (html) {
  return html
    .replace(/<h1>手机预览<\/h1>/, '<h1>手机观看舞台</h1>')
    .replace(/<p class="subtitle">用手机扫码或打开链接，即可在其他设备上运行当前项目<\/p>/,
      '<p class="subtitle">用手机扫码，实时观看当前项目的舞台画面并远程控制</p>')
    .replace(/<li>确保手机与这台电脑连接在同一个 Wi-Fi 或局域网中。<\/li>/,
      '<li>手机和电脑都联网即可，通过浏览器点对点（WebRTC）直连，画面实时同步。</li>')
    .replace(/<li>页面会自动下载当前项目并开始运行，可以直接在手机上点击、拖动操作。<\/li>/,
      '<li>手机端实时显示电脑端舞台画面，可用底部按钮远程点击绿旗、暂停或停止。</li>')
    .replace(/<p class="note">([\s\S]*?)<\/p>/,
      '<p class="note">手机端看到的就是电脑端编辑器的实时舞台画面（含监视器与提问框）。<br>' +
      '关闭这个窗口会断开手机端连接。<br>如果无法连接，请检查电脑网络对 WebRTC 的限制。</p>')
    .replace(/setStatus\('预览服务已启动，端口 ' \+ result\.port, 'ok'\)/,
      'setStatus(result.port === \'P2P\' ? \'P2P 实时串流已就绪，请扫码连接\' : \'预览服务已启动，端口 \' + result.port, \'ok\')');
}

/** 页面清单：源路径 -> 输出路径 + 需要的 shim */
const pages = [
  {
    from: path.join(srcRenderer, 'desktop-settings', 'desktop-settings.html'),
    to: 'desktop-settings/desktop-settings.html',
    shims: ['desktop-settings'],
    strings: true
  },
  {
    from: path.join(srcRenderer, 'image-editor', 'index.html'),
    to: 'image-editor/index.html',
    shims: ['image-editor']
  },
  {
    from: path.join(srcRenderer, 'about', 'about.html'),
    to: 'about/about.html',
    shims: ['misc']
  },
  {
    from: path.join(srcRenderer, 'privacy', 'privacy.html'),
    to: 'privacy/privacy.html',
    shims: ['misc']
  },
  {
    from: path.join(srcRenderer, 'contact', 'contact.html'),
    to: 'contact/contact.html',
    shims: ['misc']
  },
  {
    from: path.join(srcRenderer, 'task-manager', 'task-manager.html'),
    to: 'task-manager/task-manager.html',
    shims: ['misc']
  },
  {
    from: path.join(srcRenderer, 'todo-list', 'todo-list.html'),
    to: 'todo-list/todo-list.html',
    shims: ['misc']
  },
  {
    from: path.join(srcRenderer, 'project-analysis', 'project-analysis.html'),
    to: 'project-analysis/project-analysis.html',
    shims: ['misc']
  },
  {
    from: path.join(srcRenderer, 'mobile-preview', 'mobile-preview.html'),
    to: 'mobile-preview/mobile-preview.html',
    shims: ['misc'],
    vendors: ['mqtt.min.js', 'qrcode.min.js'],
    transform: enhanceMobilePreview
  },
  {
    from: path.join(srcRenderer, 'detached-stage', 'index.html'),
    to: 'detached-stage/index.html',
    shims: ['misc']
  },
  {
    from: path.join(srcRenderer, 'file-access', 'file-access.html'),
    to: 'file-access/file-access.html',
    shims: ['misc']
  }
];

/* 桌面设置需要同步返回 strings，这里预先把翻译注入为全局变量 */function buildDesktopSettingsStrings () {
  const enPath = path.join(ROOT, 'src-main', 'l10n', 'en.json');
  const generatedPath = path.join(ROOT, 'src-main', 'l10n', 'generated-translations.json');
  const result = {};
  if (fs.existsSync(enPath)) {
    const enRaw = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
    result.en = Object.fromEntries(Object.entries(enRaw).map(([key, value]) => [key, value.string ?? value]));
  }
  if (fs.existsSync(generatedPath)) {
    const generated = JSON.parse(fs.readFileSync(generatedPath, 'utf-8'));
    for (const locale of ['zh-cn', 'ja', 'ru', 'ko', 'tr', 'de', 'es', 'fr']) {
      const translations = generated[locale];
      if (!translations) continue;
      result[locale] = Object.assign({}, result.en, translations);
    }
  }
  return result;
}
const desktopSettingsStrings = buildDesktopSettingsStrings();

for (const page of pages) {
  if (!fs.existsSync(page.from)) {
    console.warn(`[NeoWarp Web] 跳过缺失页面：${path.relative(ROOT, page.from)}`);
    continue;
  }
  const head = page.strings
    ? `<script>window.NW_DESKTOP_SETTINGS_STRINGS=${JSON.stringify(desktopSettingsStrings)};</script>`
    : '';
  buildPage({
    source: page.from,
    target: path.join(OUT, page.to),
    scripts: pageAssets(page.to, page.shims, page.vendors || []),
    head,
    transform: page.transform
  });
}

/* 项目分析页面依赖 html2canvas */
const html2canvas = path.join(srcRenderer, 'project-analysis', 'html2canvas.min.js');
if (fs.existsSync(html2canvas)) copyFile(html2canvas, path.join(OUT, 'project-analysis', 'html2canvas.min.js'));

/* ---------- 6. AI 助手 ---------- */
const aiHtmlPath = [
  path.join(srcRenderer, 'ai-assistant', 'ai-assistant.html'),
  path.join(overlay, 'ai', 'ai-assistant.html')
].find((p) => fs.existsSync(p));
if (aiHtmlPath) {
  // remote-bridge.js 必须在 AI 主脚本之前执行（IS_REMOTE 依赖 window.__NeoWarpRemote）；
  // 注入在 head 里天然先于 body 底部的页面脚本
  const aiScripts = pageAssets('ai/ai-assistant.html', ['ai-assistant'], ['mqtt.min.js']);
  aiScripts.splice(aiScripts.length, 0, 'remote-bridge.js');
  buildPage({
    source: aiHtmlPath,
    target: path.join(OUT, 'ai', 'ai-assistant.html'),
    scripts: aiScripts
  });
  for (const asset of ['qrcode.min.js', 'Logo.png', 'ai-assistant.css', 'ai-assistant.js', 'remote-bridge.js']) {
    const from = path.join(path.dirname(aiHtmlPath), asset);
    if (fs.existsSync(from)) copyFile(from, path.join(OUT, 'ai', asset));
  }
}

/* ---------- 7. 扩展编辑器 ---------- */
const extensionEditorDir = path.join(srcRenderer, 'extension-editor');
/**
 * Monaco 加载策略：
 *  - 默认本地打包（--monaco-cdn 可切换为纯 CDN）：与桌面版一致、离线可用、无 CDN 往返延迟
 *  - 本地源缺失时自动退回 CDN，并在构建日志中提示
 */
const useLocalMonaco = !args['monaco-cdn'];
const localMonacoSource = path.join(extensionEditorDir, 'vs');
const hasLocalMonaco = fs.existsSync(path.join(localMonacoSource, 'loader.js')) &&
  fs.existsSync(path.join(localMonacoSource, 'editor', 'editor.main.js'));
const effectiveMonacoLocal = useLocalMonaco && hasLocalMonaco;

if (fs.existsSync(extensionEditorDir)) {
  const monacoHead = effectiveMonacoLocal ? '' : [
    `<script src="${MONACO_CDNS[0]}/loader.js"></script>`,
    '<script>',
    '  (function () {',
    '    var bases = window.NW_MONACO_CDNS || [];',
    '    var current = 0;',
    '    function tryLoad () {',
    '      if (window.require || current >= bases.length) { window.__NW_MONACO_BASE = bases[Math.min(current, bases.length - 1)]; return; }',
    '      document.write(\'<scr\' + \'ipt src="\' + bases[current++] + \'/loader.js"><\\/script>\');',
    '      document.write(\'<scr\' + \'ipt>tryLoad();<\\/script>\');',
    '    }',
    '    if (!window.require) { tryLoad(); if (bases.length && !window.__NW_MONACO_BASE) window.__NW_MONACO_BASE = bases[0]; }',
    '    else { window.__NW_MONACO_BASE = bases[0]; }',
    '  })();',
    '</script>'
  ].join('');

  const replaceMonacoPaths = (js) => js
    .replace(/window\.require\.config\(\{paths:\s*\{vs:\s*'\.\/vs'\}\}\)/g, "window.require.config({paths: {vs: window.__NW_MONACO_BASE || './vs'}})")
    .replace(/require\.config\(\{paths:\s*\{vs:\s*'\.\/vs'\}\}\)/g, "require.config({paths: {vs: window.__NW_MONACO_BASE || './vs'}})");

  buildPage({
    source: path.join(extensionEditorDir, 'extension-editor.html'),
    target: path.join(OUT, 'extension-editor', 'extension-editor.html'),
    scripts: pageAssets('extension-editor/extension-editor.html', ['extension-editor']),
    head: monacoHead,
    // 本地模式保留原生的 vs/loader.js 引用；CDN 模式才移除
    transform: effectiveMonacoLocal
      ? undefined
      : (html) => html.replace(/<script\s+src="vs\/loader\.js"><\/script>/g, '')
  });

  fs.writeFileSync(
    path.join(OUT, 'extension-editor', 'extension-editor.js'),
    replaceMonacoPaths(fs.readFileSync(path.join(extensionEditorDir, 'extension-editor.js'), 'utf-8')),
    'utf-8'
  );
  for (const file of ['extension-editor.css', 'ai-shared.js']) {
    copyFile(path.join(extensionEditorDir, file), path.join(OUT, 'extension-editor', file));
  }

  buildPage({
    source: path.join(extensionEditorDir, 'ai-panel.html'),
    target: path.join(OUT, 'extension-editor', 'ai-panel.html'),
    scripts: pageAssets('extension-editor/ai-panel.html', ['ai-panel'])
  });
  copyFile(path.join(extensionEditorDir, 'ai-panel.js'), path.join(OUT, 'extension-editor', 'ai-panel.js'));

  if (effectiveMonacoLocal) {
    console.log('[NeoWarp Web] 复制本地 Monaco 资源（离线可用）…');
    copyDir(localMonacoSource, path.join(OUT, 'extension-editor', 'vs'));
  } else if (useLocalMonaco) {
    console.warn('[NeoWarp Web] 本地 Monaco 缺失（' + localMonacoSource + '），已退回 CDN 模式');
  }
}

/* ---------- 8. 编辑器 GUI ---------- */
/**
 * 编辑器是整站最重的页面，这里是「打开更快」的主要发力点：
 *  - index.js 用 preload 提前进入队列，不必等到 body 末尾才被发现
 *  - 启动超过 8 秒仍未挂载时给出「清除缓存并重试」的出口
 */
const GUI_STYLE = [
  '<style>',
  '  .splash-reset {',
  '    color: inherit;',
  '    background: none;',
  '    padding: 0;',
  '    margin: 0;',
  '    border: none;',
  '    font-family: inherit;',
  '    font-size: inherit;',
  '    text-decoration: underline;',
  '    cursor: pointer;',
  '  }',
  '  .splash-reset[hidden] { display: none; }',
  '</style>'
].join('\n    ');

const GUI_HEAD = [
  '<link rel="manifest" href="../manifest.webmanifest">',
  '<link rel="preload" href="index.js" as="script" fetchpriority="high">',
  GUI_STYLE
].join('\n    ');

const GUI_BOOTSTRAP = [
  '    <script>',
  '      function webpackScriptError (event) {',
  "        alert('Error loading webpack script: ' + event.target.src);",
  '      }',
  '    </script>',
  '    <script src="index.js" onerror="webpackScriptError(event)"></script>',
  '    <script>',
  '      // 启动超过 8 秒仍未就绪（未加上 .tw-loaded）时，显示「清除缓存」入口',
  '      (function () {',
  "        var resetButton = document.getElementById('splash-reset');",
  '        if (!resetButton) return;',
  "        resetButton.addEventListener('click', function () {",
  '          if (window.NeoWarpPWA) window.NeoWarpPWA.reset();',
  '        });',
  '        setTimeout(function () {',
  "          var app = document.getElementById('app');",
  "          var ready = document.body.classList.contains('tw-loaded') || (app && app.children.length > 0);",
  '          if (!ready) {',
  '            resetButton.hidden = false;',
  '          }',
  '        }, 8000);',
  '      })();',
  '    </script>'
].join('\n');

const enhanceGuiHtml = (html) => html
  // 移除原始 script 引用与同名兜底函数，交由 GUI_BOOTSTRAP 统一处理
  .replace(/<script\s+src="?index\.js"?[^>]*><\/script>/g, '')
  .replace(/<script>\s*function webpackScriptError[\s\S]*?<\/script>/g, '')
  .replace(
    '<div class="splash-spinner"></div>',
    '<div class="splash-spinner"></div>\n      <button class="splash-reset" id="splash-reset" type="button" hidden>加载有问题？点此清除缓存并重试</button>'
  )
  .replace(/<\/body>/i, `${GUI_BOOTSTRAP}\n  </body>`);

const guiOut = path.join(OUT, 'gui');
if (fs.existsSync(GUI_DIR)) {
  // 兼容两种布局：webpack 产物目录（<dir>/gui/index.js）与 gh-pages 部署目录（<dir>/index.js）
  const guiSourceDir = fs.existsSync(path.join(GUI_DIR, 'gui'))
    ? path.join(GUI_DIR, 'gui')
    : (fs.existsSync(path.join(GUI_DIR, 'index.js')) ? GUI_DIR : null);
  if (guiSourceDir) {
    for (const entry of fs.readdirSync(guiSourceDir)) {
      if (entry.endsWith('.map')) continue;
      const from = path.join(guiSourceDir, entry);
      if (fs.statSync(from).isDirectory()) {
        copyDir(from, path.join(guiOut, entry), (source) => !source.endsWith('.map'));
      } else {
        copyFile(from, path.join(guiOut, entry));
      }
    }
    // 删除 webpack 自带 html，稍后用注入版覆盖
    ['gui.html', 'index.html', 'addons.html'].forEach((name) => {
      const file = path.join(guiOut, name);
      if (fs.existsSync(file)) fs.rmSync(file);
    });
    // 删除历史版本遗留脚本，避免与新版运行时冲突
    ['inapp-window.js', 'web-preload-shim.js', 'home-shim.js'].forEach((name) => {
      const file = path.join(guiOut, name);
      if (fs.existsSync(file)) fs.rmSync(file);
    });
    console.log('[NeoWarp Web] scratch-gui 构建产物已复制');
  }

  const guiHtmlSource = path.join(ROOT, 'src-renderer-webpack', 'editor', 'gui', 'gui.html');
  if (fs.existsSync(guiHtmlSource)) {
    buildPage({
      source: guiHtmlSource,
      target: path.join(guiOut, 'gui.html'),
      scripts: pageAssets('gui/gui.html', ['editor'], ['mqtt.min.js']),
      head: GUI_HEAD,
      transform: enhanceGuiHtml
    });
  }
  const migrateHelper = path.join(ROOT, 'src-renderer-webpack', 'editor', 'gui', 'migrate-helper.html');
  if (fs.existsSync(migrateHelper)) copyFile(migrateHelper, path.join(guiOut, 'migrate-helper.html'));
} else {
  console.warn(`[NeoWarp Web] 未找到 gui 构建产物（${GUI_DIR}），编辑器页面将被跳过`);
  console.warn('[NeoWarp Web] 解决方法：git clone 后在根目录执行 npm ci && npm run webpack:prod，或传入 --gui <目录>');
}

/* ---------- 7. 手机端观看舞台（WebRTC viewer） ---------- */
const remoteViewerSource = path.join(ROOT, 'web', 'remote-src', 'index.html');
if (fs.existsSync(remoteViewerSource)) {
  copyFile(remoteViewerSource, path.join(OUT, 'remote', 'index.html'));
  console.log('[NeoWarp Web] 手机观看舞台页面已生成');
}

/* ---------- 8. 附加组件设置 ---------- */
const addonsDir = path.join(GUI_DIR, 'addons');
const addonsHtmlSource = path.join(ROOT, 'src-renderer-webpack', 'editor', 'addons', 'addons.html');
if (fs.existsSync(addonsHtmlSource) && fs.existsSync(addonsDir)) {
  for (const entry of fs.readdirSync(addonsDir)) {
    if (entry.endsWith('.map')) continue;
    const from = path.join(addonsDir, entry);
    if (fs.statSync(from).isDirectory()) copyDir(from, path.join(OUT, 'addons', entry));
    else copyFile(from, path.join(OUT, 'addons', entry));
  }
  buildPage({
    source: addonsHtmlSource,
    target: path.join(OUT, 'addons', 'addons.html'),
    scripts: pageAssets('addons/addons.html', ['misc'])
  });
}

/* ---------- 10. 完成 ---------- */
const totalSize = (function measure (dir) {
  let size = 0;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    size += entry.isDirectory() ? measure(full) : fs.statSync(full).size;
  }
  return size;
})(OUT);

console.log(`[NeoWarp Web] 构建完成：${copiedFiles} 个文件，共 ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
console.log(`[NeoWarp Web] 输出：${OUT}`);

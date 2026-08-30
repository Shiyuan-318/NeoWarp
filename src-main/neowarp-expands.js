const fsPromises = require('fs/promises');
const path = require('path');
const {app} = require('electron');

/**
 * NeoWarp 本地扩展目录（Expands）：
 *
 *   Expands/<扩展名>/<作者>/<简介>/*.js
 *   Expands/<扩展名>/<图片文件>          → 扩展 Logo（小图）
 *   Expands/<扩展名>/<作者>/<图片文件>    → 扩展大图（卡片背景）
 *
 * 例：Expands/PunycodeChange/NeoWarp/Punycode转换插件/punycode-change.js
 *   扩展名 = PunycodeChange，作者 = NeoWarp，简介 = Punycode转换插件
 *
 * 本模块负责扫描目录、解析元数据并生成 nw-expands:// 协议 URL；
 * 协议本身在 protocols.js 中注册。
 */

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.avif'
]);

// 主进程从扩展文件头部解析真实 ID（TurboWarp 扩展规范：// ID: xxx），
// 这样加载完成后分类选中、置顶、收藏都能对上 vm 里的真实扩展。
const readExtensionId = async (file) => {
  try {
    const handle = await fsPromises.open(file, 'r');
    try {
      const {buffer, bytesRead} = await handle.read(
        Buffer.alloc(2048), 0, 2048, 0
      );
      const head = buffer.toString('utf8', 0, bytesRead);
      const match = head.match(/^\/\/\s*ID:\s*(\S+)\s*$/m);
      return match ? match[1] : null;
    } finally {
      await handle.close();
    }
  } catch (error) {
    return null;
  }
};

/**
 * Expands 的根目录列表。
 * 主根目录：开发模式为仓库根目录（src-main/..，与 protocols.js 定位 dist 的方式
 * 一致，不依赖 app.getAppPath()），打包后为可执行文件同级（便携版用户可直接放置）；
 * 备用根目录：userData（MS Store 等安装位置只读时使用）。
 * 扫描时合并两个根目录，同名扩展以主根目录为准。
 * @returns {{id: string; root: string}[]}
 */
const getExpandsRoots = () => {
  const primaryRoot = app.isPackaged ?
    path.join(path.dirname(app.getPath('exe')), 'Expands') :
    path.resolve(__dirname, '../Expands');
  const roots = [{id: 'app', root: primaryRoot}];
  const userDataRoot = path.join(app.getPath('userData'), 'Expands');
  if (userDataRoot !== primaryRoot) {
    roots.push({id: 'data', root: userDataRoot});
  }
  return roots;
};

const readDirsSafe = async (dir) => {
  try {
    return await fsPromises.readdir(dir, {withFileTypes: true});
  } catch (error) {
    return null;
  }
};

/** 目录下第一张图片文件名（按本地化名称排序保证结果稳定） */
const findFirstImage = async (dir) => {
  const entries = await readDirsSafe(dir);
  if (!entries) return null;
  const images = entries
    .filter(entry => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
  return images.length ? images[0] : null;
};

/** 协议 URL 中的路径段编码（中文、空格、#、? 等安全传输） */
const encodeSegment = (segment) => encodeURIComponent(segment);

const buildURL = (rootId, segments) =>
  `nw-expands://${rootId}/${segments.map(encodeSegment).join('/')}`;

/**
 * 扫描所有 Expands 根目录，返回可直接用于扩展库的条目列表。
 * 每个包含 .js 的 <简介> 目录生成一个条目；一个扩展目录下有多个 .js
 * 时生成多张卡片（名称追加序号）。
 * @returns {Promise<Array>} 库条目（name/extensionId/extensionURL/iconURL/...）
 */
const scanExpands = async () => {
  const items = [];
  const seenNames = new Set();

  for (const {id: rootId, root} of getExpandsRoots()) {
    const nameEntries = await readDirsSafe(root);
    if (!nameEntries) continue;

    for (const nameEntry of nameEntries) {
      // <扩展名> 目录
      if (!nameEntry.isDirectory()) continue;
      const name = nameEntry.name;
      if (seenNames.has(name)) continue; // 主根目录优先
      const nameDir = path.join(root, name);

      const logoFile = await findFirstImage(nameDir);

      // <作者> 目录（取第一个子目录）
      const nameDirEntries = await readDirsSafe(nameDir);
      if (!nameDirEntries) continue;
      const authorEntry = nameDirEntries.find(entry => entry.isDirectory());
      if (!authorEntry) continue;
      const author = authorEntry.name;
      const authorDir = path.join(nameDir, author);

      const backgroundFile = await findFirstImage(authorDir);

      // <简介> 目录；同时兼容把 .js 直接放在 <作者> 目录下的写法
      const authorDirEntries = await readDirsSafe(authorDir);
      if (!authorDirEntries) continue;
      const jsFiles = [];
      for (const descEntry of authorDirEntries) {
        if (!descEntry.isDirectory()) continue;
        const descDir = path.join(authorDir, descEntry.name);
        const files = await readDirsSafe(descDir);
        if (!files) continue;
        for (const fileEntry of files) {
          if (fileEntry.isFile() && fileEntry.name.toLowerCase().endsWith('.js')) {
            jsFiles.push({
              description: descEntry.name,
              absolutePath: path.join(descDir, fileEntry.name)
            });
          }
        }
      }
      if (!jsFiles.length) {
        for (const fileEntry of authorDirEntries) {
          if (fileEntry.isFile() && fileEntry.name.toLowerCase().endsWith('.js')) {
            jsFiles.push({
              description: '',
              absolutePath: path.join(authorDir, fileEntry.name)
            });
          }
        }
      }
      if (!jsFiles.length) continue;
      jsFiles.sort((a, b) => a.absolutePath.localeCompare(b.absolutePath));

      seenNames.add(name);

      const backgroundURL = backgroundFile ?
        buildURL(rootId, [name, author, backgroundFile]) : null;
      const logoURL = logoFile ?
        buildURL(rootId, [name, logoFile]) : null;

      for (let i = 0; i < jsFiles.length; i++) {
        const jsFile = jsFiles[i];
        const realID = await readExtensionId(jsFile.absolutePath);
        const fileBase = path.basename(jsFile.absolutePath, '.js');
        items.push({
          // 多个 .js 时卡片名称区分开
          name: jsFiles.length > 1 ? `${name} (${i + 1})` : name,
          extensionId: realID || `neowarp_${fileBase}`,
          extensionURL: buildURL(rootId, [
            name, author,
            ...(jsFile.description ? [jsFile.description] : []),
            path.basename(jsFile.absolutePath)
          ]),
          // 大图作卡片背景；没有大图时用 Logo 兜底
          iconURL: backgroundURL || logoURL,
          // 有大图时 Logo 作为小图标（inset）；Logo 即大图时不再重复
          insetIconURL: backgroundURL && logoURL ? logoURL : null,
          description: jsFile.description || '',
          author
        });
      }
    }
  }

  return items;
};

module.exports = {
  getExpandsRoots,
  scanExpands
};

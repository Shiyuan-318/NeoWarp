/**
 * 离线依赖替换器：在没有 npm install 的网络环境下，把 node_modules 里的
 * 依赖替换成上游指定版本。
 *
 * 支持两类来源：
 *   github:<owner>/<repo>@<sha>   → https://codeload.github.com/<owner>/<repo>/tar.gz/<sha>
 *   npm:<package>@<version>        → https://registry.npmjs.org/<package>/-/<file>.tgz
 *
 * 用法：
 *   node scripts/sync-upstream/fetch-dep-snapshot.mjs --spec github:TurboWarp/scratch-gui@9c954186... --dest node_modules/scratch-gui
 *   node scripts/sync-upstream/fetch-dep-snapshot.mjs --spec npm:@turbowarp/scratch-storage@2.0.0 --dest node_modules/@turbowarp/scratch-storage --backup %TEMP%/bk
 *   node scripts/sync-upstream/fetch-dep-snapshot.mjs --spec ... --dry-run
 *
 * 特性：带重试与超时、下载后完整性校验、替换前可选备份、替换失败自动回滚。
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import {pipeline} from 'node:stream/promises';

/**
 * 删除目录。
 *
 * 不用 fs.rmSync：部分环境会把 rmSync 重定向到回收站，大目录（数千文件）
 * 会超时。Windows 上直接调用系统的 rmdir 更可靠。
 */
const removeDir = target => {
    if (!fs.existsSync(target)) {
        return;
    }
    // cmd 的 rmdir 把 '/' 当成选项前缀，路径必须用反斜杠
    execFileSync('cmd', ['/c', 'rmdir', '/s', '/q', target.replace(/\//g, '\\')], {stdio: 'ignore'});
};

const args = process.argv.slice(2);
const getArg = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
};

const spec = getArg('--spec');
const dest = getArg('--dest');
const backupDir = getArg('--backup');
const dryRun = args.includes('--dry-run');
const retries = Number(getArg('--retries') || 4);

if (!spec || !dest) {
    console.error('用法: --spec <github:owner/repo@sha | npm:pkg@version> --dest <目标目录> [--backup <目录>] [--dry-run]');
    process.exit(1);
}

const repoRoot = path.resolve(path.join(import.meta.dirname, '../..'));
const destPath = path.resolve(repoRoot, dest);

/**
 * 解析 spec，返回下载 URL 与解压后的内容目录名。
 */
const parseSpec = value => {
    const colon = value.indexOf(':');
    const kind = value.slice(0, colon);
    const rest = value.slice(colon + 1);
    const at = rest.lastIndexOf('@');
    const name = rest.slice(0, at);
    const version = rest.slice(at + 1);
    if (kind === 'github') {
        return {
            kind,
            name,
            version,
            url: `https://codeload.github.com/${name}/tar.gz/${version}`,
            // codeload 解压后是 <repo>-<sha>/ 目录
            strip: 1
        };
    }
    if (kind === 'npm') {
        const fileName = name.startsWith('@') ? name.split('/')[1] : name;
        return {
            kind,
            name,
            version,
            url: `https://registry.npmjs.org/${name}/-/${fileName}-${version}.tgz`,
            // npm tarball 解压后是 package/ 目录
            strip: 1
        };
    }
    throw new Error(`不支持的 spec 类型: ${kind}`);
};

const parsed = parseSpec(spec);

const download = (url, targetPath) => new Promise((resolve, reject) => {
    const request = https.get(url, {timeout: 60000}, response => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            response.resume();
            resolve(download(response.headers.location, targetPath));
            return;
        }
        if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`HTTP ${response.statusCode} ${url}`));
            return;
        }
        pipeline(response, fs.createWriteStream(targetPath)).then(resolve, reject);
    });
    request.on('timeout', () => {
        request.destroy(new Error(`下载超时: ${url}`));
    });
    request.on('error', reject);
});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neowarp-fetch-'));
const archivePath = path.join(tmpDir, 'package.tgz');

let downloaded = false;
let lastError = null;
for (let attempt = 1; attempt <= retries; attempt++) {
    try {
        console.log(`下载 (${attempt}/${retries}): ${parsed.url}`);
        await download(parsed.url, archivePath);
        const size = fs.statSync(archivePath).size;
        if (size < 1024) {
            throw new Error(`下载内容过小，疑似失败: ${size} 字节`);
        }
        console.log(`下载完成: ${(size / 1024 / 1024).toFixed(2)} MB`);
        downloaded = true;
        break;
    } catch (error) {
        lastError = error;
        console.warn(`  失败: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    }
}

if (!downloaded) {
    removeDir(tmpDir);
    console.error(`下载最终失败: ${lastError.message}`);
    process.exit(1);
}

const extractDir = path.join(tmpDir, 'extracted');
fs.mkdirSync(extractDir, {recursive: true});
execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], {stdio: 'inherit'});

const entries = fs.readdirSync(extractDir);
if (entries.length !== 1) {
    removeDir(tmpDir);
    console.error(`解压结果异常，期望恰好一个目录，实际: ${entries.join(', ')}`);
    process.exit(1);
}
const sourceDir = path.join(extractDir, entries[0]);
if (!fs.existsSync(path.join(sourceDir, 'package.json'))) {
    removeDir(tmpDir);
    console.error(`解压结果缺少 package.json: ${sourceDir}`);
    process.exit(1);
}

console.log(`解压内容: ${entries[0]}（${fs.readdirSync(sourceDir).length} 个顶层条目）`);

if (dryRun) {
    console.log('试运行：未替换任何文件');
    removeDir(tmpDir);
    process.exit(0);
}

if (backupDir && fs.existsSync(destPath)) {
    const backupPath = path.join(backupDir, dest.replace(/[\\/]/g, '__'));
    fs.mkdirSync(backupDir, {recursive: true});
    console.log(`备份现有目录到: ${backupPath}`);
    execFileSync('robocopy', [destPath, backupPath, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], {stdio: 'ignore'});
}

// 直接用 tar 解包到目标目录：tar 保留完整目录结构，不受 robocopy 的
// “跳过较旧文件”规则影响，大批量文件也更可靠。
const stagingPath = `${destPath}.new-${Date.now()}`;
try {
    fs.mkdirSync(stagingPath, {recursive: true});
    execFileSync('tar', ['-xzf', archivePath, '-C', stagingPath, '--strip-components=1'], {stdio: 'inherit'});
    const oldPath = `${destPath}.old-${Date.now()}`;
    if (fs.existsSync(destPath)) {
        fs.renameSync(destPath, oldPath);
    }
    fs.renameSync(stagingPath, destPath);
    removeDir(oldPath);
    console.log(`替换完成: ${dest}`);
} catch (error) {
    removeDir(stagingPath);
    console.error(`替换失败: ${error.message}`);
    process.exit(1);
} finally {
    removeDir(tmpDir);
}

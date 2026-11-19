/**
 * 生成 patch-package 兼容的补丁文件（不依赖 npm pack 取原始包）。
 *
 * patch-package 生成补丁时需要“原始包”作为基准，而本环境无法 npm install，
 * 因此这里用 git diff --no-index 对比：
 *   base   = 上游原版目录
 *   custom = 已应用定制的目录
 *
 * 用法：
 *   node scripts/sync-upstream/build-patch.mjs \
 *     --base <原版目录> --custom <定制版目录> --pkg node_modules/scratch-gui \
 *     --out patches/scratch-gui+3.2.37.patch
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
};

const repoRoot = path.resolve(path.join(import.meta.dirname, '../..'));
const baseDir = getArg('--base');
const customDir = getArg('--custom');
const pkgPath = getArg('--pkg');
const outPath = getArg('--out');
const binary = !args.includes('--no-binary');

if (!baseDir || !customDir || !pkgPath || !outPath) {
    console.error('用法: --base <原版目录> --custom <定制版目录> --pkg <node_modules 相对路径> --out <补丁输出路径>');
    process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neowarp-patch-'));
const baseName = path.basename(pkgPath);
const customName = path.basename(pkgPath);
fs.mkdirSync(path.join(tmpDir, 'base'), {recursive: true});
fs.mkdirSync(path.join(tmpDir, 'custom'), {recursive: true});

// git diff --no-index 输出 "a/<目录>/文件"，两个目录同名才能得到干净的路径
// robocopy 的退出码 0-7 都表示成功（1 = 有文件被复制），不能当错误处理
const robocopy = (from, to) => {
    try {
        execFileSync('robocopy', [from, to, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], {stdio: 'ignore'});
    } catch (error) {
        if (error.status === undefined || error.status >= 8) {
            throw error;
        }
    }
};

robocopy(path.resolve(repoRoot, baseDir), path.join(tmpDir, 'base', baseName));
robocopy(path.resolve(repoRoot, customDir), path.join(tmpDir, 'custom', customName));

const diffArgs = [
    'diff',
    '--no-index',
    '--binary',
    `--src-prefix=a/${pkgPath}/`,
    `--dst-prefix=b/${pkgPath}/`,
    path.join('base', baseName),
    path.join('custom', customName)
];
if (!binary) {
    diffArgs.splice(2, 1);
}

let diff;
try {
    diff = execFileSync('git', diffArgs, {
        cwd: tmpDir,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024
    });
} catch (error) {
    // 有差异时 git diff --no-index 以 1 退出，内容在 stdout
    diff = error.stdout ? error.stdout.toString() : '';
    if (!diff) {
        console.error(`生成补丁失败: ${error.message}`);
        process.exit(1);
    }
}

// 归一化路径：git 在 Windows 上输出反斜杠路径并可能加引号，
// 这里统一成正斜杠，并去掉 diff 中间的 base/ 与 custom/ 目录段
// （--src-prefix/--dst-prefix 已经指定了 node_modules 下的真实路径）。
//
// 注意：只能改路径行（diff --git / --- / +++）。内容行里的反斜杠是代码转义
// （例如正则 /\.sb3$/），全局替换会破坏补丁内容。
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const middleDirRe = new RegExp(`(?:base|custom)/+${escapeRegExp(baseName)}/`, 'g');

const normalizePathLine = line => {
    let result = line.replace(/\\/g, '/').replace(middleDirRe, '');
    if (result.startsWith('diff --git ')) {
        result = result.replace(/^diff --git "?(.+?)"? "?(.+?)"?$/, 'diff --git $1 $2');
    } else if (result.startsWith('--- ') || result.startsWith('+++ ')) {
        result = result.replace(/^(--- |\+\+\+ )"?(.+?)"?$/, '$1$2');
    }
    return result;
};

const normalized = diff
    .split('\n')
    .map(line => (line.startsWith('diff --git ') || line.startsWith('--- ') || line.startsWith('+++ '))
        ? normalizePathLine(line)
        : line)
    .join('\n');

const outFile = path.resolve(repoRoot, outPath);
fs.mkdirSync(path.dirname(outFile), {recursive: true});
fs.writeFileSync(outFile, normalized);

const fileCount = (normalized.match(/^diff --git/gm) || []).length;
const hunkCount = (normalized.match(/^@@/gm) || []).length;
console.log(`补丁已生成: ${outPath}`);
console.log(`  文件数 ${fileCount} / hunk 数 ${hunkCount} / 大小 ${(normalized.length / 1024).toFixed(1)} KB`);

execFileSync('cmd', ['/c', 'rmdir', '/s', '/q', tmpDir.replace(/\//g, '\\')], {stdio: 'ignore'});

/**
 * 把 NeoWarp 对 scratch-gui 的定制重新应用到新版本上游 GUI 上。
 *
 * 背景：NeoWarp 通过 patch-package 给 scratch-gui 打补丁（毛玻璃主题、圆角、
 * 品牌、AI 集成等 54 个文件 / 197 个 hunk）。升级上游 GUI 时整包被替换，
 * 需要把定制重新落回新版本上。
 *
 * 策略（按上游是否改过该文件分流）：
 *   - 上游没改（48 个文件）：定制后的内容与旧版本一致，直接把定制版拷回去。
 *   - 上游改过（6 个文件）：以旧上游版本为 base 做三方合并，冲突人工裁决。
 *
 * 用法：
 *   node scripts/sync-upstream/apply-gui-customizations.mjs \
 *     --backup <旧版定制备份目录> --old-ref 457e6408db1cf0b5308324061490bcdf746898e5
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
};

const repoRoot = path.resolve(path.join(import.meta.dirname, '../..'));
const backupRoot = getArg('--backup');
const oldRef = getArg('--old-ref');
const newRef = getArg('--new-ref');
const patchPath = getArg('--patch', 'patches/scratch-gui+3.2.37.patch');
const guiDir = path.join(repoRoot, 'node_modules/scratch-gui');
const upstreamRepo = getArg('--repo', 'TurboWarp/scratch-gui');
// GitHub API 要求 User-Agent 头，否则返回 403
const requestHeaders = {
    'User-Agent': 'NeoWarp-sync-upstream',
    'Accept': 'application/vnd.github+json'
};

if (!backupRoot || !oldRef || !newRef) {
    console.error('用法: --backup <备份目录> --old-ref <sha> --new-ref <sha>');
    process.exit(1);
}

/**
 * 解析 patch 文件，得到被定制的文件列表（相对 node_modules/scratch-gui 的路径）。
 */
const parsePatchFiles = patchFile => {
    const content = fs.readFileSync(path.join(repoRoot, patchFile), 'utf8');
    const files = new Set();
    const regex = /^diff --git a\/node_modules\/scratch-gui\/(.+?) b\/node_modules\/scratch-gui\//gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
        files.add(match[1]);
    }
    return [...files];
};

/**
 * 拉取 GitHub API 的两个提交之间的改动文件列表。
 */
const fetchChangedFiles = async () => {
    const url = `https://api.github.com/repos/${upstreamRepo}/compare/${oldRef}...${newRef}`;
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            const response = await new Promise((resolve, reject) => {
                const request = https.get(url, {timeout: 60000, headers: requestHeaders}, res => {
                    if (res.statusCode !== 200) {
                        res.resume();
                        reject(new Error(`HTTP ${res.statusCode}`));
                        return;
                    }
                    let data = '';
                    res.on('data', chunk => {
                        data += chunk;
                    });
                    res.on('end', () => resolve(data));
                });
                request.on('timeout', () => request.destroy(new Error('超时')));
                request.on('error', reject);
            });
            return JSON.parse(response).files.map(file => file.filename);
        } catch (error) {
            console.warn(`  拉取改动文件列表失败 (${attempt}/4): ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        }
    }
    throw new Error('无法获取上游改动文件列表');
};

/**
 * 判断某个文件在指定提交中是否存在。
 */
const fileExistsInRef = async (ref, file) => {
    const url = `https://raw.githubusercontent.com/${upstreamRepo}/${ref}/${file}`;
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            return await new Promise((resolve, reject) => {
                const request = https.get(url, {timeout: 60000, headers: requestHeaders, method: 'HEAD'}, res => {
                    res.resume();
                    resolve(res.statusCode === 200);
                });
                request.on('timeout', () => request.destroy(new Error('超时')));
                request.on('error', reject);
            });
        } catch (error) {
            if (attempt === 4) {
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        }
    }
    return false;
};

/**
 * 下载旧上游版本的单个文件内容（作为三方合并的 base）。
 */
const fetchOldFile = async file => {
    const url = `https://raw.githubusercontent.com/${upstreamRepo}/${oldRef}/${file}`;
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            return await new Promise((resolve, reject) => {
                const request = https.get(url, {timeout: 60000, headers: requestHeaders}, res => {
                    if (res.statusCode !== 200) {
                        res.resume();
                        reject(new Error(`HTTP ${res.statusCode}`));
                        return;
                    }
                    const chunks = [];
                    res.on('data', chunk => chunks.push(chunk));
                    res.on('end', () => resolve(Buffer.concat(chunks)));
                });
                request.on('timeout', () => request.destroy(new Error('超时')));
                request.on('error', reject);
            });
        } catch (error) {
            if (attempt === 4) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        }
    }
};

const customizedFiles = parsePatchFiles(patchPath);
console.log(`定制文件数（来自 ${patchPath}）: ${customizedFiles.length}`);

const changedFiles = new Set(await fetchChangedFiles());
console.log(`上游 ${oldRef.slice(0, 7)} → ${newRef.slice(0, 7)} 改动文件数: ${changedFiles.size}`);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neowarp-gui-'));
let copied = 0;
let merged = 0;
let restored = 0;
const conflicts = [];

for (const file of customizedFiles) {
    const customPath = path.join(backupRoot, file);
    const destPath = path.join(guiDir, file);

    if (!fs.existsSync(customPath)) {
        console.log(`跳过（备份中无此文件）: ${file}`);
        continue;
    }
    if (!fs.existsSync(destPath)) {
        // 新上游没有这个文件：要么上游删了它，要么它本来就是 NeoWarp 自己新增的。
        // 旧上游同样没有 → NeoWarp 新增文件，必须恢复，否则定制功能直接消失。
        const existsInOld = await fileExistsInRef(oldRef, file);
        if (!existsInOld) {
            fs.mkdirSync(path.dirname(destPath), {recursive: true});
            fs.copyFileSync(customPath, destPath);
            restored++;
            console.log(`恢复（NeoWarp 新增文件）: ${file}`);
        } else {
            console.log(`跳过（上游已删除该文件，需人工确认）: ${file}`);
        }
        continue;
    }

    if (!changedFiles.has(file)) {
        // 上游没动这个文件：定制后的内容直接落回去
        fs.copyFileSync(customPath, destPath);
        copied++;
        continue;
    }

    // 上游改过：三方合并（base = 旧上游，ours = 定制版，theirs = 新上游）
    console.log(`三方合并: ${file}`);
    const basePath = path.join(tmpDir, 'base');
    const oursPath = path.join(tmpDir, 'ours');
    const theirsPath = path.join(tmpDir, 'theirs');
    const baseContent = await fetchOldFile(file);
    fs.writeFileSync(basePath, baseContent);
    fs.copyFileSync(customPath, oursPath);
    fs.copyFileSync(destPath, theirsPath);

    let result;
    let hasConflict = false;
    try {
        result = execFileSync('git', ['merge-file', '-p', '--diff3', oursPath, basePath, theirsPath], {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024
        });
        hasConflict = /^(<{7}|={7}|>{7})/m.test(result);
    } catch (error) {
        result = error.stdout ? error.stdout.toString() : '';
        hasConflict = true;
    }

    if (hasConflict) {
        const mergedPath = path.join(repoRoot, `node_modules/scratch-gui/${file}.merged`);
        fs.writeFileSync(mergedPath, result);
        conflicts.push(file);
        console.log(`  冲突: ${file} → ${file}.merged`);
    } else {
        fs.writeFileSync(destPath, result);
        merged++;
        console.log('  自动合并成功');
    }
}

execFileSync('cmd', ['/c', 'rmdir', '/s', '/q', tmpDir.replace(/\//g, '\\')], {stdio: 'ignore'});

console.log(`\n汇总: 直接沿用 ${copied} 个, 三方合并 ${merged} 个, 恢复新增文件 ${restored} 个, 冲突 ${conflicts.length} 个`);
if (conflicts.length > 0) {
    console.log('冲突文件:');
    conflicts.forEach(file => console.log(`  ${file}`));
}

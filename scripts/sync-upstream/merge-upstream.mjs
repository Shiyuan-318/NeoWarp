/**
 * 三方合并助手：把上游 TurboWarp Desktop 的改动合并进 NeoWarp 工作区。
 *
 * NeoWarp 仓库是重新初始化的（没有上游 git 祖先），无法直接 git merge，
 * 因此对每个文件做树级三方合并：
 *   base   = 上游 fork 点 v1.15.3
 *   ours   = NeoWarp 当前工作区文件
 *   theirs = 上游目标版本 v1.17.1
 *
 * 用法：
 *   node scripts/sync-upstream/merge-upstream.mjs            # 试运行，只报告冲突情况
 *   node scripts/sync-upstream/merge-upstream.mjs --write    # 无冲突的文件直接写回工作区
 *   node scripts/sync-upstream/merge-upstream.mjs --write src-main/index.js
 *   node scripts/sync-upstream/merge-upstream.mjs --verify   # 校验工作区是否已包含上游增量
 *
 * 有冲突的文件不会写回工作区，合并结果（含冲突标记）写到 <file>.merged，
 * 由人工裁决后删掉 .merged 文件。
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE_REF = process.env.SYNC_BASE_REF || 'v1.15.3';
const THEIRS_REF = process.env.SYNC_THEIRS_REF || 'v1.17.1';

const args = process.argv.slice(2);
const write = args.includes('--write');
const verify = args.includes('--verify');
const files = args.filter(arg => !arg.startsWith('--'));

if (files.length === 0) {
    console.error('请至少指定一个文件');
    process.exit(1);
}

const repoRoot = path.resolve(path.join(import.meta.dirname, '../..'));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neowarp-merge-'));

const git = (args, options = {}) => execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options
});

/**
 * 读取某个 ref 下的文件内容，不存在时返回 null。
 */
const readFromRef = (ref, file) => {
    try {
        return git(['show', `${ref}:${file}`]);
    } catch {
        return null;
    }
};

let mergedCount = 0;
let conflictedCount = 0;
let missingCount = 0;

/**
 * 校验模式：把上游增量反向应用到工作区文件。
 *
 * 若工作区已经包含上游的全部改动，反向应用（撤销上游增量）能够干净地套用，
 * 说明上游改动已完整落地；套用失败则说明还有上游增量没有合进来。
 */
const verifyFile = (file) => {
    const diff = execFileSync('git', ['diff', BASE_REF, THEIRS_REF, '--', file], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024
    });
    if (!diff.trim()) {
        return {ok: true, reason: '上游无改动'};
    }
    const patchPath = path.join(tmpDir, 'verify.patch');
    fs.writeFileSync(patchPath, diff);
    try {
        execFileSync('git', ['apply', '-R', '--check', '--whitespace=nowarn', patchPath], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
        return {ok: true, reason: '已包含上游增量'};
    } catch (error) {
        const message = (error.stderr ? error.stderr.toString() : error.message).trim().split('\n')[0];
        return {ok: false, reason: message};
    }
};

for (const file of files) {
    const workPath = path.join(repoRoot, file);
    const ours = fs.existsSync(workPath) ? fs.readFileSync(workPath, 'utf8') : null;
    const base = readFromRef(BASE_REF, file);
    const theirs = readFromRef(THEIRS_REF, file);

    if (verify) {
        const result = verifyFile(file);
        if (result.ok) {
            mergedCount++;
            console.log(`✓ ${file}：${result.reason}`);
        } else {
            conflictedCount++;
            console.log(`✗ ${file}：${result.reason}`);
        }
        continue;
    }

    if (theirs === null) {
        console.log(`跳过（上游 ${THEIRS_REF} 无此文件）: ${file}`);
        missingCount++;
        continue;
    }
    if (ours === null) {
        console.log(`新增（工作区无此文件）: ${file}`);
        if (write) {
            fs.mkdirSync(path.dirname(workPath), {recursive: true});
            fs.writeFileSync(workPath, theirs);
        }
        mergedCount++;
        continue;
    }
    if (base === null) {
        console.log(`跳过（上游 ${BASE_REF} 无此文件，无法三方合并）: ${file}`);
        missingCount++;
        continue;
    }
    if (base === theirs) {
        console.log(`跳过（上游无改动）: ${file}`);
        missingCount++;
        continue;
    }

    const basePath = path.join(tmpDir, 'base');
    const theirsPath = path.join(tmpDir, 'theirs');
    const oursPath = path.join(tmpDir, 'ours');
    fs.writeFileSync(basePath, base);
    fs.writeFileSync(theirsPath, theirs);
    fs.writeFileSync(oursPath, ours);

    let merged;
    let hasConflict = false;
    try {
        merged = execFileSync('git', ['merge-file', '-p', '--diff3', oursPath, basePath, theirsPath], {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024
        });
        hasConflict = /^(<{7}|={7}|>{7})/m.test(merged);
    } catch (error) {
        // git merge-file 在存在冲突时以非 0 退出，结果仍在 stdout
        merged = error.stdout ? error.stdout.toString() : '';
        hasConflict = true;
    }

    const conflictCount = (merged.match(/^<{7}/gm) || []).length;
    const outPath = path.join(repoRoot, `${file}.merged`);

    if (hasConflict) {
        conflictedCount++;
        fs.writeFileSync(outPath, merged);
        console.log(`冲突 ${conflictCount} 处: ${file}  →  ${file}.merged（需人工裁决）`);
    } else {
        mergedCount++;
        console.log(`自动合并成功: ${file}`);
        if (write) {
            fs.writeFileSync(workPath, merged);
        }
    }
}

fs.rmSync(tmpDir, {recursive: true, force: true});
console.log(`\n汇总: 自动合并 ${mergedCount} 个, 冲突 ${conflictedCount} 个, 跳过 ${missingCount} 个`);
if (!write && conflictedCount > 0) {
    console.log('（当前为试运行，加 --write 写回无冲突的文件）');
}

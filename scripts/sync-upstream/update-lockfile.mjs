/**
 * 更新 package-lock.json 中的依赖版本记录。
 *
 * 这次同步是在没有 npm install 的环境下完成的（直接下载压缩包替换 node_modules），
 * 因此 lock 文件里的“原始来源”信息与实际安装状态不一致。这里把 lock 记录改成
 * 实际生效的版本/提交，保证将来在有网络的环境执行一次 npm install 时，
 * 装出来的就是当前这套依赖。
 *
 * 用法：node scripts/sync-upstream/update-lockfile.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.join(import.meta.dirname, '../..'));
const lockPath = path.join(repoRoot, 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

const updates = [
    {
        name: 'scratch-gui',
        version: '3.2.37',
        resolved: 'git+https://github.com/TurboWarp/scratch-gui.git#9c954186705af0d764d08aec86bad0c436c4829b'
    },
    {
        name: 'scratch-vm',
        version: '2.1.46',
        resolved: 'git+https://github.com/TurboWarp/scratch-vm.git#f26ff67e951258a84d25cad3acaf8804eb202318'
    },
    {
        name: 'scratch-blocks',
        version: '0.1.0',
        resolved: 'git+https://github.com/TurboWarp/scratch-blocks.git#4113c5348e6b4c76da9071a1800a62ab96ef793f'
    },
    {
        name: 'scratch-render',
        version: '0.1.0',
        resolved: 'git+https://github.com/TurboWarp/scratch-render.git#430b44fbff2040198ce526b05bae4f59f4e530ce'
    },
    {
        name: '@turbowarp/extensions',
        version: '0.0.1',
        resolved: 'git+https://github.com/TurboWarp/extensions.git#f115db183e5e9be98b7a49d89e9dc88cde18da2b'
    },
    {
        name: '@turbowarp/scratch-storage',
        version: '2.0.0',
        resolved: 'https://registry.npmjs.org/@turbowarp/scratch-storage/-/scratch-storage-2.0.0.tgz',
        integrity: 'sha512-Qi/wpKuf9Vd1FKYuwbh9NY4aB6nxh9V7ulQ03TFsWxZJfV1GOL8NiFRQMGFBDda00kUjWr5+f/eobbRAOqZpUg=='
    },
    {
        name: '@turbowarp/scratch-svg-renderer',
        version: '1.1.0',
        resolved: 'https://registry.npmjs.org/@turbowarp/scratch-svg-renderer/-/scratch-svg-renderer-1.1.0.tgz',
        integrity: 'sha512-UPSUNKfR9f73ZNgjYdxsz5yheZYO/EiKE3Wji31thRVDGzOJOROQXcFicl/1oDWkMII4FvSLylGAw6/MPpoXqg=='
    }
];

let changed = 0;
for (const update of updates) {
    const key = `node_modules/${update.name}`;
    const entry = lock.packages[key];
    if (!entry) {
        console.log(`跳过（lock 中无此条目）: ${update.name}`);
        continue;
    }
    const before = `${entry.version} ${entry.resolved || ''} ${entry.integrity || ''}`;
    entry.version = update.version;
    entry.resolved = update.resolved;
    if (update.integrity) {
        entry.integrity = update.integrity;
    }
    const after = `${entry.version} ${entry.resolved || ''} ${entry.integrity || ''}`;
    if (before !== after) {
        changed++;
        console.log(`更新 ${update.name}`);
        console.log(`  旧: ${before}`);
        console.log(`  新: ${after}`);
    }
}

// scratch-gui 升级后这两个依赖的版本范围也变了，必须同步更新，
// 否则 lock 里的依赖图会和新版 scratch-gui 的 package.json 对不上
const guiEntry = lock.packages['node_modules/scratch-gui'];
if (guiEntry && guiEntry.dependencies) {
    guiEntry.dependencies['@turbowarp/scratch-storage'] = '^2.0.0';
    guiEntry.dependencies['@turbowarp/scratch-svg-renderer'] = '^1.1.0';
    console.log('更新 scratch-gui 依赖清单');
}

// scratch-storage 2.0.0 的依赖清单与旧版不同，补齐新增项
const storageEntry = lock.packages['node_modules/@turbowarp/scratch-storage'];
if (storageEntry && storageEntry.dependencies) {
    storageEntry.dependencies = {
        '@babel/runtime': '7.21.0',
        '@turbowarp/nanolog': '^0.2.0',
        'arraybuffer-loader': '^1.0.3',
        'base64-js': '1.3.0',
        'cross-fetch': '3.1.5',
        'js-md5': '0.7.3',
        'worker-loader': '^2.0.0'
    };
    console.log('更新 @turbowarp/scratch-storage 依赖清单');
}

// svg-renderer 1.1.0 需要 dompurify ^3.4.5，在它下面嵌套一份 3.x
const svgRendererEntry = lock.packages['node_modules/@turbowarp/scratch-svg-renderer'];
if (svgRendererEntry && svgRendererEntry.dependencies) {
    svgRendererEntry.dependencies.dompurify = '^3.4.5';
    console.log('更新 @turbowarp/scratch-svg-renderer 依赖清单');
}
const nestedKey = 'node_modules/@turbowarp/scratch-svg-renderer/node_modules/dompurify';
if (!lock.packages[nestedKey]) {
    lock.packages[nestedKey] = {
        version: '3.4.18',
        resolved: 'https://registry.npmjs.org/dompurify/-/dompurify-3.4.18.tgz',
        integrity: 'sha512-ofe3wI/uNm68HInABYFJYqQxRw1EaKAjNdrFVKqjUY+UZurvNd2L/HuQe097s/4RivWiZyP6tT7aoT8atjfhwg==',
        dev: true,
        license: '(MPL-2.0 OR Apache-2.0)'
    };
    console.log('新增嵌套条目: dompurify@3.4.18');
} else if (!lock.packages[nestedKey].integrity) {
    lock.packages[nestedKey].integrity = 'sha512-ofe3wI/uNm68HInABYFJYqQxRw1EaKAjNdrFVKqjUY+UZurvNd2L/HuQe097s/4RivWiZyP6tT7aoT8atjfhwg==';
    console.log('补充嵌套条目完整性: dompurify@3.4.18');
}

fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`\npackage-lock.json 已更新（${changed} 个依赖条目）`);

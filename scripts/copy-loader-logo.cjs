// scratch-gui 的加载动画补丁（loader.jsx）引用了 node_modules 内的 logo.png，
// patch-package 无法保存二进制文件，因此在每次 install 后从项目根目录还原它。
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'Logo.png');
const destDir = path.join(__dirname, '..', 'node_modules', 'scratch-gui', 'src', 'components', 'loader');
const dest = path.join(destDir, 'logo.png');

try {
    if (fs.existsSync(src) && fs.existsSync(destDir) && !fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        console.log('[copy-loader-logo] Logo.png -> node_modules/scratch-gui/src/components/loader/logo.png');
    }
} catch (err) {
    console.warn('[copy-loader-logo] failed:', err.message);
}

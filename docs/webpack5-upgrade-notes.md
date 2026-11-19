# Webpack 4 → 5 升级记录（2026-11-18）

## 升级内容
- webpack 4.47.0 → 5.112.2，webpack-cli 4.10.0 → 7.3.1
- babel-loader 8.4.1 → 10.1.1，css-loader 1.0.1 → 7.1.5，postcss-loader 4.2.0 → 8.2.1
- style-loader 0.23.0 → 4.0.0，copy-webpack-plugin 6.4.1 → 14.0.0
- file-loader 移除（改用 webpack5 asset modules）；url-loader 保留（scratch-gui 插件内联引用）
- package.json `overrides`：`webpack ^5.112.2`、`worker-loader 3.0.8`
  - 原因：scratch-vm/scratch-gui/scratch-storage 内嵌套 webpack4 副本会导致
    `dependency.getCondition is not a function` 崩溃
  - worker-loader 1.x/2.x 只兼容 webpack4（tapable v2 无 Compiler.apply）

## webpack.config.cjs 迁移
- file-loader 规则 → `type: 'asset/resource'` + generator filename
- js 规则加 `type: 'javascript/auto'`（package.json 的 type:commonjs 会影响解析）
- css-loader v7：modules 对象内 `localsConvention` → `exportLocalsConvention`
- postcss 插件改为 require() 形式
- css-loader v7 默认 `modules.namedExport: true`（只导出具名导出），而 scratch-gui
  全部使用 `import styles from './x.css'` 默认导入，会导致 styles 为 undefined、
  运行时崩溃（如 crash-message 的 styles.crashWrapper），需显式 `namedExport: false`
- 两个配置均加 `resolve.fallback: { url: false }`（scratch-parser 内嵌 ajv6 引用 node url）

## 补丁变更（patches/）
- scratch-vm+2.1.46.patch：新增两处
  - extension-manager.js：worker-loader 查询迁移到 v3 语法（name→filename，[hash]→[contenthash]）
  - tw-load-script-as-plain-text.js：子编译器加独立 filename 并 deleteAsset
    （webpack5 会把子编译资产按名复制进父编译，重名报 Conflict）
- 新增 scratch-storage+1.3.6.patch、@turbowarp+scratch-storage+0.0.202505311821.patch：
  - FetchWorkerTool.js worker-loader 查询迁移到 v3（inline:true+fallback:true → inline:"fallback"）
- scratch-gui+3.2.37.patch：追加 api.js hunk
  - `global,` 简写 → `global: global`（webpack5 改写裸 global 后 terser 报语法错误）

## 其他
- scripts/copy-loader-logo.cjs：postinstall 时还原 scratch-gui loader 补丁所需的
  logo.png（patch-package 不支持二进制文件）
- package.json postinstall 改为 `patch-package && node scripts/copy-loader-logo.cjs`

## 回滚
- 完整备份在 upgrade-backup-20261118/（package.json、package-lock.json、
  webpack.config.cjs、.browserslistrc、patches/）
- 回滚步骤：恢复备份文件 → 删除 node_modules/.package-lock.json → npm install

## 已知事项
- 安装走 npmmirror 可直连（无需 VPN）
- 剩余警告均为无害（react-virtualized 等）
- 遗留：node_modules 下有 npm 残留临时目录（.caniuse-lite-* 等，CodeBuddy 安全删除
  机制拦截导致），不影响构建，可手动删除
- Electron 仍为 41.x（^41.10.7 未动，后续可单独评估升 45）

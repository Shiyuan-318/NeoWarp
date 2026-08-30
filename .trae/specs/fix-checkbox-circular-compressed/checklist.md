# Checklist

- [x] `node_modules/scratch-blocks/blockly_compressed_vertical.js` 中 `CHECKBOX_CORNER_RADIUS` 已改为 `CHECKBOX_SIZE / 2`
- [x] `patches/scratch-blocks+0.1.0.patch` 包含 `blockly_compressed_vertical.js` 的 `CHECKBOX_CORNER_RADIUS` 修改
- [x] `npm run webpack:compile` 构建成功（exit code 0）
- [x] 构建产物中加载的压缩版 scratch-blocks 使用圆形复选框
- [x] 编辑器中报告积木、变量、列表前方的复选框为正圆形
- [x] 勾选后的对勾显示正常、位置居中
- [x] 未修改 scratch-gui 源码，未新增其他 patch 文件
- [x] `.trae/developlog/log.md` 已记录本次修复

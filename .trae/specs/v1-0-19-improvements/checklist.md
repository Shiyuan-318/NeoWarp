# Checklist

- [x] package.json 中 version 字段为 "1.0.19"
- [x] 造型区圆角矩形调整功能验证：选中已绘制的圆角矩形后，画布旁出现"半径"和"曲率"滑块，拖动可实时调整形状
- [x] 圆角矩形调整标签为中文"半径"和"曲率"（非英文 "Radius"/"Curvature"）
- [x] `patches/scratch-paint+2.1.61.patch` 包含 rounded-rect-tool.js、rounded-rect-mode.jsx、corner-settings-indicator.jsx（含汉化）、reducers/rounded-rect.js、paint-editor.jsx 的修改
- [x] 项目分析内存占用数值合理，不再异常偏高（验证：创建一个含 50 个积木的项目，内存占用应在合理范围，不应因影子积木导致数值膨胀）
- [x] 内存百分比不再超过 100%
- [x] TurboWarp 设置弹窗外观分区所有文字为中文：标题"外观"、代码区背景标签"代码区背景："、按钮"选择图片"、帮助文字"为代码区（积木工作区）设置自定义背景图片。"、舞台区背景标签"舞台区背景："、清除按钮"清除"
- [x] `patches/scratch-gui+3.2.37.patch` 包含 settings-modal.jsx 外观分区汉化的修改
- [x] 积木区（flyout）中报告积木前的复选框为正圆形（非圆角矩形）
- [x] `patches/scratch-blocks+0.1.0.patch` 文件存在并包含 CHECKBOX_CORNER_RADIUS 的修改
- [x] `.trae/developlog/log.md` 包含本次开发记录

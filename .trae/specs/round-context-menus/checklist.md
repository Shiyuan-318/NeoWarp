# Checklist

- [x] `src-renderer-webpack/editor/gui/gui.css` 中存在针对 react-contextmenu 菜单容器的覆盖规则，`border-radius` 不小于 12px 且带 `overflow: hidden`
- [x] 菜单容器覆盖规则使用 `:global([class*="context-menu_context-menu_"])` 属性选择器形式，与项目既有 `[class*="menu-bar_menu-bar_"]` 写法一致
- [x] 菜单项覆盖规则使 hover 高亮呈圆角胶囊（`border-radius` 约 8px + 水平 margin）
- [x] 角色列表右键角色弹出的菜单容器与菜单项均为圆角
- [x] 造型列表右键造型弹出的菜单观感与角色右键菜单一致
- [x] 危险操作项（如"删除"）hover 时红色高亮同样为圆角胶囊
- [x] 深色与亮色主题下圆角形状保持、配色正常
- [x] 未修改 scratch-gui 源码、未新增 patch 文件，仅修改 gui.css
- [x] 菜单文字、功能、分隔线存在性、z-index、触发行为未被改变
- [x] `.trae/developlog/log.md` 已记录本次开发时间、内容与修改文件

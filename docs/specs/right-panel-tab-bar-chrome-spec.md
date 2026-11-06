# 右栏标签栏 Chrome 化 — 设计规格

- 状态：已实现（待 PR）
- 关联分支：`feat/chrome-style-tab-bar`
- 领域语言事实源：本文件 + `apps/electron/src/renderer/atoms/right-panel-tabs.ts`
- 取代：PR #550（已合）中的「已关闭标签历史 / History 入口」——本方案以「打开标签搜索」替代之

## 目标

右栏标签栏对标 Chrome 浏览器标签行为：累积常驻、自适应宽度、横向滚动、标签搜索、精细化关闭。

## 行为规格

1. **累积**：所有打开过的 tab 常驻、不主动清理，直到手动关闭。
   - 论文详情**按论文身份独立成 tab**（反转 #444 的单槽位复用）：`tabIdOfTarget` 对 paper/paper-entry
     返回 `paper:<key>`，key 取 `recordKey(record)` / `entry.key`（均 DOI 优先、同源逻辑）。
     同一篇论文的检索 record 与入库 entry 收敛到同一 tab（kind 随之切换）；不同论文各自累积。
   - file-preview 仍按 path 独立。
2. **默认 tab 常驻不可关**：`session-files` / `session-papers` 恒在最前、无 × 按钮、不可关闭
   （会话文件面板必须常驻；在「无关闭历史」模型下若可关则无处恢复），但与其余 tab 一起横向滚动，不钉死。
3. **自适应宽度**：tab `flex:1 1 auto` + `min-w 56px / max-w 180px`；多时等比收窄，极窄态只剩
   图标 + 截断标题，hover tooltip 显全名。
4. **溢出滚动**：超出可视宽度横向滚动（`overflow-x-auto` + `scrollbar-none`），两端按需出现 ‹ › 箭头；
   激活 tab 变化时 `scrollIntoView` 滚入可视区。tab 不再隐藏进下拉。
5. **标签搜索/列表**：右侧 🔍 popover，列出所有打开 tab，可按标题过滤、点选即激活并滚动到位。
6. **关闭方式**：
   - 每个非默认 tab 单独 ×（及中键点击关闭）。
   - 右键单 tab → 上下文菜单：`关闭` / `关闭其他` / `关闭右侧标签`（均跳过默认 tab）。
   - **无**顶部「关闭全部」一键全清。

## 数据模型（right-panel-tabs.ts）

- `SessionTabsState = { tabs, activeId }`（移除 #550 的 `closedTabs` 历史栈）。
- 纯函数：`upsertTab` / `closeTab`（默认 tab no-op）/ `closeOtherTabs(keepId)` / `closeTabsToRight(id)`；
  后两者保留默认 tab。`isDefaultTabId(id)` 暴露给 UI 判定可关性。
- 移除：`closeAllTabs`、`PAPER_PREVIEW_TAB_ID`、`closedTabs`/`CLOSED_TABS_LIMIT`。

## i18n（en+zh）

新增 `rightPanel.tabSearch.{trigger,placeholder,empty}`、`rightPanel.context.{close,closeOthers,closeRight}`、
`rightPanel.scrollLeft`、`rightPanel.scrollRight`；移除 `rightPanel.{closeTab,closeAll,restoreTab}`。

## 测试

`right-panel-tabs.test.ts` 覆盖：paper 按 key 独立 / record↔entry 收敛、默认 tab 不可关、
`closeOtherTabs` / `closeTabsToRight` 保留默认 tab、累积语义。

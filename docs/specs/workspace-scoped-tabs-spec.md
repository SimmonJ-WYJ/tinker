# 顶部会话 Tab 按 Workspace 过滤 Spec（Workspace-Scoped Tabs）

> **状态**：已实现
> **关联 issue**：#458
> **关联 PR**：#623
> **领域语言事实源**：`CONTEXT.md`

---

## 1. 问题

顶部会话 tab 栏跨项目混显（#458）：在项目 A 打开多个会话后切到项目 B，A 的 tab 仍留在 tab 栏；
启动恢复（`main.tsx` `TabStatePersistenceInitializer`）只保留当前 workspace 的 tab 并**永久丢弃**其他 workspace 的 tab。

期望行为：

1. tab 栏只显示当前 workspace 的 tab
2. 各 workspace 的"已打开 tab 集"独立持久化，重启后各自还原
3. 切回某 workspace 时还原离开时的 active tab

## 2. 方案

保留单一全局 `tabsAtom`（跨 workspace 的 tab 继续存活、后台流式会话不中断），在其上叠加可见性过滤：

| 层 | 改动 |
|----|------|
| 数据 | `TabItem` 增加可选 `workspaceId?: string`，所有 `openTab` 生产点填充；`agentSessionsAtom` 订阅自愈回填 |
| 派生 | `visibleTabsAtom` = 按 `currentAgentWorkspaceIdAtom` 过滤；`workspaceId == null` 的 tab 各处可见（兼容 review 投影 / legacy 会话） |
| 记忆 | `activeTabIdByWorkspaceAtom: Record<wsId, tabId>`；写入按 **tab 自身归属** 记 key（激活路径先写 tabsAtom 后写 activeTabIdAtom，顺序无关）；`switchActiveSessionForWorkspace` 在"active 已属新 ws"之后、"tabbed session"之前插入记忆命中优先级 |
| 关闭 | `closeTab` 邻位在**可见子集**内计算，避免激活隐藏的外部 workspace tab；无可见邻位 → `activeTabId: null` |
| 持久化 | `settings.tabState` 存全量 tab（带 workspaceId）+ `activeTabIdByWorkspace` map；恢复时保留所有 session 仍存在的 tab，workspaceId 以 session meta 回填为准，归属已删 workspace 的 tab 丢弃 |

### 设计取舍

- **不做** per-workspace 独立 tabs 数组 swap：全局数组 + 过滤视图等价实现需求，且后台 workspace 的流式会话/keep-alive 行为零改动
- `TabBar` 点击外部 tab 跳 workspace 的分支保留为安全网（过滤后不可达）
- `TabContent`/`MainArea` 内容渲染仍读全局 `tabsAtom`：切 workspace 瞬间 activeTabId 短暂指向旧 workspace tab，scoped 查找会闪"tab 不存在"兜底

### 兼容性

- 旧 `settings.json`（tab 无 `workspaceId`、无 `activeTabIdByWorkspace`）：恢复时从 session meta 回填，记忆 map 缺省走原 fallback 链；无迁移脚本
- `packages/shared` 无改动（`PersistedTabSettings` 仅存在于 `apps/electron/src/types/settings.ts`，主进程不读 `tabState`）

## 3. 触点清单

- `apps/electron/src/renderer/atoms/tab-atoms.ts` — 类型 + 纯函数 + 新 atoms
- `apps/electron/src/renderer/components/tabs/TabBar.tsx`、`MainArea.tsx` — 可见集渲染
- `apps/electron/src/renderer/hooks/useGlobalAgentListeners.ts` — 切 workspace 路由 + 回填订阅
- `apps/electron/src/renderer/hooks/useOpenSession.ts`、`useCreateSession.ts` — 生产点
- `apps/electron/src/renderer/main.tsx` — 持久化恢复/写入
- `apps/electron/src/types/settings.ts` — `PersistedTabSettings`
- 次要：`GlobalShortcuts.tsx`、`WelcomeView.tsx`、`LeftSidebar.tsx`、`ArchivedSettings.tsx`

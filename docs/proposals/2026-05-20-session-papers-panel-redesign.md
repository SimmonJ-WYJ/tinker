# Session Papers Panel · UX 重做设计

**日期**: 2026-05-20
**目标**: 右栏 Session files / 检索结果面板的复杂度减负 + 交互重构
**范围**: `apps/electron/src/renderer/components/agent/SessionPapers*` 全部组件
**分批**: 建议拆 2 个 PR（结构拆分 → UX 重做），避免 800+ 行单 PR

## 背景与痛点

当前右栏 `SessionPapersPanel.tsx`（878 行）承载 Agent 检索结果。用户反馈三个痛点：

1. **Dashboard 过于复杂**：常驻 Year 直方图 + Source 横向 bar + Relevance 五段渐变，信息密度高。Agent chat 场景以决策（挑论文）为主，不是数据探索，仪表盘对单次决策没用。
2. **Toolbar 操作堆积**：一行塞入多选框 / 搜索 / count badge / info / filter / sort / refresh / expand = 7 个交互单元，高低频不分层。
3. **常驻 checkbox 侵略屏效**：每张卡片左侧 24px checkbox 始终显示，但大多数时候用户不在做多选，视觉上像 todo list 不像论文条目。

## 设计原则

| Principle | 说明 |
|-----------|------|
| **P1 默认轻量、按需深入** | 常驻态做"瘦"；复杂功能（Overview / 多选 / Filter）藏到二级入口 |
| **P2 操作分层** | 高频常驻 / 中频按钮 / 低频菜单 |
| **P3 渐进式选择** | Checkbox 不常驻；显式按钮触发多选态后再常驻 |
| **P4 信息密度服从场景** | 检索结果 = 决策导向，dashboard 默认不展开 |

## 三态布局

### 默认态

```
┌────────────────────────────────────────────────┐
│ Session files  .../default/198c65c1-3726-4d... │
├────────────────────────────────────────────────┤
│ [🔍 search...]               30  [↕ Relevance ▾] │  ← Zone 1 高频
│ [📊 Overview] [⚙ Filter]              [⋮ More] │  ← Zone 2 中频按钮
├────────────────────────────────────────────────┤
│ Blockchain for Tokenized Real-World Assets...  │
│   ~72 · 2025 · Damodar Bihani et al.           │
│   [Link] [Add to Zotero]                       │
├────────────────────────────────────────────────┤
│ A Taxonomy of Tokenisation Methods...          │
│   ~72 · 2025 · Nihad Aliyev                    │
└────────────────────────────────────────────────┘
```

- Zone 1（持久可见）：搜索框 + 总数 + sort 下拉
- Zone 2（持久可见但低视觉权重）：Overview / Filter 触发器 + ⋮ More 菜单
- 卡片列表：**无 checkbox**

### Overview Popover 展开

点击「📊 Overview」按钮 → 触发器变 active 态 → 下方弹出 Popover：

```
┌─ 30 篇分布概览 ──────────┐
│ 年份                     │
│ ▂▂▃▅▄▅▆▅▃▂  (sparkline) │
│ 1970────────────2026     │
│                          │
│ 来源                     │
│ [Crossref · 15]          │
│ [OpenAlex · 15]          │
│                          │
│ 相关度                   │
│ ▒▒▒▒▒▒▒▒ Low → High     │
└──────────────────────────┘
```

可视化简化：
- 年份：sparkline（自绘单条曲线，不要 57 段柱状）
- 来源：chip 列表
- 相关度：单条 lo-hi 渐变 bar

### 多选态

通过「⋮ More」→「☐ 批量操作」**显式触发**。进入后：

```
┌────────────────────────────────────────────────┐
│ ■ 已选 2 / 30      [Add to Zotero] [Tag] [✕]  │  ← Bulk action bar（黑底）
├────────────────────────────────────────────────┤
│ ☑ Blockchain for Tokenized Real-World Assets   │
│ ☑ A Taxonomy of Tokenisation Methods           │
│ ☐ A Study on STOs of Public Assets             │
└────────────────────────────────────────────────┘
```

- 所有卡片左侧出现 checkbox
- 顶部黑色 bulk-bar 提供批量动作（Add to Zotero / Tag / Remove from session）+ ✕ 退出
- 退出后 selectedKeys 清空，checkbox 隐藏，回到默认态

### 「⋮ More」菜单

| 项 | 行为 |
|----|------|
| ↻ 刷新 | 重新拉 `listSessionPapers(sessionId)`（保留现 refresh 按钮功能） |
| ☐ 批量操作 | toggle `multiSelectActiveAtom` |
| ⤢ 在新窗口打开 | 现有 expand 按钮功能 |
| 显示密度 · 紧凑/标准 | toggle `densityAtom`（可选；不做也行） |

## 组件结构（重组后）

```
SessionPapersPanel.tsx              orchestrator (~200 行)
├── <SessionPapersHeader>           路径栏 + count
├── <SessionPapersToolbar>          Zone 1 + Zone 2
│   ├── <SessionPapersSearchInput>
│   ├── <SessionPapersSortMenu>
│   ├── <SessionPapersStatsPopoverTrigger>
│   ├── <SessionPapersFilterPopoverTrigger>
│   └── <SessionPapersMoreMenu>
├── <SessionPapersBulkActionBar>    多选态显示
└── <SessionPapersList>
    └── <SessionPaperCard>          multiSelect mode 决定是否渲 checkbox
```

## 文件改动地图

### 新增（6）

| 文件 | 行数 | 责任 |
|------|------|------|
| `SessionPapersStatsPopover.tsx` | ~150 | Radix Popover 包裹简化可视化（sparkline + chip + lo-hi bar） |
| `SessionPapersBulkActionBar.tsx` | ~80 | 顶部黑色 bar，已选计数 + 批量动作 + ✕ |
| `SessionPapersMoreMenu.tsx` | ~60 | DropdownMenu：刷新 / 批量 / 新窗 / 密度 |
| `SessionPapersToolbar.tsx` | ~120 | Zone 1 + Zone 2 容器，纯展示 + 上抛事件 |
| `SessionPaperCard.tsx` | ~180 | 从 Panel 抽出，props: `multiSelectActive`, `density` |
| `session-papers-ui-atoms.ts` | ~30 | 新增 atoms：multiSelectActive / selectedKeys / density |

### 重构（1）

| 文件 | 当前行数 → 目标 | 改动 |
|------|----------------|------|
| `SessionPapersPanel.tsx` | 878 → ~200 | 抽出 Toolbar / List / Card / BulkActionBar 子组件；读新增 atoms；orchestrator only |

### 删除（1）

| 文件 | 原因 |
|------|------|
| `SessionPapersStatsBar.tsx` (332 行) | 整块替换为 StatsPopover；数据层 `session-papers-stats.ts` 保留 |

### 微动（2）

| 文件 | 改动 |
|------|------|
| `SessionPapersFilterPopover.tsx` | 不动逻辑；只在 Toolbar 改触发位置 |
| `locales/{zh,en}/conversation.json` | 新增 ~10 keys（批量操作 / 已选 N / 显示密度 / Overview chip 文案等），zh+en 同步，key-parity 守门 |

## 数据层（保留不动）

- `sessionPapersFilterFamilyAtom(sessionId)` — 过滤状态
- `sessionPapersSortFamilyAtom(sessionId)` — 排序状态
- `session-papers-filter.ts` — 过滤/排序/去重逻辑
- `session-papers-stats.ts` — 直方图 / 来源 / 相关度聚合
- `workspacePapersAtom` — workspace 级 paper 数据

## 新增 atoms（session-papers-ui-atoms.ts）

```ts
import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'

/** 多选模式是否激活，per session */
export const sessionPapersMultiSelectActiveFamilyAtom = atomFamily(
  (_sessionId: string) => atom<boolean>(false),
)

/** 已选 paper key Set，per session；多选退出时清空 */
export const sessionPapersSelectedKeysFamilyAtom = atomFamily(
  (_sessionId: string) => atom<Set<string>>(new Set()),
)

/** 显示密度 'compact' | 'normal'，全局（不分 session） */
export const sessionPapersDensityAtom = atom<'compact' | 'normal'>('normal')
```

## 交互细节

### 多选态进入/退出

- **进入**：「⋮」→「☐ 批量操作」→ `setMultiSelectActive(true)`
- **退出**：bulk-bar 上的 ✕ 或 ESC 键 → `setMultiSelectActive(false)` + `setSelectedKeys(new Set())`
- **切换 session 时**：多选态自动重置（session-scoped atom，新 session 默认 false）

### Overview Popover 触发器

- 按钮在 Zone 2 第一个位置
- 默认 ghost 样式；popover 打开时变 `bg-accent text-accent-foreground`
- 用 Radix Popover；点击外部 / ESC 关闭

### 卡片 checkbox 隐藏 vs 显示

- 默认态：`hidden`（CSS `display: none`）
- 多选态：所有卡片显示 checkbox（不 hover 触发）
- 这样多选态进入后视觉变化明确，不依赖 hover-only 触发

## 分批合并策略

### PR 1：结构拆分（无可见变化）

- 把 `SessionPapersPanel` 拆成 Toolbar / List / Card / 子组件
- 旧 UI 完全保留，行为不变
- review 聚焦在「大块代码移动是否安全」
- 工程量：1.5 天

### PR 2：UX 重做

- 在拆好的结构上做：
  - StatsBar → StatsPopover
  - MoreMenu 加入
  - 多选态 + BulkActionBar
  - 卡片 checkbox 显示逻辑
  - i18n
- review 聚焦在「交互逻辑是否正确」
- 工程量：3-4 天

## 工程量总计

| 任务 | 人天 |
|------|------|
| Panel 拆分（PR 1） | 1.5 |
| StatsPopover（含简化可视化） | 1 |
| 多选 + BulkActionBar | 1 |
| MoreMenu + 显示密度 | 0.5 |
| Toolbar 重构 + 视觉打磨 | 0.5 |
| i18n + zh/en 同步 + key-parity | 0.5 |
| 测试 + 走查 | 0.5–1 |
| **合计** | **5–5.5 人天** |

## 验证标准

- [ ] 默认态：toolbar 视觉权重清晰，列表卡片无 checkbox
- [ ] 「📊 Overview」点击弹出 Popover，再次点击或 ESC 关闭
- [ ] 「⚙ Filter」点击弹出现有 FilterPopover（逻辑不变）
- [ ] 「⋮」展开菜单 4 项，「批量操作」toggle 进入多选态
- [ ] 多选态：所有卡片 checkbox 显示，顶部 bulk-bar 显示
- [ ] bulk-bar 「Add to Zotero」批量提交（沿用现有 Add to Zotero IPC）
- [ ] bulk-bar ✕ 或 ESC 退出多选态，selectedKeys 清空
- [ ] 切换 session：多选态自动重置
- [ ] zh ↔ en 切换：新增 keys 双语正常
- [ ] `bun run typecheck` + `bun test` 通过

## 不在范围

- **批量 Tag / Remove from session**：需要新 IPC，本次只接现有 Add to Zotero；其它批量动作显示但 toast「待上线」
- **显示密度持久化**：先做内存态，不写设置文件
- **Command Palette (Cmd+K)**：方案 C 提过，本轮不做
- **移动端 / 小窗适配**：不在 0.2.x 范围
- **批量动作的真实业务接口**（如批量打标签）：依赖数据层进一步设计

## Out of Scope · 后续可考虑

- StatsPopover 加「过滤入口」（点 chip 直接 filter by source）
- 多选态支持 shift-click 范围选择
- 卡片右侧加 hover quick action（「+」加 Note、「📌」收藏到 ProjectFiles）

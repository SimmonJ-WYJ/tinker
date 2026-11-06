# 标签族语义规范 Spec（Badge / Chip Semantic Specification）

> **状态**：草稿 · 待 review
> **关联 issue**：（待补，归属 B-5 / [#295](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/295) palette 收敛系列）
> **关联 PR**：（待开）
> **领域语言事实源**：本 spec 定义"标签族（tag / badge / chip）"的语义术语；落地后并入 `docs/design.md` §6.1 + 新增 §8.4
> **同类参照**：[`settings-style-unification-spec.md`](./settings-style-unification-spec.md) · [`typography-unification-spec.md`](./typography-unification-spec.md)

---

## 1. 背景与动机

代码里"标签"类视觉元素（tag / badge / chip / pill / label）当前有 **5 套并存配方**，缺统一语义入口：

| 配方 | 位置 | 风格 |
|---|---|---|
| `Badge`（shadcn 基座） | `components/ui/badge.tsx` | 单轴 `variant`，**solid** 为主，缺 success/warning |
| `SettingsPill` | `components/settings/primitives/SettingsPill.tsx` | 独立 `tone` 轴，**soft `/10`** |
| `Button` `chip` variant | `components/ui/button.tsx` | 胶囊按钮 |
| 行内 chip | `components/ai-elements/inline-label-style.ts` | **14px** 贴正文，中性底 |
| 各调用点手写 className | SessionPaperCard / LeftSidebar / NodeInspector / McpSection … | soft，但透明度/圆角发散 |

### 1.1 已识别的不一致点（规范化动机）

- **A. soft 透明度三套并存**：同一"成功绿"出现 `bg-success/10`（SettingsPill / RelevanceBadge / McpSection / EvidenceSet）、`bg-success/15`（SessionPaperCard JCR/IF、ScoreBadge）、`border-success text-success`（NodeInspector outline）三种视觉权重。
- **B. info 在 solid ↔ soft 间摇摆**：`Badge variant="info"` 是 solid `bg-info`，但 LeftSidebar / McpSection / ScoreBadge / SessionPaperCard 都用 soft `bg-info/10~/15`。LeftSidebar 甚至 `<Badge variant="info">` 再用 className 覆写成 soft，variant 形同虚设。
- **C. destructive 透明度发散**：`/5`（ToolActivityItem）vs `/10`（SettingsPill / McpServerForm）vs `/15`（SessionPaperCard Q4）。
- **D. 圆角文档 ↔ 实现冲突**：`design.md` §6.1 规定"内嵌 badge/tag = `rounded-sm`（2px）"，但实现绝大多数是 `rounded-md`（6px）。
- **E. 字号双轨**：语义标签走 `text-badge`（12px），但行内 chip（`inline-label-style.ts`）、CitationBadge、StarterChips 各自硬编码 14px。
- **F. variant 缺口**：`Badge` 没有 success/warning，导致每个需要绿/黄的调用点都手写 className —— 正是 A/B/C 的根源。
- **G. 颜色绕过 token**：CitationBadge 用 `#fde68a` / `#78350f` 等硬编码 hex，主题切换不响应。

---

## 2. 设计目标

1. 把 5 套配方收敛成 **唯一语义入口**：一个 `tone × variant` 双轴 `Badge` 组件 + 一套行内 chip 共享样式。
2. 在 `design.md` 落一节权威规范（variant×tone 矩阵 + 两类别约束 + 例外 + 反模式），并修正 §6.1 过时的 `rounded-sm` 规定。
3. 迁移现有手写 className 调用点到组件/token，消除 A–G 的不一致。

**非目标**：不引入新色 token（复用现有 `--success` / `--warning` / `--info` / `--destructive` / `--primary` / `--muted`）；不改 `Button` 的 `chip` variant（那是按钮，不是展示标签）；ESLint 机器拦截留给 B-6（[#296](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/296)）。

---

## 3. 规范模型（写进 design.md 的内容）

**标签 = 两个正交轴 × 两个类别。**

### 3.1 类别一：语义标签（Semantic Badge）

独立存在的语义色块（分区 Q1、MCP 启用态、相关度分数、节点状态…）。

**统一基底**：`inline-flex items-center rounded-md px-2.5 py-0.5 text-badge font-normal`（12px / 6px 圆角）。

**轴一 — tone（语义色）**：`neutral`（默认） / `primary` / `info` / `success` / `warning` / `destructive`

**轴二 — variant（形态）**：`soft`（默认） / `solid` / `outline`

**tone × variant 矩阵**（soft 底色透明度统一 **`/10`**）：

| tone \ variant | `soft`（默认） | `solid` | `outline` |
|---|---|---|---|
| `neutral` | `bg-muted text-muted-foreground` | `bg-muted text-foreground` | `border border-border text-muted-foreground` |
| `primary` | `bg-primary/10 text-primary` | `bg-primary text-primary-foreground` | `border border-primary text-primary` |
| `info` | `bg-info/10 text-info` | `bg-info text-info-foreground` | `border border-info text-info` |
| `success` | `bg-success/10 text-success` | `bg-success text-success-foreground` | `border border-success text-success` |
| `warning` | `bg-warning/10 text-warning` | `bg-warning text-warning-foreground` | `border border-warning text-warning` |
| `destructive` | `bg-destructive/10 text-destructive` | `bg-destructive text-destructive-foreground` | `border border-destructive text-destructive` |

> soft 用 `/10` 的理由：现代码里用得最多（SettingsPill / RelevanceBadge / McpSection / EvidenceSet），与 shadcn soft 习惯一致，亮/暗双主题下对比度足够。

### 3.2 类别二：行内 chip（Inline Chip）

嵌在正文 / 对话文字流里的短胶囊（FilePathChip / DoiChip / 关键词 chip / CitationBadge）。约束不同于语义标签：

- 字号 **14px**（贴正文，而非 `text-badge` 12px）—— 这是 [`min-font-size-14px-spec.md`](./min-font-size-14px-spec.md) 正文下限的延续。
- `rounded-md`（6px），中性底 `bg-muted-foreground/15`，可点击时叠 hover 态。
- 真相源收敛到 `components/ai-elements/inline-label-style.ts`（`INLINE_LABEL_CLASS` 等），所有行内分支引用它，不各自拼。

### 3.3 形态例外（明确记入规范，非违规）

以下不属于"语义标签"，沿用 `rounded-full`：

- **计数角标 / `+N`**（EvidenceSetBadgeStack）
- **状态圆点**（UpdateBadge dot）
- **起手式胶囊按钮**（StarterChips —— 本质是按钮，pill 形）

规范里点名它们是"非语义标签特例"，避免被误判为圆角不一致。

### 3.4 反模式清单（design.md §九 新增条目）

| 反模式 | 修正 |
|---|---|
| 手写 `bg-success/15` / `bg-info/15` 拼语义色 | 用 `<Badge tone=... variant="soft">`，透明度统一 `/10` |
| `<Badge variant="info">` 再用 className 覆写成 soft | 用 `<Badge tone="info" variant="soft">` |
| 标签硬编码 hex（如 `#fde68a`） | 走语义 token，主题才响应 |
| 语义标签用 14px / 行内 chip 用 12px | 语义标签 `text-badge`(12)，行内 chip 14px，不串台 |

---

## 4. 组件与迁移落地

### 4.1 改造 `components/ui/badge.tsx`

从单轴 `variant` 升级为 `tone × variant` 双轴 cva：

```tsx
// 伪代码示意
const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2.5 py-0.5 text-badge font-normal transition-colors focus:outline-none",
  {
    variants: {
      tone: { neutral, primary, info, success, warning, destructive },
      variant: { soft, solid, outline },
    },
    compoundVariants: [ /* tone × variant → §3.1 矩阵的 className */ ],
    defaultVariants: { tone: "neutral", variant: "soft" },
  }
)
```

- `BadgeProps` 暴露 `tone` + `variant`，移除旧的单轴 `variant: default|secondary|destructive|info|outline`。
- 旧 API 是 breaking change —— 因本次范围含迁移调用点，所有 `<Badge variant=...>` 调用点一并改写（见 4.3）。
- `size` 暂只一档（不引入 `sm/lg`，YAGNI）。

### 4.2 SettingsPill 并入 Badge

`SettingsPill` 的 `tone`（neutral/success/warning/destructive，soft `/10`）正是新 Badge 的子集 → **删除 SettingsPill**，调用点改用 `<Badge tone=... variant="soft">`。
保留点：SettingsPill 现有 `h-6 leading-[1]` 的固定高度若设置页视觉依赖，迁移时验证 Badge 默认 `py-0.5` 是否等高；若不等高，在调用点补 `className="h-6"` 而非给 Badge 加 size 轴。

### 4.3 迁移调用点（探查到的代表，迁移时以 grep 全量为准）

| 调用点 | 现状 | 迁移后 |
|---|---|---|
| SessionPaperCard JCR 分区 `:352` | 手写 `bg-success/15 …` 五档 | `<Badge tone=... variant="soft">`（`/15`→`/10`） |
| SessionPaperCard IF 分段 `:362` | 手写 `/15` 三档 | 同上 |
| LeftSidebar Zotero badge `:496` | `<Badge variant="info">` 又覆写 soft | `<Badge tone="info" variant="soft">` |
| NodeInspector 节点状态 `:146/152` | `variant="outline"` + `border-success/warning` | `<Badge tone=success/warning variant="outline">` |
| McpSection 状态 `:228/235` | `bg-info/10` `bg-success/10` `bg-muted` | `<Badge tone=... variant="soft">` |
| SettingsPill 全部调用点 | `<SettingsPill tone=...>` | `<Badge tone=... variant="soft">` |
| SetHeader 未持久化警告 `:25` | `bg-warning/10 text-warning` | `<Badge tone="warning" variant="soft">` |
| ToolActivityItem 错误 `:120` | `bg-destructive/5`（更淡） | `<Badge tone="destructive" variant="soft">`（统一 `/10`） |
| AccountMenu DevBypass `:130` | `bg-warning/15` | `<Badge tone="warning" variant="soft">` |
| 行内：FilePathChip / DoiChip / 关键词 chip | 已用 / 散用 | 统一 `inline-label-style.ts` |
| CitationBadge `:68` | 硬编码 hex 14px | 换 token（行内 chip 风，amber→`warning` soft 或中性，迁移时定）|
| EvidenceSetBadgeStack `+N` `:44` | `variant="chip"` | 计数特例，保留 `rounded-full`，§3.3 |

> **RelevanceBadge / ScoreBadge / RELEVANCE_COLORS**：用的是 `--relevance-*` 5 档专用梯度 token（design.md §3.4 已列），属"分数色阶"而非通用语义 tone，**不并入** Badge 的 tone 轴，但圆角/字号对齐 §3.1（`rounded-md` / `text-badge`）。

### 4.4 design.md 文档改动

1. **新增 §8.4「标签族（Badge / Chip）语义规范」**：§3.1 矩阵表 + §3.2 行内 chip 约束 + §3.3 例外。
2. **修正 §6.1 圆角表**：`rounded-sm | 2 | 内嵌 badge / tag` → 改为语义标签 / 行内 chip 用 `rounded-md`（6px）；`rounded-sm` 若无其他用途则移除该行或改注用途。
3. **§九 反模式清单**新增 §3.4 的条目。
4. **§8.1 组件清单**：Badge 描述更新为"tone×variant 双轴"；从 17 件清单语义上同步（SettingsPill 删除）。
5. **§十三 已知偏差**：勾掉 UpdateBadge / CitationBadge 的 palette 硬编码项（迁移后）。

---

## 5. 验收标准（Done When）

1. [ ] `bun run typecheck` 通过。
2. [ ] `bun test` 通过（含 `key-parity` —— 本次无新文案，应零增减）。
3. [ ] grep 确认无残留：`bg-success/15`、`bg-info/15`、`bg-destructive/5`、标签场景的 hex 字面量。
4. [ ] `Badge` 双轴 cva 落地；`SettingsPill` 删除，零引用。
5. [ ] 行内 chip 全部走 `inline-label-style.ts`。
6. [ ] `design.md` §6.1 / §8.1 / §8.4 / §九 / §十三 已同步；§3.1 矩阵与 `tokens.css` 语义色一一对应。
7. [ ] `apps/electron` `package.json` patch 已递增（开 PR 时一次）。
8. [ ] `bun run dev` 实际切 亮/暗 + zh/en，走查论文卡分区标签 / MCP 状态 / 设置页 pill / 侧边栏 badge / 对话行内 chip，确认无视觉回退、无 raw key。
9. [ ] 跑过一次 `simplify` / `@code-simplifier` 复盘。

---

## 6. 风险与开放问题

- **CitationBadge 的 amber → 哪个 tone**：现为 amber-200 底（综述引用角标）。迁移时定：归 `warning` soft 还是中性 chip？倾向中性（引用非警告语义），实现前确认。
- **SettingsPill 等高**：见 §4.2，迁移时验证 Badge 默认高度是否破坏设置页对齐。
- **breaking Badge API**：全仓 `<Badge variant=...>` 一次性改完，迁移期不留兼容旧 variant 的 shim（避免双轨）。

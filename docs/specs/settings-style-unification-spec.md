# Settings 样式统一 Spec

> **状态**：草稿 · 待 review
> **关联 issue**：（暂无）
> **关联 PR**：（待开，目标 `main`）
> **目标分支**：`main`
> **基线分支**：`alex-20260602-2`（已含 Codex 风 Card / Input / Button 基础重写）
> **领域语言事实源**：本 spec（未引入新术语）
> **变更范围**：渲染层 + i18n（无新 key，仅修 inline 文案处不动）；不动 IPC、不动主进程、不动业务逻辑

---

## 1. 背景

最近把设置模块的视觉基线改成 Codex 风（细边框替代阴影、行 padding 加宽、Input/Button 圆角统一），但只动了**全局基础组件**（`.settings-card` / `ui/input` / `ui/button` / `SettingsRow`），**没有同步**所有自己魔改的 settings 子页面。

### 1.1 审计结论（已扫 17 个 settings 子页面，详见 PR 描述）

**重复实现的 row 组件 5 份**：
- `ZoteroModuleRow`（ZoteroSettings.tsx）
- `ZoteroMediaPanel.tsx` 里的自定义 row
- `ZoteroArticlePanel.tsx` 状态卡 row
- `AboutSettings.tsx` UpdateCard 行
- `GeneralSettings.tsx` ThemeCardPicker 容器

形态共通：grid `[1fr_8rem]` + 左侧 (title + 可选 pill + description) + 右侧 (action)。比 `SettingsRow` 多两件事：pill 槽位 + action 支持复杂控件（不只是 Switch/Select）。

**重复实现的 pill 组件 5 份**：
- `CapabilityPill`（ZoteroSettings 内置 / 内置 OCR badge）
- `StatusPill`（ZoteroSettings 状态 pill，含 success/warning/destructive 配色）
- `MetricPill`（ZoteroMediaPanel）
- `agent/McpSection.tsx` 内置 badge / transport pill
- `SkillCategoryView.tsx` 状态 pill

形态共通：`inline-flex h-6 items-center rounded-full bg-X/10 text-X px-2.5 text-xs font-medium leading-[1]`。

**未对齐的 sweep 类偏离 30+ 处**：
- `px-4 py-3` 旧 row padding（应升 `px-5 py-5`）
- `shadow-sm` / `shadow-xl` 残留
- 手写 `border-t border-border/50`（应让 `SettingsCard divided` 接管）
- `h-7` / `h-8` Input / Button（应继承新默认 `h-10` / `h-9`）
- 描述文字 `leading-snug`（应 `leading-relaxed`）

### 1.2 目标

1. 抽出两个共性 primitive：`SettingsModuleRow` + `SettingsPill`，删除 5+5 份重复
2. sweep 全部 settings 子页面的 padding / shadow / border / 旧尺寸 / leading
3. 让"打开任一 settings 页 → 视觉自洽"成为不需要费力维护的状态

---

## 2. 设计方案

### 2.1 新 primitive 1：`SettingsModuleRow`

位置：`apps/electron/src/renderer/components/settings/primitives/SettingsModuleRow.tsx`

```tsx
interface SettingsModuleRowProps {
  /** 行标题 */
  title: string
  /** 标题右侧紧贴的 pill（可选） */
  pill?: React.ReactNode
  /** 描述（可选；string 或自定义节点） */
  description?: React.ReactNode
  /** 右侧 action 槽（Switch / Button / SegmentedControl / 进度条等） */
  action?: React.ReactNode
  /** 额外 className 覆盖容器 padding（如 contentClassName="py-2" 收紧高级折叠组内行） */
  className?: string
}
```

实现要点：
- 容器：`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-5`
- 标题块：`<div className="flex items-center gap-2 leading-none"><span title /><pill /></div>`
- 描述块：`mt-2 text-sm leading-relaxed text-muted-foreground`，仅 description 存在时渲染
- action 槽：`flex justify-end`

**与现有 `SettingsRow` 的区别 / 边界**：
- `SettingsRow` 仍保留，用于"左 label + 右 control"的简单行（无 pill、description 较短）；许多 Form 字段是这类
- `SettingsModuleRow` 用于"一个能力 / 模块"（title + 状态 pill + 较长描述 + 复杂 action）

**待删除的 5 份重复**：见 §3.1 迁移清单

### 2.2 新 primitive 2：`SettingsPill`

位置：`apps/electron/src/renderer/components/settings/primitives/SettingsPill.tsx`

```tsx
type PillTone = 'neutral' | 'success' | 'warning' | 'destructive' | 'info'

interface SettingsPillProps {
  children: React.ReactNode
  tone?: PillTone  // 默认 'neutral'
  className?: string
}
```

实现要点：
- 基础：`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium leading-[1]`
- tone 配色：
  - `neutral`: `bg-muted text-muted-foreground`
  - `success`: `bg-success/10 text-success`
  - `warning`: `bg-warning/10 text-warning`
  - `destructive`: `bg-destructive/10 text-destructive`
  - `info`: `bg-info/10 text-info`（若 design token 无 info，沿用 primary）

**待删除的 5 份重复**：`CapabilityPill` / `StatusPill` / `MetricPill` / `agent/McpSection` 内置 badge / `SkillCategoryView` 状态 pill。

### 2.3 sweep 规则（不抽 primitive，统一旧值）

| sweep 项 | 旧 → 新 | 影响文件 |
|---|---|---|
| Row padding | `px-4 py-3` → `px-5 py-4`（带描述的高密度行）或 `px-5 py-5`（带 input 的标准行） | ChannelForm, McpServerForm, AboutSettings.UpdateCard, GeneralSettings.ThemeCardPicker, SkillCategoryView.SkillItemRow, VersionHistory, ZoteroArticlePanel |
| Inline shadow | 删 `shadow-sm` / `shadow-xl` / `shadow-[...]` | GeneralSettings.SoundPicker, ProfileSettings.NameRow Popover, ShortcutSettings.ShortcutRecorder, ChannelSettings.ChannelRow logo, McpServerForm.textarea |
| 手写 border 分隔 | `border-t border-border/50` 串联 row → 改用 `SettingsCard divided` | AgentRuntimeSection, AboutSettings.UpdateCard 折叠区, VersionHistory, ChannelForm sticky 头 |
| 旧 Input / Button 尺寸 | `h-7` / `h-8` → 继承默认（`h-9` button / `h-10` input） | ChannelForm 自定义模型输入、测试连接 / 拉取模型按钮；GeneralSettings.SelectTrigger / SoundPicker；ProfileSettings.NameRow 编辑态；ZoteroArticlePanel SelectTrigger；SkillCategoryView 搜索框 |
| 描述 leading | `leading-snug` → `leading-relaxed` | ZoteroMediaPanel description, ZoteroArticlePanel model.hint |

### 2.4 不做（明确 Out of scope）

- `SettingsHintBox` / `SettingsClickableRow` / `SettingsCollapsibleRow` / `SettingsKeyValueTextarea` — 这些 primitive 也有抽取价值，但涉及结构性改动（交互语义 / 颜色 token 扩展 / 折叠状态管理），单独成 PR 更清楚
- 设置页交互行为改动（开关位置 / 字段排序 / 描述文案）
- 主题 / token 调整
- 设置页之外的列表组件（如对话流右侧列表、文献库列表等）

---

## 3. 实施计划

### 3.1 迁移清单

按"先 primitive 后调用方"的顺序，每步可独立验证：

1. **新建 `SettingsModuleRow`** + 导出到 `primitives/index.ts`
2. **新建 `SettingsPill`** + 导出
3. **迁移 ZoteroSettings**：删 `ZoteroModuleRow` / `CapabilityPill` / `StatusPill` 三个本地组件 → 全部走新 primitive
4. **迁移 ZoteroMediaPanel + ZoteroArticlePanel**：同上
5. **迁移 AboutSettings.UpdateCard + GeneralSettings.ThemeCardPicker**：自定义行改用 `SettingsModuleRow`
6. **迁移 agent/McpSection + SkillCategoryView 的 pill**：改用 `SettingsPill`
7. **sweep 类**：按 §2.3 表逐文件改

### 3.2 受影响包

- `apps/electron` 0.1.415 → 0.1.416 patch

---

## 4. 验收

| # | 标准 |
|---|---|
| 1 | `bun run typecheck` 通过 |
| 2 | `bun test` 通过（含 `key-parity.test.ts` 双语 key 对齐；本 spec 不动 i18n key，应自然通过）|
| 3 | 17 个 settings 子页面在 `bun run dev` 里点过一遍，亮 / 暗主题切换无样式断层 |
| 4 | 删除的 5 份 row + 5 份 pill 在 grep 中确认零残留 |
| 5 | 旧 padding / shadow / border / 尺寸 sweep 完毕，grep `px-4 py-3` / `shadow-sm` / `border-t border-border/50` 在 settings/ 下不再命中（保留合理例外） |

---

## 5. 待确认

1. **`SettingsPill` 的 `info` tone**：是否需要新增 `--info` 色 token，还是 fallback 到 `primary`？现有 design.md token 表里没有 info 色——建议本次先**不引入 info tone**，等明确场景再加
2. **`px-4 py-3` 的合理保留**：某些紧凑的 row（如 SkillCategoryView 的 chip filter）历史上故意压紧；本次 sweep 是否完全统一到 `py-4` 或更松？建议**默认升级**，特殊紧凑场景挂注释豁免
3. **PR 拆分**：本次范围已经包含 5+5 primitive 迁移 + sweep ~30 处偏离。是否在 spec 实施过程中允许中途切 PR（如 primitive + Zotero 迁移先合一个，sweep 类合第二个）？建议**先做 1+2+3+4+6** 合并第一个 PR，**5+sweep**（§2.3 表）合第二个，按主题清晰

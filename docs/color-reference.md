<a id="asci-用色规范速查手册"></a>

# ASCI Color Guidelines Quick Reference

> **Quick reference**: This document is a quick reference to the color section of [`docs/design.md`](./design.md) with complete HSL/HEX tables for fast lookup and copying during development.
>
> **Source of truth**: Token values are defined in [`apps/electron/src/renderer/styles/tokens.css`](../apps/electron/src/renderer/styles/tokens.css) (`:root` and `.dark` two blocks).
>
> **Full specification**: For design principles, component hierarchy, and antipatterns, see [`docs/design.md`](./design.md).

---

<a id="目录"></a>

## Contents

- [1. Core Principles](#一核心原则)
- [2. Text Color Tokens](#二文字颜色-token)
- [3. Background Color Tokens](#三背景颜色-token)
- [4. Border Color Tokens](#四边框颜色-token)
- [5. Specialized Colors](#五专用场景色值)
- [6. Copyable Code Examples](#六快速复制代码块)
- [7. Figma/Design Tool Colors](#七figma设计工具色值)
- [8. Usage Guidelines](#八使用规范)

---

<a id="一核心原则"></a>

## 1. Core Principles

1. **Restrained color** - Use neutral grays for 90% of colors (HSL `0 0% *`); accents only for Active/Primary/Link, alert colors only for destructive/warning
2. **Tokens first** - Prohibit `bg-red-500`, `text-blue-400` and similar hardcoded Tailwind palette colors
3. **Semantics first** - Use `bg-destructive` rather than `bg-red-500`
4. **Light/dark themes** - Maintain only `:root`(light) and `.dark`(dark)
5. **Use pairs** - Colored backgrounds require matching foreground colors (`bg-primary` + `text-primary-foreground`)

---

<a id="二文字颜色-token"></a>

## 2. Text Color Tokens

<a id="21-主要文字颜色最常用"></a>

### 2.1 Primary Text Colors (Most Common)

| Token | className | Light HSL | Light HEX | Dark HSL | Dark HEX | Usage |
|-------|-----------|-----------|-----------|----------|----------|------|
| **Primary text** | `text-foreground` | `0 0% 3.9%` | `#0a0a0a` | `0 0% 98%` | `#fafafa` | Body, headings, labels |
| **Secondary text** | `text-muted-foreground` | `0 0% 45.1%` | `#737373` | `0 0% 63.9%` | `#a3a3a3` | Descriptions, metadata, helper text |

> **Core rules**:
> - Normal text = `text-foreground`(near-black/near-white)
> - Secondary text = `text-muted-foreground`(medium gray)
> - **No italics**: For subtle emphasis, use `text-muted-foreground` or `font-medium`, avoiding `italic`

<a id="22-状态文字单独使用无背景"></a>

### 2.2 Status Text (Standalone, No Background)

| Token | className | Light HSL | Light HEX | Dark HSL | Dark HEX | Usage |
|-------|-----------|-----------|-----------|----------|----------|------|
| Success | `text-success` | `142 71% 38%` | `#1c9d52` | `142 65% 45%` | `#28b560` | Passed, completed |
| Warning | `text-warning` | `38 92% 50%` | `#f59e0b` | `38 92% 55%` | `#fbbf24` | Awaiting review, attention |
| Error | `text-destructive` | `0 84.2% 60.2%` | `#ef4444` | `0 55% 45%` | `#b91c1c` | Failed, errors |
| Info | `text-info` | `217 91% 60%` | `#3b82f6` | `217 91% 65%` | `#60a5fa` | Hints, in progress |
| Primary | `text-primary` | `0 0% 9%` | `#171717` | `0 0% 98%` | `#fafafa` | Link, Active |

<a id="23-配对前景色在有色背景上的文字"></a>

### 2.3 Paired Foregrounds (Text on Colored Backgrounds)

| Background Token | Foreground Token | Light HSL | Light HEX | Dark HSL | Dark HEX |
|-----------|-----------|-----------|-----------|----------|----------|
| `bg-primary` | `text-primary-foreground` | `0 0% 98%` | `#fafafa` | `0 0% 9%` | `#171717` |
| `bg-secondary` | `text-secondary-foreground` | `0 0% 9%` | `#171717` | `0 0% 98%` | `#fafafa` |
| `bg-accent` | `text-accent-foreground` | `0 0% 9%` | `#171717` | `0 0% 98%` | `#fafafa` |
| `bg-destructive` | `text-destructive-foreground` | `0 0% 98%` | `#fafafa` | `0 0% 98%` | `#fafafa` |
| `bg-success` | `text-success-foreground` | `0 0% 100%` | `#ffffff` | `0 0% 100%` | `#ffffff` |
| `bg-warning` | `text-warning-foreground` | `0 0% 100%` | `#ffffff` | `0 0% 100%` | `#ffffff` |
| `bg-info` | `text-info-foreground` | `0 0% 100%` | `#ffffff` | `0 0% 100%` | `#ffffff` |
| `bg-card` | `text-card-foreground` | `0 0% 3.9%` | `#0a0a0a` | `0 0% 98%` | `#fafafa` |
| `bg-popover` | `text-popover-foreground` | `0 0% 3.9%` | `#0a0a0a` | `0 0% 98%` | `#fafafa` |
| `bg-dialog` | `text-dialog-foreground` | `0 0% 3.9%` | `#0a0a0a` | `0 0% 98%` | `#fafafa` |

<a id="24-特殊场景文字"></a>

### 2.4 Special-Purpose Text

| Token | className | Light HSL | Light HEX | Dark HSL | Dark HEX | Usage |
|-------|-----------|-----------|-----------|----------|----------|------|
| Code container primary text | `text-code-container-fg` | `240 5% 96%` | `#f4f4f5` | `240 5% 96%` | `#f4f4f5` | Bash/Terminal text |
| Code line numbers/counts | `text-code-container-muted` | `240 5% 65%` | `#a1a1aa` | `240 5% 65%` | `#a1a1aa` | Line numbers, command echoes |
| Tooltip secondary text | `text-tooltip-muted` | `0 0% 75%` | `#bfbfbf` | `0 0% 70%` | `#b3b3b3` | Tooltip descriptions |

---

<a id="三背景颜色-token"></a>

## 3. Background Color Tokens

<a id="31-基础背景"></a>

### 3.1 Base Backgrounds

| Token | className | Light HSL | Light HEX | Dark HSL | Dark HEX | Usage |
|-------|-----------|-----------|-----------|----------|----------|------|
| Main background | `bg-background` | `0 0% 100%` | `#ffffff` | `0 0% 7%` | `#121212` | Top-level window/sidebar background |
| Content area | `bg-content-area` | `0 0% 100%` | `#ffffff` | `0 0% 7%` | `#121212` | Main content area |
| Card | `bg-card` | `0 0% 100%` | `#ffffff` | `0 0% 7%` | `#121212` | Card background |
| Muted | `bg-muted` | `0 0% 96.1%` | `#f5f5f5` | `0 0% 14.9%` | `#262626` | hover, disabled |
| Input | `bg-input` | `0 0% 89.8%` | `#e5e5e5` | `0 0% 14.9%` | `#262626` | Input background |

<a id="32-强调背景"></a>

### 3.2 Accent Backgrounds

| Token | className | Light HSL | Light HEX | Dark HSL | Dark HEX | Usage |
|-------|-----------|-----------|-----------|----------|----------|------|
| Primary | `bg-primary` | `0 0% 9%` | `#171717` | `0 0% 98%` | `#fafafa` | Primary CTA, active tabs |
| Secondary | `bg-secondary` | `0 0% 96.1%` | `#f5f5f5` | `0 0% 14.9%` | `#262626` | Secondary buttons |
| Accent | `bg-accent` | `0 0% 96.1%` | `#f5f5f5` | `0 0% 40%` | `#666666` | hover/current item |

<a id="33-状态背景solid-按钮"></a>

### 3.3 Status Backgrounds (Solid Buttons)

| Token | className | Light HSL | Light HEX | Dark HSL | Dark HEX | Usage |
|-------|-----------|-----------|-----------|----------|----------|------|
| Success | `bg-success` | `142 71% 38%` | `#1c9d52` | `142 65% 45%` | `#28b560` | Run passed, connection successful |
| Warning | `bg-warning` | `38 92% 50%` | `#f59e0b` | `38 92% 55%` | `#fbbf24` | Pending, awaiting review |
| Error | `bg-destructive` | `0 84.2% 60.2%` | `#ef4444` | `0 55% 45%` | `#b91c1c` | Delete, Stop |
| Info | `bg-info` | `217 91% 60%` | `#3b82f6` | `217 91% 65%` | `#60a5fa` | Guidance tags, connection hints |

<a id="34-组件专用背景"></a>

### 3.4 Component Backgrounds

| Token | className | Light HSL | Light HEX | Dark HSL | Dark HEX | Usage |
|-------|-----------|-----------|-----------|----------|----------|------|
| Popover | `bg-popover` | `0 0% 100%` | `#ffffff` | `0 0% 7%` | `#121212` | Dropdown menus |
| Dialog | `bg-dialog` | `0 0% 100%` | `#ffffff` | `0 0% 12%` | `#1f1f1f` | Dialogs (slightly lighter in dark mode) |
| Tooltip | `bg-tooltip` | `0 0% 15%` | `#262626` | `0 0% 20%` | `#333333` | High-contrast Tooltip (retained) |
| Code block | `bg-code-bg` | `210 13% 12%` | `#1e2228` | `210 13% 12%` | `#1e2228` | Markdown Code block |

---

<a id="四边框颜色-token"></a>

## 4. Border Color Tokens

| Token | className | Light HSL | Light HEX | Dark HSL | Dark HEX | Usage |
|-------|-----------|-----------|-----------|----------|----------|------|
| Border | `border-border` | `0 0% 89.8%` | `#e5e5e5` | `0 0% 14.9%` | `#262626` | Thin borders |
| Input border | `border-input` | `0 0% 89.8%` | `#e5e5e5` | `0 0% 14.9%` | `#262626` | Input |
| Focus ring | `ring-ring` | `0 0% 3.9%` | `#0a0a0a` | `0 0% 83.1%` | `#d4d4d4` | focus ring(disabled globally) |
| Dashed border | `border-[hsl(var(--dashed-border))]` | `0 0% 9% / 0.35` | `#17171759` | `0 0% 98% / 0.25` | `#fafafa40` | New conversation, search button |
| Dashed hover | `border-[hsl(var(--dashed-border-hover))]` | `0 0% 9% / 0.50` | `#17171780` | `0 0% 98% / 0.40` | `#fafafa66` | Dashed hover |

---

<a id="五专用场景色值"></a>

## 5. Specialized Colors

<a id="51-diff-高亮"></a>

### 5.1 Diff Highlighting

| Usage | Token | HSL (Same Light/Dark) | HEX | Description |
|------|-------|---------------------|-----|------|
| Added-line background | `--diff-add-bg` | `142 71% 45% / 0.1` | `#22c55e1a` | edit/write-result additions |
| Added-line foreground | `--diff-add-fg` | `142 76% 73% / 0.6` | `#86efac99` | Added-line numbers/markers |
| Added-line text | `--diff-add-text` | `142 77% 73%` | `#86efac` | Added-line body |
| Deleted-line background | `--diff-del-bg` | `0 84% 60% / 0.1` | `#ef44441a` | edit-result deletions |
| Deleted-line foreground | `--diff-del-fg` | `0 91% 71% / 0.6` | `#fca5a599` | Deleted-line numbers/markers |
| Deleted-line text | `--diff-del-text` | `0 94% 82%` | `#fecaca` | Deleted-line body |

<a id="52-搜索高亮"></a>

### 5.2 Search Highlighting

| Usage | Token | HSL | HEX | Description |
|------|-------|-----|-----|------|
| Search-match background | `--search-hit-bg` | `53 98% 65% / 0.3` | `#fde0474d` | grep match highlight background |
| Search-match text | `--search-hit-fg` | `54 97% 77%` | `#fef08a` | grep match text color |

<a id="53-代码容器bashterminaleditreadwrite"></a>

### 5.3 Code Containers (Bash/Terminal/Edit/Read/Write)

| Usage | Token | HSL | HEX | Description |
|------|-------|-----|-----|------|
| Container background | `--code-container-bg` | `240 6% 10%` | `#18181b` | Light zinc-900 / dark zinc-950 |
| Primary text | `--code-container-fg` | `240 5% 96%` | `#f4f4f5` | zinc-100 |
| Line numbers/counts | `--code-container-muted` | `240 5% 65%` | `#a1a1aa` | zinc-500 |
| Filename highlight | `--code-container-emphasis` | `240 5% 84%` | `#d4d4d8` | zinc-300 |
| Code body | `--code-container-text` | `240 5% 91%` | `#e4e4e7` | zinc-200 |
| grep file header | `--code-container-subheader` | `240 4% 16% / 0.5` | `#27272a80` | zinc-800/50 |
| grep row hover | `--code-container-row-hover` | `240 4% 16% / 0.3` | `#27272a4d` | zinc-800/30 |

<a id="54-choicecard-危险等级"></a>

### 5.4 ChoiceCard Risk Levels

| Usage | Token | HSL | HEX |
|------|-------|-----|-----|
| Safe-option border | `--choice-safe-border` | `142 71% 45% / 0.4` | `#22c55e66` |
| Dangerous-option border | `--choice-dangerous-border` | `38 92% 50% / 0.7` | `#f59e0bb3` |
| Dangerous-option title (light) | `--choice-dangerous-fg` | `32 95% 44%` | `#dc2626` |
| Dangerous-option title (dark) | `--choice-dangerous-fg` | `43 96% 56%` | `#fbbf24` |
| Focus prefix bar | `--choice-dangerous-prefix` | `38 92% 50%` | `#f59e0b` |

<a id="55-相关度梯度5-档"></a>

### 5.5 Relevance Gradient (5 Levels)

| Level | Token | HSL | HEX | Color name | Usage |
|------|-------|-----|-----|--------|------|
| Lowest | `--relevance-0` | `0 84% 60% / 0.6` | `#ef444499` | Red | Relevance 0-20% |
| Low | `--relevance-1` | `28 92% 56% / 0.6` | `#fb923c99` | Orange | Relevance 20-40% |
| Medium | `--relevance-2` | `38 92% 50% / 0.6` | `#f59e0b99` | Amber | Relevance 40-60% |
| High | `--relevance-3` | `158 64% 52% / 0.6` | `#10b98199` | Emerald | Relevance 60-80% |
| Highest | `--relevance-4` | `142 71% 45% / 0.6` | `#22c55e99` | Green | Relevance 80-100% |

---

<a id="六快速复制代码块"></a>

## 6. Copyable Code Examples

<a id="61-文字颜色最常用"></a>

### 6.1 Text Colors (Most Common)

```tsx
// 主文字
<span className="text-foreground">主要内容</span>
<h1 className="text-foreground font-semibold">标题</h1>

// 次要文字
<span className="text-muted-foreground">说明文字</span>
<p className="text-muted-foreground text-sm">描述</p>

// 状态文字（单独用，无背景）
<span className="text-success">成功</span>
<span className="text-warning">警告</span>
<span className="text-destructive">错误</span>
<span className="text-info">信息</span>

// Link/Active
<a className="text-primary hover:underline">查看详情</a>
```

<a id="62-按钮背景配对文字"></a>

### 6.2 Buttons (Background + Paired Text)

```tsx
// 主按钮
<button className="bg-primary text-primary-foreground">确定</button>

// 危险按钮
<button className="bg-destructive text-destructive-foreground">删除</button>

// 成功按钮
<button className="bg-success text-success-foreground">完成</button>

// 次级按钮
<button className="bg-secondary text-secondary-foreground">取消</button>
```

<a id="63-badge-标签"></a>

### 6.3 Badge Labels

```tsx
// Soft 变体（底色 /10）
<Badge tone="success" variant="soft">成功</Badge>
<Badge tone="warning" variant="soft">警告</Badge>
<Badge tone="info" variant="soft">信息</Badge>

// Solid 变体
<Badge tone="destructive" variant="solid">删除</Badge>
<Badge tone="primary" variant="solid">Primary</Badge>

// Outline 变体
<Badge tone="info" variant="outline">信息</Badge>
```

<a id="64-常见组合模式"></a>

### 6.4 Common Patterns

```tsx
// 模式 1：标题 + 描述
<div>
  <h3 className="text-foreground font-medium">功能名称</h3>
  <p className="text-muted-foreground text-sm">功能描述说明</p>
</div>

// 模式 2：Label + Value
<div className="flex items-center gap-2">
  <span className="text-muted-foreground">状态：</span>
  <span className="text-foreground font-medium">进行中</span>
</div>

// 模式 3：状态指示
<div className="flex items-center gap-2">
  <span className="text-success">●</span>
  <span className="text-foreground">运行中</span>
</div>

// 模式 4：卡片
<div className="bg-card text-card-foreground rounded-xl p-4">
  <h3 className="text-foreground font-semibold">卡片标题</h3>
  <p className="text-muted-foreground text-sm">卡片内容</p>
</div>
```

---

<a id="七figma设计工具色值"></a>

## 7. Figma/Design Tool Colors

<a id="71-light-主题核心色"></a>

### 7.1 Light Theme Core Colors

```
Primary text：     #0a0a0a (HSL: 0, 0%, 3.9%)
Secondary text：   #737373 (HSL: 0, 0%, 45.1%)
Main background：     #ffffff (HSL: 0, 0%, 100%)
Card background：   #ffffff (HSL: 0, 0%, 100%)
Muted background：   #f5f5f5 (HSL: 0, 0%, 96.1%)
Border：       #e5e5e5 (HSL: 0, 0%, 89.8%)

Primary：       #171717 (HSL: 0, 0%, 9%)
Success：       #1c9d52 (HSL: 142, 71%, 38%)
Warning：       #f59e0b (HSL: 38, 92%, 50%)
Error：       #ef4444 (HSL: 0, 84.2%, 60.2%)
Info：       #3b82f6 (HSL: 217, 91%, 60%)
```

<a id="72-dark-主题核心色"></a>

### 7.2 Dark Theme Core Colors

```
Primary text：     #fafafa (HSL: 0, 0%, 98%)
Secondary text：   #a3a3a3 (HSL: 0, 0%, 63.9%)
Main background：     #121212 (HSL: 0, 0%, 7%)
Card background：   #121212 (HSL: 0, 0%, 7%)
Muted background：   #262626 (HSL: 0, 0%, 14.9%)
Border：       #262626 (HSL: 0, 0%, 14.9%)

Primary：       #fafafa (HSL: 0, 0%, 98%)
Success：       #28b560 (HSL: 142, 65%, 45%)
Warning：       #fbbf24 (HSL: 38, 92%, 55%)
Error：       #b91c1c (HSL: 0, 55%, 45%)
Info：       #60a5fa (HSL: 217, 91%, 65%)
```

---

<a id="八使用规范"></a>

## 8. Usage Guidelines

<a id="81-文字颜色决策树"></a>

### 8.1 Text Color Decision Tree

```
Need to display text?
│
├─ Primary content/heading?
│  └─ Use text-foreground
│
├─ Secondary explanation/description?
│  └─ Use text-muted-foreground
│
├─ Status/action result?
│  ├─ Success → text-success
│  ├─ Warning → text-warning
│  ├─ Error → text-destructive
│  └─ Info → text-info
│
├─ Link/active state?
│  └─ Use text-primary
│
└─ On a colored background?
   ├─ bg-primary → text-primary-foreground
   ├─ bg-destructive → text-destructive-foreground
   ├─ bg-success → text-success-foreground
   └─ ...(pairing rule)
```

<a id="82-禁止的用法"></a>

### 8.2 Prohibited Usage

```tsx
// ❌ 硬编码调色板颜色
<span className="text-red-500">错误</span>
<span className="text-blue-400">链接</span>
<span className="text-zinc-600">次要文字</span>
<div className="bg-green-500 text-white">成功</div>

// ✅ 正确用法
<span className="text-destructive">错误</span>
<span className="text-primary">链接</span>
<span className="text-muted-foreground">次要文字</span>
<div className="bg-success text-success-foreground">成功</div>

// ❌ 硬编码 hex 颜色
<span style={{ color: '#ff0000' }}>文字</span>

// ✅ 正确用法
<span className="text-destructive">文字</span>

// ❌ 使用斜体表达轻强调
<em>次要信息</em>
<span className="italic">次要信息</span>

// ✅ 正确用法（用颜色或字重）
<span className="text-muted-foreground">次要信息</span>
<span className="font-medium">次要信息</span>
```

<a id="83-侧边栏专用不透明度"></a>

### 8.3 Sidebar Opacity

```tsx
// 侧边栏菜单项
<button className="text-foreground/60 hover:text-foreground">
  菜单项
</button>

// 侧边栏分组标题
<div className="text-[11px] font-medium text-foreground/40">
  工作区
</div>

// 侧边栏空态
<p className="text-[11px] text-foreground/30">
  暂无会话
</p>
```

**Opacity conventions**:
- Default state = `text-foreground/60`
- Hover state = `text-foreground`
- Active state = `text-foreground`(with `bg-primary/10`)
- Group labels = `text-foreground/40`
- Empty-state hints = `text-foreground/30`

<a id="84-快速检查清单"></a>

### 8.4 Quick Checklist

Development self-check:
- [ ] Primary text uses `text-foreground`
- [ ] Secondary text uses `text-muted-foreground`
- [ ] Status text uses status tokens (`text-success` etc.)
- [ ] Colored backgrounds use paired foregrounds (`text-*-foreground`)
- [ ] No `text-red-500` / `text-blue-400` or similar palette colors
- [ ] No `text-zinc-*` / `text-gray-*` or similar neutral palette colors
- [ ] No inline `style={{ color: ... }}`
- [ ] No `italic` / `<em>` italics
- [ ] Scroll containers include `scrollbar-thin`
- [ ] Contrast tested in both light/dark themes

---

<a id="九相关文档"></a>

## 9. Related Documentation

| Document | Relationship |
|------|------|
| [`docs/design.md`](./design.md) | Full design specification (principles, component hierarchy, antipatterns) |
| [`apps/electron/src/renderer/styles/tokens.css`](../apps/electron/src/renderer/styles/tokens.css) | Token-value source of truth (`:root` + `.dark`) |
| [`apps/electron/tailwind.config.js`](../apps/electron/tailwind.config.js) | `theme.extend.colors` exposes tokens |
| [`CLAUDE.md §2`](../CLAUDE.md) | UI principles and hard constraints |

---

**Memory aid**:
1. 📖 **Primary text** = `text-foreground`
2. 💭 **Secondary text** = `text-muted-foreground`
3. 🎯 **Status text** = `text-success` / `text-destructive` / `text-warning` / `text-info`
4. 🔗 **Link/Active** = `text-primary`
5. 🎨 **Colored background** = Always use matching `text-*-foreground`
6. 🚫 **No italics** = Use color or weight for subtle emphasis
7. 🚫 **No palette colors** = Use semantic tokens

---

_Keep this document synchronized with tokens.css. HSL/HEX mismatches are defects._

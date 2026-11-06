# ASCI 用色规范速查手册

> **快速参考**：本文档是 [`docs/design.md`](./design.md) 色彩部分的速查版，提供完整 HSL/HEX 色值对照表，方便开发时快速查阅和复制粘贴。
>
> **真相源**：Token 数值的真相源是 [`apps/electron/src/renderer/styles/tokens.css`](../apps/electron/src/renderer/styles/tokens.css)（`:root` 与 `.dark` 两块）。
>
> **完整规范**：设计原则、组件层级、反模式清单等详见 [`docs/design.md`](./design.md)。

---

## 目录

- [一、核心原则](#一核心原则)
- [二、文字颜色 Token](#二文字颜色-token)
- [三、背景颜色 Token](#三背景颜色-token)
- [四、边框颜色 Token](#四边框颜色-token)
- [五、专用场景色值](#五专用场景色值)
- [六、快速复制代码块](#六快速复制代码块)
- [七、Figma/设计工具色值](#七figma设计工具色值)
- [八、使用规范](#八使用规范)

---

## 一、核心原则

1. **色彩克制** - 90% 使用中性灰系（HSL `0 0% *`），强调色仅在 Active/Primary/Link，警示色仅在 destructive/warning
2. **Token 优先** - 禁止 `bg-red-500`、`text-blue-400` 等 Tailwind 调色板硬编码
3. **语义优先** - 用 `bg-destructive` 而非 `bg-red-500`
4. **亮/暗双主题** - 仅维护 `:root`（亮）与 `.dark`（暗）
5. **配对使用** - 有色背景必须用配对前景色（`bg-primary` + `text-primary-foreground`）

---

## 二、文字颜色 Token

### 2.1 主要文字颜色（最常用）

| Token | className | Light HSL | Light HEX | Dark HSL | Dark HEX | 用途 |
|-------|-----------|-----------|-----------|----------|----------|------|
| **主文字** | `text-foreground` | `0 0% 3.9%` | `#0a0a0a` | `0 0% 98%` | `#fafafa` | 正文、标题、标签文字 |
| **次要文字** | `text-muted-foreground` | `0 0% 45.1%` | `#737373` | `0 0% 63.9%` | `#a3a3a3` | 描述、meta 信息、辅助说明 |

> **核心规则**：
> - 正常文字 = `text-foreground`（近黑/近白）
> - 次要文字 = `text-muted-foreground`（中等灰）
> - **禁止斜体**：需要"轻强调"用 `text-muted-foreground` 或 `font-medium`，不用 `italic`

### 2.2 状态文字（单独使用，无背景）

| Token | className | Light HSL | Light HEX | Dark HSL | Dark HEX | 用途 |
|-------|-----------|-----------|-----------|----------|----------|------|
| 成功 | `text-success` | `142 71% 38%` | `#1c9d52` | `142 65% 45%` | `#28b560` | 通过、完成 |
| 警告 | `text-warning` | `38 92% 50%` | `#f59e0b` | `38 92% 55%` | `#fbbf24` | 待审、注意 |
| 错误 | `text-destructive` | `0 84.2% 60.2%` | `#ef4444` | `0 55% 45%` | `#b91c1c` | 失败、错误 |
| 信息 | `text-info` | `217 91% 60%` | `#3b82f6` | `217 91% 65%` | `#60a5fa` | 提示、进行中 |
| 主色 | `text-primary` | `0 0% 9%` | `#171717` | `0 0% 98%` | `#fafafa` | Link、Active |

### 2.3 配对前景色（在有色背景上的文字）

| 背景 Token | 前景 Token | Light HSL | Light HEX | Dark HSL | Dark HEX |
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

### 2.4 特殊场景文字

| Token | className | Light HSL | Light HEX | Dark HSL | Dark HEX | 用途 |
|-------|-----------|-----------|-----------|----------|----------|------|
| 代码容器主文字 | `text-code-container-fg` | `240 5% 96%` | `#f4f4f5` | `240 5% 96%` | `#f4f4f5` | Bash/Terminal 文字 |
| 代码行号/计数 | `text-code-container-muted` | `240 5% 65%` | `#a1a1aa` | `240 5% 65%` | `#a1a1aa` | 行号、命令回显 |
| Tooltip 副文字 | `text-tooltip-muted` | `0 0% 75%` | `#bfbfbf` | `0 0% 70%` | `#b3b3b3` | Tooltip 说明 |

---

## 三、背景颜色 Token

### 3.1 基础背景

| Token | className | Light HSL | Light HEX | Dark HSL | Dark HEX | 用途 |
|-------|-----------|-----------|-----------|----------|----------|------|
| 主背景 | `bg-background` | `0 0% 100%` | `#ffffff` | `0 0% 7%` | `#121212` | 顶层窗口/侧边栏背景 |
| 内容区 | `bg-content-area` | `0 0% 100%` | `#ffffff` | `0 0% 7%` | `#121212` | 主内容区域 |
| 卡片 | `bg-card` | `0 0% 100%` | `#ffffff` | `0 0% 7%` | `#121212` | 卡片背景 |
| 次要 | `bg-muted` | `0 0% 96.1%` | `#f5f5f5` | `0 0% 14.9%` | `#262626` | hover、禁用 |
| 输入框 | `bg-input` | `0 0% 89.8%` | `#e5e5e5` | `0 0% 14.9%` | `#262626` | 输入框背景 |

### 3.2 强调背景

| Token | className | Light HSL | Light HEX | Dark HSL | Dark HEX | 用途 |
|-------|-----------|-----------|-----------|----------|----------|------|
| 主色 | `bg-primary` | `0 0% 9%` | `#171717` | `0 0% 98%` | `#fafafa` | 主 CTA、Active 标签 |
| 次级 | `bg-secondary` | `0 0% 96.1%` | `#f5f5f5` | `0 0% 14.9%` | `#262626` | 次级按钮 |
| 强调 | `bg-accent` | `0 0% 96.1%` | `#f5f5f5` | `0 0% 40%` | `#666666` | hover/当前项 |

### 3.3 状态背景（Solid 按钮）

| Token | className | Light HSL | Light HEX | Dark HSL | Dark HEX | 用途 |
|-------|-----------|-----------|-----------|----------|----------|------|
| 成功 | `bg-success` | `142 71% 38%` | `#1c9d52` | `142 65% 45%` | `#28b560` | 运行通过、连接成功 |
| 警告 | `bg-warning` | `38 92% 50%` | `#f59e0b` | `38 92% 55%` | `#fbbf24` | pending、待审 |
| 错误 | `bg-destructive` | `0 84.2% 60.2%` | `#ef4444` | `0 55% 45%` | `#b91c1c` | 删除、Stop |
| 信息 | `bg-info` | `217 91% 60%` | `#3b82f6` | `217 91% 65%` | `#60a5fa` | 引导 tag、连接提示 |

### 3.4 组件专用背景

| Token | className | Light HSL | Light HEX | Dark HSL | Dark HEX | 用途 |
|-------|-----------|-----------|-----------|----------|----------|------|
| Popover | `bg-popover` | `0 0% 100%` | `#ffffff` | `0 0% 7%` | `#121212` | 下拉菜单 |
| Dialog | `bg-dialog` | `0 0% 100%` | `#ffffff` | `0 0% 12%` | `#1f1f1f` | 对话框（暗色略亮） |
| Tooltip | `bg-tooltip` | `0 0% 15%` | `#262626` | `0 0% 20%` | `#333333` | 高对比 Tooltip（保留） |
| 代码块 | `bg-code-bg` | `210 13% 12%` | `#1e2228` | `210 13% 12%` | `#1e2228` | Markdown 代码块 |

---

## 四、边框颜色 Token

| Token | className | Light HSL | Light HEX | Dark HSL | Dark HEX | 用途 |
|-------|-----------|-----------|-----------|----------|----------|------|
| 边框 | `border-border` | `0 0% 89.8%` | `#e5e5e5` | `0 0% 14.9%` | `#262626` | 细边框 |
| 输入框边框 | `border-input` | `0 0% 89.8%` | `#e5e5e5` | `0 0% 14.9%` | `#262626` | 输入框 |
| 聚焦环 | `ring-ring` | `0 0% 3.9%` | `#0a0a0a` | `0 0% 83.1%` | `#d4d4d4` | focus ring（已全局禁用） |
| 虚线边框 | `border-[hsl(var(--dashed-border))]` | `0 0% 9% / 0.35` | `#17171759` | `0 0% 98% / 0.25` | `#fafafa40` | 新会话、搜索按钮 |
| 虚线 hover | `border-[hsl(var(--dashed-border-hover))]` | `0 0% 9% / 0.50` | `#17171780` | `0 0% 98% / 0.40` | `#fafafa66` | 虚线 hover |

---

## 五、专用场景色值

### 5.1 Diff 高亮

| 用途 | Token | HSL (Light/Dark 同) | HEX | 说明 |
|------|-------|---------------------|-----|------|
| 新增行背景 | `--diff-add-bg` | `142 71% 45% / 0.1` | `#22c55e1a` | edit/write-result 加行 |
| 新增行前景 | `--diff-add-fg` | `142 76% 73% / 0.6` | `#86efac99` | 加行行号/标记 |
| 新增行文字 | `--diff-add-text` | `142 77% 73%` | `#86efac` | 加行正文 |
| 删除行背景 | `--diff-del-bg` | `0 84% 60% / 0.1` | `#ef44441a` | edit-result 删行 |
| 删除行前景 | `--diff-del-fg` | `0 91% 71% / 0.6` | `#fca5a599` | 删行行号/标记 |
| 删除行文字 | `--diff-del-text` | `0 94% 82%` | `#fecaca` | 删行正文 |

### 5.2 搜索高亮

| 用途 | Token | HSL | HEX | 说明 |
|------|-------|-----|-----|------|
| 搜索匹配背景 | `--search-hit-bg` | `53 98% 65% / 0.3` | `#fde0474d` | grep 命中高亮底 |
| 搜索匹配文字 | `--search-hit-fg` | `54 97% 77%` | `#fef08a` | grep 命中字色 |

### 5.3 代码容器（Bash/Terminal/Edit/Read/Write）

| 用途 | Token | HSL | HEX | 说明 |
|------|-------|-----|-----|------|
| 容器背景 | `--code-container-bg` | `240 6% 10%` | `#18181b` | 亮 zinc-900 / 暗 zinc-950 |
| 主要文字 | `--code-container-fg` | `240 5% 96%` | `#f4f4f5` | zinc-100 |
| 行号/计数 | `--code-container-muted` | `240 5% 65%` | `#a1a1aa` | zinc-500 |
| 文件名加亮 | `--code-container-emphasis` | `240 5% 84%` | `#d4d4d8` | zinc-300 |
| 代码正文 | `--code-container-text` | `240 5% 91%` | `#e4e4e7` | zinc-200 |
| grep 文件头 | `--code-container-subheader` | `240 4% 16% / 0.5` | `#27272a80` | zinc-800/50 |
| grep 行 hover | `--code-container-row-hover` | `240 4% 16% / 0.3` | `#27272a4d` | zinc-800/30 |

### 5.4 ChoiceCard 危险等级

| 用途 | Token | HSL | HEX |
|------|-------|-----|-----|
| 安全选项边框 | `--choice-safe-border` | `142 71% 45% / 0.4` | `#22c55e66` |
| 危险选项边框 | `--choice-dangerous-border` | `38 92% 50% / 0.7` | `#f59e0bb3` |
| 危险选项标题（亮） | `--choice-dangerous-fg` | `32 95% 44%` | `#dc2626` |
| 危险选项标题（暗） | `--choice-dangerous-fg` | `43 96% 56%` | `#fbbf24` |
| 焦点前缀竖条 | `--choice-dangerous-prefix` | `38 92% 50%` | `#f59e0b` |

### 5.5 相关度梯度（5 档）

| 档位 | Token | HSL | HEX | 颜色名 | 用途 |
|------|-------|-----|-----|--------|------|
| 最低 | `--relevance-0` | `0 84% 60% / 0.6` | `#ef444499` | Red | 相关度 0-20% |
| 偏低 | `--relevance-1` | `28 92% 56% / 0.6` | `#fb923c99` | Orange | 相关度 20-40% |
| 中等 | `--relevance-2` | `38 92% 50% / 0.6` | `#f59e0b99` | Amber | 相关度 40-60% |
| 偏高 | `--relevance-3` | `158 64% 52% / 0.6` | `#10b98199` | Emerald | 相关度 60-80% |
| 最高 | `--relevance-4` | `142 71% 45% / 0.6` | `#22c55e99` | Green | 相关度 80-100% |

---

## 六、快速复制代码块

### 6.1 文字颜色（最常用）

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

### 6.2 按钮（背景+配对文字）

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

### 6.3 Badge 标签

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

### 6.4 常见组合模式

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

## 七、Figma/设计工具色值

### 7.1 Light 主题核心色

```
主文字：     #0a0a0a (HSL: 0, 0%, 3.9%)
次要文字：   #737373 (HSL: 0, 0%, 45.1%)
主背景：     #ffffff (HSL: 0, 0%, 100%)
卡片背景：   #ffffff (HSL: 0, 0%, 100%)
次要背景：   #f5f5f5 (HSL: 0, 0%, 96.1%)
边框：       #e5e5e5 (HSL: 0, 0%, 89.8%)

主色：       #171717 (HSL: 0, 0%, 9%)
成功：       #1c9d52 (HSL: 142, 71%, 38%)
警告：       #f59e0b (HSL: 38, 92%, 50%)
错误：       #ef4444 (HSL: 0, 84.2%, 60.2%)
信息：       #3b82f6 (HSL: 217, 91%, 60%)
```

### 7.2 Dark 主题核心色

```
主文字：     #fafafa (HSL: 0, 0%, 98%)
次要文字：   #a3a3a3 (HSL: 0, 0%, 63.9%)
主背景：     #121212 (HSL: 0, 0%, 7%)
卡片背景：   #121212 (HSL: 0, 0%, 7%)
次要背景：   #262626 (HSL: 0, 0%, 14.9%)
边框：       #262626 (HSL: 0, 0%, 14.9%)

主色：       #fafafa (HSL: 0, 0%, 98%)
成功：       #28b560 (HSL: 142, 65%, 45%)
警告：       #fbbf24 (HSL: 38, 92%, 55%)
错误：       #b91c1c (HSL: 0, 55%, 45%)
信息：       #60a5fa (HSL: 217, 91%, 65%)
```

---

## 八、使用规范

### 8.1 文字颜色决策树

```
需要显示文字？
│
├─ 是主要内容/标题？
│  └─ 用 text-foreground
│
├─ 是次要说明/描述？
│  └─ 用 text-muted-foreground
│
├─ 是状态/操作结果？
│  ├─ 成功 → text-success
│  ├─ 警告 → text-warning
│  ├─ 错误 → text-destructive
│  └─ 信息 → text-info
│
├─ 是链接/Active状态？
│  └─ 用 text-primary
│
└─ 在有色背景上？
   ├─ bg-primary → text-primary-foreground
   ├─ bg-destructive → text-destructive-foreground
   ├─ bg-success → text-success-foreground
   └─ ...（配对规则）
```

### 8.2 禁止的用法

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

### 8.3 侧边栏专用不透明度

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

**不透明度约定**：
- 默认状态 = `text-foreground/60`
- Hover 状态 = `text-foreground`
- Active 状态 = `text-foreground`（配 `bg-primary/10`）
- 分组标签 = `text-foreground/40`
- 空态提示 = `text-foreground/30`

### 8.4 快速检查清单

开发时自检：
- [ ] 主文字用 `text-foreground`
- [ ] 次要文字用 `text-muted-foreground`
- [ ] 状态文字用状态 token（`text-success` 等）
- [ ] 有色背景用配对前景色（`text-*-foreground`）
- [ ] 无 `text-red-500` / `text-blue-400` 等调色板
- [ ] 无 `text-zinc-*` / `text-gray-*` 等中性调色板
- [ ] 无 inline `style={{ color: ... }}`
- [ ] 无 `italic` / `<em>` 斜体
- [ ] 滚动容器带 `scrollbar-thin`
- [ ] 在亮/暗主题下都测试过对比度

---

## 九、相关文档

| 文档 | 关系 |
|------|------|
| [`docs/design.md`](./design.md) | 完整设计规范（原则、组件层级、反模式清单） |
| [`apps/electron/src/renderer/styles/tokens.css`](../apps/electron/src/renderer/styles/tokens.css) | Token 数值真相源（`:root` + `.dark`） |
| [`apps/electron/tailwind.config.js`](../apps/electron/tailwind.config.js) | `theme.extend.colors` 暴露 token |
| [`CLAUDE.md §2`](../CLAUDE.md) | UI 总则与硬约束 |

---

**记忆口诀**：
1. 📖 **主文字** = `text-foreground`
2. 💭 **次要文字** = `text-muted-foreground`
3. 🎯 **状态文字** = `text-success` / `text-destructive` / `text-warning` / `text-info`
4. 🔗 **Link/Active** = `text-primary`
5. 🎨 **有色背景** = 必用配对色 `text-*-foreground`
6. 🚫 **禁止斜体** = 用颜色或字重表达轻强调
7. 🚫 **禁止调色板** = 用语义 token

---

_本文档随 tokens.css 同步更新。HSL/HEX 色值不一致即为缺陷。_

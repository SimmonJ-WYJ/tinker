# Tinker Design Guide

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../apps/electron/resources/tinker-logos/Tinker-horizontal-white.svg">
  <img src="../apps/electron/resources/tinker-logos/Tinker-horizontal-color.svg" alt="Tinker 横版标志" width="180">
</picture>

> **真相源**：本文档定义 Tinker 的品牌与界面视觉规范。界面 token 的数值以 [`apps/electron/src/renderer/styles/tokens.css`](../apps/electron/src/renderer/styles/tokens.css)（`:root` 与 `.dark` 两块，由 [ADR-003](./adr/ADR-003-ui-design-system-layering.md) B-2 / [#303](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/303) 从 `globals.css` 拆出）为准。实现层另含 `base.css` / `components.css` / `utilities.css` / `theme-overrides.css`，注入层 `globals.css` 通过 `@import` 串联——见 §十一。任何 token 改动需先回到本文档对齐，再落实现。

---

## 一、本文档的定位与受众

| 维度 | 内容 |
|------|------|
| **作用** | 定义品牌标识 / 色彩 / 排版 / 间距 / 形态 / 组件层级 / 反模式；让 Agent 写 UI 时凭一份文档就能正确使用 token |
| **受众** | 前端工程师、Agent（ui-designer / claude）、Reviewer、设计师 |
| **不在范围** | 业务流程、IPC 通道、文案 i18n（详见 [`CLAUDE.md §7.4`](../CLAUDE.md) 与 [`docs/architecture.md`](./architecture.md)）|
| **关联文档** | [`CLAUDE.md §2`](../CLAUDE.md)（UI 总则）、[`ADR-003`](./adr/ADR-003-ui-design-system-layering.md)（分层方案）|

---

## 二、五条设计原则

1. **中性界面** — 界面以中性灰阶为基础。品牌蓝用于 Logo，渠道操作色和状态色分别按各自的语义使用（见 §3.3–§3.4）。
2. **卡片 + 阴影替代边框** — 区块边界优先用 `settings-card`（背景 + 阴影），不用 `border` 描边。深色主题下卡片可降为细边框（`border-border/30`）。
3. **token 优先于硬编码** — 业务代码禁止 `bg-red-500 / text-blue-400` 类调色板 className；必须走语义 token（`bg-destructive / text-primary`）。例外：diff / 搜索高亮 / ChoiceCard 危险等级 / `tool-result-renderer` 代码容器等真有专属语义的场景走专用 token（已实装 `--diff-* / --search-hit-* / --choice-* / --code-container-*`，见 §3.4）。
4. **亮 / 暗双主题** — 仅维护 `:root`（亮）与 `.dark`（暗）两套 token。其他主题（ocean / forest / slate）已在 2026-05 清理；切主题靠 body class，不靠运行时主题对象。
5. **组件优先于 inline 重写** — 已存在的 `components/ui/*`（shadcn 17 件）与 `components/settings/primitives/*`（13 件 + `SettingsUIConstants.ts`）是默认入口；新增 inline className 前先检查是否能复用 primitive。

---

## 品牌标识

- 产品名统一写作 **Tinker**，首字母大写。应用名称、产品文案和设计文档沿用这一写法。
- 使用当前的 **Tinker VI v4-A**。保留图形模块的原始轮廓、比例和字标字距。三处接缝已校准：普通版最短轮廓距离为 18 个局部 SVG 单位，Micro 为 26，禁止再单独挤压某个接缝。横版包含字标，显示宽度至少 140 px。
- 登录页使用横版。新会话欢迎页使用独立图形，启动遮罩使用白色图形。左侧导航从会话操作开始，省去 Logo 区块。
- 应用图标使用带暖白底的图标资产。16 / 24 px 使用 Micro 版本，macOS 菜单栏使用单色模板。

| 版本 | 浅色背景 | 深色或反色背景 |
|---|---|---|
| 横版标志 | [黑蓝横版](../apps/electron/resources/tinker-logos/Tinker-horizontal-color.svg) | [白色横版](../apps/electron/resources/tinker-logos/Tinker-horizontal-white.svg) |
| 独立图形 | [黑蓝图形](../apps/electron/resources/tinker-logos/Tinker-symbol-color.svg) | [白色图形](../apps/electron/resources/tinker-logos/Tinker-symbol-white.svg) |

[应用图标](../apps/electron/resources/tinker-logos/Tinker-app-icon.svg) · [Micro 应用图标](../apps/electron/resources/tinker-logos/Tinker-app-icon-micro.svg) · [桌面 Logo 组件](../apps/electron/src/renderer/components/auth/TinkerLogo.tsx)

---

## 三、色彩 token 字典

### 3.1 命名约定

- 所有 token 用 CSS 变量定义，**值为 HSL 分量字符串**（不含 `hsl()` 包裹），便于 Tailwind 的 `hsl(var(--xxx) / <alpha-value>)` 模板叠 alpha：
  ```css
  --background: 0 0% 100%;   /* 正确 */
  --background: #ffffff;      /* 禁止 */
  ```
- 名称用 kebab-case；语义优先于颜色（用 `--destructive` 不用 `--red`）。
- `*-foreground` 是配对前景色（保证对比度）。
- alpha 用 `/ N`（如 `--dashed-border: 0 0% 9% / 0.35`），不用 `rgba()`。

### 3.2 中性与基础

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--background` | `0 0% 100%` | `0 0% 7%` | 顶层窗口/侧边栏背景 |
| `--foreground` | `0 0% 3.9%` | `0 0% 98%` | 主文字 |
| `--muted` | `0 0% 96.1%` | `0 0% 14.9%` | 次要背景（hover、disabled） |
| `--muted-foreground` | `0 0% 45.1%` | `0 0% 63.9%` | 次要文字 |
| `--border` | `0 0% 89.8%` | `0 0% 14.9%` | 细边框（仅暗色卡片回退用） |
| `--input` | `0 0% 89.8%` | `0 0% 14.9%` | 输入框边框 |
| `--ring` | `0 0% 3.9%` | `0 0% 83.1%` | 聚焦环（中性，与主色同色相） |
| `--content-area` | `0 0% 100%` | `0 0% 7%` | 主内容区域背景（与 `--background` 同色，预留以备未来双色分离） |

### 3.3 品牌色与界面强调

| 品牌资产色 | HEX | 用途 |
|---|---|---|
| 品牌黑 | `#111111` | 浅色版 Logo 的字标和主体图形 |
| 品牌蓝 | `#163BFF` | 浅色版图形左下的蓝色模块和横版字标的 i 点 |
| 反白 | `#FFFFFF` | 暗色或反色背景上的整枚 Logo |
| 图标底色 | `#F8F6F1` | 应用图标的暖白底 |

品牌用色以仓库中的资产和组件样式为准。 [SVG 源文件](../apps/electron/resources/tinker-logos) · [Logo 样式](../apps/electron/src/renderer/components/auth/tinker-logo.css)

通用控件沿用亮色近黑、暗色近白的 `--primary`。模型与渠道页使用 `--channel-control` 作为添加、保存和启用操作的专用蓝色。提示和连接反馈使用 §3.4 的状态色。

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--primary` | `0 0% 9%` | `0 0% 98%` | 主要 CTA 按钮、Link、Active 标签（中性近黑 / 近白，亮暗翻色） |
| `--primary-foreground` | `0 0% 98%` | `0 0% 9%` | 主按钮前景文字（与 primary 翻色） |
| `--secondary` | `0 0% 96.1%` | `0 0% 14.9%` | 次级按钮背景 |
| `--secondary-foreground` | `0 0% 9%` | `0 0% 98%` | 次级按钮前景 |
| `--accent` | `0 0% 96.1%` | `0 0% 40%` | hover / 当前项强调 |
| `--accent-foreground` | `0 0% 9%` | `0 0% 98%` | accent 配对前景 |
| `--channel-control` | `218 100% 44%` | `218 100% 44%` | 模型与渠道页的添加、保存按钮和已启用开关 |

> 注：`.dark` 下 `--accent` 取 `0 0% 40%`（中等亮度灰），比 `--muted` 明显更亮，用于"hover 但不抢眼"。亮色下 accent ≈ muted，hover 视觉差异主要靠 `--muted-foreground` 切换。

### 3.4 状态色

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--destructive` | `0 84.2% 60.2%` | `0 55% 45%` | 危险动作（删除、Stop） |
| `--destructive-foreground` | `0 0% 98%` | `0 0% 98%` | destructive 前景文字 |
| `--success` | `142 71% 38%` | `142 65% 45%` | 成功反馈（运行通过、连接成功、+ diff 行） |
| `--success-foreground` | `0 0% 100%` | `0 0% 100%` | success 前景文字 |
| `--warning` | `38 92% 50%` | `38 92% 55%` | 警告但非错误（pending、待审、有改动未保存） |
| `--warning-foreground` | `0 0% 100%` | `0 0% 100%` | warning 前景文字 |
| `--info` | `217 91% 60%` | `217 91% 65%` | 中性提示（引导 tag、连接提示、进行中） |
| `--info-foreground` | `0 0% 100%` | `0 0% 100%` | info 前景文字 |
| `--stop-hover-bg` | `hsla(0, 80%, 60%, 0.12)` | `hsl(0, 40%, 18%)` | "Stop" 按钮 hover 背景（与 destructive 一致的红，更低饱和） |

**专用语义出口**（`tool-result-renderers` / `ChoiceCard` 等业务场景共用，B-3 / [#303](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/303) / [#304](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/304) / [#309](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/309) 落地）：

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--diff-add-bg` | `142 71% 45% / 0.1` | 同 light | edit/write-result 加行底色（替代 `bg-green-500/10`） |
| `--diff-add-fg` | `142 76% 73% / 0.6` | 同 light | 加行行号 / 标记色 |
| `--diff-add-text` | `142 77% 73%` | 同 light | 加行正文字色 |
| `--diff-del-bg` | `0 84% 60% / 0.1` | 同 light | edit-result 删行底色（替代 `bg-red-500/10`） |
| `--diff-del-fg` | `0 91% 71% / 0.6` | 同 light | 删行行号 / 标记色 |
| `--diff-del-text` | `0 94% 82%` | 同 light | 删行正文字色 |
| `--search-hit-bg` | `53 98% 65% / 0.3` | 同 light | grep 命中高亮底（替代 `bg-yellow-300/30`） |
| `--search-hit-fg` | `54 97% 77%` | 同 light | grep 命中字色 |
| `--choice-safe-border` | `142 71% 45% / 0.4` | 同 light | ChoiceCard 安全选项边框（emerald-500/40） |
| `--choice-dangerous-border` | `38 92% 50% / 0.7` | 同 light | ChoiceCard 危险选项边框（amber-500/70） |
| `--choice-dangerous-fg` | `32 95% 44%` | `43 96% 56%` | 危险选项标题（亮 amber-600 / 暗 amber-400） |
| `--choice-dangerous-prefix` | `38 92% 50%` | 同 light | 焦点前缀竖条（amber-500） |

**`tool-result-renderer` 代码/终端容器**（bash / edit / grep / read / write-result 共用；区别于 §3.5 `--code-bg` 用于 Shiki / tiptap pre 内层）：

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--code-container-bg` | `240 6% 10%` | `240 9% 4%` | 容器外层（亮 zinc-900 / 暗 zinc-950 强化"沉入"感） |
| `--code-container-fg` | `240 5% 96%` | 同 light | 主要前景文字（zinc-100） |
| `--code-container-muted` | `240 5% 65%` | 同 light | 行号 / 计数 / 命令回显（zinc-500） |
| `--code-container-emphasis` | `240 5% 84%` | 同 light | 文件名加亮（zinc-300） |
| `--code-container-text` | `240 5% 91%` | 同 light | 代码正文（zinc-200） |
| `--code-container-subheader` | `240 4% 16% / 0.5` | 同 light | grep 文件分组头（zinc-800/50） |
| `--code-container-row-hover` | `240 4% 16% / 0.3` | 同 light | grep match 行 hover（zinc-800/30） |

**相关度梯度**（RelevanceBadge / SessionPapersStatsBar RELEVANCE_COLORS 5 档梯度）：

| Token | Light / Dark | 默认色 | 用途 |
|---|---|---|---|
| `--relevance-0` | 同值 | `0 84% 60% / 0.6` | 最低（red-400/60） |
| `--relevance-1` | 同值 | `28 92% 56% / 0.6` | 偏低（orange-400/60） |
| `--relevance-2` | 同值 | `38 92% 50% / 0.6` | 中（amber-400/60） |
| `--relevance-3` | 同值 | `158 64% 52% / 0.6` | 偏高（emerald-400/60） |
| `--relevance-4` | 同值 | `142 71% 45% / 0.6` | 最高（green-500/60） |

`low → high` 5 档色，用于评分 / 相关度可视化（如 paper 列表的相关度色块）。light / dark 同值；若对比度需调，在 `.dark` 段单独覆盖。

### 3.5 组件专用

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--card` | `0 0% 100%` | `0 0% 7%` | 卡片背景（默认 = `--background`） |
| `--card-foreground` | `0 0% 3.9%` | `0 0% 98%` | 卡片前景 |
| `--popover` | `0 0% 100%` | `0 0% 7%` | popover / dropdown 背景 |
| `--popover-foreground` | `0 0% 3.9%` | `0 0% 98%` | popover 前景 |
| `--dialog` | `0 0% 100%` | `0 0% 12%` | dialog 背景（暗色下比 background 略亮，制造悬浮感） |
| `--dialog-foreground` | `0 0% 3.9%` | `0 0% 98%` | dialog 前景 |
| `--tooltip` | `0 0% 15%` | `0 0% 20%` | 保留 token：专用高对比 Tooltip 背景（全局 TooltipContent 默认走 §6.5 轻量浮层） |
| `--tooltip-foreground` | `0 0% 98%` | `0 0% 98%` | 保留 token：专用高对比 Tooltip 主文字 |
| `--tooltip-muted` | `0 0% 75%` | `0 0% 70%` | 保留 token：专用高对比 Tooltip 副文字 |
| `--code-bg` | `210 13% 12%` | `210 13% 12%` | 代码块背景（亮暗主题统一深蓝灰，`#1e2228`） |
| `--dashed-border` | `0 0% 9% / 0.35` | `0 0% 98% / 0.25` | 虚线边框（新会话、搜索按钮） |
| `--dashed-border-hover` | `0 0% 9% / 0.50` | `0 0% 98% / 0.40` | 虚线边框 hover |

### 3.6 在 Tailwind 中的接入

`tailwind.config.js` 的 `theme.extend.colors` 把 token 全量暴露：

```jsx
<div className="bg-background text-foreground">    {/* token */}
<div className="bg-card border-border/30">         {/* token + alpha */}
<button className="bg-primary text-primary-foreground">  {/* 配对 */}
<div className="bg-red-500 text-blue-400">        {/* ❌ 禁止 */}
```

---

## 四、排版

正文保持 14px 以上。工作台辅助信息明确使用 12px/18px，包括分组标题、图片尺寸、模型与版本详情；导航子行采用 13px/20px。这些是有用途的层级，不是整体缩放。下表按当前 Tailwind 配置和实际 CSS 定义，不以工具类名称猜测尺寸。

字号阶梯（沿用 Tailwind 默认 1rem = 16px）：

| Tailwind | 像素 | 用途 |
|---|---|---|
| 设置页历史 section header | 10 | 存量样式，本轮不扩散到工作台 |
| `--workspace-font-caption` | 12 | 工作台分组标题、图片元数据，行高 18–20px |
| `text-xs` | 14 | 已被 tailwind.config.js 抬至 14px，不能用来表达 12px 辅助文字 |
| `text-sm` | 14 | 默认正文、按钮文字、设置项 label |
| `text-base` | 16 | 区块标题、卡片标题、文献标题 |
| `text-lg+` | 18+ | 仅 onboarding / 空态文案；正常 UI 不用 |

字重：

| Tailwind | 数值 | 用途 |
|---|---|---|
| `font-normal` | 400 | 默认 |
| `font-medium` | 500 | label、需要轻微强调的次级信息 |
| `font-semibold` | 600 | 区块标题、卡片标题、按钮文字 |
| `font-bold` | 700 | 仅 section header（10px uppercase tracking-wider）|

字体栈：**全站统一一种字体**——系统无衬线栈

```
-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif
```

不引入 web font。各 OS 取各自的系统无衬线（macOS = SF Pro，Windows = Segoe UI，Linux = Cantarell / Noto Sans），不引入额外字形。

**硬约束**：

- **禁衬线**。Tinker 界面统一使用无衬线字体。业务界面禁用 `font-serif` 和 `font-family: serif`。
- **禁等宽（一处例外）**：`font-mono` className、`font-family: monospace` 一律禁；**终端回显、diff、行号、grep 命中、inline code、文件路径**等位置统一走上述无衬线栈，容器仍可用 §3.4 `--code-container-*` 给底色 / 缩进 / 行号底纹，但**字体**不切等宽。
  - **例外**：markdown 代码块（`packages/ui/src/code-block/CodeBlock.tsx` 渲染的 `.code-block-wrapper pre.shiki`）保留等宽栈：
    ```
    'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace
    ```
    在 `apps/electron/src/renderer/styles/components.css` 通过 CSS 选择器直接声明，**不**借 Tailwind `font-mono` className（后者在 `tailwind.config.js` 已被覆盖为无衬线，对 className 一致禁用）。例外仅限带 ``` ``` 围栏的代码块；inline `` `code` ``、tool-result-renderer 容器等仍走无衬线。
- **禁斜体**：`italic` className、`font-style: italic`、`<em>` 标签一律禁。需要"次重"或"轻强调"的场景改用 §3.2 `text-muted-foreground` 或字重切换（`font-medium`），不靠斜体。

行高与字距：

- 正文行高用 Tailwind 默认 `leading-normal` / `leading-snug`
- 区块标题 / 主标题用 `tracking-tight`（-0.025em）
- section header 用 `tracking-wider`（0.05em）

---

## 五、间距与栅格

基于 Tailwind 4px 网格。常用阶梯（与 `SettingsUIConstants.ts` 对齐）：

| Tailwind | 像素 | 用途 |
|---|---|---|
| `gap-1` | 4 | icon ↔ label 紧贴 |
| `gap-2 / p-2` | 8 | 紧凑列表 row 内部、按钮内 icon 间距 |
| `gap-3 / py-3` | 12 | settings row 行内（`ROW_CLASS`） |
| `gap-4 / p-4 / px-4` | 16 | 卡片内边距、面板边距 |
| `gap-6 / p-6` | 24 | 区块之间 |
| `gap-8 / mt-8` | 32 | 顶层区块大间距 |

**禁止**：`gap-[5px] / mt-[7px]` 等任意像素值；如必须，用 4 的倍数。

---

## 六、形态：圆角 / 阴影 / 边框

### 6.1 圆角

| Tailwind | 像素 | 用途 |
|---|---|---|
| `rounded-sm` | 2 | （保留备用，无标签用途——标签改用 rounded-md） |
| `rounded` | 4 | 按钮、输入框、小图标按钮 |
| `rounded-md` | 6 | 二级卡片、**语义标签 / 行内 chip（§8.4）** |
| `rounded-lg` | 8 | 主按钮（lg 尺寸）、对话框内卡片 |
| `rounded-xl` | 12 | 设置页顶层卡片（`CARD_CLASS`）、主对话框、轻量浮层（§6.5） |
| `rounded-full` | ∞ | 头像、状态点、滑块 |

### 6.2 阴影（卡片 = 阴影 + 背景，不用 border）

```css
/* utility: .shadow-minimal */
box-shadow:
  0 1px 2px 0 rgb(0 0 0 / 0.03),
  0 1px 3px 0 rgb(0 0 0 / 0.06);
```

层级：

| 阴影类 | 用途 |
|---|---|
| `shadow-minimal` | settings-card 默认 |
| `shadow-sm` | hover 浮起 |
| `shadow-[0_8px_24px_rgba(0,0,0,0.10)]` | popover / dropdown / select / tooltip 等轻量浮层（配合 §6.5 毛玻璃背景） |
| `shadow-2xl` | dialog（带 backdrop） |

### 6.3 边框使用规则

- **优先用阴影 + 背景**做区块切分；
- **仅在以下场景**使用 `border`：
  - 暗色主题下卡片回退（`.dark .settings-card → border-border/30`）；
  - 输入框 / `Select` / `Textarea`（用 `border-input`）；
  - 分隔线（用 `border-border/50` 或 `Separator` 组件）；
  - 虚线 CTA（用 `border-dashed border-[hsl(var(--dashed-border))]`）。

### 6.4 "settings-card" 跨主题差异

```css
.settings-card {
  background: hsl(var(--card));
  box-shadow:
    0 1px 2px 0 rgb(0 0 0 / 0.03),
    0 1px 3px 0 rgb(0 0 0 / 0.06);
}
/* 暗色：卡片背景 = 窗口背景，无法靠阴影区分，改用细边框 */
.dark .settings-card {
  background: transparent;
  box-shadow: none;
  border: 1px solid hsl(var(--border) / 0.3);
}
```

这是设计原则 2 的合法回退：当 card-bg ≈ window-bg 时，阴影失效，降级到细边框。

### 6.5 轻量浮层（Dropdown / Popover / Select / Tooltip）

全局 Radix 浮层内容面统一走 `components/ui/floating-surface.ts`，用于 `DropdownMenuContent`、`DropdownMenuSubContent`、`PopoverContent`、`SelectContent`、`TooltipContent`。

| 维度 | className | 说明 |
|---|---|---|
| 背景 | `bg-popover/85 supports-[backdrop-filter]:bg-popover/75` | 有 backdrop-filter 时进一步降低不透明度，让下层内容轻微透出 |
| 模糊 | `backdrop-blur-xl` | Codex 式毛玻璃浮层，避免纯白实心块压住内容 |
| 边框 | `border border-border/60` | 细边界负责轮廓，不依赖重阴影 |
| 圆角 | `rounded-xl` | Dropdown / Popover / Select / Tooltip 统一半径，业务层不要降级成 `rounded-md` / `rounded-lg` |
| 阴影 | `shadow-[0_8px_24px_rgba(0,0,0,0.10)]` | 轻量扩散阴影；禁止在轻量菜单上回退到 `shadow-lg` / `shadow-xl` |
| 文字 | `text-popover-foreground` | 浮层文字统一走 popover 语义 token |

业务组件可以通过 `className` 覆盖宽度、内距和滚动约束（如 `w-64`、`p-1.5`），但不要在业务层重复写 `rounded-*`、`bg-popover/*`、`backdrop-blur-*` 或菜单阴影。需要非毛玻璃语义时，应先补全局 primitive 或设计文档例外；全局 Tooltip 不再默认使用深色高对比面板。

---

## 七、主题切换契约

- **机制**：靠 body class 切换。`<body class="dark">` 进入暗色；不加 class 默认亮色。
- **不存在**运行时主题对象 / theme atom / IPC 通道。CSS 变量是单一切换面。
- **接入点**：暗色应由 OS 偏好或显式设置驱动，跟踪在 [issue #299](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/299)（Wire system-preference-driven `.dark` toggle）。当前 `apps/electron/main/lib/file-preview-service.ts` 用 `nativeTheme.shouldUseDarkColors` 仅作用于预览 iframe。
- **历史**：ocean / forest / slate × light/dark 共 6 套主题代码已在 2026-05 清理（dead code，从未接通）。

---

## 八、组件层级与使用规则

### 8.1 入口优先级（高 → 低）

1. **`components/settings/primitives/*`** — `SettingsCard / SettingsRow / SettingsInput / SettingsSelect / SettingsToggle / SettingsSegmentedControl / SettingsSection / SettingsSectionHeader / SettingsRadioGroup / SettingsLinkRow / SettingsSecretInput / SettingsEmpty`。所有设置页内容必须用这层组装。
2. **`components/ui/*`**（shadcn 17 件）— `Button / Dialog / Popover / Select / Input / Switch / Checkbox / Tooltip / DropdownMenu / AlertDialog / Badge（tone×variant，§8.4） / Alert / ScrollArea / Separator / Spinner / LoadingIndicator / Sonner / ImageLightbox`。业务通用层。
3. **业务组件**（`components/library / components/agent / components/preview / ...`）— 在 ui + primitives 基础上组合。

### 8.2 常量复用

文件：`apps/electron/src/renderer/components/settings/primitives/SettingsUIConstants.ts`

```ts
LABEL_CLASS                 = 'text-sm font-medium text-foreground'
DESCRIPTION_CLASS           = 'text-sm text-muted-foreground'
SECTION_TITLE_CLASS         = 'text-base font-semibold text-foreground tracking-tight'
SECTION_DESCRIPTION_CLASS   = 'text-sm text-muted-foreground mt-1'
CARD_CLASS                  = 'rounded-xl overflow-hidden settings-card'
ROW_CLASS                   = 'flex items-center justify-between px-4 py-3'
DIVIDER_CLASS               = 'border-border/50'
```

任何在设置页内重复出现的样式组合应进 `SettingsUIConstants` 而不是各文件重写。

### 8.3 实用工具类（globals.css 提供）

| Class | 用途 |
|---|---|
| `settings-card` | 卡片背景 + 阴影组合 |
| `shadow-minimal` | 同上但只取阴影 |
| `shell-bg` | 窗口外壳缝隙背景 |
| `mask-fade-y` | 列表顶/底渐隐遮罩 |
| `scrollbar-thin` | 纤细滚动条（替代浏览器默认） |
| `scrollbar-none` | 隐藏滚动条（保留滚动） |
| `titlebar-drag-region` | Electron 窗口标题栏可拖动区 |
| `titlebar-no-drag` | 标题栏内部按钮排除拖动 |
| `edge-breath` | 边缘呼吸动效（空态引导） |

> **滚动容器约定**：任何垂直滚动容器（`overflow-y-auto` / `overflow-auto` / `overflow-y-scroll`）**必须**带 `scrollbar-thin`，禁止裸用浏览器原生滚动条（macOS 自动隐藏、Win/Linux 粗大，破坏一致性）。需刻意隐藏滚动条（如键盘导航的侧栏）才用 `scrollbar-none`。例外：Radix `<ScrollArea>`（`ui/scroll-area.tsx`）自带样式，无需叠加。

### 8.4 标签族（Badge / Chip）语义规范

标签 = 两个正交轴 × 两个类别。组件入口 `components/ui/badge.tsx`。

**类别一·语义标签（Semantic Badge）** — 独立语义色块。基底 `inline-flex items-center rounded-md px-2.5 py-0.5 text-badge font-normal`。

- **tone（语义色）**：`neutral`(默认) / `primary` / `info` / `success` / `warning` / `destructive`
- **variant（形态）**：`soft`(默认) / `solid` / `outline`

| tone \ variant | soft（默认，底色 /10） | solid | outline |
|---|---|---|---|
| neutral | `bg-muted text-muted-foreground` | `bg-muted text-foreground` | `border-border text-muted-foreground` |
| primary | `bg-primary/10 text-primary` | `bg-primary text-primary-foreground` | `border-primary text-primary` |
| info | `bg-info/10 text-info` | `bg-info text-info-foreground` | `border-info text-info` |
| success | `bg-success/10 text-success` | `bg-success text-success-foreground` | `border-success text-success` |
| warning | `bg-warning/10 text-warning` | `bg-warning text-warning-foreground` | `border-warning text-warning` |
| destructive | `bg-destructive/10 text-destructive` | `bg-destructive text-destructive-foreground` | `border-destructive text-destructive` |

> soft 底色统一 `/10`（禁止 `/5` / `/15`）。需要绿/黄/蓝语义标签时只用 `<Badge tone=...>`，禁止手写 `bg-success/15` 等。`SettingsPill` 已并入本组件（用 `<Badge tone=... variant="soft">` 替代）。

**类别二·行内 chip（Inline Chip）** — 嵌正文/对话文字流的短胶囊（文件路径、DOI、引用 `[N]`、关键词）。真相源 `components/ai-elements/inline-label-style.ts`：`rounded-md bg-muted-foreground/15 text-[14px] text-foreground/85`，**14px 贴正文**（区别于语义标签 12px），可点击叠 `INLINE_LABEL_INTERACTIVE_CLASS`。注：CitationBadge 因渲染在 prose 文字流内、用 inline style（规避 Tailwind JIT 漏扫 + prose `!important`），颜色用 `hsl(var(...))` 形式引用语义变量（同源中性 token）。

**形态例外（合法，非违规）**：计数角标 / `+N`（EvidenceSetBadgeStack）、状态圆点（UpdateBadge dot）、起手式胶囊按钮（StarterChips）、可点击导航 pill（LeftSidebar Zotero badge）用 `rounded-full` —— 它们是非语义标签特例。

**分数色阶不并入 tone**：RelevanceBadge / ScoreBadge 用 §3.4 的相关度梯度（5 档），属分数色阶非通用语义，但圆角/字号对齐本节（`rounded-md` / `text-badge`）。

---

## 九、反模式清单

> 出现以下任一情况应在 review 中被拦截。

| 反模式 | 修正 |
|---|---|
| `<div className="bg-red-500 text-blue-400">` | 用 token：`bg-destructive text-primary` |
| `<div className="bg-zinc-900 text-zinc-100">` | 用 token：`bg-background text-foreground` |
| `<div style={{ color: '#ff0000' }}>` | 用 token + className |
| `<div className="border border-gray-200">` | 卡片走 `settings-card`；分隔走 `Separator` |
| `<div className="p-[7px] mt-[13px]">` | 用 4 的倍数：`p-2 mt-3` |
| `<div className="text-[13px]">` | 用阶梯：`text-xs` 或 `text-sm` |
| `<div className="overflow-y-auto">`（裸原生滚动条） | 加 `scrollbar-thin`（刻意隐藏才用 `scrollbar-none`） |
| `<button>delete</button>` | 用 `<Button variant="destructive">` |
| 设置页直接 `<div className="rounded-xl border ...">` | 用 `<SettingsCard>` |
| 设置项手写 `flex items-center justify-between px-4 py-3` | 用 `<SettingsRow>` 或 `ROW_CLASS` |
| `import { useTranslation } from 'react-i18next'` | 改 `import { useT } from '@/hooks/useT'`（[CLAUDE.md §7.4](../CLAUDE.md)） |
| `<span className="italic">` / `<em>` / `font-style: italic` | 禁斜体；改 `text-muted-foreground` 或 `font-medium` 表达轻强调（§4）|
| `<pre className="font-mono">` / `font-family: monospace` / Tailwind `font-mono` | 禁等宽；终端 / diff / 行号 / inline code / 文件路径 走全站无衬线栈。**例外**：markdown 代码块（CodeBlock，§4）通过 `.code-block-wrapper pre.shiki` CSS 选择器声明等宽栈，不借 className |
| `<span className="font-serif">` / `font-family: serif` | 禁衬线；全站只用 §4 系统无衬线栈 |
| 可聚焦元素加 focus ring：`focus:ring-2 focus-visible:ring-ring` / `focus:ring-offset-*` / `ring-ring` | 删掉——focus ring 已全局抹平（`utilities.css` `@layer utilities` 内 `html :focus-visible { --tw-ring-color: transparent }`，[#525](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/525)）。聚焦态只靠 bg / border / opacity 变化表达。**例外**：非聚焦的状态 ring 合法（选中态 `ring-1 ring-primary`、拖拽高亮 `ring-2 ring-info`、装饰 ring），那是状态指示不是聚焦环 |
| 手写 `bg-success/15` / `bg-info/15` 拼语义标签 | 用 `<Badge tone=... variant="soft">`，透明度统一 `/10` |
| `<Badge variant="info">` 又用 className 覆写成 soft | 用 `<Badge tone="info" variant="soft">` |
| 标签写死 hex（`#fde68a`） | 走语义 token，主题才响应 |
| 语义标签用 14px / 行内 chip 用 12px | 语义标签 `text-badge`(12)、行内 chip 14px，不串台 |
| 删除 `<DevOnly>` / `useIsDevMode()` 门控后留下 `bg-red-500` 等调色板硬编码 | dev-only 的 palette 豁免随门控失效；改语义 token（`bg-destructive` 等）并验证亮/暗双主题，i18n 回填见 [`docs/i18n.md`](./i18n.md) §3.8 |

**例外**（必须配注释说明）：

- 第三方品牌色（GitHub badge、Twitter 蓝、Discord 紫）—— 行级 `// eslint-disable-next-line` + 注释解释
- diff / search-hit / ChoiceCard 危险等级 / `tool-result-renderer` 代码容器 —— 走 §3.4 列出的专用 token（B-3 / B-4 / #303 / #304 / #309 已实装），禁止再写 `bg-green-500/10` / `bg-red-500/10` / `bg-yellow-300/30` 等 palette 字面量
- **解除 dev 门控时的 theme 回填**：dev-only（`@/lib/dev-mode` 门控）代码因终端用户不可达，曾默许调色板硬编码。一旦删除门控把功能转为生产 UI，该豁免立即失效——必须把段内所有 Tailwind 调色板 className（`bg-red-500` / `text-blue-600` 等）换成语义 token（§二原则 3、§三 token 字典），并按 §七主题切换契约验证亮/暗双主题均正常。i18n 文案不在本文档范围，对应回填义务见 [`docs/i18n.md`](./i18n.md) §3.8

---

## 十、桌面工作台的比例与细节

本节取代旧的 280px 侧栏、50px 标题栏、强毛玻璃外壳等数值。参考来自用户提供的 Perplexity 截图，只借鉴层级、节奏与平衡；保留 Tinker 品牌、现有信息架构和系统无衬线字体。不宣称这些数值是 Perplexity 的内部 token。

### 10.1 测量方法

- 所有数值为 CSS px。截图的物理像素、设备 DPR 和应用缩放须分别记录，不能拿高分辨率截图尺寸直接改 CSS。
- 验收使用同一视口、同一缩放、同一语言、同一内容状态。首页与首页比，会话与会话比。
- 用 DOM `getBoundingClientRect()` 和 computed style 确认尺寸，再用截图检查视觉重心。不能只凭 className 宣称通过。
- 字体、图标、行高、点击区和留白作为一组调整，不用全局 zoom 把粗糙细节一起缩小。

### 10.2 颜色与表面

专用 token 位于 `styles/tokens.css`。`workspace-home.css` 只在工作台和抽屉内映射到背景、前景和分割语义，不改登录或全局品牌色。

| Token | Light HSL | Dark HSL | 用途 |
| --- | --- | --- | --- |
| `--workspace-chrome` | `240 8% 93%` | `210 10% 9%` | 顶栏和侧栏的共同窗口底色 |
| `--workspace-surface` | `0 0% 99%` | `210 9% 12%` | 阅读面板 |
| `--workspace-ink` | `200 22% 20%` | `200 10% 90%` | 主要文字与图标 |
| `--workspace-muted` | `202 9% 41%` | `210 8% 65%` | 辅助文字 |
| `--workspace-line` | `210 8% 87%` | `210 8% 25%` | 输入与标签的弱分割 |
| `--workspace-hover` | `210 9% 90%` | `210 8% 19%` | 悬停 |
| `--workspace-selected` | `210 9% 87%` | `210 8% 23%` | 当前项 |
| `--workspace-composer` | `0 0% 100%` | `210 8% 16%` | 输入表面 |
| `--workspace-halo` | `210 8% 95%` | `210 8% 14%` | 首页输入框的柔和外圈 |

主面板靠窗口与内容底色区分，不加明显描边或强阴影。输入框保留低对比分割和清楚的聚焦状态。品牌蓝只保留在 Logo 等有品牌语义的位置。

### 10.3 骨架与几何 token

| Token/元素 | 目标值 | 实现规则 |
| --- | --- | --- |
| `--workspace-sidebar-width` | 256px | 顶栏控制区、侧栏和抽屉共享，禁止再写独立 inline 248/280px |
| `--workspace-toolbar-height` | 56px | 窗口按钮 28px，图标 16px，间距 4px |
| `--workspace-panel-radius` | 24px | 主内容面板专用，右/底外距 8px |
| `--workspace-content-width` | 680px | 首页和会话输入表面的共同最大宽度 |
| `--workspace-composer-radius` | 20px | 输入表面专用，首页外圈加 10px，外半径 30px |
| 当前标签 | 高 34px，宽 120–240px | 顶栏容器弹性占据剩余空间，标题省略，不挤走菜单 |
| 窄窗口 | ≤1100px | 使用现有覆盖式抽屉，不把侧栏压成窄字列 |

macOS 非全屏为系统红绿灯保留 108px 起点，全屏/其他平台恢复 16px。侧栏收起宽度为 0，顶部展开按钮仍可用。右侧面板比例、Splitter 和恢复行为沿用现有原子状态，不因视觉调整改变。

### 10.4 侧栏的文字、几何与交互（Figma 115:599，2026-11-08）

本节以用户调整的 [会话画板 115:599](https://www.figma.com/design/qNZ4GSgKdkHK51a5x79VF8/Tinker?node-id=115-599) 的侧栏 115:645 为本次视觉依据。[Figma Design Guide 119:187](https://www.figma.com/design/qNZ4GSgKdkHK51a5x79VF8/Tinker?node-id=119-187) 包含可编辑的浅/深色标本、尺寸与状态说明。原画板保留。CSS 数值继续以 tokens.css 为实现真相源。

| 元素 | 字号 / 行高 | 几何与间距 |
| --- | --- | --- |
| 一级导航 | 14 / 22px，Medium | 36px 高，2px 行间距 |
| 项目名称 | 14 / 22px，Medium | 30px 高，2px 行间距，8px 圆角 |
| 项目子会话、Recent | 14 / 22px，Regular | 30px 高，Recent 间距 3px，6px 圆角 |
| 分组标题 | 12 / 18px，Medium | 标题与列表相隔 6px，组间 12px |
| 底部账号 | 14 / 22px，Medium | 224 × 40px，左侧 16px，底部 20px，头像 32px |

- 侧栏宽 256px，内容列宽 232px，左右边距各 12px。列表行左右内距 6px。
- 图标盒 14px，图文间距 6px。带图标文字的窗口横坐标为 38px，Recent 为 18px，账号为 60px。源 SVG 固有尺寸保持不变，小加号在图标盒内居中。
- 工具栏高 56px，导航从 y = 56px 开始。macOS 窗口态继续保留 108px 红绿灯安全区，不能用绘图坐标覆盖系统控件。
- 项目文件夹保留独立的展开/收起。右侧「＋」在 hover 或键盘聚焦时可见，复用现有会话创建入口，显式传入该项目 ID 并打开新草稿。等待期间拦截重复点击。
- Recent 默认只显示标题。聚焦行时显露重命名、归档和删除，Enter / Space 打开会话。内部编辑框和按钮不再次触发行导航。
- 选中仅使用单一弱底色。项目内当前会话已高亮时，Recent 不重复绘制底色。长名称单行省略，焦点环和右侧操作保持可达。
- 使用本次 Figma 导出的本地 SVG，不保留临时资源 URL。返回图形在外层镜像还原方向，前进禁用态由真实历史状态决定。暗色反色保留复合图形的明暗差异。

侧栏专用色阶限定在导航作用域，不覆盖聊天正文：

| Token | Light | Dark |
| --- | --- | --- |
| --workspace-sidebar-surface | #ECEDEF | #151719 |
| --workspace-sidebar-ink | #242A2B | #E3E6E8 |
| --workspace-sidebar-muted | #6B6B6B | #9FA6AE |
| --workspace-sidebar-hover | #E3E3E3 | #2D3034 |
| --workspace-sidebar-selected | #DDDDE0 | #363B3F |
| --workspace-sidebar-selected-ink | #121214 | #E3E6E8 |
| --workspace-sidebar-avatar | #8B949B | #637078 |
| --workspace-sidebar-avatar-ink | #FFFFFF | #FFFFFF |

几何 token 属于 workspace-sidebar 命名空间，单位 px：

| 后缀 | 值 | 后缀 | 值 |
| --- | --- | --- | --- |
| --workspace-sidebar-gutter | 12 | --workspace-sidebar-row-inset | 6 |
| --workspace-sidebar-icon | 14 | --workspace-sidebar-icon-gap | 6 |
| --workspace-sidebar-nav-height | 36 | --workspace-sidebar-row-height | 30 |
| --workspace-sidebar-section-gap | 12 | --workspace-sidebar-heading-gap | 6 |
| --workspace-sidebar-recent-gap | 3 | --workspace-sidebar-row-radius | 6 |
| --workspace-sidebar-project-radius | 8 | --workspace-sidebar-font | 14 |
| --workspace-sidebar-line-height | 22 | --workspace-sidebar-label-line-height | 18 |
| --workspace-sidebar-account-height | 40 | --workspace-sidebar-avatar-size | 32 |
| --workspace-sidebar-account-bottom | 20 | --workspace-sidebar-width | 256 |

### 10.5 首页与输入框

- 首页图形 40px，图形与标题间距 22px。标题 36/44px、400 字重、字距 -0.035em；窄窗使用 28/36px。保留系统无衬线字体，避免为仿参考截图而混入不匹配的衬线字体。
- 首页输入框在标题后 32px，编辑区最小 72px，文字 15/24px，内距上 16px、左右 20px。底栏最小 40px，按钮 30px，图标 16px/1.5 线宽。
- 会话编辑区最小 48px，文字 14/22px，内距 14px 18px 6px。正文和输入框各用同一条 680px 内容轴线，不让附件、按钮与正文左右漂移。
- 首页与会话的附件、发送和停止按钮点击区统一 30px；附件 Plus 与发送箭头使用 16px、1.5 线宽，停止使用小实心方形。模式切换按钮高 28px，选中项按标签内容自然伸缩，中文“通用 Agent”不裁切；禁用与锁定状态保留。模型名称可以省略，不能压扁发送按钮。
- 输入表面状态由真实拖拽与渠道/模型可用条件驱动：默认与聚焦之后应用禁用样式；拖拽以 info 语义色边界、浅背景与光晕覆盖聚焦及禁用外观。禁用时配置 CTA 仍可点击，不拦截整个表面的指针事件。
- 编程建议在输入框之后排列；Tab 顺序应与视觉顺序一致。触发建议只回填草稿，不发送请求。
- 低窗口高度和窄宽度分别处理，不把首页内容压到屏幕底部。光标、focus ring、输入提示和禁用状态都要可辨。

### 10.6 图片结果

图片为第一层，编辑/对比/保存为第二层，版本与模型信息为第三层。图片最大高 520px，宽度不超过内容列，预览半径 12px；按钮高 30px，文字 12/18px，图标 16px，间距 8px。

版本链、渠道、模型、参考图数和尺寸限制放入可用键盘展开的原生 `details/summary`。入口明确注明包含费用信息；计费与尺寸说明保留原文，不能为视觉简洁删除。实际尺寸仅从加载后的图片读取。文件缺失、父版本缺失继续外显，不能藏入收起的详情。长文件名与长模型名必须换行或省略，禁止撑破阅读列。

### 10.7 单一实现与验收

- 颜色和几何只在 `tokens.css` 定义，组件和样式读取同名变量。
- `workspace-home.css` 按窗口、导航、首页、输入、项目、窄窗分区。禁止在文件尾反复追加同一 selector 覆盖前面的数值。
- 共用控件基于现有 React/Radix/Lucide；不新增仅为换外观的依赖。新文案同步 en/zh。
- 至少核对浅/深主题、首页/会话、长标题、窄窗、侧栏展开/收起、输入聚焦、错误/缺图和减少动效。
- 截图必须说明是实际应用还是组件预览；组件预览不能当作安装包已更新的证据。

---

## 十一、与其他文档的关系

| 文档 | 关系 |
|---|---|
| [`CLAUDE.md §2`](../CLAUDE.md) | "UI" 一行是 design.md 的"摘要"，本文是展开 |
| [`docs/adr/ADR-003`](./adr/ADR-003-ui-design-system-layering.md) | 分层方案的决策记录；本文是该方案"规范层"的产物 |
| [`apps/electron/tailwind.config.js`](../apps/electron/tailwind.config.js) | `theme.extend.colors` 与本文 §3 必须一一对应 |
| [`apps/electron/src/renderer/styles/tokens.css`](../apps/electron/src/renderer/styles/tokens.css) | **token 数值真相源**；本文档 §3 / §3.4 / §3.5 表格的值必须与此文件 `:root` / `.dark` 块一致（B-2 / #303 拆出） |
| [`apps/electron/src/renderer/styles/base.css`](../apps/electron/src/renderer/styles/base.css) | `@layer base` 全局 element 样式（body / scrollbar / `*`） |
| [`apps/electron/src/renderer/styles/components.css`](../apps/electron/src/renderer/styles/components.css) | `@layer components`：`.settings-card` / `.code-block-wrapper` 等组件级 hook |
| [`apps/electron/src/renderer/styles/utilities.css`](../apps/electron/src/renderer/styles/utilities.css) | `@layer utilities`：§8.3 的所有 utility class 真相源（`.shell-bg` / `.mask-fade-y` / `.scrollbar-*` / `.titlebar-drag-region` / `.shadow-minimal` / 动效 keyframes） |
| [`apps/electron/src/renderer/styles/theme-overrides.css`](../apps/electron/src/renderer/styles/theme-overrides.css) | `.dark` 主题对 `.session-item-selected` / `.mode-slider` / `.tabbar-bg` / `.scroll-progress-thumb` / tiptap pre 的暗色覆盖 |
| [`apps/electron/src/renderer/styles/globals.css`](../apps/electron/src/renderer/styles/globals.css) | **注入层**：`@import` 串联以上 5 文件 + `@tailwind base/components/utilities`（无 token 数值，改 token 不改这里）|
| [`apps/electron/postcss.config.js`](../apps/electron/postcss.config.js) | PostCSS 链 plugin chain 首位 `postcss-import`（B-2 引入，否则 `@import` 顺序失效）|
| [`apps/electron/src/renderer/components/settings/primitives/SettingsUIConstants.ts`](../apps/electron/src/renderer/components/settings/primitives/SettingsUIConstants.ts) | 复合 className 真相源 |

---

## 十二、变更流程

| 改动类型 | 流程 |
|---|---|
| **新增 token** | 1) 改 `tokens.css` 同步 `:root` + `.dark` → 2) 改 `tailwind.config.js` extend → 3) 改本文档对应表格 → 4) PR |
| **调整 token 数值** | 1) 改 `tokens.css` → 2) 改本文档对应表格 → 3) PR（截图新旧主题对比） |
| **新增组件 utility class** | 1) 按层级写到 `components.css` `@layer components` 或 `utilities.css` `@layer utilities` → 2) 改本文档 §8.3 表格 → 3) PR |
| **改本文档的规则 / 反模式清单** | 1) PR + 简短理由说明 → 2) 改后需在 PR description 标注影响范围（哪些已落代码不符合新规则）|
| **删除 token / utility** | 先 grep 确认零引用，再删 |

---

## 十三、当前已知偏差与后续工作

| 项 | 描述 | 跟踪 |
|---|---|---|
| 剩余业务组件 palette 硬编码 | B-3 / B-4（#304 / #310）已迁完 tool-result-renderers + settings/forms（约 51 处）；剩余约 74 处分布在 `AgentMessages` / `GraphPipeline` / `TabBarItem` / `InlinePreview` / `UpdateBadge` / `ContextUsageBadge` / `AgentSessionItem` 等（标签族 hex/透明度已由 §8.4 标签族规范收敛：Badge tone×variant、SettingsPill 并入、CitationBadge token 化、soft 统一 /10） | B-5 / [#295](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/295) |
| ESLint 调色板拦截规则未上线 | 无法机器拦截新增硬编码；B-3/4/5 全合后做 | B-6 / [#296](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/296) |
| 主题验证 | 设置页已通过 `GeneralSettings`、`themeAtom/updateTheme` 接通主题；工作台专用 token 仍须在每次视觉修改后核对两套主题 | 本文 §10.7 |
| design.md ↔ tokens.css 漂移检测 | 无机器守门：本文档 §3.2-§3.5 表格与 `tokens.css :root` / `.dark` 块需 1:1 对齐，目前由人工 review | B-8 / [#298](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/298) `token-parity.test.ts` |

---

_本文档随每次 token / 规则改动同步更新。漂移即缺陷。_


### 对话流与引用图片（Figma 115:604）

数值真相源仍为 tokens.css。上传附件独立于用户气泡，历史引用以确定图片 ID 和来源 SDK UUID 绑定。桌面引用卡内边距/间距 12，缩略图 72×48，气泡内边距16、圆角14；窄窗允许来源文案换行。

| token | 浅色/几何值 | 深色 |
|---|---|---|
| `--conversation-content-width` | 832px | 相同 |
| `--conversation-user-width` | 480px | 相同 |
| `--conversation-upload-width` | 112px | 相同 |
| `--conversation-upload-height` | 148px | 相同 |
| `--conversation-turn-gap` | 40px | 相同 |
| `--conversation-top-inset` | 64px | 相同 |
| `--conversation-composer-height` | 125px | 相同 |
| `--conversation-message-surface` | #F4F5F6 | 210 8% 18% |
| `--conversation-quote-surface` | #FBFBFC | 210 8% 22% |
| `--conversation-body` | #252B30 | 200 10% 90% |
| `--conversation-secondary` | #727C80 | 210 8% 65% |
| `--conversation-quote-title` | #39444B | 200 10% 88% |
| `--conversation-quote-source` | #78848D | 210 8% 70% |
| `--conversation-composer-line` | #D9DDDF | 210 8% 28% |

来源跳转保存阅读锚点，停止自动吸底，短暂高亮并提供按栈返回。旧 UUID 缺失只在确定图片绑定唯一时恢复，缺失/歧义来源不可点击。亮暗主题均保留完整图片预览；减少动态效果使用即时滚动。

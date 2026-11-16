# Tinker Design Guide

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../apps/electron/resources/tinker-logos/Tinker-horizontal-white.svg">
  <img src="../apps/electron/resources/tinker-logos/Tinker-horizontal-color.svg" alt="Tinker horizontal logo" width="180">
</picture>

> **Source of truth**: this document defines Tinker's brand and visual interface rules. Interface token values follow [`apps/electron/src/renderer/styles/tokens.css`](../apps/electron/src/renderer/styles/tokens.css) (`:root` and `.dark`, split from `globals.css` by [ADR-003](./adr/ADR-003-ui-design-system-layering.md) B-2 / [#303](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/303)). Implementation also includes `base.css` / `components.css` / `utilities.css` / `theme-overrides.css`, connected by `@import` in injection-layer `globals.css` (§XI). Align token changes with this document before implementation.

---

<a id="一本文档的定位与受众"></a>

## I. Purpose and Audience

| Dimension | Content |
|------|------|
| **Purpose** | Defines branding / colors / typography / spacing / shapes / component hierarchy / antipatterns, so Agents can use tokens correctly from one document |
| **Audience** | Frontend engineers, Agents (ui-designer / claude), reviewers, designers |
| **Out of scope** | Business flows, IPC channels, copy i18n (see [`CLAUDE.md §7.4`](../CLAUDE.md) and [`docs/architecture.md`](./architecture.md)) |
| **Related documents** | [`CLAUDE.md §2`](../CLAUDE.md) (UI principles), [`ADR-003`](./adr/ADR-003-ui-design-system-layering.md) (layering) |

---

<a id="二五条设计原则"></a>

## II. Five Design Principles

1. **Neutral interface**: neutral grays form the base. Brand blue is for the Logo; channel actions and states use their respective semantic colors (§3.3–§3.4).
2. **Cards + shadows instead of borders**: prefer `settings-card` (background + shadow), not `border` outlines. Dark cards may fall back to thin borders (`border-border/30`).
3. **Tokens before hardcoding**: business code forbids palette classNames like `bg-red-500 / text-blue-400`; use semantic tokens (`bg-destructive / text-primary`). Exceptions with dedicated semantics, such as diff / search highlights / ChoiceCard danger levels / `tool-result-renderer` code containers, use dedicated tokens (implemented `--diff-* / --search-hit-* / --choice-* / --code-container-*`, §3.4).
4. **Light / dark themes**: maintain only `:root` (light) and `.dark` (dark). Other themes (ocean / forest / slate) removed 2026-05; body class switches themes, not runtime theme objects.
5. **Components before inline rewrites**: existing `components/ui/*` (17 shadcn components) and `components/settings/primitives/*` (13 + `SettingsUIConstants.ts`) are default entries; check primitive reuse before adding inline classNames.

---

<a id="品牌标识"></a>

## Brand Identity

- Product name is **Tinker**, initial capital, consistently across app names, product copy, and design documents.
- Use current **Tinker VI v4-A**, preserving original graphic outlines, proportions, and wordmark spacing. Three seams are calibrated: minimum outline distance 18 local SVG units in regular and 26 in Micro; do not squeeze individual seams further. Horizontal lockup includes wordmark, minimum display width 140px.
- Sign-in uses horizontal lockup; new-session welcome uses symbol; startup overlay uses white symbol. Left navigation starts with session actions, omitting a Logo block.
- App icon uses warm-white-backed assets. Use Micro at 16 /24px, monochrome template in macOS menu bar.

| Version | Light background | Dark/inverted background |
|---|---|---|
| Horizontal logo | [Black/blue horizontal](../apps/electron/resources/tinker-logos/Tinker-horizontal-color.svg) | [White horizontal](../apps/electron/resources/tinker-logos/Tinker-horizontal-white.svg) |
| Standalone symbol | [Black/blue symbol](../apps/electron/resources/tinker-logos/Tinker-symbol-color.svg) | [White symbol](../apps/electron/resources/tinker-logos/Tinker-symbol-white.svg) |

[App icon](../apps/electron/resources/tinker-logos/Tinker-app-icon.svg) · [Micro app icon](../apps/electron/resources/tinker-logos/Tinker-app-icon-micro.svg) · [Desktop Logo component](../apps/electron/src/renderer/components/auth/TinkerLogo.tsx)

---

<a id="三色彩-token-字典"></a>

## III. Color Token Dictionary

Chat running text uses `--running-text-base` and `--running-text-sheen`, values in tokens.css. Based on local Codex's default secondary gray,55% base and 75% white sweep, .6-second waiting entrance,1-second sweep,4-second loop,48 samples, preventing prolonged whole-line darkness. Only main-heading interiors change; Logo/secondary copy static. Reduced motion/forced-colors restores plain text without reducing whole-row opacity. Configuration examples/empty-value hints use `--channel-input-placeholder` / `--channel-input-hint`; actual input, labels, and required feedback retain original colors.

<a id="31-命名约定"></a>

### 3.1 Naming

- All tokens are CSS variables with **HSL component-string values**, without `hsl()` wrappers, enabling alpha through Tailwind `hsl(var(--xxx) / <alpha-value>)`:
  ```css
  --background: 0 0% 100%;   /* 正确 */
  --background: #ffffff;      /* 禁止 */
  ```
- kebab-case names; semantics before colors (`--destructive`, not `--red`).
- `*-foreground` is the paired foreground for contrast.
- Alpha uses `/ N` (e.g. `--dashed-border: 0 0% 9% / 0.35`), not `rgba()`.

<a id="32-中性与基础"></a>

### 3.2 Neutral and Base

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--background` | `0 0% 100%` | `0 0% 7%` | Top-level window/sidebar background |
| `--foreground` | `0 0% 3.9%` | `0 0% 98%` | Primary text |
| `--muted` | `0 0% 96.1%` | `0 0% 14.9%` | Secondary backgrounds (hover, disabled) |
| `--muted-foreground` | `0 0% 45.1%` | `0 0% 63.9%` | Secondary text |
| `--border` | `0 0% 89.8%` | `0 0% 14.9%` | Thin borders (dark-card fallback only) |
| `--input` | `0 0% 89.8%` | `0 0% 14.9%` | Input border |
| `--ring` | `0 0% 3.9%` | `0 0% 83.1%` | Focus ring (neutral, same hue as primary) |
| `--content-area` | `0 0% 100%` | `0 0% 7%` | Main content background (same as `--background`, reserved for future two-color separation) |

<a id="33-品牌色与界面强调"></a>

### 3.3 Brand Colors and Interface Emphasis

| Brand asset color | HEX | Purpose |
|---|---|---|
| Brand black | `#111111` | Light Logo wordmark and main symbol |
| Brand blue | `#163BFF` | Light symbol's lower-left module and horizontal wordmark i-dot |
| Reverse white | `#FFFFFF` | Entire Logo on dark/inverted backgrounds |
| Icon background | `#F8F6F1` | Warm-white app icon background |

Brand colors follow repository assets/component styles. [SVG sources](../apps/electron/resources/tinker-logos) · [Logo styles](../apps/electron/src/renderer/components/auth/tinker-logo.css)

Generic controls retain near-black light/near-white dark `--primary`. Models/channels pages use dedicated blue `--channel-control` for add/save/enable actions. Hints/connection feedback use §3.4 state colors.

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--primary` | `0 0% 9%` | `0 0% 98%` | Primary CTAs, links, active tabs (neutral near-black / near-white, inverted by theme) |
| `--primary-foreground` | `0 0% 98%` | `0 0% 9%` | Primary-button text (inverts with primary) |
| `--secondary` | `0 0% 96.1%` | `0 0% 14.9%` | Secondary-button background |
| `--secondary-foreground` | `0 0% 9%` | `0 0% 98%` | Secondary-button foreground |
| `--accent` | `0 0% 96.1%` | `0 0% 40%` | Hover / current-item emphasis |
| `--accent-foreground` | `0 0% 9%` | `0 0% 98%` | Paired accent foreground |
| `--channel-control` | `218 100% 44%` | `218 100% 44%` | Add/save buttons and enabled toggles on models/channels pages |

> In `.dark`, `--accent` is `0 0% 40%` (medium gray), visibly brighter than `--muted` for understated hover. Light accent ≈ muted; hover difference primarily uses `--muted-foreground` changes.

<a id="34-状态色"></a>

### 3.4 State Colors

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--destructive` | `0 84.2% 60.2%` | `0 55% 45%` | Dangerous actions (delete, Stop) |
| `--destructive-foreground` | `0 0% 98%` | `0 0% 98%` | destructive foreground text |
| `--success` | `142 71% 38%` | `142 65% 45%` | Success feedback (run/connection success, + diff lines) |
| `--success-foreground` | `0 0% 100%` | `0 0% 100%` | success foreground text |
| `--warning` | `38 92% 50%` | `38 92% 55%` | Warnings, not errors (pending, review needed, unsaved changes) |
| `--warning-foreground` | `0 0% 100%` | `0 0% 100%` | warning foreground text |
| `--info` | `217 91% 60%` | `217 91% 65%` | Neutral hints (guidance tags, connection hints, in progress) |
| `--info-foreground` | `0 0% 100%` | `0 0% 100%` | info foreground text |
| `--stop-hover-bg` | `hsla(0, 80%, 60%, 0.12)` | `hsl(0, 40%, 18%)` | Stop-button hover background (same red as destructive, lower saturation) |

**Dedicated semantic tokens** (shared by `tool-result-renderers` / `ChoiceCard` and other business cases; implemented in B-3 / [#303](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/303) / [#304](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/304) / [#309](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/309)):

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--diff-add-bg` | `142 71% 45% / 0.1` | Same as light | edit/write-result added-line background (replaces `bg-green-500/10`) |
| `--diff-add-fg` | `142 76% 73% / 0.6` | Same as light | Added-line numbers / markers |
| `--diff-add-text` | `142 77% 73%` | Same as light | Added-line body text |
| `--diff-del-bg` | `0 84% 60% / 0.1` | Same as light | edit-result removed-line background (replaces `bg-red-500/10`) |
| `--diff-del-fg` | `0 91% 71% / 0.6` | Same as light | Removed-line numbers / markers |
| `--diff-del-text` | `0 94% 82%` | Same as light | Removed-line body text |
| `--search-hit-bg` | `53 98% 65% / 0.3` | Same as light | grep-hit background (replaces `bg-yellow-300/30`) |
| `--search-hit-fg` | `54 97% 77%` | Same as light | grep-hit text |
| `--choice-safe-border` | `142 71% 45% / 0.4` | Same as light | ChoiceCard safe-option border (emerald-500/40) |
| `--choice-dangerous-border` | `38 92% 50% / 0.7` | Same as light | ChoiceCard dangerous-option border (amber-500/70) |
| `--choice-dangerous-fg` | `32 95% 44%` | `43 96% 56%` | Dangerous-option heading (light amber-600 / dark amber-400) |
| `--choice-dangerous-prefix` | `38 92% 50%` | Same as light | Focus prefix bar (amber-500) |

**`tool-result-renderer` code/terminal containers** (shared by bash/edit/grep/read/write-result; separate from §3.5 `--code-bg` for inner Shiki/tiptap pre):

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--code-container-bg` | `240 6% 10%` | `240 9% 4%` | Outer container (light zinc-900 / dark zinc-950 for recessed depth) |
| `--code-container-fg` | `240 5% 96%` | Same as light | Main foreground (zinc-100) |
| `--code-container-muted` | `240 5% 65%` | Same as light | Line numbers / counts / command echo (zinc-500) |
| `--code-container-emphasis` | `240 5% 84%` | Same as light | Filename emphasis (zinc-300) |
| `--code-container-text` | `240 5% 91%` | Same as light | Code body (zinc-200) |
| `--code-container-subheader` | `240 4% 16% / 0.5` | Same as light | grep file-group headers (zinc-800/50) |
| `--code-container-row-hover` | `240 4% 16% / 0.3` | Same as light | grep-match row hover (zinc-800/30) |

**Relevance gradient** (RelevanceBadge / SessionPapersStatsBar RELEVANCE_COLORS,5 levels):

| Token | Light / Dark | Default | Purpose |
|---|---|---|---|
| `--relevance-0` | Same value | `0 84% 60% / 0.6` | Lowest (red-400/60) |
| `--relevance-1` | Same value | `28 92% 56% / 0.6` | Low (orange-400/60) |
| `--relevance-2` | Same value | `38 92% 50% / 0.6` | Medium (amber-400/60) |
| `--relevance-3` | Same value | `158 64% 52% / 0.6` | High (emerald-400/60) |
| `--relevance-4` | Same value | `142 71% 45% / 0.6` | Highest (green-500/60) |

Five `low → high` colors visualize scores/relevance (e.g. paper-list relevance blocks). Same light/dark values; override `.dark` separately if contrast needs adjustment.

<a id="35-组件专用"></a>

### 3.5 Component-Specific

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--card` | `0 0% 100%` | `0 0% 7%` | Card background (default = `--background`) |
| `--card-foreground` | `0 0% 3.9%` | `0 0% 98%` | Card foreground |
| `--popover` | `0 0% 100%` | `0 0% 7%` | popover / dropdown background |
| `--popover-foreground` | `0 0% 3.9%` | `0 0% 98%` | popover foreground |
| `--dialog` | `0 0% 100%` | `0 0% 12%` | dialog background (slightly brighter than dark background for floating depth) |
| `--dialog-foreground` | `0 0% 3.9%` | `0 0% 98%` | dialog foreground |
| `--tooltip` | `0 0% 15%` | `0 0% 20%` | Reserved: dedicated high-contrast Tooltip background (global TooltipContent defaults to §6.5 lightweight surface) |
| `--tooltip-foreground` | `0 0% 98%` | `0 0% 98%` | Reserved: high-contrast Tooltip primary text |
| `--tooltip-muted` | `0 0% 75%` | `0 0% 70%` | Reserved: high-contrast Tooltip secondary text |
| `--code-bg` | `210 13% 12%` | `210 13% 12%` | Code-block background (same deep blue-gray `#1e2228` in both themes) |
| `--dashed-border` | `0 0% 9% / 0.35` | `0 0% 98% / 0.25` | Dashed borders (new session/search buttons) |
| `--dashed-border-hover` | `0 0% 9% / 0.50` | `0 0% 98% / 0.40` | Dashed-border hover |

<a id="36-在-tailwind-中的接入"></a>

### 3.6 Tailwind Integration

`tailwind.config.js` `theme.extend.colors` exposes all tokens:

```jsx
<div className="bg-background text-foreground">    {/* token */}
<div className="bg-card border-border/30">         {/* token + alpha */}
<button className="bg-primary text-primary-foreground">  {/* 配对 */}
<div className="bg-red-500 text-blue-400">        {/* ❌ 禁止 */}
```

---

<a id="四排版"></a>

## IV. Typography

Body text stays at least14px. Workbench auxiliary information uses12px/18px, including group headings, image sizes, model/version details; navigation child rows 13px/20px. These are purposeful hierarchy, not global scaling. Values follow current Tailwind configuration/actual CSS, not guesses from utility names.

Font-size scale (Tailwind default1rem=16px):

| Tailwind | Pixels | Purpose |
|---|---|---|
| Historical settings section header | 10 | Existing style, not expanded into workbench this round |
| `--workspace-font-caption` | 12 | Workbench group headings/image metadata,18–20px line height |
| `text-xs` | 14 | Raised to 14px in tailwind.config.js; cannot express12px auxiliary text |
| `text-sm` | 14 | Default body, buttons, setting labels |
| `text-base` | 16 | Section/card/paper headings |
| `text-lg+` | 18+ | Onboarding/empty-state copy only, not normal UI |

Font weights:

| Tailwind | Value | Purpose |
|---|---|---|
| `font-normal` | 400 | Default |
| `font-medium` | 500 | Labels and lightly emphasized secondary information |
| `font-semibold` | 600 | Section/card headings, button text |
| `font-bold` | 700 | Section headers only (10px uppercase tracking-wider) |

Font stack: **one sitewide font**, the system sans-serif stack

```
-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif
```

No web fonts. Each OS uses its system sans-serif (macOS=SF Pro, Windows=Segoe UI, Linux=Cantarell / Noto Sans), without extra typefaces.

**Hard constraints**:

- **No serif**. Tinker uses sans-serif throughout; business UI forbids `font-serif` and `font-family: serif`.
- **No monospace (one exception)**: forbid `font-mono` classNames and `font-family: monospace`; **terminal echo, diffs, line numbers, grep hits, inline code, paths** all use the system sans-serif stack. §3.4 `--code-container-*` may style backgrounds/indentation/line-number strips, but never switch typeface to monospace.
  - **Exception**: Markdown code blocks (`.code-block-wrapper pre.shiki` rendered by `packages/ui/src/code-block/CodeBlock.tsx`) retain a monospace stack:
    ```
    'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace
    ```
     Declare directly via CSS selectors in `apps/electron/src/renderer/styles/components.css`, **not** Tailwind `font-mono` classNames (overridden to sans-serif in `tailwind.config.js` and consistently forbidden). Exception applies only to ``` ``` fenced blocks; inline `` `code` ``, tool-result-renderer containers, etc. remain sans-serif.
- **No italics**: forbid `italic` classNames, `font-style: italic`, and `<em>`. For secondary/light emphasis use §3.2 `text-muted-foreground` or weight changes (`font-medium`), not italics.

Line height and letter spacing:

- Body uses Tailwind default `leading-normal` / `leading-snug`
- Section/main headings use `tracking-tight` (-0.025em)
- Section headers use `tracking-wider` (0.05em)

---

<a id="五间距与栅格"></a>

## V. Spacing and Grid

Tailwind4px grid. Common scale (aligned with `SettingsUIConstants.ts`):

| Tailwind | Pixels | Purpose |
|---|---|---|
| `gap-1` | 4 | Tight icon ↔ label spacing |
| `gap-2 / p-2` | 8 | Compact rows, icon spacing within buttons |
| `gap-3 / py-3` | 12 | Settings row interior (`ROW_CLASS`) |
| `gap-4 / p-4 / px-4` | 16 | Card padding, panel margins |
| `gap-6 / p-6` | 24 | Between sections |
| `gap-8 / mt-8` | 32 | Large top-level section spacing |

**Forbidden**: arbitrary pixel values such as `gap-[5px] / mt-[7px]`; if necessary, use multiples of 4.

---

<a id="六形态圆角-&#45;阴影-&#45;边框"></a>

## VI. Shapes: Corners / Shadows / Borders

<a id="61-圆角"></a>

### 6.1 Corner Radii

| Tailwind | Pixels | Purpose |
|---|---|---|
| `rounded-sm` | 2 | Reserved; no badge use (badges now rounded-md) |
| `rounded` | 4 | Buttons, inputs, small icon buttons |
| `rounded-md` | 6 | Secondary cards, **semantic badges / inline chips (§8.4)** |
| `rounded-lg` | 8 | Main buttons (lg), cards inside dialogs |
| `rounded-xl` | 12 | Top-level settings cards (`CARD_CLASS`), main dialogs, lightweight surfaces (§6.5) |
| `rounded-full` | ∞ | Avatars, status dots, sliders |

<a id="62-阴影卡片-&#45;阴影-&#45;背景不用-border"></a>

### 6.2 Shadows (Cards = Shadow + Background, No Border)

```css
/* utility: .shadow-minimal */
box-shadow:
  0 1px 2px 0 rgb(0 0 0 / 0.03),
  0 1px 3px 0 rgb(0 0 0 / 0.06);
```

Hierarchy:

| Shadow class | Purpose |
|---|---|
| `shadow-minimal` | settings-card default |
| `shadow-sm` | Hover elevation |
| `shadow-[0_8px_24px_rgba(0,0,0,0.10)]` | Lightweight popover/dropdown/select/tooltip surfaces (with §6.5 frosted background) |
| `shadow-2xl` | dialog (with backdrop) |

<a id="63-边框使用规则"></a>

### 6.3 Border Rules

- **Prefer shadows + backgrounds** for section boundaries;
- Use `border` **only for**:
  - Dark-card fallback (`.dark .settings-card → border-border/30`);
  - Inputs / `Select` / `Textarea` (`border-input`);
  - Separators (`border-border/50` or `Separator`);
  - Dashed CTAs (`border-dashed border-[hsl(var(--dashed-border))]`).

<a id="64-settings-card-跨主题差异"></a>

### 6.4 Cross-Theme settings-card Differences

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

Valid fallback under principle2: when card-bg≈window-bg shadows fail, so use thin borders.

<a id="65-轻量浮层dropdown-&#45;popover-&#45;select-&#45;tooltip"></a>

### 6.5 Lightweight Surfaces (Dropdown / Popover / Select / Tooltip)

Global Radix floating surfaces use `components/ui/floating-surface.ts` for `DropdownMenuContent`, `DropdownMenuSubContent`, `PopoverContent`, `SelectContent`, `TooltipContent`.

| Dimension | className | Explanation |
|---|---|---|
| Background | `bg-popover/85 supports-[backdrop-filter]:bg-popover/75` | Lower opacity further with backdrop-filter, letting underlying content show subtly |
| Blur | `backdrop-blur-xl` | Codex-style frosted surface, avoiding solid white blocks covering content |
| Border | `border border-border/60` | Thin outline defines shape without heavy shadows |
| Radius | `rounded-xl` | Unified Dropdown/Popover/Select/Tooltip radius; no business-side downgrade to `rounded-md` / `rounded-lg` |
| Shadow | `shadow-[0_8px_24px_rgba(0,0,0,0.10)]` | Soft diffuse shadow; no `shadow-lg` / `shadow-xl` fallback on lightweight menus |
| Text | `text-popover-foreground` | Floating text uses popover semantic tokens |

Business components may override width/padding/scroll limits via `className` (e.g. `w-64`, `p-1.5`), but never repeat `rounded-*`, `bg-popover/*`, `backdrop-blur-*`, or menu shadows. Nonfrosted semantics require a global primitive update or documented exception first; global Tooltips no longer default to dark high-contrast panels.

---

<a id="七主题切换契约"></a>

## VII. Theme-Switching Contract

- **Mechanism**: body class; `<body class="dark">` selects dark, no class defaults light.
- **No** runtime theme objects / theme atoms / IPC channels. CSS variables are the sole switching surface.
- **Integration**: dark mode should follow OS preference or explicit settings, tracked in [issue #299](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/299) (Wire system-preference-driven `.dark` toggle). Current `apps/electron/main/lib/file-preview-service.ts` uses `nativeTheme.shouldUseDarkColors` for preview iframes only.
- **History**: ocean / forest / slate × light/dark, 6 themes, removed 2026-05 (dead code, never connected).

---

<a id="八组件层级与使用规则"></a>

## VIII. Component Hierarchy and Usage

<a id="81-入口优先级高-&#45;低"></a>

### 8.1 Entry Priority (High → Low)

1. **`components/settings/primitives/*`**: `SettingsCard / SettingsRow / SettingsInput / SettingsSelect / SettingsToggle / SettingsSegmentedControl / SettingsSection / SettingsSectionHeader / SettingsRadioGroup / SettingsLinkRow / SettingsSecretInput / SettingsEmpty`. Assemble all settings content through this layer.
2. **`components/ui/*`** (17 shadcn components): `Button / Dialog / Popover / Select / Input / Switch / Checkbox / Tooltip / DropdownMenu / AlertDialog / Badge（tone×variant，§8.4） / Alert / ScrollArea / Separator / Spinner / LoadingIndicator / Sonner / ImageLightbox`. Shared business layer; Badge uses tone×variant (§8.4).
3. **Business components** (`components/library / components/agent / components/preview / ...`): compose ui + primitives.

<a id="82-常量复用"></a>

### 8.2 Reuse Constants

File: `apps/electron/src/renderer/components/settings/primitives/SettingsUIConstants.ts`

```ts
LABEL_CLASS                 = 'text-sm font-medium text-foreground'
DESCRIPTION_CLASS           = 'text-sm text-muted-foreground'
SECTION_TITLE_CLASS         = 'text-base font-semibold text-foreground tracking-tight'
SECTION_DESCRIPTION_CLASS   = 'text-sm text-muted-foreground mt-1'
CARD_CLASS                  = 'rounded-xl overflow-hidden settings-card'
ROW_CLASS                   = 'flex items-center justify-between px-4 py-3'
DIVIDER_CLASS               = 'border-border/50'
```

Repeated settings-style combinations belong in `SettingsUIConstants`, not per-file rewrites.

<a id="83-实用工具类globalscss-提供"></a>

### 8.3 Utility Classes (Provided by globals.css)

| Class | Purpose |
|---|---|
| `settings-card` | Card background + shadow |
| `shadow-minimal` | Same, shadow only |
| `shell-bg` | Window-shell gap background |
| `mask-fade-y` | List top/bottom fade mask |
| `scrollbar-thin` | Thin scrollbar (replaces browser default) |
| `scrollbar-none` | Hide scrollbar while preserving scrolling |
| `titlebar-drag-region` | Draggable Electron titlebar area |
| `titlebar-no-drag` | Exclude titlebar buttons from dragging |
| `edge-breath` | Edge breathing animation (empty-state guidance) |

> **Scroll-container convention**: every vertical scroller (`overflow-y-auto` / `overflow-auto` / `overflow-y-scroll`) **must** include `scrollbar-thin`; no bare browser scrollbars (macOS hides them, Win/Linux makes them thick, breaking consistency). Use `scrollbar-none` only for intentional hiding (e.g. keyboard-navigated sidebar). Exception: Radix `<ScrollArea>` (`ui/scroll-area.tsx`) is already styled.

<a id="84-标签族badge-&#45;chip语义规范"></a>

### 8.4 Badge / Chip Semantics

Badges have two orthogonal axes × two categories. Entry: `components/ui/badge.tsx`.

**Category1: Semantic Badge**, standalone semantic color blocks. Base `inline-flex items-center rounded-md px-2.5 py-0.5 text-badge font-normal`.

- **tone (semantic color)**: `neutral` (default) / `primary` / `info` / `success` / `warning` / `destructive`
- **variant (form)**: `soft` (default) / `solid` / `outline`

| tone \ variant | soft (default, background /10) | solid | outline |
|---|---|---|---|
| neutral | `bg-muted text-muted-foreground` | `bg-muted text-foreground` | `border-border text-muted-foreground` |
| primary | `bg-primary/10 text-primary` | `bg-primary text-primary-foreground` | `border-primary text-primary` |
| info | `bg-info/10 text-info` | `bg-info text-info-foreground` | `border-info text-info` |
| success | `bg-success/10 text-success` | `bg-success text-success-foreground` | `border-success text-success` |
| warning | `bg-warning/10 text-warning` | `bg-warning text-warning-foreground` | `border-warning text-warning` |
| destructive | `bg-destructive/10 text-destructive` | `bg-destructive text-destructive-foreground` | `border-destructive text-destructive` |

> Soft backgrounds uniformly `/10` (never `/5` / `/15`). For green/yellow/blue semantic badges use only `<Badge tone=...>`, not hand-written `bg-success/15`. `SettingsPill` is merged into this component (replace with `<Badge tone=... variant="soft">`).

**Category2: Inline Chip**, short capsules within body/conversation text (paths, DOI, citations `[N]`, keywords). Source `components/ai-elements/inline-label-style.ts`: `rounded-md bg-muted-foreground/15 text-[14px] text-foreground/85`, **14px matching body** (versus12px semantic badges), plus `INLINE_LABEL_INTERACTIVE_CLASS` when clickable. CitationBadge uses inline styles inside prose (avoids Tailwind JIT misses + prose `!important`), with `hsl(var(...))` semantic variables from the same neutral tokens.

**Valid shape exceptions**: count badges / `+N` (EvidenceSetBadgeStack), status dots (UpdateBadge dot), starter capsule buttons (StarterChips), clickable navigation pills (LeftSidebar Zotero badge) use `rounded-full`; these are nonsemantic-badge exceptions.

**Score gradients are separate from tone**: RelevanceBadge / ScoreBadge use §3.4's5-level relevance gradient, not generic semantics, but align radii/font size (`rounded-md` / `text-badge`).

---

<a id="九反模式清单"></a>

## IX. Antipatterns

> Block any of the following in review.

| Antipattern | Correction |
|---|---|
| `<div className="bg-red-500 text-blue-400">` | Use tokens: `bg-destructive text-primary` |
| `<div className="bg-zinc-900 text-zinc-100">` | Use tokens: `bg-background text-foreground` |
| `<div style={{ color: '#ff0000' }}>` | Use tokens + className |
| `<div className="border border-gray-200">` | Cards use `settings-card`; separators `Separator` |
| `<div className="p-[7px] mt-[13px]">` | Multiples of 4: `p-2 mt-3` |
| `<div className="text-[13px]">` | Use scale: `text-xs` or `text-sm` |
| `<div className="overflow-y-auto">` (bare native scrollbar) | Add `scrollbar-thin` (`scrollbar-none` only for intentional hiding) |
| `<button>delete</button>` | Use `<Button variant="destructive">` |
| Direct settings-page `<div className="rounded-xl border ...">` | Use `<SettingsCard>` |
| Handwritten setting `flex items-center justify-between px-4 py-3` | Use `<SettingsRow>` or `ROW_CLASS` |
| `import { useTranslation } from 'react-i18next'` | Replace with `import { useT } from '@/hooks/useT'` ([CLAUDE.md §7.4](../CLAUDE.md)) |
| `<span className="italic">` / `<em>` / `font-style: italic` | No italics; use `text-muted-foreground` or `font-medium` for light emphasis (§4) |
| `<pre className="font-mono">` / `font-family: monospace` / Tailwind `font-mono` | No monospace; terminal/diff/line numbers/inline code/paths use system sans-serif. **Exception**: Markdown CodeBlock (§4) declares monospace through `.code-block-wrapper pre.shiki`, not classNames |
| `<span className="font-serif">` / `font-family: serif` | No serif; system sans-serif only (§4) |
| Focusable-element focus rings: `focus:ring-2 focus-visible:ring-ring` / `focus:ring-offset-*` / `ring-ring` | Remove: focus rings are globally neutralized (`utilities.css` `@layer utilities` `html :focus-visible { --tw-ring-color: transparent }`, [#525](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/525)). Use bg/border/opacity changes. **Exception**: nonfocus state rings allowed (selected `ring-1 ring-primary`, drag highlight `ring-2 ring-info`, decorative rings); these indicate state, not focus |
| Handwritten `bg-success/15` / `bg-info/15` semantic badges | Use `<Badge tone=... variant="soft">`, uniform `/10` |
| `<Badge variant="info">` overridden to soft by className | Use `<Badge tone="info" variant="soft">` |
| Hardcoded badge hex (`#fde68a`) | Semantic tokens respond to themes |
| Semantic badges14px / inline chips12px | Semantic `text-badge`(12), inline14px; keep separate |
| Remove `<DevOnly>` / `useIsDevMode()` gates but retain palette hardcoding such as `bg-red-500` | Dev-only palette exemption ends with the gate; use semantic tokens (`bg-destructive`, etc.) and validate light/dark; i18n backfill [`docs/i18n.md`](./i18n.md) §3.8 |

**Exceptions** (require explanatory comments):

- Third-party brand colors (GitHub badges, Twitter blue, Discord purple): line-level `// eslint-disable-next-line` + explanation
- diff / search-hit / ChoiceCard danger levels / `tool-result-renderer` containers use §3.4 dedicated tokens (implemented B-3 / B-4 / #303 / #304 / #309); no palette literals `bg-green-500/10` / `bg-red-500/10` / `bg-yellow-300/30`
- **Theme backfill on dev-gate removal**: dev-only code (`@/lib/dev-mode`) previously allowed hardcoded palettes because users could not reach it. Removing gates to expose production UI immediately voids exemption: replace all Tailwind palette classNames (`bg-red-500` / `text-blue-600`, etc.) with semantic tokens (§II principle3, §III), validate both themes under §VII. i18n is outside this document; corresponding backfill [`docs/i18n.md`](./i18n.md) §3.8

---

<a id="十桌面工作台的比例与细节"></a>

## X. Desktop Workbench Proportions and Details

This supersedes old280px sidebar/50px titlebar/heavy frosted shell values. User-provided Perplexity screenshots inform hierarchy/rhythm/balance only; retain Tinker branding, architecture, system sans-serif. No claim these are Perplexity internal tokens.

<a id="101-测量方法"></a>

### 10.1 Measurement

- All values CSS px. Record physical screenshot pixels, DPR, and app zoom separately; never directly convert high-resolution screenshot dimensions into CSS.
- Same viewport/zoom/language/content state for acceptance; compare homepage to homepage, conversation to conversation.
- Confirm DOM `getBoundingClientRect()`/computed styles before screenshot visual-balance review; classNames alone prove nothing.
- Adjust type/icons/line height/hit areas/space together, not global zoom shrinking rough details.

<a id="102-颜色与表面"></a>

### 10.2 Colors and Surfaces

Dedicated tokens in `styles/tokens.css`. `workspace-home.css` maps them only within workbench/drawer to background/foreground/dividers, without sign-in/global-brand changes.

| Token | Light HSL | Dark HSL | Purpose |
| --- | --- | --- | --- |
| `--workspace-chrome` | `240 8% 93%` | `210 10% 9%` | Shared topbar/sidebar window background |
| `--workspace-surface` | `0 0% 99%` | `210 9% 12%` | Reading panel |
| `--workspace-ink` | `200 22% 20%` | `200 10% 90%` | Primary text/icons |
| `--workspace-muted` | `202 9% 41%` | `210 8% 65%` | Secondary text |
| `--workspace-line` | `210 8% 87%` | `210 8% 25%` | Subtle input/tab dividers |
| `--workspace-hover` | `210 9% 90%` | `210 8% 19%` | Hover |
| `--workspace-selected` | `210 9% 87%` | `210 8% 23%` | Current item |
| `--workspace-composer` | `0 0% 100%` | `210 8% 16%` | Input surface |
| `--workspace-halo` | `210 8% 95%` | `210 8% 14%` | Soft homepage-composer halo |

Window/content backgrounds distinguish the main panel, without prominent outlines/heavy shadows. Inputs retain subtle dividers and clear focus. Brand blue remains only in brand-semantic locations such as Logo.

<a id="103-骨架与几何-token"></a>

### 10.3 Skeleton and Geometry Tokens

| Token/element | Target | Implementation |
| --- | --- | --- |
| `--workspace-sidebar-width` | 256px | Shared by topbar controls/sidebar/drawer; no separate inline248/280px |
| `--workspace-toolbar-height` | 56px | Window buttons 28px, icons16px, gap 4px |
| `--workspace-panel-radius` | 24px | Main content only, right/bottom margin8px |
| `--workspace-content-width` | 680px | Shared maximum homepage/conversation input width |
| `--workspace-composer-radius` | 20px | Input only; home halo adds10px, outer radius 30px |
| Current tab | Height 34px, width 120–240px | Topbar flexes into remaining space, ellipsizes titles without displacing menus |
| Narrow window | ≤1100px | Existing overlay drawer, never squeeze sidebar into narrow text columns |

Nonfullscreen macOS reserves108px origin for traffic lights; fullscreen/other platforms16px. Collapsed sidebar width 0, top toggle remains usable. Right-panel ratios/Splitter/restoration retain existing atoms, unaffected by visual changes.

<a id="104-侧栏的文字几何与交互figma-1155992026-11-08"></a>

### 10.4 Sidebar Typography, Geometry, and Interaction (Figma 115:599, 2026-11-08)

Visual basis: sidebar 115:645 in the user-adjusted [conversation frame 115:599](https://www.figma.com/design/qNZ4GSgKdkHK51a5x79VF8/Tinker?node-id=115-599). [Figma Design Guide 119:187](https://www.figma.com/design/qNZ4GSgKdkHK51a5x79VF8/Tinker?node-id=119-187) contains editable light/dark specimens, dimensions, and states. Original frame retained. tokens.css remains implementation value source.

| Element | Font / line height | Geometry and spacing |
| --- | --- | --- |
| Primary navigation | 14 /22px, Medium | Height 36px, row gap 2px |
| Project name | 14 /22px, Medium | Height 30px, row gap 2px, radius 8px |
| Project child sessions, Recent | 14 /22px, Regular | Height 30px, Recent gap 3px, radius 6px |
| Group heading | 12 /18px, Medium | Heading/list gap 6px, groups 12px |
| Bottom account | 14 /22px, Medium | 224×40px, left16px, bottom20px, avatar32px |

- Sidebar256px, content232px, horizontal margins12px each; row horizontal padding 6px.
- Icon box14px, icon/text gap 6px. Window x-coordinate38px for icon text,18px Recent,60px account. Source SVG intrinsic sizes unchanged; small plus centered in box.
- Toolbar56px, navigation starts y=56px. macOS window keeps108px traffic-light safe space; drawing coordinates must not cover system controls.
- Project folders expand/collapse independently. Right plus appears on hover/keyboard focus, reuses session creation with explicit project ID and opens a new draft. Block repeated clicks while waiting.
- Recent shows titles only by default; focused rows reveal rename/archive/delete, Enter/Space opens session. Internal editors/buttons do not retrigger row navigation.
- Selection uses one subtle background. If current project session already highlighted, Recent does not duplicate it. Long names ellipsize on one line; focus rings/right actions remain accessible.
- Use local SVGs exported from this Figma, no temporary URLs. Mirror back graphic externally for correct direction; forward disabled from actual history. Dark inversion preserves compound-graphic tonal differences.

Sidebar colors are scoped to navigation, never override chat text:

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

Geometry tokens use workspace-sidebar namespace, px units:

| Suffix | Value | Suffix | Value |
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

<a id="105-首页与输入框"></a>

### 10.5 Homepage and Composer

- Home symbol40px, heading gap 22px. Heading 36/44px, weight400, tracking-0.035em; narrow28/36px. System sans-serif retained, no mismatched serif imitation.
- Home composer32px after heading; editor min 72px, text 15/24px, padding top16px/horizontal20px. Bottom bar min 40px, buttons 30px, icons16px/stroke 1.5.
- Conversation editor min 48px, text 14/22px, padding 14px18px6px. Body/composer share680px axis, preventing attachment/button/text drift.
- Home/conversation attachment/send/stop hit areas30px; Plus/send icons16px/stroke 1.5, stop small solid square. Mode toggle height 28px, selection sizes naturally to label; Chinese “General Agent” uncut, disabled/locked states retained. Model names may ellipsize, never squeeze Send.
- Actual drag/channel/model availability drives states: Apply disabled styles after default and focus styles. Drag styling overrides both focus and disabled appearance with an info border, light background, and halo. Disabled configuration CTA remains clickable; do not disable pointer events for whole surface.
- Coding suggestions follow composer; Tab order matches visual order. Suggestions fill drafts only, never send.
- Handle short height and narrow width separately, never push home content to screen bottom. Caret/focus ring/hints/disabled states remain distinct.

<a id="106-图片结果"></a>

### 10.6 Image Results

Images first, edit/compare/save second, version/model third. Max image height 520px, width within content, preview radius 12px; buttons 30px, text 12/18px, icons16px, gap 8px.

Version chain/channel/model/reference count/size limits go in keyboard-expandable native `details/summary`. Entry explicitly mentions costs; retain original billing/size copy, never remove for simplicity. Read actual dimensions only after image loads. Missing files/parent versions stay visible outside collapsed details. Long filenames/model names wrap or ellipsize without breaking reading width.

<a id="107-单一实现与验收"></a>

### 10.7 Single Implementation and Acceptance

- Define colors/geometry only in `tokens.css`; components/styles read same-name variables.
- Organize `workspace-home.css` by window/navigation/home/input/projects/narrow windows; never repeatedly append same-selector overrides.
- Shared controls use existing React/Radix/Lucide, no appearance-only dependencies. New copy en/zh together.
- Check at least light/dark, home/conversation, long titles, narrow windows, sidebar expansion/collapse, input focus, errors/missing images, reduced motion.
- Screenshots identify actual app versus component preview; preview does not prove installer updated.

---

<a id="十一与其他文档的关系"></a>

## XI. Relationships with Other Documents

| Document | Relationship |
|---|---|
| [`CLAUDE.md §2`](../CLAUDE.md) | CLAUDE's “UI” line summarizes design.md; this document expands it |
| [`docs/adr/ADR-003`](./adr/ADR-003-ui-design-system-layering.md) | Layering decision record; this is its specification-layer output |
| [`apps/electron/tailwind.config.js`](../apps/electron/tailwind.config.js) | `theme.extend.colors` must correspond one-to-one with §3 |
| [`apps/electron/src/renderer/styles/tokens.css`](../apps/electron/src/renderer/styles/tokens.css) | **Token value source of truth**; §3 / §3.4 / §3.5 tables must match `:root` / `.dark` (split B-2 / #303) |
| [`apps/electron/src/renderer/styles/base.css`](../apps/electron/src/renderer/styles/base.css) | `@layer base` global element styles (body / scrollbar / `*`) |
| [`apps/electron/src/renderer/styles/components.css`](../apps/electron/src/renderer/styles/components.css) | `@layer components`: component hooks such as `.settings-card` / `.code-block-wrapper` |
| [`apps/electron/src/renderer/styles/utilities.css`](../apps/electron/src/renderer/styles/utilities.css) | `@layer utilities`: source of all §8.3 utilities (`.shell-bg` / `.mask-fade-y` / `.scrollbar-*` / `.titlebar-drag-region` / `.shadow-minimal` / animation keyframes) |
| [`apps/electron/src/renderer/styles/theme-overrides.css`](../apps/electron/src/renderer/styles/theme-overrides.css) | `.dark` overrides for `.session-item-selected` / `.mode-slider` / `.tabbar-bg` / `.scroll-progress-thumb` / tiptap pre |
| [`apps/electron/src/renderer/styles/globals.css`](../apps/electron/src/renderer/styles/globals.css) | **Injection layer**: `@import` connects 5 files + `@tailwind base/components/utilities` (no values; token changes do not belong here) |
| [`apps/electron/postcss.config.js`](../apps/electron/postcss.config.js) | First PostCSS plugin `postcss-import` (added B-2; otherwise `@import` ordering fails) |
| [`apps/electron/src/renderer/components/settings/primitives/SettingsUIConstants.ts`](../apps/electron/src/renderer/components/settings/primitives/SettingsUIConstants.ts) | Compound className source of truth |

---

<a id="十二变更流程"></a>

## XII. Change Process

| Change type | Process |
|---|---|
| **Add token** | 1) Update `tokens.css` `:root` + `.dark` → 2) `tailwind.config.js` extend → 3) corresponding table here → 4) PR |
| **Adjust value** | 1) `tokens.css` → 2) corresponding table here → 3) PR with before/after theme screenshots |
| **Add component utility** | 1) `components.css` `@layer components` or `utilities.css` `@layer utilities` by layer → 2) §8.3 table → 3) PR |
| **Change rules / antipatterns** | 1) PR + brief rationale → 2) description identifies affected existing code that violates new rules |
| **Delete token / utility** | Search first to confirm zero references, then delete |

---

<a id="十三当前已知偏差与后续工作"></a>

## XIII. Known Deviations and Follow-Up

| Item | Description | Tracking |
|---|---|---|
| Remaining business palette hardcoding | B-3 / B-4 (#304 / #310) migrated tool-result-renderers + settings/forms (~51 sites); ~74 remain in `AgentMessages` / `GraphPipeline` / `TabBarItem` / `InlinePreview` / `UpdateBadge` / `ContextUsageBadge` / `AgentSessionItem`, etc. (badge hex/opacity consolidated by §8.4: tone×variant, SettingsPill merged, CitationBadge tokens, soft /10) | B-5 / [#295](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/295) |
| ESLint palette rule not live | Cannot automatically block hardcoding; after B-3/4/5 merge | B-6 / [#296](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/296) |
| Theme validation | Settings wired through `GeneralSettings`, `themeAtom/updateTheme`; workbench tokens still need both-theme checks after every visual change | §10.7 |
| design.md ↔ tokens.css drift detection | No automated guard: §3.2–§3.5 tables must align1:1 with `tokens.css :root` / `.dark`, currently manual review | B-8 / [#298](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/298) `token-parity.test.ts` |

---

_Update this document with every token/rule change. Drift is a defect._


<a id="对话流与引用图片figma-115604"></a>

### Conversation Flow and Referenced Images (Figma 115:604)

tokens.css remains value source. Uploaded attachments sit outside user bubbles; historical references bind definite image IDs/source SDK UUIDs. Desktop quote-card padding/gap 12, thumbnails 72×48, bubble padding 16/radius 14; source copy may wrap in narrow windows.

| token | Light/geometry | Dark |
|---|---|---|
| `--conversation-content-width` | 832px | Same |
| `--conversation-user-width` | 480px | Same |
| `--conversation-upload-width` | 112px | Same |
| `--conversation-upload-height` | 148px | Same |
| `--conversation-turn-gap` | 40px | Same |
| `--conversation-top-inset` | 64px | Same |
| `--conversation-composer-height` | 125px | Same |
| `--conversation-model-width` | 90px | Same |
| `--conversation-reasoning-width` | 108px | Same |
| `--conversation-message-surface` | #F4F5F6 | 210 8% 18% |
| `--conversation-quote-surface` | #FBFBFC | 210 8% 22% |
| `--conversation-body` | #252B30 | 200 10% 90% |
| `--conversation-secondary` | #727C80 | 210 8% 65% |
| `--conversation-quote-title` | #39444B | 200 10% 88% |
| `--conversation-quote-source` | #78848D | 210 8% 70% |
| `--conversation-composer-line` | #D9DDDF | 210 8% 28% |

Source navigation preserves reading anchors, stops auto-bottom scrolling, briefly highlights, and provides stack-based return. Missing old UUIDs recover only with definite unique image binding; missing/ambiguous sources are unclickable. Both themes retain full image previews; reduced motion scrolls instantly.

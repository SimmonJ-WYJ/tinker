<a id="应用-ui-字号-14px-下限-specminimum-font-size-14px"></a>

# Application UI Minimum Font Size 14px Spec

> **Status**: draft · awaiting review
> **Related issue**: (to be added)
> **Related PR**: (to be added)
> **Domain language source of truth**: this spec itself (no new terminology)

---

<a id="1-目标与边界"></a>

## 1. Goals and Boundaries

<a id="11-目标"></a>

### 1.1 Goal

Ordinary visible text in the application's own UI (menus / toolbars / body chrome, etc.) has a minimum font size of **14px**.
The rule **only raises the floor (clamps)**: ordinary text `<14px → 14px`; `≥14px` stays unchanged.
Tags / badges / chips uniformly use the semantic class `text-badge` at **12px**; scattered arbitrary `text-[12px]` values are prohibited. File-path chips, DOI chips, and ordinary inline-code labels in conversation Markdown share this exception and reuse `INLINE_LABEL_CLASS` for consistent gray background, padding, and line height; never use `leading-none`, to avoid clipping English descenders.

<a id="12-范围内in-scope"></a>

### 1.2 In Scope

- Tailwind font-size utilities in React components (`text-xs`, `text-[10–13px]`, etc.).
- Component inline `style={{ fontSize: <14 }}` (only 2 existing instances).
- Raw `font-size` in application stylesheets (`src/renderer/styles/`); checked: none currently <14px, so retain the guard.

<a id="13-范围外out-of-scope明确不动"></a>

### 1.3 Out of Scope (Explicitly Unchanged)

- Code blocks / terminal output (Shiki inline styles, CodeBlock).
- Markdown / review body text (`prose` typography sizes from `@tailwindcss/typography`).
- Generated preview HTML content (iframe `srcDoc`, injected HTML templates).

> **Why the boundary is clean**: rendered content uses iframe `srcDoc` / `prose` CSS / Shiki inline styles, none of which **read** Tailwind `text-*` utilities. Clamping utilities therefore affects only app UI chrome, without enlarging code/body/preview content. `text-xs` in preview renderer files belongs to their **chrome** (filename labels, toolbars, empty/error states) and should be clamped; actual content is unaffected.

---

<a id="2-现状"></a>

## 2. Current State

- Tailwind v3; `tailwind.config.js` has no `fontSize` overrides → default `text-xs`=12px (**violation**), `text-sm`=14px (compliant), `text-base`=16px.
- About **105** files use `text-xs`; about **112** use explicit `text-[10–13px]`.
- Existing custom ESLint guard infrastructure: `eslint-rules/no-tailwind-palette.js` + `eslint.config.js` (`asci/*` rule prefix); extend this pattern for the new rule.

---

<a id="3-方案三件套单-pr-一次交付"></a>

## 3. Approach (Three Parts, Delivered in One PR)

<a id="31-tailwind-配置钳制"></a>

### 3.1 Clamp in Tailwind Configuration

Override `xs` in `theme.extend.fontSize` in `tailwind.config.js`:

```js
fontSize: {
  // 14px 下限钳制：text-xs 由 12px 抬到 14px（与 text-sm 同尺寸，层级靠字重/颜色区分）
  xs: ['0.875rem', { lineHeight: '1.25rem' }],
  // badge/chip/tag 专用语义字号：12px
  badge: ['0.75rem', { lineHeight: '1rem' }],
}
```

One change covers all `text-xs` uses. `text-badge` is the only small-font exception for tags / badges / chips; other type sizes stay unchanged.
The `tailwind-merge` configuration in `cn()` must recognize `text-badge` as `font-size`; otherwise color classes such as `text-primary` / `text-success` incorrectly remove it.

<a id="32-存量清扫arbitrary-值"></a>

### 3.2 Clean Up Existing Arbitrary Values

Configuration cannot control explicit arbitrary values. Replace `text-[Npx]` (`N < 14`, including `8/9/10/10.5/11/11.5/12/13/13.5px`) in about **112** files with `text-sm` (14px).
Keep `text-[0.875em]` (relative em, not absolute px; inline-code badges) and `≥14px` (`text-[14px]/[15px]/[26px]`) unchanged.
**Exclude actual content** during cleanup: <14px on code/diagram/body containers in CodeBlock / MermaidBlock / preview renderers is out-of-scope rendered content—pin the original values and add line-level `eslint-disable` comments; <14px chrome (toolbars / filenames / empty/error states) in these files still clamps to 14px.

> **`text-xs` is outside cleanup scope**: §3.1's configuration clamp already renders `text-xs` at 14px (compliant); about 105 `text-xs` files **stay unchanged**, centrally covered by one configuration control to avoid meaningless churn.

<a id="33-eslint-守门防回潮"></a>

### 3.3 ESLint Guard (Prevent Regression)

Add `eslint-rules/min-font-size.js` (following `no-tailwind-palette.js` string/template scanning), matching only **arbitrary `text-[Npx]` with `N < 14`** (including decimals such as `text-[10.5px]`).
**Do not match** `text-xs` (already clamped to compliant 14px), `text-badge` (semantic-label exception), relative `text-[Nem/Nrem]`, or `≥14px`.
Register as `asci/min-font-size` (error) in `eslint.config.js`. Exemptions use line-level
`// eslint-disable-next-line asci/min-font-size -- <理由（渲染内容/代码块）>` (the placeholder means reason: rendered content/code block).

<a id="34-小尾巴"></a>

### 3.4 Remaining Details

Fix inline `style={{ fontSize: <14 }}` in components (2 instances) → 14.

---

<a id="4-影响与流程"></a>

## 4. Impact and Process

- **Affected package**: `apps/electron` (version automatically bumped by the pre-commit hook; no manual change needed).
- **i18n**: no new user-facing copy.
- **Reduced hierarchy** (confirmed acceptable with the user): ordinary UI `text-xs` and `text-sm` both become 14px; weight/color convey hierarchy; tags / badges / chips use `text-badge` to retain 12px.
- **Target branch**: global UI enforcement (not a mock-data redesign); confirm the target branch (UI-main vs alex/main) with the user before opening a PR; do not push/merge independently.

---

<a id="5-验收done-when"></a>

## 5. Acceptance (Done When)

1. `tailwind.config.js` renders `text-xs` at 14px and `text-badge` at 12px.
2. `cn('text-badge text-success')` retains both font-size and color classes.
3. No arbitrary `text-[<14px]` remains in in-scope repository files; rendered-content exceptions all include eslint-disable explanations.
4. `asci/min-font-size` reports arbitrary `text-[<14px]` (without false positives on `text-xs` / em / ≥14px); `bun run lint` is fully green.
5. `bun run typecheck` passes.
6. Spot-check pages with `bun run dev` (including dense tags/badges, such as library / agent tool results); visually confirm no app text <14px, while code blocks/Markdown bodies/preview HTML sizes remain unchanged.

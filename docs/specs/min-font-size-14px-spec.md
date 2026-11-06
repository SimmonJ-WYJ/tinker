# 应用 UI 字号 14px 下限 Spec（Minimum Font Size 14px）

> **状态**：草稿 · 待 review
> **关联 issue**：（待补）
> **关联 PR**：（待补）
> **领域语言事实源**：本 spec 自身（无新增术语）

---

## 1. 目标与边界

### 1.1 目标

应用自身 UI 的普通可见文字（菜单 / 工具栏 / 正文 chrome 等）最小字号 **14px**。
规则为**只抬地板（钳制）**：普通文字 `<14px → 14px`，`≥14px` 保持不动。
标签 / 徽章 / chip 统一走语义类 `text-badge`，字号为 **12px**，不允许散落 arbitrary `text-[12px]`。对话流 Markdown 中的文件路径 chip、DOI chip、普通 inline code 标签也归入这一例外，并复用 `INLINE_LABEL_CLASS` 保持统一灰底、内边距与行高；行高不得用 `leading-none`，避免英文 descender 被裁切。

### 1.2 范围内（In scope）

- React 组件里的 Tailwind 字号工具类（`text-xs`、`text-[10–13px]` 等）。
- 组件内 inline `style={{ fontSize: <14 }}`（现存仅 2 处）。
- 应用自身 stylesheets（`src/renderer/styles/`）里的 raw `font-size`（已核：当前无 <14px，保持守门即可）。

### 1.3 范围外（Out of scope，明确不动）

- 代码块 / 终端输出（Shiki 内联样式、CodeBlock）。
- markdown / 综述正文（`@tailwindcss/typography` 的 `prose` 排版字号）。
- 生成的预览 HTML 内容（iframe `srcDoc`、注入 HTML 模板）。

> **边界为何干净**：渲染内容走 iframe `srcDoc` / `prose` CSS / Shiki 内联样式，均**不读** Tailwind `text-*` 工具类。因此钳制工具类只影响应用 UI chrome，不会放大代码/正文/预览本体。preview renderer 文件里的 `text-xs` 属于其 **chrome**（文件名标签、工具栏、空/错态），应被钳制；其内容本体不受影响。

---

## 2. 现状

- Tailwind v3，`tailwind.config.js` 无 `fontSize` 覆盖 → 默认 `text-xs`=12px（**违规**）、`text-sm`=14px（达标）、`text-base`=16px。
- 约 **105** 文件使用 `text-xs`；约 **112** 文件使用显式 `text-[10–13px]`。
- 仓库已有自定义 ESLint 守门基建：`eslint-rules/no-tailwind-palette.js` + `eslint.config.js`（`asci/*` 规则前缀），新规则照此模式扩展。

---

## 3. 方案（三件套，单 PR 一次交付）

### 3.1 Tailwind 配置钳制

`tailwind.config.js` 的 `theme.extend.fontSize` 覆盖 `xs`：

```js
fontSize: {
  // 14px 下限钳制：text-xs 由 12px 抬到 14px（与 text-sm 同尺寸，层级靠字重/颜色区分）
  xs: ['0.875rem', { lineHeight: '1.25rem' }],
  // badge/chip/tag 专用语义字号：12px
  badge: ['0.75rem', { lineHeight: '1rem' }],
}
```

一处改动覆盖全部 `text-xs` 用法。`text-badge` 是标签 / 徽章 / chip 的唯一小字号例外，其余字阶不变。
`cn()` 的 `tailwind-merge` 配置必须把 `text-badge` 识别为 `font-size`，否则它会被 `text-primary` / `text-success` 等颜色类误删。

### 3.2 存量清扫（arbitrary 值）

配置管不到显式 arbitrary 值。把约 **112** 文件里的 `text-[Npx]`（`N < 14`，含 `8/9/10/10.5/11/11.5/12/13/13.5px`）统一改为 `text-sm`（14px）。
`text-[0.875em]`（相对 em，非绝对 px，inline-code 徽章）与 `≥14px`（`text-[14px]/[15px]/[26px]`）不动。
清扫时**排除内容本体**：CodeBlock / MermaidBlock / preview renderers 里写给代码/图/正文容器的 <14px 属于范围外渲染内容 —— pin 住原值并加行级 `eslint-disable` 注释；这些文件里属于 chrome（工具栏 / 文件名 / 空错态）的 <14px 仍要钳到 14px。

> **`text-xs` 不在清扫范围**：§3.1 的配置钳制已使 `text-xs` 渲染为 14px（compliant），约 105 个 `text-xs` 文件**保持不动**，由配置单一旋钮统一兜底，避免无意义 churn。

### 3.3 ESLint 守门（防回潮）

新增 `eslint-rules/min-font-size.js`（仿 `no-tailwind-palette.js` 的字符串/模板扫描策略），仅命中 **arbitrary `text-[Npx]` 且 `N < 14`**（含小数，如 `text-[10.5px]`）。
**不命中** `text-xs`（已被配置钳为 14px，compliant）、`text-badge`（语义化标签例外）、相对单位 `text-[Nem/Nrem]`、`≥14px`。
在 `eslint.config.js` 注册为 `asci/min-font-size`（error）。豁免：行级
`// eslint-disable-next-line asci/min-font-size -- <理由（渲染内容/代码块）>`。

### 3.4 小尾巴

修复组件内 inline `style={{ fontSize: <14 }}`（2 处）→ 14。

---

## 4. 影响与流程

- **影响包**：`apps/electron`（版本由 pre-commit 钩子自动 bump，无需手动）。
- **i18n**：不涉及新增面向用户文案。
- **层级弱化**（已与用户确认接受）：普通 UI 中 `text-xs` 与 `text-sm` 同为 14px，主次改由字重 / 颜色承担；标签 / 徽章 / chip 改用 `text-badge` 保持 12px。
- **目标分支**：全局 UI 强制（非 mock 数据重设计）；开 PR 前与用户确认目标分支（UI-main vs alex/main），不擅自 push/合并。

---

## 5. 验收（Done When）

1. `tailwind.config.js` `text-xs` 实际渲染为 14px，`text-badge` 实际渲染为 12px。
2. `cn('text-badge text-success')` 同时保留字号与颜色类。
3. 全仓范围内文件的 arbitrary `text-[<14px]` 清零，渲染内容例外项均带 eslint-disable 说明。
4. `asci/min-font-size` 规则生效：对 arbitrary `text-[<14px]` 报错（不误报 `text-xs` / em / ≥14px）；`bun run lint` 全绿。
5. `bun run typecheck` 通过。
6. `bun run dev` 抽查若干页面（含含标签/徽章的密集区，如 library / agent 工具结果），目测无 <14px 应用文字；代码块/markdown 正文/预览 HTML 字号不变。

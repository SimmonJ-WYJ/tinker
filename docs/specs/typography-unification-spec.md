# 全站字体收敛 Spec（Typography Unification）

> **状态**：草稿 · 待 review
> **关联 issue**：（无）
> **关联 PR**：#470
> **关联文档**：[`docs/design.md §4 / §九`](../design.md)（字体规则真相源；本 spec 是其实施层）
> **领域语言事实源**：`docs/design.md` 字体硬约束三条——禁衬线 · 禁等宽 · 禁斜体

---

## 1. 背景与目标

### 1.1 现状
- `docs/design.md` §4 已落地"全站统一无衬线"字体规则（commit `6ab84640`），同时 §九 反模式表添加了 `font-mono` / `italic` / `font-serif` 三条拦截条目
- 实际 renderer 代码仍有大量违规：80 处 `font-mono` className（33 文件）、11 处 `italic` className（9 文件，已排除 `lib/citation-references.ts` 4 处 markdown 解析非 UI 引用，并跳过 untracked 文件 `SessionPapersStatsBar.tsx:125` 的 1 处——见 §2.2）、1 处 CSS 显式 monospace 栈（`components.css:18`）

### 1.2 目标
- 把 renderer 内所有违规清零，使运行时 UI 真正只用一种字体（系统无衬线栈）
- 在 Tailwind config 层加防御性兜底，让未来手滑写的 `font-mono` / `font-serif` 也渲染成无衬线（视觉静默）
- 不引入 web font；不改动主进程预览 iframe、default-skills 模板、测试夹具中的字体声明

### 1.3 非目标
- 不在本 PR 引入 ESLint 拦截规则（参照 design.md §十三对 palette 规则的处理：先迁完存量再上 lint，避免规则与存量同时落带来的滚雪球冲突）
- 不调整 `tokens.css` 任何颜色 token
- 不动主进程 `file-preview-service.ts`（plaintext / csv 预览 iframe 内部样式）
- 不动 `default-skills/*` 内的 HTML 模板（skill 产物本身的排版策略由 skill 自决，不归 ASCI UI 规范管）

---

## 2. 范围

### 2.1 In-scope（必动）
| 路径 | 类别 |
|---|---|
| `apps/electron/src/renderer/**/*.{tsx,ts,css}` | 全部 className + CSS 字体声明清算 |
| `apps/electron/tailwind.config.js` | 防御性 fontFamily 覆盖 |
| `apps/electron/src/renderer/styles/components.css` | `.code-block-wrapper pre.shiki` 字体声明 |
| `apps/electron/package.json` | patch +1 |

### 2.2 Out-of-scope（不动）
| 路径 | 不动原因 |
|---|---|
| `apps/electron/src/main/lib/file-preview-service.ts` | 主进程为预览 iframe 注入的 inline CSS，属于"应用嵌入的内容渲染层"而非 React UI 体系，单独 PR 处理可选 |
| `apps/electron/default-skills/**/*.html` | Skill 产物自治，含 'Lora' / 'Poppins' / 'SF Mono' 等是 skill 设计选择 |
| `apps/electron/resources/ocr-mcp/*.test.ts` | 测试夹具中拼接 SVG 的 font-family，属于 fixture 不影响生产 UI |
| `apps/electron/src/renderer/lib/citation-references.ts` | 代码内 `italic` 是 markdown 解析变量名 + 正则字面量 + 注释，非 UI className |
| `apps/electron/src/renderer/components/agent/SessionPapersStatsBar.tsx` | 当前为 untracked 文件（属其它未完工作）；其 `italic` 违规由该文件后续 PR 一并处理，本 PR 不触碰 |

---

## 3. 变更清单

### 3.1 CSS（1 处）
**`apps/electron/src/renderer/styles/components.css:18`**
```diff
- font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
```
该行直接删除。`pre.shiki code` 同块原本 `font-family: inherit` 保留——后者直接从 body 继承统一 sans 栈。

### 3.2 Tailwind config（1 处防御兜底）
**`apps/electron/tailwind.config.js`** 在 `theme.extend` 内新增：
```js
fontFamily: {
  sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
  serif: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
  mono: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
}
```
三键全部指向同一栈：未来即使写出 `font-mono` 或 `font-serif`，渲染依然是 sans，视觉静默。

### 3.3 className 删除（92 处）

#### 3.3.1 `font-mono` × 80（33 文件）
按分布：
- `components/agent/tool-result-renderers/*` — 9 文件（bash / edit / grep / read / write 的结果展示）
- `components/settings/*` — 5 文件（API key / channel / 路径展示）
- `components/preview/renderers/*` — 5 文件（文件预览各类渲染器）
- `components/library/*` — 3 文件
- `components/agent/choice/*` — 3 文件
- `components/library/evidence-set-detail/*` — 2 文件
- `components/agent/*` — 2 文件
- `components/{config,app-shell,ai-elements,agent/permission}/*` — 各 1 文件

操作：每处 className 串中将 `font-mono` 删除（连同前/后多余空格），不替换。

#### 3.3.2 `italic` × 11（9 文件，已排除 untracked 的 SessionPapersStatsBar）
按用途：

| 模式 | 文件 | 现 className 形态 | 删后保留 |
|---|---|---|---|
| 引用块 `<blockquote>` ×7 | `EvidenceTraceCard` / `EvidenceCard` / `AddNoteDialog` / `AddReviewNoteDialog` / `PaperNotesPanel` / `NoteDetailDialog`(×2) | `border-l-2 ... italic text-foreground/8x` | `border-l-2` + `text-foreground/8x` 已承担"引用"语义 |
| 空态占位 ×4 | `SDKMessageRenderer` / `SetNotesTab` / `MemberPapersNotesTab`(×2) | `text-xs italic text-muted-foreground/60` | `text-xs` + `text-muted-foreground/60` 已承担"次要"语义 |

操作：每处删 `italic`，不补任何替代 className。每一处删后视觉变化都由保留的 token 充分覆盖。

### 3.4 版本号
`apps/electron/package.json` patch +1（清算后实际数值看落地时基线）。

---

## 4. PR 与分支策略

- 分支：`refactor/typography-unification`，基于 local `main` HEAD（已含 design.md commit `6ab84640`）
- 单 PR → `main`，title：`refactor(typography): 全站字体收敛——单一无衬线栈 + 删除 font-mono / italic`
- Squash merge（PR 内若干 commit 合成 1 笔）
- PR description 中必须包含本 spec 链接（`docs/specs/typography-unification-spec.md`）

---

## 5. 验证

### 5.1 强制
- `bun run typecheck` — 0 errors
- `bun test` — 全部通过；key-parity / ChannelSettings 等 i18n 守门测试不破

### 5.2 手动 smoke（`bun run dev`）
关键面必须走过：

| 面 | 内容 | 关键观察 |
|---|---|---|
| 聊天 Shiki 代码块 | Agent 输出三反引号 | 字体改为 sans，缩进保留，无字号塌缩 |
| tool-result-renderers | bash/edit/grep/read/write 各拉一遍 | diff `+/-` 仍清晰；行号可读 |
| 设置 → 渠道 | 渠道行 / API key 展示 | 路径 / Key redact 串可读 |
| 文件预览（renderer 内） | 各 renderer 类型 | 文本不破版 |
| ChoiceCard | choice 卡片各危险等级 | 文字依然清楚 |

### 5.3 我无法自验的部分
33 个组件里有相当部分在边缘路径（如某些 tool-result-renderer 仅特定 IPC 触发显示），无法逐一进入。剩余面会在 PR description 列「未走过」清单交回 reviewer/用户。

---

## 6. 已知视觉后果（用户已 accept）

| 项 | 变化 | 功能影响 |
|---|---|---|
| 代码块字符宽度 | 由等宽变可变宽 | 缩进可见，列对齐松散 |
| diff `+/-` 排版 | 标记仍清晰，代码列不对齐 | 加/删行识别不受影响 |
| grep 命中 | 行号 / 列号 / 命中片段三段不对齐 | 文本搜索结果仍可读 |
| bash 回显（ls / table 类） | 列对齐变形 | 文字内容完整 |
| inline code（反引号文本） | 视觉密度变化 | 可读性不变 |

无功能性 breakage —— 只影响视觉密度与列对齐。

---

## 7. Done-when

- [ ] `bun run typecheck` 通过
- [ ] `bun test` 通过（>= 1870 pass）
- [ ] `font-mono` className 在 renderer 内 grep = 0
- [ ] `italic` className 在 renderer JSX 内 grep = 0（`lib/citation-references.ts` 4 处保留；untracked `SessionPapersStatsBar.tsx` 1 处见 §2.2）
- [ ] `components.css` 内不再含 `'Fira Code'` / `'Cascadia Code'` / `'JetBrains Mono'` / `monospace`
- [ ] `tailwind.config.js` `fontFamily.{sans,serif,mono}` 三键就位
- [ ] `apps/electron/package.json` patch +1
- [ ] §5.2 关键面已 dev smoke
- [ ] PR description 列出未自验的面，由 reviewer 决定是否阻断
- [ ] PR 链接回填 spec status 行

---

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 某处 `font-mono` 是排版前提（如 ASCII 艺术 / pre-formatted 表格） | smoke 阶段挂在 §5.2 关键面观察；如发现真的破版，单独 token 化处理（不放回 `font-mono`） |
| 删除 `italic` 让某个 blockquote 失去与正文的区分 | §3.3.2 表格已逐处确认保留 token 充分承担语义；若 review 时仍觉弱，再补 `text-foreground/65` 之类轻调 |
| `tokens.css` / `theme-overrides.css` 中暗含 monospace 引用未被本 spec 覆盖 | spec 写完后由 reviewer grep 全仓 `monospace|Fira|Cascadia|JetBrains|Consolas` 兜底 |

---

## 9. 实施计划（Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip all `font-mono` / `italic` className from `apps/electron/src/renderer`, remove the explicit monospace stack in `components.css`, and add a defensive Tailwind `fontFamily` override — so ASCI's runtime UI renders with a single sans-serif font family in every surface.

**Architecture:** 9 个 task，按"防御层 → 6 个域的 `font-mono` 清算 → italic 清算 → 验证 / 发布"线性推进。每个域一个 commit，方便 reviewer 按域定位变化；最后 squash merge 进 main。

**Tech Stack:** Tailwind 3 / React 18 / TypeScript / Bun test。

---

### Task 1: 防御层（Tailwind + components.css）

**Files:**
- Modify: `apps/electron/tailwind.config.js:104` 之后插入 `fontFamily` 块
- Modify: `apps/electron/src/renderer/styles/components.css:18` 删 1 行

- [ ] **Step 1: grep 当前 monospace 残留（locking baseline）**

```bash
grep -n "Fira Code\|Cascadia\|JetBrains\|Consolas\|monospace" apps/electron/src/renderer/styles/components.css
```
Expected output:
```
18:    font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
```

- [ ] **Step 2: 删 components.css 第 18 行**

Use Edit tool on `apps/electron/src/renderer/styles/components.css`:
```diff
   .code-block-wrapper pre.shiki {
-    font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
     background-color: hsl(var(--code-bg)) !important;
   }
```

- [ ] **Step 3: 验证 components.css 已无 monospace 残留**

```bash
grep -n "Fira Code\|Cascadia\|JetBrains\|Consolas\|monospace" apps/electron/src/renderer/styles/components.css
```
Expected output: (empty)

- [ ] **Step 4: 在 tailwind.config.js 添加 fontFamily 防御覆盖**

Use Edit tool on `apps/electron/tailwind.config.js`，在 `theme.extend.colors` 块之后、`keyframes` 块之前插入：
```js
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
        serif: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
```

- [ ] **Step 5: typecheck**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 6: commit**

```bash
git add apps/electron/tailwind.config.js apps/electron/src/renderer/styles/components.css
git commit -m "refactor(typography): 防御层——Tailwind sans/serif/mono 同栈 + 删 Shiki monospace"
```

---

### Task 2: tool-result-renderers `font-mono` 清算（9 文件，22 处）

**Files (modify):**
- `apps/electron/src/renderer/components/agent/tool-result-renderers/read-result.tsx:65,76,98`
- `.../default-result.tsx:35,51,54,70`
- `.../bash-result.tsx:41`
- `.../grep-result.tsx:83,97,123,127`
- `.../web-search-result.tsx:67,81,103`
- `.../write-result.tsx:25,51`
- `.../edit-result.tsx:29,55`
- `.../glob-result.tsx:19,36`
- `.../web-fetch-result.tsx:19`

- [ ] **Step 1: baseline grep**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/agent/tool-result-renderers/ | wc -l
```
Expected output: `22`

- [ ] **Step 2: 在每个文件中删除 `font-mono` token**

删除规则：在 className 字符串内（无论是 `"..."` / clsx 第一参数 `'...'` / template literal），把 `font-mono` 这个 token 连同其前导的一个空格一并删除。若 `font-mono` 在 className 串首位（无前导空格），则删它和后面的一个空格。

**示例 1**（行内 className 字符串）— `read-result.tsx:65`：
```diff
-      <pre className="rounded-md p-3 text-[12px] font-mono text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
+      <pre className="rounded-md p-3 text-[12px] text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
```

**示例 2**（clsx 数组首位）— `bash-result.tsx:41`：
```diff
-        'rounded-md font-mono text-[12px] leading-relaxed overflow-x-auto',
+        'rounded-md text-[12px] leading-relaxed overflow-x-auto',
```

**示例 3**（仅含 font-mono 的 className）— `grep-result.tsx:127`：
```diff
-            <div className="font-mono text-[12px]">
+            <div className="text-[12px]">
```

对本 Task Files 列表的每一行 file:line 重复同样操作。Edit tool 调用时 `old_string` 用包含 `font-mono` 的整行内容（带必要前后文）确保唯一匹配。

- [ ] **Step 3: 验证清零**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/agent/tool-result-renderers/ | wc -l
```
Expected output: `0`

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 5: commit**

```bash
git add apps/electron/src/renderer/components/agent/tool-result-renderers
git commit -m "refactor(typography): tool-result-renderers 删 font-mono (22 处 / 9 文件)"
```

---

### Task 3: settings `font-mono` 清算（5 文件，7 处）

**Files (modify):**
- `apps/electron/src/renderer/components/settings/AboutSettings.tsx:382`
- `.../SkillCategoryView.tsx:492`
- `.../VersionHistory.tsx:170`
- `.../ShortcutSettings.tsx:176,385`
- `.../McpServerForm.tsx:320,355`

- [ ] **Step 1: baseline grep**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/settings/ | wc -l
```
Expected output: `7`

- [ ] **Step 2: 按 Task 2 §Step 2 同样规则编辑每处**

特殊提示：`McpServerForm.tsx:320/355` 是 Textarea 的 className 串（很长），`font-mono` 出现在串尾，删除前导空格即可。

- [ ] **Step 3: 验证清零**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/settings/ | wc -l
```
Expected output: `0`

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 5: commit**

```bash
git add apps/electron/src/renderer/components/settings
git commit -m "refactor(typography): settings 删 font-mono (7 处 / 5 文件)"
```

---

### Task 4: preview/renderers `font-mono` 清算（5 文件，18 处）

**Files (modify):**
- `apps/electron/src/renderer/components/preview/renderers/NotebookRenderer.tsx:62,79,83`
- `.../PaperDetailRenderer.tsx:168,183,196,209,255,258,261,264`
- `.../CodeRenderer.tsx:68`
- `.../PaperEntryDetailPanel.tsx:151,154,158`
- `.../CsvRenderer.tsx:76,125,140`

- [ ] **Step 1: baseline grep**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/preview/renderers/ | wc -l
```
Expected output: `18`

- [ ] **Step 2: 按 Task 2 §Step 2 同样规则编辑每处**

特殊提示：`PaperDetailRenderer.tsx` 含 8 处，多数是 `<dd className="font-mono text-[10.5px] text-foreground">` 形态，删除 `font-mono` 后保留其余 token。`CsvRenderer.tsx` 是表格容器，删后视觉会出现列宽不齐——已在 §6 接受。

- [ ] **Step 3: 验证清零**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/preview/renderers/ | wc -l
```
Expected output: `0`

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 5: commit**

```bash
git add apps/electron/src/renderer/components/preview/renderers
git commit -m "refactor(typography): preview/renderers 删 font-mono (18 处 / 5 文件)"
```

---

### Task 5: library + evidence-set-detail `font-mono` 清算（5 文件，10 处）

**Files (modify):**
- `apps/electron/src/renderer/components/library/ItemDetailPanel.tsx:200,215,229,243`
- `.../NotesView.tsx:596,610`
- `.../NoteDetailDialog.tsx:171,184`
- `.../evidence-set-detail/AddPapersToSetDialog.tsx:87`
- `.../evidence-set-detail/MemberPapersTab.tsx:105`

- [ ] **Step 1: baseline grep**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/library/ | wc -l
```
Expected output: `10`

- [ ] **Step 2: 按 Task 2 §Step 2 同样规则编辑每处**

`NoteDetailDialog.tsx` 注意：仅删 font-mono；该文件还有 `italic` 留到 Task 8 处理。

- [ ] **Step 3: 验证清零**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/library/ | wc -l
```
Expected output: `0`

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 5: commit**

```bash
git add apps/electron/src/renderer/components/library
git commit -m "refactor(typography): library 删 font-mono (10 处 / 5 文件)"
```

---

### Task 6: agent (choice / permission / messages) `font-mono` 清算（6 文件，12 处）

**Files (modify):**
- `apps/electron/src/renderer/components/agent/choice/ChoiceCard.tsx:156`
- `.../choice/ChoiceCardShell.tsx:60,63`
- `.../choice/choice-tokens.ts:27,29`
- `.../PermissionBanner.tsx:194,215,227,229`
- `.../AgentMessages.tsx:371`
- `.../permission/PermissionQueueList.tsx:61,64`

- [ ] **Step 1: baseline grep**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/agent/ --include="*.tsx" --include="*.ts" | grep -v "tool-result-renderers" | wc -l
```
Expected output: `12`

- [ ] **Step 2: 按 Task 2 §Step 2 同样规则编辑每处**

注意：`choice-tokens.ts` 不是 .tsx，但 className 串性质相同。`PermissionBanner.tsx:194` 是模块顶层常量 `PRE_CLASS`：
```diff
-const PRE_CLASS = 'text-xs font-mono bg-background/50 rounded px-2 py-1.5 ...'
+const PRE_CLASS = 'text-xs bg-background/50 rounded px-2 py-1.5 ...'
```

- [ ] **Step 3: 验证清零**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/agent/ --include="*.tsx" --include="*.ts" | grep -v "tool-result-renderers" | wc -l
```
Expected output: `0`

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 5: commit**

```bash
git add apps/electron/src/renderer/components/agent/choice apps/electron/src/renderer/components/agent/permission apps/electron/src/renderer/components/agent/PermissionBanner.tsx apps/electron/src/renderer/components/agent/AgentMessages.tsx
git commit -m "refactor(typography): agent choice/permission/messages 删 font-mono (12 处 / 6 文件)"
```

---

### Task 7: config + app-shell + ai-elements `font-mono` 清算（3 文件，11 处）

**Files (modify):**
- `apps/electron/src/renderer/components/config/CapabilityPackPanel.tsx:93,149,160,167,169,173`
- `apps/electron/src/renderer/components/app-shell/SearchDialog.tsx:303,404,408,412`
- `apps/electron/src/renderer/components/ai-elements/rich-text-input.tsx:459`

- [ ] **Step 1: baseline grep**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/{config,app-shell,ai-elements}/ | wc -l
```
Expected output: `11`

- [ ] **Step 2: 按 Task 2 §Step 2 同样规则编辑每处**

`SearchDialog.tsx` 4 处都在 `<kbd>` 上，删后键位提示仍可读；视觉信号靠 `bg-foreground/[0.06]` 和 padding 维持。

- [ ] **Step 3: 验证全 renderer font-mono 清零**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/ --include="*.tsx" --include="*.ts" --include="*.css" | wc -l
```
Expected output: `0`

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 5: commit**

```bash
git add apps/electron/src/renderer/components/config apps/electron/src/renderer/components/app-shell apps/electron/src/renderer/components/ai-elements
git commit -m "refactor(typography): config/app-shell/ai-elements 删 font-mono (11 处 / 3 文件) — 全 renderer font-mono 清零"
```

---

### Task 8: `italic` className 清算（9 文件，11 处）

**Files (modify):**
- `apps/electron/src/renderer/components/review-demo/EvidenceTraceCard.tsx:87`
- `.../review-demo/EvidenceCard.tsx:70`
- `.../review-demo/AddNoteDialog.tsx:84`
- `.../review-demo/AddReviewNoteDialog.tsx:94`
- `.../library/PaperNotesPanel.tsx:516`
- `.../library/NoteDetailDialog.tsx:116,197`
- `.../agent/SDKMessageRenderer.tsx:946`
- `.../library/evidence-set-detail/SetNotesTab.tsx:130`
- `.../library/evidence-set-detail/MemberPapersNotesTab.tsx:84,88`

**Skip（不动）：**
- `apps/electron/src/renderer/lib/citation-references.ts:104,111,112,113` — markdown 解析非 className 引用
- `apps/electron/src/renderer/components/agent/SessionPapersStatsBar.tsx:125` — untracked 文件，归该文件后续 PR

- [ ] **Step 1: baseline grep（JSX 内）**

```bash
grep -rEn "\bitalic\b" apps/electron/src/renderer/components/ --include="*.tsx" | wc -l
```
Expected output: `11`

- [ ] **Step 2: 删除每处 `italic` token**

规则同 Task 2 §Step 2，但目标 token 是 `italic`。

**示例 1**（引用块 `<blockquote>`）— `EvidenceCard.tsx:70`：
```diff
-        <blockquote className="border-l-2 border-border pl-3 py-1 italic text-sm text-foreground/80 leading-relaxed">
+        <blockquote className="border-l-2 border-border pl-3 py-1 text-sm text-foreground/80 leading-relaxed">
```

**示例 2**（空态占位）— `SDKMessageRenderer.tsx:946`：
```diff
-          <div className="px-2 py-3 text-xs italic text-muted-foreground/60">
+          <div className="px-2 py-3 text-xs text-muted-foreground/60">
```

对本 Task Files 列表的每一行 file:line 重复同样操作。

- [ ] **Step 3: 验证清零（含正则边界，避免误命中 `italic` 在变量名等场景）**

```bash
grep -rEn "\bitalic\b" apps/electron/src/renderer/components/ --include="*.tsx" | wc -l
```
Expected output: `0`

- [ ] **Step 4: 确认 citation-references.ts 4 处与 SessionPapersStatsBar.tsx 1 处仍在（按设计保留 / 排除）**

```bash
grep -En "\bitalic\b" apps/electron/src/renderer/lib/citation-references.ts | wc -l
```
Expected output: `4`

```bash
grep -En "\bitalic\b" apps/electron/src/renderer/components/agent/SessionPapersStatsBar.tsx 2>/dev/null | wc -l
```
Expected output: `1`（若文件已被 user 提交则仍是 1；若仍 untracked 也是 1）

- [ ] **Step 5: typecheck**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 6: commit**

```bash
git add apps/electron/src/renderer/components/review-demo apps/electron/src/renderer/components/library apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx
git commit -m "refactor(typography): 删 11 处 italic className (review-demo / library / agent)"
```

---

### Task 9: 版本号 + 全量验证 + push + PR

**Files (modify):**
- `apps/electron/package.json`（patch +1）

- [ ] **Step 1: 读取当前版本号**

```bash
grep -E '"version"' apps/electron/package.json
```
基线版本由读取结果决定（基线时 `0.1.401` 或更新；记为 X.Y.Z，本步骤目标 X.Y.(Z+1)）。

- [ ] **Step 2: bump patch**

Use Edit tool on `apps/electron/package.json`：把 `"version": "X.Y.Z"` 改为 `"version": "X.Y.(Z+1)"`。

- [ ] **Step 3: typecheck（全监测）**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 4: 全量 bun test（必含 key-parity）**

```bash
bun test
```
Expected: ≥ 1870 pass / 0 fail。

- [ ] **Step 5: 全 renderer 兜底 grep（最后一道 self-check）**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/ --include="*.tsx" --include="*.ts" --include="*.css" | wc -l
```
Expected: `0`

```bash
grep -rEn "\bitalic\b" apps/electron/src/renderer/components/ --include="*.tsx" | wc -l
```
Expected: `0`

```bash
grep -rEn "(Fira Code|Cascadia|JetBrains|Consolas|monospace)" apps/electron/src/renderer/ | wc -l
```
Expected: `0`

- [ ] **Step 6: dev smoke（人工，无法自动化）**

```bash
bun run dev
```
打开应用后过：
1. 触发 Agent 让其输出三反引号代码块 → 验证 Shiki 渲染字符不再等宽，但缩进保留
2. 让 Agent 触发 bash / read / grep / edit / write 工具 → 验证 tool-result-renderers 文本可读
3. 设置页 → 关于 / 渠道 / Skill 分类 / Shortcut → 文字不破版
4. 文件预览：Code / Notebook / Csv / Paper detail → 表格列对齐可接受
5. ChoiceCard：触发任一带选项的工具 → 选项文字可识别

将走过的项 ✅ 记录在 PR description；未走过的项明列。

- [ ] **Step 7: bump commit**

```bash
git add apps/electron/package.json
git commit -m "chore(version): apps/electron patch +1 (typography refactor)"
```

- [ ] **Step 8: push**

```bash
git push -u origin refactor/typography-unification
```

- [ ] **Step 9: 开 PR**

```bash
gh pr create --base main --title "refactor(typography): 全站字体收敛——单一无衬线栈 + 删除 font-mono / italic" --body "$(cat <<'EOF'
## Summary
- 落地 docs/design.md §4 字体硬约束三条：禁衬线 / 禁等宽 / 禁斜体
- 删 80 处 `font-mono` className（33 文件，6 个域）+ 11 处 `italic` className（9 文件）+ 1 行 `components.css` Shiki monospace 栈
- Tailwind config 防御性兜底：`fontFamily.sans/serif/mono` 三键同栈，未来手滑写 `font-mono` 静默无效
- 关联 spec：[`docs/specs/typography-unification-spec.md`](docs/specs/typography-unification-spec.md)

## Out-of-scope
- 主进程 `file-preview-service.ts`（plaintext / csv 预览 iframe）
- `default-skills/*` HTML 模板（skill 产物自治）
- untracked `SessionPapersStatsBar.tsx`（含 1 处 italic，由后续 PR 处理）

## Test plan
- [x] `bun run typecheck` 通过
- [x] `bun test` 通过（≥ 1870 pass）
- [x] grep 兜底：renderer 内 font-mono / italic / monospace 字体栈 = 0
- [ ] Dev smoke 关键面（详见 spec §5.2 / plan T9 Step 6）：reviewer 请按列表逐项确认
- [ ] 未走过的边缘 tool-result 路径：见下文

## Manually verified surfaces
（实施时填入；T9 Step 6 走过的勾选）

## Surfaces NOT manually verified
（实施时填入；reviewer 决定是否阻断 merge）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 10: 回填 spec status**

PR 创建后拿到 PR 编号 N，用 Edit tool 把 spec 顶部 `> **关联 PR**：TBD（refactor/typography-unification）` 改为 `> **关联 PR**：#N`。然后：

```bash
git add docs/specs/typography-unification-spec.md
git commit -m "docs(specs): 回填 typography-unification spec 关联 PR #N"
git push
```

---

## 10. Self-Review Notes

实施人按下列三项 fresh-eyes 自检 plan：

1. **Spec 覆盖**：plan §1–§8 每个变更类别都有对应 task（防御层 T1 / font-mono T2–T7 / italic T8 / 版本 + 验证 + PR T9）
2. **Placeholder 扫**：plan 内未含 "TBD" / "TODO" / 模糊措辞；T9 Step 1 的版本号 X.Y.Z 是实施时按实读基线，不是 placeholder
3. **类型 / 命名一致性**：本 plan 不引入新函数 / 新类型，全部基于 string-level 编辑，无跨 task 命名漂移风险

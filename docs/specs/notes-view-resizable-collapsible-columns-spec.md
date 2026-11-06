# 证据集视图 可拖拽改宽 + 预览栏可收起

> 状态：设计已批准，待实现
> 关联 issue：（无，本地迭代）
> 关联 PR：（待补）
> 领域语言事实源：`CONTEXT.md`

## 背景与问题

证据集视图（`NotesView`）当前是三栏固定布局：

- 列表栏 `w-[380px]`（全部证据集）
- 详情栏 `w-[520px]`（证据集详情）
- 预览栏 `flex-1`（PDF / HTML / 对话预览）

两个体验问题：

1. **最右侧预览栏无法收起**——即使不需要预览，它也始终占据右半屏，挤压详情阅读空间。
2. **各栏宽度写死，无法手动拖拽调整**——不同内容（长论文标题、宽 PDF）需要不同的栏宽分配。

## 目标

1. 预览栏顶部加关闭按钮，可整体收起；收起后详情栏吃掉空出的空间。点击任意证据条目（论文 / review）重新展开预览栏。
2. 「列表 | 详情」「详情 | 预览」两道分隔条均可拖拽改宽。
3. 栏宽与预览栏收起状态用 localStorage 记忆，下次进入恢复。

非目标：

- 不改最左侧全局应用导航栏（属于 app-shell，跨页面，本次不涉及）。
- 不引入第三方可拖拽面板库（与现有自定义拖拽模式不一致，且违反「新依赖先比较、不默认引入」约束）。

## 方案：轻量自定义可拖拽栏

复用项目已有的「拖拽 + `atomWithStorage` 记忆」模式（参考 `atoms/side-panel-layout.ts` 的 `sidePanelRatioAtom`）。零新依赖，改动集中在 `NotesView` 与一个新的 layout atom 文件、一个新的 `ColumnResizer` 组件。

### 组件 / 单元

**1. `atoms/notes-layout.ts`（新增）** — 证据集视图布局状态，`atomWithStorage` 持久化：

| atom | key | 默认 | clamp |
|------|-----|------|-------|
| `notesListWidthAtom` | `asci.notesView.listWidth` | 380 | 280–600 |
| `notesDetailWidthAtom` | `asci.notesView.detailWidth` | 520 | 360–760 |
| `notesPreviewCollapsedAtom` | `asci.notesView.previewCollapsed` | false | — |

并导出 clamp 常量（`NOTES_LIST_MIN/MAX`、`NOTES_DETAIL_MIN/MAX`）供 resizer 与单测共用。

**2. `components/library/ColumnResizer.tsx`（新增）** — 通用列拖拽手柄。

- props：`{ width: number; min: number; max: number; onResize: (next: number) => void }`
- 渲染一个 4px 宽的竖向手柄；hover/active 时 `cursor-col-resize`，用语义色（如 `bg-border` / hover `bg-primary/40`），**禁止 Tailwind 调色板硬编码**。
- 交互：`onPointerDown` 记录 `startX` 与 `startWidth` 并 `setPointerCapture`；`onPointerMove` 计算 `next = clamp(startWidth + (e.clientX - startX), min, max)` 调 `onResize`；`onPointerUp` 释放 capture。拖拽期间给 `document.body` 加 `select-none` 防止选中文本。
- 纯函数 `clampWidth(value, min, max)` 抽出，便于单测。

**3. `components/library/NotesView.tsx`（改造布局，[NotesView.tsx:216](../../apps/electron/src/renderer/components/library/NotesView.tsx#L216)）**

- 列表栏：`w-[380px]` → `style={{ width: listWidth }}` + `shrink-0`。
- 列表栏后插 `<ColumnResizer>`，绑定 `notesListWidthAtom`。
- 详情栏：`w-[520px]` → 预览栏展开时 `style={{ width: detailWidth }}` + `shrink-0`；预览栏收起时改为 `flex-1`（吃掉右侧空间）。
- 详情栏后，仅当预览栏**未收起**时插 `<ColumnResizer>`，绑定 `notesDetailWidthAtom`。
- 预览栏 `<main flex-1>`：仅当**未收起**时渲染。顶部加一个小标题条 + 关闭按钮（`PanelRightClose` 或 `X` 图标），点击 → `setNotesPreviewCollapsed(true)`。

**4. 展开联动** — 用户点击证据条目触发 `setPreviewMode(...)` 的所有入口（`onSelectPaperRef` / `onSelectReview` / `onSelectConversation`），在设 `previewMode` 的同时 `setNotesPreviewCollapsed(false)`，确保收起态下点条目能重新弹出预览。

### i18n

预览栏关闭按钮的 `aria-label` / tooltip 文案走 `useT('library')`，en + zh 同步加 key（如 `notes.view.preview.collapse` = "收起预览" / "Collapse preview"）。由 `key-parity` 测试守门。

### 数据流

```
用户拖分隔条 → ColumnResizer.onPointerMove → clampWidth → set 宽度 atom（localStorage 落盘）
                                                              → NotesView 重渲染，对应 aside width 更新
用户点关闭按钮 → set notesPreviewCollapsed=true → 预览栏不渲染 + 详情栏 flex-1
用户点证据条目 → set previewMode + set notesPreviewCollapsed=false → 预览栏重新渲染
```

### 错误处理 / 边界

- 宽度始终经 `clampWidth` 收敛，localStorage 里被改坏的异常值在读出后由 clamp 兜底（在 resizer 设值与渲染用值两侧都 clamp）。
- 预览栏收起时不渲染 `EvidenceItemPreviewPane`（其自带 ErrorBoundary 不受影响）。
- 全屏 PDF 覆盖层（`NotesViewPdfOverlay`）与本改动正交，不变。

### 测试

- `clampWidth` 纯函数单测：低于 min、高于 max、区间内三类边界（Bun 原生 test）。
- 拖拽手感、收起/展开联动、跨会话记忆：人工在 `bun run dev` 验证（无法自动化的部分明确告知）。

### 版本

`@asci/electron` patch +1。

## 受影响文件清单

- 新增：`apps/electron/src/renderer/atoms/notes-layout.ts`
- 新增：`apps/electron/src/renderer/components/library/ColumnResizer.tsx`（+ 同名 `.test.ts` 测 clamp）
- 改：`apps/electron/src/renderer/components/library/NotesView.tsx`
- 改：`apps/electron/src/renderer/locales/{en,zh}/library/core.json`（preview.collapse key）
- 改：`apps/electron/package.json`（version bump）

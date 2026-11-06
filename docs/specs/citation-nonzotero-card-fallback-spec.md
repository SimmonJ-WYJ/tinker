# 引用/来源点击：非 Zotero 论文兜底打开摘要卡片

> 状态：实现中
> 关联 issue：（待补）
> 关联 PR：（待补）
> 领域语言事实源：`CONTEXT.md`
> 相关 spec：[`doi-paper-jump-spec.md`](./doi-paper-jump-spec.md)、[`conversation-trace-claim-spec.md`](./conversation-trace-claim-spec.md)

## 背景与问题

综述 / 问答输出里的引用 `[N]`（含 `<quote>`）以及证据集里的证据条目，点击「查看原文 / Jump to source」时，对**不在 Zotero 库**里的论文存在两种糟糕表现：

- **对话流 `[N]` badge**：解析不到本地 PDF（`no-zotero-key` / `paper-not-found` / `no-pdf`）时，仅弹一条 toast 并滚回 §7 References，用户看不到任何论文内容。
- **证据集「Jump to source」按钮**：按钮显示判定只看 `sourcePaper.state === 'present'`，但点击处理 `handleSelectPaperRef` 要求 `zoteroKey` 非空，否则 `return` —— 按钮亮着却**点了毫无反应**（silent no-op），比 toast 更令人困惑。

根因：「查看 PDF 原文 + 高亮 quote」这件事强依赖 Zotero 本地附件，非 Zotero 论文（多为 OpenAlex 抓取，仅有 metadata + abstract）拿不到 PDF。

## 目标

非 Zotero 论文的引用 / 来源点击，统一**兜底打开摘要卡片**（OpenAlex/crossref metadata：标题、摘要、作者、DOI、`Add to Zotero`、Citation graph），而非 silent no-op 或仅 toast。**不弹 toast**（与 §7 DOI chip 行为一致，开卡片本身即反馈）。不改 Zotero 同步逻辑；改动集中在 renderer。

「在 Zotero 且有本地 PDF」的论文行为**不变**（仍打开 PDF + 高亮 quote）。

## 行为契约

| 入口 | 在 Zotero（有 PDF） | 不在 Zotero / 无 PDF |
|------|---------------------|----------------------|
| 对话流 `[N]` badge | 右栏打开 PDF + 高亮 quote（不变） | 右栏打开摘要卡片（`useOpenDoiInRightPanel(doi)` 三层兜底，永不死路）；无 doi 才回退滚动 §7 |
| 证据集「Jump to source」 | 全屏 PDF 覆盖层 + 高亮 quote（不变） | 全屏摘要卡片覆盖层（`PaperDetailRenderer`，由 `Paper` 本地字段映射 `PaperRecord`，无网络） |
| §7 DOI chip | 摘要卡片 / PDF（不变） | 摘要卡片（不变） |

## 实现

### ① 对话流 `[N]` badge —— `components/ai-elements/message.tsx`

`handleCitationTrace`：保持「先试 Zotero PDF」。`openEvidence(...)` 返回 `!ok` 时，不再 `toast + jumpToReferenceN`，改为 `void openDoi(doi)`（`useOpenDoiInRightPanel`）兜底打开摘要卡片。`doi` 缺失时仍 `jumpToReferenceN`（保留「滚到 §7」语义）。`.catch` 守底走 `jumpToReferenceN`。

### ② 证据集「Jump to source」—— `components/library/NotesView.tsx`

- `handleSelectPaperRef`：去掉 `if (!zoteroKey) return`。有 `zoteroKey` → 现有 `NotesViewPdfOverlay`；无 `zoteroKey` → 设置新的 `paperCardTarget`（由 `sourcePaper.ref: Paper` 映射成 `PaperRecord`）。
- 新增 `NotesViewPaperOverlay`：复用 `FilePreviewOverlay` 的 Dialog 全屏形态，内部渲染 `PaperDetailRenderer`。Evidence Sets 是独立视图、无 agent session，`openInRightPanel` 在此为 no-op，故必须走视图内覆盖层（与「跳到综述」同理）。
- `Paper → PaperRecord` 映射：`title/authors/year/venue/doi/abstract` 直取；`ts=nowIso()`、`query=null`、`source='evidence-set'`、`url=null`。

### ③ i18n —— `locales/{en,zh}/conversation/panels.json`

移除失效的 `citation.trace.{noPdf,paperNotFound,noZoteroKey,failed}`（仅 message.tsx 引用，改动后全失效）。en + zh 同步删除，`key-parity` 守门。

## 非目标

- 不做「一键 Add to Zotero → 等同步 → 自动打开 PDF」联动（更大改动，另议）。
- 不改 Zotero 同步、不碰主进程解析级联。

## 验证

- `bun run typecheck` / `bun test`（含 `key-parity`）。
- 手动：问答输出点非 Zotero 引用 `[N]` → 右栏出摘要卡片；点 Zotero 内引用 → PDF + 高亮（回归）。证据集对非 Zotero 证据点「Jump to source」→ 出摘要卡片覆盖层；对 Zotero 证据 → PDF 覆盖层（回归）。zh↔en 各走一遍无 raw key。

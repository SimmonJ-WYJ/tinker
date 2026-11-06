# 对话流内容可溯源 Spec（Conversation Trace · Clickable Claim Specification）

> **状态**：草稿 · 待 review
> **关联 issue**：#448（[ops-feedback] 对话流内容可溯源：论文引用 + 定量发现统一 Claim、点击右侧打开）
> **关联 PR**：—（待开）
> **领域语言事实源**：本 spec §3 术语；术语收敛进 `CONTEXT.md` 待补
> **改动包**：`apps/electron`（renderer + main prompt），可能涉及 `@asci/shared`（若 IPC 调整）

---

## 1. 概述与目的

让 AI 在**对话流**里输出的两类"有据内容"统一成**可点击 Claim**，点击在**右侧 WorkspacePanel** 打开来源 PDF 并滚动 + 高亮到来源原句，复用现有引文/PDF 高亮链路（不另起一套）：

- **(a) 论文引用**：AI 对具体论文的引用。
- **(b) 定量发现/数据**：AI 给出的来自论文的数值/统计结论。

**核心判据**：可溯源 / 可核验。任何"听起来像事实"的论文结论与数值，都必须能一键回到论文原文核对；**无来源的定量数据不得以"确定事实"形式呈现**。

### 1.1 核心设计洞察

**定量发现的"Claim" = 复用现有 citation 机制，不另造数据结构。**
一条绑定来源的定量发现，本质是"数值 + 论文原句"。让 AI 把任何定量发现也用 `[N]<quote>包含该数值的论文原句</quote>` 表达即可——渲染、tooltip、点击、PDF 高亮全部复用现有 citation 链路。"Claim"在本 spec 中即"绑定了来源 quote 的 citation"。

### 1.2 不做的事（Non-scope）

- 不为定量数据新建独立数据模型 / DB 表（复用 citation + evidence 链路）。
- 不改综述（review）视图既有的 EvidenceTraceCard 行为（已实现，仅参照复用）。
- 不做 PDF bbox 矩形高亮（沿用现有 quote 文本模糊匹配 + 字形级高亮）。
- 不做"把反馈回流影响后续生成"的闭环。

---

## 2. 现状与差距（事实源：源码探查）

### 2.1 已具备、可直接复用的链路

| 能力 | 位置 | 说明 |
|------|------|------|
| 对话流 `[N]<quote>` → CitationBadge | `lib/citation-transform.ts` + `components/ai-elements/message.tsx`（MessageResponse） | 转换 + 渲染已就绪 |
| CitationBadge 点击劫持口 | `components/common/CitationBadge.tsx` `onTraceClick` | 综述视图已用它接 EvidenceTraceCard |
| 点击 → 解析论文 → 高亮 PDF | `hooks/useOpenEvidenceInLibrary.ts` + `pendingEvidenceScrollAtom` / `activeEvidenceHighlightAtom`（`atoms/notes-atoms.ts`） | 综述视图核心链路 |
| PDF quote 模糊匹配 + 字形级高亮 | `preview/renderers/quote-match.ts` + `pdf-highlight-dom.ts` + `PdfRenderer.tsx` | 五档容错匹配，成熟 |
| 右栏唯一打开入口 | `hooks/useOpenInRightPanel.ts` | 能开 `kind:'file'` PDF |
| 论文标识解析 | IPC `papers.resolveZoteroKey({zoteroKey, doi, paperId})` | 综述靠它解析到具体 PDF |

### 2.2 三个关键差距（本 spec 要补）

- **G1 · 对话流引文点击行为不对**：对话里 CitationBadge 点击走 `jumpToReferenceN`——只在本条消息内滚到 §7，**不打开右侧 PDF**。
- **G2 · 右栏 PDF 预览没接高亮**：`InlinePreview` 的 PDF RendererHost 只传 `path/size/onError`，**未传** `quoteHighlights` / `pendingScrollNoteId`（高亮链路目前只存在于库视图 `ItemDetailPanel → PaperPdfReader`）。
- **G3 · 对话流引文格式不可解析到 PDF**：
  - 对话流当前用内联 `(doi:10.xxx)` 标识引用（可解析论文，但**无 quote**，无法高亮原句）。
  - `[N]<quote>` 格式带 quote 但 markdown `ReferenceMeta`（`lib/citation-references.ts`）**无 doi/zoteroKey**（综述用的 HTML 版 `review-html-citations.ts` 才有）。
  - 即：现状下"能开 PDF"和"能高亮原句"两件事没合在一处。

---

## 3. 术语（领域语言）

| 术语 | 定义 |
|------|------|
| **Claim（可溯源主张）** | 对话流中绑定了来源 quote 的一条断言，渲染为可点击角标；含论文引用与定量发现两类。 |
| **来源 quote** | 论文 PDF 中的 verbatim 原句，既用于 hover 展示，也用作 PDF 高亮的匹配 key。 |
| **未核验数据（unverified）** | 没有绑定来源 quote 的定量数据；不得以确定事实呈现，须 hedge 或显式标注。 |
| **右侧溯源（trace-in-panel）** | 点击 Claim → 右侧 WorkspacePanel 打开来源 PDF 并滚动+高亮，区别于综述的"切到库视图"。 |

---

## 4. 方案设计

整体分三块：**输出契约（prompt）→ 解析（references 带标识）→ 点击溯源到右栏（高亮链路接右栏 PDF）**。

### 4.1 输出契约（Agent system prompt，英文内置 prompt）

事实源：`apps/electron/src/main/lib/agent-prompt-builder.ts`。新增对话流引文 directive（英文，不走 i18n）：

1. 对话中**任何**对具体论文的引用、**任何**来自论文的定量发现/数据，必须以 `[N]<quote>verbatim source sentence</quote>` 形式给出（quote 为论文原句，定量发现的 quote 须包含该数值）。
2. 消息末尾给 `§7 References`，每条 `[N]` 携带**可解析标识**（沿用 index 里已知的 `doi:` / `arXiv:` / `s2:` 等），形如：
   `[1] Author et al. Title. Venue, Year. doi:10.xxxx`
3. **无来源的定量数据**：不得以确定事实陈述，须 hedge（"approximately/around"）或显式标注 `(unverified)`。
4. 与既有综述 `QUOTE_RULE_LITREVIEW` 区分作用域：本规约面向**普通对话流**输出。

> 风险：prompt 行为需实跑验证 AI 是否稳定按契约输出（见 §7 验证）。

### 4.2 解析：markdown References 携带论文标识（补 G3）

事实源：`apps/electron/src/renderer/lib/citation-references.ts`。

- `ReferenceMeta` 扩展可选字段：`doi?: string` / `paperId?: string` / `zoteroKey?: string`（对齐 `review-html-citations.ts` 的 HTML 版）。
- `parseReferences()` 从 `[N]` 行尾解析 `doi:` / `arXiv:` / `s2:` 等标识，落到对应字段。
- 不破坏既有 title/authors/year/venue 解析。

### 4.3 点击溯源到右栏（补 G1 + G2）

#### 4.3.1 新 hook：`useOpenEvidenceInRightPanel`（对标 `useOpenEvidenceInLibrary`）

事实源：新增 `apps/electron/src/renderer/hooks/useOpenEvidenceInRightPanel.ts`。

入参 `{ identifier: {zoteroKey?, doi?, paperId?}, quote, traceId }`，流程：
1. `papers.resolveZoteroKey(identifier)` 解析到论文（resolved 分支拿 zoteroKey + 本地 PDF path）。
2. 复用 `pendingEvidenceScrollAtom`（一次性滚动信号）+ `activeEvidenceHighlightAtom`（持续高亮，绑 paperKey）写入 `{quote, traceId}`。
3. 经 `useOpenInRightPanel({kind:'file', ext:'pdf', path, size})` 在右栏打开 PDF。
   - 需要本地 PDF path：resolved 后若无本地缓存，走现有 `previewDownloadPdf` 下载链路（与 PaperDetailRenderer 一致）。
4. **关键差异**：不调用 `setActiveView('library')`——用户留在对话流，PDF 在右侧打开。

#### 4.3.2 对话流 CitationBadge 注入 `onTraceClick`

事实源：`components/ai-elements/message.tsx`（MessageResponse 的 MarkdownLink → CitationBadge 装配处）。

- 对话流渲染时给 CitationBadge 提供 `onTraceClick(n, quote, badgeEl)`：
  - 从 `CitationReferencesContext` 取第 N 条 `ReferenceMeta` 的标识（doi/paperId/zoteroKey）。
  - 调 `useOpenEvidenceInRightPanel({identifier, quote, traceId})`。
- 解析失败兜底（无标识 / 无法解析论文）：回退到现有 `jumpToReferenceN`（滚到 §7）+ toast 提示"无法定位来源 PDF"。

#### 4.3.3 右栏 PDF 预览接高亮（补 G2）

事实源：`components/preview/InlinePreview.tsx`（RendererHost）+ `components/preview/renderers/PdfRenderer.tsx`。

- 让右栏 PDF RendererHost 像 `ItemDetailPanel` 那样读 `pendingEvidenceScrollAtom` / `activeEvidenceHighlightAtom`，组装 `quoteHighlights` + `pendingScrollNoteId` 传给 `PdfRenderer`，并在滚动完成时清一次性 scroll atom。
- 高亮 id 沿用 `evidence:${traceId}` 约定（与库视图一致，复用 `resolvePendingScroll` 思路）。
- 仅当当前预览的 PDF 与 `activeEvidenceHighlight.paperKey` 对应论文一致时才高亮（防串联）。

### 4.4 未核验数据呈现（补完 issue 验收第 3 条）

事实源：`lib/citation-transform.ts`（Pass 5 已识别"弱角标"裸 `[N]`）+ 渲染层。

- 对没有 `<quote>` 绑定的弱角标 / 裸定量数据，渲染"未核验"视觉标注：语义 token 颜色（禁 Tailwind 调色板硬编码），文案走 `useT('conversation')`，en+zh 同步。
- 主防线是 §4.1 的 prompt 契约从源头要求 hedge / 标注。

---

## 5. 数据流（目标态）

```
AI 对话输出: ... 提升 23% [3]<quote>...improves accuracy by 23%...</quote>
             §7 References
             [3] Smith et al. Title. NeurIPS 2023. doi:10.xxxx
   ↓ citation-transform → CitationBadge（对话流，注入 onTraceClick）
点击 Claim [3]
   ↓ onTraceClick(3, quote, el)
   ↓ 取 ReferenceMeta[3].doi
useOpenEvidenceInRightPanel({ identifier:{doi}, quote, traceId:'msg#3' })
   ├─ papers.resolveZoteroKey({doi}) → zoteroKey + pdf path（必要时 previewDownloadPdf）
   ├─ setPendingEvidenceScrollAtom({quote, traceId})
   ├─ setActiveEvidenceHighlightAtom({quote, traceId, paperKey})
   └─ useOpenInRightPanel({kind:'file', ext:'pdf', path})
   ↓ 右栏 InlinePreview RendererHost（读 evidence atoms）
PdfRenderer: quoteHighlights=[{id:'evidence:msg#3', quote}], pendingScrollNoteId='evidence:msg#3'
   ↓ 扫页 findQuoteFragmentsInPage → 命中页 → 滚动居中 → wrapSpanSubRanges 高亮
   ↓ onScrollComplete → 清 pendingEvidenceScroll（高亮保留）
```

---

## 6. 实现切片（tracer-bullet 垂直切法）

| 切片 | 内容 | 可独立验收 |
|------|------|-----------|
| **S1** | §4.2 references 解析带标识 + 单测 | `parseReferences` 能从 `[N] ... doi:x` 解析出 doi |
| **S2** | §4.3.3 右栏 PDF 预览接高亮 props（读 evidence atoms） | 手动写 atom 后右栏 PDF 能滚动+高亮 |
| **S3** | §4.3.1 + §4.3.2 新 hook + 对话流 CitationBadge onTraceClick（**端到端 tracer**） | 点击对话流 Claim → 右栏开 PDF 高亮 |
| **S4** | §4.1 prompt 契约（论文引用 + 定量发现 + 未核验 hedge） | 实跑对话验证输出格式 |
| **S5** | §4.4 未核验数据视觉标注 + i18n（en/zh） | 弱角标/无源数据有"未核验"标注 |

> S1→S2→S3 是可点通的端到端骨架（先用既有内联引用或手造数据验证）；S4 让 AI 真正按契约产出；S5 补未核验呈现。

---

## 7. 验证（反馈回路）

- `bun run typecheck` + `bun test`（含新增 `citation-references` 解析单测、`key-parity` 双语对齐）。
- `bun run dev` 实跑：**论文引用** 与 **定量发现** 各走一遍点击溯源；设置页切 zh↔en 各走一遍无 raw key。
- S4 prompt 改动：实跑多轮对话，确认 AI 稳定输出 `[N]<quote>` + §7 带标识，且无源数据被 hedge。
- 受影响包 `package.json` patch 递增（开 PR 时一次）。

---

## 7.1 实跑验证发现 + 渲染器容错（#448 第二轮）

首轮实跑（scaling laws 场景）暴露 spec §8 风险①：对话流**主 Agent** 自己读论文作答时，**不按** `[N]<quote>` + §7 + `doi:` 契约输出，而用其自然学术格式——`§6 References`、`arXiv:` 标识、裸 `[N]` + 独立 `> blockquote` 承载引文。导致 Claim 全不渲染、右栏不打开。

据此做了"迎合模型自然输出"的容错（meet-the-model-where-it-is），让功能在真实输出下也能触发：

- **A1 标题放宽**：`citation-references.ts` `SECTION_HEADING` 与 `citation-transform.ts` `REFERENCES_HEADING_RE` 改为认任意 `§?编号? References`（含 `§6` / 无编号），不再只认 `§7`。
- **A2 arXiv 标识**：`extractArxivDoi()` 把 `arXiv:<id>` 归一成 DataCite DOI `10.48550/arXiv.<id>`；无显式 `doi:` 时回退用它（DOI 反查归一大小写，可命中本地库）。覆盖"索引里只有 arXiv、无 doi"的论文（如 Kaplan 2020）。
- **A3-lite 裸 [N] 可点**：`message.tsx` 的引用探针放宽为「`[N]<quote>` 内联 **或** 有 References 章节 + 出现 `[N]`」。后者命中时裸 `[N]` 经 transform Pass 5 转弱角标 → 点击在右栏**打开来源 PDF**。
- **A3 引用块关联 quote**：`citation-transform.ts` 新增 Pass 4.5 —— 把"引用块 `> 原文… [N]`"块尾的 `[N]` 转成带 quote 的角标（quote = 块内正文），点击不仅打开 PDF 还**高亮该句**；引用块文本保留可见。这是主对话 Agent 自然格式下拿到高亮的关键。
- **B prompt 写硬**：`agent-prompt-builder.ts` 引用契约加完整正例 + 显式反例（要求 `<quote>` 内联紧贴 `[N]`）；实跑显示主对话 Agent 仍偏好 `§6 + arXiv + 引用块` 格式，故高亮主要靠 A3 的引用块关联兜底。

效果分层：
- 引用块 `> 原文 [N]`（实测主格式）→ 点击块内 `[N]` **打开 PDF + 高亮该句**（A3）。
- 正文内联裸 `[N]`（无关联 quote）→ 点击**仅打开 PDF**（A3-lite）。
- `[N]<quote>` 内联 → 打开 + 高亮（原综述链路）。

实跑验证：scaling laws 场景，点击 Chinchilla 的 `[2]`（arXiv→doi→本地 Zotero）成功在右栏打开 PDF。

## 8. 风险与开放问题

1. **prompt 服从度**：AI 是否稳定按契约输出 `[N]<quote>` + 标识 §7？需实跑调优，必要时降级为"尽力而为 + 兜底回退 §7 跳转"。
2. **PDF 可得性**：来源论文未入库 / 无可下载 PDF 时，点击如何降级（toast + 仅展示 quote tooltip？）。
3. **右栏 PDF 高亮与库视图共用 atoms 的相互干扰**：需确认两条路径不会因共用 `activeEvidenceHighlightAtom` 串台（靠 paperKey 隔离 + 视图上下文）。
4. **traceId 唯一性**：对话流的 traceId 取值（messageUuid#refN？）需保证同会话内唯一。

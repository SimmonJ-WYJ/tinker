<a id="对话流内容可溯源-specconversation-trace-&#45;clickable-claim-specification"></a>

# Conversation Trace · Clickable Claim Specification

> **Status**: draft · awaiting review
> **Related issue**: #448 ([ops-feedback] Traceable conversation content: unify paper citations + quantitative findings as Claims, open on the right when clicked)
> **Related PR**: — (to be opened)
> **Domain language source of truth**: terms in this spec §3; consolidation into `CONTEXT.md` pending
> **Affected packages**: `apps/electron` (renderer + main prompt), possibly `@asci/shared` (if IPC changes)

---

<a id="1-概述与目的"></a>

## 1. Overview and Purpose

Unify two kinds of grounded AI **conversation-stream** content as **clickable Claims**. Clicking opens the source PDF in the **right-hand WorkspacePanel**, scrolling + highlighting the source sentence through the existing citation/PDF highlight chain, without a second implementation:

- **(a) Paper citations**: AI references to specific papers.
- **(b) Quantitative findings/data**: paper-derived numerical/statistical conclusions.

**Core criterion**: traceable / verifiable. Any paper conclusion or number that sounds factual must return to its original paper in one click; **unsourced quantitative data must not appear as established fact**.

<a id="11-核心设计洞察"></a>

### 1.1 Core Design Insight

**A quantitative-finding Claim reuses existing citations, without another data structure.**
A sourced quantitative finding is fundamentally “number + original paper sentence.” Have AI express it as `[N]<quote>包含该数值的论文原句</quote>` (an original source sentence containing the number); rendering, tooltip, clicking, and PDF highlighting reuse the existing citation chain. In this spec, Claim means a citation bound to a source quote.

<a id="12-不做的事non-scope"></a>

### 1.2 Non-Scope

- No separate quantitative-data model / DB table (reuse citation + evidence).
- No changes to existing review-view EvidenceTraceCard behavior (already implemented; reuse as reference).
- No PDF bbox rectangle highlights (retain quote fuzzy matching + glyph-level highlighting).
- No feedback loop influencing subsequent generation.

---

<a id="2-现状与差距事实源源码探查"></a>

## 2. Current State and Gaps (Source Investigation)

<a id="21-已具备可直接复用的链路"></a>

### 2.1 Existing Reusable Chains

| Capability | Location | Notes |
|------|------|------|
| Conversation `[N]<quote>` → CitationBadge | `lib/citation-transform.ts` + `components/ai-elements/message.tsx` (MessageResponse) | Conversion + rendering ready |
| CitationBadge click interception | `components/common/CitationBadge.tsx` `onTraceClick` | Review view already connects EvidenceTraceCard here |
| Click → resolve paper → highlight PDF | `hooks/useOpenEvidenceInLibrary.ts` + `pendingEvidenceScrollAtom` / `activeEvidenceHighlightAtom` (`atoms/notes-atoms.ts`) | Review view's core chain |
| PDF quote fuzzy matching + glyph highlights | `preview/renderers/quote-match.ts` + `pdf-highlight-dom.ts` + `PdfRenderer.tsx` | Mature five-level tolerant matching |
| Single right-panel open entry | `hooks/useOpenInRightPanel.ts` | Opens `kind:'file'` PDFs |
| Paper identifier resolution | IPC `papers.resolveZoteroKey({zoteroKey, doi, paperId})` | Reviews use it to resolve specific PDFs |

<a id="22-三个关键差距本-spec-要补"></a>

### 2.2 Three Gaps This Spec Addresses

- **G1 · Incorrect conversation citation clicks**: CitationBadge calls `jumpToReferenceN`, scrolling only to §7 within that message, **without opening the right-hand PDF**.
- **G2 · Right-panel PDF preview lacks highlighting**: `InlinePreview`'s PDF RendererHost passes only `path/size/onError`, **not** `quoteHighlights` / `pendingScrollNoteId` (highlighting currently exists only in library `ItemDetailPanel → PaperPdfReader`).
- **G3 · Conversation citation format cannot resolve PDFs**:
  - Current inline `(doi:10.xxx)` references resolve papers but have **no quote** to highlight.
  - `[N]<quote>` has a quote, but Markdown `ReferenceMeta` (`lib/citation-references.ts`) has **no doi/zoteroKey** (only review HTML `review-html-citations.ts` does).
  - Opening PDFs and highlighting source sentences are currently disconnected.

---

<a id="3-术语领域语言"></a>

## 3. Terms (Domain Language)

| Term | Definition |
|------|------|
| **Claim (traceable assertion)** | A conversation assertion bound to a source quote, rendered as a clickable badge; covers paper citations and quantitative findings. |
| **Source quote** | Verbatim original PDF sentence, displayed on hover and used as the PDF-highlight matching key. |
| **Unverified data** | Quantitative data without a bound source quote; must be hedged or explicitly labeled, never presented as established fact. |
| **Trace-in-panel** | Click Claim → open source PDF with scroll+highlight in right-hand WorkspacePanel, unlike reviews switching to library. |

---

<a id="4-方案设计"></a>

## 4. Design

Three parts: **output contract (prompt) → parsing (reference identifiers) → right-panel tracing (connect highlights to right-hand PDFs)**.

<a id="41-输出契约agent-system-prompt英文内置-prompt"></a>

### 4.1 Output Contract (Agent System Prompt, Builtin English Prompt)

Source: `apps/electron/src/main/lib/agent-prompt-builder.ts`. Add conversation citation directives (English, outside i18n):

1. **Every** specific-paper citation and **every** paper-derived quantitative finding/data point must use `[N]<quote>verbatim source sentence</quote>` (original sentence; quantitative quotes must contain the number).
2. End the message with `§7 References`, each `[N]` carrying **resolvable identifiers** (known `doi:` / `arXiv:` / `s2:` etc. from the index), for example:
   `[1] Author et al. Title. Venue, Year. doi:10.xxxx`
3. **Unsourced quantitative data** must be hedged (“approximately/around”) or explicitly marked `(unverified)`, never stated as established fact.
4. Separate scope from existing review `QUOTE_RULE_LITREVIEW`: this contract targets **ordinary conversation** output.

> Risk: actual runs must verify AI reliably follows this contract (see §7).

<a id="42-解析markdown-references-携带论文标识补-g3"></a>

### 4.2 Parsing: Paper Identifiers in Markdown References (G3)

Source: `apps/electron/src/renderer/lib/citation-references.ts`.

- Extend `ReferenceMeta` with optional `doi?: string` / `paperId?: string` / `zoteroKey?: string` (matching HTML `review-html-citations.ts`).
- `parseReferences()` extracts `doi:` / `arXiv:` / `s2:` identifiers from `[N]` line endings into corresponding fields.
- Preserve existing title/authors/year/venue parsing.

<a id="43-点击溯源到右栏补-g1-&#45;g2"></a>

### 4.3 Click to Trace in the Right Panel (G1 + G2)

<a id="431-新-hookuseopenevidenceinrightpanel对标-useopenevidenceinlibrary"></a>

#### 4.3.1 New Hook: `useOpenEvidenceInRightPanel` (Modeled on `useOpenEvidenceInLibrary`)

Source: new `apps/electron/src/renderer/hooks/useOpenEvidenceInRightPanel.ts`.

Input `{ identifier: {zoteroKey?, doi?, paperId?}, quote, traceId }`; flow:
1. `papers.resolveZoteroKey(identifier)` resolves the paper (resolved branch yields zoteroKey + local PDF path).
2. Reuse `pendingEvidenceScrollAtom` (one-shot scroll) + `activeEvidenceHighlightAtom` (persistent highlight bound to paperKey), writing `{quote, traceId}`.
3. Open the PDF through `useOpenInRightPanel({kind:'file', ext:'pdf', path, size})`.
   - Requires a local PDF path: if no local cache after resolution, use existing `previewDownloadPdf` downloads (same as PaperDetailRenderer).
4. **Key difference**: never call `setActiveView('library')`; users remain in conversation while the PDF opens on the right.

<a id="432-对话流-citationbadge-注入-ontraceclick"></a>

#### 4.3.2 Inject `onTraceClick` into Conversation CitationBadge

Source: `components/ai-elements/message.tsx` (MessageResponse MarkdownLink → CitationBadge assembly).

- Supply conversation CitationBadge with `onTraceClick(n, quote, badgeEl)`:
  - Read the Nth `ReferenceMeta` identifier (doi/paperId/zoteroKey) from `CitationReferencesContext`.
  - Call `useOpenEvidenceInRightPanel({identifier, quote, traceId})`.
- Resolution fallback (missing identifier / unresolvable paper): existing `jumpToReferenceN` (§7 scroll) + “Cannot locate source PDF” toast.

<a id="433-右栏-pdf-预览接高亮补-g2"></a>

#### 4.3.3 Connect Right-Panel PDF Highlighting (G2)

Source: `components/preview/InlinePreview.tsx` (RendererHost) + `components/preview/renderers/PdfRenderer.tsx`.

- Like `ItemDetailPanel`, right-panel PDF RendererHost reads `pendingEvidenceScrollAtom` / `activeEvidenceHighlightAtom`, builds `quoteHighlights` + `pendingScrollNoteId` for `PdfRenderer`, and clears the one-shot scroll atom after scrolling.
- Highlight IDs retain `evidence:${traceId}` (same as library, reusing `resolvePendingScroll` approach).
- Highlight only when the previewed PDF matches `activeEvidenceHighlight.paperKey` to prevent cross-paper leakage.

<a id="44-未核验数据呈现补完-issue-验收第-3-条"></a>

### 4.4 Unverified Data Presentation (Issue Acceptance Item 3)

Source: `lib/citation-transform.ts` (Pass 5 recognizes bare `[N]` weak badges) + renderer.

- Weak badges / bare quantitative data without `<quote>` get an “Unverified” visual label: semantic-token colors (no hardcoded Tailwind palette), copy through `useT('conversation')`, en+zh together.
- The primary defense is §4.1's prompt requiring hedging / labels at source.

---

<a id="5-数据流目标态"></a>

## 5. Data Flow (Target State)

```
AI conversation output: ... improves 23% [3]<quote>...improves accuracy by 23%...</quote>
             §7 References
             [3] Smith et al. Title. NeurIPS 2023. doi:10.xxxx
   ↓ citation-transform → CitationBadge (conversation, inject onTraceClick)
Click Claim [3]
   ↓ onTraceClick(3, quote, el)
   ↓ Read ReferenceMeta[3].doi
useOpenEvidenceInRightPanel({ identifier:{doi}, quote, traceId:'msg#3' })
   ├─ papers.resolveZoteroKey({doi}) → zoteroKey + pdf path (previewDownloadPdf if needed)
   ├─ setPendingEvidenceScrollAtom({quote, traceId})
   ├─ setActiveEvidenceHighlightAtom({quote, traceId, paperKey})
   └─ useOpenInRightPanel({kind:'file', ext:'pdf', path})
   ↓ Right-hand InlinePreview RendererHost (read evidence atoms)
PdfRenderer: quoteHighlights=[{id:'evidence:msg#3', quote}], pendingScrollNoteId='evidence:msg#3'
   ↓ Scan pages findQuoteFragmentsInPage → matching page → scroll center → wrapSpanSubRanges highlight
   ↓ onScrollComplete → clear pendingEvidenceScroll (retain highlight)
```

---

<a id="6-实现切片tracer-bullet-垂直切法"></a>

## 6. Implementation Slices (Tracer-Bullet Vertical Slices)

| Slice | Content | Independent acceptance |
|------|------|-----------|
| **S1** | §4.2 reference identifier parsing + unit tests | `parseReferences` extracts doi from `[N] ... doi:x` |
| **S2** | §4.3.3 right-panel PDF highlight props (read evidence atoms) | Manual atom write scrolls+highlights right-hand PDF |
| **S3** | §4.3.1 + §4.3.2 hook + CitationBadge onTraceClick (**end-to-end tracer**) | Click conversation Claim → right-hand PDF highlight |
| **S4** | §4.1 prompt contract (citations + quantitative findings + unverified hedging) | Actual conversation verifies output |
| **S5** | §4.4 unverified labels + i18n (en/zh) | Weak badges/unsourced data labeled “Unverified” |

> S1→S2→S3 provides a clickable end-to-end skeleton (first use existing inline citations or synthetic data); S4 obtains real AI contract output; S5 adds unverified presentation.

---

<a id="7-验证反馈回路"></a>

## 7. Validation (Feedback Loop)

- `bun run typecheck` + `bun test` (including new `citation-references` parsing tests and bilingual `key-parity`).
- In `bun run dev`, trace one **paper citation** and one **quantitative finding**; switch Settings zh↔en, checking no raw keys.
- S4 prompts: actual multi-turn conversation verifies stable `[N]<quote>` + identifiers in §7 and hedged unsourced data.
- Increment affected `package.json` patch versions once when opening the PR.

---

<a id="71-实跑验证发现-&#45;渲染器容错448-第二轮"></a>

## 7.1 Actual-Run Findings + Renderer Tolerance (#448 Round Two)

The first actual scaling-laws run exposed §8 risk ①: the **main Agent**, reading papers itself, **ignored** `[N]<quote>` + §7 + `doi:` and used natural academic formatting: `§6 References`, `arXiv:` identifiers, bare `[N]` + separate `> blockquote` quotations. No Claims rendered and the right panel never opened.

Added meet-the-model-where-it-is tolerance so real outputs trigger the feature:

- **A1 Relax headings**: `citation-references.ts` `SECTION_HEADING` and `citation-transform.ts` `REFERENCES_HEADING_RE` accept any `§?编号? References` (optional number, including `§6` / no number), rather than only `§7`.
- **A2 arXiv identifiers**: `extractArxivDoi()` normalizes `arXiv:<id>` to DataCite DOI `10.48550/arXiv.<id>` as fallback without explicit `doi:` (DOI reverse lookup normalizes case and matches the local library). Covers papers indexed with arXiv only, such as Kaplan 2020.
- **A3-lite Clickable bare [N]**: `message.tsx`'s citation probe accepts inline `[N]<quote>` **or** a References section + `[N]`. For the latter, bare `[N]` through transform Pass 5 makes weak badges that **open the source PDF** on the right.
- **A3 Associate block quotes**: new Pass 4.5 in `citation-transform.ts` converts trailing `[N]` in `> 原文… [N]` (source-text blockquote) into a quote-bearing badge (quote = block body), opening the PDF and **highlighting the sentence**; the blockquote stays visible. This enables highlighting for the main Agent's natural format.
- **B Stronger prompt**: `agent-prompt-builder.ts` includes complete positive and explicit negative examples (inline `<quote>` immediately after `[N]`); actual runs still prefer `§6 + arXiv + 引用块` (blockquote), so A3 blockquote association provides the main highlighting fallback.

Behavior tiers:
- Blockquote `> 原文 [N]` (source text, observed primary format) → click its `[N]` to **open PDF + highlight that sentence** (A3).
- Bare inline `[N]` without associated quote → **open PDF only** (A3-lite).
- Inline `[N]<quote>` → open + highlight (original review chain).

Actual scaling-laws validation: clicking Chinchilla's `[2]` (arXiv→doi→local Zotero) successfully opened the PDF on the right.

<a id="8-风险与开放问题"></a>

## 8. Risks and Open Questions

1. **Prompt adherence**: does AI reliably output `[N]<quote>` + identifiers in §7? Tune in real runs; if needed, best-effort with fallback §7 scrolling.
2. **PDF availability**: fallback when paper is absent from library / PDF unavailable (toast + quote tooltip only?).
3. **Shared atom interference**: verify right-panel/library highlight paths do not interfere through `activeEvidenceHighlightAtom` (paperKey isolation + view context).
4. **traceId uniqueness**: conversation traceId values (messageUuid#refN?) must be unique within a session.

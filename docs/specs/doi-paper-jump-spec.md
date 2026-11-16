<a id="对话流-&#45;检索报告-doi-跳转文献详情-spec"></a>

# Open Paper Details from DOIs in Conversations / Search Reports

> **Status**: aligned (2026-06-05 grill-me review finalized) · implementing
> **Related issue**: — (fill at PR opening)
> **Related branch**: `fix/chat-doi-paper-jump`
> **Domain language `source` of truth**: `CONTEXT.md` (PaperRecord / WorkspacePaperEntry / current search / search report)

---

<a id="1-问题"></a>

## 1. Problem

Paper DOIs in conversation answers and search reports (inline `code`, doi.org links, bare text) are currently dead text. Although the paper is already in the right-side Search papers panel, users must visually match DOI strings: remember DOI → switch panel → scroll → click card, replacing one click with four steps.

<a id="2-目标"></a>

## 2. Goal

**Click `a` DOI anywhere → open that paper's details in the right panel**, with three fallback levels and no dead ends:

1. **Match current search** → same details as a panel click (entry → `PaperEntryDetailPanel`, record → `PaperDetailRenderer`)
2. **No match** → main directly queries crossref REST metadata (≤5s) → temporary record details
3. **Failure/timeout** → toast + system browser opens `doi.org`

<a id="非目标grill-me-明确不做"></a>

### Non-goals (Explicitly Excluded in grill-me)

| Exclusion | Rationale |
|------|------|
| Dispatch research subagent for one paper | Deterministic queries belong in code (crossref REST 1-2s vs LLM orchestration 30s+), following lit-search latency policy |
| Add looked-up papers to current search | Preserve search definitions: report thresholds (≥20/≥50), source counts, and cross-round dedup stats come from session papers and must not be contaminated by clicks |
| Add clicks to report References `<li data-doi>` | Review traceability uses `[N]` citations → PDF highlights; contract excludes visible DOI from References; opening details from reference entries is separate |
| Match entire library | Scope is current search + crossref fallback |
| Precompute match state for visual distinction | Requires render-time full matching/state synchronization and fluctuates during streaming; resolve on click with consistent UX |

<a id="3-交互决策记录grill-me-结论2026-06-05"></a>

## 3. Interaction Decisions (grill-me, 2026-06-05)

| # | Decision point | Conclusion |
|---|--------|------|
| 1 | DOI forms | All four: A inline code, B doi.org links, C bare text, D `doi:` prefix, in both chat and HTML reports |
| 2 | No match | No confirmation/Agent; direct crossref lookup, external-link fallback on failure |
| 3 | Result destination | Exclude from current search; temporary record details, `source` = `doi-lookup`, never impersonate MCP; persistence through working “Add to Zotero” button (mandatory acceptance) |
| 4 | Visuals | Reuse `FilePathChip`: `bg-primary/10 text-primary hover:bg-primary/20` + lucide `BookOpen` 12px + tooltip; color + icon indicate affordance; avoid file chip's `FileText` |
| 5 | Loading | Replace chip icon with `Loader2`, no toast |
| 6 | Match priority | Workspace entry over bare record, matching panel `onOpenPreview` |
| 7 | Pagination | Matches set `previewPaperSiblingsAtom` (retain ◀ ▶ n/total); temporary records have no siblings |
| 8 | Reviews (`reviews/*.html`) | Contract excludes visible DOIs; TreeWalker decoration is free fallback for model contract violations; primary target is bare DOI column in search report §3 recommendations |
| 9 | Historical sessions | Also works: query current session papers at click time, independent of recent retrieval |

<a id="4-doi-识别与归一化"></a>

## 4. DOI Recognition and Normalization

**Single source of truth**: new `apps/electron/src/renderer/lib/doi.ts` takes existing `DOI_PREFIX` / `DOI_BODY` from `citation-references.ts`, which imports them with zero behavior change. Original rationale: centralized definitions prevent drift between copies.

Comments define DOI bodies with 4–9 registration digits (excluding versions/decimals), optional doi:/doi.org/dx.doi.org prefixes, whole-string exact parsing, match scanning, normalization by stripping prefixes/trailing punctuation/lowercasing, and URL extraction restricted to DOI hosts.

```ts
/** DOI 主体：10.<4-9位注册号>/<后缀>。注册号位数下限 4 天然排除版本号（10.2.3）与小数 */
export const DOI_BODY = '10\\.\\d{4,9}\\/[^\\s)\\]>,;"\']+'
/** 可选前缀：doi:（冒号后容忍空格）/ https://doi.org/ / https://dx.doi.org/ */
export const DOI_PREFIX = '(?:doi:\\s*|https?:\\/\\/(?:dx\\.)?doi\\.org\\/)?'

/** 整串精确匹配（行内 code 用）：整段文本去首尾空白后必须就是一个 DOI（可带前缀） */
export function parseDoiExact(text: string): string | null
/** 多匹配扫描（remark 插件 / TreeWalker 用）：返回 [{ index, length, doi }] */
export function findDois(text: string): DoiMatch[]
/** 归一化为匹配 key：剥前缀 → 剥尾随装饰（[.,;)\]]+$）→ toLowerCase */
export function normalizeDoi(raw: string): string | null
/** 从 href 提取（MarkdownLink / 报告 <a> 用）：仅接受 doi.org / dx.doi.org host */
export function doiFromUrl(href: string): string | null
```

Keys such as `doi:10.18653/v1/2025.acl-long.28` (lowercase) compare directly with `recordKey()` (`session-papers-utils.ts:32`) `doi:${r.doi.toLowerCase()}`.

**False-positive protection (mandatory tests)**: versions `10.2.3`, decimals `10.5%`, and short registration `10.123/x` must not match. Strip trailing periods/commas/right parentheses/quotes; `doi:` case-insensitive.

<a id="5-架构"></a>

## 5. Architecture

<a id="51-文件清单"></a>

### 5.1 File List

The annotated list identifies modified shared IPC, main registration, preload types/implementation, citation imports, Markdown DOI branches/plugin/urlTransform, shared paper merging, report portals, and locale keys; new files are metadata lookup/tests, DOI helpers/tests, chip, and click hook. Paths and technical identifiers are preserved below.

```
packages/shared/src/types/papers-ipc.ts                          [modify] LOOKUP_DOI_METADATA channel + input/result types
apps/electron/src/main/lib/doi-metadata-lookup.ts                [new] crossref REST lookup + JSON → PaperRecord mapping
apps/electron/src/main/lib/doi-metadata-lookup.test.ts           [new] mapping/error tests (mock fetch)
apps/electron/src/main/ipc.ts                                    [modify] ipcMain.handle registration
apps/electron/src/preload/index.ts                               [modify] expose papers.lookupDoiMetadata (types + implementation)
apps/electron/src/renderer/lib/doi.ts                            [new] DOI regex single source of truth + 4 pure functions
apps/electron/src/renderer/lib/doi.test.ts                       [new] four forms + false positives + normalization tests
apps/electron/src/renderer/lib/citation-references.ts            [modify] import DOI_PREFIX/DOI_BODY (zero behavior change)
apps/electron/src/renderer/components/ai-elements/doi-chip.tsx   [new] DoiChip (including loading)
apps/electron/src/renderer/hooks/useOpenDoiInRightPanel.ts       [new] click resolution hook (three fallbacks)
apps/electron/src/renderer/components/ai-elements/message.tsx    [modify] remarkDois + MarkdownLink/MarkdownInlineCode DOI branches + allow doi:// in urlTransform
apps/electron/src/renderer/components/agent/session-papers-filter.ts [modify] extract buildMergedPaperItems(records, workspacePapers)
apps/electron/src/renderer/components/agent/SessionPapersPanel.tsx   [modify] L173-187 merge calls shared function (zero behavior change)
apps/electron/src/renderer/components/review-demo/ReviewHtmlRenderer.tsx [modify] DOI slots + DoiChip portals
apps/electron/src/renderer/locales/en/conversation/…             [modify] doiChip.* keys
apps/electron/src/renderer/locales/zh/conversation/…             [modify] synchronized (key-parity guard)
```

Increment once at PR opening: `packages/shared` patch +1, `apps/electron` patch +1.

<a id="52-点击解析数据流useopendoiinrightpanel"></a>

### 5.2 Click Resolution Flow (useOpenDoiInRightPanel)

The flow normalizes DOI, reads current session papers without caching and current workspace entries, merges using the panel's shared function (recordKey join + URL filtering + identity deduplication), matches DOI, sets siblings for a match and opens entry-preferred details. A miss queries metadata; `found` opens temporary details without siblings; failure/not-found/IPC exception shows toast and opens the system browser. Default sibling order excludes panel filters/sorting, with total matching the full panel.

```
DoiChip.onClick(doi)
  → normalizeDoi → failure: return 'failed' (theoretically unreachable; validated before rendering)
  → sessionId = currentAgentSessionIdAtom
  → records = await window.electronAPI.listSessionPapers(sessionId)   // Live read on click, no cache
  → entries = workspacePapersAtom (useAtomValue, current value at click)
  → merged = buildMergedPaperItems(records, entries)                  // Same panel function: recordKey join + URL filter + dedupeByIdentity
  → idx = merged.findIndex(recordKey(it.record) === `doi:${norm}` || it.entry?.doi?.toLowerCase() === norm)
  ├─ Match idx ≥ 0:
  │    setPaperSiblings({ items: merged, currentIndex: idx })         // Default order, no panel filters/sort; same full total
  │    openInRightPanel(it.entry ? { kind:'paper-entry', entry } : { kind:'paper', record })
  └─ No match:
       res = await window.electronAPI.papers.lookupDoiMetadata({ doi: norm })
       ├─ status 'found':
       │    setPaperSiblings(null)                                    // No pagination for temporary records
       │    openInRightPanel({ kind:'paper', record: res.record })
       └─ 'not-found' | 'error' | IPC exception:
            toast.info(t('doiChip.lookupFallback'))
            window.electronAPI.openExternal(`https://doi.org/${norm}`)
```

On `listSessionPapers` IPC errors, skip matching and proceed to lookup (try/catch plus console.`error`, no silent swallowing).
DoiChip owns pending `useState`, replaces icon with spinning `Loader2`, and ignores repeat clicks while pending.

<a id="53-新-ipcpaperslookupdoimetadata四联同步"></a>

### 5.3 New IPC: papers:lookupDoiMetadata (Four Layers)

Append to `packages/shared/src/types/papers-ipc.ts`. Comments retain the existing three channels, describe DOI lookup for unmatched conversation clicks, specify normalized lowercase prefix-free input, and classify network/timeout/parsing errors with messages for logs only.

```ts
export const PAPERS_IPC_CHANNELS = {
  // …既有三条不动
  /** 按 DOI 查 crossref 元数据 → PaperRecord（对话流 DOI 点击未命中本次检索时的即时查询） */
  LOOKUP_DOI_METADATA: 'papers:lookupDoiMetadata',
} as const

export interface PapersLookupDoiMetadataInput { doi: string }   // 已归一化（小写、无前缀）

export type PapersLookupDoiMetadataResult =
  | { status: 'found'; record: PaperRecord }      // record.source = 'doi-lookup'
  | { status: 'not-found' }                        // crossref 404
  | { status: 'error'; message: string }           // 网络/超时/解析异常，message 仅日志用
```

Main `doi-metadata-lookup.ts` (the `doi-metadata-lookup.ts` module):

- Core metadata: `fetch('https://api.crossref.org/works/' + encodeURIComponent(doi), { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'ASCI (mailto:dev@opensci.io)' } })` (crossref etiquette)
- Map crossref `message` → `PaperRecord`: `title[0]` stripping embedded rich tags; `author[].given+family`; `issued.date-parts[0][0]` → year; `container-title[0]` → venue; `DOI` → doi; `URL` → url; `abstract` stripping JATS XML → `abstract`; `is-referenced-by-count` → `extra.citedBy`; `source: 'doi-lookup'`; `ts: new Date().toISOString()`; `query: null`
- **Multi-source abstract fallback** (measured 2026-06-05, decided by Lao Zhang): crossref omits abstracts for Nature / Optica etc. On missing abstract, launch OpenAlex (rebuild `abstract_inverted_index`) and Semantic Scholar (`fields=abstract`) **concurrently**, preferring OpenAlex then S2. Deterministic REST, no Agents, independent 4s timeout per source. Of three measured papers lacking crossref abstracts, OpenAlex supplied 1; Semantic Scholar supplied all 3.
  - **Why concurrent**: serial OpenAlex→S2 lets a source's 4s timeout delay the other (OpenAlex sometimes exhausted 4s); concurrency caps total near one source's 4s.
  - **Three-state classification** (visible errors): source returns `ok | empty | error`; `empty` means normal response without abstract (including 404), `error` means timeout/429/network. If no abstract and any `error`, set `record.extra.abstractStatus = 'failed'`; details show “Abstract retrieval failed; click again to retry,” not “Unavailable.” Only two `empty` outcomes mean genuinely unavailable.
- try/catch throughout; crossref 404 → `not-found`; network/timeout/parse → `error`, not a renderer exception.
- **Process-local cache** (LRU, cap 256): repeated unmatched DOI clicks avoid network. Cache only found records with `abstractStatus !== 'failed'`; no transient failures, `not-found`, or errors, preserving retries. listSessionPapers matching stays live per click; cache covers only miss→lookup. A paper added by a new search between clicks correctly opens entry details next time.

> Main changes **do not use Vite HMR**; restart Electron after modifying lookup (`bun run dev` electron-vite restarts main). If abstract behavior appears unchanged, confirm main reloaded first.

<a id="54-chat-管线messagetsx"></a>

### 5.4 Chat Pipeline (message.tsx)

| Form | Integration | Implementation |
|------|--------|------|
| A inline code | `MarkdownInlineCode` (L617), after file path | `parseDoiExact(text)` → `<DoiChip doi label={text} />`; **whole string** must be DOI, mixed code unchanged |
| B doi.org link | `MarkdownLink` (L478), after mentions before external links | `doiFromUrl(href)` → `<DoiChip doi label={linkText ?? doi} />`; retain paper-title link text |
| C/D bare / `doi:` | New `remarkDois` (mirror `remarkMentions`, L369) | `findDois` splits text → `{ type:'link', url:'doi://<doi>' }`; `MarkdownLink` `doi://` branch renders chip |

C/D details:
- **Early probe** (mirror `UNVERIFIED_PROBE`): install plugin only for messages matching `/\b10\.\d{4,9}\//`, avoiding empty mdast traversals
- **Skip text under link parents**, avoiding double-wrapped title links such as `[标题](doi.org/…)` (title linked to doi.org), and inlineCode, already handled by A
- Allow `doi://` in `mentionUrlTransform` (L453)

<a id="55-html-报告管线reviewhtmlrenderertsx"></a>

### 5.5 HTML Report Pipeline (ReviewHtmlRenderer.tsx)

Reuse **cite → slot → portal** (L283-364), adding after sanitize + cite replacement and before KaTeX:

1. For `root.querySelectorAll('a[href]')` matches through `doiFromUrl(href)`, replace whole `<a>` with `<span data-asci-doi-mount>` and collect `{ el, doi, label: a.textContent }`.
2. TreeWalker scans remaining text, skipping a / code / existing slots / KaTeX-delimited text; split `findDois` matches into slot spans.
3. Add `doiSlots: DoiSlot[]` state; `createPortal(<DoiChip doi label />, slot.el)` alongside CiteSlot.
4. Add `doiSlots` to KaTeX effect dependencies, same as slots, rerunning after innerHTML rewrites.

Applies to `searches/*.html` and `reviews/*.html` through one renderer. Search-report §3 bare DOI table cells (`<td>`) follow step 2.

**Verify during implementation**: actual Electron behavior of non-DOI external report anchors (`<a>`) (main will-navigate/setWindowOpenHandler fallback). If dead links do nothing, add `openExternal` in the same click delegation; disclose separately as a correctness fix without spreading to other renderers.

<a id="56-doichip-组件"></a>

### 5.6 DoiChip Component

Comments specify normalized DOI and optional display label defaulting to the DOI itself.

```tsx
interface DoiChipProps {
  doi: string          // 已归一化
  label?: string       // 展示文本；缺省显示 doi 原文
  className?: string
}
```

- Visual: `Button variant="chip"`, copy `FilePathChip` classes (`file-path-chip.tsx:90-96`): `h-auto gap-1 rounded px-1.5 py-[2px] text-[12px] leading-[1.6] bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer duration-150 align-baseline not-prose`
- Icon: `BookOpen` (`!size-3 shrink-0`); pending → `Loader2` + `animate-spin`
- `title={t('doiChip.tooltip')}`; clicks call `useOpenDoiInRightPanel`

<a id="6-i18nen-&#45;zh-同步key-parity-守门"></a>

## 6. i18n (Synchronized en + zh, key-parity Guard)

Namespace `conversation`; DoiChip uses `useT('conversation')`, reused in reports with the same keys. Chinese column below is translated into English for documentation.

| key | zh (English translation) | en |
|-----|----|----|
| `doiChip.tooltip` | View paper details | View paper details |
| `doiChip.lookupFallback` | Paper metadata not found; opened in browser | Paper metadata not found — opened in browser instead |

<a id="7-测试计划"></a>

## 7. Test Plan

| Layer | Content |
|----|------|
| `doi.test.ts` | Four forms; normalization (case/prefix/trailing punctuation); false positives (`10.2.3`, `10.5%`, registration <4 digits); `doiFromUrl` only DOI hosts |
| `doi-metadata-lookup.test.ts` | crossref JSON mapping, JATS stripping, missing-field tolerance, 404→not-found, timeout→error |
| Existing regression | `citation-references` tests preserve behavior after regex migration; `key-parity.test.ts` |
| Manual golden path | §8 AC in `bun run dev`; zh↔en tooltip/toast without raw keys |

<a id="8-验收标准acgrill-me-确认版"></a>

## 8. Acceptance Criteria (AC, Confirmed in grill-me)

**Scenario 1 — Current Search Match**
- Given this session's Search papers contains DOI X, When clicking X in any chat form (inline code / doi.org / bare / `doi:`), Then right details exactly match panel opening, entry preferred, ◀ ▶ available.

**Scenario 2 — No Match → Immediate Lookup**
- Given DOI Y is absent, When clicked, Then chip loads and temporary right details open within ≤5s with source `doi-lookup`.
- Temporary “Add to Zotero” works and actually writes to Zotero, not merely a visible button.
- Paper does not enter Search papers; report counts unchanged.

**Scenario 3 — Lookup Failure**
- When crossref fails or exceeds 5s, Then toast + system browser doi.org, no dead end.

**Scenario 4 — HTML Reports**
- Given search report (`searches/*.html`) in right panel, When clicking decorated §3 DOI cell, Then scenarios 1–3 apply; review (`reviews/*.html`) TreeWalker fallback also works; References gain no new behavior from `data-doi`.

**Visuals and False Positives**
- [ ] Chip reuses FilePathChip (primary color + BookOpen + darker hover + tooltip), visibly clickable at rest.
- [ ] Non-DOI numeric strings (versions/decimals/short registrants) unchanged.
- [ ] Four representations normalize to the same key and match consistently.

**Engineering Gates**
- [ ] Four IPC layers synchronized (shared → main → preload → renderer).
- [ ] en/zh synchronized, key-parity passes; `bun run typecheck` / `bun test` pass.
- [ ] Temporary record source never impersonates MCP retrieval.

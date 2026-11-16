<a id="01-内测反馈汇总"></a>

# 0.1 internal-test feedback summary

**Sources**: `20260425_内部反馈.md` (internal feedback) + `20260426_用户反馈整理.md` (user feedback compilation)
**Compiled**: 2026-04-27
**Latest backfill**: 2026-05-08 (Issue/PR columns + orphan issues and incremental 0.1 multilingual requirements)
**Scope**: 0.1 required / 0.1 extras / deferred to 0.2

> **Issue/PR columns**: See `ya-docs/feedback/0.1/issue-mapping-draft.md` for F-# to GitHub Issue / PR mappings.
> Multiple PRs for one F-# use `/`; no mapping uses `—`.

---

<a id="c-组基础体验可靠"></a>

## Group C: Basic experience reliability

| F-# | Feedback | Type | Decision | Reason | Issue | PR |
|-----|------|------|------|------|-------|-----|
| F01 | Slow Mac installation; Windows requires manual Python/Node.js/Git installation; 360 blocks and deletes files incorrectly | `Bug` | **0.1 required** | Blocks C1 | — | #41 / #50 |
| F02 | Cannot install/uninstall on Windows (3 failures, D drive unsupported) | `Bug` | **0.1 required** | Blocks C1 | — | #50 / #66 |
| F03 | Installer forces default C drive, no custom path | `功能优化` (Feature improvement) | **0.1 required** | One root cause of F02, included in C1 | — | #50 |
| F04 | Without a library, forced to create one before writing a review | `Bug` | **0.1 required** | Blocks C3 | — | — |
| F05 | Asking after reverting to a conversation node errors and invalidates session | `Bug` | **0.1 required** | Blocks C4 | — | — |
| F06 | Lag switching pages (noticeable library→workspace delay) | `性能` (Performance) | **0.1 required** | Affects all operations | — | #67 |
| F08 | Windows input is “swallowed,” cannot send content, requires restart (reproduced on 2 machines) | `Bug` | **0.1 required** | Blocks core interaction | — | — |

---

<a id="a-组检索可信度"></a>

## Group A: Search trustworthiness

<a id="a0-&#45;检索前确认检索计划"></a>

### A0 — Confirm search plan before searching

| F-# | Feedback | Type | Decision | Reason | Issue | PR |
|-----|------|------|------|------|-------|-----|
| F10 | Search and review lack clarification; confirm keywords and scope before searching | `功能优化` (Feature improvement) | **0.1 required** | Blocks A0 | #28 | #43 |
| F11 | Vague terms like “latest advances” trigger direct search without asking time/discipline scope | `UX交互` (UX interaction) | **0.1 required** | Blocks A0 | #28 | #43 |
| F12 | Second-round search treated as new topic, restarting instead of incrementally supplementing first results | `功能优化` (Feature improvement) | **0.1 extra** | Experience improvement, not blocking | — | — |

<a id="a1a2a3a4-&#45;结果准确与透明"></a>

### A1/A2/A3/A4 — Accurate and transparent results

| F-# | Feedback | Type | Decision | Reason | Issue | PR |
|-----|------|------|------|------|-------|-----|
| F13 | AI hallucination: mismatched authors/papers, correct title but wrong author | `Bug` | **0.1 required** | Blocks A1 | #28 | #43 / #44 / #48 |
| F14 | Missing fields default to fabricated values like 1970 / Zhang 1982 | `Bug` | **0.1 required** | Blocks A2 | — | #58 |
| F15 | Ambiguous date fields: publication vs retrieval time unclear | `UX交互` (UX interaction) | **0.1 required** | Blocks A2 | — | — |
| F16 | Some results lack abstracts/keywords without “Unavailable” labels | `UX交互` (UX interaction) | **0.1 required** | Blocks A2 | — | — |
| F17 | Search sources opaque; individual results omit source database | `UX交互` (UX interaction) | **0.1 required** | Blocks A3 | — | #43 |
| F18 | Missing results replaced with similar/same-title papers without “No match” notice | `Bug` | **0.1 required** | Blocks A4 | — | — |

<a id="a-组其他-&#45;检索质量与效率"></a>

### Other Group A items — Search quality and efficiency

| F-# | Feedback | Type | Decision | Reason | Issue | PR |
|-----|------|------|------|------|-------|-----|
| F19 | Insufficient paper recall (176 of expected 400+; 1 of expected 3) | `功能优化` (Feature improvement) | **0.1 required** | Core search capability | — | #43 / #58 |
| F20 | Cannot find non-OA papers (including users' own); support configurable sources/institution accounts | `功能优化` (Feature improvement) | **0.1 required** | Search coverage required; multiple implementation paths possible | — | — |
| F21 | Relevance matches methods but not research objects | `功能优化` (Feature improvement) | **0.1 required** | Core relevance ranking | — | — |
| F22 | Results lack relevance scores (0-100 or stars) | `UX交互` (UX interaction) | **0.1 required** | Without scores users must open each result to judge | #26 | — |
| F23 | Support multidimensional result filters, relevance sorting by default | `功能优化` (Feature improvement) | **0.1 required** | Basic result usability | #26 | — |
| F24 | Agent-reported paper count may differ from actual current-turn search count | `Bug` | **0.1 required** | Data inconsistency, trust issue | — | — |
| F25 | Automatic PDF retrieval by DOI (using institutional IP) desired | `功能优化` (Feature improvement) | **Deferred to 0.2** | Resource-layer construction, substantial effort | — | — |
| F26 | Multi-select search results to add to Zotero | `功能优化` (Feature improvement) | **0.1 extra** | Single-paper works; multi-select improves efficiency | — | — |
| F59 | Search window blank after 3 consecutive similar-topic searches | `Bug` | **0.1 required** | Search trustworthiness, blocks repeated use | #60 | — |

---

<a id="b-组综述可追溯"></a>

## Group B: Traceable reviews

| F-# | Feedback | Type | Decision | Reason | Issue | PR |
|-----|------|------|------|------|-------|-----|
| F27 | Review citations must locate/jump to papers (click marker→paper entry) | `功能优化` (Feature improvement) | **0.1 required** | Blocks B1, B2 | #29 | #44 |
| F28 | Claim component: Hover review claims to preview source paragraphs | `功能优化` (Feature improvement) | **0.1 required** | Blocks B3 | #30 | #44 |
| F29 | Thinking chain should show conclusion→evidence causal paths, not just keywords | `UX交互` (UX interaction) | **0.1 required** | Blocks B4 | #32 | — |
| F30 | Review lacks academic structure: background→current state→method comparison→debates→outlook | `功能优化` (Feature improvement) | **0.1 required** | Review is core output; nonacademic format loses entry-point value | #33 | — |
| F31 | Review uses abstracts/Meta only, without semantic understanding of PDF full text | `功能优化` (Feature improvement) | **Deferred to 0.2** | PDF parsing is resource-layer construction; avoid endless scope | #34 (spike: #36/#37 CLOSED) | #63 |

<a id="d-组透明度"></a>

## Group D: Transparency

| F-# | Feedback | Type | Decision | Reason | Issue | PR |
|-----|------|------|------|------|-------|-----|
| F32 | No automatic Chinese/English query routing; English topics should use English sources and Chinese topics Chinese sources | `功能优化` (Feature improvement) | **0.1 required** | Blocks D2 | — | — |
| F33 | Search details lack statistics (total, year/source/relevance distributions) | `UX交互` (UX interaction) | **0.1 required** | Blocks D3 | — | — |
| F34 | Long tasks (30-60 minutes) lack progress/ETA, showing only scrolling logs | `UX交互` (UX interaction) | **0.1 required** | Long tasks without progress feedback are unacceptable | — | — |
| F35 | Too many default permission dialogs, confirming every step | `UX交互` (UX interaction) | **0.1 required** | Frequent interruptions; users request full automation by default | — | #31 |
| F36 | AI-generated charts lost in temporary directories on close; users cannot find files | `Bug` | **0.1 required** | Persist files and provide clickable paths in chat bubbles | — | — |

---

<a id="e-组ux-与工作流增强"></a>

## Group E: UX and workflow improvements

<a id="zotero-集成"></a>

### Zotero integration

| F-# | Feedback | Type | Decision | Reason | Completed? | Owner | Issue | PR |
|-----|------|------|------|------|------|------|-------|-----|
| F37 | Zotero MCPs disappear in newly created research projects | `Bug` | **0.1 required** | Core integration unavailable | ❌Incomplete | - | #61 (cross-cuts F40) | #20 |
| F39 | Choose collection when adding papers to Zotero (currently only the client's selected collection) | `功能优化` (Feature improvement) | **0.1 required** | Explicit user requirement | ❌Incomplete | - | — | — |
| F40 | Users expect direct Zotero integration, not separate library management, including paper downloads | `功能优化` (Feature improvement) | **0.1 required** | Product strategy impact; implement two-way Zotero sync well | ❌Incomplete | - | #61 (cross-cuts F37) + #38 (CLOSED spike) | #63 / #5 |
| F41 | Zotero references named “xxx et al.-filename” should show original paper title | `bug` | **0.1 required** | File readability | ❌Incomplete | - | — | #47 |
| F58 | Library entry still shows Connect Zotero guidance Tag after connection | `Bug` | **0.1 required** | Indicator mismatches reality | ❌Incomplete | - | #27 | — |

<a id="项目文件管理"></a>

### Project/file management

| F-# | Feedback | Type | Decision | Reason | Completed? | Owner | Issue | PR |
|-----|------|------|------|------|------|------|-------|-----|
| F38 | Improve chat reference panel: enlarge, support all arrow shortcuts, clearer routing, mark Zotero-downloaded PDFs | `UX交互` (UX interaction) | **0.1 required** | Frequent-operation efficiency | ✅Complete | Alex | — | #65 / #69 |
| F43 | Drag project files into chat as references | `功能优化` (Feature improvement) | **0.1 required** | Basic paper-reference interaction | ✅Complete | Alex | — | — |
| F44 | Add reference action to project-file context menu | `功能优化` (Feature improvement) | **0.1 required** | Paper-reference entry | ✅Complete | Alex | — | — |
| F46 | Agent chat Chrome lacks project isolation (switching projects keeps chat) | `Bug` | **0.1 required** | Project isolation is fundamental | ❌Incomplete | - | — | — |

<a id="通用-ux-改进"></a>

### General UX improvements

| F-# | Feedback | Type | Decision | Reason | Completed? | Owner | Issue | PR |
|-----|------|------|------|------|------|------|-------|-----|
| F47 | Add-to-Zotero button color (avoid red suggested) | `UX交互` (UX interaction) | **0.1 required** | Red implies danger, semantically wrong | ✅Complete | Simmon | — | #65 / #69 |
| F48 | Preview keyboard: left/right pages, up/down files | `UX交互` (UX interaction) | **0.1 required** | Frequent-operation efficiency | ✅Complete | Simmon | — | #65 / #69 |
| F49 | Inconsistent search details / added-to-Zotero details / library Preview layouts; reuse unified components | `功能优化` (Feature improvement) | **0.1 required** | Lower maintenance, consistent experience | ❌Incomplete | Simmon | — | — |
| F50 | Select review text to open horizontal quote/feedback menu | `UX交互` (UX interaction) | **0.1 required** | Reference-operation entry | ❌Incomplete | Simmon | — | — |
| F51 | Improve user-choice component interaction/UI in Agent chat | `UX交互` (UX interaction) | **0.1 required** | Core interaction component | ❌Incomplete | Alex | — | — |
| F52 | Improve choice-dialog tool UI | `UX交互` (UX interaction) | **0.1 required** | Frequent interaction component | ✅Complete | Alex | — | #65 / #69 |
| F53 | Update detection: blue indicator on left-sidebar avatar/settings | `功能优化` (Feature improvement) | **0.1 required** | Notify users of new versions | ✅Complete | Alex | — | #64 / #69 |
| F54 | Redesign settings interaction/grouping | `UX交互` (UX interaction) | **0.1 required** | Increased settings complexity needs reorganization | ✅Complete | Alex | — | #64 / #69 / #70 |
| F55 | Design startup Onboarding (branding, dependency setup wizard) | `功能优化` (Feature improvement) | **0.1 required** | First experience determines retention | ✅Complete | Simmon | — | #65 / #69 |
| F56 | Long workspace session names make ellipsis overlap edit button | `Bug` | **0.1 required** | Running button obscured, readability harmed | ❌Incomplete | - | #15 | — |
| F57 | Context-capacity “200.0k” should display “200k” | `UX交互` (UX interaction) | **0.1 required** | Trailing `.0` unnecessary for integers | ❌Incomplete | - | #16 | — |
| F60 | Editing channel fails to revalidate selected model, still calls old modelId | `Bug` | **0.1 required** | Channel-switch data consistency | ❌Incomplete | - | #62 | — |

---

<a id="f-组01-增量需求-&#45;多语言支持"></a>

## Group F: Incremental 0.1 requirements — multilingual support

> New requirements during the 0.1.0 cycle, separate from Group D F32 Chinese/English search-source routing.
> Implements 0.1 north-star C5 “Multilingual support, English by default.”

| F-# | Feedback | Type | Decision | Reason | Issue | PR |
|-----|------|------|------|------|-------|-----|
| F61 | i18n framework: English default + settings language selector | `功能优化` (Feature improvement) | **0.1 required** | Multilingual foundation ticket; #62/#63 depend on it | #52 | — |
| F62 | Translate all UI copy: navigation / settings / library / sessions / Onboarding | `功能优化` (Feature improvement) | **0.1 required** | Fully bilingual UI within 0.1 scope | #53 | — |
| F63 | English built-in prompts + Agent input/output language routing | `功能优化` (Feature improvement) | **0.1 required** | Agent behavior depends strongly on consistent prompt language | #54 | — |

---

<a id="统计"></a>

## Statistics

> Recalculated after 2026-05-08 backfill; slightly different from earlier figures (minor arithmetic errors in original counts corrected together).

| Decision | Count |
|------|------|
| 0.1 required | 55 |
| 0.1 extra | 2 (F12, F26) |
| Deferred to 0.2 | 2 (F25, F31) |

| Type | Count |
|------|------|
| Bug | 17 |
| UX interaction | 17 |
| Feature improvement | 24 |
| Performance | 1 |

| Group | F-# count |
|----|----------|
| Group C Basic experience | 7 |
| Group A Search trustworthiness | 18 (including F59) |
| Group B Review traceability | 5 |
| Group D Transparency | 5 |
| Group E UX/workflow | 21 (including F56/F57/F58/F60) |
| Group F Multilingual support | 3 |
| **Total** | **59** |

**Delivery date**: 2026-05-20

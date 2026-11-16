<a id="ui-迭代上下文记录-&#45;每项改动的起因"></a>

# UI Iteration Context Log — Reasons for Each Change

> Purpose: record **which problem/feedback prompted each change** in this dogfood/design walkthrough (reason → change), for traceability and review.
> Two batches: **Batch A** merged into `main` (PR #465); **Batch B** is the current uncommitted Codex-style configuration-page redesign.

---

<a id="0-环境-&#45;部署阻断本地起项目时"></a>

## 0. Environment / Deployment Blockers (Starting Locally)

| Reason | Change |
|------|------|
| After cloning, `bun run dev` immediately showed a white screen: `better-sqlite3` native module was built for the Node ABI, incompatible with Electron ABI ("Could not locate the bindings file") | Run the `rebuild` script in `apps/electron` to rebuild native modules for Electron 39 (repeat after major Electron upgrades) |
| "Add note / Add to evidence set" did nothing when clicked | Root cause: local `~/.asci-dev/objects.db` retained an **old schema** at `user_version=1` (notes.kind NOT NULL, no body_path/source_id), while new code queried the new schema → main swallowed SqliteError → buttons appeared broken. Handling: back up and delete the old database; restart to rebuild through new `001` migration. **Underlying defect**: `001-initial.sql` was rewritten in place rather than adding `002`; real existing users will suffer the same upgrade issue (recorded, unfixed) |

---

<a id="批次-a-&#45;已并入-pr-465对话流-&#45;文献库-&#45;配置等打磨"></a>

## Batch A — Merged in PR #465 (Conversation / Library / Configuration Polish)

<a id="笔记-&#45;证据集"></a>

### Notes / Evidence Sets
| Reason | Change |
|------|------|
| Note cards bolded the paper title as primary and grayed "hello" (note content) below—hierarchy reversed | NotesView cards: highlight content at the top, demote source title to gray secondary line |
| Selected source quotation in evidence-set details duplicated the "evidence item" card | Add `hideQuote` to `NoteDetailBody`, hiding that quote only in the evidence-set panel |
| Report: "opening the evidence chain shows a white screen" | Add temporary renderer-error forwarding for diagnosis → not reproducible after DB reset → remove temporary diagnostics |

<a id="配置-&#45;整页视图"></a>

### Configuration / Full-Page Views
| Reason | Change |
|------|------|
| Switching to Configuration changed only central content; the Agent conversation artifact panel remained on the right | Root cause: `AppShell.showRightPanel` exclusion list omitted `config`. Replace with affirmative `activeView === 'conversations'` check; full-page views never show artifact panels |
| Capability-pack content on the configuration page used about half the width, leaving a large blank area | Remove `max-w-3xl` from `CapabilityPackPanel` to fill available width |

<a id="-提及"></a>

### @ Mentions
| Reason | Change |
|------|------|
| Workspace-root files in the @ file panel lacked source paths, leaving users unsure of origins | Add `sourcePath` (absolute path) for display; retain relative `entry.path` as mention id |

<a id="证据集视图布局"></a>

### Evidence-Set View Layout
| Reason | Change |
|------|------|
| Rightmost preview panel could not collapse; three fixed-width columns could not resize | Add `ColumnResizer` + `notes-layout` atoms for draggable column widths + collapsible preview (remembered in localStorage) |
| Collapsing removed the entire preview panel, including the reopen action | Keep a narrow vertical strip + expand button when collapsed, allowing reopening anytime |

<a id="对话流执行记录"></a>

### Conversation Execution Records
| Reason | Change |
|------|------|
| Execution-row structures differed: arrows at either end, sometimes two icons, small Agent names, entire failed rows red | Extract shared `FlowRow`: trailing arrows, one icon slot, 14px Agent names, only "N steps failed" red; integrate ContentBlock/ExecutionStepGroup |
| Sub-Agent rows used ⊙, which did not convey "sub-Agent," and misaligned with execution rows | Use `Bot` (lucide), remove pills, use size-3.5 + gap-2 aligned to the execution rows' left edge |

<a id="全局排版"></a>

### Global Typography
| Reason | Change |
|------|------|
| Some placeholder / empty-state / hint text used italics, violating the all-upright rule | Remove `italic` globally from these texts (retain content quotations such as blockquotes); input placeholders no longer become italic with `suggestionActive` |

<a id="加入-zotero"></a>

### Add to Zotero
| Reason | Change |
|------|------|
| With Zotero absent/not running, "Add to Zotero" opened "Choose location" immediately → collection loading failed | Extract `useZoteroReadyGate`: check `ping`/`detectInstall` first; running→choose location / installed but stopped→launch / absent→download; cover `ZoteroLinkDialog` + `ZoteroQuickAddDialog` |
| Guidance-dialog copy/layout should match the library | Extract shared `GuardBanner` (amber card), reused in library and dialogs |
| Paper titles still appeared when not ready | Hide title/authors when not ready; keep only the guidance card |

<a id="检索结果工具栏"></a>

### Search Results Toolbar
| Reason | Change |
|------|------|
| "Relevance ↓ ∨" duplicated downward icons; desired layout was "actions above, sorting below" | Remove dropdown's built-in chevron (retain textual ↓); reorganize two rows: title/··· above, Overview/filters/sorting below, aligned edges; filter always shows "funnel+Filter" |
| "Relevance ↓" text was smaller than adjacent Overview/Filter | Unify font size, weight, and padding at 12px (arrow scales with text) |

---

<a id="批次-b-&#45;当前未提交配置页-codex-风重做"></a>

## Batch B — Currently Uncommitted: Codex-Style Configuration Redesign

> Trigger: comparison with the Codex plugin marketplace suggested that the configuration page simply exposed backend manifest/SKILL metadata; change to a two-level "card overview → details" model.

<a id="能力包面板"></a>

### Capability-Pack Panel
| Reason | Change |
|------|------|
| Cards showed long English Agent routing prompts as user descriptions; expanding all filled the screen; metadata appeared as key-value text; no out-of-box value conveyed | Add user-facing `summaryI18n` (embedded in manifest) + `resolvePackSummary` fallback; change grid list→detail page; details contain description + full description + Includes (Skill/MCP rows, MCP links to settings); add "Built-in · Enabled by default" badge; omit empty fields |

<a id="skill-面板"></a>

### Skill Panel
| Reason | Change |
|------|------|
| Wanted a Codex-style grid + click-through details | Single-column rich rows → grid cards → detail dialog |
| Toggle hidden in dialog; card ✓ looked like "remove"; toggling moved cards into disabled section and made them hard to find | Expose toggle on card's right (other card areas open dialog); disabled cards gray in place; **renderer sorts by name consistently**, independent of enabled state, so toggles never move cards |
| Two flat filter groups looked mutually exclusive, duplicate "All" labels were ambiguous, and logic was unclear | Status=primary filter (segmented), source=secondary (dropdown); rename "All"→"All statuses"; source **counts follow status** |
| Previous primary/secondary cards were too tall and wasted space | Compress into a **compact single-line toolbar**: search + status segments + source dropdown + trailing result count |

---

<a id="跨批次约定备注"></a>

## Cross-Batch Convention Notes

- **Versions**: CLAUDE.md updated to "increment once together only when opening a PR"; Batch B has not bumped.
- **i18n**: all user-facing copy uses `useT`, with en + zh synchronized and `key-parity` tests as guards.
- **Omitted for later (requires manifest fields)**: in-pack preference editing and Information metadata (developer/website/privacy/example prompts).
- Each change validated with `typecheck` + `bun test` (including key-parity) + `eslint`; UI interactions manually checked in `bun run dev`.

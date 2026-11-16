> Baseline audit record: This document and companion JSON preserve the precleanup file/feature inventory; original counts are not rewritten as source is deleted. Subsequent implementation and retained boundaries are in the [Research Retirement Execution Record](./2026-11-10-research-retirement.md).

<a id="asci-旧品牌与科研资产保留审计2026-11-10"></a>

# ASCI Legacy Branding and Research Asset Retention Audit (2026-11-10)

Audit target: Tinker branch baseline `4ca339592668581c1dc36abc9097fc9bf0aa1650`. All line references below use that commit. To avoid concurrent migration edits changing conclusions, inventory was generated from `git archive HEAD`; evidence read through `git show HEAD:<path>` / `git grep ... HEAD`. This report did not independently check the latest remote tip online; the parent task supplied remote-to-baseline correspondence. The audit adds only this report and adjacent JSON inventory, without modifying/deleting source, old documents, or user data, or running GUI, tests, builds, commit, or push.

<a id="结论"></a>

## Conclusion

**Extensive ASCI documentation/research capabilities remain; Tinker's general-product changes hide some entries and select runtimes per request, but the research system has not been removed.** Source existence, static wiring, ordinary UI accessibility, and installed-package runtime verification are four distinct conclusions. This audit establishes specific wiring among the first three, not successful execution.

- Old branding extends beyond internal IDs: active Agent instructions `CLAUDE.md:10` still define ASCI as research-oriented; `CONTEXT.md:1-3` still describes ASCI conversation flow; generated session-workspace instructions `apps/electron/src/main/lib/config-paths.ts:25-38` explicitly identify the host as ASCI.
- `RESEARCH_UI_ENABLED=false` in `apps/electron/src/renderer/lib/product-surface.ts:2` hides selected renderer entries only; it does not disable main IPC, research DB, paper watcher, pack distribution, or all research interfaces.
- Papers remains the default right-side tab: `apps/electron/src/renderer/atoms/right-panel-tabs.ts:45-48`, with new-session activeId=session-papers at `:217-222`. `apps/electron/src/renderer/components/app-shell/RightPanelTabBar.tsx:264-275` iterates tabs without research filtering; `RightPanelTabContent.tsx:79-88` mounts content. Thus with a current session and open right panel, Papers has an ordinary static entry and defaults active.
- Runtime routes research intent to `research`; ordinary tasks default to reduced context. Repository prompt/MCP presence does not mean every ordinary chat loads them. Explicit Skill/MCP references retain additional loading boundaries, below.
- Treat licenses, original attribution, data paths, and protocol names separately; never replace/delete all `ASCI` matches indiscriminately.

<a id="完整清单与计数"></a>

## Full Inventory and Counts

Adjacent `2026-11-10-legacy-research-inventory.json` contains **all 2,911 tracked file/symlink names**, search-group flags, filename-match flags, and exclusive ownership categories. Zero-based indices in unique `files` are file IDs; category/term-bitmask decoding is in `file_table_encoding`. Filter categories/flags for complete filenames. Asset sets reference file IDs without repeated paths; unmatched entries also remain. Exact call-chain lines are in this report rather than duplicated text hits in JSON.

- UTF-8 text/link targets scanned: 2,770; binary/non-UTF-8 excluded: 141 (filenames retained; no image/PDF OCR). `AGENTS.md` is a tracked symlink to `CLAUDE.md`, not followed/counting twice.
- At least one path/content group match: **1,572 files**; unmatched: 1,339.
- Case-insensitive raw `asci` substring: 948 files; ASCI token excluding adjacent English letters: 894; OPENSCI: 114; Chinese research terms: 436; English research terms: 879; research-service names: 690. Sets overlap and cannot be summed.
- 54 files match only raw `asci`, not the ASCI token, e.g. ASCII encoding, Fascism, journal-name substrings; do not automatically count as brand residue.

Exclusive path categories below sum to 1,572. These are **matched file counts**, not feature counts or confirmed cleanup counts.

| Category (JSON key) | Matching Files | Interpretation |
|---|---:|---|
| root_product_and_agent_docs | 3 | README, CLAUDE, CONTEXT, including current instruction conflicts |
| current_reference_docs_and_qa | 28 | ADR, architecture, build/development docs; verify against current source |
| historical_docs_and_proposals | 41 | history, 0.2, milestones, feedback, proposals, disabled upstream workflows |
| design_specs_not_runtime_authority | 78 | Designs; status/date do not establish implementation/accessibility |
| prior_audit_and_qa_evidence | 4 | Prior reports/validation, not reused as current runtime evidence |
| bundled_skills_and_assets | 292 | Research skills and research examples in general skills |
| bundled_capability_packs | 19 | All files in 3 research packs |
| bundled_mcp_and_resources | 87 | Search MCP, Zotero resources; excludes entries prioritized as tests |
| main_runtime | 245 | Main services, storage, IPC, prompts, MCP |
| preload_bridge | 7 | renderer ↔ main interfaces |
| renderer_runtime | 270 | Pages, components, atoms, hooks, etc. |
| renderer_locales | 54 | Translations for current/hidden pages |
| shared_core_ui_packages | 83 | Shared types, constants, Zotero clients, schemas, etc. |
| tests_fixtures | 294 | Standalone test/fixture paths; bundled skill files prioritized as assets |
| build_scripts_config_other | 65 | Packaging, scripts, configuration, other paths |
| licenses_attribution | 2 | Keyword-matching LICENSE/NOTICE files; other licenses remain in full inventory |

Combined content/path search: `ASCI/asci`, `OPENSCI`, `科研/论文/文献/学术/综述/研究空白/证据集` (research/papers/literature/academic/reviews/research gaps/evidence sets), `research/scientific/scholar/academic/literature/paper(s)/citation(s)/evidence-set`, `Zotero/PubMed/arXiv/paper-search/papers-rg/litreview/lit-review/lit-search/research-gap/OpenAlex/Semantic Scholar/bioRxiv/EuropePMC/Crossref`. JSON `methodology.patterns` holds exact replayable regexes. Broad research/paper terms also match market research, business writing, examples, and scientific-library descriptions; disposition requires these call chains and human judgment.

Additional complete path-based bundled-skill inventory independent of keywords: **99 SKILL.md entries, 883 skill files** (including general Office/charts, not all research-specific); 3 packs/19 files: `lit-search`, `lit-review`, `research-gap`. All names/paths are in JSON `retained_asset_sets`, covering scientific tools such as biopython/scanpy that may lack search terms.

<a id="文档历史保留与当前权威入口"></a>

## Documentation: Historical Retention and Current Authority

| Asset | Evidence | Assessment |
|---|---|---|
| Current Tinker README | `README.md:3,18,26,32` | Product named Tinker; explicitly evolved from ASCI, retains @asci names, Candidate data isolation, original attribution, historical README link |
| Current Agent rules | `CLAUDE.md:10,20,45,221`; `AGENTS.md -> CLAUDE.md` | Still research-oriented ASCI, old issue tracker/directory descriptions; active authority, not archive only |
| Current domain language | `CONTEXT.md:1-3,66-106,174-190` | Papers/evidence sets/Corpus/relevance service; mixes current/target/future design, so future Corpus is not deployed functionality |
| Historical README | `docs/history/ASCI-README.md`; `README.md:32` | Explicit archive; retain provenance/evolution |
| Research designs | `docs/specs/0.4.0/research-gap-spec.md`, `docs/specs/evidence-set-research.md`, Zotero/citation-navigation specs | Fully retained; design presence does not replace source review |
| Current general-product surface design | `docs/specs/tinker-general-product-surface.md:3,7-18,22,26` | Explicit entry hiding without data/background removal; native E2E pending. Its Rust migration paused statement reflects scope then, not a prohibition on this user-authorized migration |
| Prior roadmaps/discussions | `docs/milestones/`, `docs/feedback/`, `docs/0.2/`, `docs/proposals/` | Historical goals, feedback, static demos/proposals, not automatically current promises |
| Specifications/architecture | `docs/architecture.md`, `docs/agent-sdk-integration.md`, `docs/adr/` | Still navigated by CLAUDE, with old research architecture mixed in; synchronize by domain rather than wholesale archive |

JSON historical/proposal classification is path-based, not a finding that every decision there expired. Validity requires superseding ADRs/current source. All 41 matched historical files, 78 specs, and 28 references can be retrieved by area_id filtering; examples here do not replace full filenames.

<a id="科研功能入口与实际接线"></a>

## Research Features: Entries and Actual Wiring

| Feature/Surface | Current Static Status | Path and Gate Evidence |
|---|---|---|
| Zotero settings navigation | Hidden; old explicit entry still renders | `components/settings/SettingsPanel.tsx:60-61,80`; `SettingsDialog.tsx:43` restores old Zotero tab as MCP but retains explicit Zotero render case |
| Zotero / paper-search in MCP settings | Two built-in rows hidden; user-configured rows retained | `components/settings/agent/McpSection.tsx:62` filters those names only when isBuiltin; services not disabled |
| Onboarding Zotero connection | Research stage auto-skipped | `components/onboarding/SpotlightOverlay.tsx:96-108`; does not stop services |
| @ paper/collection/evidence-set entries and prefetch | Root categories hidden, prefetch skipped | `components/agent/at-mention-suggestion.tsx:234,274`; old reference types/main handling remain |
| Add assistant answer to evidence set | Hidden by renderer switch | `components/agent/SDKMessageRenderer.tsx:873`; general copy/feedback remain |
| Session paper list/filter/batch Zotero import | **Ordinary static right-panel entry retained** | `atoms/right-panel-tabs.ts:45-48` → `RightPanelTabBar.tsx:264-275` → `RightPanelTabContent.tsx:79-80` → `components/agent/SessionPapersPanel.tsx`. AppShell requires only a session, conversations view, panelOpen (`AppShell.tsx:62`) |
| Search-result paper-page opening | Result-triggered entry wired | `components/agent/tool-result-renderers/paper-search-result.tsx:56` upserts session-papers tab, ungated by RESEARCH_UI_ENABLED |
| Agent Zotero batch-import request | MCP→event→renderer wired | `main/lib/agent-orchestrator-mcp.ts:79-93` → `renderer/hooks/useGlobalAgentListeners.ts:900-909` activates paper tab, opens right panel, saves pending selection; beyond tool definitions |
| Research-gap comparison table | MCP/events/result component/right rendering retained | `main/lib/agent-orchestrator-mcp.ts:109-118`; `renderer/hooks/useGlobalAgentListeners.ts:648`; `RightPanelTabContent.tsx:81-88`; `components/agent/tool-result-renderers/research-gap-result.tsx` |
| Global Library / Notes | Main navigation hidden; route branches/UI remain | `components/app-shell/LeftSidebar.tsx:466-490` shows new task/project/session structure; `components/tabs/MainArea.tsx:49-75` still renders activeView library/notes. Establishes conditional routing only, not ordinary navigation accessibility |
| Citation graph | Global modal/IPC retained | `renderer/App.tsx:63,68` mounts GraphModal; `main/ipc.ts:44` registers; `preload/domains/papers.ts:342`; `components/citation-graph/useCitationGraph.ts:50-86` starts/cancels/subscribes |
| Paper/note/evidence-set/review objects and DB | Main storage/IPC retained | `main/index.ts:335-337,359-364` initializes/backfills historical evidence-set ownership; `main/ipc.ts:41`; `main/ipc/papers.ts`, `main/lib/objects/` repositories/schema/migrations |
| Zotero PDF parsing, paragraph summarization, vector index | Main startup path retained, user-gated | `main/index.ts:514-521` starts parser/generator/embedding/auto diff only with zoteroEnabled + mainWindow; subfeatures have individual checks, not all default-on |
| Live session paper watcher | Still starts in main | `main/index.ts:507-508` startSessionPapersWatcher, independent of renderer switch |
| Old demos/mock data | Source retained, not production-feature evidence | `atoms/session-evidence-atoms.ts:2,43,116-118` marked mock; `components/library/evidence-set-detail/CreateSetNoteDialog.tsx`, `AddPapersToSetDialog.tsx` retain mocks; ZoteroConnectBadge at `LeftSidebar.tsx:115` is definition/test-only, not proof of visible sidebar display |

`components/`, `atoms/`, `hooks/` are relative to `apps/electron/src/renderer/`; `main/`, `preload/` to `apps/electron/src/`.

Main IPC was not removed with renderer gates: `apps/electron/src/main/ipc.ts:32-44` unconditionally registers papers, Zotero, citation-graph domains. Preload aggregator `apps/electron/src/preload/index.ts:22-41,63-95,114-124` still exposes zotero, workspacePapers, notes, evidenceSets, reviews, papers, citationGraph, paperSearch; bridges in `preload/domains/papers.ts`, `zotero.ts`, `media.ts`, shared channels/types in `packages/shared/src/types/papers-ipc.ts`, `zotero.ts`, `citation-graph.ts`, etc. This establishes the full bridge remains, not actual invocation of every handler this round.

<a id="请求运行时科研-promptmcpagent-与技能"></a>

## Request Runtime: Research Prompts, MCP, Agents, and Skills

1. **Intent selection gates production.** `packages/shared/src/agent/runtime-policy.ts:21-34`: Chinese paper/literature/review, Zotero, specific English paper intents, scientific references, and sticky research continuation select research, enabling workspace context/subagents. Simple greetings select conversation; ordinary general/coding omit workspace context by default. Explicit Skill/MCP references in general/coding include workspace context without subagents.
2. **Host applies the gate.** `apps/electron/src/main/lib/agent-orchestrator.ts:668-696` passes scientific references/history and runs buildMcpServers only with includeWorkspaceContext; `:1076-1084` loads packs only with includeSubagents; `:1268-1304` selects reduced vs. full prompt / project settingSources / workspace plugins; `:1349-1358` seeds built-in SubAgent/Skill/MCP registries.
3. **Research packs remain distributed/loadable through research paths.** `main/index.ts:348,354,372` seeds/upgrades skills and seeds packs; `electron-builder.yml:122-130` packages defaults. `config-paths.ts:722-727` defines production/development sources; actual upgrade at `:711-720` overwrites by manifest version. Comment at `main/index.ts:370-371` saying existing assets are preserved is stale; do not infer behavior from it.
4. **All 3 research packs remain.** `apps/electron/default-capability-packs/{lit-search,lit-review,research-gap}/manifest.json:8-13` declares scenario Agents; directories retain search/citation expansion/review proposal/reader/body-writer/fact-checker/column-proposer/cell-extractor/gap-analyzer subagent prompts. `main/lib/capability-pack-loader.ts:147-155` scans/registers. JSON lists every file per pack.
5. **Large research prompts remain active for full-context paths.** `main/lib/agent-prompt-builder.ts:338,349-383` defines general Tinker identity and science specialization; `:392-408` retains Zotero import/layered paper reading, `:683-713` search MUST-ROUTE/result persistence, `:805-823` research Skill routing/mandatory review-production chains. These extend beyond historical Markdown.
6. **Ordinary loading boundaries can tighten.** Once called, `main/lib/agent-orchestrator-mcp.ts:65-129` registers papers-rg, asci-zotero, litreview, researchgap, searchplan, with session tools gated only by sessionId. `includeScientificServices` at `:207` reaches only preparePaperSearchRuntime; `main/lib/mcp/runtime-scope.ts:7` removes only paper-search for nonresearch. Explicit Skill/MCP general requests run this builder and may receive remaining research tools/full prompts; default ordinary general without references does not.
7. **Global MCP availability differs from renderer visibility.** `main/lib/mcp/global-config.ts:110-134` merges user/built-in services, fallback Zotero false, OCR true, ASR false. `main/lib/mcp/builtin-mcp-resolver.ts:57-82` uses Zotero master/subswitches; `:112-113` enables paper-search if uv exists. Final builder `:135-137` injects enabled services only; runtime-scope then removes paper-search for nonresearch. Hidden settings rows do not imply default-disabled search.
8. **Research background services remain coupled to general media.** OCR/ASR enabled currently depends on zoteroEnabled (`builtin-mcp-resolver.ts:69-82`); ZoteroSettings controls media cache/downloads. Split shared settings before migration so research-entry removal preserves general image/voice/PDF capabilities.

<a id="asci-名字的语义处置"></a>

## Semantic Treatment of the ASCI Name

| Category | Explicit Examples/Evidence | Recommendation |
|---|---|---|
| Active old product/Agent identity | `CLAUDE.md:10`, `CONTEXT.md:1-3`, `main/lib/config-paths.ts:25-38`; workspace marker written at `:973,1020` | Plan docs/identity synchronization separately, following explicit README/CLAUDE modification rules; audit does not edit opportunistically |
| User-facing research wording | `renderer/locales/en/auth/profile.json:18,21,26` and zh `:18`; `components/settings/ProfileSettings.tsx:241` uses deleteAccountDescription | Account still describes research data/local research library; review bilingually, without treating all unused locale keys as accessible UI |
| Visible compatibility-path hints | `renderer/locales/{en,zh}/auth/{conflict,errors,menu}.json` | Preserve actual path semantics; separately validate computed paths in Candidate isolation, not mere brand replacement |
| Internal compatibility contracts | `@asci/*`, ASCI_* env, MCP asci-*, `asci.db`, `~/.asci(-dev)`, `asci://` (`main/lib/auth-deeplink-parser.ts:18`), appId (`electron-builder.yml:4`) | Retention has reasons; renaming requires schema/storage/OAuth/packaging compatibility, not bulk replacement |
| Actual links/service dependencies | LoginPage `:209,216`, AboutSettings `:481-482` use ASCI policy constants; `packages/shared/src/constants/legal.ts:12-15` links OPENSCI ASCI policies; `constants/github-repo.ts:13` retains original repo | Actual wiring, not constant names alone. No external-link/content/ownership verification; changes require explicit product goals |
| Attribution/licenses/provenance | `NOTICE:1-5,8-16`, `README.md:32`, `LICENSE`, bundled skill LICENSE.txt | Preserve; do not misclassify as removable branding |
| Brand assets/packaging comments | `electron-builder.yml:132-134` packages resources/asci-logos; `:163-169` retains ASCI app/path comments | Filenames/resources remain; binary icons not visually inspected, so neither complete Tinker replacement nor universally old icons is established |
| Separate old Tauri prototype | `apps/tauri-prototype/src/main.tsx:14`, `index.html:1`, `src-tauri/tauri.conf.json:3,5` | Still ASCI technical prototype with old productName/identifier; separate workspace explicitly lacks chat/login/model/project data, distinct from production Electron/current `apps/tinker-rust` migration |

<a id="后续技术迁移边界"></a>

## Future Technical Migration Boundaries

This audit does not remove research code. Advance with regressible boundaries:

1. Fix ordinary-vs-research context-selection contracts first, preserving historical sessions/permission semantics. Rust migration centers ordinary conversation profile without incidental SQLite/research-index/user-channel-format changes.
2. Review explicit Skill/MCP general paths separately; decide whether all research tools/full prompts remain, then tighten only after concrete acceptance cases.
3. Decide whether default Papers tab, research account copy, explicit library/notes routes remain. Current hiding is incomplete, but this is product scope, not audit deletion authorization.
4. Split OCR/ASR/PDF from Zotero settings before on-demand research loading/independent packs, retaining historical-read compatibility.
5. Separate current rules, historical evidence, author attribution in docs. This user request did not authorize README/CLAUDE edits; report flags conflicts only. Migration needs independent spec/report and validation; this read-only audit is not passing-test evidence.

<a id="覆盖限制"></a>

## Coverage Limitations

Complete means all baseline tracked filenames and specified-term scans, not exhaustive natural-language meaning, transitive dependencies, or executable functionality. Excludes untracked/ignored files, real ~/.asci configuration/sessions, historical deletions, remote branches, binary contents; no real credential configuration read or actual tokens output. No network, GUI, builds, or business tests; cannot guarantee Scholar/PubMed/arXiv sources, local Zotero connection, native installations, OAuth, or research pipelines work this round. Paths/call chains establish retention/wiring; actual runtime validation awaits explicitly scoped acceptance.

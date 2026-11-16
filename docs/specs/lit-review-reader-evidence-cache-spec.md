> Historical research specification: preserves old design/data semantics and does not require new features or restored runtime wiring. Proactive research features are being wound down in batches under the [retirement specification](./2026-11-10-research-retirement.md); corresponding execution records govern completed and unaccepted scope.

<a id="综述-reader-证据集会话内持久化reader-evidence-context-cache设计规格"></a>

# Session-Local Persistence of Review Reader Evidence Sets (Reader Evidence `.context` Cache) Design Specification

- Status: draft (awaiting review)
- Related issue: (to be created)
- Related PR: (to be created)
- Domain language source of truth: `CONTEXT.md` (EvidenceSet / reader / wiki corpus)
- Related spec: `docs/specs/lit-review-evidence-enrichment-spec.md` (coverage/library expansion, orthogonal)

<a id="context为什么做"></a>

## Context (Why)

The review pipeline's `reader` fan-out is **its most expensive step**: assign one reader per deep-readable paper, resolve its wiki source
(`zotero_wiki_lookup`) → outline-first deep reading (`papers_read_outline` + multiple `papers_read_article_section` calls)
→ produce evidence rows (`{ claim, source_id, locator, quote, confidence, status:read, bucket }`).

**Problem (the sole user-identified pain point)**: reader output **exists only in the main agent's single-turn conversation context**
(`lit-review/scenario/system-prompt.md:80-82`: the main agent passes "**all** evidenceRows[] returned by readers" as inline
arguments to the terminal skill). **One context compaction pushes those rows out**; the only fallback then is **redispatching readers to
reread entire papers**, extending review duration substantially (trace evidence: compaction after 18 readers completed required grepping a 1.7MB transcript to reconstruct results,
otherwise 11 full texts would need rereading).

**Goal**: persist each paper's reader evidence set in **`.context/` under the session directory**. After compaction, avoid rereading originals by
reading extracted evidence directly from `.context/`. **Solve only compaction→rereading→slowness, without cross-session/workspace reuse**
(review emphases differ; cross-review reuse has low value and risks topic mismatch, so is explicitly excluded).

<a id="范围边界明确不做"></a>

## Scope Boundaries (Explicit Exclusions)

- ❌ Cross-session / cross-workspace reuse. Cache follows its session directory and is archived/cleaned with it, never entering global wiki storage.
- ❌ Topic relevance or cross-direction evidence filtering. Same session = same review = same topic; wholesale reuse is naturally appropriate without judgment.
- ❌ Cross-run merging / deduplication. Each reader writes only its own paper, once (decision 2).
- ❌ Main-process / orchestrator / IPC changes (MVP). Everything stays in capability-pack + skill prompts (decision 3).

<a id="关键事实代码核实写方案的前提"></a>

## Key Facts (Code-Verified Premises)

| Fact | Source |
|------|------|
| Reader dispatch includes `{ N, title, zoteroKey \| doi, abstract? }`; evidence-row `source_id` = zoteroKey (else doi) | `reader.md:56`, `system-prompt.md:74-78` |
| Readers already have `Write`; their core deliverable is structured evidence rows (dumping them to a file is a small addition) | `reader.md`, capability-pack tool grants |
| Terminal skill `literature-review-result` already has `Write`, writing `reviews/*.html` to **session cwd**, which is the file-panel root | `SKILL.md:225-231` |
| Session cwd = `~/.asci/agent-workspaces/{slug}/{sessionId}/` (isolated by sessionId, exactly session-local) | `config-paths.ts:874-894` |
| **Precedent**: skill writes reviews/ with Write, orchestrator scans `reviews/` after the run and persists them (`persistReviewsFromSessionCwd`); writing cwd + later scanning is established | `agent-orchestrator.ts:2324-2378`, `review-cwd-scanner.ts:46-108` |
| Orchestrator has **no subagent-completion hook**: reader output returns to the parent inside Task tool results, inaccessible to main; automatic persistence is expensive and excluded | `agent-orchestrator.ts:1895-2199` |
| papers-rg (in-process MCP) currently knows only global `wikiDir`, not session cwd; injection requires changing `HandlerDeps` (one line, not four-layer synchronization) | `papers-rg-tool.ts:132-141`, `agent-orchestrator.ts:709-711` |
| The quote rule "one continuous passage, no `…` bridging" is currently prompt-only, without runtime validation (readers violated it in traces) | `agent-prompt-builder.ts` QUOTE_RULE_LITREVIEW; trace |

<a id="锁定的设计决策"></a>

## Locked Design Decisions

<a id="1-位置-&#45;会话-cwd-下的-context按派发身份命名"></a>

### 1. Location = `.context/` Under Session cwd, Named by Dispatch Identity

```
{session_cwd}/.context/{zoteroKey | doi-sanitized | N{index}}.evidence.json
```

- Write relative to cwd using existing reader `Write` (`Write(".context/ABC123.evidence.json", ...)`).
- Filename uses **dispatch identity** (`zoteroKey` available immediately, otherwise sanitized `doi`, otherwise `N{citationIndex}`)—
  no `zotero_wiki_lookup` to resolve attachmentKey before naming/lookup, keeping cache hits cheap. If `attachmentKey` is known,
  include it in file content for locator matching.
- Not global wiki storage, which would serve explicitly excluded cross-session reuse; session-local storage follows the review lifecycle and can be cleaned with the session.

<a id="2-一论文一份-jsonreader-只写一次无合并去重"></a>

### 2. One JSON per Paper; Reader **Writes Once** (No Merging/Deduplication)

Each session-local reader handles one paper, runs once, writes one file → distinct files, no write contention or merging/deduplication. Structure:

```jsonc
{
  "schemaVersion": 1,
  "N": 5,                              // 派发时的引用序号，回填 citation index
  "source_id": "E93C9ILE",            // = zoteroKey（else doi），body-writer 据此映射 N
  "zoteroKey": "E93C9ILE",
  "doi": "",
  "attachmentKey": "MM69RESN",        // 若 wiki_lookup 已解析；供 locator 对照
  "title": "Training language models to follow instructions ...",
  "bucket": "deep-read",              // deep-read | abstract-only | insufficient
  "createdAt": "2026-06-10T17:48:00+08:00",   // dayjs nowIso（@asci/shared）
  "rows": [
    {
      "claim": "对齐训练的计算成本仅为预训练的一小部分",
      "source_id": "E93C9ILE",
      "url": "",
      "source_type": "paper",
      "locator": "MM69RESN:p6_1#1",
      "quote": "The cost of increasing model alignment is modest relative to pretraining",
      "confidence": "high",
      "status": "read",
      "bucket": "deep-read"
    }
  ]
}
```

`rows[]` contains precisely the evidence rows readers already return, persisted unchanged with the same schema as inline results.

<a id="3-写读机制-&#45;纯提示层mvp不碰主进程"></a>

### 3. Write/Read Mechanism = Prompts Only (MVP), No Main-Process Changes

- **Write (reader)**: after deep reading and finalizing evidence rows, **first `Write` to `.context/{key}.evidence.json`**,
  then return rows to the parent as a summary, as today. Persistence adds one Write step with the same schema as returned content.
- **Read (terminal skill)**: extend `literature-review-result` input contract—**when inline `evidenceRows[]` is missing/incomplete,
  use `Glob(".context/*.evidence.json")` + `Read` to reconstruct `evidenceRows[]` from all papers** (place rows by file `N` / `source_id`
  values). The skill already writes `reviews/` in the same cwd; reading `.context/` is a same-directory operation.
- Add `Glob` to skill allowed-tools (currently only `Write papers_search_keywords papers_read_context
  workspace_papers_list`）。

> Choose (c) prompts rather than (b) new MCP tools: one write/read per paper per session, without mandatory merging/validation, is covered by Write/Glob/Read; **zero main-process
> changes, zero IPC, zero packaging risk**, entirely in capability-pack + skill Markdown, matching the reviews persistence precedent.
> Reserve new MCP tools (sessionCwd injection + strict write validation) for Phase 2 robustness (see Open Questions).

<a id="4-压缩后的两条复用路径都在提示层"></a>

### 4. Two Post-Compaction Reuse Paths (Both Prompt-Level)

Once `.context/` is persisted, if compaction loses inline evidence:

1. **Terminal skill reconstructs directly** (primary): no inline rows received → read all rows from `.context/` →
   synthesize §1–§8 normally. **No reader redispatch or original-text rereading.**
2. **Skip cached papers during Turn-2 replanning** (fallback): if main replans Turn-2 dispatch after compaction, the scenario instructs:
   "Before dispatching a reader, check `.context/{key}.evidence.json`; skip that reader if present." Even if redispatched, reader
   Step 0 (decision 5) hits its own cache and returns instantly.

<a id="5-reader-流程改造step-0-查会话缓存-&#45;结束前落盘"></a>

### 5. Reader Flow: Step 0 Session Cache Lookup + Persistence Before Completion

Add two parts to reader.md:

```
0. Check session cache before zotero_wiki_lookup:
   Try Read(".context/{zoteroKey|doi|N}.evidence.json")
   - Hit → return file rows directly, skip wiki_lookup and all deep reading. Finish.
   - Miss → continue normal flow.

N. Persist after deep reading/rows finalized, before returning to parent:
   Write(".context/{key}.evidence.json", { meta..., rows })
```

Main-agent Turn-2 dispatch and body-writer inline contracts **remain compatible** (inline still accepted; missing inline falls back to disk).
Only reader internals + skill fallback reading change.

<a id="6-新鲜度会话内极简"></a>

### 6. Freshness: Minimal Within a Session

Wiki sources rarely change mid-session → **file existence means valid**, without fingerprints/version checks (cross-session overhead, already excluded).
The only edge case: a PDF finishes parsing mid-review after `abstract-only` was cached. MVP accepts this rare case as `abstract-only`,
matching normal uncompacted behavior without degradation; do not add rechecking logic for it.

<a id="7-可选正交quote-连续性校验"></a>

### 7. (Optional, Orthogonal) Quote Continuity Validation

Persistence is a good hook for runtime quote validation, but orthogonal to this pain point. MVP **excludes it**; if Phase 2 uses MCP `papers_evidence_put`,
validate continuous passages at write time with `papers_read_context` and locator byteOffset, marking failures `verified:false`. This spec records the extension point only.

<a id="落点文件"></a>

## Files

- `apps/electron/default-capability-packs/lit-review/sub-agents/reader.md`: add Step 0 (check `.context/`) + before completion,
  `Write` to disk; specify **`.context/` in session cwd**, dispatch-identity naming, session-local only.
- `apps/electron/default-capability-packs/lit-review/scenario/system-prompt.md`: add to Turn-2 dispatch "before reader
  dispatch check `.context/` and skip cached papers"; terminal_skill input says "skill reconstructs from `.context/` when inline is missing."
- `apps/electron/default-skills/literature-review-result/SKILL.md`: extend input contract: "when inline `evidenceRows[]` is missing/incomplete,
  reconstruct with `Glob(".context/*.evidence.json")`"; add `Glob` to allowed-tools.
- (Optional Phase 2) `papers-rg-tool.ts` + `agent-orchestrator.ts:709`: inject `sessionCwd`, add
  `papers_evidence_get/put` tools + strict write validation.
- Versions: MVP changes only capability-pack / skill Markdown (no code packages); increment affected package patches when opening a PR per convention;
  Phase 2 changes to `apps/electron` source require that package patch +1.

<a id="分阶段"></a>

## Phases

- **Phase 1 (MVP)**: reader Write persistence + Step 0 disk lookup + skill `.context/` fallback reads + scenario skip instructions.
  Prompts only, zero main-process/IPC/packaging changes. **Directly removes compaction→full-text rereading.**
- **Phase 2 (Optional Robustness)**: replace Write/Glob conventions with in-process MCP `papers_evidence_get/put` (inject
  sessionCwd into papers-rg), gaining schema-based writes + strict quote validation and reducing dependence on weaker readers hand-writing JSON.

<a id="验证"></a>

## Validation

1. `bun run typecheck` / `bun test` (preserve capability-pack-loader / skill guard tests).
   - Reminder (see memory): run `bun install` before changing `@asci/*` within a worktree; run `bun test` from repository root.
2. **Persistence golden path**: start a review → after each reader, `.context/{key}.evidence.json` exists with correct rows schema,
   and `N`/`source_id` support reconstruction.
3. **Compaction reconstruction (core scenario)**: simulate/create loss of inline evidence after readers finish (context compaction) → terminal skill
   reads all rows from `.context/`, review completes, with **no repeated `papers_read_outline`/`papers_read_article_section`/
   `Read(mdPath)` calls** (assert no rereading and no review-quality loss).
4. **Reader Step 0 hit**: redispatch reader for the same paper/session (or replan) → instant `.context/` hit, skipping wiki_lookup
   and deep reading.
5. **Compatibility regression**: without compaction, inline still works; when skill receives both inline and `.context/`, prefer inline,
   without double-counting.
6. **Abstract-only edge**: cache `abstract-only` before PDF parsing → reconstruction handles abstract-only, matching normal runs.

<a id="收益对照对应-trace-暴露的问题"></a>

## Benefits Compared with Trace Problems

| Trace problem | This session-local approach |
|------------|------------------|
| Compaction loses evidence rows; only transcript grep or full-text rereading remains | Reader persists `.context/`; skill reconstructs from disk when inline is missing, **without rereading originals** |
| Redispatched readers reread full text and extend review duration | Step 0 returns instantly from session cache; skill reads disk directly, avoiding outline+section calls |
| (Orthogonal) reader quote `…` bridging unvalidated | Phase 2 MCP put validates on write; MVP excludes it |

<a id="未决"></a>

## Open Questions

1. **Write mechanism (c) prompts vs (b) MCP tools**: MVP chooses (c) (zero main-process changes). If handwritten reader JSON proves unstable or write-time
   quote validation is wanted, upgrade to (b). User confirmation needed on prompt-first MVP acceptability.
2. **Retire inline entirely?** The skill could **always** read `.context/`, removing inline and the old problem of 14KB inline arguments bloating
   prompts. Prefer validating dual paths (inline first, `.context/` fallback) before deciding on disk-only reading.

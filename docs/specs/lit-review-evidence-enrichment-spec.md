> Historical research specification: preserves earlier designs and data semantics; it does not require new features or restoration of runtime wiring. Active research features are being retired in batches under the [retirement specification](./2026-11-10-research-retirement.md); corresponding execution records define actual completion and unaccepted scope.

<a id="综述证据集语义补全lit-review-evidence-enrichment设计规格"></a>

# Literature Review Evidence Enrichment Design Specification

- Status: draft (pending review)
- Related issue: (to be created)
- Related PR: (to be created)
- Domain language source of truth: `CONTEXT.md` (EvidenceSet / hybrid search / semantic search)

<a id="context为什么做"></a>

## Context (Why)

Literature review (lit-review) currently writes against a **fixed EvidenceSet**: users curate source papers upstream (through lit-search) or @mention them.
The review stage **deliberately prohibits library expansion** (scenario prompt “No ad-hoc retrieval” + R2 + Turn-2 `do_not`).
This boundary is intentional: discovery=lit-search, writing=lit-review; the 30-second UX in which “direction matters more than wording” depends on a fixed collection.

**Problem**: evaluation identifies **coverage/completeness** as the review's largest weakness. Users' libraries often contain relevant papers **already owned but absent from the evidence set**, yet no step retrieves them through **local hybrid search (`papers_semantic_search`)**. lit-search uses `paper-search` (**external** discovery), while local hybrid search currently serves only open-ended Q&A. This leaves a gap.

**Goal**: before writing a review, use local hybrid search to find papers/paragraphs relevant to its topic but absent from the evidence set among **papers already owned in the current workspace**. Present them **as suggestions** and incorporate them after confirmation, producing a more complete evidence set while preserving the principle that reviews never silently expand the library.

<a id="锁定的设计决策已与用户确认"></a>

## Locked Design Decisions (Confirmed with the User)

1. **Incorporation = advisory, pending confirmation**: after semantic search produces candidates, list “Suggested additions: N papers/paragraphs”; **incorporate only after user confirmation**, never silently or automatically (search precision is below 100%, English P@5≈0.8 and lower for Chinese; silent incorporation would contaminate the review).
2. **Search scope = current workspace**: filter `papers_semantic_search` with `attachmentKeys` to papers already referenced in this review's workspace, keeping focus and avoiding unrelated library-wide noise.
3. **Integration point = review Turn 1 (direction selection)**, rather than Turn 2: preserve Turn 2's strict “no retrieval” rule; enrichment happens only before writing.
4. **Cross-language**: for Chinese topics, **rewrite the enrichment query in English** (also for approach A); otherwise most additions are noise.
5. **Traceability + equal validation**: enriched evidence retains snapshotText anchors and passes `fact-checker`, with no exemption for being automatically retrieved.

<a id="边界放宽需在-scenario-prompt-显式改"></a>

## Boundary Relaxation (Must Be Explicit in the Scenario Prompt)

Existing R2 / “No ad-hoc retrieval” / Turn-2 `do_not` in `lit-review/scenario/system-prompt.md` prohibit expansion in three places.
This feature **relaxes only one kind of Turn 1 expansion**: local library (not external paper-search), within the workspace, with user confirmation.
Explicitly retain: ① absolutely no Turn 2 retrieval; ② external discovery through `mcp__paper-search__search_papers` remains forbidden; ③ no silent incorporation.

<a id="实现取舍待定本-spec-的核心未决点"></a>

## Implementation Tradeoff (Undecided, This Spec's Core Open Question)

The Agent currently **cannot add papers to an EvidenceSet programmatically**: adding to evidence sets is a UI action (`AddToEvidenceSetButton` + existing IPC, `notes-service.addPaperToEvidenceSet` / `evidence-conversation-service`). Two approaches to incorporation after confirmation:

- **Approach A (reuse existing UI)**: list candidate paperIds and matching paragraphs in Turn 1 ChoiceCard / conversation; users select them through the existing “Add to evidence set” UI, then continue Turn 2. Small changes, no new agent write permissions; interaction takes two steps (read suggestions → add manually).
- **Approach B (new agent tool)**: add an in-process MCP tool `evidence_set_add_papers` (confirmation-gated), called by the Agent after user confirmation to incorporate directly. Smooth, single-step interaction; it grants the agent EvidenceSet write capability and requires careful gating (only after confirmation, only within the workspace, record provenance).

> Preference: implement **approach A** first (MVP, zero new write permissions, mature UI reuse), validate its value, then assess approach B's interaction benefits.

<a id="落点文件"></a>

## Locations (Files)

- `apps/electron/default-capability-packs/lit-review/manifest.json`: grant `mcp__papers-rg__papers_semantic_search` to the scenario or a new `evidence-broadener` subagent (available only in vector/both modes, naturally gated by the three-mode switch).
- `lit-review/scenario/system-prompt.md`: add a “confirmed workspace semantic enrichment” step to Turn 1 and narrowly relax R2 wording.
- (Approach B only) add `evidence_set_add_papers` in `apps/electron/src/main/mcp/`, reuse `notes-service.addPaperToEvidenceSet`, and inject through `agent-orchestrator`.
- Reuse: `semanticSearchPapers` (`zotero-embedding-index/index.ts`), `papers_semantic_search` (`papers-rg-tool.ts`), and evidence-set writes in `notes-service` / `evidence-conversation-service`.

<a id="分阶段"></a>

## Phases

- **Phase 1 (approach A, MVP)**: grant the scenario tool access and add the Turn 1 enrichment step (English query, workspace filtering, suggestions); users incorporate through existing UI. Changes remain within the capability pack, with zero new native/IPC work.
- **Phase 2 (approach B, optional)**: add confirmation-gated `evidence_set_add_papers` for single-step incorporation.
- **Evaluation**: use `rag-review-eval-playbook.md` to compare coverage for the same review topic with enrichment enabled vs disabled (judge evaluation).

<a id="验证"></a>

## Verification

1. `bun run typecheck` / `bun test` (pack changes must preserve capability-pack-loader tests).
2. Manual golden path: place several relevant papers in the library but outside the evidence set → start a review → Turn 1 lists suggested additions → confirm incorporation → Turn 2 actually includes those papers with traceable citations.
3. Boundary regression: switch retrieval to keyword-only (papers-rg) → enrichment does not run (tool unregistered); Turn 2 still never retrieves.
4. Cross-language: Chinese topic → confirm enrichment queries are rewritten in English and candidates are relevant.

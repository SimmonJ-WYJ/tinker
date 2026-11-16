<a id="adr-013文献检索数据服务-部分自建分层元数据自建-&#45;oa-全文复用-&#45;软件差异化"></a>

# ADR-013: Literature Retrieval Data Service — Partial In-house Layers (Self-hosted Metadata + Reused OA Full Text + Software Differentiation)

| Field | Content |
|------|------|
| **Status** | Proposed (grill-with-docs + 2 deep-research rounds adjudicated 2026-06-02, awaiting product/engineering Lead sign-off) |
| **Decision date** | 2026-06-02 |
| **Decision maker** | (Pending; product/engineering Lead recommended) |
| **Author** | (Pending) |
| **Decision deadline** | Before opening 0.5 literature-data-service implementation issues; **this ADR extends [ADR-002](./ADR-002-server-stack.md) server stack with retrieval workload; ADR-002 must update simultaneously** |
| **Related** | [0.5 north-star](../milestones/0.5/north-star.md) · [ADR-001 Local-first](./ADR-001-local-storage.md) · [ADR-002 Server Stack](./ADR-002-server-stack.md) (extension needed) · [0.3 Three-way Data Separation Red Line](../specs/0.3.0/0.3.0-prd.md) · [0.2 moat-analysis](../milestones/0.2/moat-analysis.md) · [CONTEXT.md Literature Retrieval Data Service Domain](../../CONTEXT.md) · Two deep-research rounds (tasks `ww7kiwqdq` / `wznt3zt3n`, 2026-06-02) |

---

<a id="一背景"></a>

## I. Background

**Current state**: ASCI literature retrieval is a local MCP (`paper-search-mcp`) on user machines, **fanning out live** to 15+ external open APIs (OpenAlex/Crossref/Semantic Scholar/arXiv/PubMed…), with **no self-hosted index or cache**. Measurements show whole primary-source failures, query counts swinging between 0↔45 for similar queries, and slow, poor-quality fallback sources (now disabled by default; see `lit-search-failure-source-expansion-spec.md`).

**Three real pain points** (product/engineering retrospective): ① **Incomplete** retrieval (coverage gaps; professionals cannot find what they need); ② **Inaccurate** retrieval (poor relevance); ③ **Slow close reading** of PDFs (fetch → parse → RAG per paper, taking minutes).

**Trigger**: Product/engineering proposed (English translation), "Plan an in-house literature library / invest in data assets, otherwise we are a shell company in the AI era." grill-with-docs narrowed this to a directional hypothesis, validated with external evidence through 2 deep-research rounds (212 agents, 48 sources, adversarial verification).

**Why an ADR**: This extends ASCI from "pure local-first (ADR-001) + servers only for auth/telemetry (ADR-002)" to **local-first + server-side literature data service**. It is hard to reverse; future readers will ask why local-first shifted toward server corpora; and it reflects real tradeoffs among alternatives. All three criteria warrant an ADR.

<a id="二决策维度"></a>

## II. Decision Dimensions

1. **Which layers to build**: Metadata only / +full text / +complete semantic vectors?
2. **Where retrieval/reranking compute runs**: ASCI servers (ASCI pays) vs user BYOK (user pays)?
3. **Monetization**: Must freemium be introduced?

<a id="三候选方案"></a>

## III. Alternatives

| | A Pure fan-out (current) | B Fully in-house, asset-heavy | C Partial in-house layers (**selected**) |
|---|---|---|---|
| Metadata | Live API calls | Complete self-hosted index | ✅ Complete self-hosted index (OpenAlex) |
| Full text | Fetch/parse on demand | Fully self-hosted | ✅ Cache only **OA subsets legally redistributable**, fetch/link the rest on demand |
| Semantic vectors | None | Complete embedding (200 million+) | ❌ No full embedding (uneconomical) |
| Retrieval/reranking compute | User BYOK | All server-side (ASCI pays) | ✅ User BYOK by default (zero ASCI per-query inference cost) |
| Monetization | — | Costs **force** freemium | Freemium **optional** (credibility repair must remain free) |
| Three pain points | ❌ Solves none | ✅ Solves at uncontrolled cost | ✅ Solves with bounded cost/compliance |
| Feasibility for 4 people | — | ❌ Cannot sustain full vectors + server compute | ✅ Low metadata barrier, reused text, BYOK compute |

**Why B was rejected (mid-grill conclusion overturned by evidence)**: ① Embedding 200 million+ documents is RAM-bound with freshness pipelines, uneconomical for 4 people; ② Most raw full text **cannot legally be redistributed** (licensing red lines below); ③ All-server compute reverses BYOK's zero-inference-cost model, making every search ASCI's bill and **forcing freemium through costs**, risking a credibility-repair paywall that drives users away before conversion.

<a id="四决策"></a>

## IV. Decision

**Adopt C: Partial in-house layers.**

```
Self-build/self-host (ASCI servers · bounded costs · clear compliance)
  · Complete OpenAlex metadata index (long-tail coverage; free quarterly snapshots)
  · Legally redistributable preprocessed full text (foundation for instant close reading)
Reuse (do not develop in-house)
  · Scientific PDF parsing: MinerU / olmOCR (SOTA, open source; olmOCR ~$176/million pages)
Fetch on demand + external links (no cached redistribution; licensing red lines)
  · arXiv (individual fetch + backlink), non-OA, CC-NC / CC-ND papers
Differentiated software (user BYOK · zero ASCI per-query inference cost) ← Actual moat
  · Agentic iterative retrieval + hybrid(BM25⊕dense) recall + LLM reranking + full-text RAG
Excluded: Complete semantic vector embedding
Monetization: Optional freemium business decision (credibility repair stays free), not cost-forced
```

English rendering of the preserved conceptual diagram: Self-build/self-host on ASCI servers with bounded costs and clear compliance: full OpenAlex metadata index (long-tail coverage; free snapshots quarterly), legally redistributable preprocessed full-text corpus for instant close reading. Reuse scientific PDF parsers MinerU / olmOCR (SOTA, open source; olmOCR ~$176/million pages). Fetch/link arXiv, non-OA, CC-NC/CC-ND papers on demand without cached redistribution. Differentiate in software on user BYOK, with zero ASCI per-query inference: agentic iterative search + hybrid BM25⊕dense recall + LLM reranking + full-text RAG. Do not embed all semantic vectors. Freemium is optional business policy, with credibility repair free, never cost-forced.

<a id="许可红线一手原文落地硬约束"></a>

### Licensing Red Lines (Primary-source Wording, Hard Implementation Constraints)

| Source | Cache + persist + **redistribute** commercially? | Usage |
|---|---|---|
| peS2o / S2ORC bulk (ODC-By) | ✅ Yes (attribution required) | Core preprocessed full-text corpus (~8.24 million full texts) |
| PMC `oa_comm` (CC0/CC-BY) | ✅ Yes (**XML/plain text only, not PDFs**; filter ND/SA) | Biomedical full text via official bulk channel (FTP retires 2026-08 for Cloud Service; recheck then) |
| Semantic Scholar **live API data** | ❌ Contract prohibits redistribution | Transient use without persistence; use ODC-By bulk for persistence |
| arXiv full text | ❌ Default license prohibits third-party redistribution | **Fetch individually + link back to arXiv; no cached corpus** (particularly CS/physics/ML) |
| Non-OA / CC-NC / CC-ND | ❌ | On-demand fetching + external links, no persistence |

> ⚠️ **Per-work upstream copyright risk**: ODC-By/bucket-level commercial permission covers databases/compilations, **not freedom from per-work restrictions (including NC/ND)**. Commercial full-text RAG (chunking/re-embedding/derivatives) must **retain and honor per-paper license metadata**; obtain legal confirmation before implementation, including Europe PMC as an EU-node PDF source.

<a id="gdpr可控有现成模板"></a>

### GDPR (Manageable, Existing Templates)

Paper metadata containing author names/emails is personal data (public availability is no exemption). However, **EU DSM Directive Art.4 TDM exception applies to commercial entities** unless rights holders opt out in machine-readable form. EDPB Opinion 28/2024 checklist: honor robots.txt/ai.txt, exclude sensitive sources, controller maintains opt-out lists, pseudonymize author emails. **Key distinction**: TDM governs permission to mine, **not redistribution**, which remains subject to corpus licenses.

<a id="五反转与印证"></a>

## V. Reversals and Confirmation

- **Reversal** of mid-grill conclusion: It briefly favored no corpus in the relevance layer + full-text fan-out + all-server compute + mandatory freemium. Evidence corrected this to: **build metadata** (low barrier), **cache legally redistributable OA full text** (pure fan-out causes slow reading), **no full vectors**, **BYOK compute**, **optional freemium**.
- **Confirmation** of [0.2 moat-analysis](../milestones/0.2/moat-analysis.md): Defensible moat = **workflow embedding + data flywheel + software quality**, **not hoarding raw papers** (anyone can download OpenAlex). Elicit, a well-funded leader, demonstrates the same route: aggregator APIs (~138 million deduplicated), no self-built full-text corpus, and only OA/user-provided subscriptions for full text. A four-person team reusing aggregators with software differentiation follows a leader-validated path.

<a id="六后果"></a>

## VI. Consequences

- **Extend ADR-002**: Servers gain retrieval workload (metadata index + OA full-text cache) beyond auth/telemetry. ADR-002 must decide index engine (ES/OpenSearch/Typesense), storage, and freshness pipeline (free OpenAlex snapshots quarterly; monthly/daily changes paid).
- **Preserve BYOK / local-first identity**: Default retrieval/reranking uses user keys; ASCI server cost stays bounded to index/corpus hosting, no per-query inference fees.
- **0.6 query flywheel + privacy red line**: Query/click/adoption signals compound relevance via 0.6 opt-in; conflicts with 0.3's "behavior telemetry never includes research content" (queries may be research content), requiring revised boundaries + opt-in + disclosure; outside 0.5.
- **Two prerequisite spikes** (before implementation; not publicly available, not directional blockers): ① Actual monthly cost across three tiers / engineering person-months (internal infrastructure spike); ② Hard evaluation of agentic end-to-end search/reranking improvement (small in-house dataset quantifying professional defensibility; current evidence only isolates reranking: CoRank nDCG@10 50.6→55.5 across 5 academic retrieval sets).
- **Engineering constraints**: arXiv fetched individually with backlinks, no cache; PMC official bulk, commercial XML/plain text only, per-paper licenses.
- **Risks**: ① Per-work upstream copyright (legal review); ② OpenAlex live scale exceeds 470 million (2026-02 Walden rewrite), so storage/index estimates must increase from snapshot-labeled 330GB/1.6TB; ③ Accumulated scope (large 0.4 followed immediately by 0.5, team of 4).

<a id="七后续动作"></a>

## VII. Follow-up Actions

- [ ] Product/engineering Lead sign-off (Proposed → Accepted)
- [ ] Revise ADR-002 simultaneously (retrieval workload stack/cost/freshness)
- [ ] Stage 1 two spikes: Cost accounting + agentic retrieval dataset
- [ ] Legal confirmation of per-paper upstream-license filtering + Europe PMC PDF-source boundaries
- [ ] 0.5 north-star → to-issues, split tracer-bullet vertical slices by pillar

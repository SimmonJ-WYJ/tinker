<a id="adr-014无-api-源接入-&#45;需求驱动语料填充-gs-类源-user-local-抓取-&#45;oa-解析按需懒填扩展-adr-013"></a>

# ADR-014: Non-API Sources + Demand-Driven Corpus Fill (GS-Style User-Local Fetching + On-Demand OA Parsing; Extends ADR-013)

| Field | Content |
|------|------|
| **Status** | Proposed (decision pending; grill-with-docs session adjudicated 2026-06-03, awaiting product/engineering Lead signature) |
| **Decision date** | 2026-06-03 |
| **Decision maker** | (TBD; product/engineering Lead recommended) |
| **Author** | (TBD) |
| **Hard decision deadline** | Before creating 0.5 literature-data-service implementation issues; **extends [ADR-013](./ADR-013-literature-relevance-service.md)** (adds two dimensions atop its partially self-built layers), inheriting ADR-013's extension constraints on [ADR-002](./ADR-002-server-stack.md) |
| **Related** | [ADR-013 Literature Search Data Service](./ADR-013-literature-relevance-service.md) (extended here) · [0.5 north-star](../milestones/0.5/north-star.md) · [ADR-001 Local First](./ADR-001-local-storage.md) · [ADR-002 Server Stack](./ADR-002-server-stack.md) · [0.3 Three Data Boundaries](../specs/0.3.0/0.3.0-prd.md) · [Failure-Triggered Source Expansion Spec](../specs/lit-search-failure-source-expansion-spec.md) (§4.2 GS blacklist) · [CONTEXT.md Literature Search Data Service Domain](../../CONTEXT.md) |

---

<a id="一背景"></a>

## 1. Background

[ADR-013](./ADR-013-literature-relevance-service.md) selected **partially self-built layers** for literature search data services (self-built OpenAlex metadata index + reusable legally redistributable OA full text + BYOK agentic search/reranking + no full-corpus vectors). This ADR **preserves that direction**, addressing two newly raised dimensions absent from ADR-013:

1. **Non-API sources**: The 8 normalized sources currently covered by literature search (arxiv/pubmed/openalex/semanticscholar/crossref/dblp/biorxiv/europepmc/core/ieee…; see `packages/shared/src/utils/paper-source.ts`) **all provide APIs**. Paper sources extend far beyond these: platforms **without APIs** (Google Scholar as benchmark, plus ResearchGate / CNKI / Wanfang / publisher pages) cover long-tail material missing from OpenAlex (gray literature, citation discovery, non-English work, dissertations, some non-OA). Access could greatly improve search coverage.
2. **Demand-driven corpus fill**: ADR-013 ingests OA full text **in batches** (peS2o/S2ORC/PMC, eager). The meeting proposed that parsed data from papers users download/read closely should **accumulate server-side for reuse by other platform users**, improving review/close-reading efficiency.

**Two factual tensions triggered** (to resolve here):

- GS is a **blacklisted dead source** in [Failure-Triggered Source Expansion Spec](../specs/lit-search-failure-source-expansion-spec.md) §4.2 (measured slow/fragile fetching and IP blocking). Ambition for major improvement must align with that reality through **where fetching runs + measuring availability first**, rather than blindly restoring server fan-out.
- Returning user-touched paper parses to the server directly conflicts with ADR-013's two boundaries: ① **Licensing** (sharing non-OA full text with others is redistribution); ② **Privacy** (papers read reveal research direction, conflicting with 0.3's prohibition on research content in behavioral telemetry; ADR-013 deferred the query flywheel to 0.6 for this reason).

**Why an ADR (all three criteria met)**: ① **Hard to reverse**: Legal posture for non-API fetching, contribution pipelines, and privacy boundaries become difficult to retract after launch. ② **Counterintuitive**: This both revives blacklisted GS and lets user activity drive server corpus growth; future readers will ask why. ③ **Real tradeoffs**: Fetch location, sharing scope, contribution model, and timing each have multiple viable alternatives.

---

<a id="二决策维度"></a>

## 2. Decision Dimensions

| # | Dimension | Tension Resolved |
|---|------|-----------|
| D1 | Non-API source **integration layer** (live fetching + external links vs. Corpus ingestion) | Licensing boundary |
| D2 | Non-API source **fetch location** (user-local / third-party SERP API / ASCI server) | BYOK/local-first identity, cost, law |
| D3 | Non-API source **scope and timing** (GS-only observation vs. entire class vs. full deferral) | Four-person scope risk, anti-bot fragility, evidence first |
| D4 | **What to share across users** from contributions (license tiers / everything / only noncopyright assets) | Licensing boundary |
| D5 | **Contribution model** (signal-driven server retrieval vs. client copy upload) | Poisoning, copyright redistribution, privacy |
| D6 | **Privacy posture and timing** (opt-in in 0.5 / defer to 0.6 / default on) | 0.3 privacy boundary |

---

<a id="三决策"></a>

## 3. Decisions

> Decisions below were adjudicated dimension by dimension in the grill-with-docs session (2026-06-03), awaiting signature.

<a id="d1-&#45;无-api-源-&#45;实时现抓-&#45;外链永不落-corpus"></a>

### D1 — Non-API Sources = Live Fetching + External Links, **Never Stored in Corpus**

GS-style source ToS prohibit scraping, and much full text is non-OA / cannot be cached and redistributed. Position this as an **extension** of ADR-013's on-demand fetch + external-link-without-storage layer: fetch results live, return source links, **never add to corpus cache**. This aligns with ADR-013's licensing boundary without a new compliance surface.

<a id="d2-&#45;抓取默认跑用户本地-&#45;用户自配第三方-serp-api-keybyok兑底asci-服务端永不自抓"></a>

### D2 — Fetching **Defaults to User-Local + User-Configured Third-Party SERP API Key (BYOK) Fallback; ASCI Servers Never Scrape Directly**

| Alternative | Choice | Reason |
|---|---|---|
| **User-local fetching** (headless / user's IP/session) | ✅ Default | Distributes IP-block risk to users; zero ASCI cost/legal risk; fits ADR-001 local-first + BYOK identity |
| **Third-party SERP API (SerpApi, etc.)** | ✅ Fallback (**user-provided key**) | Reliable fallback, still BYOK: users pay, ASCI does not subsidize; zero per-query cost |
| **ASCI server scraping** | ❌ Rejected | ASCI IPs quickly blocked; concentrates legal/cost/maintenance burden; reverses ADR-013's zero-cost BYOK model and conflicts most with local-first identity |

<a id="d3-&#45;05-只做本地抓取机制-&#45;gs-单标杆源定位观察档先-spike-量化可用率过阈再扩"></a>

### D3 — 0.5 Implements Only **Local Fetching Mechanism + GS Benchmark Source**, in **Observation Mode**; Measure Availability in a Spike Before Expansion

- 0.5: Implement user-local fetching + **GS as the single benchmark source**; first run a small **spike** measuring actual **availability / latency / CAPTCHA rate / block rate** under anti-bot defenses.
- Expand to ResearchGate / CNKI / Wanfang / publisher pages in **0.6/V1**, **gated by 0.5 spike results** (expand only above threshold).
- Reason: GS is currently a fragile blacklisted dead source; a four-person team immediately following the large 0.4 release faces high scope risk. Gather actual availability evidence before promising expansion, consistent with evidence-before-commitment discipline.

<a id="d4-&#45;回流按-license-分层共享仅可再分发-oa-解析进服务端共享非-oa-永不跨用户共享"></a>

### D4 — **License-Tiered Sharing**: Only Redistributable OA Parses Enter Shared Server Storage; Non-OA Is Never Shared Across Users

| Category | Cross-user Sharing | Explanation |
|---|---|---|
| Redistributable OA (peS2o/S2ORC ODC-By, PMC oa_comm CC0/CC-BY) | ✅ Shared server cache | Demand-driven OA corpus growth; essentially server-side ADR-013 P1/R3 |
| Non-OA / arXiv / NC-ND | ❌ Never shared across users | At most device-local cache (already covered by ADR-013 R3); transfer to others is redistribution and violates the boundary |

<a id="d5-&#45;贡献模型-&#45;信号驱动-&#45;服务端自取自解析-oa非用户上传解析副本"></a>

### D5 — Contribution Model = **Signal-Driven + Server Retrieval and Parsing of OA**, Rather Than User-Uploaded Parsed Copies

Clients send only a **delinked signal requesting close reading of DOI Y**; **ASCI's server fetches the OA paper and parses it itself** into the shared cache. This removes three hazards together:

- **Poisoning** → ASCI controls parse quality rather than trusting client artifacts.
- **Copyright redistribution** → ASCI retrieves OA directly without redistributing user copies (even for OA, forwarding a user copy creates a heavier legal posture).
- **Heavy privacy exposure** → Contributions narrow to demand signals only (no user-copy bytes).
- **Non-OA naturally excluded** → Servers cannot retrieve non-OA → it never enters shared storage (consistent with D4).

> Thus “reuse users' download/parse data” becomes **demand-driven lazy-fill**: add an on-demand pipeline alongside ADR-013 P1 batch ingestion. Reuse means that once an OA paper is parsed (batch or on demand), all users can reuse it.

<a id="d6-&#45;回流默认关-&#45;opt-in-&#45;去关联05-即做与-06-查询飞轮分离"></a>

### D6 — Contributions **Default Off · Opt-In · Delinked**, Implemented in **0.5**; Separate from the 0.6 Query Flywheel

- Default off, enabled by opt-in; upload **public OA demand signals keyed by DOI**; servers **do not store who↔DOI mappings** (delinked).
- Since D5 reduces privacy exposure to delinked public OA demand signals (far lighter than per-user behavioral query-flywheel data) and directly fulfills the meeting's central request, include it in **0.5** (with lightweight boundary clarification + disclosure).
- The **query flywheel** (relevance compounding from queries/clicks/adoptions) includes per-user research behavior and conflicts more strongly with 0.3 boundaries; **still 0.6**, orthogonal to this decision and not to be conflated (see [CONTEXT.md](../../CONTEXT.md) §Flagged ambiguities).

---

<a id="四05-&#45;06-节奏在-adr-013-p1p2p3-之上叠加"></a>

## 4. 0.5 ⇄ 0.6 Timing (Layered over ADR-013 P1/P2/P3)

The retained roadmap lists 0.5 metadata indexing/batch OA ingestion (P1), local GS spike (P1+), shared OA serving (P3), opt-in delinked lazy-fill (P3+), and BYOK agentic/hybrid search/reranking (P2). In 0.6/V1 it places the opt-in query flywheel with privacy-boundary redefinition and non-API expansion gated by the GS spike.

```
0.5 (required/observe · no heavy privacy exposure)
  P1  ▸ [ADR-013] OpenAlex metadata index + batch OA ingestion (eager)
  P1+ ▸ [D2/D3 this ADR] user-local fetching + GS benchmark (observe) + availability spike
  P3  ▸ [ADR-013] Read side: shared server OA parse cache (serving · public content · no new privacy exposure)
  P3+ ▸ [D4/D5/D6 this ADR] Write side: demand-driven lazy-fill (signals + server retrieval/parsing · opt-in · delinked)
  P2  ▸ [ADR-013] agentic search + hybrid retrieval + LLM reranking (BYOK)

0.6/V1 (opt-in + boundary redefinition / evidence-gated expansion)
  ▸ Query flywheel (compounding relevance signals) — conflicts with 0.3 boundary; opt-in + redefinition
  ▸ Expand non-API sources (ResearchGate / CNKI / Wanfang / publisher pages) — gated by 0.5 GS spike
```

---

<a id="五后果"></a>

## 5. Consequences

- **Extends rather than replaces ADR-013**: Fully inherits partially self-built layers / accumulating relevance rather than papers / zero per-query BYOK cost; adds only live non-API sources and demand-driven OA lazy-fill.
- **Preserves BYOK / local-first identity**: Fetching runs user-local or with user-provided keys; contributions are delinked signals, while servers only retrieve/parse OA (one-time costs amortized across users rather than per query).
- **New server pipeline for on-demand OA retrieval + parsing**: In addition to ADR-013 batches, delinked signals trigger OA fetch → parse → shared cache; inherits ADR-013's extension to ADR-002 (index/corpus workload).
- **Lightweight privacy-boundary clarification (0.5)**: Explain why delinked public OA demand signals are not research-content telemetry in the 0.3 sense, with opt-in + disclosure; separate from 0.6 query-flywheel boundary redefinition.
- **GS blacklist status needs reevaluation**: Source expansion spec §4.2 lists `google_scholar` as dead; revise after implementation according to spike findings (user-local differs from the original server fan-out path).

<a id="风险"></a>

### Risks

| Risk | Mitigation |
|------|------|
| Unknown actual GS user-local availability (currently dead source) | **Measure first in spike** (availability/latency/CAPTCHA/blocking); expand only above threshold, otherwise GS remains best effort without promises |
| ToS/reputational risk from distributing a scraper (even user-local) | Legal confirmation of providing tools vs. scraping on behalf of users; default local, explicitly no proxy scraping |
| Per-paper upstream copyright (commercially usable OA bucket does not mean every paper lacks NC/ND) | Inherit ADR-013: retain per-paper license metadata, filter NC/ND; legal confirmation before implementation |
| Whether delinking is real (servers may still correlate connections) | Engineer storage to omit who↔DOI mappings; disclose limits; remain opt-in conservatively |
| Accumulated scope (four people, 0.5 immediately after large 0.4) | D3/D6 can degrade; GS observation and opt-in writing may be deferred without blocking 0.5 mainline |

---

<a id="六后续动作"></a>

## 6. Follow-Up

- [ ] Product/engineering Lead signature (Proposed → Accepted).
- [ ] **Spike (moved forward for parallel 0.4 execution · tracked in [#722](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/722))**: Actual user-local GS availability/latency/CAPTCHA/block rate + select fetching technology + fallback feasibility (D3 expansion gate; [0.4 north-star](../milestones/0.4/north-star.md) §4 GS-E1~E4).
- [ ] Legal confirmation: ① ToS boundaries for scraper distribution/SERP integration; ② per-paper OA license filtering for demand-driven lazy-fill.
- [x] GS promoted to an independent 0.5 feature: [0.5 north-star](../milestones/0.5/north-star.md) §5 P5 + [0.5 PRD](../specs/0.5.0/0.5.0-prd.md) Epic 5; feasibility exploration moved to [0.4](../milestones/0.4/north-star.md) §4 (promoted from D3 observation / P1+ spike footnote; three-level fallback L1 user-local / L2 SERP API / L3 direct GS).
- [ ] Update north-star: P3+ **demand-driven lazy-fill** (D4–D6 write side, not yet in 0.5 PRD / north-star).
- [ ] Revise [Failure-Triggered Source Expansion Spec](../specs/lit-search-failure-source-expansion-spec.md) §4.2 GS blacklist according to spike findings.
- [ ] Update [ADR-002](./ADR-002-server-stack.md): Include on-demand OA retrieval/parsing in server workload (same batch as ADR-013).

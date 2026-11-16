> Historical research specification: preserves earlier designs and data semantics; it does not require new features or restoration of runtime wiring. Active research features are being retired in batches under the [retirement specification](./2026-11-10-research-retirement.md); corresponding execution records define actual completion and unaccepted scope.

<a id="lit-scoring-agent-&#45;证据驱动文献评分score与-f22v1-并行"></a>

# lit-scoring-agent — Evidence-Driven Literature Scoring (score, Parallel to F22/v1)

- Status: implemented (MVP phase 1, scorer is the default judge)
- Related ADR: [ADR-010](../adr/ADR-010-evidence-driven-scoring-agent.md) (why introduce score, prioritize relevance, and run coupled with F22)
- Related issue: (to be added)
- Related PR: [#511](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/511)
- Domain language source of truth: repository `CONTEXT.md` + design master “ASCI Literature Scoring and Ranking Agent Proposal, Revised v3” (Obsidian; Appendix C maps current ASCI)
- Code sources: `paper_search/service/paper_scoring.py`, `paper_search/service/venue_tier.py`, `sub-agents/scorer.md`

---

<a id="1-目标与命名"></a>

## 1. Goal and Naming

Introduce **score** in **parallel**, prioritizing relevance with multiple explainable dimensions and distinguishing unknown/negative, **without changing** existing F22 (`scoring.py`) or finalRelevance (`relevance-scorer`/`apply_rerank`).

> **Naming**: the new rating is **score**, stored in `extra.score`, **not F22**.
> F22 = old v1 quality rating (`extra.relevance`), used internally only to select the first 50 papers for LLM scoring; no longer shown in the frontend.

Core structure (v3: **relevance primary, quality secondary**). The original diagram defines weighted semantic .35 + method .20 as relevance, and venue .15 + publication .10 + recency .10 + influence .05 + reproducibility .05 as quality; final = 0.8 relevance + 0.2 quality, or relevance alone without quality data.

```
relevanceScore = weighted(semantic_relevance .35 + method_match .20)  ← Primary ranking
qualityScore   = weighted(venue .15 + publication_status .10 + recency .10
                       + influence .05 + reproducibility .05)      ← Secondary + card annotation
finalScore     = 0.8 × relevanceScore + 0.2 × qualityScore
                 (without any quality data, finalScore = relevanceScore)
```

Rationale: venue / publication status / impact factor measure paper quality, not whether it answers the question. Giving them dominance promotes high-quality but irrelevant papers, so quality gets only 20% secondary weight + separate card annotation.

Persist **`extra.score`** in session JSONL through the same route as `relevance` / `finalRelevance` / `journalRank`, without IPC. Frontend sorts by `finalScore` and displays `ScoreBadge`.

---

<a id="2-运行链路谁何时写什么"></a>

## 2. Runtime Paths (Who, When, What)

Both paths produce `extra.score`; **the latter takes priority and is not overwritten by the former**:

<a id="21-llm-scorer-子-agent-&#45;默认判官精确-semantic-&#45;method"></a>

### 2.1 LLM `scorer` Subagent — **Default Judge** (Precise Semantic + Method)

- `lit-search` default PLAN routes `searcher → scorer` (since `manifest.json` 0.2.15; scorer = THE DEFAULT judge).
- Reads first `min(N,50)` papers sorted by F22 for this run; judges **only two dimensions**, `semantic` + `method` (0–100), against planner brief's **`research_question` (original user question)**; writes once through `apply_scoring`.
- Server fills 5 deterministic dimensions → redistributes null weights → assembles `extra.score` (`version: 3`).
- `relevance-scorer` (old v1) becomes **semantic-only fallback**, not dispatched by default.

<a id="22-后台富化-enrich_session_async-&#45;基线兜底无-llm"></a>

### 2.2 Background `enrich_session_async` — **Baseline Fallback** (No LLM)

- Search completion triggers background `spawn_session_enrich`; after venue backfill + EasyScholar quartile/IF enrichment, calculate baseline score for first `_ENRICH_TOP_N=80` papers:
  - `semantic` = fallback (`finalRelevance ?? keywordRelevance ?? relevance ?? 50`)
  - `method` = **null**, its weight redistributed to semantic
- **Key constraint (fixed this session)**: enrich step ④ checks whether scorer **already wrote** the paper (`score.scores.method_match != null`). If so, **retain scorer semantic + method**, recomputing only deterministic dimensions with latest venue/quartile data; enrich never overwrites LLM judgments.
- Seven-dimensional scoring always runs, without an off switch.

<a id="23-与-v1-的关系"></a>

### 2.3 Relationship to v1

F22 (`extra.relevance`) + finalRelevance (`extra.finalRelevance`) remain unchanged in backend, hidden only in frontend. score touches no v1 fields.

---

<a id="3-七个维度的数据来源与缺失处理"></a>

## 3. Seven Dimensions: Sources and Missing Data

| Dimension | Group | Source | Missing behavior |
|---|---|---|---|
| `semantic_relevance` | Relevance | scorer (LLM); fallback `finalRelevance ?? keywordRelevance ?? relevance ?? 50` | **Always present** through fallback |
| `method_match` | Relevance | scorer (LLM) | **null**, weight moves to semantic |
| `venue_quality` | Quality | `map_venue_tier(extra.journalRank, venue)` × match_confidence | tier=unknown → **null** |
| `publication_status` | Quality | `infer_publication_status(record)` (rough source/venue/doi inference) | Never null (minimum unknown=35) |
| `recency` | Quality | `year` | No integer year → **null** |
| `paper_influence` | Quality | Annualized `extra.citedBy` | No citedBy → **null** |
| `reproducibility` | Quality | Title/abstract/url heuristic | No signal → **null** |

> **null ≠ 0**: missing dimensions are excluded, their weights redistributed proportionally within the group. Missing data is not poor quality, especially for new uncited papers.

---

<a id="4-评分细则与代码逐条对齐"></a>

## 4. Scoring Rules (Aligned with Code)

<a id="40-端到端走查一条论文怎么得到-finalscore"></a>

### 4.0 End-to-End Walkthrough (How a Paper Gets finalScore)

The diagram traces retrieval into JSONL, baseline enrichment for 80 papers, scorer's first min(N,50), server deterministic scoring and group-wise null redistribution, persistence as version 3, later enrich retaining LLM dimensions, and frontend sorting/badges.

```
① searcher/retrieve   → Candidates into session JSONL, with venue / year / citedBy / extra.relevance(F22)
② Background enrich   → Backfill formal venue + EasyScholar quartile/IF(extra.journalRank);
                          baseline score for first 80 (semantic=fallback, method=null)
③ scorer subagent     → Read first min(N,50) by F22, judge semantic + method against original question;
   (default, LLM)        one apply_scoring writeback
④ Server score_record → For each judged handle:
   (5 deterministic      a. Take scorer semantic + method
    dimensions + merge)  b. Derive venue_quality / publication_status / recency
                             / paper_influence / reproducibility from record (4.2–4.5)
                          c. Redistribute null weights within groups → relevanceScore, qualityScore (4.6)
                          d. finalScore = 0.8×relevanceScore + 0.2×qualityScore
                          e. Write extra.score (version 3)
⑤ Refreshed enrich    → If method≠null (scorer judged it), retain semantic+method;
                          recompute deterministic dimensions with latest quartile/IF, never overwrite LLM
⑥ Frontend            → Sort finalScore, ScoreBadge number + relevance/quality breakdown
```

Key: **LLM judges the two relevance dimensions; server computes five quality dimensions from fields**. Each group redistributes null weights independently; combine 0.8 / 0.2. Without scorer (background baseline only), semantic falls back, method=null, and `relevanceScore = semantic`.

<a id="41-相关性两维llmscorer-判"></a>

### 4.1 Two Relevance Dimensions (LLM `scorer`)

**`semantic` (0–100), topical relevance**: how directly the paper answers `research_question` (**original question, not keyword list**).
- 90–100 directly addresses the specific objective · 75–89 relevant but different scope/variant · 60–74 partially relevant · 40–59 same field but off-topic · 0–39 only field/keyword overlap
- **Hard negative constraint**: field/modality overlap is insufficient. If abstract lacks the question's **specific objective** (e.g. extending depth of field → EDOF / all-in-focus / extended focal depth), **semantic ≤ 50**; generic volumetric / 3D / reconstruction imaging never mentioning that objective caps at 50.

**`method` (0–100), targeting the specific objective**:
- 90–100 method designed **for** that objective · 75–89 close variant · 55–74 adjacent · 0–54 different objective/method
- **Hard negative constraint**: generic volumetric imaging / 3D reconstruction / light-field reconstruction without explicit targeting of the specific objective gets **method ≤ 40**, even with the same modality + deep learning.

<a id="42-venue_tier-映射map_venue_tier取最强信号-_stronger"></a>

### 4.2 venue_tier Mapping (`map_venue_tier`, **Strongest Signal** `_stronger`)

Each source supplies a tier; choose the strongest. Any matching source raises `match_confidence` to 0.9 (top-journal allowlist 0.95).

| tier | Match condition (any one) |
|---|---|
| **top** | Top-journal allowlist / CAS tier 1 / (JCR=Q1 and IF≥8) / CCF-A / CORE-A* |
| **strong** | CAS tier 2 / JCR=Q1(IF<8) / (Q2 and IF≥5) / CCF-B / CORE-A |
| **normal** | CAS tier 3 / Q2(IF<5) / Q3 / CCF-C / CORE-B |
| **weak** | CAS tier 4 / Q4 / CORE-C |
| **unknown** | No signals |

- Journal metrics come from `extra.journalRank` (EasyScholar: `jcrPartition` / `impactFactor` / `casPartition`, extracting CAS tiers 1–4 from strings).
- Conferences use local `venue_ranking_local.json` (CCF/CORE seed table); `normalize_venue` converts names to abbreviation keys (full-name fragments + parenthesized abbreviations + known token scanning).

<a id="43-venue_quality-分数"></a>

### 4.3 venue_quality Score

```
tier_score:  top 95 / strong 80 / normal 65 / weak 45 / unknown → null
venue_quality = round(tier_score × max(match_confidence, 0.5), 1)
```

### 4.4 `publication_status`

`infer_publication_status` roughly infers status/confidence from venue/doi/source:

| Status | Trigger | Base score | confidence |
|---|---|---|---|
| `published_journal` | Venue present, not preprint markers, no conf/workshop words | 85 | 0.85 |
| `published_conference` | Venue contains proceedings/conference/symposium/congress/meeting | 85 | 0.82 |
| `published_workshop` | Venue contains workshop | 60 | 0.80 |
| `accepted_pending_publication` | (reserved) | 70 | — |
| `preprint_with_doi` | No formal venue but has DOI | 55 | 0.70 |
| `preprint_only` | source=arxiv or venue matches preprint markers | 45 | 0.75 |
| `published_repository` | (reserved) | 45 | — |
| `unknown` | None matched | 35 | 0.40 |

Preprint markers: arxiv / ssrn / biorxiv / medrxiv / chemrxiv / preprint / research square / techrxiv / authorea. The formula uses the base score from the table.

```
publication_status = round(base_score × (0.6 + 0.4 × confidence), 1)
```

### 4.5 recency / influence / reproducibility

- **recency** (`now_year - year`): ≤1→95 · ≤3→85 · ≤5→70 · ≤10→50 · otherwise 30; no integer year → null.
- **influence** (annual citations = citedBy ÷ max(1, now−year+1)): ≥50→95 · ≥20→85 · ≥10→75 · ≥5→65 · ≥1→55 · otherwise 40; no citedBy → null.
- **reproducibility**: title+abstract includes github / open source / (code and available|release)→75; otherwise url/pdf_url→50; neither→null.

<a id="46-三个分数的合成null-重分配"></a>

### 4.6 Combining Three Scores (Null Redistribution)

The algorithm divides weighted available scores by available weights, redistributing missing dimensions within groups; missing method gives semantic all relevance weight; all-null quality produces None, so final uses relevance alone, otherwise 0.8/0.2.

```
compute_final_score(scores, weights):
    avail  = {dimension: score | score is not null}
    return Σ(score × weight) / Σ(available weights)   # Redistribute missing weights within group

relevanceScore = compute_final_score({semantic, method}, {.35, .20})
                 # Missing method → all to semantic, relevanceScore = semantic
quality_dims   = {venue, pub, recency, influence, repro}
qualityScore   = None  if all five dimensions are null
               = compute_final_score(quality_dims, {.15,.10,.10,.05,.05})  otherwise
finalScore     = relevanceScore                              if qualityScore is None
               = 0.8 × relevanceScore + 0.2 × qualityScore   otherwise
```

<a id="47-data_confidence仅展示-&#45;同分次级排序不乘进-finalscore"></a>

### 4.7 data_confidence (Display / Secondary Tie-Breaking Only, **Never Multiplied into finalScore**)

Comments mark title present=0.95, venue present=max(match_conf,0.5), integer year=0.95, nonempty authors=0.9; missing values redistribute weights proportionally.

```
weights: title .10 / venue .30 / publication_status .30 / year .10 / authors .20
confs:   title 0.95(present) · venue max(match_conf,0.5)(present) · pub_status=pub.confidence
         · year 0.95(integer) · authors 0.9(nonempty)
data_confidence = Σ(conf × w) / Σ(available w)    # Redistribute missing weights proportionally
```

<a id="48-等级内部计算前端不展示-sabcd"></a>

### 4.8 Levels (Internal, **Frontend Does Not Show S/A/B/C/D**)

S ≥90 · A ≥80 · B ≥65 · C ≥50 · D <50. Frontend shows only numeric `finalScore` + relevance/quality breakdown, no letters.

---

<a id="5-输出结构extrascoreversion-3"></a>

## 5. Output (`extra.score`, Version 3)

Comments identify relevance as the dominant 0.8 term, quality as 0.2 plus card annotation (null when all five dimensions are absent), finalScore for sorting, nullFields for redistributed dimensions, and level as internal. The example reason translates to “Highly semantically relevant; strong method match; top venue (JCR-Q1·IF8.x); formally published (journal).”

```jsonc
{
  "version": 3,
  "scores": { "semantic_relevance": 95, "method_match": 90, "venue_quality": 76.0,
              "publication_status": 79.9, "recency": 95, "paper_influence": 65, "reproducibility": 75 },
  "relevanceScore": 93.2,            // 0.8 权重的主导项
  "qualityScore": 77.4,              // 0.2 权重 + 卡片标注；五维全缺则 null
  "finalScore": 90.0,                // 排序用
  "nullFields": [],                  // 被重分配的缺数据维
  "level": "S",                      // 内部，前端不展示
  "dataConfidence": 0.91,
  "venueTier": "top", "venueMatchConfidence": 0.9,
  "publicationStatus": "published_journal", "publicationStatusConfidence": 0.85,
  "venueType": "journal",
  "reason": "语义高度相关；方法匹配度高；venue top（JCR-Q1·IF8.x）；已正式发表（期刊）"
}
```

---

<a id="6-与-f22-五维评分的对比"></a>

## 6. Comparison with F22 Five-Dimensional Scoring

F22 (v1, `scoring.py` → `extra.relevance`) is **purely deterministic, quality-oriented, one aggregate score**. This refactoring's score is **LLM + deterministic hybrid, relevance-led, explainable multidimensional scoring**. Both coexist (F22 still internally selects the first 50 for scorer), while frontend default display/sorting has switched to score.

<a id="61-维度与权重对照"></a>

### 6.1 Dimensions and Weights

| | **F22 five dimensions** (`extra.relevance`, 0–100) | **score seven dimensions** (`extra.score.finalScore`) |
|---|---|---|
| Relevance | `keyword_relevance` .20 | `semantic_relevance` .35 + `method_match` .20 → **relevanceScore** |
| Quality | `citations` .25 · `recency` .25 · `citation_velocity` .15 · `venue_presence` .15 | `venue_quality` .15 · `publication_status` .10 · `recency` .10 · `paper_influence` .05 · `reproducibility` .05 → **qualityScore** |
| Combination | Five-dimensional weighted sum (null redistribution) | `finalScore = 0.8×relevanceScore + 0.2×qualityScore` |
| **Relevance share** | **0.20** | **0.80** |
| **Citations+recency share** | **0.65** (citations .25 + recency .25 + velocity .15) | **0.20** (all quality dimensions total only 0.20; citations/recency a small subset) |

<a id="62-关键差异为什么换"></a>

### 6.2 Key Differences (Why Change)

| Dimension | F22 five dimensions | score seven dimensions |
|---|---|---|
| **Relevance judgment** | `keyword_relevance`: term-hit voting (**literal/frequency only, no semantics or LLM**); same-field overlapping words can score highly | `semantic`+`method`: **LLM judges against original question**, with hard negative constraints (same field/modality ≠ relevance; cap without specific objective) |
| **Ranking driver** | Citations + recency (0.65): **highly cited classics / prolific journals rise**, even off-topic | Relevance (0.80): **on-topic first**, quality as secondary adjustment |
| **Venue signal** | Binary `venue_presence`: named journal 0.5 / absent null (**presence only, not strength**) | Five-level `venue_quality` tier (top/strong/normal/weak), mapped from CCF/CORE + JCR/CAS/IF |
| **Publication status** | Undifferentiated venue presence | Distinct journal/conference/workshop/preprint with/without DOI/unknown scores |
| **LLM involvement** | None, deterministic and immediate | Two relevance dimensions judged by LLM scorer; literal fallback if absent |
| **Output** | Aggregate score + `relevanceBreakdown` | `relevanceScore`/`qualityScore`/`finalScore` + seven dimensions + `reason` + `data_confidence` |
| **Shared** | — | Exclude nulls, redistribute within groups (missing ≠ poor); clamp to 0–100 |

<a id="63-一个真实例子同一篇两套分"></a>

### 6.3 Real Example (Same Paper, Two Scores)

Candidate “**The Light Field Camera: Extended Depth of Field**” (classic plenoptic-camera paper, highly cited, strong venue, but **neither deep learning nor microscopy**):
- **F22**: high citations + acceptable recency + venue_presence + literal light field/depth of field matches → **high aggregate, top ranking**.
- **score**: scorer semantic=55 / method=35 (right field, but not requested deep learning + microscopy, hard negative cap); venue_quality is top but only 0.15 → **finalScore ≈ 51.7**, reduced by relevance.

This is the intent: **F22 promotes high-quality but irrelevant papers through citations/reputation; score makes answering the user's question determine rank.** Thus an off-topic retrieval pool honestly gets low scores, while F22 might inflate them through citations/venue.

<a id="7-关键原则沿用母本"></a>

## 7. Core Principles (From Master Design)

unknown(null) ≠ negative(0); separate publication events from venue strength, avoiding double credit; preserve fuzzy-match confidence (`match_confidence`); **relevance before impact factor / reputation**, with 0.8 finalScore weight.

<a id="8-mvp-不做"></a>

## 8. Outside MVP

Raw-response retention, full multi-source evidence fusion, two-pass canonical iteration, institution-based primary scoring, retraction detection (`published_repository`/`accepted_pending_publication` remain reserved enums without trigger paths).

<a id="9-asci-落地差异详见母本附录-c"></a>

## 9. ASCI Implementation Differences (Master Appendix C)

- DBLP is not disabled, only excluded from broad search; targeted conference-venue verification can reuse exact DBLP XML lookup (this round uses local CCF/CORE + OpenAlex venue names; DBLP later).
- No raw-response retention → lightweight evidence based on normalized record fields.

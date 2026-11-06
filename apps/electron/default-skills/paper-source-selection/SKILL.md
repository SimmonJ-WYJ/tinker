---
name: paper-source-selection
description: >
  Before searching for papers, automatically recommend the best API data source(s) by research
  field and confirm the choice with the user. Triggers: user requests paper search, literature
  retrieval, academic lookup, paper discovery, citation analysis, or PDF download.
  Use when user says "搜论文" "检索文献" "查论文" or "search papers" "find papers".
  This is search-source selection, NOT review writing — "写综述 / 生成综述 / 综述论文 /
  literature review" routes to review-proposer / literature-review-result, not here.
version: "1.0.0"
category: general
---

# Paper Source Selection

## Trigger Conditions

- User requests an academic literature search and a source needs to be chosen
- A multi-source search strategy needs to be drafted
- PDF download is required and a download-capable source must be picked

**Not applicable when:**

- DOI is already known and only metadata is needed → use `get_crossref_paper_by_doi` directly
- A paper ID is known and recommendations are wanted → use `recommend_papers` directly
- User has explicitly specified a data source

## Instructions

### Core Principle

Picking the wrong source = missed papers + poor metadata quality + wasted rate quota.

**Domain-specific sources win on relevance; general aggregators win on coverage. Combine both.**

### Step 1: Identify the Research Field

Infer the discipline from keywords in the user query:

| Discipline | Keyword signals |
|------------|-----------------|
| Computer Science / AI / ML | neural network, transformer, LLM, NLP, computer vision, deep learning, reinforcement learning, GAN, diffusion model |
| Biomedical / Life Sciences | disease, drug, protein, gene, clinical, patient, therapy, cell, pathology, oncology, epidemiology, genomics |
| Physics / Mathematics | quantum, relativity, topology, algebra, particle, cosmology, theorem, proof, differential equation, condensed matter |
| Chemistry | synthesis, catalyst, molecule, reaction, polymer, spectroscopy, organic, inorganic, electrochemistry |
| Social Sciences / Economics | policy, market, behavior, regression, inequality, institution, labor, trade, welfare, governance, GDP |
| Engineering | circuit, antenna, signal processing, control system, robotics, manufacturing, power grid, VLSI |
| Humanities | literature, philosophy, history, linguistics, art, culture, ethics, narrative, rhetoric |
| Cryptography | encryption, cipher, zero-knowledge, hash, digital signature, lattice-based, post-quantum, homomorphic |

**Cross-disciplinary topics** (e.g. "attention mechanisms in protein folding"): combine the primary sources of both disciplines.

### Step 2: Pick Data Sources by Discipline

| Discipline | Primary | Citation / Discovery / Authoritative Index | Broad-coverage Fallback |
|------------|---------|--------------------------------------------|--------------------------|
| Computer Science / AI / ML | `search_arxiv` | `search_semantic` (citation graph) + `search_dblp` (conference index) | `search_openalex` |
| Biomedical / Life Sciences | `search_pubmed` | `search_europepmc` + `search_semantic` | `search_biorxiv` |
| Physics / Mathematics | `search_arxiv` | `search_semantic` | `search_openalex` |
| Chemistry | `search_openalex` | `search_semantic` + `search_crossref` | `search_crossref` |
| Social Sciences / Economics | `search_openalex` | `search_semantic` + `search_crossref` | `search_arxiv` (econ.*) |
| Engineering | `search_arxiv` (eess.*) | `search_openalex` | `search_core` |
| Humanities | `search_openalex` | `search_crossref` | `search_doaj` |
| Cryptography | `search_iacr` (⚠️ depends on web scraping) | `search_arxiv` (cs.CR) | `search_semantic` |
| Cross-disciplinary / Uncertain | `search_openalex` | `search_semantic` | `search_crossref` |

### Step 3: Pick the Tool by Task Type

| Task | Tool |
|------|------|
| Keyword search (discipline known) | Pick the discipline-specific `search_*` from the table above |
| Citation graph / snowball | `snowball_search` (backed by Semantic Scholar) |
| Similar-paper recommendation | `recommend_papers` (SPECTER2 embeddings) |
| DOI → metadata | `get_crossref_paper_by_doi` |
| PDF download | `download_paper` (auto-tries multiple sources) |
| Export results | `export_papers` (CSV, RIS, BibTeX) |

### Step 4: Check Constraints

**Sources that support PDF download:**
arXiv, Semantic Scholar, bioRxiv, medRxiv, CORE, Europe PMC, PMC, HAL, Zenodo, DOAJ, OpenAIRE, IACR (⚠️ web scraping)

**Metadata-only (no PDF):**
Crossref, OpenAlex, PubMed, DBLP, Google Scholar, Unpaywall (DOI-only OA-link lookup)

**Rate limits:**

- Generous: OpenAlex (~100K/day), Unpaywall (100K/day), Crossref (polite pool)
- Moderate: Semantic Scholar (100 req / 5 min, higher with API key), Zenodo (30/min)
- Strict: PubMed (3 req/s), CORE (5 req / 10 s), arXiv (1 req / 3 s)

### Step 5: Verify Source Availability

After choosing candidate sources from the table above, check the actual list of `search_*` MCP tools available in the current session. If a recommended source's tool is missing (disabled, not installed, or missing API key), drop it from the recommendation and substitute the next Fallback in the same row. **Only recommend sources that are actually callable.**

### Step 6: Confirm the Search Plan with the User

After completing the analysis, you **MUST** show a confirmation checklist and wait for the user.

**Output format requirement**: place the confirmation checklist inside a Markdown code block (` ``` `) so the markdown renderer does not reflow it:

````markdown
```
Search plan
━━━━━━━━━━━━━━━━━━━━━━
Field:        [identified discipline]
Keywords:     [extracted keywords, comma-separated]
Sources:
  - search_arxiv     (primary)
  - search_semantic  (citation)
  - search_dblp      (citation)
Year range:   [default last 3 years, e.g. 2023-2026]
Per-source:   15      [15 recommended / 30 moderate / 50 heavy]
Enrich:       true    [auto-fill missing abstracts after dedupe]
━━━━━━━━━━━━━━━━━━━━━━
Please confirm or amend (reply with changes, or reply "confirm" to start searching)
```
````

**Per-source guidance** (used in the checklist above):

- **15 (recommended, default)** — single-tool response ~20KB; fits Agent SDK threshold; pipeline does not degrade. Right for most research scenarios where the user wants a tight, high-quality candidate set.
- **30 (moderate)** — single-tool response ~40KB on verbose sources; approaches the threshold; only suggest when the user explicitly asks for a wider sweep.
- **50 (heavy)** — single-tool response 60–120KB; **very likely to trigger SDK chunked-read fallback** which forces the litreview pipeline into hand-processing and leaves the right-side paper panel empty. Only allow this if the user insists and explicitly accepts the degraded behavior.

**Enrich guidance**: `enrich=true` (default) makes `process_search_results` fill missing abstracts via Semantic Scholar / OpenAlex / CrossRef fallback. Recommend keeping it on — especially when including metadata-only sources like DBLP / Crossref / OpenAlex that frequently return papers without abstracts. Note that enrich is currently serial and adds ~1s per missing abstract, so it can dominate latency for large `Per-source` values.

- User replies "confirm" / "确认" → pass the confirmed parameters to the litreview skill to start searching
- User replies with amendments → update parameters and re-show the checklist
- **Do not skip confirmation and start searching directly**
- **Do not replace the code-block layout with a table or list**

### Session-level Parameter Reuse (Hard Rule)

Once the user confirms the Search plan above, these parameters (sources / year range /
per-source / enrich) are **reused across all subsequent rounds in this session**. The
litreview skill must NOT re-invoke `paper-source-selection` for new-keyword rounds —
on each new round, only the keywords change; everything else carries over. Re-invoke
this skill **only** when the user explicitly asks to change parameters (e.g. "换数据源"
/ "改成 30 篇" / "switch to PubMed").

### Common Mistakes

| Mistake | Fix |
|---------|-----|
| Searching every source even when discipline is known | Use the discipline-specific source — faster, less noise |
| Searching CS papers via PubMed | PubMed is biomedical-only; use arXiv + DBLP |
| Relying on Google Scholar in an automated flow | High CAPTCHA risk; use OpenAlex or Semantic Scholar instead |
| Needing citation analysis but skipping Semantic Scholar | It's the only source that exposes citation graph + recommendations |
| Searching without confirmation | You must show the plan and get user confirmation first |

### Reference

Detailed per-source dossiers (coverage, metadata quality, API key config, search tactics):
[resources/api-source-guide.md](resources/api-source-guide.md)

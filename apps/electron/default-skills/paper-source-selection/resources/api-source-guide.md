# Academic API Source Selection Guide

> This document helps the user quickly decide which API data source(s) to use based on the **research field**, avoiding blind searches that yield low-quality results or miss key literature.

---

## Table of Contents

1. [Overview: One-line Source Picker](#1-overview-one-line-source-picker)
2. [Recommendations by Discipline](#2-recommendations-by-discipline)
3. [Per-source Dossiers](#3-per-source-dossiers)
4. [Capability Matrix](#4-capability-matrix)
5. [API Keys & Rate Limits](#5-api-keys--rate-limits)
6. [Recommended Search Strategies](#6-recommended-search-strategies)

---

## 1. Overview: One-line Source Picker

| Need | Primary source |
|------|----------------|
| Field unclear; cast a wide net first | **OpenAlex** (250M+, free, no key needed) |
| Need citation network / paper recommendations | **Semantic Scholar** (SPECTER embeddings + citation graph) |
| Curated biomedical literature | **PubMed** + **Europe PMC** |
| Biomedical full text | **PMC** + **Europe PMC** |
| CS/AI/ML preprints + full text | **arXiv** |
| Computer science conferences | **DBLP** |
| Metadata by DOI | **Crossref** |
| Find OA version of a paper | **Unpaywall** |
| OA full text across all fields | **CORE** |
| Social-science working papers | **SSRN** (scraping-only; no formal API) |
| EU-funded project tracking | **OpenAIRE** |
| High-quality OA journal filter | **DOAJ** |
| Electrical engineering / IEEE standards | **IEEE Xplore** (subscription required) |
| Cryptography | **IACR** |
| Chemistry preprints | **chemRxiv** |
| French academic research | **HAL** |
| Research data / software archive | **Zenodo** |
| Grey literature / theses | **BASE** |

---

## 2. Recommendations by Discipline

### 2.1 Computer Science / AI / Machine Learning

| Priority | Source | Reason |
|:--------:|--------|--------|
| 1 | **arXiv** (cs.*) | De facto standard for CS/AI/ML preprints; full text downloadable |
| 2 | **Semantic Scholar** | Best citation graph + SPECTER2 semantic-embedding recommendations |
| 3 | **DBLP** | Most complete CS bibliography; unmatched conference coverage; excellent author disambiguation |
| 4 | **OpenAlex** | Covers published versions; useful for bibliometric analysis |
| 5 | **IEEE Xplore** | Authoritative source for EE/CS conferences + standards (institutional subscription required) |

**Typical workflow**: arXiv for preprints → DBLP to confirm conference publication → Semantic Scholar to trace citations → OpenAlex to fill gaps

---

### 2.2 Biomedical / Life Sciences

| Priority | Source | Reason |
|:--------:|--------|--------|
| 1 | **PubMed** | Gold standard; MeSH controlled vocabulary; 36M+ citations |
| 2 | **PMC** | OA full text in structured XML; ~8M articles |
| 3 | **Europe PMC** | PubMed superset + preprints + patents + full-text search |
| 4 | **bioRxiv / medRxiv** | Preprints for biology and health sciences |
| 5 | **Semantic Scholar** | Citation graph; good biomedical coverage |
| 6 | **Unpaywall** | Find OA versions of paywalled papers |

**Typical workflow**: PubMed search (MeSH) → Europe PMC for full text → bioRxiv for the latest preprints → Unpaywall for OA links

---

### 2.3 Physics / Mathematics

| Priority | Source | Reason |
|:--------:|--------|--------|
| 1 | **arXiv** (physics.*, math.*, hep-*, cond-mat.*) | De facto standard for physics/math preprints; comprehensive |
| 2 | **OpenAlex** | Broad coverage of published versions; Topic classification |
| 3 | **Semantic Scholar** | Citation graph |
| 4 | **Crossref** | DOI metadata for journal articles |
| 5 | **Zenodo** | CERN-operated; physics data / software archive |

---

### 2.4 Chemistry

| Priority | Source | Reason |
|:--------:|--------|--------|
| 1 | **chemRxiv** | ACS-run chemistry preprint server |
| 2 | **OpenAlex** | Broad coverage of chemistry journals |
| 3 | **Crossref** | Publisher metadata (ACS, RSC, Wiley, Elsevier) |
| 4 | **Semantic Scholar** | Citation graph |
| 5 | **PubMed** | Biochemistry / chemical biology crossover |

---

### 2.5 Social Sciences / Economics

| Priority | Source | Reason |
|:--------:|--------|--------|
| 1 | **OpenAlex** | Broadest coverage; Topic classification helps cross-disciplinary research |
| 2 | **Crossref** | Published-article metadata from social-science publishers |
| 3 | **Semantic Scholar** | Growing social-science coverage |
| 4 | **SSRN** | Rich working-paper coverage for social science / law / economics, but **no formal API, scraping-only, unstable** — not suitable as a primary automation source |
| 5 | **arXiv** (econ.*, q-fin.*) | Economics and quantitative finance preprints |
| 6 | **DOAJ** | Identifies high-quality OA social-science journals |

---

### 2.6 Engineering

| Priority | Source | Reason |
|:--------:|--------|--------|
| 1 | **IEEE Xplore** | Authoritative for EE / electronics / tech standards (institutional subscription required; unavailable if `PAPER_SEARCH_MCP_IEEE_API_KEY` not configured) |
| 2 | **arXiv** (eess.*) | Electrical engineering and systems-science preprints (the no-subscription primary) |
| 3 | **OpenAlex** | Broad multi-disciplinary coverage |
| 4 | **Crossref** | Engineering-publisher metadata |
| 5 | **CORE** | OA full text for engineering |

> **Automation scenario**: IEEE Xplore requires a paid subscription; if not configured, the effective priority is arXiv (eess.*) → OpenAlex → CORE.

---

### 2.7 Humanities

| Priority | Source | Reason |
|:--------:|--------|--------|
| 1 | **OpenAlex** | Broadest coverage of humanities journals and books |
| 2 | **Crossref** | DOI metadata from university presses |
| 3 | **DOAJ** | High-quality OA humanities journals |
| 4 | **HAL** | French humanities research |
| 5 | **BASE** | Grey literature, theses, institutional repositories |

> **Note**: Humanities is the discipline with the weakest free-API coverage. JSTOR (no free API) and various proprietary databases remain important sources.

---

### 2.8 Cross-disciplinary / General Search

| Priority | Source | Reason |
|:--------:|--------|--------|
| 1 | **OpenAlex** | Largest free academic index (250M+); the best starting point |
| 2 | **Semantic Scholar** | Strong citation graph for STEM |
| 3 | **Crossref** | Authoritative DOI metadata |
| 4 | **CORE** | Largest OA full-text aggregator (400M+ resources) |
| 5 | **Unpaywall** | Find OA versions for any DOI |
| 6 | **OpenAIRE** | EU-funded project tracking |

---

## 3. Per-source Dossiers

### 3.1 OpenAlex

- **Coverage**: 250M+ scholarly works; all disciplines; inherits from Microsoft Academic Graph (MAG)
- **Data aggregation**: Crossref, ORCID, Unpaywall, institutional repositories
- **Metadata quality**: Title, authors, DOI, citation count, abstract (depends on publisher licensing), ~4500 Topic classifications, institutional affiliations, OA status
- **Unique strengths**: Largest free academic index; rich entity model (works, authors, institutions, sources, topics, publishers, funders); fully open data (CC0)
- **Limits**: Abstract availability depends on publisher licensing; no full text; some metadata inherited from MAG may be stale

### 3.2 Semantic Scholar

- **Coverage**: ~200M papers; strongest in STEM (CS, biomedical)
- **Metadata quality**: Title, abstract, authors, DOI, citation count, fields of study, OA PDF link
- **Unique strengths**: AI-driven citation graph; SPECTER2 embeddings for semantic-similarity recommendations; influence/velocity citation metrics; author disambiguation; forward/backward citation lookup + paper recommendation
- **Limits**: Weaker humanities and social-science coverage; no full-text access

### 3.3 PubMed

- **Coverage**: 36M+ citations from MEDLINE, life-science journals, and online books
- **Metadata quality**: High-quality human indexing, MeSH (Medical Subject Headings) controlled vocabulary, structured abstracts, author affiliations
- **Unique strengths**: Gold standard for biomedical literature search; MeSH controlled vocabulary enables precise topic search; links to clinical trials, gene databases, protein data
- **Limits**: Biomedical / life-science only; no full text (link to PMC for OA full text); no native citation data

### 3.4 Europe PMC

- **Coverage**: 42M+ abstracts, 9M+ full-text articles; PubMed superset
- **Unique strengths**: Searches abstracts and full text together; includes preprints (bioRxiv / medRxiv); patent-literature integration; text-mining annotations (genes, diseases, organisms); funding-to-publication links
- **Limits**: Primarily limited to life sciences

### 3.5 arXiv

- **Coverage**: Physics, mathematics, computer science, quantitative biology, quantitative finance, statistics, electrical engineering & systems science, economics
- **Unique strengths**: De facto standard for physics/math/CS preprints; full text always available (PDF / LaTeX source); papers go live within hours; taxonomy supports precise field filtering
- **Limits**: Preprints only (not peer-reviewed); no citation data; limited search; no coverage of social science, humanities, or most biology

### 3.6 DBLP

- **Coverage**: CS-only — journals, conference proceedings, workshops
- **Unique strengths**: Most complete CS bibliography; excellent author-name disambiguation; conference-proceedings coverage (many other databases miss this content); clean standardized data (CC0)
- **Limits**: CS only; no abstracts; no full text; no native citation count

### 3.7 Crossref

- **Coverage**: All disciplines; 150M+ DOI-registered works from 17000+ publishers
- **Unique strengths**: Authoritative DOI metadata source; reference / citation links; funding metadata; license info; event data (Wikipedia, social-media mentions)
- **Limits**: Only DOI-registered content (no grey literature, theses, or DOI-less preprints); metadata quality depends on publisher submission quality

### 3.8 CORE

- **Coverage**: Multi-disciplinary; aggregates from 10000+ OA repositories worldwide; 400M+ scholarly resources
- **Unique strengths**: Largest OA full-text aggregator; full-text search; great for discovering institutional / grey literature
- **Limits**: Uneven metadata quality (depends on source repository); duplicate records common; strict free-tier rate limits

### 3.9 bioRxiv / medRxiv

- **Coverage**: bioRxiv covers biology and life-science preprints; medRxiv covers health-science and clinical-research preprints
- **Unique strengths**: Authoritative preprint sources for their fields; track publication status (link to published DOIs); full text always available; shared unified API
- **Limits**: Preprints only; no citation data; limited search

### 3.10 chemRxiv

- **Coverage**: Chemistry preprints (run by ACS)
- **Implementation**: Crossref-connector-based with a chemRxiv filter
- **Unique strengths**: Dedicated chemistry preprint server

### 3.11 DOAJ

- **Coverage**: Multi-disciplinary; ~20000 OA journals that have passed quality review
- **Unique strengths**: OA-journal quality filter (vetted inclusion process); journal-level metadata (APC fees, license, publisher)
- **Limits**: OA journals only; article-level metadata may be incomplete

### 3.12 SSRN

- **Coverage**: Social science, humanities, law, economics, finance, management, health sciences; 800K+ full-text papers
- **Unique strengths**: Preprint server of choice for social science / law / economics; download-count metrics widely used
- **Limits**: No formal API (requires scraping); Elsevier-owned (commercialization concerns); reCAPTCHA hurdles; PDF download requires login

### 3.13 HAL

- **Coverage**: Multi-disciplinary; primarily French academic research
- **Unique strengths**: Mandatory archive for many French research institutions; strong coverage of French research; OAI-PMH and REST APIs
- **Limits**: Primarily covers the French research ecosystem; sparse international content

### 3.14 OpenAIRE

- **Coverage**: Cross-disciplinary European research output; 60+ partner institutions
- **Unique strengths**: EU-funding-to-publication links (essential for Horizon Europe compliance reporting); integrates publications, datasets, software, etc.
- **Limits**: Primarily Europe-focused; ~10K results/query for unauthenticated users

### 3.15 Unpaywall

- **Coverage**: Not a search engine — an OA discovery layer across all disciplines; covers 50000+ publishers and repositories
- **Unique strengths**: Best tool for finding OA versions of papers; lookup by DOI (simple and fast); flags OA type (gold, green, hybrid, bronze)
- **Limits**: DOI-only queries; not a search engine (no keyword search)

### 3.16 IACR

- **Coverage**: Cryptography, and cryptography only
- **Unique strengths**: Authoritative source for cryptography preprints; covers all major IACR conferences (Crypto, Eurocrypt, Asiacrypt, etc.)
- **Limits**: Very narrow scope; no formal API (search, download, and reading all rely on web scraping and direct PDF link construction)

### 3.17 Zenodo

- **Coverage**: General-purpose multi-disciplinary research repository; accepts all kinds of research output (papers, datasets, software, slides); CERN-operated
- **Unique strengths**: Accepts any research-output type; auto-assigns DOIs; GitHub integration for software citation; version management
- **Limits**: Not a curated index (anyone can deposit); search quality is lower than dedicated academic search engines

### 3.18 Google Scholar

- **Coverage**: All disciplines; one of the broadest academic search engines
- **Implementation**: Web scraping (HTML parsing); not a formal API
- **Unique strengths**: Extremely broad coverage; familiar to users
- **Limits**: No official API; CAPTCHA and bot detection; unstable; not recommended as a primary automation source

### 3.19 BASE

- **Coverage**: Multi-disciplinary; 400M+ documents from 12000+ content providers
- **Unique strengths**: One of the largest academic-web-resource search engines; excellent institutional-repository coverage (especially Europe); includes datasets, theses, and other non-journal content
- **Limits**: Inconsistent metadata quality; no citation data; API requires application

### 3.20 IEEE Xplore / ACM DL

- **Coverage**: Electrical engineering, computer science, electronics
- **Status**: Skeleton implementation in this project; requires paid institutional subscription
- **Limits**: API key required + institutional access required

---

## 4. Capability Matrix

| Source | Search | Download PDF | Read full text | Key required | Rate limit |
|--------|:------:|:------------:|:--------------:|--------------|------------|
| arXiv | ✅ | ✅ | ✅ | None | 1 req / 3 s |
| Semantic Scholar | ✅ | ✅ | ⚠️ | Optional (boosts rate) | 100 req / 5 min (OA PDF link provided; not direct full-text content) |
| Crossref | ✅ | ❌ | ❌ | None | Polite pool (mailto recommended) |
| OpenAlex | ✅ | ❌ | ❌ | None | ~100K/day |
| PubMed | ✅ | ❌ | ❌ | None | 3 req/s |
| bioRxiv | ✅ | ✅ | ✅ | None | Undocumented |
| medRxiv | ✅ | ✅ | ✅ | None | Undocumented |
| Google Scholar | ⚠️ | ❌ | ❌ | Proxy optional | Scraping-dependent; CAPTCHA-prone |
| CORE | ✅ | ✅ | ✅ | Optional | 5 req / 10 s |
| DBLP | ✅ | ❌ | ❌ | None | Undocumented |
| Europe PMC | ✅ | ✅ | ✅ | None | Generous |
| PMC | ✅ | ✅ | ✅ | None | 3 req/s |
| IACR | ⚠️ | ⚠️ | ⚠️ | None | Undocumented (search / download / read all rely on web scraping; no formal API) |
| HAL | ✅ | ✅ | ✅ | None | Undocumented |
| chemRxiv | ✅ | ✅ | ✅ | None | Undocumented |
| Zenodo | ✅ | ✅ | ✅ | Optional | 30 req/min |
| SSRN | ⚠️ | ⚠️ | ⚠️ | None | Scraping-only; no formal API |
| DOAJ | ✅ | ✅ | ✅ | Optional | Undocumented |
| Unpaywall | ⚠️ | ❌ | ❌ | Email required | 100K/day (DOI-only OA-link lookup; not keyword search) |
| OpenAIRE | ✅ | ✅ | ✅ | Optional | ~10K results/query |
| IEEE Xplore | ❌ | ❌ | ❌ | Required | Subscription required |
| ACM DL | ❌ | ❌ | ❌ | Required | Subscription required |

**Legend**: ✅ full support (stable official API) | ⚠️ limited / best-effort (relies on web scraping, DOI-only queries, or login) | ❌ unsupported

> The **"Search" column** specifically refers to keyword-search capability. Unpaywall is marked ⚠️ because it supports DOI lookup but not keyword search.

---

## 5. API Keys & Rate Limits

### 5.1 Free, No Configuration Required

arXiv, Crossref, OpenAlex, PubMed, DBLP, Europe PMC, PMC, bioRxiv, medRxiv, IACR, HAL, chemRxiv

### 5.2 Required but Free to Configure

| Env var | Purpose |
|---------|---------|
| `PAPER_SEARCH_MCP_UNPAYWALL_EMAIL` | Required by Unpaywall (free; email required) |

### 5.3 Optional Keys (boost rate / unlock features)

| Env var | Purpose |
|---------|---------|
| `PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY` | Raises Semantic Scholar rate limit |
| `PAPER_SEARCH_MCP_CORE_API_KEY` | Raises CORE rate limit |
| `PAPER_SEARCH_MCP_DOAJ_API_KEY` | Raises DOAJ rate limit |
| `PAPER_SEARCH_MCP_ZENODO_ACCESS_TOKEN` | Access Zenodo restricted records |
| `PAPER_SEARCH_MCP_OPENAIRE_API_KEY` | Raises OpenAIRE rate limit |
| `PAPER_SEARCH_MCP_GOOGLE_SCHOLAR_PROXY_URL` | Bypass Google Scholar CAPTCHA |

### 5.4 Required Keys (paid / institutional subscription)

| Env var | Purpose |
|---------|---------|
| `PAPER_SEARCH_MCP_IEEE_API_KEY` | IEEE Xplore (institutional subscription required) |
| `PAPER_SEARCH_MCP_ACM_API_KEY` | ACM Digital Library (institutional subscription required) |

---

## 6. Recommended Search Strategies

### Strategy 1: Field Is Clear

```text
1. Pick 1-2 discipline-specific sources from the table above
2. Search via search_{source} tools
3. Augment with Semantic Scholar for citation graph and recommendations
4. Use Unpaywall to find OA full-text links
```

### Strategy 2: Field Unclear / Cross-disciplinary

```text
1. Start with a broad search via search_openalex
2. Inspect Topic classifications in the results to identify the primary field
3. Switch to discipline-specific sources for deep search
4. Use snowball_search to follow related literature through citation chains
```

### Strategy 3: Known Paper, Looking for Related Work

```text
1. Use recommend_papers for Semantic Scholar embedding-based recommendations
2. Use snowball_search to traverse forward/backward citations (1-3 levels deep)
3. Combine with discipline-specific sources for supplemental search
```

### Strategy 4: Need Full PDF

```text
Priority order: native source download → OA repository → Unpaywall → Sci-Hub (optional)
Sources that support PDF download: arXiv, Semantic Scholar, bioRxiv, medRxiv,
CORE, Europe PMC, PMC, IACR, HAL, chemRxiv, Zenodo, DOAJ, OpenAIRE
```

---

## Appendix: Unique-capability Cheat Sheet

| Capability | Source |
|------------|--------|
| Citation graph (forward / backward) | Semantic Scholar |
| Paper-embedding recommendations | Semantic Scholar (SPECTER2) |
| MeSH precise topic search | PubMed |
| Structured full-text XML | PMC |
| Text-mining annotations | Europe PMC |
| Funding-to-publication links | OpenAIRE, Europe PMC |
| 4500+ Topic classifications | OpenAlex |
| Author-name disambiguation | DBLP, Semantic Scholar |
| License / APC info | DOAJ, Crossref |
| OA-type tagging | Unpaywall |
| Snowball search (recursive citations) | Semantic Scholar (built into this project) |
| Multi-source concurrent + auto-dedupe | search_papers (built into this project) |

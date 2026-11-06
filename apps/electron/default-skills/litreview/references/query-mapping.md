# Query Mapping: Factor Types to paper-search API Parameters

This reference table maps litreview factor types to the corresponding parameters for each paper-search MCP API endpoint.

---

---

## Dimension Axes (scoring only, not search)

**F21 (issue #98)**: `method_terms` and `object_terms` are **scoring parameters** passed to `process_search_results`. They are NOT search API parameters — do NOT include them in `search_*` calls.

Their purpose is to let the rerank algorithm reward papers that simultaneously cover both axes:

- Both axes hit → `keyword_relevance` dimension scores 1.0
- Only one axis hit → 0.5
- Neither → 0
- Either axis empty → falls back to query-bag matching (#93 legacy behavior)

Extract them in litreview Phase 0.5 from the user-confirmed keywords. Pass as JSON-encoded strings:

```
mcp__paper-search__process_search_results(
    handles='[...]',
    query="...",
    method_terms='["transformer", "attention"]',
    object_terms='["mouse model"]',
)
```

---

## ⚠️ Current MCP Parameter Coverage

The mapping tables below describe the **full underlying API capability** of Semantic Scholar and OpenAlex. The current MCP tools expose a narrower surface:

| Tool | Parameters actually accepted by MCP |
| --- | --- |
| `search_papers` | `query`, `max_results_per_source`, `sources`, `year` (year only honored by Semantic Scholar) |
| `search_semantic` | `query`, `year`, `max_results` |
| `search_openalex` (and other per-source `search_<name>`) | `query`, `max_results` |
| `snowball_search` | `paper_id`, `direction`, `max_results_per_direction`, `depth` |

**Fields marked in the mapping tables but absent from the list above (e.g. `fields_of_study`, `author`, `venue`, `primary_topic_display_name`, `publication_year`, `authorships_author_display_name`, `is_oa`, `cited_by_count`, `minCitationCount`, `publicationTypes`, `institution`, `language`, `funder`) are NOT currently exposed through MCP. You cannot pass them to tool calls.**

Treat the rest of this document as the design target: the mapping to use *if / when* the MCP surface is expanded. For today's search rounds, narrow the factor set to what MCP accepts (keywords → `query`; year ranges → `year` for Semantic Scholar only) and handle the remaining factors post-retrieval by filtering the returned results yourself.

---

## Factor Type → API Parameter Mapping

| Factor Type    | `search_semantic`            | `search_openalex`                            | `snowball_search`     | Notes                                           |
| -------------- | ---------------------------- | -------------------------------------------- | --------------------- | ----------------------------------------------- |
| `query`        | `query=value`                | `query=value`                                | N/A                   | Primary search string; use for both APIs        |
| `keyword`      | `query=value`                | `query=value`                                | N/A                   | Own search round; same API param as query       |
| `author`       | `author=value`               | `authorships_author_display_name=value`      | N/A                   | Axis-type: co-attaches to keyword rounds        |
| `venue`        | `venue=value`                | `primary_location_source_display_name=value` | N/A                   | Axis-type: co-attaches to keyword rounds        |
| `field`        | `fields_of_study=value`      | `primary_topic_display_name=value`           | N/A                   | Academic field classification                   |
| `year_range`   | `year=start-end`             | `publication_year=start-end`                 | N/A                   | Format: "2020-2024" → "2020:2024" in OA         |
| `seed_paper`   | N/A                          | N/A                                          | `paper_id=doi_or_id`  | Use for forward/backward/both citation tracking |
| `method`       | `query=value`                | `query=value`                                | N/A                   | Own search round; same API param as query       |
| `exclude`      | Filter post-retrieval        | Filter post-retrieval                        | Filter post-retrieval | Remove matching papers from results             |
| `pub_type`     | `publicationTypes=<s2_type>` | `type=<oa_type>`                             | N/A                   | See type mapping table below                    |
| `open_access`  | `openAccessPdf` (boolean)    | `is_oa=true`                                 | N/A                   | Filter for freely available PDFs                |
| `citation_min` | `minCitationCount=N`         | `cited_by_count=">N-1"`                      | N/A                   | OA uses > operator, subtract 1                  |
| `institution`  | ❌ NOT SUPPORTED             | `authorships_institutions_id=<oa_id>`        | N/A                   | OA only. Resolve ID via `/institutions?search=` |
| `language`     | ❌ NOT SUPPORTED             | `language=<iso_code>`                        | N/A                   | OA only. ISO 639-1 code (e.g. "en", "zh")       |
| `funder`       | ❌ NOT SUPPORTED             | `awards_funder=<oa_id>`                      | N/A                   | OA only. Resolve ID via `/funders?search=`      |

---

## pub_type Cross-API Mapping

When a `pub_type` filter is active, translate the user-facing label to the API-specific value:

| User-facing label     | `search_semantic` value | `search_openalex` value |
| --------------------- | ----------------------- | ----------------------- |
| Journal article       | `JournalArticle`        | `article`               |
| Conference paper      | `Conference`            | `article`               |
| Review / survey       | `Review`                | `article` (+ keyword)   |
| Book                  | `Book`                  | `book`                  |
| Book chapter          | —                       | `book-chapter`          |
| Preprint              | —                       | `preprint`              |
| Dataset               | `Dataset`               | `dataset`               |
| Dissertation / thesis | —                       | `dissertation`          |
| Clinical trial        | `ClinicalTrial`         | —                       |
| Meta-analysis         | `MetaAnalysis`          | —                       |

> When a type is unsupported by one API (marked —), omit it from that API's query and inform the user.

---

## API-Limited Filter Warning

When `institution`, `language`, or `funder` filters are active, the agent MUST:

1. Include the filter in the OpenAlex query
2. Omit the filter from the Semantic Scholar query
3. Inform the user: "⚠️ [filter] is supported only by OpenAlex; this filter was not applied to Semantic Scholar results."

---

## API-Specific Details

### search_semantic (Semantic Scholar)

**Current MCP-accepted form:**

```text
search_semantic(
  query="<single_primary_value>",   # ONE primary factor per round (do NOT combine multiple)
  year="<start>-<end>",             # Optional: e.g. "2020-2024"
  max_results=15,                    # Results per call (cap 100)
)
```

**Design target (not yet exposed by MCP) — the full Semantic Scholar filter set:**

```text
# NOT CURRENTLY CALLABLE — shown for reference only.
# author=..., venue=..., fields_of_study=[...], publicationTypes=..., openAccessPdf=true,
# minCitationCount=...
```

- `year` is a range string: "2020-2024"
- For factors other than `query`/`year`, filter the returned papers in-memory after retrieval.

### search_openalex (OpenAlex)

**Current MCP-accepted form:**

```text
search_openalex(
  query="<single_primary_value>",   # ONE primary factor per round (do NOT combine multiple)
  max_results=15,                    # Results per call
)
```

**Design target (not yet exposed by MCP) — OpenAlex native filters:**

```text
# NOT CURRENTLY CALLABLE — shown for reference only.
# publication_year=..., primary_topic_display_name=..., primary_location_source_display_name=...,
# authorships_author_display_name=..., type=..., is_oa=true, cited_by_count=...,
# authorships_institutions_id=..., language=..., awards_funder=...
```

- OpenAlex native API supports all filter types including `institution`, `language`, `funder`. MCP surfacing pending.

### snowball_search (Citation Expansion)

```text
snowball_search(
  paper_id="<doi_or_semantic_id>",     # Seed paper identifier
  direction="both",                     # "forward", "backward", or "both"
  max_results_per_direction=30,         # Max papers per direction per layer
  depth=1,                              # Recursion depth (1..3)
)
```

- Use when `seed_paper` factors are present
- `direction="forward"` → papers that cite the seed (citing)
- `direction="backward"` → papers cited by the seed (references)
- `direction="both"` → both directions combined

---

## Query Construction Examples

### Example 1: Simple Concept Search

**Factors:**

- `query`: "retrieval augmented generation"
- `field`: "computer science"
- `year_range`: "2021-2024"

**Semantic Scholar call:**

```text
search_semantic(query="retrieval augmented generation", year="2021-2024", max_results=15)
# field="computer science" factor: filter results in-memory post-retrieval (fields_of_study not exposed).
```

**OpenAlex call:**

```text
search_openalex(query="retrieval augmented generation", max_results=15)
# field and year_range factors: filter results in-memory post-retrieval (MCP does not expose
# primary_topic_display_name or publication_year).
```

---

### Example 2: Author + Venue Focus

**Factors:**

- `query`: "diffusion models"
- `author`: "Sohl-Dickstein"
- `venue`: "ICML"

**Semantic Scholar call:**

```text
search_semantic(query="diffusion models", max_results=15)
# author / venue factors: post-retrieval filter on result.authors / result.venue
# (MCP does not expose author=, venue=).
```

**OpenAlex call:**

```text
search_openalex(query="diffusion models", max_results=15)
# author / venue factors: post-retrieval filter (MCP does not expose
# authorships_author_display_name or primary_location_source_display_name).
```

---

### Example 3: Seed Paper with Snowball

**Factors:**

- `query`: "protein structure prediction"
- `seed_paper`: "10.1038/s41586-021-03819-2" (AlphaFold2 DOI)
- `year_range`: "2021-2024"

**Calls:**

```text
search_semantic(query="protein structure prediction", year="2021-2024", max_results=15)
snowball_search(paper_id="10.1038/s41586-021-03819-2", direction="both", max_results_per_direction=30)
```

---

### Example 4: Multiple Primary Factors — Round-by-Round

**Factors:**

- `query`: "knowledge graph"
- `method`: "graph neural network"
- `keyword`: "entity alignment"
- `field`: "computer science"

**⚠️ Do NOT combine into one query.** Each primary factor gets its own search round:

**Round 1 — query "knowledge graph":**

```text
search_semantic(query="knowledge graph", max_results=15)
search_openalex(query="knowledge graph", max_results=15)
# field="computer science" applied post-retrieval (filter by result.fields_of_study).
```

**Round 2 — method "graph neural network":**

```text
search_semantic(query="graph neural network", max_results=15)
search_openalex(query="graph neural network", max_results=15)
```

**Round 3 — keyword "entity alignment":**

```text
search_semantic(query="entity alignment", max_results=15)
search_openalex(query="entity alignment", max_results=15)
```

Results from all rounds are combined and deduplicated via `lit_search_ingest` (new literature-service; returns scored `unique` list without writing the library).

---

## Result Field Mapping

When processing results, extract and normalize these fields; `lit_search_ingest` handles both deduplication and scoring internally, so no separate dedup/score calls are needed:

| litreview field  | Semantic Scholar field | OpenAlex field                          |
| ---------------- | ---------------------- | --------------------------------------- |
| `title`          | `title`                | `title`                                 |
| `authors`        | `authors[].name`       | `authorships[].author.display_name`     |
| `year`           | `year`                 | `publication_year`                      |
| `venue`          | `venue.name`           | `primary_location.source.display_name`  |
| `doi`            | `externalIds.DOI`      | `doi`                                   |
| `abstract`       | `abstract`             | `abstract_inverted_index` (reconstruct) |
| `citation_count` | `citationCount`        | `cited_by_count`                        |
| `semantic_id`    | `paperId`              | N/A                                     |
| `openalex_id`    | N/A                    | `id`                                    |

Use DOI as the primary deduplication key when available. Fall back to normalized title + year + first author.

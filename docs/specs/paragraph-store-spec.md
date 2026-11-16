<a id="论文段落库-specparagraph-&#45;block-store"></a>

# Paper Paragraph Store Spec (Paragraph / Block Store)

> **Status**: Draft · Awaiting review
> **Related issue**: To be created
> **Related PR**: Not yet opened
> **Input dependencies**: Existing structured `.txt` pipeline (`zotero-structured-txt/`, `zotero-pdf-parser/strategies/structured/`), `config-paths.ts`
> **Domain language source of truth**: Glossary in §2 of this spec

---

<a id="1-背景与目标"></a>

## 1. Background and Goals

<a id="11-诉求"></a>

### 1.1 Need

**Deterministically split and store entire PDFs in a database**, enabling **fast, on-demand retrieval of original text by paper + section / paragraph with zero LLM calls and zero generation tokens**.

<a id="12-先厘清两个事实消除误解"></a>

### 1.2 Clarify Two Facts First (Avoid Misunderstandings)

- **`read_article_section` reading `.txt` does not use an LLM**: Structured `.txt` is a deterministic pdfjs parsing artifact; reading sections takes milliseconds of file access without model calls. Only generating `.article.md` summaries is slow/token-consuming; it is unrelated to paragraph retrieval.
- **The existing `chunks` table is a lossy subset optimized for search**: `isLowQualityText` filtering, `truncateAtReferences` truncation, short-paragraph merging, and long-paragraph splitting yield only 53–68% measured coverage. **It cannot serve as a complete paragraph store**.

<a id="13-现有产物"></a>

### 1.3 Existing Artifacts

| Artifact | Completeness | Purpose |
|------|--------|------|
| `~/.asci/zotero/wiki/{key}.txt` | **Complete** (pdfjs full text + structure) | Original full-text retrieval (this spec's data source) |
| `chunks` table in `vector-index.db` | Lossy (search subset) | Semantic / FTS search |

<a id="14-已决定用户拍板"></a>

### 1.4 Decisions Already Made (User Decision)

- Form: **Programmatic SQL queries → new paragraph table**, rather than reading files whenever sufficient.
- Scope: **Faithfully store all full text**, including reference/formula/table “noise” blocks, without reusing `isLowQualityText` filtering.
- Exposure: **Service-layer functions only initially**, without MCP tools / IPC until consumers are identified.

<a id="15-关键发现驱动粒度设计"></a>

### 1.5 Key Finding (Driving Granularity)

Measured LoRA structured `.txt`: **20 `<p id>` paragraphs, but 31 headings + 13 list lines**. Much content (section titles, lists, tables, reference entries) **is outside `<p id>`**.

→ **Conclusion: Storing only `<p id>` paragraphs does not preserve full text and loses over half the structure.** Store structural blocks, not just `<p>` paragraphs.

<a id="151-数据准确度边界重要"></a>

### 1.5.1 Data Accuracy Boundaries (Important)

The paragraph store is a **faithful mirror** of structured `.txt`: **it neither introduces nor repairs parsing errors; its accuracy ceiling is txt parsing accuracy** (garbage in, garbage out). Measurements across 65 library papers:

| Phenomenon | Measured | Nature |
|------|------|------|
| Missing / incorrect section numbers | **0/65** | Reliable section boundaries → `getSection` does not target the wrong section |
| Declared sections without corresponding `<p id>` paragraphs | 15/65 (23%) | **Mostly not errors**: Sections contain tables/lists/figures without prose → **precisely what storing all blocks covers; `<p>`-only storage would lose entire sections** |
| Garbled formula/table text (mathematical bold / replacement characters) | 10/65 (15%) | **Actual loss**: pdfjs extracts formulas/tables poorly; garbling enters storage **unchanged**, affecting **local block text**, not body prose |

**Tradeoffs**:
- Reliable section positioning preserves the store's central value of retrieving original text by section; some block content (formulas/tables), not structure, is damaged.
- The store is rebuildable: future pdfjs extractor improvements repair past content through rebuilds (**extractor fixes are separate work, outside this spec**).
- Store `byte_range` + raw content for comparison / reimport at any time.
- **Add per-paper parsing-quality flags** (see §3.2 `block_source`) so consumers can distinguish trustworthy from questionable paper/section content rather than trusting blindly.

<a id="16-非目标"></a>

### 1.6 Non-Goals

- Do not replace vector search (semantic / FTS still uses `chunks`); the paragraph store only retrieves original text deterministically by position.
- Do not generate LLM summaries (unrelated to `.article.md`).
- Do not change structured `.txt` generation (the store is a read-only derivative).

---

<a id="2-术语表"></a>

## 2. Glossary

| Term | Meaning |
|------|------|
| **block (structural block)** | One structural unit in the structured txt body: heading / paragraph (`<p id>`) / list / table / preamble |
| **section_index** | Section number (= S in `<p id="pS_P">`, = N in heading prefix “N.”; preamble = 0) |
| **para_id** | Paragraph anchor `pS_P` (paragraph blocks only; consistent with chunks/anchors and `read_article_section`) |

---

<a id="3-设计"></a>

## 3. Design

<a id="31-数据源与派生关系"></a>

### 3.1 Data Source and Derivation

The original diagram shows the existing deterministic full-text PDF→pdfjs→structured .txt pipeline, read-only body parsing into structural blocks, and deterministic blocks-table upsert without LLM use.

```
PDF → (pdfjs) structured .txt   ← existing, deterministic, complete
        │  this spec parses read-only; no modification
        ▼
   parse body → structural blocks → upsert blocks table (deterministic, no LLM)
```

The vector `chunks` store (search) and this table (original text retrieval) **align via attachment_key + para_id**: a semantic search hit gives a chunk → inspect S in its anchor → retrieve the full section here by section_index.

<a id="32-表结构faithful-blocks"></a>

### 3.2 Table Structure (Faithful Blocks)

Use independent database `~/.asci/zotero/paragraphs.db` (**model independent**, dependent only on txt; decoupled from embedding lifecycle, so changing embedding models does not rebuild it).

```sql
CREATE TABLE blocks (
  id             INTEGER PRIMARY KEY,
  attachment_key TEXT NOT NULL,
  section_index  INTEGER NOT NULL,         -- S；preamble=0
  section_title  TEXT,                     -- 来自 OUTLINE / heading 文本
  block_order    INTEGER NOT NULL,         -- 篇内全局顺序（重建原文用）
  block_type     TEXT NOT NULL CHECK (block_type IN ('heading','paragraph','list','table','preamble')),
  para_id        TEXT,                      -- "p3_1"，仅 paragraph 有
  content        TEXT NOT NULL,             -- 块原文（trim）
  byte_start     INTEGER, byte_end INTEGER  -- 在 .txt 内的字节范围
);
CREATE INDEX idx_blocks_key_section ON blocks(attachment_key, section_index, block_order);
CREATE UNIQUE INDEX idx_blocks_para ON blocks(attachment_key, para_id) WHERE para_id IS NOT NULL;

-- 增量 + 解析质量标记（§1.5.1）：消费方据此识别可信度
CREATE TABLE block_source (
  attachment_key   TEXT PRIMARY KEY,
  txt_hash         TEXT NOT NULL,
  built_at         INTEGER NOT NULL,
  format_version   INTEGER,                 -- txt frontmatter 的 format_version
  block_count      INTEGER NOT NULL,
  garble_ratio     REAL NOT NULL,           -- 乱码字符占比（数学粗体/替换符等），高=公式表格区不可信
  sections_no_prose INTEGER NOT NULL        -- 声明了但无 <p> 段落的章节数（多为表格/图章节）
);
```

> `garble_ratio` / `sections_no_prose` are **deterministically derived metrics** (computed while parsing), with zero additional cost, enabling query-side paper/section content reliability hints.

> Store everything: references / formulas / tables enter as normal `list`/`table`/`paragraph` blocks, **without filtering**.

<a id="33-查询-apiservice-层纯-sql无-token"></a>

### 3.3 Query API (Service Layer, Pure SQL, No Tokens)

`zotero-paragraph-store/index.ts` exposes section retrieval of all blocks in block_order, exact paragraph-anchor retrieval, section listing, and full-paper retrieval in block_order:

```ts
getSection(key, sectionIndex | sectionTitle): Block[]   // 按节取全块，block_order 升序
getParagraph(key, paraId): Block | null                 // 按锚点精确取
listSections(key): {index, title}[]                     // 章节目录
getFullText(key): Block[]                               // 整篇按 block_order
```

<a id="34-写入时机确定性跟随-txt-生成"></a>

### 3.4 Write Timing (Deterministic, Following Txt Generation)

Derive immediately after structured `.txt` is written (same timing as `generateStructuredTxtForOne` / full-batch entry): parse txt body → structural blocks → incremental upsert by `txt_hash`. **Do not attach to the embedding worker** (the paragraph store must work independently of semantic search being enabled).

<a id="35-对外暴露已定仅-service-层"></a>

### 3.5 External Exposure (Decided: Service Layer Only)

**Expose only §3.3 service functions this release**, without MCP tools / IPC. Add these after consumers are identified:
- Agent use → MCP tool `papers_read_section` (deterministic, replacing the txt path of `read_article_section`, faster and complete).
- UI display → four-way IPC synchronization.

---

<a id="4-开放问题"></a>

## 4. Open Questions

**Decided**: Exposure = service layer only (§3.5).

**Review decisions pending** (recommended defaults provided, open to revision):

1. **Block parsing source**: Parse persisted `.txt` body (decoupled, stable) versus reuse classifier token streams (more accurate structure but reruns pdfjs). Prefer **parsing txt body**.
2. **Database ownership**: Independent `paragraphs.db` (recommended, model independent) versus reusing `vector-index.db` (easy alignment but rebuilt alongside model changes).
3. **List/table granularity**: One row per list block or per item? Raw table text blocks or structured tables? Prefer **whole original-text blocks initially**, without structuring.

---

<a id="5-实现计划"></a>

## 5. Implementation Plan

| Stage | Content | Output |
|------|------|------|
| P0 | `paragraphs.db` schema + open/ensureSchema (follow vector-db.ts better-sqlite3 wrapper) | Usable database |
| P1 | txt body → structural block parser (heading/`<p id>`/list/table/preamble + section/byteRange) + unit tests | Pure function covering every block type |
| P2 | Derived writing: txt-ready hook + incremental `txt_hash` upsert | Automatic population following txt |
| P3 | Query service (getSection / getParagraph / listSections / getFullText) + unit tests | SQL retrieval of original text (this release's delivery endpoint) |
| P4 | Full backfill script (build tables for all existing .txt files; dev tool following rag-reindex) | One-command backfill |

> Service-layer exposure only (§3.5); MCP tools / IPC deferred until consumers are identified.

<a id="51-受影响的包与版本号"></a>

### 5.1 Affected Packages and Versions

- `apps/electron`: New paragraph-store service + write hook → patch increment (once at PR creation).
- No IPC / MCP this release (service only); no i18n (no user-facing text).

<a id="52-风险"></a>

### 5.2 Risks

- Changes to structured `.txt` format (`format_version`) affect the parser → tolerate by `format_version`, warn and degrade for unknown versions.
- Storing everything increases size (including references): plain text, tens to hundreds of KB per paper, acceptable; `paragraphs.db` is the same order of magnitude as vector-index.db.

---

## 6. Done When

1. [ ] Parser unit tests cover heading / paragraph / list / table / preamble + multilevel sections.
2. [ ] For any parsed paper, `getSection(key,'PROBLEM STATEMENT')` and `getFullText` return complete text in correct order, including references.
3. [ ] Incremental behavior: unchanged txt does not rebuild; changed txt synchronizes tables.
4. [ ] Paragraph store works independently of embedding toggles (queries work with semantic search disabled).
5. [ ] `bun run typecheck` / `bun test` pass.
6. [ ] Service-layer exposure only (no MCP/IPC).
7. [ ] Patch version incremented (at PR creation).

<a id="pdf-向量化质量-ai-评测-specvectorization-quality-eval"></a>

# PDF Vectorization Quality AI Evaluation Spec (Vectorization Quality Eval)

> **Status**: Draft · Awaiting review
> **Related issue**: To be created
> **Related PR**: To be opened
> **Input dependencies**: Existing Zotero embedding-index pipeline (`apps/electron/src/main/lib/zotero-embedding-index/*`, `document-extractor.ts`)
> **Domain source of truth**: Glossary in this spec §2

---

<a id="1-背景与目标"></a>

## 1. Background and Goals

<a id="11-要解决的问题"></a>

### 1.1 Problem

The vector pipeline (PDF → parsing → chunking → embedding → vec0 + FTS5) has shipped, but **there is no way to quantify vectorization quality**. Known clues:

- Dev library contains noise chunks (empty `KI7L76P8`, `'2 2 '` noise `4XW2QLJE`) missed by `isLowQualityText()`;
- Dev library `article` corpus layer is empty (only `raw` + `title_abstract`), suggesting LLM summarization did not trigger;
- FTS5 trigram has zero hits for two-character Chinese terms (known limitation).

These were found ad hoc, without a **repeatable, quantitative, regression-capable** evaluation tool.

<a id="12-核心洞察"></a>

### 1.2 Core Insight

> **Vectors are unreadable; accuracy cannot be judged directly. The only viable path converts vector quality into observable retrieval quality**: Use LLMs to synthesize standard question-answer pairs, replay through actual retrieval, and measure recall.

Chunks provide their own ground truth (the answer source), enabling recall measurement **without manual labeling**. This is the standard RAGAS / synthetic-eval approach.

<a id="13-目标与非目标"></a>

### 1.3 Goals and Non-goals

**Goals**
- Given a PDF, produce multidimensional markdown + JSON reports covering chunking, retrieval, and semantic quality;
- Reuse actual pipeline code for credible, regression-capable results;
- Offline script supporting batches of PDFs and averaging.

**Non-goals**
- No in-app visualization panel this release (possible later);
- No pipeline behavior changes (evaluation is read-only, except fixing chunker bugs exposed in §6 through separate PRs);
- No embedding-model replacement / RRF tuning (quantify baseline first, optimize later).

<a id="14-与现有-rag-eval-的关系重要"></a>

### 1.4 Relationship to Existing `rag-eval` (Important)

The repository already has a mature retrieval evaluation pipeline (`apps/electron/scripts/rag-eval.ts` + `RAG-EVAL.md`). **This tool complements, rather than replaces it**, maximizing infrastructure reuse.

| Dimension | Existing `rag-eval` | This tool `eval-vectorization` |
|------|----------------|---------------------------|
| Target | **Entire actual library** (`~/.asci-dev` vector-index.db) | **Single PDF**, isolated temporary index |
| Query source | Handwritten fixed fixtures (`rag-eval-queries.txt`, 30 items/7 categories) | **Automatically synthesized from PDF chunks**, with ground-truth chunkId |
| Core metrics | Coverage matrix (any hits) + manual/Claude P@5 | **Recall@k / MRR / false retrieval** (automatic ground-truth calculation) + L3 P@5 |
| Paths | Five, including old ripgrep comparison | Three (vector / FTS / RRF, focusing on vectorization) |
| L1 chunking checks | Only `--audit` library-wide junk counts | Single-paper coverage + noise + length distribution + truncation sampling |

**Reuse list** (import directly, no rewrite): `ZoteroVectorDb` (index/search/RRF), `E5Embedder`, lite parsing (`extractTextFromFile` + `wrapAsMarkdown`), `chunkWikiMarkdown` / `buildTitleAbstractChunk`, hit normalization and JSONL/summary conventions, Claude-as-judge rubric in `RAG-EVAL.md §4`.

---

<a id="2-术语表领域语言"></a>

## 2. Glossary (Domain Language)

| Term | Meaning |
|------|------|
| **Gold pair** | `(question, groundTruthChunkId)`: LLM question based on one chunk that **only that chunk can answer** |
| **Replay** | Send synthetic questions through actual `search()` and check recall of the correct chunk |
| **Three paths** | Pure vector KNN / pure FTS BM25 / RRF hybrid, evaluated separately to locate weaknesses |
| **L1/L2/L3** | Chunking / retrieval / semantic quality: three evaluation layers |
| **Distractor** | Question not answered in this PDF, measuring false-positive retrieval rate |

---

<a id="3-评测三层设计"></a>

## 3. Three-layer Evaluation Design

<a id="31-l1-&#45;切分质量前置体检便宜先跑"></a>

### 3.1 L1 — Chunking Quality (Cheap Prerequisite Checks First)

**Rule layer (pure SQL / functions, seconds):**
- Noise detection: Empty/ultrashort chunks with `LENGTH(TRIM(content)) < N` (reproduce known bug);
- Length distribution: min / avg / p50 / p95 / max, grouped by `text_kind`;
- **Coverage**: Recombine all `raw` chunks against original body, calculate character loss (missing content during chunking);
- Corpus completeness: Counts per `raw` / `article` / `title_abstract` layer, exposing empty article layers.

**LLM sampling:**
- Randomly sample ~15 `raw` chunks; Claude selects `完整 / 句中截断 / 混入页眉页脚噪声` (complete / truncated mid-sentence / header-footer noise), reporting proportions + counterexamples.

<a id="32-l2-&#45;检索质量核心"></a>

### 3.2 L2 — Retrieval Quality (Core) ⭐

**Synthetic queries (two types, separately evaluated):** Ask Claude to generate two query types per chunk (or sample), **because vector and FTS have different strengths; one type alone undervalues a path and misdirects tuning**:

| Query type | Generation | Main test |
|---------|---------|---------|
| **Semantic questions** | LLM paraphrase, **no copying rare chunk terms** | Actual embedding ability when lexical matches cannot do the work |
| **Keyword queries** | Extract entities / terms / numbers (including Chinese) | FTS trigram tokenization + two-character Chinese limitations |

**Other principles:**
1. Generate a few **distractors** with no PDF answer to measure false positives;
2. Annotate each query with source `chunkId` as ground truth;
3. Report **three-path metrics separately for both query types**. Expect "semantic: vector > FTS," "keywords: FTS > vector," and "RRF keeps up on both"; that is the purpose of hybrid evaluation.

**Replay + Three-path Comparison:**

| Path | `search()` arguments | Tests |
|----|----------------|--------|
| Pure vector | `queryEmbedding` only (question embedded with `kind='query'`) | Embedding / dimensions / chunk granularity |
| Pure FTS | `queryText` only | Trigram tokenization, including Chinese limitations |
| RRF hybrid | Both | Whether fusion exceeds the best single path |

> Implement without changes through exported pure `rrfFuse()` and optional `search()` arguments.

**Metrics:** `Hit@1/3/5/10`, `MRR@10`, distractor **false retrieval rate** (proportion treated as high-score hits). Calculate separately per path and compare side by side.

<a id="33-l3-&#45;语义质量llm-as-judge最贵"></a>

### 3.3 L3 — Semantic Quality (LLM-as-judge, Most Expensive)

- For each gold question's RRF top-5, Claude scores each chunk `0/1/2` (irrelevant / partly relevant / exact answer);
- Produce semantic `Precision@5`, `nDCG@5`;
- Separately list cases where the correct chunk is recalled but top-k includes off-target chunks: semantic mismatches numeric metrics miss.

---

<a id="4-技术方案"></a>

## 4. Technical Approach

<a id="41-形态脚本-&#45;claude-in-loop-两阶段对齐-rag-eval-运行约定"></a>

### 4.1 Form: Script + Two-phase Claude-in-loop (Aligned with rag-eval)

Add `apps/electron/scripts/eval-vectorization.ts`. **Cannot run directly with bun**: onnxruntime-node / better-sqlite3 / sqlite-vec are Electron-ABI native modules bun cannot load. Follow rag-eval: esbuild bundle (all native modules `--external`) → `ELECTRON_RUN_AS_NODE=1 electron dist/*.cjs`. Add two `package.json` commands:

```bash
# 阶段1 index：PDF → 隔离临时索引 + 导出 chunks.jsonl + L1 体检
#   --mode auto（默认）：先 structured（pdfjs+<p id>，= 生产主路），异常降级 lite —— 复刻生产 raw 层来源选择
#   --mode structured|lite：强制单路（A/B 对比用）；产物落 <paper-dir>/<实际模式>/
bun run eval:vec:index -- <pdf-path> [--mode auto|structured|lite]
# （Claude Code 读 chunks.jsonl 合成 qa.jsonl，带 answerText 答案片段 —— 见 §4.3）
# 阶段2 replay：qa.jsonl 回灌三路检索 → Recall/MRR + judge 用 run.jsonl
bun run eval:vec:replay -- <paper-dir> --mode structured|lite
# 对比：structured vs lite 并排 L2 指标
bun run eval:vec:compare -- <paper-dir>
# （Claude Code 读 run.jsonl 判 L3 相关性 → 汇总进 report.md）
```

English guide to preserved command comments: Phase1 index creates an isolated index, chunks.jsonl, and L1 checks. Default auto tries structured pdfjs+paragraph IDs, falling back to lite on extraction errors, matching production raw-source selection; forced structured/lite supports A/B and writes under the actual-mode directory. Claude synthesizes qa.jsonl with answerText (§4.3). Phase2 replay measures three-path recall/MRR and produces judge run.jsonl; compare places structured/lite L2 side by side; Claude judges L3 into report.md.

> **Parsing fidelity** (§4.2): Production raw prefers structured `.txt`, falling back to lite `.md`. Tool `auto` matches: structured by default, lite only on pdfjs extraction errors. Chunk boundaries differ (paragraph anchors vs byte offsets), so ground truth uses **normalized answerText substring matching**, not chunkId, allowing fair cross-mode reuse of qa.jsonl.

**Why two phases instead of one command**: QA synthesis requires already-chunked content, which exists only after indexing. LLM inference (synthesis/judging) follows **Claude-Code-as-judge** in `RAG-EVAL.md §4` (the conversational agent reads jsonl directly), adding no dependencies.

<a id="42-数据流复用真实-pipeline-&#45;rag-eval-基础设施"></a>

### 4.2 Data Flow (Reuse Actual Pipeline + rag-eval Infrastructure)

```
Phase1 index (script, deterministic native computation):
  extractTextFromFile(pdfPath)            // Reuse lite parsing (= production raw source)
    → wrapAsMarkdown(...)                 // Production-equivalent wiki md
    → chunkWikiMarkdown(md) + buildTitleAbstractChunk(...)
    → E5Embedder.embed(texts,'passage')   // 384 dimensions, same production prefix
    → ZoteroVectorDb.open(eval.db).replaceChunks(...)   // Isolated, not ~/.asci*
    → Export chunks.jsonl (id/textKind/anchor/content)
    → Write L1 checks (coverage / noise / length distribution) to report.md

  ↓ Claude Code reads chunks.jsonl → synthesizes qa.jsonl
     (semantic + keyword + distractor questions, each with groundTruthChunkId)

Phase2 replay (script, deterministic native computation):
  Each q → embed('query') → ZoteroVectorDb.search() three paths (vector/FTS/RRF)
    → Compare groundTruthChunkId for Hit@k / MRR / false retrieval
    → Write run.jsonl (top-k per question, for judge) + report.md metrics

  ↓ Claude Code reads run.jsonl → judges L3 with RAG-EVAL.md rubric
     → Aggregate P@5 / nDCG + off-target cases into report.md
```

English rendering: Phase1 deterministic native indexing extracts lite text, wraps production-equivalent wiki markdown, chunks and builds title/abstract, embeds passages at 384 dimensions using production prefixes, replaces chunks in isolated eval.db, exports id/textKind/anchor/content, and writes L1 coverage/noise/length to report.md. Claude generates semantic/keyword/distractor qa.jsonl with groundTruthChunkId. Phase2 embeds queries and runs vector/FTS/RRF search, computes Hit@k/MRR/false retrieval, and writes per-question top-k run.jsonl plus report metrics. Claude applies the RAG-EVAL rubric for L3 P@5/nDCG and off-target cases.

**Key constraints:**
- Index chunks use `kind='passage'`, questions `kind='query'`, matching production E5 dual prefixes; otherwise metrics are distorted;
- DB resides in gitignored `docs/superpowers/vec-eval-runs/<pdf-slug>/eval.db`, aligned with rag-eval; **isolated, never touching real `~/.asci*`**. Same DB must survive both phases, so not `os.tmpdir()`; user may delete the directory after completion;
- `ZoteroVectorDb.open()` loads vec0 like production, falling back to pure FTS if unavailable.

<a id="43-llm-调用方式claude-code-in-loop对齐-rag-evalmd"></a>

### 4.3 LLM Invocation: Claude-Code-in-loop (Aligned with RAG-EVAL.md)

QA synthesis and L3 judging need LLMs. Existing convention (`RAG-EVAL.md §4`) uses **Claude-Code-as-judge**: Scripts only produce/consume jsonl; conversational Claude Code performs inference. Follow it:

- **QA synthesis**: Read `chunks.jsonl`, generating `qa.jsonl` per §3.2 (semantic paraphrase without rare-word copying, entity/term keywords, distractors);
- **L3 judgment**: Read `run.jsonl`, judging relevance item by item with the rubric.

> No `ANTHROPIC_API_KEY` / SDK / channel-manager keys needed. **For future unattended CI**, encode these two steps in TS, reusing app provider/channel keys and the same jsonl contract, consistent with RAG-EVAL.md §4's evolution path.

<a id="44-报告结构"></a>

### 4.4 Report Structure

```markdown
## PDF: "xxx" | 42 chunks (raw 40 / title_abstract 2 / article 0 ⚠️)

### L1 Chunking Quality
Coverage 98.7% | 2 noise chunks (id 17,31) | Mid-sentence truncation 13% (15 sampled)
Raw lengths: min 40 / p50 280 / p95 520 / max 1840

### L2 Retrieval Quality (60 semantic + 60 keyword + 10 distractor queries)
              Semantic(Hit@5)      Keyword(Hit@5)
Vector          0.82                 0.61
FTS             0.70                 0.93   ← Recovers on its strongest task
RRF hybrid      0.91                 0.95   ✓ Keeps up on both
(Each cell also includes Hit@1 / MRR / false retrieval, omitted here)

### L3 Semantic Quality
Precision@5 = 0.78 | nDCG@5 = 0.81 | 7 off-target cases (appendix)
```

The preserved sample reports 42 chunks (raw 40 / title_abstract 2 / article 0 warning); L1 coverage 98.7%, 2 noise chunks (17,31), 13% sentence truncation from 15 samples, raw lengths min 40/p50 280/p95 520/max 1840. L2 uses 60 semantic + 60 keyword + 10 distractor queries, semantic/keyword Hit@5: vector .82/.61, FTS .70/.93, RRF .91/.95, plus omitted per-cell Hit@1/MRR/false retrieval. L3 Precision@5 .78, nDCG@5 .81, 7 off-target cases in appendix.

Persist JSON too, including per-question hit ranks and judge scores for regression diffs.

---

<a id="5-实现计划"></a>

## 5. Implementation Plan

| Phase | Content | Output |
|------|------|------|
| P0 | `index` scaffolding: CLI, esbuild+electron wiring, reused lite parsing→chunk→embed→isolated eval.db, chunks.jsonl export | PDF→isolated DB works, prints chunk count |
| P1 | **L1** rule statistics (coverage / noise / lengths) in report.md + Claude truncation sampling | L1 report section |
| P2 | Claude synthesizes semantic+keyword+distractor qa.jsonl from chunks.jsonl → `replay` three-path Recall/MRR/false retrieval → run.jsonl | L2 report section (core) |
| P3 | Claude judges run.jsonl using rubric → L3 P@5/nDCG + off-target cases | L3 report section |
| P4 | Aggregate report.md, `--top`/`--n`, multi-paper averages | Complete tool + usage section in RAG-EVAL.md |

Each phase independently verifiable: P0 correct chunk counts; P2 sensible three-path metrics (RRF ≥ best single path; keyword FTS should exceed vector).

<a id="51-受影响的包与版本号"></a>

### 5.1 Affected Packages and Versions

- `apps/electron`: New script + two `package.json` `eval:vec*` commands + exclude `dist/eval-vectorization.cjs` in `electron-builder.yml` (unpackaged, aligned with rag-eval) → patch increment once at PR creation.
- No IPC / i18n / shared constants (dev-only script, no user UI copy).
- Outputs in gitignored `docs/superpowers/vec-eval-runs/`, never committed.

<a id="52-风险与取舍"></a>

### 5.2 Risks and Tradeoffs

- **Synthetic-question quality determines everything**: Copying chunk words inflates FTS and distorts vector evaluation → enforce paraphrasing in P2 prompts, manually inspect initial items;
- **LLM judgment variance**: Strong L3 judge + explicit rubric, repeated judging with majority vote if needed;
- **Small single-PDF sample**: Hit@k over 40 chunks fluctuates → multi-paper averages needed for statistical meaning (P4);
- **Chunker bugs are separate**: L1 reproduces noise, but **fix `isLowQualityText()` in a separate PR**, outside evaluation tooling.

---

## 6. Done When

1. [ ] `bun run eval:vec:index -- <pdf>` → `eval:vec:replay` works in two phases, producing three-layer report.md;
2. [ ] Sensible three-path metrics (RRF Hit@5 no lower than best single path; keyword FTS exceeds vector);
3. [ ] eval.db confirmed under `docs/superpowers/vec-eval-runs/`, no `~/.asci*` access; app runtime never imports script;
4. [ ] Report readability verified with at least 1 Chinese + 1 English PDF;
5. [ ] `bun run typecheck` passes;
6. [ ] `electron-builder.yml` excludes `dist/eval-vectorization.cjs`; patch version incremented at PR creation.

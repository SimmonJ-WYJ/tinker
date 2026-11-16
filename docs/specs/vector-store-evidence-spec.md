<a id="文献向量索引-&#45;语义检索-specvector-index-&#45;semantic-search-specification"></a>

# Literature Vector Index + Semantic Search Spec (Vector Index & Semantic Search Specification)

> **Status**: Design decided (grill-with-docs nine questions, 2026-06-02) · Implementation complete (PR1/2/3 + simplify review; manual golden path pending)
> **Related branch**: `feat/vector-store-evidence`
> **Related ADR**: [ADR-012 Local Embedding Selection](../adr/ADR-012-local-embedding-vector-index.md)
> **Domain language source of truth**: [CONTEXT.md Literature Corpus and Retrieval](../../CONTEXT.md)
> **Related issue**: (Fill after development)

---

<a id="1-问题与目标"></a>

## 1. Problem and Goals

With many papers (tens to hundreds), Agent Q&A/reviews read wiki md one paper at a time through `papers_read_*`, slowly consuming context; evidence assembly reaches only paper-level granularity.

**Success criteria** (grill Q1 decision):
1. **Assembly quality**: More accurate and complete Agent evidence selection, with paragraph-level citation anchors.
2. **Response speed**: Noticeably faster Q&A/reviews with many papers and lower context use.

Out of scope this release: searching evidence sets themselves (await ADR-007 M:N containers); UI semantic-search field (query service remains reusable by future IPC).

<a id="2-九项设计裁决与用户逐条确认"></a>

## 2. Nine Design Decisions (Confirmed Individually with the User)

| # | Decision | Main Reason |
|---|------|----------|
| Q1 | Success = assembly quality + response speed | Above |
| Q2 | Consumer = Agent MCP tools only (add `papers_semantic_search` to in-process `papers-rg` server) | Extractor already scans papers-rg; main process can directly open SQLite/onnx |
| Q3 | Embedding = local ONNX (quantized multilingual-e5-small, 384 dimensions) | ADR-012: zero configuration/privacy/no Provider-layer changes |
| Q4 | Storage = sqlite-vec + independent index `~/.asci/zotero/vector-index.db` | **Rebuildable cache**, outside asci.db migration; delete/rebuild on model changes |
| Q5 | Three corpus layers: raw paragraphs (baseline) + LLMWiki summaries (enhancement) + title/abstract (coarse recall) | LLMWiki becomes a retrieval-quality enhancer |
| Q6 | Scope = one global index; query-time attachmentKeys filtering | Index follows corpus (literature library), not consumers (workspaces) |
| Q7 | Trigger = automatic by default + event-driven increments; **evaluation master switch** gates worker + tool registration | Zero local cost → stable tool availability; switch-off restores baseline for A/B |
| Q8 | Retrieval = vector KNN + FTS5(BM25, trigram), fused by RRF | Exact research terms (gene names/abbreviations) + small-model quality fallback |
| Q9 | Evidence write-back = new extractor scanning branch, paragraph anchors + chunk original text as snapshotText | This passage is the evidence, rather than this paper is related |

<a id="3-架构"></a>

## 3. Architecture

The retained diagram traces parser/deletion and LLMWiki events through onEmbedSourceReady/onEmbedSourceDeleted, queue/worker, content-hash increments, dual-anchor chunking, batch embedding, transactional storage, KNN/BM25→RRF/per-paper deduplication, per-session gated MCP tools, and paragraph-level EvidenceRef extraction from top hits.

```
┌─ Event sources ──────────────────────────────────────────────┐
│ zotero-pdf-parser（parse complete/delete）                      │
│ zotero-article-generator（LLMWiki generation complete）            │
└──────────────┬───────────────────────────────────────┘
               ▼ onEmbedSourceReady / onEmbedSourceDeleted
┌─ zotero-embedding-index（main process, following article trio）────┐
│ queue → worker.runOne(key)：                           │
│   read .md/.article.md/index.json → content_hash incremental check │
│   → chunker (dual anchors) → embedder batch inference          │
│   → vector-db three-table transactional write                              │
└──────────────┬───────────────────────────────────────┘
               ▼
┌─ vector-index.db（rebuildable cache）─────────────────────────┐
│ meta（model_id/embed_dim）                             │
│ chunks（anchors+original text+hash） + vec_chunks（vec0） + fts_chunks│
└──────────────┬───────────────────────────────────────┘
               ▼ hybrid retrieval (KNN ∪ BM25 → RRF → per-paper deduplication)
┌─ papers-rg MCP（in-process）────────────────────────────────┐
│ papers_semantic_search（evaluation-switch gated registration, checked per session）    │
└──────────────┬───────────────────────────────────────┘
               ▼ tool results (paperId + anchor + snippet)
┌─ evidence-conversation-citations-extractor ───────────┐
│ new scan branch → paragraph EvidenceRef candidates (top hit per paper)│
└───────────────────────────────────────────────────────┘
```

<a id="31-双轨锚点语料现实"></a>

### 3.1 Dual Anchors (Actual Corpus)

Raw md from the default lite strategy **lacks** `<p id>` anchors (45 of 47 locally measured papers used lite):

| Corpus Form | Splitting | Anchor Format |
|----------|------|----------|
| structured md / .article.md (with `<p id="pS_P">`) | Paragraph tags | `p3_1` (paragraph id) |
| lite md (plain text) | Merge lines to ~300 tokens | `b12345` (body byte offset, matching `papers_read_context` byteOffset addressing) |
| title+abstract (index.json) | One per paper | null |

### 3.2 vector-index.db Schema

See the header comment of `apps/electron/src/main/lib/zotero-embedding-index/vector-db.ts` (source of truth). Key points:
- `chunks` (id primary key) + `vec_chunks` (vec0, aligned rowid) + `fts_chunks` (FTS5 external-content, trigram).
- meta.model_id / embed_dim mismatch with current model → delete/rebuild the database.
- Replace each paper/layer atomically (three tables synchronized in one transaction); incremental key `attachment_key + content_hash + model_id`.

<a id="33-模型分发"></a>

### 3.3 Model Distribution

Quantized `multilingual-e5-small` ONNX (118MB) + tokenizer.json (17MB) + tokenizer_config.json,
downloaded at runtime from HF primary / hf-mirror to `~/.asci/models/{modelId}/` (`embedding-model-service.ts`,
state machine following `asr-weights-service.ts`; proxy via `getEffectiveProxyUrl()`; file-level resumption).

<a id="34-评估开关ab"></a>

### 3.4 Evaluation Switch (A/B)

`enabled` in `~/.asci/zotero-embedding.json` (default true) gates both:
1. Whether the embedding worker indexes on events.
2. Whether `agent-orchestrator` registers `papers_semantic_search` when creating papers-rg server (**once per session**, avoiding toolset changes mid-session).

Off = Agent returns to the per-paper-reading baseline; compare with on to assess retrieval value.

<a id="4-mcp-工具契约papers_semantic_search"></a>

## 4. MCP Tool Contract (papers_semantic_search)

- Input: `query` (1~512 characters), `attachmentKeys?`, `maxResults?` (default 10, maximum 50), `textKinds?`.
- Output: `ZoteroSemanticSearchResult` (see `packages/shared/src/types/zotero-embedding.ts`).
  - `degraded: 'model_not_ready' | 'index_empty'`: Explicit degradation without throwing.
  - hits include `paperId / textKind / anchorStart / anchorEnd / snippet / score`.

<a id="5-实现地图pr-切分"></a>

## 5. Implementation Map (PR Split)

<a id="pr1-&#45;索引基础设施-"></a>

### PR1 — Index Infrastructure ✅
- `packages/shared/src/types/zotero-embedding.ts` — Types + default configuration.
- `apps/electron/src/main/lib/zotero-embedding-index/{vector-db,chunker,embedder}.ts` + unit tests.
- `apps/electron/src/main/lib/embedding-model-service.ts` — Model download.
- `config-paths.ts`: `getZoteroVectorIndexPath` / `getEmbeddingModelsDir` / `getZoteroEmbeddingConfigPath`.
- Dependencies: `sqlite-vec@0.1.9` (requires --external + packaging allowlist), `@huggingface/tokenizers@0.1.3` (pure JS, directly bundled).
- Test-driver note: bun test lacks better-sqlite3 native support (bun#4290) → minimal `RawVectorDb` interface + bun:sqlite adapter; real vec0 path covered by Electron smoke test.

<a id="pr2-&#45;worker-&#45;事件钩子-&#45;agent-工具-&#45;证据回写"></a>

### PR2 — Worker + Event Hooks + Agent Tool + Evidence Write-Back
- `zotero-embedding-index/{queue,worker,index}.ts` (following zotero-article-generator).
- Hooks: pdf-parser worker (after md write / cleanupMd), article-generator worker (after article write).
- New tool in `papers-rg-tool.ts` (query function injected through deps); `agent-orchestrator.ts` registers by switch.
- Tool instructions (English) in `agent-prompt-builder.ts`.
- New branch + tests in `evidence-conversation-citations-extractor.ts`.

<a id="pr3-&#45;设置页-uiipc-四联-&#45;i18n-enzh"></a>

### PR3 — Settings UI (Four-Way IPC + en/zh i18n)
- New EMBED_* channels in `ZOTERO_IPC_CHANNELS` → ipc.ts → preload → atoms + `ZoteroEmbeddingPanel.tsx`.

<a id="6-打包硬约束claudemd-71-对齐"></a>

## 6. Packaging Hard Constraints (Aligned with CLAUDE.md §7.1)

- Append `--external:sqlite-vec --external:onnxruntime-node` to esbuild `build:main`/`watch:main`.
- Add `node_modules/sqlite-vec/**/*` and `node_modules/sqlite-vec-*/**/*` to `electron-builder.yml` files allowlist.
- **No ABI risk**: onnxruntime-node uses N-API (no rebuild); sqlite-vec is a SQLite loadable extension (dylib, loaded by SQLite).
- ONNX models remain outside the package (runtime downloads).

<a id="7-验证清单"></a>

## 7. Verification Checklist

1. `bun run typecheck` / `bun test` fully green (including key parity).
2. `dist:fast` smoke test: sqlite-vec/onnxruntime-node packaged, no native startup errors, actual vec0 path can create tables.
3. Golden path: Enable switch → model download progress → newly parsed PDF automatically queued → Agent calls `papers_semantic_search` → generated evidence includes paragraph anchors → Zotero paper deletion cleans up → settings zh↔en without raw keys.
4. Boundaries: `model_not_ready` / `index_empty` degradation; attachmentKeys filtering; new sessions lack tool after disabling.

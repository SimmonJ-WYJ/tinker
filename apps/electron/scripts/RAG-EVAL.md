<a id="rag-检索评估流水线dev-only"></a>

# RAG Retrieval Evaluation Pipeline (dev-only)

A repeatable evaluation suite measuring "vector-index recall quality." It formalizes a five-path retrieval comparison:
**Rebuild index → run retrieval comparison → produce machine-readable JSONL → (Claude Code or future programmatic judge) judge relevance P@5**.

> Entirely dev-only: Scripts live under `scripts/`, are excluded from the electron-builder `files` allowlist, and write artifacts to gitignored `docs/superpowers/`.

---

<a id="1-命令都在-appselectron-下跑"></a>

## 1. Commands (Run All Under `apps/electron`)

| Command | Purpose | Notes |
|---|---|---|
| `bun run eval:rag:full` | **Rebuild index → run evaluation** (end to end) | After chunker/model changes, or for a clean-index retest; **close the dev app first** |
| `bun run eval:rag:jsonl` | Evaluate using the existing index (no rebuild, fast) | Retest an unchanged index; produces `run.jsonl` + `summary.md` |
| `bun run reindex:rag` | Rebuild only (delete database → re-embed everything) | CLI equivalent of settings "Rebuild index"; **close the dev app first** (WAL conflicts) |
| `bun run eval:rag -- --file scripts/rag-eval-queries.txt --out <目录>` | Per-item markdown with a "Relevant?" column (manual judgment) | For manual item-by-item judging; the preserved command placeholder means directory |
| `bun run eval:rag -- --audit` | Read-only audit of junk chunk counts in the current index | Estimate cleanup benefits after chunker changes |

Prerequisites: Embedding model downloaded and index built (visible in settings). Default data source: `~/.asci-dev` (script hardcodes `ASCI_DEV=1`).

---

<a id="2-涉及的文件"></a>

## 2. Files Involved

<a id="评估脚本-&#45;夹具tracked"></a>

### Evaluation Scripts / Fixtures (Tracked)
- `scripts/rag-eval.ts` — **Producer**: Five-path comparison (ripgrep.md / ripgrep.txt / FTS5 / vector / hybrid) → JSONL + markdown + `--audit`
- `scripts/rag-reindex.ts` — Delete database + full re-embedding (reuses `worker.runOne` + actual `E5Embedder`)
- `scripts/rag-eval-queries.txt` — Query fixtures: 30 items / 7 categories, one `查询 | 分类` (query | category) per line, including **Chinese↔English parallel comparisons**
- `package.json` — The 4 `eval:rag*` / `reindex:rag` commands above
- `electron-builder.yml` — Excludes `dist/rag-eval.cjs`, `dist/rag-reindex.cjs` from packaging

<a id="评估依赖的生产代码脚本-import"></a>

### Production Code Imported by Evaluation Scripts
- `src/main/lib/zotero-embedding-index/vector-db.ts` — `ZoteroVectorDb.search` (FTS5/vector/hybrid RRF)
- `…/embedder.ts` — `E5Embedder` (query→vector)
- `…/chunker.ts` — `chunkWikiMarkdown` (rebuild) + `isLowQualityText` (audit)
- `…/worker.ts` — `runOne` (single-paper embedding)
- `…/config.ts` — Three retrieval modes
- `src/main/mcp/papers-rg-tool.ts` — ripgrep keyword path (evaluation reproduces its criteria)
- `src/main/lib/config-paths.ts` — Index/wiki/model paths
- `packages/shared/src/types/zotero-embedding.ts` — Types such as `ZoteroSemanticSearchHit`

<a id="单元测试bun-test守护上面逻辑用-bunsqlite-&#45;stub-向量不碰真实模型"></a>

### Unit Tests (`bun test`, Protecting the Above Logic; bun:sqlite + Stub Vectors, No Real Models)
- `…/zotero-embedding-index/{chunker,vector-db,worker,embedder,config}.test.ts`
- `src/main/mcp/papers-rg-tool.test.ts`

<a id="生成产物gitignoreddocssuperpowers"></a>

### Generated Artifacts (Gitignored, `docs/superpowers/`)
- `rag-eval-runs/<时间戳>/run.jsonl` — **Machine-readable** (line 0=RunMeta fingerprint + five-path ranked hits for each query); the preserved placeholder means timestamp
- `rag-eval-runs/<时间戳>/summary.md` — Hit matrix + coverage
- `rag-eval-runs/<时间戳>/judged.md` — Judged P@5 (relevance)
- `rag-eval-results*/` — Early `--out` per-item markdown + before/after cleanup reports
- `rag-review-eval-playbook.md` — Manual review (task-level) evaluation playbook

<a id="运行期数据不在-repoasci-dev"></a>

### Runtime Data (Outside the Repo, `~/.asci-dev/`)
- `zotero/vector-index.db` vector index (rebuildable cache) · `zotero/wiki/` paper corpus (.md/.txt) · `models/multilingual-e5-small-q8/` embedding model

---

<a id="3-看结果"></a>

## 3. Reading Results

Each run creates a timestamped directory `docs/superpowers/rag-eval-runs/<ts>/`:
- **`summary.md`**: Start here: hit matrix + coverage per path + category×path coverage (**coverage ≠ relevance**)
- `run.jsonl`: Machine-readable judge input
- `judged.md`: Relevance P@5 (produced by the judge, below)

---

<a id="4-判相关性p5-现阶段claude-code-as-judge"></a>

## 4. Judging Relevance (P@5) — Current Approach: Claude Code as Judge

Coverage says only "was there a hit?" Relevance (whether a hit can actually serve as evidence) currently comes from giving `run.jsonl` to Claude Code.
Say "**Judge the latest run using the RAG-EVAL.md rubric**" in the conversation. Command to extract hits:

```bash
python3 -c "
import json
lines=open('docs/superpowers/rag-eval-runs/<ts>/run.jsonl').read().splitlines()
for q in (json.loads(l) for l in lines[1:]):
    print(f\"### Q{q['index']:02d} [{q['category']}] {q['query']}\")
    for h in q['byPath']['vector']['hits']:
        print(f\"   {h['rank']}. {h['paperId']} {h.get('textKind') or '-'} | {' '.join(h['snippet'].split())[:95]}\")
"
```

<a id="rubric固定保证复跑口径一致"></a>

### Rubric (Fixed for Consistent Reruns)
Judge each item "relevant / irrelevant": Does the snippet or its paper **directly address the query's intent**?
- Main text/title/abstract of the target paper → relevant
- Related paper on the same topic (e.g. GQA query hits a MoH/MHA comparison) → relevant
- Bibliography tail / author biography / received date / purely numeric tables / cross-topic paper → irrelevant
- Cross-language: Determine whether the English paper answers the Chinese query's intent

**P@5 = relevant hits among top-5 / 5**; aggregate by path and category. The production primary path is `vector` (`hybrid` is usually nearly identical).

> For a future unattended CI gate, encode this rubric as a programmatic TS judge (reusing app provider/channel keys),
> consuming the same `run.jsonl` + `thresholds.json` regression floors; a nonzero exit code forms the gate.

---

<a id="5-已知结论截至最近一次-run"></a>

## 5. Known Findings (As of the Latest Run)

- Vector P@5: English/terminology ~0.80, cross-domain ~0.90; **Chinese ~0.23, comparative review (Chinese) ~0.30**.
- Chinese↔English parallel comparisons show nearly all low scores arise from **Chinese cross-language retrieval**, rather than review intent itself (English review P@5=0.80).
- Mitigation: Alternative A (Agent sends English queries instead, shipped, requires real-session verification); fully fixing Chinese-original retrieval requires a stronger multilingual model such as bge-m3.
- Remaining noise candidates (v2 chunk filtering): Bibliography tails, author biographies, received-date lines.

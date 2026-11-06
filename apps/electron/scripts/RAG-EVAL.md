# RAG 检索评估流水线（dev-only）

衡量「向量库召回质量」的可重复评估套件。把 5 路检索对比工程化成：
**重建索引 → 跑检索对比 → 产机器可读 JSONL → （Claude Code 或未来程序化 judge）判相关性 P@5**。

> 全部 dev-only：脚本在 `scripts/` 下、不进 electron-builder `files` 白名单，产物落 gitignored 的 `docs/superpowers/`。

---

## 1. 命令（都在 `apps/electron` 下跑）

| 命令 | 作用 | 备注 |
|---|---|---|
| `bun run eval:rag:full` | **重建索引 → 跑评估**（端到端） | chunker/模型改过、想从干净索引重测；**先关 dev app** |
| `bun run eval:rag:jsonl` | 跑评估（用现有索引，不重建，快） | 索引没变只想再测；产 `run.jsonl` + `summary.md` |
| `bun run reindex:rag` | 只重建索引（删库 → 全量重嵌） | = 设置页「Rebuild index」命令行版；**先关 dev app**（WAL 冲突） |
| `bun run eval:rag -- --file scripts/rag-eval-queries.txt --out <目录>` | 出带「相关?」列的逐条 markdown（人工判） | 想手工逐条判时用 |
| `bun run eval:rag -- --audit` | 只读审计现有索引里有多少垃圾 chunk | chunker 改后估算清理收益 |

前置：嵌入模型已下载、索引已建（设置页可见）。数据源默认 `~/.asci-dev`（脚本内置 `ASCI_DEV=1`）。

---

## 2. 涉及的文件

### 评估脚本 / 夹具（tracked）
- `scripts/rag-eval.ts` — **生产者**：5 路检索对比（ripgrep.md / ripgrep.txt / FTS5 / 向量 / 混合）→ JSONL + markdown + `--audit`
- `scripts/rag-reindex.ts` — 删库 + 全量重嵌（复用 `worker.runOne` + 真实 `E5Embedder`）
- `scripts/rag-eval-queries.txt` — query 夹具：30 条 / 7 类，每行 `查询 | 分类`，含**中↔英平行对照**
- `package.json` — 上面 4 个 `eval:rag*` / `reindex:rag` 命令
- `electron-builder.yml` — 排除 `dist/rag-eval.cjs`、`dist/rag-reindex.cjs`（不进包）

### 评估依赖的生产代码（脚本 import）
- `src/main/lib/zotero-embedding-index/vector-db.ts` — `ZoteroVectorDb.search`（FTS5/向量/混合 RRF）
- `…/embedder.ts` — `E5Embedder`（query→向量）
- `…/chunker.ts` — `chunkWikiMarkdown`（重建）+ `isLowQualityText`（审计）
- `…/worker.ts` — `runOne`（单篇嵌入）
- `…/config.ts` — 三档检索模式
- `src/main/mcp/papers-rg-tool.ts` — ripgrep 关键词路（评估复刻其口径）
- `src/main/lib/config-paths.ts` — 索引/wiki/模型路径
- `packages/shared/src/types/zotero-embedding.ts` — `ZoteroSemanticSearchHit` 等类型

### 单元测试（`bun test`，守护上面逻辑；用 bun:sqlite + stub 向量，不碰真实模型）
- `…/zotero-embedding-index/{chunker,vector-db,worker,embedder,config}.test.ts`
- `src/main/mcp/papers-rg-tool.test.ts`

### 生成产物（gitignored，`docs/superpowers/`）
- `rag-eval-runs/<时间戳>/run.jsonl` — **机器可读**（line0=RunMeta 指纹 + 每 query 五路 ranked hits）
- `rag-eval-runs/<时间戳>/summary.md` — 命中矩阵 + 覆盖率
- `rag-eval-runs/<时间戳>/judged.md` — 判出的 P@5（相关性）
- `rag-eval-results*/` — 早期 `--out` 逐条 markdown + 清理前后报告
- `rag-review-eval-playbook.md` — 综述（任务层）人工评估手册

### 运行期数据（不在 repo，`~/.asci-dev/`）
- `zotero/vector-index.db` 向量索引（可重建缓存） · `zotero/wiki/` 论文语料（.md/.txt） · `models/multilingual-e5-small-q8/` 嵌入模型

---

## 3. 看结果

每跑一次落一个时间戳目录 `docs/superpowers/rag-eval-runs/<ts>/`：
- **`summary.md`**：先看这个——命中矩阵 + 各路覆盖率 + 分类×链路覆盖率（**覆盖率 ≠ 相关性**）
- `run.jsonl`：机器可读，给 judge 用
- `judged.md`：相关性 P@5（由 judge 产出，见下）

---

## 4. 判相关性（P@5）—— 现阶段：Claude Code as judge

覆盖率只说「有没有命中」，相关性（命中是否真能当证据）目前靠把 `run.jsonl` 交给 Claude Code 判。
对话里说「**按 RAG-EVAL.md 的 rubric 判最新一次 run**」即可。抽取命中的命令：

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

### Rubric（固定，保证复跑口径一致）
逐条判「相关 / 不相关」：snippet 或其所属论文是否**直接回应 query 意图**。
- 命中正主论文正文/标题摘要 → 相关
- 同主题相关论文（如问 GQA 命中 MoH/MHA 对比）→ 相关
- 参考文献尾 / 作者简介 / 收稿日期 / 纯数字表 / 跨主题论文 → 不相关
- 跨语言：看英文论文内容是否答中文 query 的意图

**P@5 = top-5 中相关命中数 / 5**；按 path 聚合、按 category 聚合。生产主路看 `vector`（`hybrid` 通常与之近同）。

> 将来若要无人值守 CI 门禁，再把这套 rubric 写成程序化 TS judge（复用 app provider/channel 密钥），
> 吃的还是同一份 `run.jsonl` + `thresholds.json` 回归地板，非零退出码即门禁。

---

## 5. 已知结论（截至最近一次 run）

- 向量 P@5：英文/术语 ~0.80、跨域 ~0.90；**中文 ~0.23、对比综述（中文）~0.30**。
- 中↔英平行对照证明：低分几乎全是**中文跨语言**那一刀，非综述意图本身（英文版综述 P@5=0.80）。
- 缓解：方案 A（Agent 改发英文 query，已上线，需在真实会话验证）；根治中文原文检索需换 bge-m3 等更强多语模型。
- 残留噪声候选（v2 chunk 过滤）：引用尾、作者简介、收稿日期行。

# PDF 向量化质量 AI 评测 Spec（Vectorization Quality Eval）

> **状态**：草稿 · 待 review
> **关联 issue**：待建
> **关联 PR**：待开
> **依赖输入**：现有 Zotero 嵌入索引链路（`apps/electron/src/main/lib/zotero-embedding-index/*`、`document-extractor.ts`）
> **领域语言事实源**：本 spec §2 术语表

---

## 1. 背景与目标

### 1.1 要解决的问题

当前向量库链路（PDF → 解析 → 切分 → 嵌入 → vec0 + FTS5）已上线，但**没有任何手段量化"向量化得好不好"**。已知线索：

- dev 库存在噪声 chunk（空串 `KI7L76P8`、`'2 2 '` 噪声 `4XW2QLJE`）漏过 `isLowQualityText()`；
- `article` 语料层在 dev 库为空（只有 `raw` + `title_abstract`），LLM 摘要层疑似未触发；
- FTS5 trigram 对 2 字中文词命中为 0（已知局限）。

这些都是"拍脑袋"发现的，缺一个**可重复、可量化、可回归**的评测工具。

### 1.2 核心洞察

> **向量本身不可读，无法直接判断"准不准"。评测的唯一可行路径是把向量质量转化为可观测的检索质量** —— 用 LLM 合成"标准问答对"，回灌到真实检索链路，用召回率衡量。

chunk 自带 ground truth（它就是答案出处），因此**无需人工标注**即可算召回。这是 RAGAS / synthetic-eval 的标准思路。

### 1.3 目标与非目标

**目标**
- 给定一篇 PDF，产出一份多维度评测报告（markdown + JSON），覆盖切分质量、检索质量、语义质量三层；
- 复用真实 pipeline 代码，结果可信、可回归；
- 离线脚本形态，可批量跑多篇 PDF 取平均。

**非目标**
- 不做 app 内可视化面板（将来可选，本期不做）；
- 不改动现有 pipeline 行为（评测是只读消费方，唯一例外是修 §6 发现的 chunker bug，单独 PR）；
- 不替换嵌入模型 / 不调 RRF 参数（评测先量化现状，调优是后续工作）。

### 1.4 与现有 `rag-eval` 的关系（重要）

仓库已有一套成熟的检索评估流水线（`apps/electron/scripts/rag-eval.ts` + `RAG-EVAL.md`），**本工具是它的补充，不是替代**，且最大化复用其基础设施。

| 维度 | 现有 `rag-eval` | 本工具 `eval-vectorization` |
|------|----------------|---------------------------|
| 评测对象 | **整个真实库**（`~/.asci-dev` 的 vector-index.db） | **单篇 PDF**，隔离临时索引 |
| query 来源 | 手写固定夹具（`rag-eval-queries.txt`，30 条/7 类） | **从该 PDF 自身 chunk 自动合成**，带 ground-truth chunkId |
| 核心指标 | 覆盖率矩阵（有没有命中）+ 人工/Claude 判 P@5 | **Recall@k / MRR / 误召回**（有 ground truth，自动算）+ L3 判 P@5 |
| 链路 | 五路（含 ripgrep 老路对比） | 三路（向量 / FTS / RRF，聚焦向量化本身） |
| L1 切分体检 | 仅 `--audit` 全库垃圾统计 | 单篇覆盖率 + 噪声 + 长度分布 + 截断抽检 |

**复用清单**（直接 import，不重写）：`ZoteroVectorDb`（建库/检索/RRF）、`E5Embedder`、lite 解析路（`extractTextFromFile` + `wrapAsMarkdown`）、`chunkWikiMarkdown` / `buildTitleAbstractChunk`、Hit 归一化与 JSONL/summary 写法约定、`RAG-EVAL.md §4` 的 Claude-as-judge rubric。

---

## 2. 术语表（领域语言）

| 术语 | 含义 |
|------|------|
| **金标对（gold pair）** | `(question, groundTruthChunkId)`：LLM 基于某 chunk 生成、且**只能由该 chunk 回答**的问题 |
| **回灌（replay）** | 把合成问题走真实 `search()`，看正确 chunk 是否被召回 |
| **三路（three paths）** | 纯向量 KNN / 纯 FTS BM25 / RRF 混合，分别评测以定位短板 |
| **L1/L2/L3** | 切分质量 / 检索质量 / 语义质量，三层评测 |
| **干扰问题（distractor）** | 答案不在本 PDF 内的问题，测假阳性（误召回）率 |

---

## 3. 评测三层设计

### 3.1 L1 — 切分质量（前置体检，便宜先跑）

**规则层（纯 SQL / 纯函数，秒出）：**
- 噪声检出：`LENGTH(TRIM(content)) < N` 的空/超短 chunk 列表（复现已知 bug）；
- 长度分布：min / avg / p50 / p95 / max（按 `text_kind` 分组）；
- **覆盖率**：所有 `raw` chunk 拼回 vs 原始正文，算字符级丢失比例（切分是否漏内容）；
- 语料层完整性：`raw` / `article` / `title_abstract` 各层 chunk 数（暴露 article 层为空的问题）。

**LLM 抽检层：**
- 随机抽 ~15 个 `raw` chunk，让 Claude 三选一判定：`完整 / 句中截断 / 混入页眉页脚噪声`，输出各类占比 + 反例。

### 3.2 L2 — 检索质量（核心）⭐

**合成查询（两类，分别评测）：** 对每个（或采样）chunk，让 Claude 生成两种 query，**因为向量与 FTS 各有主场，只用一类会低估其中一路、误导调优方向**：

| 查询类型 | 生成方式 | 主要考验 |
|---------|---------|---------|
| **语义问题** | LLM paraphrase，**禁止照抄 chunk 稀有词** | 向量 embedding 真实水平（词面对不上，逼 embedding 干活） |
| **关键词查询** | 从 chunk 抽实体 / 术语 / 数字（含中文词） | FTS trigram 分词质量 + 中文 2 字词命中局限 |

**其余原则：**
1. 同时生成少量**干扰问题**（答案不在 PDF 内），测假阳性；
2. 每个 query 标注它依据的 `chunkId` 作为 ground truth；
3. 报告对**两类 query 各出一份三路指标** —— 期望看到「语义问题：向量 > FTS」「关键词查询：FTS > 向量」「RRF 两边都不掉队」，这才是评混合检索的意义。

**回灌 + 三路对比：**

| 路 | `search()` 入参 | 测什么 |
|----|----------------|--------|
| 纯向量 | 仅 `queryEmbedding`（问题用 `kind='query'` 嵌入） | embedding / 维度 / chunk 粒度 |
| 纯 FTS | 仅 `queryText` | trigram 分词（含中文局限） |
| RRF 混合 | 两者都传 | 融合是否优于单路最大值 |

> 三路用 `rrfFuse()`（已导出纯函数）+ `search()` 的可选入参零改动实现。

**指标：** `Hit@1/3/5/10`、`MRR@10`、干扰问题的**误召回率**（distractor 被当成高分命中的比例）。三路各算一份，并排对比。

### 3.3 L3 — 语义质量（LLM-as-judge，最贵）

- 对每个金标问题的 RRF top-5，让 Claude 对每条 chunk 打 `0/1/2`（无关 / 部分相关 / 精准回答）；
- 产出 `Precision@5`（语义版）、`nDCG@5`；
- 单列"召回正确 chunk 但 top-k 里混入答非所问 chunk"的 case —— 数值指标抓不到的语义错配。

---

## 4. 技术方案

### 4.1 形态：脚本 + Claude-in-loop 两阶段（对齐 rag-eval 运行约定）

新增 `apps/electron/scripts/eval-vectorization.ts`。**不能用 bun 直接跑** —— onnxruntime-node / better-sqlite3 / sqlite-vec 是 Electron-ABI native 模块，bun 加载不了。沿用 rag-eval 的约定：esbuild bundle（native 全 `--external`）→ `ELECTRON_RUN_AS_NODE=1 electron dist/*.cjs`。`package.json` 加两条命令：

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

> **解析保真度**（§4.2）：生产 raw 层"有 structured `.txt` 则用、无则回退 lite `.md`"。本工具 `auto` 模式同口径：默认 structured，pdfjs 抽取异常才降级 lite。两路切出的 chunk 边界不同（段落锚点 vs 字节偏移），故 ground truth 用 **answerText 归一化子串匹配**（非 chunkId），让同一份 qa.jsonl 能跨模式公平复用。

**为什么两阶段而非一条命令**：合成 QA 必须基于"已切好的 chunk"，而 chunk 只有索引后才存在（先有鸡才有蛋）；且 LLM 推理（合成 + 评判）按仓库现有 `RAG-EVAL.md §4` 约定走 **Claude-Code-as-judge**（对话里的我直接读 jsonl 干活），不引新依赖。

### 4.2 数据流（复用真实 pipeline + rag-eval 基础设施）

```
阶段1 index（脚本，确定性 native 计算）:
  extractTextFromFile(pdfPath)            // 复用 lite 解析路（= 生产 raw 层来源）
    → wrapAsMarkdown(...)                 // 包成 wiki md（与生产一致）
    → chunkWikiMarkdown(md) + buildTitleAbstractChunk(...)
    → E5Embedder.embed(texts,'passage')   // 384维，与生产同前缀
    → ZoteroVectorDb.open(eval.db).replaceChunks(...)   // 隔离工作区，非 ~/.asci*
    → 导出 chunks.jsonl（id/textKind/anchor/content）
    → L1 体检（覆盖率 / 噪声 / 长度分布）写入 report.md

  ↓ Claude Code 读 chunks.jsonl → 合成 qa.jsonl
     （语义问题 + 关键词查询 + 干扰，各带 groundTruthChunkId）

阶段2 replay（脚本，确定性 native 计算）:
  每条 q → embed('query') → ZoteroVectorDb.search() 三路（向量/FTS/RRF）
    → 比对 groundTruthChunkId 算 Hit@k / MRR / 误召回
    → 写 run.jsonl（每问题 top-k 命中，judge 用）+ 指标进 report.md

  ↓ Claude Code 读 run.jsonl → 按 RAG-EVAL.md rubric 判 L3 相关性
     → P@5 / nDCG + 答非所问 case 汇总进 report.md
```

**关键约束：**
- 索引侧 chunk 用 `kind='passage'`，查询侧问题用 `kind='query'` —— 必须与生产一致（E5 双前缀），否则指标失真；
- 工作区 DB 落 `docs/superpowers/vec-eval-runs/<pdf-slug>/eval.db`（gitignored，对齐 rag-eval 产物约定），**隔离、不碰 `~/.asci*` 真实库**；两阶段间需复用同一库故不放 `os.tmpdir()`，跑完用户可整目录删；
- `ZoteroVectorDb.open()` 自带 vec0 扩展加载，与生产一致（vec 不可用时自动退化纯 FTS）。

### 4.3 LLM 调用方式：Claude-Code-in-loop（对齐 RAG-EVAL.md）

合成问题与 L3 评判都需要 LLM。仓库现有约定（`RAG-EVAL.md §4`）是 **Claude-Code-as-judge**：脚本只产/吃 jsonl，LLM 推理由对话里的 Claude Code 完成。本工具沿用：

- **合成 QA**：我读 `chunks.jsonl`，按 §3.2 原则（语义须 paraphrase 禁抄稀有词、关键词抽实体术语、加干扰）生成 `qa.jsonl`；
- **L3 评判**：我读 `run.jsonl`，按 rubric 逐条判相关性。

> 无需 `ANTHROPIC_API_KEY` / SDK / channel-manager 密钥。**未来若要无人值守 CI**，再把这两步写成程序化 TS（复用 app provider/channel 密钥，吃同一份 jsonl 契约）—— 与 RAG-EVAL.md §4 末尾的演进方向一致。

### 4.4 报告结构

```markdown
## PDF: 《xxx》 | 42 chunks (raw 40 / title_abstract 2 / article 0 ⚠️)

### L1 切分质量
覆盖率 98.7% | 噪声 chunk 2 个(id 17,31) | 句中截断率 13%(抽检 15)
长度分布 raw: min 40 / p50 280 / p95 520 / max 1840

### L2 检索质量 (语义问题 60 + 关键词 60 + 干扰 10)
              语义问题(Hit@5)      关键词查询(Hit@5)
向量            0.82                 0.61
FTS             0.70                 0.93   ← 主场扳回
RRF混合         0.91                 0.95   ✓ 两边都不掉队
（每格另含 Hit@1 / MRR / 误召回，此处略）

### L3 语义质量
Precision@5 = 0.78 | nDCG@5 = 0.81 | 7 个"答非所问"case(见附录)
```

JSON 同步落盘，字段含每问题逐条命中 rank、judge 分，供回归 diff。

---

## 5. 实现计划

| 阶段 | 内容 | 产出 |
|------|------|------|
| P0 | `index` 阶段脚手架：CLI、esbuild+electron 接线、复用 lite 解析→chunk→embed→隔离 eval.db、导出 chunks.jsonl | 跑通"PDF→隔离库"，打印 chunk 数 |
| P1 | **L1** 规则统计（覆盖率 / 噪声 / 长度分布）写进 report.md + Claude 抽检截断率 | L1 报告段 |
| P2 | Claude 读 chunks.jsonl 合成 qa.jsonl（语义+关键词+干扰）→ `replay` 阶段三路回灌 + Recall/MRR/误召回 → run.jsonl | L2 报告段（核心） |
| P3 | Claude 读 run.jsonl 按 rubric 判 L3 相关性 → P@5/nDCG + 答非所问 case | L3 报告段 |
| P4 | report.md 聚合、`--top`/`--n` 开关、批量多篇取平均 | 完整工具 + RAG-EVAL.md 补一节用法 |

每阶段独立可验：P0 看 chunk 数对不对，P2 看三路指标是否合理（RRF ≥ 单路最大、关键词路 FTS 应反超向量）。

### 5.1 受影响的包与版本号

- `apps/electron`：新增脚本 + `package.json` 两条 `eval:vec*` 命令 + `electron-builder.yml` 排除 `dist/eval-vectorization.cjs`（不进包，对齐 rag-eval）→ patch 递增（开 PR 时一次）。
- 不涉及 IPC / i18n / 共享常量（纯 dev 脚本，无面向用户 UI 文案）。
- 产物落 gitignored 的 `docs/superpowers/vec-eval-runs/`，不进 git。

### 5.2 风险与取舍

- **合成问题质量决定一切**：若问题照抄 chunk 词面，FTS 虚高、向量评测失真 → P2 必须在 prompt 里强约束 paraphrase，并人工抽看前几条；
- **LLM 判定有方差**：L3 judge 用强模型 + 明确 rubric，必要时同问多判取多数；
- **单 PDF 样本小**：Hit@k 在 40 chunk 上波动大 → 支持批量跑多篇取平均才有统计意义（P4）；
- **chunker bug 是另一回事**：L1 会复现噪声 chunk，但**修 `isLowQualityText()` 单独开 PR**，不混进评测工具。

---

## 6. Done When

1. [ ] `bun run eval:vec:index -- <pdf>` → `eval:vec:replay` 两阶段跑通，输出三层 report.md；
2. [ ] 三路指标合理（RRF 不低于单路最大 Hit@5；关键词路 FTS 反超向量）；
3. [ ] eval.db 确认落在 `docs/superpowers/vec-eval-runs/`、未触碰 `~/.asci*`，脚本不被 app 运行时 import；
4. [ ] 至少在 1 篇中文 + 1 篇英文 PDF 上验证报告可读；
5. [ ] `bun run typecheck` 通过；
6. [ ] `electron-builder.yml` 已排除 `dist/eval-vectorization.cjs`；版本号 patch 已递增（开 PR 时）。

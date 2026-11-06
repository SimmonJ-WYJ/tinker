# 文献检索阶段提速重构 Spec（Lit-Search Latency Refactor）

> **状态**：阶段 1 已落地（纯 Python，零编排改动）· 阶段 1.5+ 待 review
> **目标单一**：大幅缩短"文献检索阶段"端到端耗时（与首屏可见时间）
> **关联分支**：`feat/refactor-lit-search`
> **领域语言事实源**：`CONTEXT.md` · `docs/specs/capability-package-spec.md` · `docs/specs/execution-step-grouping-spec.md`
> **影响包**：`apps/electron`（capability packs / orchestrator）· `apps/electron/resources/paper-search-mcp`（Python MCP）
> **不改变的契约**：检索结果质量（去重 / F22 评分 / LLM rerank 排序）不得退化；右侧论文面板的数据形态与 `process_search_results` 计数语义保持兼容

---

## 0. 实现进度

**阶段 1（纯 Python · 已落地，paper-search `0.3.8 → 0.3.9` / electron `0.1.367 → 0.1.368`）：**

| 项 | 状态 | 落点 | 验证 |
|----|------|------|------|
| P2-2 分级超时 | ✅ | `search_service.py`：`source_timeout()` + `SOURCE_TIMEOUT_OVERRIDES`（openalex/crossref=8s、doaj=10s，env `PAPER_SEARCH_SOURCE_TIMEOUTS` 可调）；`_timed_search` 接 per-source timeout | `test_timeouts.py` +5 用例 |
| P0-4 citation 提速 | ✅ | `search_service.py` `snowball()`：同一 pid 的 backward/forward `asyncio.gather` 并发、去方向间 1.5s 硬 sleep；depth 硬限 `SNOWBALL_MAX_DEPTH=1`；pid 间 sleep 可调 | `test_snowball.py` 新增 4 用例 |
| P0-1 enrich 提速 | ✅ | `process_service.py`：`ENRICH_BATCH_SIZE`(10→16)、`ENRICH_INTER_BATCH_SLEEP_SEC`(0.3→0)、`ENRICH_MAX_PAPERS`(0=不限) 三旋钮 | `test_enrich_batching.py` 新增 5 用例 |
| P1-2 arxiv 节流 | ⏸ 推迟 | 3s 是 arXiv 官方礼貌限速 + PR#380 封禁教训，盲目放宽有真实封禁风险；正解是**减少 arxiv 调用数**（属阶段 3 `retrieve` 工具），间隔本就 env 可调，stage 1 不动代码 | — |

全量 `paper_search/` 测试 **129 passed**；`bun run typecheck` 全包通过。

> ⚠️ enrich 的**背景化/渐进式（P0-1 方案 2 + P0-2）** 需 UI/IPC 配合，属阶段 2，未在本次落地；阶段 1 只做了"同源/同批并发提速 + 上限兜底"，不改 enrich 覆盖的论文集（行为安全）。

---

## 1. 背景与目标

文献检索是 ASCI lit-search 能力包的核心环节。当前一次普通的 `general-query` 检索端到端约 **80–125s**（最坏更久），用户在很长时间里看不到任何结果。本 Spec 的**唯一目标**是把这个时间**砍到 1/3 量级（目标 25–40s）**，并把"首条结果可见时间（TTFR）"从约 40–60s 砍到 **10–12s**。

非目标（本次不动）：
- 不改检索召回质量与排序算法（F22 公式、LLM rerank 权重保持）
- 不改右侧面板的展示形态与 JSONL 存储格式（只增量、向后兼容）
- 不引入新的全局状态库 / 存储引擎

---

## 2. 现状架构与端到端耗时分解

### 2.1 当前管线（general-query 主路径）

```
用户 query
  │
  ├─[Turn A] 主 Agent 路由 → lit-search scenario Agent
  │            scenario「Planning turn」生成 ## SEARCH PLAN JSON
  │            （意图分类 + 关键词改写 + method/object terms）
  │
  ├─[Turn B] 主 Agent 读 PLAN → 派发 searcher 子 Agent（haiku）
  │            searcher: 输出 plan 前言
  │                    → 并行 fan-out 15–18 个 search_*（H4/H6 矩阵）
  │                    → 1 次 process_search_results（去重 + enrich 全量 + F22 + 落 JSONL）
  │                    → 写长篇 hits-per-source 报告回 context
  │
  ├─[Turn C] 主 Agent 派发 relevance-scorer 子 Agent（haiku）
  │            scorer: python 块加载 JSONL + Stage1 F22 全集打分
  │                  → Stage2 LLM rerank（top min(N,50)，5 批×10 并行）
  │                  → 把**整套**排序结果以文本吐回 context
  │
  └─[Turn D] 可选 closing turn（默认关闭）
```

**真相源**：
- 编排：`apps/electron/src/main/lib/agent-orchestrator.ts`、`run-orchestrator-query.ts`
- prompt：`apps/electron/default-capability-packs/lit-search/scenario/system-prompt.md`、`sub-agents/searcher.md`、`sub-agents/relevance-scorer.md`
- 检索/处理：`apps/electron/resources/paper-search-mcp/paper_search/service/{search_service,process_service,scoring}.py`

### 2.2 耗时分解模型（实测/按代码配置估算）

| 阶段 | 现状耗时 | 主要成本来源 | 是否在关键路径 |
|------|---------|-------------|---------------|
| A. scenario planning turn | 5–10s | 子 Agent 派发 + JSON 生成（一整轮 LLM） | 是 |
| B1. 派发 searcher（turn-switch） | 3–5s | orchestrator 轮转开销 | 是 |
| B2. search_* 并行 fan-out | 8–15s | **arxiv 3s/req 串行锁**（5–6 个 arxiv 调用被 `threading.Lock` 串行化 ≈ 15–18s）；其余源并发 ≤ 慢源超时 | 是 |
| B3. process_search_results **enrich 全量** | **17–27s** | 对**全部**无摘要论文（约 50 篇）分批补摘要，5 批 × 3–5s + 批间 0.3s | 是 |
| B4. searcher 写报告 | 10–15s | 长篇 hits-per-source 文本**输出 token** | 是 |
| C1. 派发 scorer（turn-switch） | 3–5s | orchestrator 轮转 | 是 |
| C2. Stage1 F22（python） | 2–5s | 子进程冷启动 + 加载 JSONL | 是 |
| C3. Stage2 LLM rerank | 10–15s | 并行批，≈ 一次往返 | 是 |
| C4. scorer 吐**全集**排序文本 | 10–20s | 70+ 篇结构化文本**输出 token** | 是 |
| **合计** | **≈ 80–125s** | — | — |

### 2.3 瓶颈定位（按可回收时间排序）

1. **enrich 全量在关键路径**（17–27s）—— 摘要补全对"面板先出结果"毫无必要，却卡在最前面。
2. **三段式多 Agent 串行 + turn-switch**（A+B1+C1 ≈ 11–20s 纯开销）—— scenario→searcher→scorer 三轮 LLM 派发，其中 searcher 的检索调用与 scorer 的 Stage1 几乎是**确定性**的，不需要 LLM。
3. **两处大段输出 token**（B4 + C4 ≈ 20–35s）—— searcher 把统计报告、scorer 把整套排序集**回吐进 context**，纯生成开销，且并无下游消费者真正需要这段文本（面板数据走 JSONL/工具回写）。
4. **arxiv 串行节流**（隐藏 ≈ 15s）—— `H4 并行 fan-out` 的承诺被 arxiv connector 的进程级 `threading.Lock + 3s min interval` 抵消，6 个 arxiv 调用实际串行。
5. **scorer 子进程冷启动 + 加载**（2–5s）—— 可随 Stage1 服务端化一并消除。

---

## 3. 目标架构

核心思路：**把"确定性的检索+去重+Stage1 打分"从多个 LLM 子 Agent 收敛成一个服务端 MCP 工具，把 enrich 移出关键路径并背景化/渐进化，把结果回写改为工具调用而非 context 文本吐出。** 只保留两处真正需要 LLM 的判断：①意图/关键词规划（轻量），②top-K 语义 rerank。

```
用户 query
  │
  ├─[Turn 1] 规划：意图分类 + 关键词/method/object terms
  │            （可保留极薄 scenario planner，或折叠进主 Agent；TTFT ≤ 1s）
  │
  ├─[确定性] 单次 mcp__paper-search__retrieve(...)
  │            服务端一气呵成：
  │              · H6 query-shaping（短查询给 arxiv / 域锚定给 openalex/semantic）下沉到代码
  │              · 并行 fan-out search_*（arxiv 节流问题一并修）
  │              · 去重（精确 + 模糊）
  │              · F22 Stage1 服务端打分（已有 scoring.py）
  │              · 落 JSONL + 【立即】推送面板（raw 命中，渐进式）
  │              · 只对 top-K（将展示/rerank 的 ≤50 篇）做 enrich，并行
  │            返回：top-K slim 排序列表（handle/title/abstract/stage1），供 rerank
  │
  └─[Turn 2] LLM rerank（top min(N,50)，并行批）
               · rerank 分数经 mcp__paper-search__apply_rerank 工具回写 JSONL/面板
               · 不再把整套排序集以文本吐回 context
```

### 3.1 收敛对照

| 当前 | 目标 |
|------|------|
| scenario planning turn（LLM） | 保留极薄规划 or 折叠进主 Agent（见 P1-折叠） |
| searcher 子 Agent（LLM，自己拼 H4/H6 矩阵、调 search_*、调 process_search_results、写报告） | **消除** → 1 个确定性 `retrieve` MCP 调用 |
| scorer Stage1（LLM 子 Agent 内 python 块） | **消除** → 服务端 F22（复用 `scoring.py`） |
| scorer Stage2 + 全集文本输出 | 保留 rerank，**输出改工具回写** |

---

## 4. 具体改造项

### P0-1 · enrich 移出关键路径（最大单点收益：约 −17~25s）

**问题**：`enrich_missing_abstracts`（`process_service.py:197`）对**整个**去重集（约 50 篇无摘要）分批补摘要，串在 `process_search_results` 内、阻塞结果返回。但面板首屏只需要 title/authors/year/venue/doi/url，摘要不是必需项。

**方案**（三选一组合，建议全做）：
1. **范围收敛**：只 enrich "将进入展示/rerank 的 top-K（≤50，按 Stage1 排序后）"，长尾不补。多数查询 N≈70，可省掉 ~20 篇的 enrich。
2. **背景化**：`process_search_results` 立即返回 + 落库 + 推面板（带 `abstractPending` 标记）；enrich 在后台 task 跑，完成后通过面板增量更新通道回填摘要（IPC push）。关键路径上 enrich 耗时 = 0。
3. **并发上调**：若仍需同步 enrich，把 `batch_size` 从 10 提到 ~25 并去掉 0.3s 批间 sleep（连接器自带限速），50 篇从 5 批降到 2 批。

**改动点**：`process_service.py`（enrich 调用点改为可 detach；新增 `enrich_scope=top_k` 参数）；面板增量回填的 IPC 通道（四联同步：shared 常量 → main ipc → preload → renderer atom）。

**风险**：rerank 需要摘要做语义判断 → 必须保证"进入 rerank 的 top-K"在 rerank 前已 enrich（方案 1 正好覆盖）；长尾论文摘要异步补，UI 需有 loading 态。

---

### P0-2 · 渐进式结果回流（最大感知收益：TTFR 40–60s → ~10s）

**问题**：用户在 search + enrich + rerank 全部完成前看不到任何东西。

**方案**：面板分三档渐进上屏：
- **T+~10s**：search fan-out 一结束，raw 去重命中（Stage1 顺序）立刻进面板（占位摘要）。
- **T+~15s**：top-K enrich 完成，摘要回填。
- **T+~30s**：LLM rerank 完成，重排 + 高亮 final score。

**改动点**：`retrieve` 工具内分阶段 emit 进度/部分结果；renderer 面板支持"分数/排序就地更新"而非整批替换（很可能已部分支持，参考 `session-papers-utils.ts`）。

**风险**：排序在 rerank 后会跳变 —— 用 1 次平滑过渡动画，且 rerank 仅影响 top-K 顺序，长尾稳定。

---

### P0-3 · 收敛 searcher 子 Agent 为确定性 `retrieve` 工具（约 −15~25s：去掉 1 次派发 + 长报告输出 + LLM 拼矩阵）

**问题**：searcher 是个 haiku 子 Agent，但它做的事 95% 是确定性的：按 H6 规则拼 keyword×source 矩阵、并行调 search_*、调 process_search_results、写报告。这些都可以是代码。

**方案**：新增 `mcp__paper-search__retrieve(research_question, keywords, method_terms, object_terms, sources, arxiv_categories, top_k=50)`：
- 把 `searcher.md` 的 **H5/H6 query-shaping** 与 **round-1 矩阵算法**（短查询给 arxiv、`<anchor> <method>` 给 openalex/semantic）下沉为 Python（`search_service.py` 新增 `build_query_matrix()`）。
- 内部 = 现有 `search()` 并行 fan-out + `process_results_core()` 去重 + `scoring.py` 的 Stage1 F22。
- H1 低产源早停、H3 预算逻辑也变成服务端确定性规则（不再靠 prompt 自律）。
- 直接返回 top-K slim 排序列表（供 rerank）+ 计数（`total_from_sources/new_records/display_count`）。

**收益**：消除 1 次子 Agent 派发（−3~5s）+ searcher 长报告生成（−10~15s）+ LLM 拼矩阵/早停的抖动。检索从"LLM 驱动"变"代码驱动"，可复现、可测、可缓存。

**改动点**：Python 新增 `retrieve` MCP 工具 + `build_query_matrix()`；`searcher.md` 退化为"调用 retrieve 即可"或直接从 PLAN 步骤里移除 searcher，主 Agent 直接调 `retrieve`；`lit-search/manifest.json` 子 Agent 拓扑更新。

**风险**：query-shaping 规则下沉后，prompt 里大量 H1–H6 经验需翻译成代码并有测试守门（已有 `test_*` 可扩）；保留 `search_*` 原子工具作为逃生通道。

---

### P1-1 · 评分结果经工具回写，不再吐 context（约 −10~20s 输出 token）

**问题**：relevance-scorer 把**整套** 70+ 篇排序集以结构化文本吐回 context（`relevance-scorer.md:208` 全集输出），这是纯输出 token 开销，且面板数据本就走 JSONL，不需要这段文本。

**方案**：新增 `mcp__paper-search__apply_rerank(turn_id, scores: {handle: llm_relevance})`：rerank 子 Agent / 主 Agent 只产出 top-K 的 `{handle: score}` JSON（小），调该工具；服务端按 `final = 0.30*kr + 0.40*llm + 0.15*rec + 0.15*trust` 重算并就地更新 JSONL + 推面板。LLM 只输出分数映射，不复述论文。

**改动点**：Python 新增 `apply_rerank` 工具（含 final 公式，从 `relevance-scorer.md:197` 迁移）；scorer prompt 大幅瘦身为"读 top-K → 输出 {handle: 0–1} → 调 apply_rerank"。

**风险**：final 公式从 prompt 迁到代码须与现状逐位对齐（加单测固化）。

---

### P1-2 · 修复 arxiv 串行节流（约 −10~15s）

**问题**：`connectors/arxiv.py` 用进程级 `threading.Lock + ARXIV_MIN_INTERVAL_SEC=3` 串行所有 arxiv 请求；当一轮有 5–6 个 arxiv 查询时，H4 的"并行 fan-out"被强制串行成 ~18s。

**方案**（择一）：
- **合并查询**：retrieve 内对 arxiv 用更少、更宽的查询（1–2 个），靠 `categories` 过滤而非多关键词多次调用。
- **降间隔 + 抖动**：把 `ARXIV_MIN_INTERVAL_SEC` 调至 ~1s 并加随机抖动（arXiv 礼貌限速实际约 1 req/3s 是保守值，短突发可接受），或为本进程维持一个全局令牌桶而非硬串行。
- **arxiv 降级为条件源**：默认 `openalex+crossref` 已是 fast-path（5s 内 60–100 命中），arxiv 仅当 openalex+crossref 不足时补，单独慢一点可接受。

**改动点**：`connectors/arxiv.py` 节流逻辑；`build_query_matrix()` 限制 arxiv 查询数。

**风险**：触发 arXiv 限速/封禁 → 保守取 1.5s + 抖动，并保留 429 退避。

---

### P1-3 · 折叠 scenario planning turn（约 −5~10s）

**问题**：scenario planner 单独一轮 LLM 仅为产出关键词/terms 的 JSON。

**方案**（取舍二选一，建议 A）：
- **A（保守）**：保留 planner 但确保其"thinking disabled + TTFT ≤ 1s"严格生效（现已声明），并把"closing turn 默认关闭"坐实；planner 与首个 `retrieve` 调用尽量挤进相邻轮，减少空转。
- **B（激进）**：把意图分类 + 关键词扩展能力内联进主 orchestrator 的同一轮（capability pack 提供 prompt 片段而非独立子 Agent），主 Agent 在决定检索的同一轮直接产出 terms 并调 `retrieve`，省掉一次派发。

**改动点**：A 仅校验；B 需改 `capability-pack-loader.ts` / orchestrator 路由与 `lit-search` 拓扑，较重，建议二期。

**风险**：B 会改变能力包"场景 Agent"契约，须与 capability-package-spec 对齐，单列子任务。

---

### P2-1 · 查询级持久缓存（重复/近似查询 → 近乎瞬时）

**方案**：在 `~/.asci/` 下加一层 `(normalized_query, sources)` → 命中结果的短 TTL 缓存（如 24h），retrieve 命中缓存直接返回并落面板。区别于现有进程内 10min handle 缓存——这层跨会话、可序列化。

**风险**：时效性 → 短 TTL + 用户可"强制刷新"。属增量优化，三期。

---

### P2-2 · enrich/网络层杂项
- semantic 无 key 已 fail-fast（保持）。
- `PER_SOURCE_TIMEOUT_SEC=20` 偏长；fast-path 源（openalex/crossref 通常 <2s）可分级超时（fast 源 8s、flaky 源 15s），减少尾部等待。
- 死源（dblp/google_scholar/zenodo/base/citeseerx）已默认禁用（保持）。

---

## 5. 目标端到端耗时模型（Before / After）

| 阶段 | Before | After | 说明 |
|------|--------|-------|------|
| 规划 | 5–10s | 3–5s | planner 收紧（P1-3 A）/ 折叠（B） |
| 派发 searcher | 3–5s | 0 | P0-3 消除 |
| search fan-out | 8–18s | 6–10s | P1-2 修 arxiv 串行 |
| enrich（关键路径） | 17–27s | **0**（背景）/ 3–5s（仅 top-K 同步） | P0-1 |
| searcher 报告输出 | 10–15s | 0 | P0-3 消除 |
| 派发 scorer | 3–5s | 0 | rerank 内联或单轮 |
| Stage1 F22 | 2–5s | <1s | P0-3 服务端化 |
| Stage2 LLM rerank | 10–15s | 10–15s | 保留（质量） |
| 评分结果输出 | 10–20s | <2s | P1-1 工具回写 |
| **合计** | **≈ 80–125s** | **≈ 25–40s** | **约 3× 提速** |
| **首屏可见（TTFR）** | **40–60s** | **~10–12s** | P0-2 渐进式 |

---

## 6. 分阶段落地路线图（每阶段独立可交付、可回滚）

> ⚠️ 本节为第一轮路线图；**纳入第二轮补充项后的最终路线图见 §11**，以 §11 为准。

- **阶段 1（最高 ROI，纯 Python，零编排改动）**：P0-1（enrich 背景化 + top-K 收敛）+ P1-2（arxiv 节流）+ P2-2（分级超时）。预计单独可把端到端从 ~100s 降到 ~55s。
- **阶段 2（渐进式 UI）**：P0-2 + 面板增量回填 IPC 四联同步。感知 TTFR 降到 ~10s。
- **阶段 3（收敛 retrieve 工具）**：P0-3 + P1-1，引入 `retrieve` / `apply_rerank`，prompt 瘦身。端到端进入 25–40s。
- **阶段 4（编排折叠，可选）**：P1-3 B + P2-1 缓存。锦上添花。

每阶段：先 BDD 描述行为 → 加/扩 Python 单测（`test_timeouts.py`/`test_enrich.py` 同目录）→ `bun run typecheck && bun test` → `dist:fast` 冒烟（涉及打包/MCP 启动时）。

---

## 7. 风险与回滚

| 风险 | 缓解 |
|------|------|
| query-shaping / 早停 / final 公式 从 prompt 下沉到代码出现行为漂移 | 每条规则配单测固化现状（"金标准"对照），逐位对齐再切换 |
| 检索质量退化（召回/排序） | 保留 `search_*` / `process_search_results` 原子工具作为逃生与对照；用一组固定 query 做 before/after 召回 & top-20 重合度回归 |
| enrich 背景化导致摘要/引文偶发缺失 | top-K 同步 enrich 保证 rerank/展示有摘要；长尾异步补 + UI loading 态 |
| arxiv 限速封禁 | 保守 1.5s + 抖动 + 保留 429 退避 |
| 编排折叠（P1-3 B）破坏能力包契约 | 单列子任务，与 capability-package-spec 对齐后再做；默认走 A |

---

## 8. 验证方法

1. **性能日志**：复用 `search_service.py` 已有 `[perf] search completed ... total_wall=Zms timings={...}`；在 `retrieve` / enrich / rerank 各段补 `[perf]` 计时，端到端落一条聚合行。
2. **基准查询集**：固定 5–8 个代表性 query（LLM long-context、biomedical、crypto、跨域…），脚本化跑 before/after，记录：端到端、TTFR、top-20 重合度、各源命中数。
3. **质量回归**：top-20 排序与现状的 Jaccard/重合度 ≥ 阈值（如 0.8）才算不退化。
4. **UI 自验**：`bun run dev` 走 golden path（普通检索 / 引文追溯 / exact-lookup），确认渐进上屏 + 摘要回填 + rerank 重排无闪烁；切 zh↔en 各一遍无 raw key。

---

## 9. 受影响的包与版本号

| 包 | 改动 | 版本号 |
|----|------|--------|
| `apps/electron`（capability packs / orchestrator / IPC / 面板 atom） | prompt 瘦身、retrieve/apply_rerank 路由、渐进式面板、IPC 四联 | patch ++ |
| `apps/electron/resources/paper-search-mcp`（Python） | enrich 背景化、retrieve/apply_rerank 工具、build_query_matrix、arxiv 节流、分级超时 | 同步包内版本标识 |

> 注：Python MCP 包随 `apps/electron` 一起分发，落地时按"改到哪个包就递增哪个包 patch"的约定处理 `apps/electron/package.json`。

---

## 10. 第二轮审核：补充改进项

第一轮聚焦 `general-query` 主路径。复核连接器/编排实现后，补充以下此前遗漏或需修正的点。

### 10.0 对第一轮判断的修正（重要）

- **连接器是单例**：`ConnectorRegistry` 在进程启动时一次性实例化（`registry.py` `_instantiate_all` → `self._instances[name]=cls()`），`get()` 返回同一实例。因此每个连接器的 `requests.Session()` 在整个进程生命周期复用，TLS/keep-alive **已生效** —— 第一轮担心的"每次握手"并不存在。真正的 HTTP 层瓶颈不是握手，而是**同步 `requests` 跑在默认线程池**（见 P2-3）。
- 故 HTTP 层重写优先级**下调**为 P2，收益边际。

### P0-4 · citation-tracing 路径提速（第一轮完全遗漏）

**问题**：`citation-tracing` 走 `citation-explorer → relevance-scorer`，其 `snowball()`（`search_service.py:150`）有独立的严重串行：
- **单源依赖**：只用 Semantic Scholar（`registry.get("semantic")`），无 key 时直接失败/空。
- **逐 pid 串行 `await asyncio.sleep(1.5)`**：每个种子 id 之间睡 1.5s；`direction="both"` 时 **同一 pid 的 backward 与 forward 之间再睡 1.5s**。depth=1 单种子 ≈ 3s + 2× semantic 往返；一旦 depth≥2，layer-1 的 30–40 个 id × 3s = **90–120s**（citation-explorer prompt 已硬限 depth=1，但服务端无强约束）。

**方案**：
1. **forward/backward 并发**：去掉同一 pid 内 backward↔forward 的 1.5s，两个方向 `asyncio.gather` 并发（它们打不同 endpoint，不互相限速）。单种子省 1.5s + 一半往返。
2. **pid 间用令牌桶替代硬 sleep**：维持全局 ~1 req/1.5s 的令牌桶，允许短突发并发而非严格串行；有 Semantic key 时间隔可降到 ~0.5s。
3. **服务端硬约束 depth≤1**（除非显式放开），与 prompt 对齐，杜绝 layer 爆炸。

**改动点**：`search_service.py` `snowball()`；`citation-explorer.md` 可顺带瘦身。
**收益**：典型引文追溯从 ~12–18s 降到 ~6–8s；杜绝 depth 失控的分钟级长尾。

### P1-4 · MCP 进程预热（消除首查冷启动 2–5s）

**问题**：paper-search 是 `uv run ... paper-search-mcp` 的 stdio 子进程（`builtin-mcp-resolver.ts`，启动 timeout 60s）。若按需在首个 tool_call 时拉起，则**首次检索**额外吃 `uv` 解析 + Python import + 连接器实例化的冷启动（约 2–5s）。

**方案**：
1. **会话/应用启动即预拉起** paper-search MCP（不等首个 search），让 import + registry 构建在用户开始检索前完成。
2. **可选预热网络**：拉起后对 fast-path 源（openalex/crossref）发一个极轻的 warmup 请求，提前建立连接池条目（与单例 Session 配合）。

**改动点**：`agent-orchestrator.ts` / MCP 生命周期管理处，在会话初始化阶段触发 MCP spawn。
**风险**：占用空闲资源 → 仅在进入 lit-search/lit-review 能力包上下文时预热。

### P1-5 · source 级渐进上屏（强化 P0-2 的 race-to-first）

**问题**：P0-2 的渐进式以"阶段"为粒度（search 全部 gather 完才上屏）。但 `search()` 内是 `asyncio.gather` 等**所有**源，最快源（openalex 常 <1s）被最慢源拖着。

**方案**：retrieve 内用 `asyncio.as_completed` 或回调，**单源一返回就增量推面板**（去重在累积集上滚动做）。最快源命中可在 ~2s 内见，而非等 8–10s。

**改动点**：`search_service.py` 增量回调；面板增量合并（与 P0-2 共用通道）。

### P2-3 · 同步 `requests` → 线程池上限 / 迁移 async HTTP

**问题**：所有连接器用同步 `requests` + `asyncio.to_thread`，受默认 `ThreadPoolExecutor`（约 `min(32, cpu+4)`）限制。全源 fan-out（多源 × 多关键词，可达 15–18 个并发 to_thread）在低核机器上会**排队**，并发被线程数封顶。

**方案**（择一，收益边际，列 P2）：
- 显式放大 retrieve 期间的 executor（`loop.set_default_executor(ThreadPoolExecutor(max_workers=24))`）。
- 或把 hot 源（openalex/crossref/semantic）迁到共享 `httpx.AsyncClient`（HTTP/2 多路复用 + 原生 async，彻底脱离线程池）。

### P2-4 · rerank 降本（prefill + 可选 embedding 分流）

**问题**：Stage2 LLM rerank 把 top-50 的 title+abstract 作为输入（prefill token），且固定走 LLM（10–15s）。

**方案**：
1. **输入截断**：rerank 只喂 title + 摘要前 ~300 字，降 prefill，质量基本无损。
2. **embedding 预排序（可选）**：用 provider embedding 算 query×paper 余弦，先排序；**LLM rerank 仅覆盖 top-20**，21–50 用 embedding 分数。embedding 调用亚秒级，可把 rerank 覆盖面缩小而保质。需评估 provider embedding 可用性，列 P2/三期。

### 10.x 二阶收益（无需额外改动，自然获得）

P0-3 + P1-1 去掉 searcher 长报告与 scorer 全集文本回吐后，**context 显著变小** → 之后每一轮（含衔接的 lit-review 综述阶段）的 prefill 更快、更省 token。这是收敛管线的附带红利，不单列任务但应在验证时一并观测。

---

## 11. 更新后的落地路线图（含补充项）

- **阶段 1（最高 ROI，纯 Python，零编排改动）**：P0-1（enrich 背景化 + top-K）+ P1-2（arxiv 节流）+ **P0-4（citation 路径并发/去 sleep）** + P2-2（分级超时）。
- **阶段 1.5（低风险、独立）**：**P1-4（MCP 预热）** —— 主进程生命周期小改，立竿见影降首查冷启动。
- **阶段 2（渐进式 UI）**：P0-2 + **P1-5（source 级 race-to-first）** + 面板增量回填 IPC 四联同步。
- **阶段 3（收敛 retrieve 工具）**：P0-3 + P1-1，引入 `retrieve` / `apply_rerank`，prompt 瘦身。
- **阶段 4（可选/三期）**：P1-3 B 编排折叠 + P2-1 缓存 + P2-3 async HTTP + P2-4 embedding rerank。

---

## 12. 待用户确认的开放问题

1. **enrich 背景化** 是否接受"首屏无摘要、稍后回填"的交互（P0-1 方案 2）？还是坚持首屏即带摘要（退化为方案 1+3，慢 3–5s）？
2. **编排折叠（P1-3 B）** 是否纳入本次范围？它会触碰能力包"场景 Agent"契约，建议二期单列。
3. **质量回归阈值**（top-20 重合度）定多少算"不退化"可接受？
4. **embedding rerank（P2-4）** 是否纳入？取决于当前 provider 是否提供可用 embedding 接口、以及对 rerank 质量的容忍度。
5. **MCP 预热（P1-4）** 预热时机：应用启动即拉起，还是进入 lit-search/lit-review 能力包时再拉起（省空闲资源）？

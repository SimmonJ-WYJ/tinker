# 并行化 V2 scorer shards Spec（Parallel Scorer Shards）

> **状态**：草稿 · 待 review
> **关联 issue**：#689（lit-search：并行化 V2 scorer shards，加速大候选集评分）
> **关联 PR**：TBD
> **领域语言事实源**：本 spec §2 术语；与 `CONTEXT.md` / `docs/specs/lit-scoring-agent-spec.md` 对齐
> **依赖**：`docs/specs/lit-scoring-agent-spec.md`（score / scorer v2）、`docs/specs/execution-step-grouping-spec.md`（PLAN 并行步骤）

---

## 1. 背景与问题

lit-search 默认 V2 评分链路当前是 `searcher/retrieve → scorer`（**单个** scorer 子 Agent）。scorer 在 Step 0 用一段**手写 Python**：读整份 session JSONL → 过滤本轮 turn → 按 F22 `extra.relevance` 排序 → 取判分窗口（F22>50 OR method≥70，floor 50，cap 120，并合并 seeds）→ 把整窗候选打印进 context，再逐篇判 `semantic` / `method`，最后一次 `apply_scoring` 回写 `extra.score`。

问题：**LLM judge 是检索最贵的环节**。窗口可达 120 篇，单个 scorer 串行判完全部，候选集越大延迟越高。判分窗口里各篇相互独立，天然可并行。

## 2. 术语（领域语言）

- **V2 scoring window（评分窗口）**：本轮 turn 里需要 LLM 判 `semantic`/`method` 的候选集合。规则由**服务端**确定（F22>50 OR methodRelevance≥70，floor 50，cap 120，合并 forced seeds）。
- **shard（分片）**：评分窗口的一个**不相交子集**。N 个 shard 互不重叠、合并 == 完整窗口。
- **scorer shard**：只判分自己 shard 内论文的一个 `scorer` 子 Agent 实例。
- **DEFAULT_SCORING_SHARD_COUNT**：默认分片数，先取 **3**。

## 3. 目标与边界

完成后普通文献检索仍保持 `searcher/retrieve → scorer` 的**用户可见行为不变**，但当候选集较大时系统把评分窗口稳定切分成多个 shard，并行派发多个 `scorer`。两条硬边界：

1. **并行只发生在 LLM judge 阶段**。候选窗口规则、分片规则、写回合并规则**必须由服务端确定**——scorer prompt 不再手写 Bash/Python 读整份 JSONL 自行切片。
2. **并发写安全**。多个 scorer 并发写同一 session JSONL 的不同 handles 时，`apply_scoring` 的 read-modify-write 必须并发安全，后写 shard 不得覆盖先写 shard 的 `score`。

旧 `relevance-scorer` / `finalRelevance`（v1）仍是 legacy fallback，不进入默认路径。

## 4. 设计

### 4.1 服务端窗口 + 分片工具（paper-search MCP）

- `select_scoring_window(records, turn_id=None) -> (resolved_turn_id, window_records)`：把原来散落在 scorer.md 的窗口规则下沉为**服务端确定性函数**（同样的阈值/floor/cap/seed 合并；按 F22 desc 稳定排序）。
- 新 MCP 工具 `get_scoring_shard(shard_index, shard_count=3, session_id="", turn_id="")`：
  - 读 JSONL → `select_scoring_window` → 按 **round-robin** `window[shard_index::shard_count]` 取本 shard（稳定、不相交、合并完整、难度均衡）。
  - 返回 `{turn_id, shard_index, shard_count, window_total, shard_size, candidates:[{handle,title,abstract,year}], note?}`。
  - **边界**：`shard_count<1` 或 `shard_index` 越界（<0 或 ≥shard_count）→ `{error}`；空窗口 / 空 shard → `candidates: []`、`shard_size: 0`、`note` 可解释（scorer 据此报告 scored 0），**不报错**。
  - 单 scorer fallback = `shard_count=1, shard_index=0` → 返回整窗。

### 4.2 JSONL 回写并发安全

- 按 `out_path` 维护进程内 `asyncio.Lock`（module-level dict，按 path 建键；MCP 单进程单事件循环模型下同一 loop 内复用同一锁）。
- **所有"读整份 → 改 → 原子重写同一份 JSONL"的写者都必须进同一把锁**，否则后写者会用读时旧快照覆盖先写者的字段：
  - `apply_scoring`（多个 scorer shard 并发回写 `score`）；
  - `enrich_session_async`（后台 venue 反查 + 分区 + 七维评分回写）—— 其 read→merge→rewrite 临界区进锁；慢网络富化在锁外完成，锁持有窗口短。
- 每个写者的 RMW 读到的是**当前**文件（含其他写者已落地的字段），只改自己负责的字段/handles，再原子重写 → 合并语义正确、无丢分（shard↔shard 不丢 `score`，shard↔enrich 不丢 `journalRank`/`venue`）。
- ⚠️ 历史教训：`apply_scoring` 把文件 I/O 改成 `await to_thread` 引入了 yield 点，若 `enrich` 不进同一把锁就会与 shard 交错互相覆盖——两段同锁后消除。

### 4.3 scorer 子 Agent

- 工具白名单：`["mcp__paper-search__get_scoring_shard", "mcp__paper-search__apply_scoring"]`（去掉 Bash —— 不再手写 Python 切片）。
- Step 0 改为**一次 `get_scoring_shard` 调用**，`shard_index`/`shard_count` 取自派活 brief（缺省 = 0/1，判整窗）。其余判分/回写逻辑不变。

### 4.4 PLAN / 派活协议

- scenario `general-query` / `citation-tracing` 默认在 `searcher` / `citation-explorer` 之后，emit **3 个 `parallel: true` 的 `scorer` shard 步骤**（`shard_index` 0/1/2，`shard_count` 3）。
- 主 Agent 派活协议（agent-prompt-builder）：**连续的 `parallel: true` 步骤组成一个并行组**，一次性并发派发，等组内全部 tool_result 回齐（barrier）后再进入下一顺序步骤 / terminal skill。`searcher` 不带 `parallel`（顺序），保证 scorer 组在候选已落盘后才启动。

## 5. 验收（见 issue #689 Acceptance criteria）

- Python 单测：窗口分片不相交+合并完整、空 shard、越界 shard、单 shard fallback、并发 `apply_scoring` 不丢分。
- Bun 契约测试：scenario 产出并行 scorer shards、scorer 白名单含 `get_scoring_shard` + `apply_scoring`、PLAN dispatch 协议支持同组并行步骤。
- `bun run typecheck` / `bun test` 通过；受影响包 patch 递增。

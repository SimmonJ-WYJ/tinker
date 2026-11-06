# scorer 确定性派发 Spec（Scorer Deterministic Dispatch）

> **状态**：实现已落地（judge + score_window + 渠道注入 + 编排删改；单测/契约/typecheck 全绿）· 待 dev 全链路实测（flash/pro 验 AC#1/#2）+ review/PR
> **关联 issue**：#745（scorer parallel 分片需 harness 级强制一次性派发）
> **关联 PR**：TBD
> **领域语言事实源**：本 spec §2；与 `docs/specs/parallel-scorer-shards-spec.md`（#689）、`docs/specs/lit-scoring-agent-spec.md`（score）对齐
> **取代**：#689 spec 的 §4.3（scorer 子 Agent 形态）+ §4.4（PLAN 并行派发协议）——见 §6 范围与 #689 关系
> **保留**：#689 spec 的 §4.1（服务端窗口+分片工具）+ §4.2（JSONL 并发写锁）**原样不动**

---

## 1. 背景与根因

lit-search 打分阶段，PLAN 里 N=3 个 `scorer` 分片标 `parallel: true`，本应主编排 Agent 在一个 turn 内一次性并发派发，实测在弱模型（dev 的 `deepseek-v4-flash`）上**退化为串行**：派 shard 0 → 等结果 → 才补派 shard 1/2，白白多花一整轮往返。

**根因（已读码确认）**：并行组「一次性派发」**纯靠主编排 Agent 读 prompt 自律，代码层零强制**。

- 规则只写在 prompt：`agent-prompt-builder.ts:575`（"issue all their Task calls together in a single batch"）；同文件 `:555-556` 注释自陈「PLAN 派活是建议非硬强制」。
- 子 Agent（Task）派发**完全由 SDK 黑盒管理**，orchestrator（`agent-orchestrator.ts:1928-2051`）只串行透传 SDK 消息流，全仓无任何代码解析 `steps[].parallel` 做强制并发。
- #689 spec §4.4 把整套并行**建立在这条 prompt 自律之上**——#745 即是对 §4.4 的 bug report。

## 1.1 为何不是方案 b（guard）或 issue 字面的方案 c

读码后两条都被排除（一手证据）：

- **方案 b（PreToolUse guard）治标**：guard 只能 check / deny / 注入 additionalContext，**不能改写工具参数、不能代理执行、不能在一个 turn 内收集多个 tool_use 批量派发**（`canUseTool` 返回 `PermissionResult = {behavior:'allow', updatedInput?} | {behavior:'deny'}`，见 SDK `sdk.d.ts:1779`）。它最多能在「漏派整组」后提示主 Agent 补派——派发权仍在 LLM 手里，仍是概率问题，不满足 AC「不依赖模型遵循」。
- **issue 字面的方案 c（harness 接管子 Agent 派发）被 SDK 堵死**：SDK 把 Task 当普通工具，无 parallel/barrier 语义、无「主动注入 tool_use 到消息流」的 API。要 harness 代主 Agent 一次性并发拉起整组子 Agent，只能 hack SDK 消息流——高风险、易僵死，机制上无干净介入点。

## 1.2 解法：把打分下沉成确定性工具（C-干净版）

scorer 子 Agent 干的**纯粹是 2 个 LLM 判断**（`semantic` + `method`，见 `sub-agents/scorer.md` Step 1）；窗口规则、分片切分、merge、其余维度、写 `score` **全是 Python 服务端确定性算的**（#689 §4.1/§4.2 已落地）。

→ 把「3 个 scorer 子 Agent 各自 `get_scoring_shard` → LLM 判分 → `apply_scoring`」换成 **paper-search MCP 新增一个 `score_window` 工具**：主 Agent **只调一次**，工具内部（Python）**确定性地**用 `asyncio.gather` 并发调模型判 semantic/method，再复用现有 `apply_scoring` 算 score + 写回。

**「要不要并行派发」这个让弱模型犯错的决策，从模型手里彻底拿走**——因为根本不存在「派发」这个步骤了。这就是「确定性的活用确定性代码，不派 Agent」的正解。

> **架构选型（2026-06-29，经 O1 验证拍板）**：判分落在 **Python（paper-search MCP）内**，而非主进程 Node service。理由：① 主进程无直连 paper-search MCP 的通道（它是 stdio 子进程、经 mcp.json 注入给 SDK Agent，主进程从不直接调其工具）；② 打分逻辑重心 100% 在 Python（窗口规则 `select_scoring_window`、分片 `get_scoring_shard`、score 七维 `score_record`、写回锁 `_scoring_write_lock` 全在 `process_service.py`），Node 重写必漂移；③ 给 Python 子进程注入 key 是既有模式（`paper-search.env` 已注入各学术源 key）。Node service 方案需新建 Node→Python MCP client 跨进程胶水，次优。详见 §6 架构决策。

## 1.3 设计判断：scorer 为何下沉为确定性工具（而非保留子 Agent）

下沉 scorer 会从 lit-search 能力包里**移除一个子 Agent**，触及两个第一性问题。结论先行：**这不是"轻易增删子 Agent 侵蚀能力包范式"，而是修正一个本就不该 agent 化的阶段；且下沉≠去 LLM。**

**判据：什么该是子 Agent，什么该是确定性工具。**

- **子 Agent** 适合需要**自主规划 / 多轮探索 / 不确定路径**的活——典型是 `searcher`：自己决定查哪些源、查几轮、何时 early-stop。
- **确定性工具** 适合**固定流程**——即使流程内部包含 LLM 调用。

按此判据 scorer 属后者：固定 rubric、工具白名单仅两个固定调用（`get_scoring_shard` / `apply_scoring`）、无多轮自主决策、输出结构化 JSON。把"一段确定流程 + 一次 LLM 判断"包成 agent 本身是设计味道——**#745 的 bug 正源于此**：为了拿到"LLM 判分"，被迫走"主 Agent 自律派发子 Agent"这条不确定的路。

**关键澄清：下沉成确定性工具 ≠ 这阶段不用 LLM。**

scorer 的核心是两个**真·LLM 判断**（`semantic` / `method`，语义相关性无法规则化），方案**完整保留**（§4.1 step 2：handler 用判分 rubric 作 system prompt 调模型 API）。变的只是**编排**：

| 这件事 | 谁来做 | 变化 |
|--------|--------|------|
| 逐篇判 `semantic` / `method` | **LLM** | 不变，一篇不少 |
| 切片 / 并发调模型 / 回写 | 确定性代码 | 子 Agent 即兴派发 → 代码并发调 API |

子 Agent 形态把"判分智能"和"派发编排"**捆死**；下沉是把二者**解耦**——需要智能的继续 LLM，确定性的交给代码。符合「确定性的活用确定性代码，需要智能的才上 LLM」。

**反方留痕（为何此刻仍下沉）**：保留 scorer 子 Agent 的唯一实在价值是**未来可扩展性**——若打分日后需变"更聪明"（读全文 / 查证 / 多轮推理判分），agent 形态留余地，工具形态会僵。但现状 scorer 仅判 `abstract` 两个维度，离"需要 agent 级智能"很远，该余地是投机性的（YAGNI）。若未来打分确需 agent 级智能，再 agent 化即可——届时是有据的重新设计，而非维持一个当下不成立的形态。

## 2. 术语（领域语言）

- **V2 scoring window / shard / scorer**：沿用 #689 §2，不变。
- **scoring service（打分服务）**：主进程内新增的确定性模块，负责「为每个 shard 并发调模型判 `semantic`/`method` 并回写」。取代 scorer 子 Agent 的判分职责。
- **`score_papers`（工具）**：暴露给主编排 Agent 的 in-process MCP 工具（`mcp__scoring__score_papers`），一次调用完成整轮打分。
- **`score_window`（工具）**：paper-search MCP 新增的工具（`mcp__paper-search__score_window`），主 Agent 一次调用完成整轮打分（窗口选取→并发判分→写回）。取代「3 个 scorer 子 Agent」。
- **judge 模块**：paper-search 内新增的 Python 模块，负责「调模型判 `semantic`/`method`」这一步——scorer 子 Agent 唯一的 LLM 职责下沉于此。
- **判分 rubric**：`semantic`/`method` 的 0–100 打分细则 + 硬约束（缺摘要 ≤50、领域重叠 ≤50 等），现存于 `sub-agents/scorer.md` Step 1，下沉为 judge 模块的 system prompt。

## 3. 目标与边界

完成后：

1. lit-search 打分**用户可见行为不变**（仍是 searcher 之后打分、UI 全量按分展示），但打分由**单次确定性工具调用**（`score_window`）完成，分片并发发生在 Python 工具内部的确定性代码里。
2. **行为对 `deepseek-v4-flash` 与 `deepseek-pro` 均成立，不依赖模型指令遵循强弱**（AC 核心）。
3. **barrier 语义保留**：某分片判分失败/超时，其余分片仍正常完成回写，不互相阻断（`asyncio.gather(return_exceptions=True)`）。
4. 非并行（顺序）步骤不受影响、无回归。

**硬边界**：

- 打分用的模型/渠道**必须与生产主链路一致**（prod = `deepseek-pro`），复用 orchestrator 同一套 channel + 模型解析（经 env 注入给 paper-search），不新增模型配置面。
- **复用 Python 现有打分件不重写**：`select_scoring_window` / `get_scoring_shard` 切片口径 / `apply_scoring` / `score_record`（#689 §4.1/§4.2，含并发写锁）原样复用；新增的只有「调模型判分」这一层。
- API key 走 paper-search **既有 env 注入模式**（`paper-search.env` + `getConfigEnvForChildren`）下发模型渠道 key——与现有学术源 key 同类，不引入新泄漏模式。

## 4. 设计

### 4.1 新增：Python 判分模块 `paper_scoring_judge.py`

`apps/electron/resources/paper-search-mcp/paper_search/service/paper_scoring_judge.py`（新文件）

职责：给定候选列表 + research_question/method_terms/object_terms，调模型判 `semantic`/`method`，返回 `{handle:{semantic,method}}`。

- `async def judge_candidates(candidates, research_question, method_terms, object_terms) -> dict`：
  - 读 env 拿模型渠道：`ASCI_SCORING_MODEL` / `ASCI_SCORING_BASE_URL` / `ASCI_SCORING_API_KEY`（主进程注入，见 §4.4）。
  - system prompt = 判分 rubric（§4.3）；user message = 候选 `{handle,title,abstract,year}` 列表。
  - 调模型 **非流式** messages 端点（只需最终 JSON，省去 SSE 解析）——用 `httpx.AsyncClient`（Python 现有 connector 用同步 `requests`，判分新增 async http）。
  - 解析返回 `{handle:{semantic,method}}`；缺字段/越界按 rubric 钳制（缺摘要 ≤50 等）。
  - 超时（env `ASCI_SCORING_TIMEOUT_SEC`，默认对齐 enrich 量级）；异常上抛，由 §4.2 按 shard 兜。

### 4.2 新增：MCP 工具 `score_window`（`mcp_server.py`）

`@mcp.tool() async def score_window(...)`，与 `retrieve` / `apply_scoring` 同文件注册：

```python
@mcp.tool()
async def score_window(
    research_question: str,
    method_terms: str = "",      # JSON 数组字符串，与 retrieve 同形
    object_terms: str = "",
    shard_count: int = DEFAULT_SCORING_SHARD_COUNT,   # 内部并发批数，默认 3
    session_id: str = "",
    turn_id: str = "",
) -> dict:
    # 1. 读 JSONL → select_scoring_window(records, turn_id) → window（复用）
    # 2. round-robin 切 shard_count 批（复用 get_scoring_shard 的切片口径 window[i::n]）
    # 3. asyncio.gather(*[judge_candidates(批)...], return_exceptions=True) —— barrier
    #    每批独立调模型；某批 raise → 记 failed_shards，不阻断其余
    # 4. 合并各批 {handle:{semantic,method}}
    # 5. await apply_scoring(merged, session_id, turn_id) —— 复用，算 score + 写回 + 锁
    # 6. return {scored, missing, window_total, shard_count, failed_shards}
```

- 主 Agent **只调一次** `mcp__paper-search__score_window`——确定性单次调用，无并行派发问题。
- 空窗口（`window_total==0`）：直接返回 `{scored:0, window_total:0, note}`，不调模型、不报错（沿用 scorer.md 空窗口语义，供主 Agent 报告"无候选可打分"）。
- 分片是工具内部**实现细节**（并发批数），不再是主 Agent 可见的 PLAN 步骤。

### 4.3 判分 rubric 下沉

把 `sub-agents/scorer.md` 的 **Step 1 判分细则 + Hard constraints** 抽到 Python 侧 prompt 常量（建议 `paper_scoring_judge.py` 内常量或同目录 `judge_rubric.txt`），由 §4.1 作 system prompt。

- 去掉 SDK 专属部分（Step 0/2 工具调用、Step 3 输出语言、tool 白名单）——由工具确定性接管。
- 保留全部判分语义（semantic/method 0–100 bands、缺摘要 ≤50、领域重叠 ≤50、calibration 锚点）——**判分质量不变**（同一 rubric、同一模型）。

### 4.4 模型渠道注入（主进程 → paper-search env）

`apps/electron/src/main/lib/paper-search-integration.ts` + orchestrator 模型解析：

- 复用 orchestrator 现有渠道/模型解析（`agent-orchestrator.ts:607 buildSdkEnv` / `:1620` manifest 别名 / `:1708` effectiveModelId + `channel-manager.decryptApiKey` / `getChannelById().baseUrl`），解析出与子 Agent **同源**的打分模型 id + baseURL + key。
- 经 paper-search 既有 env 注入通道（`getConfigEnvForChildren` / mcp.json env 段）下发 `ASCI_SCORING_MODEL` / `ASCI_SCORING_BASE_URL` / `ASCI_SCORING_API_KEY`。
- **dev/prod 打分模型与子 Agent 时代一致**（dev=flash、prod=pro，均可，因派发已确定性）。

### 4.5 删除/改写：scorer 子 Agent 与 PLAN 协议

- **删除** `sub-agents/scorer.md`（已拍板，见 §7 O2）。
- **scenario `system-prompt.md:211` 段**：不再 emit 3 个 `parallel:true` scorer 步骤；改为在 searcher/citation-explorer 之后，主 Agent **一步**调 `mcp__paper-search__score_window`。删除「Parallel scorer shards」「main Agent owns the parallel-group dispatch」整段及 scorer hand-off 字段说明（`research_question` 等改为 `score_window` 入参）。
- **`agent-prompt-builder.ts:575`** 的 parallel-group 协议：**保留机制**（O3 已验：lit-review scenario 仍用 `parallel:true`，见 `lit-review/.../system-prompt.md:44,91`）；仅把该段里举的「lit-search runs its V2 scorer shards」过时例子改为泛化/lit-review 例子。
- 主 Agent `allowedTools`：**已验无需改**——lit-search 跑 `default` 模式，`resolveMasterAllowedTools` 返回 `undefined` → SDK 默认全开（`present_search_plan` 同样无显式 allow）。

## 5. 验收（对齐 issue #745 AC）

| # | AC | 本方案如何满足 |
|---|-----|--------------|
| 1 | N≥2 分片在同一批次发出（任一返回前其余已派发） | `score_window` 内 `asyncio.gather` 同步发起全部批的模型调用——确定性，无「派一个等结果」 |
| 2 | 对 flash 与 pro 均成立，不依赖模型遵循 | 并发在 Python 代码里，模型只负责判分内容，不再决定派发节奏 |
| 3 | barrier 语义：某分片失败其余仍完成 | `asyncio.gather(return_exceptions=True)`，失败批记 `failed_shards` |
| 4 | 非并行步骤不被误并发，无回归 | 只改 scorer 这一步；retrieve/searcher/其余 PLAN 步骤不动 |
| 5 | 可判定验证 + 单测 | 见下 |
| 6 | （方案 b guard 专属，N/A） | 本方案不走 guard |

**测试**：

- Python 单测（`score_window` / `judge_candidates`，mock 模型 http）：① 多批并发判分→全部 merge 回写；② 某批 raise→其余照常完成、计入 `failed_shards`（barrier）；③ 空窗口不调模型不报错；④ 越界/缺字段判分钳制；⑤ 复用 `apply_scoring` 写回 score 正确（沿用 #689 现有并发写测试）。
- 可判定验证（替代「JSONL 派发时间戳聚批」）：单测断言 `asyncio.gather` 对 N 批的 `judge_candidates` 调用在任一返回前已全部发起（mock 计时/调用序）。
- Bun 契约测试：scenario PLAN 不再产并行 scorer 步骤、主 Agent 工具白名单含 `score_window`、`sub-agents/scorer.md` 已删。
- `bun run typecheck` / `bun test` + Python 测试通过；受影响包 patch 递增。

## 6. 架构决策与 #689 关系

### 6.1 架构决策：判分落 Python（架构 B）vs 落 Node（架构 A）

| | 架构 A（Node service） | 架构 B（Python，采用） |
|---|---|---|
| 判分跑在 | Node 主进程（`streamSSE`+`AnthropicAdapter`） | Python paper-search（`asyncio.gather`+httpx） |
| 窗口/分片/score 写回 | 要**新建 Node→Python MCP client** 跨进程调 | 本就在 Python，**零胶水**复用 |
| key | 不出主进程 | 走既有 env 注入（同学术源 key） |
| 新成本 | Node↔Python 胶水 + turn_id/路径协调 | Python 新增「调模型」能力（http 基建已有 `requests`，判分加 async `httpx`） |

**采用 B**：打分逻辑重心本就全在 Python，B 最内聚、零跨进程胶水；A 的「复用现有 Python 工具」需新建主进程没有的 MCP client（O1 实证），次优。代价是 Python 首次具备「调 LLM」能力——但 http 基建已有、判分非流式实现简单、key 注入是既有模式。

### 6.2 与 #689 关系（扩范围）

#745 原「范围外」写明「scorer 分片数（固定 3）—#689 刻意设计，不在本 issue 动」。**本方案不改分片数（仍按 3 作并发批数），但改 scorer 派发形态（子 Agent → Python 工具内并发）并删 `scorer.md`**，已与用户确认**扩范围**：

- **保留 #689**：§4.1 `select_scoring_window`/`get_scoring_shard`、§4.2 `apply_scoring` 并发写锁——原样复用。
- **取代 #689**：§4.3 scorer 子 Agent 形态、§4.4 PLAN 并行派发协议——#745 根因所在。
- PR 描述注明取代关系；`parallel-scorer-shards-spec.md` 加状态指针指向本 spec。

## 7. 开放问题

- ~~**O1**：scoring service 怎么调 Python 工具？~~ **已验（2026-06-29）**：主进程无直连 paper-search MCP 的通道 → 改架构 B（判分落 Python），不需跨进程调用。见 §6.1。
- ~~**O2**：`scorer.md` 删除还是留 fallback？~~ **已拍板：删除**（见 §1.3）。
- ~~**O3**：parallel-group 协议是否有 scorer 之外的消费者？~~ **已验（2026-06-29）：有——lit-review scenario 仍用 `parallel:true`（`system-prompt.md:44,91`）。协议机制保留，仅改 lit-search 不再用它派 scorer + 更新 prompt-builder 里过时的 scorer 例子。**
- **O4**：进度流式（`已打分 X/Y`）本 PR 顺带兑现 #775 scorer 部分，还是只留 `score_window` 返回字段、#775 单独做？倾向后者（守范围）。注：架构 B 下进度只能随 `score_window` 整体返回（无子 Agent 中途事件），#775 若要「逐批进度」需 score_window 额外推送通道，归 #775。
- ~~**O5**：Python 调模型的鉴权头/请求体格式？~~ **已验（2026-06-29）：Anthropic Messages API（Anthropic-compat）非流式。** deepseek 走 Anthropic 兼容端点（`deepseek-profile.ts` 注释 + `defaultProbeModel` 返回 Claude id + `extraHeaders` 空）；子 Agent wire（`buildSdkEnv`）= `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` + `ANTHROPIC_AUTH_TOKEN`（`Authorization: Bearer`）。→ judge 用 `httpx` `POST {baseURL}/v1/messages`，body `{model, system, messages, max_tokens, stream:false}`，镜像 `AnthropicAdapter` 请求构建去掉 SSE。模型 id：prod=`deepseek-v4-pro`、dev=`deepseek-v4-flash`。

## 8. 实施顺序（TDD）

1. **验 O5**：确认生产打分渠道（`deepseek-pro`）的 messages wire 格式（端点/鉴权头/请求体），对齐 `packages/core/providers/profiles`。
2. **judge 模块**（`paper_scoring_judge.py`）：先写 Python 单测（mock http）→ 实现 `judge_candidates`（含 rubric 下沉 §4.3）。
3. **`score_window` 工具**：先写单测（并发/barrier/空窗口）→ 实现，复用 `select_scoring_window`/`apply_scoring`。
4. **模型渠道注入**（§4.4）：orchestrator 解析 + paper-search env 下发。
5. **编排删改**（§4.5）：scenario PLAN + 删 scorer.md + prompt-builder 清理 + 工具白名单。
6. **契约测试 + 全链路 dev 实测**（flash 与 pro 各一次，确认 AC#1/#2）。

> 历史科研规格：保存旧设计和数据语义，不作为当前新增功能或恢复运行接线的要求。科研主动功能正按[退役规格](./2026-11-10-research-retirement.md)分批收口，实际完成与未验收范围以对应执行记录为准。

# 失败触发扩源（failure-triggered source expansion）

| 项 | 值 |
|---|---|
| 状态 | Implemented but **default-OFF（opt-in）** — 实测自动扩源慢 + 备用源质量差（见 §6/§9），故 `PAPER_SEARCH_FAILURE_EXPANSION` 默认 `0`，仅显式开启时生效 |
| 关联 issue | （待建） |
| 关联 PR | （待开；属 `feat/refactor-lit-search` 检索稳定性系列） |
| 领域语言事实源 | `CONTEXT.md`；本 spec 术语：源健康度 `source_health`、失败源 `failed_sources`、备用源 backup source |

---

## 1. 背景与动机

论文源是后续一切工作的地基。实测多轮 trace 显示主力源 `openalex`/`crossref` 会偶发**整源失败**（返 0 / 超时 / 限速），同一类查询各源返回数在 0↔45 间剧烈跳变。已落地的韧性措施：

- 服务端**失败源单次重试**（`_fanout_with_single_retry`，只重 `verdict=failed`，真空不重）；
- polite-pool 真实邮箱降被限速概率；
- 搜索结束后向用户**上报失败平台 + 提供用户触发的再检索**。

**仍缺的一环**：当主力源重试后**仍失败**时，没有任何机制改用**别的源**补回丢失的覆盖。现有唯一沾边的 `arxiv_top_up` 是"召回少"触发、且只补 arxiv、且 arxiv 已在请求源时不触发——对"主力源失败"无效。

## 2. 目标 / 非目标

**目标**：主力源失败导致覆盖缺失时，自动查询一组**有界的备用源**补缺，降低"主力挂掉 → 结果空/残"的概率，且全程有界、不递归。

**非目标**：
- 不治"全网断"（备用源也会一起挂——那只能靠已有的用户上报+稍后重试）；
- 不治"真空/0 数据"（确无匹配，扩源也无意义——**0 数据不扩源**，与既定边界一致）；
- 不替代缓存/不做离线（另议）。

## 3. 现状（精确）

`retrieve` 内运行时扩源只有 `arxiv_top_up`：触发条件 `distinct < 20` **且** `"arxiv" not in sources` **且** arxiv 可用 → 补一轮 arxiv。对源失败场景不触发、不对症。详见 `search_service.py:427`。

## 4. 设计

### 4.0 默认关闭（opt-in）— 实测结论
实测：自动扩源**慢**（多数备用源回落到 20s 默认超时 + 额外串行阶段，最坏一次检索叠到 30s+）且**备用源对通用查询质量差**（doaj/openaire 偏边角、europepmc/pmc 偏生物医学）。失败场景已由"失败重试 1 次 + 收尾如实上报 + 用户触发重试主力源"体面覆盖。故扩源 **默认关闭**，由 env `PAPER_SEARCH_FAILURE_EXPANSION=1` opt-in（建议配了 semantic key 再开）。`_failure_expansion_enabled()` 守门，关闭时 `failure_expansion.triggered=False`、不打任何备用源。下文 4.1–4.5 描述的是**开启后**的行为。

### 4.1 触发
开关开启**且** `_fanout_with_single_retry` 返回的 `failed_sources` 非空（有请求源重试后仍 `verdict=failed`）时，触发一次扩源。`empty`（真空）不触发。

### 4.2 备用源池（分层、领域感知）
排除规则（永远先过滤）：死源/黑名单（zenodo/base/citeseerx/google_scholar/chemrxiv/ssrn/dblp）、**已在本次请求 `sources` 里的源**（含已失败的——它已重试过，不再纳入）。

候选（按可得性分层）：

| 层 | 源 | 条件 |
|---|---|---|
| 通用免 key | `doaj`、`openaire` | 始终可选（跨领域 OA 聚合，alive） |
| 通用需 key | `semantic` | **仅当 `PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY` 已配**（否则 fail-fast 返空，白占名额） |
| 领域专用 | `europepmc`/`pmc`/`pubmed` | `domains` ∋ 生物/医学/生命科学 |
| 领域专用 | `iacr` | `domains` ∋ 密码/安全 |

领域来源：给 `retrieve` 新增可选 `domains: List[str]` 参数（planner 本就有 `domains`，经 searcher brief 透传；缺省则只用通用层）。

**封顶**：最终备用源数 ≤ 3（控延迟/配额）。优先级：领域专用 > semantic（有 key）> doaj/openaire。

### 4.3 机制 / 合并
1. `backup_sources = (候选 ∩ 可用) − 死源 − 请求源`，取前 ≤3。
2. `build_query_matrix(keywords, sources=backup_sources, object_terms, ...)` 建备用矩阵。
3. 经 `_fanout_cells(backup_matrix)` **打一轮**（**不**走单次重试、**不**递归——备用源自身返 0/失败就接受）。
4. 并入 `by_source`，与主结果同流走去重 / enrich / F22 / rerank。

### 4.4 顺序（插在 single-retry 之后、arxiv_top_up 之前）
```
首轮 fan-out → 失败源单次重试 → [仍有 failed?] → 失败触发扩源(本 spec)
            → 重算 distinct → [仍 < 阈值?] → arxiv_top_up → dedup/enrich/score
```
扩源放在 arxiv_top_up 之前，使 top-up 的 `distinct` 反映扩源后的量（扩够了就不必再 top-up）。

### 4.5 与"用户上报"协同（已落地的 P3）
扩源是**自动补一层**；扩完仍残缺时，既有的"失败上报+用户触发重试"作为**第二道防线**。收尾文案应如实区分：
- "openalex 失败,已用 doaj/openaire 备用源补充 N 篇"（透明告知用了备用源）；
- 若仍想要主力源覆盖,用户可选择再检索。

stats 增加 `failure_expansion = {triggered, sources, added}` 供上报。

## 5. 边界（硬约束，沿用既定纪律）
- 仅 `failed_sources` 非空触发；真空/低产不触发本机制。
- **一轮**扩源,不递归、备用源不再单独重试。
- 备用源数 ≤ 3；死源/请求源永不入池。
- 无 key 时 semantic 不入池。

## 6. 诚实局限
- **通用 CS 查询备用池薄**：openalex+crossref 都挂时,免 key 通用备用只有 doaj/openaire,覆盖小于主力;semantic 卡 key。配上 semantic key 才"够用"。
- **全网/本机网络故障**：备用源同样不可达,本机制无效,回落到用户上报。

## 7. 实现落点
- `paper_search/service/search_service.py`：`retrieve` 加 `domains` 参数 + 4.4 的扩源段；新增 helper `_pick_backup_sources(requested, domains)`（纯函数,易测）。
- `paper_search/service/query_matrix.py`：确认 doaj/openaire/europepmc/iacr 的 per-source 查询塑形可用,缺则补默认塑形。
- `default-capability-packs/lit-search/sub-agents/searcher.md`：brief 透传 `domains` 给 retrieve（**全英文,守红线 3**）。
- 版本：paper-search + @asci/electron patch 递增。

## 8. 测试计划
- `_pick_backup_sources` 纯函数单测：排除死源/请求源、领域映射、无 key 去掉 semantic、≤3 封顶。
- 扩源集成测：fake registry 下主力 fail → 触发扩源、并入备用结果；真空不触发；扩源一轮不递归。
- 回归：`default-capability-packs-load`（searcher.md 改后无 CJK）、现有 retrieve/timeout 测试。

## 9. 待定决策
1. `domains` 透传:本 spec 推荐"加 retrieve 参数";备选"从 arxiv_categories 反推"(省一处 plumbing 但 non-arxiv 计划无 categories)。
2. 是否默认尝试配 semantic key（配了通用备用从"薄"变"够用"）——属运维决策,非本 spec。
3. 备用源数封顶 3 是否合适（延迟 vs 覆盖）。

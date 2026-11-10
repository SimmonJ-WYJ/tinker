> 历史科研规格：保存旧设计和数据语义，不作为当前新增功能或恢复运行接线的要求。科研主动功能正按[退役规格](./2026-11-10-research-retirement.md)分批收口，实际完成与未验收范围以对应执行记录为准。

# 精确核心词全量召回 Spec（Precise-Core Exhaustive Retrieval）

> **状态**：已实现 · PR review 中
> **关联 issue**：无（直接 PR）
> **关联 PR**：[#553](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/553)
> **领域语言事实源**：`CONTEXT.md`（object anchor / 锚 / 召回）
> **依赖输入**：`lit-search-failure-source-expansion-spec.md`（retrieve 编排）、`search_service.py` `build_query_matrix` / `retrieve`

---

## 1. 背景与动机

当前 retrieve 对所有 (关键词 × 源) 查询统一截在 `RETRIEVE_MAX_RESULTS_PER_QUERY = 10`
篇。这是"广义召回"设定：每条查询不论命中几万篇，只取前 10。问题是——**对题的精确
核心论文召回严重不足**。

实测（query「深度学习方法如何拓展光场显微镜的景深？」，OpenAlex `meta.count`）：

| object_term | `title.search:` 全量 | `search=`（广义）全量 |
|---|---|---|
| light field microscopy | **611** | 723,960 |
| extended depth of field | **705** | 1,877,659 |
| computational microscopy | **878** | 327,040 |
| volumetric imaging | 4,918 | 436,969 |
| microscopy imaging | 29,370 | 1,743,719 |

结论：
- **广义 `search=` 全量无意义**（几十万~百万级，全是宽词噪声），必须维持 cap=10。
- **精确 `title.search:` 在"具体核心词"上只有几百篇**（611/705/878），完全拉得下来；
  在"泛词"上才会膨胀（volumetric 4918 / microscopy imaging 29370）。

**目标**：精确核心词（`title.search` 全量 ≤ 阈值）拉全量，泛词与广义查询都不抓。

## 2. 决策（已与用户敲定）

1. **核心词阈值 = 1000**：`title.search` 的 `meta.count ≤ 1000` 视为"精确核心词"，
   拉全量；`> 1000` 视为泛词，**不翻页全量抓**，但返回已拉到的第 1 页前
   `generic_fallback`（= 裸 cell cap，默认 10）篇兜底。
   > 修订（PR #553 review P1）：原设计泛词返回 `[]`，但 exhaust cell 在矩阵里
   > 顶替了同 query 的裸 cell，泛词归零 = 该 query 的 OpenAlex 召回回退；第 1 页
   > 本来已请求回来，取头部零额外成本，ordering 与裸 cell 的 title-first 阶段相同。
2. **方法关键词保留 @10**：现有 `build_query_matrix` 的关键词裸版/锚版 cell（cap=10）
   全部保留，保证方法维度（如 deep learning）的召回不丢。
3. **仅 OpenAlex**：全量豁举只对 OpenAlex（有 `meta.count` + cursor 翻页）。crossref /
   arxiv 等维持现状。

## 3. 设计

### 3.1 闸门下沉到连接器（OpenAlex `mode="title_exhaust"`）

`OpenAlexConnector.search(query, max_results, **kwargs)` 新增 `mode` 分支：

```
mode == "title_exhaust":
  ① 拉第 1 页 filter=title.search:<query>, per_page=200, cursor='*'，读 meta.count
  ② count > core_threshold(默认 1000) → 泛词 → 返回第 1 页前 generic_fallback 篇
     （不翻页；兜底顶替掉的裸 cell，召回不归零 —— 见 §2 决策 1 修订）
  ③ count ≤ threshold → cursor 翻页拉全量，累计到 min(count, max_results)
```

- 单词最坏 1000 篇 = 5 页（per_page=200）；title_exhaust cell 用单独的
  `PRECISE_CORE_TIMEOUT_SEC`（25s）超时，不沿用 openalex fast-path 8s。
- **单页 timeout = 10s**（PR #553 review P3）：须明显小于 cell 级 25s 预算——
  实测每页 <1~3s；若单页 30s 会一页烧光 cell 预算，且 `asyncio.wait_for` 超时后
  已翻完的页整体丢弃，挂页应 fail-fast。
- `core_threshold` / `generic_fallback` 由 cell 的 kwargs 透传，便于测试 / env 调参。
- 仍复用 `_parse_item`（抽出现有 `_fetch_works` 的逐条解析为可复用单元）。

### 3.2 矩阵保持纯函数（`build_query_matrix` 只加 cell）

`build_query_matrix` 新增：当 `"openalex" in sources` 且 `object_terms` 非空且
`PRECISE_CORE_ENABLED` 时，为前 `PRECISE_CORE_TERM_CAP` 个**最具体**的
object_term（复用 `_rank_object_anchors` 的 token 数降序）各追加一个 OpenAlex
title_exhaust cell：

```python
{"source": "openalex", "query": term,
 "max_results": PRECISE_CORE_HARD_CAP,
 "kwargs": {"mode": "title_exhaust",
            "core_threshold": PRECISE_CORE_COUNT_THRESHOLD,
            "generic_fallback": max_results}}  # 泛词兜底量 = 裸 cell cap
```

- 同 query 的既有 openalex 裸 cell 被 exhaust cell 顶替（去重；泛词时连接器返回
  第 1 页头部兜底，行为与裸 cell 的 title-first 阶段等价，不会召回回退）。
- **TERM_CAP 封顶**（PR #553 review P2）：规划层 LLM 可能给 6–8 个 object_terms，
  无上限会塞进同样多条「25s 超时 × 最多 5 页」的 cell，尾延迟失控；与锚版
  `QUERY_MATRIX_ANCHOR_CAP` 同思路，取最具体的前 N 个（默认 4）。
- **不碰网络**：泛/核心由连接器运行时按 `meta.count` 判定，矩阵保持确定性、可单测。

### 3.3 常量

```python
PRECISE_CORE_ENABLED          = env "PAPER_SEARCH_PRECISE_CORE" 默认 "1"
PRECISE_CORE_COUNT_THRESHOLD  = env "PAPER_SEARCH_PRECISE_CORE_THRESHOLD" 默认 1000
PRECISE_CORE_HARD_CAP         = env "PAPER_SEARCH_PRECISE_CORE_HARD_CAP" 默认 1000
PRECISE_CORE_TERM_CAP         = env "PAPER_SEARCH_PRECISE_CORE_TERM_CAP" 默认 4
PRECISE_CORE_TIMEOUT_SEC      = env "PAPER_SEARCH_PRECISE_CORE_TIMEOUT_SEC" 默认 25
```

## 4. 预期影响

- 候选池：现 ~80–128 → 预计 ~1500–2200（3 个核心词各几百，去重后）。
- 泛词（microscopy imaging 29370 / volumetric 4918）不全量入池，只保留第 1 页
  前 10 篇兜底（与原裸 cell 贡献相当）。
- 下游：F22 本地排序 / dedupe 不受影响；score 仍只判 top_k=50（精确核心高度对题，
  判分窗口被对题论文占满 = 质量提升，非稀释）；journalRank 走本地 fenqu 不惧规模；
  venue backfill 维持 top-N 网络兜底。

## 5. 测试（BDD）

- `test_query_matrix.py`：openalex+object_terms → 矩阵含 object_term 的
  title_exhaust cell（带 mode/core_threshold/generic_fallback）；关键词 @10 cell
  仍在；非 openalex 源不加；超过 TERM_CAP 时只保留最具体的前 N 个
  （`test_precise_core_term_cap_most_specific_first`）。
- openalex 连接器单测（mock requests）：
  - count ≤ threshold → cursor 翻页累计全量（单页 timeout < cell 级 25s）；
  - count > threshold → 返回第 1 页前 generic_fallback 篇、不翻页
    （`test_title_exhaust_generic_term_falls_back_to_first_page_head`）；
  - 翻页在 max_results 处停。

## 6. 回滚

`PAPER_SEARCH_PRECISE_CORE=0` 即整体关闭，退回纯 @10 行为。

## 7. 配套：F22 调权为「对题度主导」

全量核心把候选池从 ~80 拉到 ~2000，但喂给 LLM scorer 的只有 F22 排序 top_k=50。
F22 原权重 citations 0.25 + recency 0.25 占 50%、keyword_relevance 仅 0.20——对
全量精确核心（标题均含对象词、对题度高度同质）几乎只按「高引 + 近期」排序，会把
真正方法对题但引用少的新论文挤出 top_k。

故同步调整 `scoring.py` `DEFAULT_WEIGHTS`（用户决策）：

| 维度 | 旧 | 新 |
|---|---|---|
| keyword_relevance（对题度） | 0.20 | **0.50** |
| citations（引用量） | 0.25 | **0.10** |
| recency（近期度） | 0.25 | **0.10** |
| citation_velocity | 0.15 | 0.15（不变） |
| venue_presence | 0.15 | 0.15（不变） |

总和仍 = 1.0。行为守门：`test_scoring.py::test_relevance_dominates_over_citations`
（完全对题低引近期论文必须反超高引不对题老论文）。

## 8. 配套：多锚召回（降低锚抖动，spec B 选项）

锚由规划层 LLM 现生成，两次采样（尤其中/英文 query）给出的最具体 object_term 不同
（实测 A=`light field microscopy` vs B=`extended depth of field`，锚集合零重叠）。
旧设计每个关键词只发单锚版 `<anchor> <kw>`，锚是**前缀**、乘进每条锚版查询 → 锚一换，
**全部**锚版查询集体平移（乘数效应），两次 top_k 大幅分叉。

改为**多锚**（`_rank_object_anchors` + `QUERY_MATRIX_ANCHOR_CAP`，默认 3）：openalex/crossref
每个关键词对前 N 个最具体 object_term 各发一份锚版。锚的单点抖动只影响其中一份，且两次
运行的锚集合重叠更多 → 召回与 top_k 更稳。arxiv 节流严格，仍用单个最具体锚。

- 成本：openalex/crossref cell ≈ `per_source_cap × (1 + ANCHOR_CAP)`，cap=3 时约为单锚的 2×。
- 调参：`PAPER_SEARCH_QUERY_MATRIX_ANCHOR_CAP`；调大更稳但请求更多（典型 object_terms ≤5，
  设 5 即「全部参与」）。
- 守门：`test_query_matrix.py` 的 `test_openalex_multi_anchor_all_object_terms` /
  `test_multi_anchor_capped_most_specific_first` / `test_arxiv_uses_single_most_specific_anchor`。

## 9. 配套：keyword_relevance 公式修复（A 饱和分 + B 变体归一化）

实测发现高相关论文沉底：全量核心池里 65 篇"深度学习×光场×景深"三维全中的论文掉到
top_k=50 之外（含教科书级对题的 `DeepDOF: Deep learning extended depth-of-field`，
排 #137）。根因是 `_score_keyword_relevance` 旧公式 = 命中数 / 全词表长度：

1. **稀释**：规划层给 6 method + 6 object 词，一篇聚焦论文只命中核心 1 个 → 1/6≈0.17，
   与完全不命中难区分。一篇泛 DL 综述（method 2/6、object 0/6）反而靠引用排到 #2。
2. **变体漏匹配**：`extended depth-of-field`（连字符）匹配不到词条 `extended depth of field`；
   `light-field`↔`light field` 同理。

修复（`scoring.py`）：
- **A 饱和分**：每轴 `_axis_saturating_score(hits, n) = base + (1-base)×(hits/n)`，base=0.6。
  任一命中即给 0.6（确立"对题"），命中更多仅小幅加成。单词项轴（n=1）满命中→1.0、
  不命中→0.0，与旧 {0,0.5,1.0} 双维语义向后兼容。
- **B 变体归一化**：`_norm_match` 把连字符/下划线/破折号→空格 + 折叠空白，匹配前对
  文本与词条同时归一化。

效果（对 ea086796 重打分）：聚焦论文 KR 17→70+；top50 内三维全中 9→17 篇；两篇直接
救回 top50。守门：`test_scoring.py` 的 `test_focused_paper_not_diluted_by_long_term_list` /
`test_variant_normalization_hyphen`。

> 残留：部分对题但低引论文（如 DeepLFM cc=17）KR 已 70+ 仍未进 top50——此时瓶颈是引用/
> 时效维（另 0.5 权重），非 keyword_relevance；需另调 citations 权重或 top_k，不在本次范围。

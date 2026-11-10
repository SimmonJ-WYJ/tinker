> 历史科研规格：保存旧设计和数据语义，不作为当前新增功能或恢复运行接线的要求。科研主动功能正按[退役规格](./2026-11-10-research-retirement.md)分批收口，实际完成与未验收范围以对应执行记录为准。

# lit-scoring-agent — 证据驱动文献评分（score，与 F22/v1 并行）

- 状态：已落地（MVP 阶段 1，scorer 已设为默认判官）
- 关联 ADR：[ADR-010](../adr/ADR-010-evidence-driven-scoring-agent.md)（决策记录：为何引入 score、相关性主导、与 F22 耦合并行）
- 关联 issue：（待补）
- 关联 PR：[#511](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/511)
- 领域语言事实源：本仓库 `CONTEXT.md` + 设计母本《ASCI_文献评分排序Agent方案_修订版v3》（Obsidian，附录 C 为 ASCI 现状映射）
- 代码事实源：`paper_search/service/paper_scoring.py`、`paper_search/service/venue_tier.py`、`sub-agents/scorer.md`

---

## 1. 目标与命名

在**不动**现有 F22 打分（`scoring.py`）与 finalRelevance（`relevance-scorer`/`apply_rerank`）的前提下，**并行**引入一套"相关性主导、多维、可解释、区分 unknown/negative"的评分，称为 **score**。

> **命名澄清**：新评分叫 **score**，写在 `extra.score`，**不叫 F22**。
> F22 = 旧 v1 质量分（`extra.relevance`），仅内部用于"选前 50 篇送 LLM 判分"，前端已不展示。

核心结构（v3 重构：**相关性主导、质量二级**）：

```
relevanceScore = 加权(semantic_relevance .35 + method_match .20)      ← 主导排序
qualityScore   = 加权(venue .15 + publication_status .10 + recency .10
                       + influence .05 + reproducibility .05)          ← 二级 + 卡片标注
finalScore     = 0.8 × relevanceScore + 0.2 × qualityScore
                 （无任何质量数据时 finalScore = relevanceScore）
```

设计理由：venue / 出版状态 / 影响因子是"论文质量"，不是"是否回答了我的问题"。把它们做成主导会让"高质量但不对题"的论文挤到前面，所以只占 20% 二级权重 + 卡片单独标注。

输出写入 session JSONL 的 **`extra.score`**（与 `relevance` / `finalRelevance` / `journalRank` 同路，免 IPC）。前端按 `finalScore` 排序、`ScoreBadge` 展示。

---

## 2. 运行链路（谁、何时、写什么）

两条路径都会产出 `extra.score`，**后者优先且不被前者覆盖**：

### 2.1 LLM `scorer` 子 Agent —— **默认判官**（精确 semantic + method）

- `lit-search` 默认 PLAN 路由 `searcher → scorer`（`manifest.json` 0.2.15 起，scorer = THE DEFAULT judge）。
- scorer 读本轮按 F22 排序的前 `min(N,50)` 篇，**只判两维**：`semantic` + `method`（0–100），对照规划层 brief 里的 **`research_question`（用户原问题）**，调 `apply_scoring` 一次写回。
- 服务端补齐 5 个确定性维 → null 重分配 → 组装 `extra.score`（`version: 3`）。
- `relevance-scorer`（旧 v1 链路）降级为**语义-only 回退**，默认不派发。

### 2.2 后台富化 `enrich_session_async` —— **基线兜底**（无 LLM）

- 检索结束触发后台任务（`spawn_session_enrich`），在 venue 回填 + EasyScholar 分区/IF 补全后，对本轮前 `_ENRICH_TOP_N=80` 篇算一份基线 score：
  - `semantic` = 回退信号（`finalRelevance ?? keywordRelevance ?? relevance ?? 50`）
  - `method` = **null**（该维权重重分配给 semantic）
- **关键约束（本会话修复）**：富化第 ④ 步若发现某篇**已被 scorer 写过**（`score.scores.method_match != null`），则**保留 scorer 的 semantic + method**，只用最新 venue/分区重算确定性维 —— 即 enrich 不会覆盖 scorer 的 LLM 判分。
- 七维评分始终运行，无关闭开关。

### 2.3 与 v1 的关系
F22（`extra.relevance`）+ finalRelevance（`extra.finalRelevance`）原样保留在后端，仅前端不再展示。score 不触碰任何 v1 字段。

---

## 3. 七个维度的数据来源与缺失处理

| 维度 | 组 | 来源 | 缺失 |
|---|---|---|---|
| `semantic_relevance` | 相关性 | scorer（LLM）；缺则回退 `finalRelevance ?? keywordRelevance ?? relevance ?? 50` | **必有**（有回退） |
| `method_match` | 相关性 | scorer（LLM） | **null**（权重并入 semantic） |
| `venue_quality` | 质量 | `map_venue_tier(extra.journalRank, venue)` × match_confidence | tier=unknown → **null** |
| `publication_status` | 质量 | `infer_publication_status(record)`（source/venue/doi 粗判） | 永不 null（最低 unknown=35） |
| `recency` | 质量 | `year` | 无整数 year → **null** |
| `paper_influence` | 质量 | `extra.citedBy` 年均引用 | 无 citedBy → **null** |
| `reproducibility` | 质量 | 标题/摘要/url 启发式 | 无信号 → **null** |

> **null ≠ 0**：缺数据的维不计入、权重按比例分给同组其它维（缺数据 ≠ 差，尤其新论文无引用）。

---

## 4. 评分细则（与代码逐条对齐）

### 4.0 端到端走查（一条论文怎么得到 finalScore）

```
① searcher/retrieve   → 候选写入 session JSONL，每条带 venue / year / citedBy / extra.relevance(F22)
② 后台 enrich         → 回填正刊 venue + EasyScholar 分区/IF(extra.journalRank)；
                          对前 80 篇先算一份"基线 score"(semantic=回退, method=null)
③ scorer 子 Agent     → 读按 F22 排序的前 min(N,50) 篇，对照原问题判 semantic + method，
   (默认判官, LLM)        一次 apply_scoring 写回
④ 服务端 score_record → 对每条被判过的 handle：
   (确定性 5 维 + 合成)   a. 取 scorer 的 semantic + method
                          b. 从 record 字段算 venue_quality / publication_status / recency
                             / paper_influence / reproducibility（见 4.2–4.5）
                          c. 组内 null 重分配 → relevanceScore、qualityScore（见 4.6）
                          d. finalScore = 0.8×relevanceScore + 0.2×qualityScore
                          e. 写 extra.score（version 3）
⑤ 再次 enrich 刷新     → 若该篇 method≠null(scorer 判过)，保留 semantic+method，
                          仅用最新分区/IF 重算确定性维（不覆盖 LLM 判分）
⑥ 前端                → 按 finalScore 排序，ScoreBadge 显示数字 + relevance/quality 拆分
```

要点：**相关性两维是 LLM 判的、质量五维是服务端从字段算的**；两组各自独立做 null 重分配，最后按 0.8 / 0.2 合成。scorer 缺席时（仅后台基线）semantic 走回退、method 记 null，此时 `relevanceScore = semantic`。

### 4.1 相关性两维（LLM，`scorer` 判）

**`semantic`（0–100）—— 对题度**：论文多直接回答 `research_question`（**用原问题判，不是 keyword 列表**）。
- 90–100 直接解决问题的具体目标 · 75–89 命中但范围/变体不同 · 60–74 部分相关 · 40–59 同领域但不对题 · 0–39 仅领域/关键词重叠
- **硬负约束**：领域/模态重叠不算相关。摘要未涉及问题的**具体目标**（如"拓展景深"→ EDOF / all-in-focus / 扩展焦深）则 **semantic ≤ 50**；泛化的 volumetric / 3D / reconstruction 成像若从不提景深目标，封顶 50。

**`method`（0–100）—— 方法是否冲着问题的具体目标**：
- 90–100 方法就是**为**该目标设计 · 75–89 该目标的近变体 · 55–74 相邻 · 0–54 不同目标/方法
- **硬负约束**：方法/目标是泛化 volumetric imaging / 3D reconstruction / light-field reconstruction、不明确瞄准问题具体目标的，**method ≤ 40**（即便同模态 + 用深度学习）。

### 4.2 venue_tier 映射（`map_venue_tier`，**取最强信号** `_stronger`）

多来源各出一个 tier，取最强；命中任一来源 `match_confidence` 抬到 0.9（顶刊白名单 0.95）。

| tier | 命中条件（满足其一） |
|---|---|
| **top** | 顶刊白名单 / 中科院1区 / (JCR=Q1 且 IF≥8) / CCF-A / CORE-A* |
| **strong** | 中科院2区 / JCR=Q1(IF<8) / (Q2 且 IF≥5) / CCF-B / CORE-A |
| **normal** | 中科院3区 / Q2(IF<5) / Q3 / CCF-C / CORE-B |
| **weak** | 中科院4区 / Q4 / CORE-C |
| **unknown** | 无任何信号 |

- 期刊指标来自 `extra.journalRank`（EasyScholar：`jcrPartition` / `impactFactor` / `casPartition`，中科院分区从串里抽 1–4 区）。
- 会议靠本地 `venue_ranking_local.json`（CCF/CORE 种子表），venue 名先经 `normalize_venue` 归一化为简称 key（全名片段表 + 括号缩写 + 已知简称 token 扫描）。

### 4.3 venue_quality 分数
```
tier_score:  top 95 / strong 80 / normal 65 / weak 45 / unknown → null
venue_quality = round(tier_score × max(match_confidence, 0.5), 1)
```

### 4.4 publication_status

`infer_publication_status` 由 venue/doi/source 粗判状态与置信度：

| 状态 | 触发 | 基础分 | confidence |
|---|---|---|---|
| `published_journal` | 有 venue 且非预印本 markers，无 conf/workshop 词 | 85 | 0.85 |
| `published_conference` | venue 含 proceedings/conference/symposium/congress/meeting | 85 | 0.82 |
| `published_workshop` | venue 含 workshop | 60 | 0.80 |
| `accepted_pending_publication` | （预留） | 70 | — |
| `preprint_with_doi` | 无正式 venue 但有 DOI | 55 | 0.70 |
| `preprint_only` | source=arxiv 或 venue 命中预印本 markers | 45 | 0.75 |
| `published_repository` | （预留） | 45 | — |
| `unknown` | 都不命中 | 35 | 0.40 |

预印本 markers：arxiv / ssrn / biorxiv / medrxiv / chemrxiv / preprint / research square / techrxiv / authorea。
```
publication_status = round(基础分 × (0.6 + 0.4 × confidence), 1)
```

### 4.5 recency / influence / reproducibility
- **recency**（按 `now_year - year`）：≤1→95 · ≤3→85 · ≤5→70 · ≤10→50 · 否则 30；无整数 year → null。
- **influence**（年均引用 = citedBy ÷ max(1, now−year+1)）：≥50→95 · ≥20→85 · ≥10→75 · ≥5→65 · ≥1→55 · 否则 40；无 citedBy → null。
- **reproducibility**：标题+摘要含 github / open source / (code 且 available|release)→75；否则有 url/pdf_url→50；都无→null。

### 4.6 三个分数的合成（null 重分配）
```
compute_final_score(scores, weights):
    avail  = {维: 分 | 分非 null}
    return Σ(分 × 权重) / Σ(avail 的权重)          # 缺维权重按比例分给同组其它维

relevanceScore = compute_final_score({semantic, method}, {.35, .20})
                 # method 缺 → 全给 semantic，即 relevanceScore = semantic
quality_dims   = {venue, pub, recency, influence, repro}
qualityScore   = None  若五维全 null
               = compute_final_score(quality_dims, {.15,.10,.10,.05,.05})  否则
finalScore     = relevanceScore                              若 qualityScore is None
               = 0.8 × relevanceScore + 0.2 × qualityScore   否则
```

### 4.7 data_confidence（仅展示 / 同分次级排序，**不乘进 finalScore**）
```
weights: title .10 / venue .30 / publication_status .30 / year .10 / authors .20
confs:   title 0.95(有) · venue max(match_conf,0.5)(有) · pub_status=pub.confidence
         · year 0.95(整数) · authors 0.9(非空)
data_confidence = Σ(conf × w) / Σ(可用 w)    # 缺项同样按比例重分配
```

### 4.8 等级（内部计算，**前端不展示 S/A/B/C/D**）
S ≥90 · A ≥80 · B ≥65 · C ≥50 · D <50。前端只显示 `finalScore` 数字 + 相关/质量分解，不显示字母。

---

## 5. 输出结构（`extra.score`，version 3）

```jsonc
{
  "version": 3,
  "scores": { "semantic_relevance": 95, "method_match": 90, "venue_quality": 76.0,
              "publication_status": 79.9, "recency": 95, "paper_influence": 65, "reproducibility": 75 },
  "relevanceScore": 93.2,            // 0.8 权重的主导项
  "qualityScore": 77.4,              // 0.2 权重 + 卡片标注；五维全缺则 null
  "finalScore": 90.0,                // 排序用
  "nullFields": [],                  // 被重分配的缺数据维
  "level": "S",                      // 内部，前端不展示
  "dataConfidence": 0.91,
  "venueTier": "top", "venueMatchConfidence": 0.9,
  "publicationStatus": "published_journal", "publicationStatusConfidence": 0.85,
  "venueType": "journal",
  "reason": "语义高度相关；方法匹配度高；venue top（JCR-Q1·IF8.x）；已正式发表（期刊）"
}
```

---

## 6. 与 F22 五维评分的对比

F22（v1，`scoring.py` → `extra.relevance`）是上一代评分：**纯确定性、质量导向、单一综合分**。score 是这次重构的：**LLM + 确定性混合、相关性主导、可解释多维分**。两者并存（F22 仍内部用于"选前 50 篇送 scorer"），但前端默认展示/排序已切到 score。

### 6.1 维度与权重对照

| | **F22 五维**（`extra.relevance`，0–100） | **score 七维**（`extra.score.finalScore`） |
|---|---|---|
| 相关性维 | `keyword_relevance` .20 | `semantic_relevance` .35 + `method_match` .20 → **relevanceScore** |
| 质量维 | `citations` .25 · `recency` .25 · `citation_velocity` .15 · `venue_presence` .15 | `venue_quality` .15 · `publication_status` .10 · `recency` .10 · `paper_influence` .05 · `reproducibility` .05 → **qualityScore** |
| 合成 | 五维加权和（null 重分配） | `finalScore = 0.8×relevanceScore + 0.2×qualityScore` |
| **相关性占比** | **0.20** | **0.80** |
| **引用+时效占比** | **0.65**（citations .25 + recency .25 + velocity .15） | **0.20**（全部质量维合计才 0.20，其中引用/时效只占一小部分） |

### 6.2 关键差异（为什么换）

| 维度 | F22 五维 | score 七维 |
|---|---|---|
| **相关性怎么判** | `keyword_relevance`：关键词逐 term 命中率投票（**纯字面/词频，无语义、无 LLM**）—— 同领域只要词撞上就给高分 | `semantic`+`method`：**LLM scorer 对照用户原问题语义判**，带硬负约束（同域/同模态 ≠ 相关；不瞄准问题具体目标则封顶） |
| **什么主导排序** | 引用 + 时效（0.65）—— **高引经典 / 高产期刊容易顶上来**，哪怕不太对题 | 相关性（0.80）—— **对题优先**，质量只做二级微调 |
| **venue 信号** | `venue_presence` 二值：有期刊名 0.5 / 无 null（**只看有没有，不看强弱**） | `venue_quality` 五档 tier（top/strong/normal/weak），由 CCF/CORE + JCR/中科院分区/IF 映射 |
| **出版状态** | 不区分（venue 有无一刀切） | `publication_status` 区分期刊/会议/workshop/预印本(有无 DOI)/未知，各给不同分 |
| **LLM 参与** | 无（纯确定性、可秒算） | 相关性两维由 LLM 判（需派发 scorer；缺席时退回字面回退值） |
| **输出** | 一个综合分 + `relevanceBreakdown` | `relevanceScore`/`qualityScore`/`finalScore` 三分拆 + 七维 + `reason` + `data_confidence` |
| **共同点** | — | null 维不计入、权重组内重分配（缺数据 ≠ 差）；分数都夹到 0–100 |

### 6.3 一个真实例子（同一篇，两套分）

候选 "**The Light Field Camera: Extended Depth of Field**"（经典全光相机论文，高被引，发表于强 venue，但**不是深度学习、不是显微镜**）：
- **F22 五维**：citations 高 + recency 尚可 + venue_presence 有 + keyword_relevance（"light field"/"depth of field" 字面全中）→ **综合分很高，排到最前**。
- **score 七维**：scorer 判 semantic=55 / method=35（领域对、但不是问题要的"深度学习 + 显微镜"，硬负约束封顶），venue_quality 虽 top 但只占 0.15 → **finalScore ≈ 51.7**，被相关性压下来。

这正是重构意图：**F22 会让"高质量但不对题"的论文靠引用/名气顶上来；score 让"是否回答了你的问题"主导排序。** 也因此，当检索池本身不对题时，score 会如实给出一片低分（而 F22 仍可能因高引/有 venue 给出虚高分）。

## 7. 关键原则（沿用母本）
unknown(null) ≠ negative(0)；出版事件与 venue 强度分开、不重复加分；模糊匹配留痕（`match_confidence`）；**相关性优先于影响因子 / 名气**（finalScore 0.8 给相关性）。

## 8. MVP 不做
原始响应留存层、多源 evidence 融合完整版、canonical 两遍迭代、机构主评分、撤稿检测（`published_repository`/`accepted_pending_publication` 仅预留枚举，暂无触发路径）。

## 9. ASCI 落地差异（详见母本附录 C）
- DBLP 未禁用，仅不进宽搜；会议 venue 定向确认可复用 DBLP XML 精确查（本期先用本地 CCF/CORE 表 + OpenAlex venue 名，DBLP 接入留作增强）。
- 无原始响应留存 → evidence 为轻量版（基于已归一化 record 字段）。

# ADR-010：文献评分从「F22 五维质量分」升级为「证据驱动相关性主导评分（score）」，与 F22 耦合并行

| 字段 | 内容 |
|------|------|
| **状态** | Accepted（2026-06-04，lee；score MVP 已落地，参数仍在迭代）|
| **决策日期** | 2026-06-04 |
| **拍板人** | lee |
| **决策时点硬约束** | lit-search 检索面板"相关度"排序/展示线路从 F22 切到 score 之前（已落地） |
| **关联 PR** | [#511](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/511) |
| **关联** | [实现规格 `docs/specs/lit-scoring-agent-spec.md`](../specs/lit-scoring-agent-spec.md) · `paper_search/service/paper_scoring.py` / `venue_tier.py` · F22 `paper_search/service/scoring.py` · `default-capability-packs/lit-search/sub-agents/scorer.md` · [CONTEXT.md](../../CONTEXT.md) · 设计母本《ASCI_文献评分排序Agent方案_修订版v3》（Obsidian，附录 C 为 ASCI 现状映射）|

---

## 一、背景

检索结果的默认排序一直由 **F22 五维评分**（`scoring.py` → `extra.relevance`）决定：`citations .25 + recency .25 + citation_velocity .15 + venue_presence .15 + keyword_relevance .20`，纯确定性、可秒算。

但 F22 是**质量导向**的：

- 相关性只占 `keyword_relevance` 一维（.20），且是**关键词逐 term 字面命中率**（无语义、无 LLM）——同领域只要词撞上就给高分；
- 引用 + 时效合计 .65 主导排序 → **高被引经典 / 高产期刊容易顶到最前，哪怕不对题**；
- `venue_presence` 只判"有没有期刊名"（二值 0.5/null），用不上已接入的 EasyScholar IF / JCR / 中科院分区。

真实例子：查"光场拓展显微镜景深的深度学习方法"，F22 把经典全光相机论文 *The Light Field Camera: Extended Depth of Field*（高被引、强 venue、关键词字面全中、但非深度学习、非显微镜）排到最前。用户要的是"能回答我问题的论文"，F22 给的是"高质量的论文"。

本会话已先行落地的基础设施（venue 全源对齐、`extra.journalRank` 的 EasyScholar IF/分区、正刊反查）让"证据驱动 + 语义判别"的评分具备数据条件。

## 二、决策维度

1. **替换还是并行**：新评分取代 F22，还是与 F22 并行共存？
2. **相关性怎么判**：关键词字面命中（F22 现状）还是 LLM 对照用户原问题做语义判别？
3. **质量信号定位**：venue/IF/分区/影响力主导排序，还是降为二级 + 卡片标注？
4. **未经 LLM 判分时**：相关性维缺失的论文，如何取值？

## 三、候选方案

| | A. 维持 F22 | B. score 并行 + **解耦** | C. score 并行 + **耦合 F22**（**选中**）|
|---|---|---|---|
| 相关性判别 | 关键词字面命中率 | LLM 判 semantic+method（对照原问题 + 硬负约束） | 同 B |
| 质量定位 | 引用+时效主导（.65） | 质量降为二级（finalScore 0.8 给相关性） | 同 B |
| 未经 scorer 判分 | —（无此概念） | `null` = **未评分**，不借 F22，排最后 | **回退 F22**（`finalRelevance ?? keywordRelevance ?? relevance`），保证每篇都有分 |
| 体验 | 秒出、但不对题 | 大量"未评分"论文需 LLM 判完才有序 | 后台基线先用 F22 兜底出序，scorer 判完再精修 |
| 两套是否互相借分 | — | 完全隔离 | score 的 semantic 可回退 F22 信号 |

> **B 曾被原型实现并随即回退（2026-06-04，lee）**：解耦后未经 scorer 判分的论文（top-50 之外、判分前）一律记"未评分"沉底，候选展示出现大面积空档、体验割裂；权衡后认为"耦合兜底"更实用——宁可用 F22 弱信号占位，也不要把"还没判"暴露成"无分"。

## 四、决策

**采用 C：引入证据驱动评分 score，相关性主导、与 F22 耦合并行；F22 原样保留。**

- **结构（相关性主导、质量二级）**：
  - `relevanceScore = 加权(semantic .35 + method .20)`，由 LLM `scorer` 子 Agent 对照用户 `research_question` 判（含硬负约束："同领域/同模态 ≠ 相关"，不瞄准问题具体目标的封顶低分）；
  - `qualityScore = 加权(venue_quality .15 + publication_status .10 + recency .10 + paper_influence .05 + reproducibility .05)`，服务端从 record 字段（含 `extra.journalRank`）确定性计算；
  - `finalScore = 0.8 × relevanceScore + 0.2 × qualityScore`（相关性 80% 主导，质量仅二级微调 + 卡片标注）。
- **null 权重重分配**：缺数据维不计入、权重按比例分给同组其它维（`unknown(null) ≠ negative(0)`）。
- **与 F22 耦合**：`semantic` 缺失（scorer 未判该篇）时回退 `finalRelevance ?? keywordRelevance ?? relevance ?? 50`；F22 仍内部用于"按相关度排序、选前 50 篇送 scorer"。
- **运行链路**：默认 PLAN `searcher → scorer`（scorer = 默认判官）；检索后 `enrich_session_async` 后台 fire-and-forget 补 venue/分区/IF 并算基线 score，面板 5s 轮询刷新。结果写 session JSONL 的 **`extra.score`**（version 3），不动任何 v1 字段。
- 不建新 SQLite 表、不建 raw/evidence/canonical 层（母本附录 C MVP 取舍）。

## 五、反转 / 影响

- 检索面板默认"相关度"排序与卡片展示从 **F22（`extra.relevance`）切到 `score.finalScore`**；F22 与 v1 `finalRelevance` 后端原样保留，仅前端不再展示（`RelevanceBadge` 退场、保留文件）。
- 评分等级 S/A/B/C/D 仍内部计算，**前端只显示 `finalScore` 数字**，不显示字母。

## 六、后果

- **正向**：对题优先（相关性 0.8 主导）；可解释（`reason` + 七维分解 + `data_confidence`）；IF/JCR/中科院分区正式进入打分（venue_tier 五档）；与 F22 解耦风险低（耦合兜底，旧线路随时可回退）。
- **负向 / 代价**：
  - **慢**——多一整轮 LLM 判分（scorer 读前 50 篇逐篇判，约 10–30s）；IF/分区/分数靠后台富化 + 5s 轮询"挤牙膏"地出现（EasyScholar 并发 3、超时 6s、免费 key 易被 403/429 限流后退避重试）。
  - score 质量**受检索召回质量制约**：候选池不对题时，scorer 如实给一片低分——这是暴露上游检索问题（如领域锚跑偏导致跨域噪声），**非评分 bug**。
- **风险**：LLM 判分的稳定性与成本；EasyScholar 限流导致富化拖长。
- **后续动作 / 待定**：
  - scorer 是否默认派发 / 是否后台化（性能 vs 即时精排）；判分窗口大小（现 top-50）；
  - EasyScholar 付费 / 高配额 key 以消除限流退避；
  - 上游检索锚点修复（`object_terms` 只放研究对象、anchor 取最具体词），从源头减少跨域噪声；
  - 解耦方案 B 保留为未来选项（若"未评分"体验问题被前端解法消化）。
- **关联开关**：`PAPER_SEARCH_MCP_DISABLE_EASYSCHOLAR`（关 IF/分区）· `PAPER_SEARCH_MCP_EASYSCHOLAR_CONCURRENCY`（富化并发）· `PAPER_SEARCH_MCP_ENRICH_TOP_N`（富化篇数）。七维评分始终运行，无关闭开关。

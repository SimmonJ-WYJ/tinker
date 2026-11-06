# ADR-013：文献检索数据服务 ——「部分自建分层」（元数据自建 + OA 全文复用 + 软件差异化）

| 字段 | 内容 |
|------|------|
| **状态** | Proposed（grill-with-docs + 2 轮 deep-research 裁决 2026-06-02，待产研 Lead 签字）|
| **决策日期** | 2026-06-02 |
| **拍板人** | （待填，建议产研 Lead）|
| **作者** | （待填）|
| **决策时点硬约束** | 0.5 文献数据服务实现 issue 开出前；**本 ADR 扩展 [ADR-002](./ADR-002-server-stack.md) 服务端栈（新增检索 workload），ADR-002 须同步更新** |
| **关联** | [0.5 north-star](../milestones/0.5/north-star.md) · [ADR-001 本地优先](./ADR-001-local-storage.md) · [ADR-002 服务端栈](./ADR-002-server-stack.md)（需扩展）· [0.3 数据三分红线](../specs/0.3.0/0.3.0-prd.md) · [0.2 moat-analysis](../milestones/0.2/moat-analysis.md) · [CONTEXT.md 文献检索数据服务领域](../../CONTEXT.md) · 两轮 deep-research（task `ww7kiwqdq` / `wznt3zt3n`，2026-06-02）|

---

## 一、背景

**现状**：ASCI 文献检索 = 一个跑在用户机器上的本地 MCP（`paper-search-mcp`），对 15+ 外部开放 API（OpenAlex/Crossref/Semantic Scholar/arXiv/PubMed…）**实时扇出（fan-out）**，**无自建索引 / 无缓存**。实测主力源会整源失败、同类查询返回数在 0↔45 间剧烈跳变、备用源慢且质量差（已默认关，见 `lit-search-failure-source-expansion-spec.md`）。

**三个真实痛点**（产研复盘提出）：① 检索**不全**（覆盖缺失，专业研究员搜不到要的）；② 检索**不准**（相关性差）；③ PDF **精读慢**（每篇现抓 → 解析 → RAG，分钟级）。

**触发**：产研提出"规划自建文献库 / 往数据资产投入，否则是 AI 时代皮包公司"。grill-with-docs 会话把它收敛为方向假设，2 轮 deep-research（共 212 agent、48 源、对抗式验证）用外部证据验证。

**为何须 ADR**：这是 ASCI 从「纯本地优先（ADR-001）+ 服务端仅认证/遥测（ADR-002）」向「**本地优先 + 服务端文献数据服务**」的扩展——hard-to-reverse、未来读者会问"为什么从本地优先转向服务端语料"、且是多候选真实权衡的结果。三条全中，落 ADR。

## 二、决策维度

1. **自建到哪一层**：仅元数据 / +全文 / +全量语义向量？
2. **检索/重排算力跑哪**：ASCI 服务端（ASCI 付费）vs 用户 BYOK key（用户付费）？
3. **变现**：是否必须引入 freemium？

## 三、候选方案

| | A 纯 fan-out（现状）| B 重资产全自建 | C 部分自建分层（**选中**）|
|---|---|---|---|
| 元数据 | 实时打 API | 全量自托管 index | ✅ 全量自托管 index（OpenAlex）|
| 全文 | 现抓现解析 | 全量自托管 | ✅ 仅缓存**可合法再分发的 OA 子集**，其余按需现抓+外链 |
| 语义向量 | 无 | 全量 embedding（2 亿+）| ❌ 不做全量（不划算）|
| 检索/重排算力 | 用户 BYOK | 全 server-side（ASCI 付费）| ✅ 默认跑用户 BYOK（ASCI 零每查询推理成本）|
| 变现 | — | freemium **被成本逼成必须** | freemium **可选**（信誉修复须在免费层）|
| 三痛点 | ❌ 全不治 | ✅ 治但代价失控 | ✅ 治且成本/合规可控 |
| 4 人团队可行性 | — | ❌ 全量向量+全 server-side 养不起 | ✅ 元数据门槛低、全文复用、算力借 BYOK |

**B 为何被否（grill 中途结论，被证据推翻）**：① 全量向量 embedding 2 亿+ 文档 RAM-bound、新鲜度管道，对 4 人不划算；② 全量原始全文**多数不可合法再分发**（见决策的许可红线）；③「全 server-side 算力」反转了 ASCI 的 BYOK 零推理成本模型，把每次搜索变成 ASCI 的账单，从而**被成本逼出 freemium**，又有把"信誉修复"关进付费墙、用户在转化前就 bounce 的陷阱。

## 四、决策

**采用 C：部分自建分层。**

```
自建/自托管（ASCI 服务端 · 成本有界 · 合规清晰）
  · OpenAlex 元数据全量 index（覆盖长尾；免费快照季度更新）
  · 可合法再分发的预处理全文语料（精读"秒开"的底子）
复用（不自研）
  · 科学 PDF 解析：MinerU / olmOCR（SOTA、开源；olmOCR ~$176/百万页）
按需现抓 + 外链（不缓存再分发，守许可红线）
  · arXiv（逐篇 fetch + 回链）、非 OA、CC-NC / CC-ND 论文
差异化软件层（跑用户 BYOK · ASCI 零每查询推理成本）  ← 真护城河
  · agentic 迭代检索 + 混合(BM25⊕dense)召回 + LLM 重排 + 全文 RAG 精读
不做：全量语义向量 embedding
变现：freemium 为可选商业决策（信誉修复天然在免费层），非成本逼出来的必须项
```

### 许可红线（一手原文，落地硬约束）

| 源 | 能否缓存+落库+**再分发**（商业）| 用法 |
|---|---|---|
| peS2o / S2ORC 散装（ODC-By）| ✅ 可（须署名）| 预处理全文语料核心（~824 万全文）|
| PMC `oa_comm`（CC0/CC-BY）| ✅ 可（**仅 XML/纯文本，非 PDF**；须滤 ND/SA）| 生物医学全文；走官方 bulk 通道（FTP 2026-08 退役转 Cloud Service，届时复查）|
| Semantic Scholar **API 实时数据** | ❌ 契约禁再分发 | 即时用不落库；要落库改走其 ODC-By 散装 |
| arXiv 全文 | ❌ 默认许可禁第三方再分发 | **逐篇 fetch + 回链 arXiv，不可缓存成语料**（CS/物理/ML 重点注意）|
| 非 OA / CC-NC / CC-ND | ❌ | 按需现抓 + 外链，不落库 |

> ⚠️ **逐篇上游版权风险**：ODC-By/桶级"可商业"是数据库/汇编层许可，**不等于每篇全文都无 per-work（含 NC/ND）限制**；商业全文 RAG（chunk/re-embed/生成衍生）须**保留并尊重逐篇 license 元数据**，落地前需法务确认（含 Europe PMC 作为欧盟节点 PDF 源的边界）。

### GDPR（可控，有现成模板）

论文元数据含作者姓名/邮箱 = 个人数据（公开不豁免）；但 **EU DSM 指令 Art.4 TDM 例外对商业主体开放**（除非权利人机读 opt-out）。EDPB Opinion 28/2024 落地清单：尊重 robots.txt/ai.txt、排除敏感源、控制器维护 opt-out 名单、作者邮箱假名化。**关键区分**：TDM 例外管"能不能挖"，**不管**"能不能再分发"（后者仍归各语料许可）。

## 五、反转与印证

- **反转** grill 中途结论：grill 一度推到「相关性层不碰任何语料 + 全文走 fan-out + 全 server-side 算力 + freemium 必须」。证据修正为：元数据**该自建**（门槛低）、全文**该缓存可合法再分发的 OA 子集**（纯 fan-out 正是"精读慢"病根）、全量向量**不做**、算力**回 BYOK**、freemium**可选**。
- **印证** [0.2 moat-analysis](../milestones/0.2/moat-analysis.md)：可防御护城河 = **工作流嵌入 + 数据飞轮 + 软件质量**，**非囤原始论文**（OpenAlex 谁都能下）。Elicit（头部、融资充足）实证同路——用聚合器 API（~1.38 亿去重）、不自建全文语料、只 OA 或用户自带订阅取全文。"4 人团队复用聚合器 + 软件差异化"是被头部验证过的可行路径。

## 六、后果

- **扩展 ADR-002**：服务端从"仅认证 + 遥测"新增检索 workload（元数据 index + OA 全文缓存）。ADR-002 须同步决策 index 引擎（ES/OpenSearch/Typesense）、存储、新鲜度管道（OpenAlex 免费快照季度更新；月度/每日变更需付费）。
- **保 BYOK / 本地优先身份**：检索/重排默认跑用户 key，ASCI 服务端成本有界（只托管 index/语料，无每查询推理费）。
- **0.6 查询飞轮 + 隐私红线**：查询/点击/采纳信号驱动相关性复利 = 0.6 opt-in；与 0.3"行为遥测绝不含研究内容"红线相撞（查询词=潜在研究内容），需重定义红线 + opt-in + 披露，0.5 不碰。
- **两块前置 spike（落地前补，公开查不到，非方向 blocker）**：① 三档真实月成本 / 工程人月（内部 infra spike）；② agentic 端到端检索/重排增益的硬评测（自建小评测集量化"扛专业质疑"——目前仅有重排层单点证据：CoRank 在 5 个学术检索集 nDCG@10 50.6→55.5）。
- **工程约束**：arXiv 不可缓存须逐篇 fetch+回链；PMC 须走官方 bulk 通道、商业仅用 XML/纯文本、逐篇按 license。
- **风险**：① 逐篇上游版权（须法务）；② OpenAlex 实时规模已达 4.7 亿+（2026-02 Walden 重写），存储/索引成本须按当前规模上调，非快照标注的 330GB/1.6TB；③ 范围叠加（0.5 紧跟 0.4 超大版本，4 人团队）。

## 七、后续动作

- [ ] 产研 Lead 签字（Proposed → Accepted）
- [ ] 同步修订 ADR-002（新增检索 workload 的栈/成本/新鲜度决策）
- [ ] 阶段1 两块 spike：成本钱账 + agentic 检索评测集
- [ ] 法务确认逐篇上游 license 过滤策略 + Europe PMC PDF 源边界
- [ ] 0.5 north-star → to-issues 按支柱拆 tracer-bullet 垂直切片

# 0.2 北极星目标（Beta：科研对象底座）

**定位**：定义科研对象模型与读写协议，用 ASCI 自有上层应用验证底座能力。
**截止日期**：2026-06-05（0.1 交付后立即启动，约 3 周）
**发布形态**：内部 dogfood / 小范围内测，不公开发布
**审计原则**：每条目标必须可被"是/否"或具体数值验证，不依赖主观判断；每条审计标准必须标注优先级。
**单一权威源**：本文档是 0.2 milestone 的唯一权威定义。GitHub milestone description 仅做精简引导（≤200 字 + 链向本文档），不复制内容；任何 scope 调整以本文档为准。

> **Scope 总原则**：0.2 全部为 0.3 公开发布的硬前置（对象底座、Agent 拓展性、能力包契约），整体不接受降级；所有审计标准默认「必做」。降级集中在 0.3.0（见 0.3 §十）。

| 标签 | 含义 |
|------|------|
| 必做 | 0.2 交付前必须通过 |
| 观察 | 跟踪指标，不阻塞交付 |
| 可降级 | 极端情况下可推 0.3 |

> **修订记录**：2026-05-14 增补 §零「ASCI Agent 主导原则」总则、§一-A「Proposal 对象模型与触发路径」、§一-B「典型科研旅程」、§三 多处 Agent 触发式审计项与 Proposal 链路。

---

<a id="section-zero"></a>

## 零、ASCI Agent 主导原则（总则）

ASCI 的产品哲学是 **"Agent 主导，用户决策"**：能用 Agent 解决的 **观察 / 归纳 / 标注 / 整理** 工作，全部由 Agent 完成；用户只承担 **下达目标、审查判断、最终决策**。这条原则是后续所有审计标准的滤镜——任何"用户主动手工 X"的设计，都必须先问一遍 *"Agent 能不能先提议、用户只决策？"*

### 落地姿态（按当前阶段优先级）

| 姿态 | Agent 干什么 | 用户干什么 | 当前阶段优先级 |
|------|------------|----------|---------------|
| **C. 触发式（首选）** | 对象状态变化时 Agent 自动评估并产出判断卡片（Proposal） | 决策（采纳 / 修改 / 拒绝） | ✅ 0.2 / 0.3 主路径 |
| **B. 后台批处理** | Agent 周期性扫工作区，产出待审清单 | 一次性 review 队列 | 0.4+ 评估 |
| **A. 实时建议** | 用户操作时浮现旁注 | 接受 / 修改 / 拒绝 | 0.4+ 评估 |

### 兜底通道

用户保留 **主动建立关系 / 主动归类 / 主动登记假设** 等手动入口作为 **兜底**，但**不能与 Agent 提议主路径并列展示**——兜底入口位置：对象详情页"⋯"菜单或"待审提议"区底部"+ 我自己加一条"链接，禁止占主操作区一级按钮位置。

### 区分原则

| 行为类型 | 性质 | 由谁主导 |
|---------|-----|---------|
| 写"这段方法可借鉴到我的项目" | 思考创造 | ✅ 用户主导 |
| 标"A 反驳 B" | 关系观察 | ❌ Agent 主导（用户决策） |
| 写"我假设 X 比 Y 好" | 断言登记 | ⚠️ 用户可写，Agent 应主动识别并提议归类 |

**原则**：Agent 替代 **有标准答案** 的工作（观察、归纳、标注、整理）；用户保留 **没有标准答案** 的工作（判断、创造、决策、记录直觉）。

### 灰度回退条件

§零 是产品哲学，但用户接受度需在 §三-4 X1 访谈中验证。**回退判据**：

| 触发条件 | 处置 |
|---------|------|
| X1 访谈 ≥ 50% 用户表达"不希望 Agent 主动产出提议" | §零 主路径降级为姿态 A（实时建议，用户操作时浮现旁注）或姿态 B（后台批处理，攒清单再 review），由 0.2 末复盘评估具体降档 |
| X1 访谈 < 50% 但 ≥ 20% 抵触 | 保留 C 姿态作为主路径，但在产品内增加 Settings 开关"Agent 主动提议默认关闭"以服务抵触用户 |
| X1 访谈 < 20% 抵触 | 维持 §零 现状，C 姿态作为唯一主路径 |

> **灰度回退不等于推翻 §一-A Proposal 对象模型**：Proposal 状态机与 dismissPolicy 在任一姿态下都成立，回退仅影响"触发时机"（被动 vs 主动）而非"载体形态"。

---

<a id="section-1"></a>

## 一、科研对象模型（5 核心对象 + 1 交互对象）

核心原则：**每个对象有唯一 ID、可被引用、可被追加、不依赖特定 UI**。

| 对象 | 类别 | 说明 | 关联关系 |
|------|------|------|---------|
| Paper | 核心 | 继承 0.1 的论文实体 | 被 EvidenceRef、Note 引用 |
| EvidenceRef | 核心 | 一条"结论→论文段落"的绑定 | source: Paper.paragraph；target: Review.sentence |
| Note | 核心 | 附着在任意对象上的批注，**通过 `kind` 区分语义类型**；`kind: "hypothesis"` 时额外启用 `hypothesisStatus` 字段记录生命周期 | target: Paper / EvidenceSet；`kind: "note" \| "hypothesis"`（默认 `"note"`；`"hypothesis"` **主路径由 Agent 触发式识别断言后产出 Proposal，用户决策后登记**，用户主动设置 kind 作为兜底）；`hypothesisStatus: "unknown" \| "supported" \| "contradicted" \| "suspended"`（默认 `"unknown"`；由 V6d Agent 判断采纳后自动更新，详见 [§三-2 V6d](#section-3-2)）|
| EvidenceSet | 核心 | 被命名的论文+证据集合；**主路径由 Agent 在综述完 / 检索完 / 新论文入库时触发式产出 Proposal**，用户决策；用户手动新建作为兜底 | contains: Paper[] + EvidenceRef[] |
| CitationRelation | 核心 | 论文间逻辑关系；**主路径由 Agent 在综述生成 / 检索结果入库时触发式产出 Proposal 候选**，用户在判断卡片决策；用户手动建作为兜底 | type: supports/contradicts/method-ref；from: Paper；to: Paper |
| **Proposal** | **交互** | **Agent 主动产出的候选项，承载"提议 → 用户决策"流程的状态机**；详细字段与触发路径见 [§一-A](#一-aproposal-对象模型与触发路径) | kind: `citation-relation` / `evidence-set` / `hypothesis-promote` / `hypothesis-review`；status: pending / accepted / rejected / modified |

> **关于 Hypothesis**：研究假设作为 Note 的一种类型（`kind: "hypothesis"`）存在，不再独立建模。理由：dogfood 阶段"显式声明假设"是低频动作，而"在论文/证据集上写一段断言"是高频动作——两者形态本就高度重合。等真实用户反馈出现强需求时再分化为独立对象。

> **关于 Proposal**：Proposal 是承载 §零「Agent 主导，用户决策」哲学的交互对象，**不是核心研究产物**——所有 Agent 主动提议（关系候选 / 证据集候选 / 假设登记建议 / V6d 评估结论）都先落 Proposal，由用户决策后才转化为正式的 CitationRelation / EvidenceSet / Note。Proposal 同时承载用户决策行为的埋点信号（在 0.3 §三-A 兑现，作为 Agent 进化的关键输入）。

---

<a id="section-1a"></a>

## 一-A、Proposal 对象模型与触发路径

### Proposal 字段

| 字段 | 说明 |
|------|------|
| id | 唯一 ID |
| kind | `citation-relation` / `evidence-set` / `hypothesis-promote` / `hypothesis-review` |
| sourceCapability | 提出该 Proposal 的能力包标识（用于来源溯源与采纳率统计） |
| payload | 候选内容（关系三元组 / 论文 ID 列表 / 假设建议 / V6d 评估结论） |
| reasoning | Agent 给出的理由（文本），作为用户决策依据 |
| status | `pending` / `accepted` / `rejected` / `modified` |
| createdAt / decidedAt | 时间戳 |
| targetObjectRef | Proposal 落地的对象引用（Paper / EvidenceSet / Note 的 ID），用于 `scoped` 静默粒度判断 |
| dismissPolicy | 用户拒绝后的策略，三档：<br>• `once`（仅本条不再提示）<br>• `scoped`（在 `targetObjectRef` 范围内，该 sourceCapability 同 kind 的同类提议不再产出；其他对象上仍可产出）<br>• `silence-this-kind`（该 sourceCapability 同 kind 的同类提议在全工作区永久不再产出）|

### 触发式产出点（C 姿态落地，0.2 必做）

| 触发事件 | 由谁产出 | Proposal kind | 对应审计项 |
|---------|---------|---------------|-----------|
| 综述生成完成 | 文献综述包 | `citation-relation` | V2b |
| 综述生成完成 | 文献综述包 | `hypothesis-promote` | V6c' |
| 检索结果入库 | 文献检索包 | `evidence-set`（候选追加到已有 EvidenceSet） | V2b 同管线 |
| 检索结果入库 | 文献检索包 | `citation-relation`（新入库论文之间的关系候选） | V2b |
| EvidenceSet 新增 Paper | 文献综述包 | `hypothesis-review`（对挂载 hypothesis 的 supports / contradicts / neutral 判断 + 理由） | V6d |
| 用户写 Note 触发断言识别 | 文献综述包 | `hypothesis-promote` | V6c' |

> 0.2 阶段只实现 **触发式（C 姿态）**；后台批处理（B）与实时建议（A）由 0.4+ 再评估。

### UI 位置约定

- **主入口**：Paper / EvidenceSet / hypothesis Note 详情页内联 **"待审提议"区**，紧贴对应对象，避免独立"提议中心"导致上下文丢失
- **兜底入口**：详情页"⋯"菜单或"待审提议"区底部 **"+ 我自己加一条"** 链接，不可在主操作区占一级按钮
- **决策动作**：每张 Proposal 卡片提供 `采纳` / `修改` / `拒绝` / `仅本对象不再提示（scoped）` / `不再提示这类（silence-this-kind）` 五个动作；其中 `拒绝` 默认为 `once`（仅本条），用户可在卡片下拉选择升级为 `scoped` 或 `silence-this-kind`；采纳后 Proposal 转为正式 CitationRelation / EvidenceSet / Note，原 Proposal 保留 `status: accepted` 供回溯
- **理由展示**：每条 Proposal 必须展示 `reasoning` 字段，让用户决策有依据，禁止"裸候选"无理由形态
- **埋点上报**：所有决策动作走 0.3 §三-A 自进化埋点的"用户反馈"通道（按 sourceCapability × kind 分组统计采纳率），与产品行为埋点物理隔离

---

## 一-B、典型科研旅程（PhD 王老师做 RAG 综述）

> **为什么写这段**：5 大对象 + Proposal 状态机 + 4 条工作主线如果只看模型表，读者很难判断"对科研用户是否真的有效"。本节用一个完整故事把模型串起来，让 §一 / §一-A / §三 的所有审计项可被一眼定位到用户实际动作。**故事场景与 0.3 §三-C.1 文献综述包首发场景对齐**，确保 0.2 验证范式与 0.3 落地范式同源。

**主角**：王老师，CS PhD 三年级，正在做 RAG（Retrieval-Augmented Generation）方向的文献综述，目标产出一篇 survey。

**Day 1 — 建工作区，定方向**

1. 王老师在 ASCI 新建工作区 `rag-survey-2026`，写下意图："系统梳理 2023-2026 年 RAG 相关工作，重点比较 RAG 与长上下文模型的优劣"
2. 启动 **文献检索包**（[0.3 §三-C.1](../0.3/north-star.md#三-c-1-首发场景能力包-2-个)），输入关键词 `RAG long-context survey`
3. Agent 跑 arXiv / Semantic Scholar / OpenReview 三路检索，回 30 篇候选；用户在检索结果列表勾选 12 篇入库 → 生成 12 个 **Paper** 对象（[§一 对象 1](#section-1)）
4. 检索结果入库触发 **文献检索包**：
   - 产出 `evidence-set` Proposal 候选（[§一-A 触发点表](#section-1a)）—— 但当前工作区还没有任何 EvidenceSet，Proposal 暂不产生
   - 产出 `citation-relation` Proposal（[§三-1 V2b](#section-3-1)）—— 在 12 篇 Paper 详情页"待审提议"区可见 8 条引用关系候选（如 "Paper-RAG-Survey-2024 method-ref Paper-FiD-2020"）

**Day 2 — 读论文，写假设**

5. 王老师打开 Paper-RAG-Survey-2024 详情页，看到 3 条 `citation-relation` Proposal 卡片，每条含 reasoning 文本
6. 决策：2 条采纳（→ 正式 **CitationRelation** 对象，[§一 对象 5](#section-1)）、1 条拒绝（选 `scoped`，[§一-A dismissPolicy](#section-1a)）—— 这意味着同一 sourceCapability 同 kind 不会再向该 Paper 推同类提议，但其他 Paper 仍可
7. 王老师在 Paper-RAG-Survey-2024 旁边写一条 **Note**（[§一 对象 3](#section-1)）："我假设 RAG 在 1M token 以上场景仍优于长上下文，因为 retrieval 的精确度不随上下文长度线性退化"
8. **文献综述包** 触发断言识别（[§三-2 V6c'](#section-3-2)）—— 该 Note 详情页"待审提议"区出现 `hypothesis-promote` Proposal，reasoning 写"识别到断言结构 'X 优于 Y 因为 Z'"
9. 王老师采纳 → Note 的 `kind` 翻为 `hypothesis`，`hypothesisStatus` 初始化为 `unknown`（[§一 Note 字段](#section-1)）

**Day 3 — 组织证据，跑综述**

10. 王老师把已读的 12 篇 Paper 中关于"RAG vs 长上下文"的 5 篇手动归到一个新建的 **EvidenceSet** "RAG-vs-LongContext"（[§一 对象 4](#section-1)，兜底通道——主路径将在 V2b 综述触发后由 Agent 自动建议）
11. 把"RAG 在 1M token 以上仍优"这条 hypothesis Note 挂载到该 EvidenceSet
12. 启动 **文献综述包** 生成综述段落，产出 Review HTML（含可点击引用标记，继承 0.1）；综述生成过程中拆解为多条 **EvidenceRef** 对象（[§一 对象 2](#section-1)），每条绑定"综述句子 → Paper 段落"

**Day 4 — Agent 评估假设**

13. 综述生成完成触发 **文献综述包**：
    - 产出 `citation-relation` Proposal（综述段落间识别的新关系候选）
    - 产出 `hypothesis-promote` Proposal（综述中识别的其他可证伪断言候选）
14. 王老师后续又从 arXiv 检索到 3 篇新论文加入 EvidenceSet "RAG-vs-LongContext"，**EvidenceSet 新增 Paper 触发** `hypothesis-review` Proposal（[§三-2 V6d](#section-3-2)）：
    - 对挂载的 hypothesis "RAG 在 1M token 以上仍优" 评估 3 篇新论文倾向
    - reasoning："Paper-A 实验显示 RAG 在 2M token 检索精度下降至 73%，倾向 contradicts；Paper-B 在 1.5M token 仍保持 91%，倾向 supports；Paper-C 未直接测试该范围，neutral"
    - 推荐操作：建议把 hypothesisStatus 从 `unknown` 改为 `suspended`（"证据双向，需更多数据"）
15. 王老师查看 reasoning 后**采纳** Agent 建议 → Note 的 `hypothesisStatus` 自动从 `unknown` 更新为 `suspended`（[§一 Note 字段](#section-1) + V6d Agent 判断回写）

**Day 5 — 沉淀**

16. 王老师打开侧边栏笔记面板（[§三-2 V6a/V6b](#section-3-2)），按 `kind: hypothesis` 过滤，看到自己积累的 5 条 hypothesis Note，每条都有 `hypothesisStatus`：1 条 supported、1 条 contradicted、3 条 suspended
17. 这条数据成为综述 Discussion 章节的核心论据来源 —— 用户带走的不是 12 篇散乱 PDF，而是一个**结构化对象库**：12 Paper + 38 EvidenceRef + 17 CitationRelation + 23 Note（含 5 hypothesis Note + hypothesisStatus）+ 3 EvidenceSet

### 故事覆盖的审计项

| 步骤 | 触及对象 / Proposal | 对应审计项 |
|------|---------------------|-----------|
| 1-3 | Paper 入库 | 继承 0.1 |
| 4 | `citation-relation` Proposal 产出 | [V2b](#section-3-1) |
| 5-6 | Proposal 决策 + scoped dismiss | [V2b](#section-3-1) + [V6f](#section-3-2) |
| 7-9 | Note + `hypothesis-promote` Proposal | [V6](#section-3-2) + [V6c'](#section-3-2) |
| 10-11 | EvidenceSet 手动新建（兜底） | [§一 EvidenceSet](#section-1) |
| 12 | EvidenceRef 拆解 | [V1](#section-3-1) |
| 13 | 综述触发多类 Proposal | [V2b](#section-3-1) + [V6c'](#section-3-2) |
| 14-15 | `hypothesis-review` Proposal + hypothesisStatus 回写 | [V6d](#section-3-2) |
| 16-17 | 笔记面板 + kind 过滤 + 查询性能 | [V6a/V6b/V6e](#section-3-2) |

### 故事不覆盖的（仍需独立验证）

- 删除 Paper 后 EvidenceRef 标记"源已移除"（[V3](#section-3-1)）
- 100+ Note 时按 Paper 反查关联 Note 的响应时间（[V6e](#section-3-2)，需性能压测，非旅程能体现）
- Agent 拓展性 A0/A1/A2/A3 与能力包概念 X1-X4（架构与概念层验证，非用户故事）

---

## 二、读写协议（三条铁律）

| # | 协议 | 审计方式 |
|---|------|---------|
| P1 | **追加不覆盖**：新证据追加到已有对象，不删除旧数据 | 同一 Paper 下多次写入，旧条目保留可查 |
| P2 | **引用不复制**：对象间通过 ID 关联，不复制内容 | 删除源对象时，引用处标记为"源已移除"而非空值 |
| P3 | **查询不遍历**：通过关系索引查询，不遍历全量 | 查"Paper X 关联的所有 Note"不需要遍历全部 Note |

协议落地形式（JSON Schema / TypeScript interface / 其他）由技术方案决定。

### 设计约束：面向外部 API 的扩展性

对象模型在 0.2 为本地设计，但必须预留未来作为 MCP/A2A 服务对外暴露的能力：

| # | 约束 | 说明 | 优先级 |
|---|------|------|--------|
| D1 | **对象有稳定的序列化格式** | 每个对象类型的 JSON Schema 独立定义，不耦合 UI 层或存储层 | 必做 |
| D2 | **关系通过 ID 引用，不嵌套对象** | 与 P2 一致，确保 API 响应可控（不会一次查询拉出整个对象图） | 必做 |
| D3 | **查询接口参数化** | 按对象类型、关联关系、时间范围等维度查询，不硬编码查询逻辑 | 必做 |

这些约束在 0.2 不产生额外工作量——P2 和 P3 已经要求 ID 引用和索引查询。关键是在实现时意识到这些接口未来会被外部调用，避免写出只能在组件内部调用的查询逻辑。

<a id="section-open-standard"></a>

### 对象标准开放（护城河 P0）

> 战略来源：[moat-analysis.md](./moat-analysis.md) §4.3 🥇 P0 —— 把 ASCI 对象格式设计为开放标准（类似 BibTeX/Zotero CSL 的生态位）。

| # | 审计标准 | 验证方式 | 优先级 |
|---|---------|---------|--------|
| O1 | 5 个核心对象的 JSON Schema 以独立文档形式可被外部访问（仓库 README + `schema/` 目录或独立 repo） | 任意外部开发者可在不阅读 ASCI 源码的前提下，根据 schema 文档写出兼容对象 | 必做 |
| O2 | Schema 与 UI / 存储实现解耦，零内部字段泄漏 | Schema 中不出现 `_uiState` / `_dirty` 等运行时字段 | 必做 |
| O3 | 提供至少 1 个示范导出：用户可将本地对象库导出为标准 JSON 包 | 导出后用 `ajv` 等通用 JSON Schema 校验器可通过 | 必做 |

构建工作量增量极小——P2/P3/D1-D3 已要求 schema 独立。此节的核心是**显式产出对外文档**，将"内部约束"升级为"对外契约"。

---

## 三、0.2 工作主线（按依赖顺序）

> 1-2 为对象底座的"验证应用"（继承 0.1 的范式）；3-4 为对象底座之外的平行主线（Agent 架构与体验范式），与 1-2 并行推进。

<a id="section-3-1"></a>

### 1. 证据链查看器（P0 — 最先）

**验证目标**：对象模型 + 引用协议（P2）
**0.1 继承**：B 组（综述可追溯）

| # | 审计标准 | 验证方式 | 优先级 |
|---|---------|---------|--------|
| V1 | 综述中点击引用标记 → 定位到 Paper 对象的具体段落 | 打开任意综述，点击任一引用，跳转到对应段落 | 必做 |
| V2 | Paper 对象下可见所有关联的 EvidenceRef、Note、CitationRelation（列表展示） | 在论文详情页查看关联对象列表 | 必做 |
| V2a | **兜底通道**：用户可在 Paper A 详情页"⋯"菜单中手动添加到 Paper B 的 CitationRelation（type: supports / contradicts / method-ref），创建后在 Paper A、Paper B 详情页双向可见。手动入口不占主操作区一级按钮位置 | 详情页"⋯"菜单 → "手动添加关系" → 选 Paper B + 类型 → 保存；分别打开 Paper A、Paper B 详情，双向可见同一关系条目 | 必做（兜底）|
| V2b | **Agent 主路径**：综述生成完成 / 检索结果入库时，Agent 触发式产出 `citation-relation` Proposal 候选（含 from / to / type / `reasoning`），落入相关 Paper 详情页"待审提议"区；用户决策（五档动作详见 [§一-A UI 约定](#section-1a)：`采纳 / 修改 / 拒绝 / 仅本对象不再提示 / 不再提示这类`）后采纳项转为正式 CitationRelation 并双向可见 | 跑一次综述 → 在涉及到的 Paper 详情页可见 ≥1 条 `citation-relation` Proposal 含 `reasoning` 文本 → 采纳后该关系出现在双向视图 | 必做 |
| V3 | 删除 Paper 后，引用该 Paper 的 EvidenceRef 标记"源已移除" | 模拟删除操作，检查引用处状态 | 必做 |

<a id="section-3-2"></a>

### 2. 札记面板（P1 — 第二）

**验证目标**：追加写入协议（P1）+ 引用协议（P2）+ 查询协议（P3，由 V6e 直接验证）+ Note 类型分化（kind enum + hypothesisStatus 生命周期）
**依赖**：证据链查看器（对象模型已验证）

> **综述包能力本体归属**（供 0.3 §三-C.1 引用）：ASCI 的"文献综述"能力本体由 **0.1 综述链路（B 组：综述生成 + 引用追溯）** 与 **0.2 V1 证据链查看器（引用对象化、双向可见、Proposal 触发链路）** 共同构成。0.3 §三-C.1 文献综述包**不重新实现综述能力**，仅通过 0.2 §三-3 A3 契约把已有能力包装为能力包形态接入（场景 Agent 设定 + Skill 引用 + UI 框架渲染配置）。

| # | 审计标准 | 验证方式 | 优先级 |
|---|---------|---------|--------|
| V4 | 在论文详情侧边写 Note → Note 自动关联当前 Paper 对象 | 写一条 Note，查 Paper 对象下可见该 Note | 必做 |
| V5 | 同一 Paper 多次写入 Note → 旧 Note 保留，新 Note 追加 | 写 3 条 Note，全部可见、不覆盖 | 必做 |
| V6 | 在证据集中可检索到关联的 Note | 在 EvidenceSet 视图中搜索 Note 内容 | 必做 |
| V6a | 侧边栏"笔记"入口可见，展示当前全部 Note 列表（支持搜索） | 打开侧边栏笔记视图，可见所有 Note，输入关键词可过滤 | 必做 |
| V6b | 笔记列表中点击任一条 Note → 跳转到其关联的 Paper / EvidenceSet 详情 | 点击 Note 条目，右侧面板定位到关联对象 | 必做 |
| V6c | **兜底通道**：用户在 Note 创建/编辑时可手动设置 `kind`（`note` / `hypothesis`）；侧边栏支持按 kind 过滤；同一 Paper 详情页可单独查看挂在其上的"假设类 Note"列表 | 创建 5 条 Note（3 普通 + 2 假设类），侧边栏按 kind 过滤分别只剩 3 / 2 条 | 必做（兜底）|
| V6c' | **Agent 主路径**：用户写 Note 时（含断言性句式）或综述生成完成时，Agent 触发式产出 `hypothesis-promote` Proposal（payload 含被识别为断言的句子片段，reasoning 含识别理由）；用户决策（五档动作详见 [§一-A UI 约定](#section-1a)，采纳即把对应 Note 翻为 hypothesis kind）| 写一条含断言句式的 Note（如"X 优于 Y 因为 …"）→ 该 Note 详情页"待审提议"区出现 `hypothesis-promote` Proposal 含 reasoning → 采纳后该 Note 的 kind 翻为 hypothesis | 必做 |
| V6d | **Agent 主路径**：EvidenceSet 新增 Paper 时，Agent 触发式产出 `hypothesis-review` Proposal — 对挂载的每条 hypothesis Note 评估新 Paper 倾向（`supports` / `contradicts` / `neutral`）+ 附 reasoning + 推荐操作；Proposal 落入 hypothesis Note 详情页"待审提议"区；用户决策（采纳判断 / 标存疑 / 自读再判 / 拒绝）。**采纳时同步回写 Note 的 `hypothesisStatus` 字段**（[§一 Note 字段](#section-1)）：`supports` → `supported`、`contradicts` → `contradicted`、Agent 推荐 `suspended`（如证据双向）→ 由用户在采纳时确认是否回写 `suspended`；用户也可在 Note 编辑面板手动覆盖 `hypothesisStatus`（兜底） | 在 EvidenceSet 上挂一条 `hypothesisStatus: unknown` 的 hypothesis Note → 向 EvidenceSet 添加论文 → 该 Note 详情页出现 `hypothesis-review` Proposal 含倾向标签 + reasoning 文本 → 采纳 `supports` 倾向 → Note 的 `hypothesisStatus` 自动翻为 `supported`；拒绝 Proposal 时 Note 字段不变 | 必做 |
| V6e | 100+ Note 时按 Paper 反查关联 Note 的响应时间与 Note 总量无关（落实 P3 查询不遍历） | 创建 100+ Note 后查询 Paper X 的关联 Note，响应时间与总量无关 | 必做 |
| V6f | Proposal 持久化与拒绝策略三档：用户对 Proposal 的 `accepted` / `rejected` / `modified` 状态可持久化；`dismissPolicy` 三档分别生效 —— `once`（默认拒绝行为）/ `scoped`（在 `targetObjectRef` 范围内永久静默该 sourceCapability 同 kind）/ `silence-this-kind`（全工作区永久静默该 sourceCapability 同 kind） | 三档分别验证：① 拒绝默认 once → 重跑相同触发流程，同位置同类 Proposal 重新出现；② 选 `scoped` → Paper-A 上不再出现该 sourceCapability 同 kind，但 Paper-B 上仍能正常产出；③ 选 `silence-this-kind` → 全工作区都不再出现 | 必做 |

<a id="section-3-3"></a>

### 3. Agent 拓展性重构（与 1-2 并行）

**目的**：让 ASCI 具备未来"能力包"承载、第三方扩展、Provider 解耦的架构基础。当前 Agent 调用层、工具/Skill/MCP 注册逻辑分散在 main 进程多处，**且现有多 Agent 形式未对齐 Claude Code SDK 推荐的 Orchestrator + 子 Agent 结构**，难以承载即将到来的能力包范式（见本节 4.）。

**范围**：
- **对齐 Claude Code SDK 推荐多 Agent 结构**：建立 Orchestrator（总控 Agent）+ 领域子 Agent（如检索 / 综述 / Zotero）的分层调用模型，子 Agent 通过 SDK 标准方式注册到 Orchestrator，替换当前分散在 main 进程的临时编排逻辑
- Agent SDK 调用层抽象（统一 entrypoint，剥离与具体 Provider/模型耦合）
- 工具 / Skill / MCP 的统一注册与发现机制（为能力包"一键安装"预留接口）
- **UI 框架库**：主程序内置 1 个「对话主 + 右侧产物」框架；能力包契约预留"UI 框架选择"字段（0.4+ 实现多 UI 框架注册机制，届时支持写作 / 实验日志等不同形态的能力包）
- 能力包预留接口（不实现具体能力包，仅打通注册与调用契约）

**审计标准**：

| # | 审计标准 | 验证方式 | 优先级 |
|---|---------|---------|--------|
| A0 | 多 Agent 结构对齐 Claude Code SDK 推荐范式：存在唯一 Orchestrator 入口，子 Agent 通过 SDK 标准注册接口被 Orchestrator 路由调用 | 阅读架构文档（`docs/architecture.md` 更新章节）；新增任一 mock 子 Agent，无需改 Orchestrator 代码即可被路由 | 必做 |
| A1 | Agent 调用层有单一 entrypoint，所有 Provider 通过适配器接入 | 新增一个 mock Provider 适配器，无需改 entrypoint 即可被 Agent 调用 | 必做 |
| A2 | 工具/Skill/MCP 注册走统一接口，注册项可被 Agent 在运行时枚举 | 调用注册中心 API 可返回当前所有已注册项的元数据（名称、来源、能力声明） | 必做 |
| A3 | 能力包契约四要素明确：**场景 Agent 设定 + Skill 引用 + MCP 引用 + UI 框架（选择 + 渲染配置）**；主程序提供 UI 框架库（0.3 内置「对话主 + 右侧产物」1 个，0.4+ 可扩展），能力包通过契约声明使用哪个框架并配置渲染细节；契约文档化可被 0.3 能力包实现层直接消费。**额外预留 `capabilities.proposals[]` 字段**：能力包声明自己能产出哪类 Proposal（`kind` + 触发点 + reasoning 模板），主程序据此把 Proposal 路由到对应详情页"待审提议"区（见 §一-A）| 接口契约以独立文档形式存在（`schema/capabilities/`）含四要素 schema + UI 框架库注册接口说明 + `proposals[]` schema + 至少 1 个示范 mock 能力包通过该契约成功注册、被 Orchestrator 调用并在所选 UI 框架内渲染产物，**同时产出 ≥1 条 mock Proposal 写入"待审提议"区且可被用户决策** | 必做 |

<a id="section-3-4"></a>

### 4. 前端交互体验优化 — 能力包范式（与 1-2 并行）

**目的**：当前 ASCI 的配置和场景更像 Coding Agent — 用户需要分别配置 MCP、Skill、Provider 模型。0.2 启动从"配置驱动"到"能力包驱动"的范式转变：用户看到的是检索/综述包、写作包、实验包等可直观理解的能力包，一键安装即可向 Agent 下达任务。

**0.2 范围**（不做实现，只表达方向 + 用户验证 + 概念稿）：
- 用户需求调研（验证范式假设、识别能力包候选清单）
- 能力包概念 Spec（命名、粒度、内容物、依赖关系、安装/卸载语义）
- UI 概念稿（能力包浏览 / 安装 / 管理 / 任务下达入口）
- 旧"配置驱动"流程到"能力包"的迁移方案（不破坏 0.1 已有配置体验）

**审计标准**：

| # | 审计标准 | 验证方式 | 优先级 |
|---|---------|---------|--------|
| X1 | 至少完成 5 名 ASCI 目标用户的需求验证访谈，输出能力包候选清单（≥3 类），并明确：哪些发现验证能力包范式可行、哪些发现会推翻或缩小 0.3 §三-C 的能力包范围 | 访谈记录 + 候选清单文档可查 + 范式验证 / 推翻判断结论入档 | 必做 |
| X1.1 | 访谈大纲含 **"Agent 主动提议接受度"验证项**（落地 [§零灰度回退条件](#section-zero)）：让用户面对 Proposal 卡片样例（含 `citation-relation` / `hypothesis-promote` / `hypothesis-review` 各 1 张含 reasoning），评分接受度 1-5；统计 ≥ 50% 给 ≤ 2 分则触发 §零 主路径降档评估 | 访谈记录中每位用户对三类 Proposal 各有评分 + 末尾汇总抵触比例（按 ≤ 2 分 = 抵触口径）；汇总写入 X1 输出文档 | 必做 |
| X1.2 | 访谈大纲含 **"Skill / 能力包二分心智识别度"验证项**（落地 0.3 §三-C.0 配置分层依据）：向用户展示 0.3 §三-C 概念稿中"系统底座（Settings 弹窗）vs Agent 生态（左侧'配置'页）"二分布局，测试用户能否在 30 秒内正确区分"调系统参数 vs 管 Agent 能力"两种心智；统计正确率 < 60% 则触发 0.3 CP5 强制约束降级评估 | 访谈记录中每位用户独立完成 1 次区分任务（如"请告诉我 Provider API Key 应该在哪里配置、文献综述包应该在哪里启用"）+ 末尾汇总正确率 | 必做 |
| X2 | 能力包概念 Spec 完成，含：命名 / 粒度 / 四要素内容物（场景 Agent 设定 + Skill 引用 + MCP 引用 + UI 框架选择与渲染配置）/ **能力包副产品（`capabilities.proposals[]` 提议产出契约：声明该包产出的 Proposal kind、触发点、reasoning 模板）** / 依赖 / 安装-卸载语义；明确"Skill 板块 + 能力包板块"二分以及 Settings vs 独立配置页的分层 | Spec 文档可查；同行评审通过；副产品段落明确两个首发包（检索 / 综述）各自的 Proposal 产出清单 | 必做 |
| X3 | UI 概念稿完成，覆盖独立"配置"页（Skill 板块 + 能力包板块的浏览 / 详情 / 启用 / 安装 / 卸载 / 包内偏好）+ 与任务下达的衔接 + **Paper / EvidenceSet / hypothesis Note 详情页"待审提议"区的 UI 范式**（Proposal 卡片样式、reasoning 展示、五档决策动作按钮 `采纳 / 修改 / 拒绝 / 仅本对象不再提示（scoped）/ 不再提示这类（silence-this-kind）`、兜底"⋯ 手动添加"入口位置）；明确 0.3 阶段主程序仅内置「对话主 + 右侧产物」1 个 UI 框架，2 个首发包均使用该框架；UI 框架库的扩展机制（如何注册新框架供 0.4+ 能力包选择）在概念稿中说明 | 概念稿可点击走完 happy path，**包含至少 1 个 Proposal 决策走查**（看到候选 + 看到 reasoning + 决策 + 状态翻转，含至少 1 次 `scoped` 拒绝以验证粒度差异） | 必做 |
| X4 | 迁移方案明确"旧 Settings 配置 → 0.3 目标位置"的映射：MCP 服务器→新 Settings MCP tab；能力包相关项→左侧"配置"页；Zotero / Provider / 代理等系统层项不动。0.1 / 0.2 老用户升级到 0.3 不丢配置 | 映射表文档化 + 升级路径在 0.3 实现前可执行验证 | 必做 |

> 0.2 只做"看得见、可决策"的概念层产物（Spec / 概念稿 / 用户验证 / 迁移方案）。**具体实现层（2 个首发场景能力包、独立配置页、Settings 结构调整、默认页改造）放 0.3 §三-C**。

---

## 四、与 0.1 的关系

```
0.1 产出                          0.2 消费
──────────                      ──────────
检索结果 (Paper[])        →     入库为 Paper 对象
综述结论 (Review HTML)    →     拆解为 EvidenceRef[]
用户反馈/修正             →     写入 Note
Zotero 论文库             →     关联到 EvidenceSet
```

0.1 的可信检索+综述是 0.2 对象的**数据来源**，0.2 的对象模型让 0.1 的产出**可积累、可复用**。

---

## 五、0.2 不做的事

- 不做完整的多 Agent 协同编排（V1）
- 不做插件市场 / 开发者文档（V2）
- 不追求对象模型覆盖全部科研场景
- 不另做一套文献管理系统（继续对接 Zotero）
- 不做用户账户体系（0.3）
- 不做公开发布（0.3）
- 不做 MCP Server / A2A 服务暴露（V1 路线图，0.2 仅在设计层预留扩展性）
- 不做能力包的具体实现（0.2 只做概念 Spec / UI 概念稿 / 用户验证；实现在 0.3 §三-C）
- 不做"旧配置驱动"流程的下线（迁移方案在 0.2 完成，0.3 §三-C 同步删除 Settings 中的对应配置）
- 不做 Hypothesis 独立对象（用 Note `kind: hypothesis` 替代；等真实用户反馈出现强需求时再分化）

---

## 六、0.3 前置准备

Dev D 在 0.2 期间同步以下三项工作（F1 / F2 / F3），为 0.3 开局就绪做准备，但不阻塞 0.2 交付。

### F1：后端栈选型 ADR（4 粒度，0.3 启动前置）

> **术语澄清**：文档里"自建服务器"指的是"自己写后端代码"，**不**是"不使用 AWS / GCP 等云"。0.3 的服务器一定部署在公有云上，需要决策的是**用什么栈写、装在哪个云、认证用 SaaS 还是自写**。

Week 1 末输出 **ADR-002：服务器后端栈选型决策**（位置：`docs/adr/ADR-002-server-stack.md`），覆盖：

| 粒度 | 候选 | 关键决策依据 | 优先级 |
|------|------|-------------|--------|
| ① 部署平台 | AWS / GCP / Hetzner / DigitalOcean | GDPR 数据主权、欧美双节点能力、月成本 | 必做 |
| ② 数据库 | AWS RDS / Neon / Supabase（仅 DB）/ 自管 PG | 托管费 vs 运维成本 | 必做 |
| ③ 认证策略 | 自写 / Auth0 / Clerk / WorkOS | ORCID 接入成本、月费临界点（Auth0 7000 MAU 后失效免费层） | 必做 |
| ④ 应用层框架 | Bun + Hono / Go + Gin / Node + Fastify | 团队学习成本、0.3 时间窗口（~2 周）、性能 | 必做 |

每粒度需含 TCO 估算与决策依据。Firebase / Supabase 全栈 BaaS 因 GDPR 主权 + ORCID 不在默认 provider 列表 + 本地优先架构通常可在 §3 中淘汰，但需在文档中记录原因。

> **F1 是 ADR 而非纯调研文档**：必须含调研 + 评审 + 拍板人 + 决策记录，不能停留在"罗列选项"层面。决策结论一旦签字即为 0.3 实施依据，变更需走 ADR 修订流程。

### F2：GDPR MVP 合规启动（0.3 公开发布前置）

Week 1 启动：Privacy Policy / ToS 模板（律师扫一眼，非起草）、DPA 签约（用 Sentry / PostHog / 邮件商现成模板）、EU Representative 外包（GDPR Art. 27）。Week 2 末完成 Privacy Policy 一稿。

| 子项 | 时点 | 优先级 |
|------|------|--------|
| Privacy Policy / ToS 模板律师扫一眼 | Week 1 | 必做 |
| DPA 签约（Sentry / PostHog / 邮件商） | Week 1-2 | 必做 |
| EU Representative 外包（GDPR Art. 27） | Week 1-2 | 必做 |
| Privacy Policy 一稿完成 | Week 2 末 | 必做 |

> **F2 scope 边界**：DPO 选定 / 正式 DPIA / 律师起草级合规文档**推迟到 0.4 / V1 规模化触发**（1k+ EU 用户或开始收费）。当前 ASCI 不属于 GDPR Art. 37 强制 DPO 条件（非公共机关 / 非大规模监控 / 非特殊数据）。
>
> 详细 0.3 GDPR MVP 清单见 [0.3 north-star.md §五](../0.3/north-star.md#五安全机制)。

### F3：本地存储后端 ADR（V6e 实现前置）

> **触发原因**：V6e 要求"100+ Note 时按 Paper 反查关联 Note 的响应时间与 Note 总量无关"，需要索引能力——JSON 文件做不到、SQLite 可以、自定义格式要写 indexer。ADR-001 必须在 V6e 实现 issue 开出之前完成。

Week 1 末输出 **ADR-001：本地存储后端选型决策**（位置：`docs/adr/ADR-001-local-storage.md`），覆盖维度：

| 维度 | 关键问题 | 优先级 |
|------|---------|--------|
| 性能 | 100+ / 1k+ / 10k+ EvidenceRef 下的查询/写入延迟基线 | 必做 |
| 索引能力 | 是否原生支持二级索引、多关系 join、全文检索 | 必做 |
| 跨平台 | macOS / Windows / Linux 一致性，是否需 native binary 打包 | 必做 |
| 备份恢复 | 文件级备份 vs 数据库 dump，单文件 vs 目录树 | 必做 |
| 升级迁移 | schema 演进策略，旧版本数据如何迁移 | 必做 |
| 离线优先 | 完全离线运行的可靠性 | 必做 |
| 与 Agent SDK 兼容性 | 是否阻塞 Electron 主进程、与 SDK 子进程的并发模型 | 必做 |
| Electron 打包成本 | 二进制大小、code signing 影响 | 必做 |

候选方案：JSON 文件 / SQLite / DuckDB / 自定义二进制格式 / 其他（调研补充）。

> **决策时点硬约束**：ADR-001 必须在 V6e issue 开出之前完成。否则 V6e 验证标准（100+ Note 查询时间无关）跑不通。

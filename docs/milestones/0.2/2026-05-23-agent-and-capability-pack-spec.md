# Agent 重构 + 能力包 实现规格（0.2 对象底座 / 0.3 能力包首发）

> **本文件定位**：从本文件签署之日起，**本文件是 0.2 milestone（排除 Proposal 生成端）与 0.3 milestone 能力包功能 的实现唯一对齐源**。任何对实现 / 验收 / 接口的口径冲突以本文为准。
>
> **生成日期**：2026-05-23
>
> **责任分工边界（重要）**：本文档以 liningftp 负责范围视角组织：
> - **liningftp 负责**：Agent 拓展性架构（§4）、能力包首发 lit-search / lit-review / Mock（§5）、能力包基础设施 CP1（§6）、文档对齐、X1-X4 概念层产出。
> - **fanlizhi 负责**（PR #284 / #308 已落地）：5 大对象（Paper / EvidenceRef / EvidenceSet / Note / CitationRelation）+ Proposal 类型、JSON Schema、SQLite 持久层、Repository CRUD、Proposal 状态机 + dismissPolicy 服务。
> - **itpretty 负责**（PR #286 已落地）：Proposal / Note / CitationRelation 详情页 UI（PaperProposalsPanel / ProposalCard / NoteDetailDialog / `proposals.json` i18n 等）。
> - **协作铁律**：本文档对 fanlizhi / itpretty 负责的代码**仅锁定接口契约**（schema 字段名、事件名、状态枚举、dismissPolicy 三档语义），**不规定实现细节**。liningftp 不主动新增 / 修改 Proposal / CitationRelation 相关代码——除非接口对齐时必要（如能力包加载器需要读 Proposal repository）。
>
> **来源谱系（已被本文吸收，请勿再作为独立权威源消费）**：
> - [`north-star.md`](./north-star.md) — 0.2 核心定义（§零 / §一 / §一-A / §一-B / §三-1/2/3/4）
> - [`north-star-patch.md`](./north-star-patch.md) — §三-3 A0-A4 + C5 双名兼容拟替换内容
> - [`paper-semantics.md`](./paper-semantics.md) / [`evidence-ref-semantics.md`](./evidence-ref-semantics.md) / [`evidence-set-semantics.md`](./evidence-set-semantics.md) / [`note-semantics.md`](./note-semantics.md) / [`citation-relation-semantics.md`](./citation-relation-semantics.md) — 5 大对象语义
> - [`2026-05-22-pack-orchestration-overview.md`](./2026-05-22-pack-orchestration-overview.md) — 两包共享原则 + 工作流
> - [`subagents-more.md`](./subagents-more.md) — 能力包契约 → SDK 字段映射
> - [`sdk-orchestrator-subagents-spec.md`](./sdk-orchestrator-subagents-spec.md) — SDK 原生范式
> - [`architecture-audit-2026-05-21.md`](./architecture-audit-2026-05-21.md) — D-A/B/C 三决策落地审计
> - [`lit-search场景 Agent 编排说明.md`](./lit-search场景%20Agent%20编排说明.md) / [`lit-review场景 Agent 编排说明.md`](./lit-review场景%20Agent%20编排说明.md) — 两包详释（本文不重复其细节，骨架在 §5）
> - [`../0.3/north-star.md`](../0.3/north-star.md) §三-C — 0.3 能力包实现层
>
> **未吸收（保留为存档背景）**：`moat-analysis.md` / `milestone-review.md` / `issue-{170,263,266}-*-reply-draft.md`（战略 / 评审 / 设计辩护，不影响本文实现要求）。
>
> **本文不重复**：CSS / Tailwind / i18n / TS 配置等横切约束（见根 `CLAUDE.md` §2 / §7）；具体 IPC 通道命名与 Bun workspace 结构（见 `docs/architecture.md`）。

---

## 目录

- [§0 范围与红线](#0-范围与红线)
- [§1 对象模型（5 核心对象 + Proposal 类型定义）](#1-对象模型5-核心对象--proposal-类型定义)
- [§2 读写协议 + 开放标准](#2-读写协议--开放标准)
- [§3 工作区事件总线（9 事件）](#3-工作区事件总线9-事件)
- [§4 Agent 拓展性架构（D-A / D-B / D-C 三决策）](#4-agent-拓展性架构d-a--d-b--d-c-三决策)
- [§5 0.2 能力包首发：检索 + 综述 + Mock](#5-02-能力包首发检索--综述--mock)
- [§6 0.3 能力包基础设施（CP1 + 本地最小闭环）](#6-03-能力包基础设施cp1--本地最小闭环)
- [§7 用户旅程验证（王老师 RAG 综述）](#7-用户旅程验证王老师-rag-综述)
- [§8 验收标准合表](#8-验收标准合表)
- [§9 0.2 / 0.3 排除项明细](#9-02--03-排除项明细)
- [附录 A 来源文档谱系状态](#附录-a-来源文档谱系状态)

---

<a id="0-范围与红线"></a>

## §0 范围与红线

### 0.1 本文档实现范围

> **核心交付（不接受削弱）**：**能力包功能（§4 Agent 拓展性 + §5 0.2 首发 lit-search/lit-review/Mock + §6 0.3 CP1 本地最小闭环）完整交付** 是本文档的核心。Proposal / CitationRelation 由其他成员负责并已部分落地，本文仅锁接口契约（不让能力包代码碰它们）—— 这条边界**不能反向削弱能力包功能本身的完整性**。

| 范围层 | 含 / 不含 | 说明 | 负责人 |
|--------|----------|------|-------|
| **5 大对象 + Proposal 类型 / Schema / 持久化 / Repository** | 📌 **接口契约对齐，本文不规定实现** | 已由 PR #284 / #308 落地。本文仅锁字段名 / 事件名 / 状态枚举 / dismissPolicy 三档，liningftp 不改其代码 | fanlizhi |
| **Proposal / Note / CitationRelation 详情页 UI** | 📌 **接口契约对齐，本文不规定实现** | 已由 PR #286 落地。本文仅锁 i18n key 命名 / 五档动作语义 | itpretty |
| **Proposal 生成端**（Dispatcher / 后台子进程 / 自动产出链路） | ❌ **不含** | 0.2 不交付任何 Proposal 自动产出能力 → 推迟 0.3 | — |
| **CitationRelation 创建路径**（V2a 手动 / V2b Agent） | ❌ **不含** | 0.2 不交付 CitationRelation 任何创建入口 → 推迟 0.3 | — |
| **0.2 Agent 拓展性 A0-A4 / C5** | ✅ 含 | 主 Orchestrator + 子 Agent SDK 原生范式、统一注册中心、能力包契约四要素、Task ↔ Agent 双名兼容 | **liningftp** |
| **0.2 能力包首发** | ✅ 含 lit-search + lit-review + Mock 三个 | 详释见 §5；精读包不在 0.2 首发，作为 0.3 CP1 候选 | **liningftp** |
| **0.2 工作区事件总线 emit 框架** | ✅ 含 | 在能力包流程中正确 emit `pack.taskCompleted`；其他对象事件由 fanlizhi 的 Repository 负责 emit | **liningftp** + fanlizhi |
| **0.2 概念层 X1-X4** | ✅ 含 | 用户调研访谈 / 能力包 Spec / UI 概念稿 / 旧配置迁移方案 | **liningftp** |
| **0.3 能力包基础设施（CP1）** | ✅ 含 | manifest 格式 / 注册中心 / 本地导入启停 / 配置页骨架 / Settings 结构调整骨架 | **liningftp** |
| **0.3 账户 / 服务器 / 埋点 / GDPR / 自进化 / 默认页改造** | ❌ **不含** | 由 [0.3 north-star.md](../0.3/north-star.md) §一 / §二 / §三 / §三-A / §三-D / §五 / §五-A 独立承担，本文档不展开 | — |
| **0.3 能力包发布渠道（中心仓库 / 第三方上传）** | ❌ **不含** | 0.3 §三-C.5 明确推迟到 0.5 / V1 | — |

**标记图例**：✅ 含 = 本文规定实现细节；📌 接口契约 = 本文只锁接口、不规定实现（其他成员已交付）；❌ 不含 = 推迟到 0.3+，**本文档不为此预埋任何代码**。

### 0.2 §零 哲学红线（一段总则）

> **ASCI Agent 主导原则**：能用 Agent 解决的 **观察 / 归纳 / 标注 / 整理** 工作，全部由 Agent 完成；用户只承担 **下达目标、审查判断、最终决策**。这是后续所有审计项的滤镜——任何"用户主动手工 X"的设计，先问一遍 *"Agent 能不能先提议、用户只决策？"*。Agent 替代 **有标准答案** 的工作；用户保留 **没有标准答案** 的工作（判断 / 创造 / 直觉记录）。
>
> **本文档与 §零 的关系**：0.2 排除 Proposal 生成端意味着「提议-决策」交互形态推迟到 0.3，但**对象类型 + 事件枚举 + 状态机字段在 0.2 落地**，§零 哲学在 0.3 实现 Dispatcher 时直接生效，无需回头补对象底座。

### 0.3 灰度回退条件（继承自 0.2 §零）

| X1 访谈结果 | 处置 |
|------------|------|
| ≥ 50% 用户对 Agent 主动提议给 ≤ 2 分 | §零 主路径降档为姿态 A（实时建议）或姿态 B（后台批处理），0.3 Dispatcher 实现前评估具体降档 |
| < 50% 但 ≥ 20% 抵触 | C 姿态保留为主路径，但 0.3 Settings 内增加"Agent 主动提议默认关闭" toggle |
| < 20% 抵触 | 维持 §零 现状 |

> 灰度回退**不推翻** Proposal 对象类型与 dismissPolicy；仅影响"触发时机"（被动 vs 主动）而非"载体形态"。

---

<a id="1-对象模型5-核心对象--proposal-类型定义"></a>

## §1 对象模型（接口契约 — 实现由 fanlizhi PR #284/#308 落地）

> **本节作用**：对 liningftp 负责的能力包 / Agent 架构 / 工作区事件总线代码，**锁定它消费 / 引用对象层的接口契约**——字段名、状态枚举、事件名、不变量。本节**不规定** 5 大对象 / Proposal 的实现细节（这些由 [`packages/shared/src/types/objects/`](packages/shared/src/types/objects/) + [`apps/electron/src/main/lib/objects/`](apps/electron/src/main/lib/objects/) 已落地的代码作为单一权威源）。
>
> **如果发现本文档与已落地代码字段不一致**：以代码为准，并将本文档差异提到对应 owner（fanlizhi / itpretty）评审后修订。

### 1.1 5 大对象 + Proposal 速览

| 对象 | 类别 | 0.2 状态 | 0.2 用户可见 | 关联关系 |
|------|------|----------|------------|---------|
| Paper | 核心 | 已落地 | ✅ 列表 / 详情 / 入库 / 软删 | 被 EvidenceRef / Note 引用、被 EvidenceSet 包含、被 CitationRelation 连接（0.3 起） |
| EvidenceRef | 核心 | 已落地 | ✅ 综述句子可穿透 | source: Paper.paragraph；target: Review.sentence |
| EvidenceSet | 核心 | 已落地 | ✅ 兜底新建 / 命名 / contains 编辑 | contains: Paper[] + EvidenceRef[] |
| Note | 核心 | 已落地（含 `kind` + `hypothesisStatus`） | ✅ 笔记面板 / 兜底设 kind / 兜底覆盖 status | target: Paper / EvidenceSet |
| **CitationRelation** | 核心 | 已落地类型 + Repository | ❌ **0.2 无创建路径**（V2a / V2b 均推迟 0.3） | type: supports / contradicts / method-ref；from: Paper；to: Paper |
| **Proposal** | 交互 | 已落地类型 + Repository + dismiss 服务 | ❌ **0.2 无自动产出**（生成端推迟 0.3，Mock 包不预埋）| kind: citation-relation / evidence-set / hypothesis-promote / hypothesis-review |

**通用原则**：每个对象有唯一 ID、可被引用、可被追加、不依赖特定 UI。

### 1.2 接口契约（liningftp 代码需对齐的字段 / 事件 / 枚举）

#### Paper
- 标识：`Paper.id` 跨主路径稳定 — DOI → arXiv ID → Semantic Scholar paperId → 内容 hash
- 坐标：`Paper.paragraph` 是虚拟坐标系（非独立对象），基于内容 hash 的稳定 chunk id
- 软删：删除保留 ID，引用方标 `sourceRemoved: true`
- 关联查询性能：Paper.id → EvidenceRef[] / Note[] 查询复杂度与总量无关（V6e 落实，存储后端实现见 ADR-001）

#### EvidenceRef
- 字段方向（反直觉，明确）：`source = Paper.paragraph`（证据来源），`target = Review.sentence`（证据用途）
- 创建路径：仅综述 pipeline 内 inline 产出，**无独立手动入口**；能力包综述包必须在此 pipeline 内调用 Repository 写入

#### EvidenceSet
- 容器型：`contains: { paperIds: string[], evidenceRefIds: string[] }` — 引用列表，禁止嵌套对象
- 命名唯一：工作区内 name 唯一
- 关键事件：新增 Paper 时必须触发 `evidenceSet.paperAdded` — 能力包流程通过 Repository 添加 Paper 时事件自动 emit

#### Note
- 字段：`kind: "note" | "hypothesis"`（默认 `"note"`），`hypothesisStatus: "unknown" | "supported" | "contradicted" | "suspended"`（默认 `"unknown"`，仅当 `kind === "hypothesis"` 时有意义）
- 目标：`target: { type: 'paper' | 'evidence-set', id: string }` —— 必须携带类型标注
- 翻转规则：用户手动翻转可用（V6c 兜底）；Agent 主路径翻转（V6c'）由 Proposal 生成端 0.3 落地

#### CitationRelation
- 字段：`{ id, from: Paper.id, to: Paper.id, type: "supports"|"contradicts"|"method-ref", reasoning, createdAt }`
- 不依赖 cite 前置条件（无 cite 仍可成立，差异化能力）
- 双向：from / to 两侧 Paper 详情页对称可见（0.3 起，0.2 无 UI）
- **0.2 阶段约束**：liningftp 的能力包代码 / 综述包代码 / 检索包代码 **不**主动调用 CitationRelation Repository 写入，不依赖其存在

#### Proposal
- 字段：`{ id, kind, sourceCapability, payload, reasoning, status, createdAt, decidedAt?, targetObjectRef, dismissPolicy }`
- `kind`: `"citation-relation" | "evidence-set" | "hypothesis-promote" | "hypothesis-review"`
- `status`: `"pending" | "accepted" | "rejected" | "modified"`
- `dismissPolicy`: `"once" | "scoped" | "silence-this-kind"`
- **0.2 阶段约束**：liningftp 的能力包 / Mock 包 / 综述包 / 检索包代码 **不**主动调用 Proposal Repository 写入；`pack.taskCompleted` 事件 emit 时 ProposalDispatcher 在 0.2 无订阅者，能力包侧无需感知 Proposal

### 1.3 dismissPolicy 三档语义（liningftp 代码需感知的策略边界）

| 档位 | 语义 |
|------|------|
| `once` | 仅本条不再提示（默认） |
| `scoped` | 在 `targetObjectRef` 范围内，该 `sourceCapability` 同 `kind` 的同类提议不再产出；其他对象上仍可产出 |
| `silence-this-kind` | 该 `sourceCapability` 同 `kind` 的同类提议在**全工作区**永久不再产出 |

> 0.3 ProposalDispatcher 落地时会读 dismissPolicy 决定是否产出；liningftp 的能力包不直接消费此字段。

### 1.4 详细语义参考（fanlizhi / itpretty 范围，本文不深入）

5 大对象的详细概念语义（创建路径、字段方向、不变量推导、设计权衡）见本目录配套的对象语义文档（仅供 review 参考，不进 git）：[`paper-semantics.md`](./paper-semantics.md) / [`evidence-ref-semantics.md`](./evidence-ref-semantics.md) / [`evidence-set-semantics.md`](./evidence-set-semantics.md) / [`note-semantics.md`](./note-semantics.md) / [`citation-relation-semantics.md`](./citation-relation-semantics.md)。

**对 liningftp 的硬约束（再次强调）**：

1. 不主动调用 `proposal-repository.ts` 写入 Proposal — 即使是 Mock 包验收，也不通过 liningftp 代码触发；A3 验收锚点改为"Mock 包仅完成注册 + 调用 + UI 渲染 + emit `pack.taskCompleted`"（详见 §5.5 / §8.3）。
2. 不主动调用 `citation-relation-repository.ts` 写入 CitationRelation — 综述包 / 检索包 pipeline 内不依赖此 Repository。
3. 能力包代码消费 5 大对象时，统一通过 `objects/` 暴露的高层 Service / Repository，不绕道直读 SQLite。

---

<a id="2-读写协议--开放标准"></a>

## §2 读写协议 + 开放标准

### 2.1 三条铁律

| # | 协议 | 审计方式 |
|---|------|---------|
| P1 | **追加不覆盖**：新证据追加到已有对象，不删除旧数据 | 同一 Paper 下多次写入，旧条目保留可查 |
| P2 | **引用不复制**：对象间通过 ID 关联，不复制内容 | 删除源对象时，引用处标记"源已移除"而非空值 |
| P3 | **查询不遍历**：通过关系索引查询，不遍历全量 | 查"Paper X 关联的所有 Note"不需要遍历全部 Note |

落地形式（JSON Schema / TypeScript interface / 其他）由技术方案决定，但**对象 schema 必须独立于 UI 与存储**。

### 2.2 D1-D3 外部 API 扩展性

对象模型在 0.2 为本地设计，但必须预留未来 MCP / A2A 服务对外暴露的能力：

| # | 约束 | 说明 |
|---|------|------|
| D1 | **对象有稳定的序列化格式** | 每个对象类型的 JSON Schema 独立定义，不耦合 UI 层或存储层 |
| D2 | **关系通过 ID 引用，不嵌套对象** | 与 P2 一致，确保 API 响应可控（不会一次查询拉出整个对象图） |
| D3 | **查询接口参数化** | 按对象类型、关联关系、时间范围等维度查询，不硬编码查询逻辑 |

### 2.3 O1-O3 对象标准开放（护城河 P0）

| # | 审计标准 | 验证方式 |
|---|---------|---------|
| O1 | 5 个核心对象的 JSON Schema 以独立文档形式可被外部访问（仓库 README + `schema/` 目录或独立 repo）| 任意外部开发者可在不阅读 ASCI 源码的前提下，根据 schema 文档写出兼容对象 |
| O2 | Schema 与 UI / 存储实现解耦，零内部字段泄漏 | Schema 中不出现 `_uiState` / `_dirty` 等运行时字段 |
| O3 | 提供至少 1 个示范导出：用户可将本地对象库导出为标准 JSON 包 | 导出后用 `ajv` 等通用 JSON Schema 校验器可通过 |

> Proposal 类型同样产出独立 JSON Schema（与 5 大对象同目录），但**不在 O1 必须开放范围**——Proposal 是交互对象，其语义在 0.3 Dispatcher 落地前对外不稳定。

---

<a id="3-工作区事件总线9-事件"></a>

## §3 工作区事件总线（9 事件）

### 3.1 事件枚举

| # | 事件名 | emit 时机 | 0.2 订阅者 | 0.3 订阅者 |
|---|--------|----------|----------|----------|
| 1 | `paper.created` | Paper 入库（去重后） | — | ProposalDispatcher |
| 2 | `paper.deleted` | Paper 软删除 | EvidenceRef 标 `sourceRemoved` | — |
| 3 | `evidenceSet.created` | EvidenceSet 新建（兜底主动或 0.3 提议采纳）| — | ProposalDispatcher |
| 4 | `evidenceSet.paperAdded` | EvidenceSet 新增 Paper | — | ProposalDispatcher（驱动 V6d hypothesis-review）|
| 5 | `note.created` | Note 新建 | — | ProposalDispatcher（驱动 V6c' hypothesis-promote）|
| 6 | `note.updated` | Note 内容 / kind / hypothesisStatus 任一字段更新 | — | ProposalDispatcher |
| 7 | `evidenceRef.created` | 综述 pipeline 内 inline 产出 | — | — |
| 8 | `citationRelation.created` | CitationRelation 入库 | **0.2 无 emit 来源**（V2a / V2b 创建路径推迟 0.3）；emit 框架就绪 | V2a 手动 / V2b 主路径触发 |
| 9 | `pack.taskCompleted` | 能力包场景 Agent 收口时 | — | ProposalDispatcher（驱动 V2b / V6c' 综述 / 检索后链路）|

### 3.2 emit 实现归属（按代码 owner 区分）

| 事件 | emit 触发位点 | 归属 |
|------|--------------|------|
| `paper.created` / `paper.deleted` | Paper Repository CRUD | fanlizhi（已落地）|
| `evidenceSet.created` / `evidenceSet.paperAdded` | EvidenceSet Repository CRUD | fanlizhi（已落地）|
| `note.created` / `note.updated` | Note Repository CRUD | fanlizhi（已落地）|
| `evidenceRef.created` | 综述生成 pipeline inline 产出（综述包） | **liningftp**（lit-review 综述包内） |
| `citationRelation.created` | CitationRelation Repository（0.2 无调用方）| fanlizhi（已落地）|
| `pack.taskCompleted` | 能力包场景 Agent 收口时 | **liningftp**（能力包流程内）|

**liningftp 的 emit 责任**：仅 `evidenceRef.created`（综述包 pipeline 内）与 `pack.taskCompleted`（场景 Agent 收口）两个事件。其他事件由 fanlizhi 的 Repository 在 CRUD 时自动 emit，liningftp 不直接 emit、不绕过 Repository。

### 3.3 实现约束

- 事件 payload 类型 + JSON Schema 已由 fanlizhi 在 [`packages/shared/src/types/objects/`](packages/shared/src/types/objects/) 定义；liningftp 仅消费类型，不主动新增字段
- emit 必须**同步**完成（不能依赖未来的 Dispatcher 异步链路）
- 事件持久化 / 重放：0.2 不需要；0.4+ 评估

---

<a id="4-agent-拓展性架构d-a--d-b--d-c-三决策"></a>

## §4 Agent 拓展性架构（D-A / D-B / D-C 三决策）

> 三决策来自 0.2 架构图 PDF（2026-05-18 / ADR-004-*.md / PR #265）：
> - **D-A**：能力包 = 容器，不是配置。自带场景 Agent + sub-agents + 引用资源 + 声明 Proposal。
> - **D-B**：主 Agent 只路由不亲自看病。β 任务路由通过 SDK Task 派发，跨包通过对象层共享。
> - **D-C**：默认透传。场景 Agent 事件直接给 UI；D2 会话粘滞记忆活跃包；主 Agent 可显式上场。

### 4.1 主 Orchestrator 路由（D-B）

ASCI 对齐 **Claude Agent SDK 推荐范式**：**没有 Orchestrator 类，只有"主 Agent + 子 Agent"**。

**主 Agent 三个职责**：

1. **意图识别 + 澄清** — model-based dispatch，序列性自主 / 跳跃性反问；
2. **Task 派发 + 粘滞** — `SDK options.agents` 注入 + `stickyCapabilityPackId`（会话粘滞）；
3. **System Prompt sandwich** — 平台身份 + §零 哲学 + 对象模型 + 工作区 ctx + 红线 + Output Language directive。

**强约束**：

- main 进程**只在** `runOrchestratorQuery` 内部 `import { query }`，其余路径全部走 `runOrchestratorQuery(opts)` 间接调用（grep `import { query }` 在 main 进程代码内**仅一处**）；
- Master 不直接干活：`options.allowedTools` 仅含 `Task` + 极少数 master-only 工具，**不含** `Bash` / `Edit` / `Write`；
- 子 Agent 通过 SDK 标准接口注册：`options.agents = subagentRegistry.snapshot()`；
- 新增 mock 子 Agent 无需改 Orchestrator 代码 — 只调 `subagentRegistry.register(def)`。

### 4.2 能力包容器（D-A）

每个能力包是**独立目录 + manifest + 场景 Agent + sub-agents + 引用资源 + Proposal 声明**：

```
{packId}/
  manifest.json
  scenario/
    system-prompt.md              # 场景 Agent 设定
    agent.json                    # AgentDefinition（model / allowedTools / hooks…）
  sub-agents/
    {name}.md                     # 各 SubAgent 设定
  bundled-mcp.json                # 包自带 MCP（如 lit-search 的 paper-search）
  bundled-skills/                 # 包自带 Skill（如 lit-review 的 review-proposer）
  resources/                      # 其他 bundled 资源（如 PDF reader / OCR）
  proposals/                      # 提议声明（0.3 落地）
    {kind}-prompt.md
    {kind}-schema.json
```

### 4.3 默认透传 + 会话粘滞（D-C）

- **默认透传**：场景 Agent 事件**绕过主 Agent**直接给 UI（Conversation 区 + RightSidePanel Artifact tab）；
- **会话粘滞**：连续两轮同一包路由**不重新匹配**主 Agent；切换意图时主 Agent 重新路由；
- **主 Agent 显式上场**：用户主动 `@主` 或意图明显偏离当前粘滞包时；
- **Speaker 标识**：UI 上每条消息附 speaker 徽标（主 Agent / 场景 Agent / 包名）。

### 4.4 注册中心

**D-3 统一注册中心**（运行时枚举）：

| Registry | 内容 | 来源区分 |
|----------|------|---------|
| **Skill registry** | 系统内置 / 用户级 / 工作区级 / 来自能力包 | `source: builtin \| user-config \| capability-pack` |
| **MCP registry** | global / 来自能力包 | 激活时挂载，停用反注册 |
| **Capability pack registry** | 用户级 `~/.asci/capabilities/`、工作区级 `capabilities.json` | 启停粒度 |
| **Subagent registry**（SDK 原生） | builtin + 来自能力包 | `snapshot()` 注入 `options.agents` |
| **ProposalDispatcher**（0.3 落地） | subscribe(trigger, packId) → fire(event) | 主进程订阅 EventBus |

**通用 API**：

- `registry.list({ kind?, source?, packId? })` 返回含 `kind / name / source / packId?` 的元数据
- `registry.snapshot()` 返回 SDK 直接消费的扁平结构（如 `snapshot.agents`、`snapshot.mcpServers`）
- **A2 闭环**：`snapshot.agents` key 集 = `registry.list({ kind: 'subagent' }).map(e => e.name)` 一致

### 4.5 能力包契约四要素 → SDK 字段映射

| 能力包 manifest 字段 | SDK 落点 | 解析时机 |
|---|---|---|
| **场景 Agent 设定** | `options.agents[scenarioAgentName]: AgentDefinition` | 包激活时 → `registry.register` |
| **Skill 引用** | 解析后注入到 `AgentDefinition.skills: string[]` | 包激活时；未注册 → 激活失败 |
| **MCP 引用** | 合并到 `options.mcpServers` | 包激活时；引用未注册 → 激活失败 |
| **UI 框架** | ❌ 不进 SDK options；进 `uiFrameworkRegistry` | renderer 侧消费 |
| **`capabilities.proposals[]`**（0.3）| ❌ 不进 SDK options；进 `proposalRouter` | 主进程订阅工作区事件 |

> 0.2 主程序内置 **1 个 UI 框架**「对话主 + 右侧产物」，能力包契约预留"UI 框架选择"字段；多 UI 框架注册 + 切换机制推迟 0.4+。

### 4.6 命名空间冲突策略

| 场景 | 行为 |
|------|------|
| builtin × user-config | builtin 优先 + log warn |
| builtin × capability-pack | builtin 优先 + log warn |
| **capability-pack × capability-pack** | **后激活的失败 + 提示冲突项** |
| capability-pack × user-config | user-config 优先 + log warn |

### 4.7 Task ↔ Agent 双名兼容（C5）

SDK 在过去版本曾把 `tool_use.name` 在 `'Task'` 与 `'Agent'` 之间切换；本项目**所有判断"子 Agent 派发 / 调用 / 事件归属"语义的位点都必须 OR 双名兼容**：

```ts
// ✅ 派发语义位点（双名 OR）
if (block.name === 'Task' || block.name === 'Agent') { ... }

// ✅ system:init / permission_denials 语义位点（only Task）
if (denial.tool_name === 'Task') { ... }
```

C5 通过判定：grep 仓库内所有 `block.name === '` / `.tool_name === '` / `tool_use.name ===` 调用点 → 处于派发语义全部双名 OR；处于 `system:init / permission_denials` 语义全部 only `"Task"`；零错配。

### 4.8 SDK env 红线（继承 CLAUDE.md §7.2）

修改 `buildSdkEnv()` 时：

1. 保留 `cleanEnv` 的 `ANTHROPIC_` 前缀过滤；
2. 保留末尾的 `ANTHROPIC_*` 空字符串覆盖循环；
3. 任何新增的 SDK 可识别环境变量必须显式进 `sdkEnv`，否则会被空字符串循环误伤。

---

<a id="5-02-能力包首发检索--综述--mock"></a>

## §5 0.2 能力包首发：检索 + 综述 + Mock

### 5.1 5 条共享设计原则

**原则 01 · 场景 Agent 是极简 planner**
每个 turn 内场景 Agent **只发生 2 次 LLM 调用**：开口（同步含意图分类 + 输出 PLAN）+ 收口（汇总）。中间 SubAgent 执行期间，场景 Agent 不被打断。**硬约束**：场景 Agent prompt 必须禁 thinking。

**原则 02 · 一次性派活，runtime（主 Agent）接管**
场景 Agent 在开口阶段**一次性输出执行计划（PLAN）**，主 Agent 按 PLAN 顺序派活 SubAgent。砍掉 1-3 次中间 LLM round-trip。

**原则 03 · deterministic 优于 Agent loop**
能写死的 pipeline 不让 LLM 临场决策。lit-search 的 3 个 SubAgent 全部是 deterministic pipeline。唯一例外：lit-review 的 synthesizer 是 Agent loop。

**原则 04 · 异步化默认，主流程不阻塞**
可以并行就并行，可后台就后台（多源检索 fan-out / relevance-scorer LLM rerank batch / reader 预热 / fact-checker 异步追 / 跨包 paper-meta 补漏）。

**原则 05 · 失败兜底优于完美**
永不让一个失败拉垮主流程（reader 单篇失败 → 降级用 abstract；fact-checker 失败 → 标 `unchecked`；跨包补漏失败 → `[待补充]` 占位）。

### 5.2 两包速览

| 维度 | lit-search · 检索包 | lit-review · 综述包 |
|---|---|---|
| 工作性质 | 检索 + 评分（出列表） | **生成长文**（出 review.md） |
| 输入 | 用户自然语言 query | **已选定的 EvidenceSet** |
| 会话拓扑 | 单 turn 完成 | **两 turn 必走断点**（先选方向再写） |
| 主笔人 | 场景 Agent（极简 dispatcher） | **synthesizer**（Agent loop） |
| 3 SubAgent | searcher · relevance-scorer · citation-explorer | synthesizer · fact-checker · reader |
| TTLT 典型 | 3-20s | 80-215s |
| LLM 调用数 | 3-5 次 | 40-95 次 |

> 两包详细 system-prompt 节选 / SDK options 字段 / JSON schema / 典型 query 走查见 [`lit-search场景 Agent 编排说明.md`](./lit-search场景%20Agent%20编排说明.md) 与 [`lit-review场景 Agent 编排说明.md`](./lit-review场景%20Agent%20编排说明.md)。本节仅写骨架，避免双权威源。

### 5.3 lit-search 工作流骨架

```
用户消息 → [场景 Agent 开口] → 意图分类三选一：
  精确查找 → 直接调 paper-search MCP
  普通检索 → searcher → relevance-scorer → ranked list
  引文追溯 → citation-explorer → ranked 引文 + 图
         ↓
[场景 Agent 收口] → emit pack.taskCompleted
```

**SubAgent 职责**：

| SubAgent | 类型 | 职责 |
|----------|------|------|
| `searcher` | deterministic | 多源检索 fan-out（arXiv / Semantic Scholar / IACR / OpenReview） |
| `relevance-scorer` | deterministic（含 LLM rerank batch） | F22 排序 + LLM 重排 |
| `citation-explorer` | deterministic | 引用 snowball + 图谱 |

**0.2 Proposal 副产物（生成端推迟 0.3）**：

| Proposal kind | 触发点 | 落地 |
|---------------|--------|------|
| `evidence-set`（候选追加） | 检索结果入库 | 0.3 落到相关 EvidenceSet 详情页 |
| `citation-relation`（新入库论文之间）| 检索结果入库 | 0.3 落到涉及 Paper 详情页 |

> 0.2 阶段：`pack.taskCompleted` 事件正常 emit，但无订阅者，Proposal 不产出。

### 5.4 lit-review 工作流骨架

**Turn 1 · 方向选择**：

```
场景 Agent 开口 → 派 review-proposer Skill（1 次 LLM）
             → 场景 Agent 收口
             → 调用 litreview.present_directions tool
             → 渲染 ChoiceCard（3 方向 + 2 特殊选项）→ 用户选
```

**Turn 2 · 综述生成**：

```
场景 Agent 开口 → 派 synthesizer（并发 outline 拆分 + reader fan-out）
             → synthesizer 流式写正文
             → 每段触发 fact-checker 异步
             → 场景 Agent 收口 → emit pack.taskCompleted
```

**SubAgent 职责**：

| SubAgent | 类型 | 职责 |
|----------|------|------|
| `synthesizer` | **Agent loop**（唯一例外）| outline 拆分 + 流式写综述正文 |
| `fact-checker` | deterministic（异步）| 每段事实核查，标 `verified / unchecked / failed` |
| `reader` | deterministic | 单篇全文阅读，fan-out 预热；失败降级 abstract |

**0.2 Proposal 副产物（生成端推迟 0.3）**：

| Proposal kind | 触发点 | 落地 |
|---------------|--------|------|
| `citation-relation`（综述段落间）| 综述生成完成 | 0.3 |
| `hypothesis-promote`（综述中识别的可证伪断言）| 综述生成完成 / 用户写 Note 含断言 | 0.3 |
| `hypothesis-review`（EvidenceSet 新增 Paper 后对挂载 hypothesis 的判断）| EvidenceSet 新增 Paper | 0.3 |

### 5.5 Mock 包（D-4 契约验收）

**目的**：用最小代价验证 A3 能力包契约 + 注册中心 + 路由 + UI 框架渲染 + 事件总线的端到端工作。

**包内容**：

```
mock-pack/
  manifest.json
  scenario/system-prompt.md       # 极简场景 Agent，走通契约即可
```

**验收红线**（liningftp 范围）：

1. 通过 A3 契约成功注册到 Capability pack registry
2. 被主 Orchestrator 路由调用（消息流 `tool_use.name ∈ {'Task','Agent'}` + `subagent_type === 'mock-x'`）
3. 在所选 UI 框架内渲染产物
4. emit `pack.taskCompleted` 事件（0.2 无订阅者，但 emit 必须发生；0.3 接 Dispatcher 零改动）

> **本节不涉及 Proposal**：Mock 包**不**调用 Proposal Repository、**不**写入 Proposal 对象。Proposal 生成端（含 Mock 走通同步写）整体推迟 0.3，由 ProposalDispatcher 负责；A3 契约中的 `capabilities.proposals[]` 字段在 manifest 中可声明，但 0.2 阶段无运行时消费方。

### 5.6 包间协作

**lit-search → lit-review 单向 handoff**：用户在 lit-search 完成检索后保存 EvidenceSet → 切到 lit-review → Turn 1 拿这个 EvidenceSet 作为输入。

**lit-review → lit-search 精确补漏**：synthesizer 单篇缺 metadata 时，调 `get_paper_meta(pmid|doi)`（cap=3，单 turn 累计 fail ≥ 2 停止补漏）。

### 5.7 失败兜底统一总集

| 失败场景 | 处理 |
|---|---|
| searcher 单源失败 | `Promise.allSettled`，不拖整体 |
| relevance-scorer LLM rerank 单 batch 失败 | 沿用 F22 排序，不阻塞输出 |
| citation-explorer snowball 部分失败 | partial 结果继续 |
| reader 单篇拉不到全文 | 降级用 abstract，标"已降级" |
| reader 整体失败 | 标"读取失败"，synthesizer 跳过 |
| fact-checker 单段 / 整体失败 | 标 `unchecked` |
| 跨包 `get_paper_meta` 失败 | 段内标 `[待补充]`；累计 fail ≥ 2 停止补漏 |
| synthesizer 中途 LLM 错 | Turn 2 失败，banner "上次未完成" |

---

<a id="6-03-能力包基础设施cp1--本地最小闭环"></a>

## §6 0.3 能力包基础设施（CP1 + 本地最小闭环）

> **本节范围**：0.3 §三-C 能力包实现层的"本地最小闭环"。**含**：manifest 格式 / 注册中心 / 本地导入启停 / 配置页骨架 / Settings 结构调整。**不含**：账户、服务器、埋点、自进化、默认页改造、Windows 签名、GDPR——这些独立由 [0.3 north-star.md](../0.3/north-star.md) §一 / §二 / §三 / §三-A / §三-D / §五 / §五-A 承担。
>
> **第三方上传 / 中心仓库 / 能力包市场**：0.3 §三-C.5 明确推迟到 0.5 / V1，本节不展开。

### 6.1 manifest 格式

```jsonc
{
  "id": "lit-search",                            // 唯一标识，kebab-case
  "name": { "en": "Literature Search", "zh": "文献检索" },
  "version": "0.2.0",
  "description": { "en": "...", "zh": "..." },
  "scenarioAgent": {
    "promptPath": "scenario/system-prompt.md",
    "agentDefinitionPath": "scenario/agent.json"  // AgentDefinition 完整字段
  },
  "subAgents": [
    { "name": "searcher", "promptPath": "sub-agents/searcher.md" },
    ...
  ],
  "skills": [                                     // Skill 引用（builtin / pack 自带）
    { "name": "review-proposer", "source": "bundled", "path": "bundled-skills/review-proposer" }
  ],
  "mcpServers": [                                 // MCP 引用
    { "name": "paper-search", "source": "bundled", "configPath": "bundled-mcp.json" }
  ],
  "uiFramework": {                                // UI 框架选择 + 渲染配置
    "framework": "conversation-with-artifact",    // 0.3 主程序唯一内置
    "config": { "artifactType": "paper-list" }
  },
  "proposals": [                                  // 0.3 落地（0.2 字段留位）
    { "kind": "evidence-set", "trigger": "search.complete", "promptPath": "proposals/evidence-set.md" }
  ]
}
```

### 6.2 注册中心（用户级 vs 工作区级）

| 层级 | 存储位置 | 启停粒度 | 用例 |
|------|---------|---------|------|
| **用户级** | `~/.asci/capabilities/{packId}/` | 用户在 Settings 启停 | 跨工作区共享的能力包 |
| **工作区级** | `{workspace}/.asci/capabilities.json` | 工作区内启停 | 特定项目需要的能力包 |

**优先级**：工作区级覆盖用户级；冲突时工作区级生效 + log warn。

### 6.3 本地导入 / 启用 / 禁用 / 卸载

| 操作 | 触发位置 | 行为 |
|------|---------|------|
| **本地导入** | 配置页 → 能力包板块 → "导入" 按钮 → 选择本地目录 | 校验 manifest → 写入 `~/.asci/capabilities/` |
| **启用** | 配置页 → 包详情 → toggle | 注册到 Capability pack registry + 注册关联 Skill / MCP |
| **禁用** | 同上 | 反注册关联 Skill / MCP；保留包文件 |
| **卸载** | 配置页 → 包详情 → "卸载" | 反注册 + 删除包目录 |

**约束**：

- 启用前必须校验所有 `skills[].source = bundled` 与 `mcpServers[].source = bundled` 资源完整；
- 启用后注册中心立即可枚举（A2 闭环）；
- 卸载不影响该包历史产出的 Paper / Note 等对象（P2 引用不复制兜底）。

### 6.4 配置页骨架（左侧 sidebar"配置"）

新建左侧 sidebar 入口"配置"（与"文献库"平级，独立路由），内含两个板块：

#### Skill 板块

- 展示**所有可用 Skill 的总览**（系统内置 / 来自能力包 / 用户自装），每条标注来源
- 单条 Skill 提供：启用 / 禁用开关、元信息（名称、版本、能力声明、来源）、"被哪些能力包使用"反向链接
- 支持按来源 / 启用状态过滤

#### 能力包板块

- 展示已安装能力包列表（含 lit-search / lit-review 两个首发包；Mock 包不进生产 UI）
- 单包详情：场景 Agent 设定预览、引用的 Skill 列表（链向 Skill 板块）、引用的 MCP 列表、UI 框架选择 + 渲染配置说明、**"产出 Proposal" 段**（列出该包通过 `capabilities.proposals[]` 声明的 Proposal kind 与触发点；0.3 启用 Dispatcher 后真实工作）、包内偏好
- 支持本地导入 / 启用 / 禁用 / 卸载

### 6.5 Settings 弹窗结构调整骨架

| Tab | 0.3 状态 | 内容 |
|-----|---------|------|
| 通用 | 保留 | UI 偏好、语言 |
| 模型 | 保留 | Provider API Key（系统层凭据，跨场景共享） |
| Zotero | 保留 | Zotero 凭据 + 可选 ASR 模型下载 |
| 代理 | 保留 | 网络配置 |
| **MCP** | **新增** | MCP 服务器列表（系统层基础设施，跨场景消费），替代旧"配置"tab |
| **数据采集** | **新增** | T3 PostHog opt-in / opt-out + AE2 自进化埋点 toggle（合规底线，UI 极简）|
| 快捷键 | 保留 | — |
| 已归档 | 保留 | — |
| 关于 | 保留 | — |

**变化**：删除旧"配置"tab——其中 MCP 服务器迁移至新独立"MCP" tab；Skill 与能力包内容下沉到左侧"配置"页；新增"数据采集"tab。

**二分原则**：

> 系统层是"调系统参数"的心智（Settings 弹窗）；Agent 生态层是"管 Agent 能力"的心智（左侧"配置"页）。两者完全独立的入口、独立的页面。

### 6.6 升级迁移

0.1 / 0.2 老用户升级到 0.3 后：

| 旧位置 | 新位置 | 迁移规则 |
|--------|--------|---------|
| Settings → "配置" tab → MCP 服务器 | Settings → MCP tab | 自动迁移 |
| Settings → "配置" tab → 能力包 / Skill | 左侧"配置"页 | 自动迁移 |
| Settings → Zotero / Provider / 代理 | 原位置 | 不动 |

**迁移完成后**：旧"配置"tab 路由 404；老用户登录后检索 / 综述 / Zotero 立即可用，无需重填。

---

<a id="7-用户旅程验证王老师-rag-综述"></a>

## §7 用户旅程验证（王老师 RAG 综述）

> **本节作用**：用一个完整故事把 5 大对象 + 9 事件 + 三决策 + 两包工作流串起来。0.2 阶段 **Proposal 相关步骤裁剪为"对象 / 事件层完成，UI 与生成链路推迟 0.3"** 标记。

**主角**：王老师，CS PhD 三年级，做 RAG 方向文献综述。

**Day 1 — 建工作区，定方向**

1. 王老师新建工作区 `rag-survey-2026`，写下意图。
2. 启动 **lit-search 检索包**，输入 `RAG long-context survey`。
3. Agent 跑多源检索回 30 篇候选；用户勾选 12 篇入库 → 12 个 **Paper** 对象 + emit 12 次 `paper.created`。
4. 检索结果入库 → emit `pack.taskCompleted`：
   - 0.2 阶段：事件 emit，**无订阅者，Proposal 不产出**。
   - ⚠️ 0.3 阶段：ProposalDispatcher 订阅 → 后台 `sdk.query()` + haiku → 产出 `evidence-set` + `citation-relation` Proposal 到详情页"待审提议"区。

**Day 2 — 读论文，写假设**

5. 王老师打开 Paper-RAG-Survey-2024 详情页。
   - 0.2 阶段：详情页**无"待审提议"区**（Proposal UI 推迟 0.3）；**无"关联 CitationRelation"列表**（CitationRelation UI 推迟 0.3）。
   - ⚠️ 0.3 阶段：可见 `citation-relation` Proposal 卡片含 reasoning + 关联 CitationRelation 列表。
6. **0.2 阶段：无法添加 CitationRelation**（V2a 手动兜底 UI 与 V2b Agent 主路径均推迟 0.3，对象 + 事件骨架就绪但无创建入口）。
   - ⚠️ 0.3 阶段：王老师可走 V2a 兜底"⋯"菜单"手动添加关系" → 选 Paper-B + type=method-ref → CitationRelation 入库 → emit `citationRelation.created` → 双向可见。
7. 王老师在 Paper-RAG-Survey-2024 旁边写一条 **Note**（kind 默认 `note`）：含断言"X 优于 Y 因为 Z" → emit `note.created`。
   - 0.2 阶段：事件 emit，**无 hypothesis-promote Proposal 产出**。
   - ⚠️ 0.3 阶段：自动产出 `hypothesis-promote` Proposal。
8. 王老师走兜底（V6c）：在 Note 编辑面板手动设 `kind=hypothesis` → `hypothesisStatus` 初始化 `unknown` → emit `note.updated`。

**Day 3 — 组织证据，跑综述**

9. 王老师走兜底（V6c 同位置）：手动新建 **EvidenceSet** "RAG-vs-LongContext"，contains: 5 篇 Paper → emit `evidenceSet.created`。
10. 把 hypothesis Note 挂载到该 EvidenceSet（编辑 Note.target）→ emit `note.updated`。
11. 启动 **lit-review 综述包**：
    - Turn 1：选择方向（ChoiceCard 渲染）
    - Turn 2：synthesizer 流式写正文；同步逐句产出 **EvidenceRef** 对象 → emit `evidenceRef.created` × N
    - 收口 emit `pack.taskCompleted`
    - 0.2 阶段：事件 emit，**无 citation-relation / hypothesis-promote Proposal 产出**。

**Day 4 — Agent 评估假设**

12. 王老师从 arXiv 检索 3 篇新论文加入 EvidenceSet → emit `evidenceSet.paperAdded` × 3。
    - 0.2 阶段：事件 emit，**无 hypothesis-review Proposal 产出**。
    - ⚠️ 0.3 阶段：自动产出 `hypothesis-review` Proposal 评估 3 篇倾向。
13. 王老师走兜底（V6c 编辑面板）：手动把 hypothesis Note 的 `hypothesisStatus` 改为 `suspended` → emit `note.updated`。

**Day 5 — 沉淀**

14. 王老师打开侧边栏"笔记"面板（V6a），按 `kind: hypothesis` 过滤（V6c），看到 5 条 hypothesis Note + 各自 `hypothesisStatus`。
15. 这条数据成为综述 Discussion 章节的核心论据来源——用户带走的是 **结构化对象库**：12 Paper + 38 EvidenceRef + 17 CitationRelation + 23 Note（含 5 hypothesis Note）+ 3 EvidenceSet。

### 7.1 0.2 阶段故事可走通的最小集

| 故事步骤 | 0.2 落地 | 0.3 升级 |
|---------|---------|---------|
| 1-4 | ✅ 完整（含 9 事件 emit；`pack.taskCompleted` 无订阅者）| Proposal 自动产出 |
| 5 | ✅ 详情页（无"待审提议"区 + 无"关联 CitationRelation"列表）| 加"待审提议"区 + Proposal 卡片 + 关联 CitationRelation 列表 UI |
| 6 | ❌ **0.2 不交付**（CitationRelation 创建路径 V2a/V2b 均推迟 0.3，对象 + 事件骨架已就绪）| 加 V2a 兜底"⋯"菜单 + V2b Agent 主路径 |
| 7 | ✅ Note 创建 + 事件 | + hypothesis-promote Proposal |
| 8 | ✅ V6c 兜底完整 | + Agent 主路径翻转 |
| 9-10 | ✅ V6c 兜底 + 事件 | + 主路径 |
| 11 | ✅ 综述完整 + 事件 | + Proposal |
| 12-13 | ✅ V6c 兜底 + 事件 | + hypothesis-review Proposal 自动回写 status |
| 14-15 | ✅ V6a/V6b/V6e 完整 | — |

**结论**：0.2 阶段王老师**可走通"对象底座 + 综述链路 + 假设登记 + 性能查询"主干**（4 大核心对象的兜底通道完整 + 9 事件就绪），仅缺少：① Agent 主动提议带来的省力体验（Proposal 生成端 0.3 落地）② 论文间逻辑关系的建立与可视（CitationRelation 创建路径 0.3 落地）。这两者共同构成"用户首次感受到 Agent 越用越合手"的 0.3 体验升级。

---

<a id="8-验收标准合表"></a>

## §8 验收标准合表

> 0.2 阶段所有 V / A / C / X 类验收标准统一在此处列出。**Owner 列**指验收落点的代码负责人；本文档**仅锁定 liningftp 负责的验收项**，其他验收由对应 owner 自行承担。
>
> 标记：✅ = 0.2 已交付；⚠️ = 0.2 字段/兜底交付，主路径推迟；❌ = 0.2 不交付；📌 = 非 liningftp 范围，本文档不再追踪进度，仅引用接口契约。

### 8.1 对象底座（V1-V6f）

| # | 标准 | 0.2 状态 | Owner |
|---|------|---------|------|
| V1 | 综述中点击引用标记 → 定位到 Paper 段落 | ✅ | fanlizhi（对象层）+ itpretty（UI）|
| V2 | Paper 对象下可见所有关联 EvidenceRef / Note / CitationRelation | 📌 EvidenceRef + Note 已落地；CitationRelation 关联列表 UI 推迟 0.3 | itpretty |
| V2a | **兜底**：详情页"⋯"菜单手动添加 CitationRelation；双向可见 | ❌ 推迟 0.3 | itpretty |
| V2b | **主路径**：综述 / 检索后 Agent 触发产出 `citation-relation` Proposal | ❌ 推迟 0.3 | fanlizhi（生成端订阅 `pack.taskCompleted`，能力包零改动）|
| V3 | 删除 Paper 后 EvidenceRef 标"源已移除" | 📌 已落地 | fanlizhi |
| V4 | Note 写入 → 自动关联当前 Paper | 📌 已落地 | fanlizhi + itpretty |
| V5 | 同 Paper 多次写 Note → 旧 Note 保留 | 📌 已落地 | fanlizhi |
| V6 | 在 EvidenceSet 中可检索关联 Note | 📌 已落地 | fanlizhi + itpretty |
| V6a | 侧边栏"笔记"入口可见，支持搜索 | 📌 已落地 | itpretty |
| V6b | 点击笔记跳转到关联 Paper / EvidenceSet | 📌 已落地 | itpretty |
| V6c | **兜底**：Note 创建 / 编辑可手动设 kind；侧边栏支持按 kind 过滤 | 📌 已落地 | itpretty |
| V6c' | **主路径**：用户写 Note 含断言 / 综述完成 → Agent 产出 `hypothesis-promote` Proposal | ❌ 推迟 0.3 | fanlizhi（生成端订阅 `note.created` / `pack.taskCompleted`，能力包零改动）|
| V6d | **主路径**：EvidenceSet 新增 Paper → Agent 产出 `hypothesis-review` Proposal；采纳后回写 `hypothesisStatus` | ❌ 推迟 0.3 | fanlizhi（生成端订阅 `evidenceSet.paperAdded`，能力包零改动）|
| V6e | 100+ Note 时按 Paper 反查响应时间与总量无关 | 📌 已落地（性能要求落 ADR-001 拍板的存储后端实现）| fanlizhi |
| V6f | Proposal 持久化 + dismissPolicy 三档生效 | 📌 字段 + 存储 + 状态翻转 API 已落地；UI 决策按钮推迟 0.3 | fanlizhi（持久层）+ itpretty（UI）|

### 8.2 开放标准（O1-O3）+ 设计约束（D1-D3）

| # | 标准 | 0.2 状态 |
|---|------|----------|
| O1 | 5 个核心对象 JSON Schema 独立文档外部可访问 | ✅ |
| O2 | Schema 与 UI / 存储解耦，零内部字段泄漏 | ✅ |
| O3 | 至少 1 个示范导出可通过 `ajv` 校验 | ✅ |
| D1-D3 | 稳定序列化 + ID 引用不嵌套 + 参数化查询 | ✅ |

### 8.3 Agent 拓展性（A0-A4 + C5）

| # | 标准 | 0.2 状态 |
|---|------|----------|
| A0 | 唯一 Orchestrator 入口 + Master 不直接干活 + SDK 标准注册 + mock 子 Agent 零改 Orchestrator | ✅ |
| A0a | SubagentStart / SubagentStop Hook 接通 | ✅ |
| A0b / C5 | Task ↔ Agent 双名兼容；派发位点双名 OR、`system:init`/`permission_denials` only `Task` | ✅ |
| A1 | Agent 调用层单一 entrypoint；mock Provider 适配器零改 entrypoint | ✅ |
| A2 | 工具 / Skill / MCP / 子 Agent 走统一 Registry；`list()` 含 `kind / name / source / packId?`；snapshot 一致；命名空间冲突机制生效 | ✅ |
| A3 | 能力包契约四要素（场景 Agent / Skill / MCP / UI 框架）+ `capabilities.proposals[]` 字段（manifest 可声明，0.2 无运行时消费方）；至少 1 个 mock 能力包通过契约**注册 / 调用 / UI 渲染 / emit `pack.taskCompleted`** | ✅（A3 验收**不**含 Proposal 写入；Proposal 端到端推迟 0.3）|
| A4 | 事件透传 + speaker 标识 + 会话粘滞；mock 包派发后场景 Agent 名字可见；连续两轮同包不重路由；切换意图重新路由 | ✅ |

### 8.4 概念层（X1-X4）

| # | 标准 | 0.2 状态 |
|---|------|----------|
| X1 | 5 名目标用户访谈 + 能力包候选清单（≥3 类）+ 范式验证 / 推翻判断 | ✅ |
| X1.1 | 访谈含"Agent 主动提议接受度"验证（三类 Proposal 各 1 张样例 + 1-5 评分；≥ 50% 给 ≤ 2 分触发 §零 主路径降档评估）| ✅ |
| X1.2 | 访谈含"Skill / 能力包二分心智识别度"验证（30 秒内区分系统底座 vs Agent 生态；正确率 < 60% 触发 0.3 CP5 强制约束降级评估）| ✅ |
| X2 | 能力包概念 Spec（命名 / 粒度 / 四要素 / 副产品 / 依赖 / 安装-卸载语义）| ✅ |
| X3 | UI 概念稿（独立"配置"页 + 任务下达衔接 + "待审提议"区 UI 范式 + Proposal 决策走查）| ✅（含至少 1 次 `scoped` 拒绝走查）|
| X4 | 迁移方案（旧 Settings 配置 → 0.3 目标位置映射；老用户升级不丢配置）| ✅ |

### 8.5 0.3 能力包基础设施（CP1 本地最小闭环子集）

> 本子集仅含本文档涵盖范围。0.3 CP2-CP5 与账户 / 服务器 / 埋点 / 默认页等由 [0.3 north-star.md](../0.3/north-star.md) 独立承担。

| # | 标准 | 0.3 状态 |
|---|------|----------|
| CP1-a | lit-search 通过 A3 契约接入 Capability pack registry | 必做 |
| CP1-b | lit-review 通过 A3 契约接入 Capability pack registry | 必做 |
| CP1-c | manifest 格式 + 用户级 / 工作区级注册中心可工作 | 必做 |
| CP1-d | 本地导入 / 启用 / 禁用 / 卸载 happy path 可走通；命名空间冲突按 §4.6 行为生效 | 必做 |
| CP1-e | Settings 9 tab 调整完成（新增 MCP + 数据采集；删除旧"配置" tab；其余原状） | 必做 |
| CP1-f | 左侧"配置"页 Skill / 能力包两板块按 §6.4 落地 | 必做 |
| CP1-g | 0.1 / 0.2 老用户升级自动迁移（MCP / 能力包 / Skill 各到位，Zotero / Provider / 代理不动） | 必做 |

---

<a id="9-02--03-排除项明细"></a>

## §9 0.2 / 0.3 排除项明细

### 9.1 0.2 排除（liningftp 不参与；列出仅为接口对齐）

**Proposal 生成端**（fanlizhi / itpretty 范围，0.3 落地，liningftp 仅在综述包 / 检索包侧接 trigger）：

- ❌ ProposalDispatcher 订阅注册
- ❌ 后台异步子进程（独立 `sdk.query()` + haiku + json_schema）
- ❌ Paper / EvidenceSet / hypothesis Note 详情页"待审提议"区 UI
- ❌ RightSidePanel Proposal tab
- ❌ 五档决策动作按钮 UI（采纳 / 修改 / 拒绝 / scoped / silence-this-kind）
- ❌ Proposal 自动产出（V2b / V6c' / V6d 的 Agent 主路径自动产出）
- ❌ V6d 自动回写 `hypothesisStatus`

**CitationRelation 创建路径 + UI**（itpretty 范围，0.3 落地）：

- ❌ V2a 详情页"⋯"菜单"手动添加关系" UI
- ❌ V2b Agent 触发式产出 `citation-relation` Proposal（含 Proposal 生成端，0.3 落地）
- ❌ Paper 详情页"关联 CitationRelation"列表展示 UI
- ❌ 删除 Paper 后 CitationRelation 标"源已移除"的级联标记

**liningftp 在 0.2 阶段对上述项的硬约束**：

- 不主动新增 / 修改 Proposal / CitationRelation 相关代码（除非接口对齐时必要）
- 综述包 / 检索包 pipeline 不依赖 Proposal Repository / CitationRelation Repository 写入
- Mock 包验收红线不含 Proposal 写入（已从 §5.5 / §8.3 A3 删除）

**0.3 范围的项（仅作 0.3 north-star 单一权威，本文不重复）**：

- ❌ 账户体系（U1-U5）
- ❌ 服务器（S1-S5）
- ❌ 数据埋点（T1-T4a）
- ❌ Agent 自进化埋点（AE1-AE5）
- ❌ 默认页改造（推迟 0.4）
- ❌ 公开发布运维 SOP（推迟 0.4 / V1）
- ❌ 法律文本与发布前置事务（LT0-LT3）
- ❌ 安全机制（TLS / JWT / Rate Limiting 等服务端 / 网络层）
- ❌ 数据所有权叙事 UI（DO1-DO4）—— O1-O3 开放标准已在 0.2 完成
- ❌ 用户激活路径 AC1-AC3

### 9.2 0.3 能力包排除（本文档仅含 CP1 + 本地最小闭环）

- ❌ 第三方能力包对外扩展点（推迟 0.5 / V1）
- ❌ 能力包市场 / 远程发现 / 中心仓库（推迟 0.5 / V1）
- ❌ 能力包版本管理 / 自动升级（随主程序版本走）
- ❌ 能力包间依赖解析（首发 2 包无相互依赖）
- ❌ Skill 用户自装 / 第三方 Skill 来源（0.3 Skill 仅"系统内置"和"来自能力包"两类）
- ❌ UI 框架库扩展（0.3 主程序仅内置「对话主 + 右侧产物」1 个，多 UI 框架注册 + 切换机制推迟 0.4+）
- ❌ Proposal 决策信号回流自进化埋点（在 0.3 自进化埋点 AE2 单独承担）
- ❌ 精读包（PDF reader + OCR + highlight）—— 0.2 D-A 容器已预留骨架，作为 0.3 CP1 之外的候选

### 9.3 V1+ 远期排除

- ❌ MCP Server / A2A 服务对外暴露（仅在 D1-D3 设计层预留扩展性）
- ❌ 完整的多 Agent 协同编排（V1）
- ❌ 插件市场 / 开发者文档（V2）
- ❌ Web 版本 / 桌面 ↔ Web 同步
- ❌ OPENSCI OAuth 绑定（仅预留字段）

---

<a id="附录-a-来源文档谱系状态"></a>

## 附录 A 来源文档谱系状态

| 来源文件 | 类型 | 状态 | 处置 |
|---------|------|------|------|
| [`north-star.md`](./north-star.md) | 权威源 | 本文档前的"唯一权威" | 本文吸收§零 / §一-B / §三-3 / §三-4；对象细节让位于 fanlizhi PR #284/#308 的已落地代码 |
| [`north-star-patch.md`](./north-star-patch.md) | §三-3 拟替换 | 待并入 north-star 正文 | 本文吸收 A0-A4 + C5（liningftp 范围）|
| [`paper-semantics.md`](./paper-semantics.md) | 对象语义草稿 | 未提交 git | 本文 §1.4 引用为参考；接口契约 §1.2 锁定字段 / 不变量；详细推导留草稿 |
| [`evidence-ref-semantics.md`](./evidence-ref-semantics.md) | 对象语义草稿 | 未提交 git | 同上 |
| [`evidence-set-semantics.md`](./evidence-set-semantics.md) | 对象语义草稿 | 未提交 git | 同上 |
| [`note-semantics.md`](./note-semantics.md) | 对象语义草稿 | 未提交 git | 同上 |
| [`citation-relation-semantics.md`](./citation-relation-semantics.md) | 对象语义草稿 | 未提交 git | 同上 |
| [`2026-05-22-pack-orchestration-overview.md`](./2026-05-22-pack-orchestration-overview.md) | 能力包编排 | 已提交 | 本文 §5.1-5.6 吸收骨架；详细 prompt / schema 留原文不动 |
| [`sdk-orchestrator-subagents-spec.md`](./sdk-orchestrator-subagents-spec.md) | SDK 范式 | 已提交 | 本文 §4.1-4.5 吸收要点；详细 SDK 字段 / AgentDefinition 字段表留原文 |
| [`subagents-more.md`](./subagents-more.md) | SDK 映射 | 已提交 | 本文 §4.5-4.7 吸收映射表 + 命名空间策略 + 审计锚点 |
| [`architecture-audit-2026-05-21.md`](./architecture-audit-2026-05-21.md) | 审计报告 | 已提交 | 本文不重复 F1-G5 修复细节；仅引用其"D-A/B/C 三决策已落地"结论 |
| [`lit-search场景 Agent 编排说明.md`](./lit-search场景%20Agent%20编排说明.md) | 详释附件 | 已提交 | 本文 §5.3 仅写骨架；详细 system prompt / SDK options / 典型 query 走查保留为详释 |
| [`lit-review场景 Agent 编排说明.md`](./lit-review场景%20Agent%20编排说明.md) | 详释附件 | 已提交 | 本文 §5.4 仅写骨架；详细同上 |
| [`../0.3/north-star.md`](../0.3/north-star.md) | 0.3 权威源 | 已提交 | 本文 §6 吸收 §三-C 能力包实现层（CP1 + 本地最小闭环）；其余章节（账户 / 服务器 / 埋点 / 默认页等）仍以 0.3 north-star 为唯一权威 |
| `moat-analysis.md` / `milestone-review.md` / `issue-{170,263,266}-*-reply-draft.md` | 战略 / 评审 / 设计辩护 | 已提交 | **不进本文**，保留为存档背景 |

---

**版本注记**：本文档为 2026-05-23 首版。任何后续调整（含范围调整、验收标准修订、能力包首发清单变更）以本文档为修订基准，不再回头改 north-star / patch / semantics 草稿。

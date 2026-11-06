# Architecture Decision Records (ADR)

本目录收录 ASCI 的架构决策记录（Architecture Decision Records）。

## 什么是 ADR

ADR 是一份记录"为什么这样做"的轻量文档。每个 ADR 描述一个具体的架构决策、其背景、被考虑的候选方案，以及最终选择的理由。

**ADR 不是调研文档**——必须含调研 + 评审 + 拍板人 + 决策记录。结论一旦签字即为实施依据；变更需走 ADR 修订流程（新建 ADR 或将原 ADR 标记为 Superseded）。

## 状态约定

- **Proposed**：方案提出，调研进行中或评审中
- **Accepted**：决策已签字，开始实施
- **Deprecated**：决策已弃用但未被新决策替代
- **Superseded by ADR-XXX**：已被新决策取代

## 索引

| # | 标题 | 状态 | 决策时点硬约束 |
|---|------|------|---------------|
| [ADR-000](./ADR-000-common-convention.md) | 协作规范（分支 / commit / PR） | Accepted | 无 |
| [ADR-001](./ADR-001-local-storage.md) | 本地存储后端选型 | Proposed | 0.2 V6e issue 开出前 |
| [ADR-002](./ADR-002-server-stack.md) | 服务器后端栈选型 | Proposed | 0.3 启动前（0.2 Week 1 末） |
| [ADR-003](./ADR-003-ui-design-system-layering.md) | UI 设计系统分层 | Proposed (Draft) | `docs/design.md` 落笔前、ESLint 调色板色拦截前 |
| [ADR-004](./ADR-004-left-nav-notes-entry.md) | LeftSidebar "笔记" 入口 | Accepted (2026-05-18, lexa) | 0.2 V6a 实现 issue 开出前 |
| [ADR-005](./ADR-005-opensci-identity-provider.md) | OPENSCI 作为唯一身份提供方 | Proposed | 0.3 账户 epic 实现 issue 开出前 |
| [ADR-006](./ADR-006-ui-framework-extension-boundary.md) | UI 框架库扩展边界（右侧 renderer 可注册） | Proposed | 0.4 P1 UI 框架库实现 issue 开出前 |
| [ADR-007](./ADR-007-evidence-set-topic-container.md) | 证据集 → 多归属主题容器（M:N） | Proposed | 0.4 P2 数据模型重构 issue 开出前 |
| [ADR-008](./ADR-008-supervisor-autonomous-orchestration.md) | 总控 → Supervisor 自主编排多包 | Proposed | 0.4 P3 Supervisor/默认页实现 issue 开出前 |
| [ADR-009](./ADR-009-o1-schema-generation.md) | O1 对象标准 schema 从 TS interface 生成（拒绝 zod 双源 / 手写） | Proposed | schema 发布即对外契约（#419 / #243） |
| [ADR-010](./ADR-010-evidence-driven-scoring-agent.md) | F22 五维 → 证据驱动相关性主导评分（score），与 F22 耦合并行 | Accepted (2026-06-04, lee) | 检索面板排序切到 score 前（已落地） |
| [ADR-011](./ADR-011-telemetry-architecture.md) | 遥测埋点架构（三层 / 主进程汇集 / 时区地域判定 / EU 驻留） | Accepted (2026-06-02) | 0.3 埋点 epic（#416/#426/#427）实现前 |
| [ADR-012](./ADR-012-local-embedding-vector-index.md) | 文献向量索引用本地 ONNX 嵌入 | Accepted (2026-06-02, alan) | `feat/vector-store-evidence` 实现落地前 |
| [ADR-013](./ADR-013-literature-relevance-service.md) | 文献检索数据服务（部分自建分层）| Proposed | 0.5 文献数据服务实现 issue 开出前；扩展 ADR-002 |
| [ADR-014](./ADR-014-non-api-sources-and-demand-driven-fill.md) | 无 API 源接入 + 需求驱动语料填充 | Proposed | 0.5 文献数据服务实现 issue 开出前；扩展 ADR-013 |

## 命名约定

`ADR-XXX-<short-kebab-slug>.md`，XXX 为三位数字编号，技术决策从 001 开始递增。

`ADR-000` 为「元 ADR」，约束协作流程（分支 / commit / PR），独立于任何具体技术决策；其位置永远在索引最上方。

## 编写模板

每份 ADR 应包含以下章节：

1. **元信息**：状态、日期、拍板人、作者、关联文档
2. **背景**：决策的起因、问题描述、约束条件、决策时点
3. **决策维度 / 粒度**：要评估的关键问题
4. **候选方案**：每个候选的优缺点、各维度评估
5. **已排除方案**（可选）：明确排除的方案及原因
6. **决策**：拍板结论 + 主要理由
7. **后果**：正向 / 负向后果、风险、后续动作

## 与 milestone 文档的关系

- [`ya-docs/milestones/0.2/north-star.md`](../../ya-docs/milestones/0.2/north-star.md) §六 F1 / F3 描述本目录下 ADR-001 / ADR-002 的决策时点硬约束与覆盖维度
- [`ya-docs/milestones/0.3/north-star.md`](../../ya-docs/milestones/0.3/north-star.md) §二 引用 ADR-002 作为服务器实施依据

# CitationRelation 废弃移除 —— 导出契约 + 死代码清理

> **状态**：已实现 · 待 PR review
> **关联 issue**：#718（CitationRelation 在导出契约中存在但无 UI 落库路径，导出永远是空数组）
> **关联 PR**：#814
> **领域语言事实源**：`CONTEXT.md` §数据所有权；`docs/specs/data-export-do2-spec.md`

## 1. 背景与决策

Issue #718 定位的根因：CitationRelation 三连（schema 声明 + 导出读取 + UI 写入路径）
断了写入这一环 —— `citation_relations` 表永远为空，DO-2 导出的
`citation-relations.json` 永远是 `[]`，数据契约"假兑现"。

产品决策（0.4 迭代）：**废弃 CitationRelation 功能**，走 issue 建议的
"从契约中移除"方向；因是废弃而非暂留，同时清理无生产调用方的死代码。
git 历史保留全部实现，功能若回归可找回。

## 2. 移除范围

### 2.1 导出契约（DO-2，issue 核心）

- `export-service.ts`：`EXPORT_TARGETS` 6 → 5（去掉 `citation-relations.json`
  条目及 schema / repository import）。zip 内不再有 `citation-relations.json`
  与 `schema/objects/citation-relation.schema.json`
- `exportFormatVersion` 保持 `1`：manifest `files` 数组数据驱动，导入方按
  清单解析，少一类文件不是结构性变化；`manifest.schema.json` 无按类型
  enum，无需改动

### 2.2 类型与事件（`@asci/shared`）

- 删 `types/objects/citation-relation.ts`（`CitationRelation` /
  `CitationRelationType`）及 barrel re-export
- `ObjectKind` 联合移除 `'citation-relation'` 字面量
- `workspace-events.ts` 移除 `citationRelation.created`（查证无任何订阅方，
  仅 repository 自身 emit）

### 2.3 主进程数据层

- 删 `repositories/citation-relation-repository.ts`（`createCitationRelation`
  无生产调用方，正是 #718 根因）
- 删 `query-service.ts` 的 `queryCitationRelationsByPaper`（仅测试调用，
  无 IPC handler / renderer 消费）
- 删 `internal/mappers.ts` 的 `CitationRelationRow` / `citationRelationFromRow`

### 2.4 schema 生成

- `scripts/generate-object-schemas.ts` 移除 `CitationRelation` 生成项，
  删 `schema/objects/citation-relation.schema.json`，重跑生成器
- `proposal.schema.json` 会因 `ObjectKind` 收窄产生联动 diff（正常，
  由 `generate-object-schemas.test.ts` 守门）

### 2.5 注释 / 文案

- 清理 `ItemDetailPanel.tsx` / `session-evidence-atoms.ts` 的过期注释
  （issue 提到的 session-only mockup UI 已不存在，仅剩注释）
- review-demo 演示 legend 文案（en/zh `library/core.json`）去掉对已删
  类型名的引用（key 不增减，不涉 key-parity）
- `docs/agents/architecture.md` 事件表移除 `citationRelation.created` 行

## 3. 明确不动的范围

| 范围 | 理由 |
|------|------|
| `citation_relations` 表（`001-initial.sql`） | 已发布迁移不可改；删表需新增 DROP migration，空表无害。`object-store.test.ts` 针对该表 DDL 的裸 SQL 测试随表保留 |
| Proposal 的 `kind: 'citation-relation'`（`ProposalKind` / proposal.schema.json 枚举 / capability-pack zod / proposals 表 CHECK 约束） | Proposal 功能 0.3 已整体移出，schema 仅文档化保留；动它牵连 capability-pack 契约与 DB CHECK，应另案 |
| citation-graph 全家（可视化） | 瞬态可视化功能，与持久化 CitationRelation 对象无关，正常在用 |
| 历史文档（north-star / milestone-review / ADR / 0.3.0 PRD） | 历史记录不改写；仅 `data-export-do2-spec.md` 追加移除说明 |

## 4. 验收

1. `bun run typecheck` + `bun test` 通过（含 schema 生成守门测试）
2. 手动：设置 → 导出我的数据 → zip 内 5 类数据文件 + manifest 无
   citation-relations 条目，ajv 复验通过
3. 全仓 `CitationRelation` 精确检索仅剩：历史文档（docs/milestones、ADR、
   0.3.0 PRD）、Proposal kind 枚举、`citation_relations` DDL 及其裸 SQL 测试、
   以及本次改动留下的废弃说明注释（tombstone，如 workspace-events.ts /
   export-service.ts / types/index.ts 头注释）

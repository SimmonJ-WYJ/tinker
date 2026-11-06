# ADR-009：O1 对象标准 schema 从 TS interface 生成（拒绝 zod 双源 / 手写）

| 字段 | 内容 |
|------|------|
| **状态** | Proposed（grill 会话 2026-06-02 裁决；随 #419 PR review 转 Accepted）|
| **决策日期** | 2026-06-02 |
| **决策时点硬约束** | schema 一经发布即成对外契约（#243 文档化 + 导出包内嵌副本），发布后翻转生成策略 = breaking change 流程 |
| **关联** | issue #419（DO-2 导出）· #243（O1 文档化）· #214（A-1 推迟决策来源）· [data-export-do2-spec.md](../specs/data-export-do2-spec.md) · [CONTEXT.md 数据所有权领域](../../CONTEXT.md) |

---

## 一、背景

0.2 §对象标准开放（O1/O2/O3）要求把核心对象格式做成 BibTeX / Zotero CSL 生态位的开放标准。
#214（A-1）交付了 TS 类型本体，但显式推迟了 `schema/objects/*.schema.json`——当时唯一 consumer
是 TS 类型自身，hand-written 双源是纯负担（决策记录在 `packages/shared/src/types/objects/index.ts` 头注释）。

0.3 Epic 4 DO-2（#419）引入了第一个真实 consumer：导出包须经 ajv 对 O1 schema 校验。复评条件触发，
schema 本体必须落地，生成策略需要定型。

## 二、候选方案

| | A：`ts-json-schema-generator` 生成（**选中**） | B：interface 改写为 zod | C：手写 schema |
|---|---|---|---|
| 真相源 | TS 类型唯一真相源，schema 是派生物 | zod schema 成为真相源，TS 类型反推 | 双源（TS + JSON Schema 各自维护） |
| `@asci/shared` 运行时依赖 | 零（生成器是 root devDependency） | ❌ 引入 zod 运行时依赖，违反零依赖原则 | 零 |
| 漂移风险 | drift 守门测试拦截（重新生成 ≡ 已提交） | 无漂移（同源） | ❌ 靠人肉同步，必然漂移 |
| 迁移成本 | 零（类型不动） | 7 个对象全量改写 + 全仓库 import 波及 | 零 |

## 三、决策

**选 A**：`scripts/generate-object-schemas.ts` 用 `ts-json-schema-generator` 从
`packages/shared/src/types/objects/` 生成 `schema/objects/*.schema.json`（tracked），
配 drift 守门测试保证 TS ↔ schema 不漂移。

要点：

1. TS 类型保持唯一真相源；schema 是构建产物但**入库 tracked**（外部开发者无需跑生成器即可消费）。
2. branded type（`ObjectId`）在生成后处理中降级为 `{"type":"string"}`——brand 是 TS 编译期防误用手段，不属于对外契约。
3. **语言中立**：生成器 `jsDoc: 'none'`，schema **不输出任何 `description`**，只承载结构。
   字段语义文档以 TS interface 的中文注释（IDE 内可见、满足 CLAUDE.md「注释用中文」硬规则）为准；
   对外开放契约保持语言中立，既避免中文混入对外标准，也无需双语维护。drift 测试加 `not.toContain('"description"')` 守门。
4. 拒绝 zod 的核心理由不是工具优劣，而是 `@asci/shared` 零运行时依赖原则（运行时校验需求由消费侧 ajv 满足）。
5. 未来若出现"运行时校验必须与类型同源"的强需求（如 IPC 边界全面校验），可重开本决策——届时迁移成本已记录在案。

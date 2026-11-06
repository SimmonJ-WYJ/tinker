/**
 * 0.2 北极星核心对象 barrel
 *
 * 6 个对象 + 共享原语；通过 `@asci/shared` 顶层 re-export。
 * 参见 docs/milestones/0.2/north-star.md §一。
 *
 * --- 关于"对外发布 JSON Schema" ---
 *
 * issue #214 §范围 原定还要交付仓库根 `schema/objects/` 下 6 份独立
 * `*.schema.json`，目的是把对象格式做成 BibTeX 那样的开放标准
 * （见 docs/milestones/0.2/moat-analysis.md §4.3 🥇 P0 +
 *   docs/milestones/0.2/north-star.md §对象标准开放 O1/O2/O3）。
 *
 * 当前阶段（0.2）唯一的 schema consumer 是这层 TS 类型本身，TS 是
 * 比 JSON Schema 更强的描述，hand-written 双源等于纯负担。决定推迟
 * 到真正出现跨语言 consumer（如 0.3 §三-C 的 Python 能力包 / 外部
 * 集成方）时再生成。
 *
 * 未来生成路径（不必现在写）：
 * - 选项 A：`ts-json-schema-generator` 从本目录 TS interface 一次性
 *           导出，保持 TS 为唯一真相源
 * - 选项 B：把 interface 改用 `zod` 写，运行时校验 + JSON Schema
 *           导出二合一（代价：给 @asci/shared 加 zod 运行时依赖，
 *           违反"零运行时依赖"原则，需另起讨论）
 *
 * 复评条件：0.3 引入能力包契约 / 外部集成需求落地、或 moat-analysis
 *           §4.3 P0 战略被显式确认仍为护城河 → 重新启用 schema/ 目录。
 */

export * from './common.ts'
export * from './paper.ts'
export * from './evidence-ref.ts'
export * from './note.ts'
export * from './evidence-set.ts'
export * from './proposal.ts'
export * from './review.ts'

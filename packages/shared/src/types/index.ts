/**
 * Shared type definitions for asci
 */

// Placeholder types - will be expanded as needed
export interface Workspace {
  id: string
  name: string
  path: string
}

// 运行时相关类型
export * from './runtime'

// 渠道（AI 供应商）相关类型
export * from './channel'

// 代理配置相关类型
export * from './proxy'

// 附件相关类型（供 Agent、attachment-service、core 等模块复用）
export * from './attachment'

// 通用 LLM 消息类型（供 @asci/core 的 Provider 适配器使用）
export * from './llm-message'

// Agent 相关类型
export * from './agent'

// Agent Provider 适配器接口
export * from './agent-provider'

// GitHub Release 相关类型
export * from './github'

// Zotero 集成相关类型与 IPC 通道常量
export * from './zotero.ts'

// Zotero 文献向量索引（语义检索）相关类型
export * from './zotero-embedding.ts'

// 引用图谱相关类型与 IPC 通道常量
export * from './citation-graph'

// 媒体识别缓存相关类型
export * from './media.ts'

// RuntimeProvisioner 校验状态类型与 IPC 通道常量
export * from './runtime-provisioner.ts'

// Paper Search MCP 集成相关类型与 IPC 通道常量
export * from './paper-search.ts'

// Anchor —— 跨对象的"定位 + 原文快照"值对象（EvidenceRef.source/target.anchor 等使用）
export * from './anchor.ts'

// ResearchGap —— 研究空白对照表数据模型（0.4 Epic 1）
export * from './research-gap.ts'

// 0.2 北极星核心对象（Paper / EvidenceRef / Note / EvidenceSet / Proposal；CitationRelation 0.4 废弃 #718）
export * from './objects/index.ts'
// Notes IPC 通道与类型（C-1 V4/V5）
export * from './notes.ts'
// EvidenceSets 聚合查询 IPC（详情页一次拿全 set + note + refs + papers）
export * from './evidence-sets.ts'
// OutputFeedback IPC（助手输出 👍/👎 直观反馈采集，issue #477）
export * from './output-feedback.ts'
// Reviews 辅助反查 IPC（body_path → reviewId）
export * from './reviews.ts'
// Papers 反查 IPC（评论引文 → Library 联动）
export * from './papers-ipc.ts'

// 能力包管理 IPC（0.3 §三-C / spec §6 配置页 → 能力包板块）
export * from './capability-pack-ipc.ts'

// lit-review present_directions IPC（spec §5.4 Turn 1）
export * from './litreview-ipc.ts'

// lit-search present_search_plan 检索方案确认 IPC（issue #435）
export * from './search-plan-ipc.ts'

// 工作区事件总线 9 事件类型（spec §3）
export * from './workspace-events.ts'

// 数据导出 DO-2（issue #419）：IPC 通道 + 导出包清单类型
export * from './data-export.ts'

// 证据驱动评分 v2 类型契约（extra.score；docs/specs/lit-scoring-agent-spec.md）
export * from './paper-scoring.ts'

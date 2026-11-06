/**
 * research-gap in-process SDK MCP server（0.4 Epic 1：把对照表产出推回右侧 Tab）
 *
 * 与 litreview-sdk-mcp 对称，但更简单：present_research_gap_table 是 **fire-and-forget**
 * ——Agent 把组装好的对照表（列 / 行 / 格 / 空白 / 冲突）传进来，handler 通过 eventBus
 * 把表推给 renderer 渲染，立即返回成功（不阻塞等用户）。列的增删改由用户在表格视图里做。
 *
 * 工具名暴露给 LLM：`mcp__researchgap__present_research_gap_table`
 *
 * ⚠️ 抽取/分析质量由 column-proposer / cell-extractor / gap-analyzer 三个子 Agent 的 prompt
 * 决定，需用真实论文 + BYOK 跑通后迭代（spec §7 spike）。本工具只负责"把结构化结果送达 UI"。
 */
import { randomUUID } from 'node:crypto'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ResearchGapTable } from '@asci/shared'

/** 溯源锚点（最小：类型 + 原文快照；结构化定位可选，首版省略） */
const anchorSchema = z.object({
  type: z.enum(['html', 'md', 'pdf', 'conversation']).default('pdf'),
  snapshotText: z.string().min(1).describe('被引用的原文 verbatim 片段（溯源用，必填）'),
})

const cellSchema = z.object({
  value: z.string().nullable().describe('该篇在该维度的取值；null = 该篇未涉及此维度（斜纹空格）'),
  source: z
    .object({
      label: z.string().describe('出处展示标签，如 "Wang 2023 · §4.1"'),
      anchor: anchorSchema,
    })
    .optional()
    .describe('填了的格子必须带溯源；空格（value=null）无'),
})

/** present_research_gap_table 输入 schema —— LLM 按此结构传整张表 */
const presentTableInputSchema = {
  title: z
    .string()
    .min(1)
    .max(40)
    .describe(
      'A SHORT distinct title (a few words) naming THIS analysis by its comparison theme, in the user\'s language — e.g. "大模型蛋白结构预测对比" or "Few-shot ViT pretraining". Shown as the right-side tab title and the in-conversation result card; each analysis gets its own so the user can run research-gap over different paper sets and tell them apart. Do NOT include "研究空白 / research gap" boilerplate — just the topic.',
    ),
  scopeLabel: z.string().min(1).describe('范围披露文案，如 "基于你选的 18 篇文献"。严禁出现"全领域/全世界/没人做过"。'),
  columns: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        origin: z.enum(['ai', 'user']).default('ai'),
      }),
    )
    .min(1)
    .describe('AI 提议的可比维度（4–6 个最佳，越聚焦组合空白越有意义）'),
  rows: z
    .array(
      z.object({
        paperId: z.string().min(1),
        paperLabel: z.string().min(1).describe('行头，如 "Wang 2023"'),
        cells: z.record(z.string(), cellSchema).describe('key = 对应 column.id'),
      }),
    )
    .min(1)
    .describe('每篇论文一行'),
  gaps: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        rationale: z.string().min(1),
        supportingPaperIds: z.array(z.string()).default([]),
        involvedColumnIds: z.array(z.string()).default([]),
      }),
    )
    .default([])
    .describe('组合空白：这组论文里没出现的取值组合，每条带依据；不主张"全世界没人做过"'),
  conflicts: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        rationale: z.string().min(1),
        paperIds: z.array(z.string()).default([]),
        involvedColumnIds: z.array(z.string()).default([]),
      }),
    )
    .default([])
    .describe('结论冲突：跨论文在相近设置下结论相反处'),
}

/**
 * 为指定 agent session 创建 research-gap SDK MCP server 实例。
 *
 * @param sessionId 当前 agent session ID
 * @param sendToRenderer 把组装好的对照表推给 renderer 的回调（eventBus.emit 包装）
 */
export function createResearchGapSdkMcpServer(
  sessionId: string,
  sendToRenderer: (table: ResearchGapTable) => void,
): ReturnType<typeof createSdkMcpServer> {
  const presentTableTool = tool(
    'present_research_gap_table',
    'Present the assembled research-gap comparison table to the user (paper × dimension), plus AI-flagged combination gaps and conclusion conflicts. Call this ONCE when the table is fully assembled. It renders in the right-side "Research gap" tab and returns immediately (the user edits columns there). Scope is STRICTLY the selected papers — never claim "no one in the world has done this" and never output a "this is novel / worth doing" verdict.',
    presentTableInputSchema,
    async (args, _extra) => {
      const table: ResearchGapTable = {
        id: randomUUID(),
        title: args.title,
        sourceSelection: { kind: 'papers', paperIds: args.rows.map((r) => r.paperId) },
        scopeLabel: args.scopeLabel,
        columns: args.columns,
        rows: args.rows,
        gaps: args.gaps,
        conflicts: args.conflicts,
      }
      sendToRenderer(table)
      // 返回 tableId / title / 计数 —— 对话内结果卡片（research-gap-result renderer）按此渲染并点击唤起右栏 Tab
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              ok: true,
              tableId: table.id,
              title: table.title,
              rendered: { columns: table.columns.length, rows: table.rows.length, gaps: table.gaps.length, conflicts: table.conflicts.length },
            }),
          },
        ],
      }
    },
  )

  return createSdkMcpServer({
    name: 'researchgap',
    version: '0.1.0',
    tools: [presentTableTool],
  })
}

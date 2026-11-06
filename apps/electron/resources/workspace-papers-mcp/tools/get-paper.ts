/**
 * workspace_papers_get: 按 key 返回单条完整论文条目（含用户笔记）
 */

import { readPapersJsonl, type WorkspacePaperEntry } from './shared.ts'

export interface GetArgs {
  key: string
}

export async function handleGet(args: GetArgs): Promise<WorkspacePaperEntry | { notFound: true; key: string }> {
  if (!args.key || typeof args.key !== 'string') {
    throw new Error('参数 key 必填，且必须为字符串')
  }
  const all = readPapersJsonl()
  const found = all.find((e) => e.key === args.key)
  if (!found) return { notFound: true, key: args.key }
  return found
}

export const getToolDefinition = {
  name: 'workspace_papers_get',
  description: '按 key 取单条论文完整条目，包含用户笔记、标签、PDF 相对路径等所有字段。',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: '论文唯一 key（DOI 或工作区计算得到的身份键）' },
    },
    required: ['key'],
    additionalProperties: false,
  },
} as const

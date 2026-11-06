/**
 * MCP 子进程内共用的 papers.jsonl 读取逻辑
 *
 * 不 import @asci/shared 或 main lib，保持子进程打包最小。
 * 条目结构与 WorkspacePaperEntry 对齐（packages/shared/src/types/agent.ts:695）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface WorkspacePaperEntry {
  key: string
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  doi: string | null
  url: string | null
  abstract: string | null
  extra?: Record<string, unknown>
  status: 'unread' | 'read' | 'saved' | 'archived'
  starred: boolean
  tags: string[]
  note: string | null
  noteRelPath: string | null
  pdfRelPath: string | null
  linkedZoteroKey: string | null
  firstSeenAt: string
  lastSeenAt: string
  sessionRefs: string[]
  seenCount: number
}

function resolvePapersFile(): string {
  const dir = process.env.ASCI_WORKSPACE_DIR
  if (!dir) {
    throw new Error(
      'ASCI_WORKSPACE_DIR 环境变量未设置；该 MCP 服务器必须由 ASCI agent-orchestrator 拉起。',
    )
  }
  return join(dir, 'papers.jsonl')
}

export function readPapersJsonl(): WorkspacePaperEntry[] {
  const file = resolvePapersFile()
  if (!existsSync(file)) return []
  const out: WorkspacePaperEntry[] = []
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as WorkspacePaperEntry)
    } catch {
      // 损坏行跳过，与 workspace-paper-store 策略一致
    }
  }
  return out
}

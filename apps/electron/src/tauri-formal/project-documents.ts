import type { NativeDocumentReference } from '@asci/shared'
import type { FormalTransport } from './transport'

export interface DocumentSummary {
  documentId: string
  filename: string
  /** PDF 各页的正文行数，空白页为 0。 */
  pageLineCounts?: number[]
  lineCount: number
  byteLength: number
}
interface DocumentExcerpt {
  document: DocumentSummary
  page?: number
  startLine: number
  endLine: number
  text: string
}
export interface NativeProjectDocuments {
  list(workspaceId: string): Promise<DocumentSummary[]>
  pick(workspaceId: string): Promise<DocumentSummary | null>
  read(workspaceId: string, selection: NativeDocumentReference): Promise<DocumentExcerpt>
}

/** 仅保留原生允许的定位字段；文件名和预览正文不属于请求参数。 */
export function documentSelection({ documentId, page, startLine, endLine }: NativeDocumentReference): NativeDocumentReference {
  return { documentId, ...(page !== undefined && { page }), startLine, endLine }
}

export function createProjectDocuments(command: FormalTransport['command']): NativeProjectDocuments {
  return {
    async list(workspaceId) {
      const { value } = await command<{ value: DocumentSummary[] }>('listProjectDocuments', { workspaceId })
      return value
    },
    async pick(workspaceId) {
      const { value } = await command<{ value: DocumentSummary | null }>('pickProjectDocument', { workspaceId })
      return value
    },
    async read(workspaceId, source) {
      const selection = documentSelection(source)
      const { value } = await command<{ value: DocumentExcerpt }>('readProjectDocument', {
        workspaceId, selection,
      })
      if (value.document.documentId !== selection.documentId || value.page !== selection.page
          || value.startLine !== selection.startLine || value.endLine !== selection.endLine) {
        throw new Error('invalidReply')
      }
      return value
    },
  }
}

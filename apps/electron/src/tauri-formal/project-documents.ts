import type { NativeDocumentReference } from '@asci/shared'
import type { FormalTransport } from './transport'

export interface DocumentSummary {
  documentId: string
  filename: string
  lineCount: number
  byteLength: number
}
interface DocumentExcerpt {
  document: DocumentSummary
  startLine: number
  endLine: number
  text: string
}
export interface NativeProjectDocuments {
  list(workspaceId: string): Promise<DocumentSummary[]>
  pick(workspaceId: string): Promise<DocumentSummary | null>
  read(workspaceId: string, selection: NativeDocumentReference): Promise<DocumentExcerpt>
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
    async read(workspaceId, { documentId, startLine, endLine }) {
      const { value } = await command<{ value: DocumentExcerpt }>('readProjectDocument', {
        workspaceId, selection: { documentId, startLine, endLine },
      })
      if (value.document.documentId !== documentId || value.startLine !== startLine || value.endLine !== endLine) {
        throw new Error('invalidReply')
      }
      return value
    },
  }
}

export interface ProjectBackupPreview {
  token: string
  projectName: string
  sessionCount: number
  documentCount: number
  imageCount: number
}

export interface ProjectBackupReceipt {
  workspaceId: string
  alreadyRestored: boolean
}

export interface NativeProjectBackups {
  exportBackup(workspaceId: string): Promise<boolean>
  pick(): Promise<ProjectBackupPreview | null>
  restore(token: string): Promise<ProjectBackupReceipt>
  discard(token: string): Promise<void>
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** 路径只由宿主选择，恢复仅接受宿主为预检快照分配的令牌。 */
export function createProjectBackups(
  command: (name: string, args?: Record<string, unknown>) => Promise<{ value: unknown }>,
): NativeProjectBackups {
  return {
    async exportBackup(workspaceId) {
      const { value } = await command('exportProjectBackup', { workspaceId })
      if (typeof value !== 'boolean') throw new Error('invalidBackupReply')
      return value
    },
    async pick() {
      const { value } = await command('pickProjectBackup')
      if (value === null) return null
      const preview = value as Partial<ProjectBackupPreview> | undefined
      if (!preview || typeof preview.token !== 'string' || !preview.token
        || typeof preview.projectName !== 'string' || !preview.projectName
        || !isCount(preview.sessionCount) || !isCount(preview.documentCount) || !isCount(preview.imageCount)) {
        throw new Error('invalidBackupReply')
      }
      const { token, projectName, sessionCount, documentCount, imageCount } = preview
      return { token, projectName, sessionCount, documentCount, imageCount }
    },
    async restore(token) {
      const { value } = await command('restoreProjectBackup', { token })
      const receipt = value as Partial<ProjectBackupReceipt> | null
      if (!receipt || typeof receipt.workspaceId !== 'string' || !receipt.workspaceId
        || typeof receipt.alreadyRestored !== 'boolean') {
        throw new Error('invalidBackupReply')
      }
      return { workspaceId: receipt.workspaceId, alreadyRestored: receipt.alreadyRestored }
    },
    async discard(token) {
      const { value } = await command('discardProjectBackup', { token })
      if (value !== true) throw new Error('invalidBackupReply')
    },
  }
}

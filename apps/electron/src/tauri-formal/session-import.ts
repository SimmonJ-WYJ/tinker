/** 宿主只返回计数。未知警告归入同一栏，文件名、路径和会话内容不进入 UI。 */
export const importWarningCodes = [
  'invalidSession', 'missingHistory', 'invalidHistory', 'unsupportedRecord',
  'missingAttachment', 'unsupportedAttachment', 'invalidAttachment', 'attachmentLimit',
  'unsafeSource', 'duplicateSession', 'ambiguousHistory', 'incompleteHistory', 'duplicateMessage',
  'importUnconfirmed', 'importStopped', 'importConflict', 'sessionLimit', 'corruptImport', 'importLimit', 'importDeleted', 'other',
] as const

export type ImportWarningCode = typeof importWarningCodes[number]

export interface SessionImportReport {
  cancelled: boolean
  imported: number
  unchanged: number
  skipped: number
  unconfirmed: number
  warnings: Partial<Record<ImportWarningCode, number>>
}

export type SessionImporter = () => Promise<SessionImportReport>

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** IPC 不接受选择路径参数；选择器与源文件读取全部在宿主执行。 */
export function createSessionImporter(command: (name: string) => Promise<{ value: unknown }>): SessionImporter {
  return async () => {
    const { value } = await command('importElectronSessions')
    const report = value as Partial<SessionImportReport> | null
    if (!report || typeof report.cancelled !== 'boolean' || !isCount(report.imported)
      || !isCount(report.unconfirmed) || !isCount(report.unchanged) || !isCount(report.skipped) || !report.warnings
      || typeof report.warnings !== 'object' || Array.isArray(report.warnings)) throw new Error('invalidImportReport')

    const warnings: SessionImportReport['warnings'] = {}
    for (const [code, count] of Object.entries(report.warnings)) {
      if (!isCount(count)) throw new Error('invalidImportReport')
      if (count === 0) continue
      const key = importWarningCodes.find(known => known === code) ?? 'other'
      warnings[key] = (warnings[key] ?? 0) + count
    }
    const { cancelled, imported, unchanged, skipped, unconfirmed } = report
    if (cancelled && (imported || unchanged || skipped || unconfirmed || Object.keys(warnings).length)) throw new Error('invalidImportReport')
    return { cancelled, imported, unchanged, skipped, unconfirmed, warnings }
  }
}

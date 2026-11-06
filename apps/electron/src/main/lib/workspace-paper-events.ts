/**
 * 工作区论文变更事件广播器
 * 把 WorkspacePapersChangedEvent 推给所有 BrowserWindow，供渲染进程监听。
 */
import { BrowserWindow } from 'electron'
import { WORKSPACE_PAPERS_IPC_CHANNELS } from '@asci/shared'
import type { WorkspacePapersChangedEvent } from '@asci/shared'

export function emitPapersChanged(
  workspaceId: string,
  changedKeys: string[],
  reason: WorkspacePapersChangedEvent['reason'],
): void {
  const event: WorkspacePapersChangedEvent = { workspaceId, changedKeys, reason }
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(WORKSPACE_PAPERS_IPC_CHANNELS.CHANGED_EVENT, event)
  }
}

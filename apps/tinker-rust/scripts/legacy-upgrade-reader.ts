/** 只在升级演练的私有合成副本中调用原 Electron 的项目、搜索及消息读取逻辑。 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

async function readFixture() {
  const home = process.env.ASCI_CONFIG_HOME ?? ''
  assert(/^\/private\/tmp\/tinker-tauri-checks-upgrade-[\w-]+\/rollback-home$/.test(home))
  assert.equal(realpathSync(home), home)
  assert.equal(realpathSync(join(home, '.asci')), join(home, '.asci'))
  assert(process.versions.electron && process.env.ELECTRON_RUN_AS_NODE === '1' && process.env.CLAUDE_CONFIG_DIR)

  const { getConfigDir, resolveAttachmentPath } = await import('../../electron/src/main/lib/config-paths')
  assert.equal(getConfigDir(), join(home, '.asci'))
  const { listAgentWorkspaces } = await import('../../electron/src/main/lib/agent-workspace-manager')
  const { listAgentSessions, getAgentSessionSDKMessages, searchAgentSessionMessages } = await import('../../electron/src/main/lib/agent-session-manager')
  const workspaces = listAgentWorkspaces()
  const sessions = listAgentSessions()
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
  assert(workspaces.length === 2 && sessions.length === 3 && sessions.every(s => uuid.test(s.id)))
  const owned = new Set(workspaces.map(p => p.id))
  const evidence = sessions.map(session => {
    assert(!session.workspaceId || owned.has(session.workspaceId))
    const messages = getAgentSessionSDKMessages(session.id)
    assert(messages.length >= 2)
    const attachments: string[] = []
    for (const msg of messages) {
      if (msg.type !== 'user' || !msg.imageEditReference) continue
      const path = msg.imageEditReference.localPath
      const [sid, name, extra] = path.split('/')
      assert(sid === session.id && name && /^[\w-]+\.png$/.test(name) && extra === undefined)
      const actual = resolveAttachmentPath(path)
      assert.equal(realpathSync(actual), join(home, '.asci', 'attachments', sid, name))
      attachments.push(createHash('sha256').update(readFileSync(actual)).digest('hex'))
    }
    return { id: session.id, project: session.workspaceId ?? null, title: session.title, messages: messages.length,
      transcriptSha256: createHash('sha256').update(JSON.stringify(messages)).digest('hex'), attachments }
  })
  assert(evidence.some(s => s.attachments.length > 0))
  const [hit] = searchAgentSessionMessages('alpine larch colour')
  assert(hit && hit.sessionTitle === 'Alpine notebooks' && hit.messageId)
  console.log(JSON.stringify({ electronVersion: process.versions.electron, projects: workspaces.map(p => p.id),
    sessions: evidence, searchMessageId: hit.messageId }))
}
void readFixture().catch(error => { console.error(error); process.exitCode = 1 })

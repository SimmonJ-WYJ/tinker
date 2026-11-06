/**
 * RAG 向量索引 headless 重建（dev-only 工具，committed 但不进打包）
 *
 * 用途：chunker / embedder 改动后，索引库里旧 chunk 的 content_hash 不变、不会自动重嵌，
 * 需整库重建才能生效。本脚本 = 设置页「Rebuild index」的命令行等价物：
 *   删库 → 遍历 snapshot 里所有已解析 PDF → 用真实 embedder + 当前 chunker 重新入库。
 *
 * 与设置页区别：纯命令行、顺序执行、无队列/事件，便于评估前一键重建 + 复跑 rag-eval。
 *
 * ⚠️ 会清空并重写 ~/.asci(-dev)/zotero/vector-index.db（可重建缓存，安全），
 *    但请先关闭 dev app，避免 WAL 写冲突 / 句柄悬挂。
 *
 * 跑法（见 package.json 的 reindex:rag）：
 *   bun run reindex:rag          # ASCI_DEV=1 → 重建 ~/.asci-dev 的索引
 */

import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { loadSnapshot } from '../src/main/lib/zotero-pdf-parser/snapshot-store.ts'
import {
  getEmbeddingModelsDir,
  getZoteroVectorIndexPath,
  getZoteroWikiArticleMdPath,
  getZoteroWikiMdPath,
  getZoteroWikiStructuredTxtPath,
} from '../src/main/lib/config-paths.ts'
import { E5Embedder, EMBEDDING_MODEL } from '../src/main/lib/zotero-embedding-index/embedder.ts'
import { ZoteroVectorDb } from '../src/main/lib/zotero-embedding-index/vector-db.ts'
import { defaultFsDeps, runOne } from '../src/main/lib/zotero-embedding-index/worker.ts'

async function main(): Promise<void> {
  const indexPath = getZoteroVectorIndexPath()
  const modelDir = join(getEmbeddingModelsDir(), EMBEDDING_MODEL.modelId)

  console.log('═'.repeat(72))
  console.log('RAG 向量索引 headless 重建')
  console.log(`  index : ${indexPath}`)
  console.log(`  model : ${modelDir}`)
  console.log('═'.repeat(72))

  const snap = loadSnapshot()
  if (!snap) {
    console.error('✗ 找不到 zotero snapshot，无可重建内容')
    process.exit(1)
  }

  // 1. 删库（含 WAL/SHM），整库重建
  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${indexPath}${suffix}`
    if (existsSync(f)) rmSync(f, { force: true })
  }
  console.log('✓ 已删除旧索引库，开始全量重建')

  // 2. 开新库 + 载模型
  const vdb = ZoteroVectorDb.open(indexPath, {
    modelId: EMBEDDING_MODEL.modelId,
    embedDim: EMBEDDING_MODEL.embedDim,
  })
  if (!vdb.vecAvailable) {
    console.error('✗ vec0 扩展不可用，重建中止（检索会退化为纯 FTS）')
    process.exit(1)
  }
  const embedder = await E5Embedder.load(modelDir)

  // 3. 逐篇重嵌（顺序执行，避免与磁盘/CPU 抢占）
  const deps = {
    getRecord: (k: string) => loadSnapshot()?.pdfs[k],
    getMdPath: getZoteroWikiMdPath,
    getStructuredTxtPath: getZoteroWikiStructuredTxtPath,
    getArticleMdPath: getZoteroWikiArticleMdPath,
    ...defaultFsDeps(),
    vdb,
    embed: (texts: string[], kind: 'query' | 'passage') => embedder.embed(texts, kind),
  }

  const keys = Object.entries(snap.pdfs)
    .filter(([, rec]) => rec.parse?.status === 'completed')
    .map(([k]) => k)
  console.log(`待重建论文：${keys.length} 篇\n`)

  let done = 0
  let failed = 0
  for (const key of keys) {
    try {
      const results = await runOne(key, deps)
      const embedded = results
        .filter((r) => r.action === 'embedded')
        .map((r) => `${r.textKind}:${r.chunkCount ?? 0}`)
        .join(' ')
      done++
      console.log(`[${String(done).padStart(2)}/${keys.length}] ✓ ${key}  ${embedded}`)
    } catch (err) {
      failed++
      console.warn(`[${String(done + failed).padStart(2)}/${keys.length}] ✗ ${key}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const total = vdb.countChunks()
  vdb.close()
  console.log(`\n${'═'.repeat(72)}`)
  console.log(`✓ 重建完成：${done} 篇成功、${failed} 篇失败 · 库内 chunk 总数 ${total}`)
}

void main().catch((err) => {
  console.error('重建脚本异常：', err)
  process.exit(1)
})

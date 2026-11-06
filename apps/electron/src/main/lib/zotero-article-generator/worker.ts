/**
 * 单条 article 生成 worker（v2 schema）
 *
 * 流程：
 *   1. 从 snapshot 取 record；前置 parse.status === 'completed' 才生成
 *   2. 标记 article.status='generating'，attempts++
 *   3. 读源 md，按 maxTokensPerChunk 切片
 *   4. 逐片调 LLM；遇 token-overflow 把 chunkBudget 砍半重试
 *   5. 多片输出按顺序拼接（除第 1 片，其余去掉 frontmatter / OUTLINE / # CONTENT 头）
 *   6. 解析 frontmatter，强制覆写确定性字段（id / title / authors / year / source_pdf）
 *   7. <block_N> 标签全局重排（跨章节连续从 1 计数）
 *   8. 写 .article.md，更新 snapshot.article 为 completed
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { ZoteroPdfRecord } from '@asci/shared'
import { nowIso, nowMs } from '@asci/shared'
import { getZoteroWikiArticleMdPath } from '../config-paths'
import { onEmbedSourceReady } from '../zotero-embedding-index/index.ts'
import { extractAuthors, extractYear, pickRecTitle } from '../zotero-metadata'
import { buildAttachmentPath } from '../zotero-client/data-dir.ts'
import {
  loadSnapshot,
  updateRecordArticle,
} from '../zotero-pdf-parser/snapshot-store'
import { loadArticleConfig } from './config'
import {
  extractFrontmatter,
  normalizeFrontmatter,
  serializeFrontmatter,
  type ArticleFrontmatter,
} from './frontmatter'
import { ArticleLlmError, callLlm } from './llm-client'
import { SECTION_HEADING_LINE_RE, dedupSectionNumbers, rebuildOutline } from './merge-helpers'
import { pingStatusChanged } from './status-bus'
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from './prompt'
import { estimateTokens, splitMarkdownIntoChunks } from './splitter'

/**
 * 单次 LLM 输出 token 上限（max_tokens）
 *
 * article 任务需要照搬全段原文 + 块标签结构，输出体量通常 ≥ 输入。给 64K 让不切片
 * 整篇论文也能在一次调用里完整产出，覆盖 DeepSeek V4 / Claude Sonnet 4.5 / Kimi 等
 * 主流兼容端点的输出上限。如果模型实际只支持更小输出，4xx 会触发 token-overflow
 * 重试砍半切片。
 */
const OUTPUT_MAX_TOKENS = 64000

/**
 * 单 chunk 级 LLM 调用的瞬时错误（network / rate-limit）最大重试次数
 *
 * 配合指数退避（5s / 10s / 20s）。避免一次 502 风暴导致整篇 article 失败，
 * 让前面成功的 chunk 不浪费。auth / invalid-response 等"明确错误"不在此列。
 */
const CHUNK_TRANSIENT_RETRY_MAX = 3

/** chunk 级重试退避起点（ms），每次翻倍 */
const CHUNK_TRANSIENT_RETRY_BASE_MS = 5_000

/** worker 整体级别（生成失败后的整篇重试），最多砍半切片或换 channel 几次 */
const WORKER_OUTER_RETRY_MAX = 3

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 判断这个错误是否是"瞬时"的（值得 backoff 重试） */
function isTransientLlmError(err: unknown): err is ArticleLlmError {
  return err instanceof ArticleLlmError && (err.kind === 'network' || err.kind === 'rate-limit')
}

export async function runOne(attachmentKey: string): Promise<void> {
  const snap = loadSnapshot()
  const rec = snap?.pdfs[attachmentKey]
  if (!rec) return

  if (rec.parse?.status !== 'completed' || !rec.parse.mdPath) {
    console.warn(`[Zotero Article] ${attachmentKey} parse 未完成，跳过 article 生成`)
    return
  }
  const mdPath = rec.parse.mdPath
  if (!existsSync(mdPath)) {
    await updateRecordArticle(attachmentKey, {
      status: 'failed',
      error: `源 md 不存在: ${mdPath}`,
      attempts: (rec.article?.attempts ?? 0) + 1,
    })
    return
  }

  const prevAttempts = rec.article?.attempts ?? 0

  await updateRecordArticle(attachmentKey, { status: 'generating' })
  pingStatusChanged()

  const config = loadArticleConfig()
  const md = readFileSync(mdPath, 'utf-8')
  const stat = statSync(mdPath)
  const recTitle = pickRecTitle(rec)
  console.log(
    `[Zotero Article] ▶ 开始生成 ${attachmentKey} (${recTitle})，源 md ${md.length} 字符 (≈${estimateTokens(md)} tokens)`,
  )

  let chunkBudget = config.maxTokensPerChunk
  let lastErr: unknown = null
  for (let attempt = 0; attempt < WORKER_OUTER_RETRY_MAX; attempt++) {
    try {
      const result = await generateOnce({
        attachmentKey,
        recTitle,
        recFilename: rec.filename,
        authors: extractAuthors(rec.parent),
        year: extractYear(rec.parent),
        sourcePdf: buildAttachmentPath(rec.attachmentKey, rec.filename),
        md,
        chunkBudget,
        configChannelId: config.channelId,
        configModel: config.model,
      })

      const outPath = getZoteroWikiArticleMdPath(attachmentKey)
      writeFileSync(outPath, result.fileContent, 'utf-8')
      console.log(
        `[Zotero Article] ${attachmentKey} 已写入文件：${outPath} (${result.fileContent.length} 字符)`,
      )

      await updateRecordArticle(attachmentKey, {
        status: 'completed',
        articlePath: outPath,
        generatedAt: nowIso(),
        articleCreated: null, // v2 schema 不再使用 created/updated
        sourceMdMtimeMs: stat.mtimeMs,
        error: null,
        attempts: prevAttempts + 1,
        channelId: result.channelId,
        model: result.model,
        promptVersion: PROMPT_VERSION,
      })
      console.log(`[Zotero Article] ✓ ${attachmentKey} 全流程完成 → ${outPath}`)

      // 通知向量索引：article 摘要层已就绪（追加同锚点增强语料）
      try {
        onEmbedSourceReady(attachmentKey)
      } catch (embedErr) {
        console.warn(`[Zotero Article] onEmbedSourceReady 抛异常（不阻塞 article 完成）:`, embedErr)
      }
      return
    } catch (err) {
      lastErr = err
      if (err instanceof ArticleLlmError && err.kind === 'token-overflow' && chunkBudget > 1500) {
        chunkBudget = Math.max(1500, Math.floor(chunkBudget / 2))
        console.warn(`[Zotero Article] token 超限，砍半切片重试: chunkBudget=${chunkBudget}`)
        continue
      }
      // 瞬时错误（network / rate-limit）也走外层重试：generateOnce 内部已经做了
      // chunk 级 backoff 重试；如果还失败说明 chunk 级 3 次都没扛住，外层再退避一次
      // 给上游更多缓冲时间。最多 WORKER_OUTER_RETRY_MAX 次。
      if (isTransientLlmError(err) && attempt < WORKER_OUTER_RETRY_MAX - 1) {
        const waitMs = 30_000 * (attempt + 1)  // 30s / 60s / 90s
        console.warn(
          `[Zotero Article] ${err.kind} 外层重试 attempt=${attempt + 1}/${WORKER_OUTER_RETRY_MAX}，等 ${waitMs / 1000}s 后重试`,
        )
        await sleep(waitMs)
        continue
      }
      break
    }
  }

  const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr)
  const isAuth = lastErr instanceof ArticleLlmError && lastErr.kind === 'auth'
  // 瞬时错误（network / rate-limit）不累 attempts：让下次 worker 扫描 / 用户点
  // "重试失败" 还能自动接力，而不是被 MAX_ATTEMPTS=3 永久锁死。
  // auth 错误标 999 一次性放弃；其他"明确错误"才 +1。
  const isTransient = isTransientLlmError(lastErr)
  const finalAttempts = isAuth ? 999 : isTransient ? prevAttempts : prevAttempts + 1
  await updateRecordArticle(attachmentKey, {
    status: 'failed',
    error: errMsg,
    attempts: finalAttempts,
  })
  console.warn(
    `[Zotero Article] ✗ ${attachmentKey}: ${errMsg} (attempts=${finalAttempts}, transient=${isTransient})`,
  )
}

interface GenerateOnceInput {
  attachmentKey: string
  recTitle: string
  recFilename: string
  authors: string[]
  year: number | null
  sourcePdf: string
  md: string
  chunkBudget: number
  configChannelId: string | null
  configModel: string | null
}

interface GenerateOnceResult {
  fileContent: string
  frontmatter: ArticleFrontmatter
  channelId: string
  model: string
}

async function generateOnce(input: GenerateOnceInput): Promise<GenerateOnceResult> {
  const chunks = splitMarkdownIntoChunks(input.md, input.chunkBudget)
  const outputs: string[] = []

  let pickedChannelId = ''
  let pickedModel = ''

  console.log(
    `[Zotero Article] ${input.attachmentKey} 切片完成：共 ${chunks.length} 片（chunkBudget=${input.chunkBudget} tokens，原文 ${estimateTokens(input.md)} tokens）`,
  )

  for (const chunk of chunks) {
    const userPrompt = buildUserPrompt({
      paperTitle: input.recTitle,
      attachmentKey: input.attachmentKey,
      chunkIndex: chunk.index,
      chunkTotal: chunk.total,
      isFirstChunk: chunk.isFirst,
      markdown: chunk.markdown,
    })
    const t0 = nowMs()
    console.log(
      `[Zotero Article] ${input.attachmentKey} → 调用 LLM 第 ${chunk.index}/${chunk.total} 片（约 ${estimateTokens(chunk.markdown)} tokens）...`,
    )

    // chunk 级独立重试：单 chunk 502 / 限流时退避重试，不让已经成功的 chunk 白干。
    // auth / token-overflow / 其他明确错误直接 throw，由外层 generateOnce 调用者处理。
    let result: Awaited<ReturnType<typeof callLlm>> | null = null
    for (let chunkAttempt = 0; chunkAttempt < CHUNK_TRANSIENT_RETRY_MAX; chunkAttempt++) {
      try {
        result = await callLlm({
          channelId: input.configChannelId,
          model: input.configModel,
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
          maxTokens: OUTPUT_MAX_TOKENS,
        })
        break
      } catch (err) {
        if (isTransientLlmError(err) && chunkAttempt < CHUNK_TRANSIENT_RETRY_MAX - 1) {
          const waitMs = CHUNK_TRANSIENT_RETRY_BASE_MS * 2 ** chunkAttempt  // 5s / 10s / 20s
          console.warn(
            `[Zotero Article] ${input.attachmentKey} 第 ${chunk.index}/${chunk.total} 片 ${err.kind} 重试 ${chunkAttempt + 1}/${CHUNK_TRANSIENT_RETRY_MAX}（等 ${waitMs / 1000}s）：${err.message}`,
          )
          await sleep(waitMs)
          continue
        }
        throw err
      }
    }
    if (!result) {
      // 理论上达不到（要么 break 要么 throw），兜底 throw 让外层兜
      throw new ArticleLlmError('network', `chunk ${chunk.index}/${chunk.total} 重试 ${CHUNK_TRANSIENT_RETRY_MAX} 次后仍未成功`)
    }

    const elapsed = ((nowMs() - t0) / 1000).toFixed(1)
    console.log(
      `[Zotero Article] ${input.attachmentKey} ← 第 ${chunk.index}/${chunk.total} 片完成 (${elapsed}s, output=${result.text.length} chars, channel=${result.channelId.slice(0, 8)}, model=${result.model})`,
    )
    outputs.push(result.text)
    pickedChannelId = result.channelId
    pickedModel = result.model
    pingStatusChanged()
  }

  // 拼接：第 1 片完整保留；后续片去掉 frontmatter / OUTLINE / # CONTENT 头
  let combined = outputs[0] ?? ''
  for (let i = 1; i < outputs.length; i++) {
    combined += '\n\n' + stripDuplicatedHeader(outputs[i] ?? '')
  }
  console.log(
    `[Zotero Article] ${input.attachmentKey} 拼接完成：合计 ${combined.length} 字符，进入 frontmatter 归一阶段`,
  )

  const { frontmatter: rawFm, body: rawBody } = extractFrontmatter(combined)
  const fm = normalizeFrontmatter({
    llmFrontmatter: rawFm,
    paperId: input.attachmentKey,
    recTitle: input.recTitle,
    recFilename: input.recFilename,
    authors: input.authors,
    year: input.year,
    sourcePdf: input.sourcePdf,
  })

  console.log(
    `[Zotero Article] ${input.attachmentKey} frontmatter 归一完成：title="${fm.title.slice(0, 60)}" authors=${fm.authors.length} year=${fm.year ?? 'null'} tags=[${fm.tags.join(',')}]`,
  )

  // 多片合并修复链：
  //   1. dedupSectionNumbers：续片若重启编号（chunk 2 emit `# 1. Results`）改写为
  //      严格递增编号，避免后续 renumberPTags 产出冲突的 p1_x id
  //   2. rebuildOutline：用 CONTENT 真实出现的章节重建 OUTLINE 块，覆盖首片只列了
  //      部分章节的不完整 OUTLINE（papers_read_outline 依赖此 OUTLINE）
  //   3. renumberPTags：基于稳定的章节编号给所有 <p> 标签分配 p<S>_<P> id
  const { body: dedupedBody, renumberMap } = dedupSectionNumbers(rawBody)
  if (renumberMap.size > 0) {
    const remaps = Array.from(renumberMap.entries()).map(([o, n]) => `${o}→${n}`).join(', ')
    console.log(`[Zotero Article] ${input.attachmentKey} 章节编号去重：${remaps}`)
  }
  const outlinedBody = rebuildOutline(dedupedBody)
  const renumberedBody = renumberPTags(outlinedBody)
  const blockCount = (renumberedBody.match(/<p\s+id="p\d+_\d+"/g) ?? []).length
  const outlineItemCount = (renumberedBody.match(/^- \d+\./gm) ?? []).length
  console.log(
    `[Zotero Article] ${input.attachmentKey} block 重排完成：共 ${blockCount} 个 <p id="..."> 段落，OUTLINE 列出 ${outlineItemCount} 节`,
  )

  const fileContent = serializeFrontmatter(fm) + '\n\n' + renumberedBody.trim() + '\n'
  return { fileContent, frontmatter: fm, channelId: pickedChannelId, model: pickedModel }
}

/**
 * 去掉非首片的 frontmatter（若 LLM 误带）以及 OUTLINE / # CONTENT 头部
 *
 * 续接片应直接以 `# <章节标题>` 开头进入 CONTENT 区域。
 */
function stripDuplicatedHeader(text: string): string {
  let out = text
  if (out.startsWith('---')) {
    const parts = out.split('\n')
    let endIdx = -1
    for (let i = 1; i < parts.length; i++) {
      if (parts[i] === '---') {
        endIdx = i
        break
      }
    }
    if (endIdx > 0) out = parts.slice(endIdx + 1).join('\n').replace(/^\n+/, '')
  }
  // 去掉续接片可能误带的 # OUTLINE 区块（直到下一个 # 标题）
  out = out.replace(/^\s*#\s*OUTLINE[\s\S]*?(?=^#\s)/m, '')
  // 去掉续接片可能误带的 # CONTENT 单行头
  out = out.replace(/^\s*#\s*CONTENT\s*\n+/m, '')
  return out.replace(/^\n+/, '')
}

/**
 * 把 `<p id="pS_P">...</p>` 标签按当前章节统一重排：
 *   - S = 当前章节序号（来自 `# N. <标题>` 标题中的 N）
 *   - P = 章节内段落序号，每进入新章节重置为 1
 *
 * 容忍 LLM 在多片场景下各自从 1 开始计数、id 写错位等情况；闭合标签按栈匹配
 * 最近一次开启，避免错配。`<p>`（无 id）也会被自动补 id。
 */
function renumberPTags(body: string): string {
  const lines = body.split('\n')
  let currentSection = 0
  let paragraphCounter = 0
  /** 用栈跟踪当前 in-flight 的 id，确保 </p> 关闭最近一个 <p> */
  const openIds: string[] = []

  // 复用 merge-helpers 的统一 heading 正则，支持 `# N. T` / `# N、T` / `# N T` 三种风格
  // （pdf-parse 抽出的"# 1 Introduction"无句点形式也能识别），避免规则在两处漂移。
  const out: string[] = []
  for (const line of lines) {
    // 章节标题：捕获编号，重置段落计数
    const h = SECTION_HEADING_LINE_RE.exec(line)
    if (h) {
      const n = parseInt(h[1] ?? '', 10)
      if (Number.isFinite(n)) {
        currentSection = n
        paragraphCounter = 0
      }
      out.push(line)
      continue
    }

    // 改写所有 <p ...> 与 </p> 标签
    const rewritten = line.replace(/<p\b[^>]*>|<\/p\s*>/gi, match => {
      if (match.startsWith('</')) {
        const id = openIds.pop()
        return id ? `</p>` : `</p>`
      }
      // 开启标签：分配新 id
      paragraphCounter += 1
      const id = currentSection > 0 ? `p${currentSection}_${paragraphCounter}` : `p0_${paragraphCounter}`
      openIds.push(id)
      return `<p id="${id}">`
    })
    out.push(rewritten)
  }
  return out.join('\n')
}

// pickRecTitle / extractAuthors / extractYear 已迁移到 ../zotero-metadata.ts，
// 此文件与 wrap.ts 共用同一份实现

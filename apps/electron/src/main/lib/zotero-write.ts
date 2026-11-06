/**
 * Zotero connector 写端（主进程本地 API，端口 23119）
 *
 * 四步流程：
 *   1) POST /connector/saveItems — Zotero 接受 item JSON，落到 UI 当前选中的 collection
 *      （与浏览器 Zotero Connector 插件相同语义）。响应 201 空 body。
 *      payload 中 items[0].id 用 8 字符短随机串，sessionID 在 attachment 步骤复用。
 *   2) POST /connector/saveAttachmentFromResolver — 让 Zotero 自己跑 OA resolver
 *      （Unpaywall / 自定义 resolver）拉 PDF；resolver 返回 false / 500 一律视为
 *      「找不到 OA」并软失败，不影响 step 1 已建好的条目。复用同一 sessionID + itemID。
 *   2.5) arXiv 兜底：DOI 是 10.48550/arXiv.<id> 但 resolver 失败时（很多 < 1 个月的
 *      新 arxiv DOI 还没被 DataCite 索引到 Unpaywall），主进程自己 fetch arxiv PDF
 *      字节，POST 到 /connector/saveAttachment 让 Zotero 落盘。复用同一 sessionID +
 *      itemID（作为 parentItemID）。
 *   3) GET /api/users/0/items?q=<DOI> — 按 DOI 反查拿 8 字符 Web API key，
 *      写回 workspace-paper.linkedZoteroKey。
 *
 * 为什么不走 /connector/import：Zotero 9 对 CSL-JSON 返回 400（不管 shape），
 * 协议在新版被弃用或重构；saveItems 是浏览器插件日用的稳定路径。
 *
 * 无 DOI 的 entry：跳过 resolver（无依据），仅退化为按 title 反查最近添加的 1 条。
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { fetchZotero, fetchZoteroConnector } from './zotero-client/api-client.ts'
import { ZoteroError } from './zotero-client/errors.ts'

import type { LinkZoteroCollectionStatus, LinkZoteroPdfStatus } from '@asci/shared'
import { ZOTERO_CONNECTOR_BASE } from '@asci/shared'

export interface ZoteroCreator {
  creatorType: 'author' | 'editor' | 'translator' | 'contributor'
  firstName?: string
  lastName?: string
  /** 机构作者等单一字符串姓名 */
  name?: string
}

export interface ZoteroItemInput {
  title: string
  creators: ZoteroCreator[]
  DOI: string | null
  /** 出版年/日期字符串，如 "2024" / "2024-05-01" */
  date: string | null
  /** 期刊或会议名 */
  publicationTitle: string | null
  url?: string | null
  abstractNote?: string | null
}

export interface CreateItemOptions {
  tags?: string[]
  /** Zotero itemType，默认 'journalArticle' */
  itemType?: 'journalArticle' | 'preprint' | 'book' | 'conferencePaper'
  /**
   * 目标 treeViewID 控制（connector /updateSession 的 target 字段）：
   *   - null（或未传）: 落到 Zotero UI 当前选中 target（不调 updateSession）
   *   - 'L1':           「我的文献库」根（library 根）
   *   - 'C<整数>':      指定 collection（Zotero 本地 collectionID，非 8 字符 Web API key）
   *
   * 实现：connector /saveItems 落到 UI 当前选中处且不接受 target 字段；Zotero 本地 Web API
   * 只读（PATCH /items/<key> 返 501）。故移动改走 connector /updateSession：用同一 sessionID
   * 把本次保存的条目整体移入 target。失败不回滚，只软警告（item 仍在 UI 当前选中处）。
   */
  targetTreeViewID?: string | null
}

export interface CreateItemResult {
  /** Zotero 8 字符 Web API key，可直接用作 linkedZoteroKey */
  key: string
  version: number
  /** OA PDF resolver 结果（best-effort，不影响 item 本身写入） */
  pdfStatus: LinkZoteroPdfStatus
  /** 二段 PATCH 移到目标 collection 的结果（failed 不回滚，仅供 UI 告警） */
  collectionStatus: LinkZoteroCollectionStatus
}

/** Web API v3 item 响应的片段（只声明用到的字段） */
interface ZoteroApiItem {
  key: string
  version: number
  data?: {
    DOI?: string
    title?: string
  }
}

/** 构造 Zotero item JSON（/connector/saveItems 格式，非 CSL） */
function buildItem(
  input: ZoteroItemInput,
  options: CreateItemOptions,
  itemId: string,
): Record<string, unknown> {
  return {
    // 必填：Zotero connector 浏览器插件实测会带 id 字段，
    // saveAttachmentFromResolver 通过 (sessionID, itemID) 二元组挂附件；
    // 缺 id 时 resolver 找不到 parent，会原地失败。
    id: itemId,
    itemType: options.itemType ?? 'journalArticle',
    title: input.title,
    creators: input.creators,
    ...(input.DOI ? { DOI: input.DOI } : {}),
    ...(input.date ? { date: input.date } : {}),
    ...(input.publicationTitle ? { publicationTitle: input.publicationTitle } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.abstractNote ? { abstractNote: input.abstractNote } : {}),
    ...(options.tags && options.tags.length > 0
      ? { tags: options.tags.map((t) => ({ tag: t })) }
      : {}),
  }
}

/** 8 字符十六进制 connector item id（与浏览器插件实测同样长度，纯本地标识） */
function generateConnectorItemId(): string {
  return randomBytes(4).toString('hex')
}

/**
 * 从 arxiv DataCite DOI 中抽取出 arxiv id。
 *
 * 兼容三种大小写：`10.48550/arXiv.2501.05435` / `10.48550/arxiv.2501.05435`。
 * 仅识别 2007+ 新格式（YYMM.NNNNN）；旧格式（含 `/`）很罕见且 arxiv PDF URL 也不同。
 */
function extractArxivIdFromDoi(doi: string): string | null {
  const m = doi.match(/^10\.48550\/arxiv\.(\d{4}\.\d{4,5})$/i)
  return m?.[1] ?? null
}

/**
 * arXiv 兜底：resolver 找不到 OA 时，主进程自己拉 arxiv PDF，
 * POST 到 /connector/saveAttachment 让 Zotero 把字节落盘成附件。
 *
 * Zotero 的 saveAttachment 走 importFromNetworkStream，期待原始 PDF 字节 + Content-Length；
 * 不是 multipart，不是 base64。X-Metadata 头里塞 sessionID + parentItemID 让它挂到刚建的 item。
 *
 * 任何抛错都回 false：item 已建，附件失败不影响主流程。
 */
async function tryAttachArxivPdf(
  sessionID: string,
  parentItemID: string,
  arxivId: string,
): Promise<boolean> {
  const pdfUrl = `https://arxiv.org/pdf/${arxivId}`
  try {
    // arxiv PDF 平均 1-5 MB，最大不超过几十 MB；放主进程内存里 OK。
    const pdfRes = await fetch(pdfUrl, { redirect: 'follow' })
    if (!pdfRes.ok) {
      console.warn(`[Zotero] arxiv PDF 拉取失败 ${pdfRes.status}: ${pdfUrl}`)
      return false
    }
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer())
    if (pdfBytes.byteLength === 0) {
      console.warn(`[Zotero] arxiv PDF 字节为空: ${pdfUrl}`)
      return false
    }

    const metadata = {
      sessionID,
      parentItemID,
      title: 'Full Text PDF',
      url: pdfUrl,
    }

    const attachRes = await fetch(`${ZOTERO_CONNECTOR_BASE}/saveAttachment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdfBytes.byteLength),
        'X-Metadata': JSON.stringify(metadata),
        'X-Zotero-Connector-API-Version': '3',
      },
      body: pdfBytes,
    })

    if (attachRes.status !== 201) {
      const text = await attachRes.text().catch(() => '')
      console.warn(`[Zotero] saveAttachment 失败 ${attachRes.status}: ${text.slice(0, 200)}`)
      return false
    }
    return true
  } catch (err) {
    console.warn('[Zotero] arxiv PDF 兜底失败:', err)
    return false
  }
}

/**
 * 调用 Zotero connector 的 OA resolver，让 Zotero 自己拉 PDF。
 *
 * 返回值语义：
 *   - true  : Zotero 成功为该 itemID 落了至少一个附件
 *   - false : resolver 已尝试但找不到 OA / 下载失败 — 视为软失败（item 已建）
 *
 * 任何抛错（网络异常 / 端点不在）都按 false 处理；item 本身已写入，不应反向回滚。
 */
async function trySaveAttachmentViaResolver(
  sessionID: string,
  itemID: string,
): Promise<boolean> {
  try {
    await fetchZoteroConnector<unknown>('/saveAttachmentFromResolver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionID, itemID }),
    })
    return true
  } catch (err) {
    // Zotero 在没找到 OA / 下载失败时返回 500 文本；端点不存在则 404。
    // 这两种都按「没找到 PDF」处理，不冒泡到 UI 报错。
    console.warn('[Zotero] saveAttachmentFromResolver 软失败:', err)
    return false
  }
}

/** 用 saveItems 的 uri 字段：优先 entry.url，其次 DOI URL，最后 asci 占位 */
function buildUri(input: ZoteroItemInput): string {
  if (input.url) return input.url
  if (input.DOI) return `https://doi.org/${input.DOI}`
  return 'https://asci.local/paper'
}

/**
 * 把本次 saveItems 保存的条目通过 connector /updateSession 移入目标 target。
 *
 * 为什么不走 Web API：Zotero 本地 Web API 只读，PATCH /items/<key> 返 501
 * （Method not implemented）。connector /updateSession 是唯一可写入路径：传
 * 与 saveItems 相同的 sessionID，把该 session 的条目整体重新归入 target，并同步
 * 更新 Zotero UI 选中。失败不回滚已写入的 item，仅记日志（item 留在 UI 当前选中处）。
 *
 * target = treeViewID：'L1' = 我的文献库根；'C<整数>' = collection（本地 collectionID）。
 * 必须在 saveItems 成功之后调用（session 已存在）。
 */
async function tryUpdateSessionTarget(
  sessionID: string,
  target: string,
): Promise<boolean> {
  try {
    await fetchZoteroConnector<void>('/updateSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionID, target }),
    })
    return true
  } catch (err) {
    console.warn(`[Zotero] updateSession target=${target} 失败:`, err)
    return false
  }
}

/**
 * saveItems 成功后，按 DOI 或 title 反查新建 item 的 8 字符 key。
 * @throws ZoteroError 找不到 / Web API 异常
 */
async function findCreatedKey(
  input: ZoteroItemInput,
): Promise<{ key: string; version: number }> {
  if (input.DOI) {
    const path = `/users/0/items?q=${encodeURIComponent(input.DOI)}&qmode=everything&limit=5&sort=dateAdded&direction=desc`
    const results = await fetchZotero<ZoteroApiItem[]>(path)
    const match = results.find((r) => r.data?.DOI === input.DOI)
    if (match) return { key: match.key, version: match.version }
    throw new ZoteroError(
      'unexpected',
      `Zotero 已接受条目但按 DOI ${input.DOI} 反查不到 item key（Zotero 可能未启用可编辑文库）`,
    )
  }

  // 无 DOI：按 title 取最近添加的 1 条。风险：同名多条会错取，故仅兜底。
  const path = `/users/0/items?q=${encodeURIComponent(input.title)}&qmode=titleCreatorYear&limit=1&sort=dateAdded&direction=desc`
  const results = await fetchZotero<ZoteroApiItem[]>(path)
  if (results.length > 0 && results[0]) {
    return { key: results[0].key, version: results[0].version }
  }
  throw new ZoteroError(
    'unexpected',
    `Zotero 已接受条目但按 title 反查不到 item key（entry 缺 DOI，退化查询失败）`,
  )
}

/**
 * 在 Zotero 创建一个条目（进入 UI 当前选中的 collection）
 * @throws ZoteroError 网络 / 权限 / 协议 / 反查失败
 */
export async function createItem(
  input: ZoteroItemInput,
  options: CreateItemOptions = {},
): Promise<CreateItemResult> {
  // sessionID 在 saveItems 与 saveAttachmentFromResolver 间复用；
  // itemID 是 connector 域内的本地 id，与 step 3 反查的 8 字符 Web API key 不同。
  const sessionID = randomUUID()
  const itemID = generateConnectorItemId()

  const payload = {
    sessionID,
    uri: buildUri(input),
    items: [buildItem(input, options, itemID)],
  }

  // 第 1 步：POST /connector/saveItems（201 空 body 即成功）
  await fetchZoteroConnector<void>('/saveItems', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  // 第 2 步：尝试调 OA resolver 拉 PDF；失败软处理。
  //   - 没 DOI 直接跳过（resolver 没依据，必失败）
  //   - 有 DOI 但 resolver 不到 OA → 进 2.5 步 arxiv 兜底；都失败 → no_pdf
  let pdfStatus: LinkZoteroPdfStatus
  if (input.DOI) {
    const resolverOk = await trySaveAttachmentViaResolver(sessionID, itemID)
    if (resolverOk) {
      pdfStatus = 'attached'
    } else {
      // 第 2.5 步：DOI 是 arxiv DataCite 形式时，绕开 Unpaywall 自己 fetch arxiv PDF
      const arxivId = extractArxivIdFromDoi(input.DOI)
      if (arxivId) {
        const arxivOk = await tryAttachArxivPdf(sessionID, itemID, arxivId)
        pdfStatus = arxivOk ? 'attached' : 'no_pdf'
      } else {
        pdfStatus = 'no_pdf'
      }
    }
  } else {
    pdfStatus = 'skipped'
  }

  // 第 3 步：Web API 反查 8 字符 key
  const found = await findCreatedKey(input)

  // 第 4 步：目标 collection 控制（connector /updateSession，复用 sessionID）
  //   - undefined / null : 跳过移动，沿用 Zotero UI 选中 → skipped
  //   - 'L1' / 'C<整数>' : updateSession target，移到 library 根 / 指定 collection
  // 失败不回滚 item（已在 Zotero UI 当前选中处），返回 failed 供 UI 告警。
  const tgt = options.targetTreeViewID
  let collectionStatus: LinkZoteroCollectionStatus
  if (typeof tgt === 'string' && tgt.length > 0) {
    collectionStatus = (await tryUpdateSessionTarget(sessionID, tgt)) ? 'ok' : 'failed'
  } else {
    collectionStatus = 'skipped'
  }

  return { key: found.key, version: found.version, pdfStatus, collectionStatus }
}

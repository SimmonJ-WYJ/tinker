/**
 * Zotero 集成的共享类型与 IPC 通道常量
 *
 * ASCI 通过主进程向各 workspace 的 mcp.json 注入一个 Zotero MCP server，
 * 渲染端通过这些 IPC 通道控制开关、探测状态、启动应用。
 */

export const ZOTERO_IPC_CHANNELS = {
  PING: 'zotero:ping',
  DETECT_INSTALL: 'zotero:detect-install',
  LAUNCH_APP: 'zotero:launch-app',
  SET_ENABLED: 'zotero:set-enabled',
  GET_DATA_DIR: 'zotero:get-data-dir',
  SET_DATA_DIR: 'zotero:set-data-dir',
  /** 读取用户自定义 Zotero 安装路径（未设置返回 null） */
  GET_INSTALL_PATH: 'zotero:get-install-path',
  /** 设置/清除用户自定义 Zotero 安装路径；传 null 清除并回退到自动探测 */
  SET_INSTALL_PATH: 'zotero:set-install-path',
  /** 校验给定路径是否是有效的 Zotero 可执行文件/Bundle，UI 选完文件后调用 */
  VALIDATE_INSTALL_PATH: 'zotero:validate-install-path',
  /** 唤起平台文件选择器以选择 Zotero 可执行文件 / Bundle，返回路径或 null（取消） */
  BROWSE_INSTALL_PATH: 'zotero:browse-install-path',
  LIB_LIST_COLLECTIONS: 'zotero:lib:list-collections',
  LIB_SEARCH_ITEMS: 'zotero:lib:search-items',
  LIB_GET_COLLECTION_ITEMS: 'zotero:lib:get-collection-items',
  LIB_GET_ITEM: 'zotero:lib:get-item',
  LIB_GET_ATTACHMENT_PATH: 'zotero:lib:get-attachment-path',
  LIB_READ_PDF_BASE64: 'zotero:lib:read-pdf-base64',
  LIB_GET_SELECTED_TARGET: 'zotero:lib:get-selected-target',
  /** 列出全部可写入 target（library 根 + 所有 collection）供「加入 Zotero」选择器用 */
  LIB_LIST_COLLECTION_TARGETS: 'zotero:lib:list-collection-targets',
  /** 主动触发一次 Zotero PDF 被动 diff（与上次快照对比并打印日志） */
  PDF_DIFF_NOW: 'zotero:pdf:diff-now',
  /** 拉取一次当前 PDF 解析队列状态摘要（不主动推送，由 renderer poll） */
  PDF_PARSE_STATUS: 'zotero:pdf:parse-status',
  /**
   * 手动触发 structured .txt 链路：遍历 snapshot 全部 PDF，跑 layout-aware
   * 抽取 + 启发式分类 + 富 markdown 拼接，把产物写到 `~/.asci/zotero/wiki/{key}.txt`。
   *
   * 与 lite worker 队列（产 `.md`）完全独立；不动 snapshot，重入安全。
   * 返回 StructuredTxtGenerationResult 汇总。
   */
  PDF_STRUCTURED_TXT_GENERATE_ALL: 'zotero:pdf:structured-txt:generate-all',
  /** 读取段落总结增强（article.md）功能配置 */
  ARTICLE_CONFIG_GET: 'zotero:article-config:get',
  /** 写入段落总结增强配置（含开关；触发 worker 启停） */
  ARTICLE_CONFIG_SET: 'zotero:article-config:set',
  /** 拉取段落总结增强生成队列状态摘要 */
  ARTICLE_STATUS_SUMMARY: 'zotero:article:status-summary',
  /** 把 failed 全部重置为 idle 并入队（debug / 手动重试） */
  ARTICLE_RETRY_ALL: 'zotero:article:retry-all',
  /** 把所有 article（含 completed）重置为 idle 并入队，强制全量重生成 */
  ARTICLE_REGENERATE_ALL: 'zotero:article:regenerate-all',
  /** 主进程 → 渲染端：article 状态变更主动推送 */
  ARTICLE_STATUS_CHANGED: 'zotero:article:status-changed',
  /** 读取向量索引（语义检索）配置（评估总开关 + 并发） */
  EMBED_CONFIG_GET: 'zotero:embed-config:get',
  /** 写入向量索引配置（含开关；触发 worker 启停 + 工具注册门控） */
  EMBED_CONFIG_SET: 'zotero:embed-config:set',
  /** 拉取向量索引状态摘要（含模型状态 + chunk 总数） */
  EMBED_STATUS_SUMMARY: 'zotero:embed:status-summary',
  /** 清空索引库并全量重扫（设置页"重建索引"） */
  EMBED_REBUILD_ALL: 'zotero:embed:rebuild-all',
  /** 主进程 → 渲染端：向量索引状态变更主动推送 */
  EMBED_STATUS_CHANGED: 'zotero:embed:status-changed',
  /** 拉取嵌入模型权重下载状态 */
  EMBED_MODEL_STATUS: 'zotero:embed:model-status',
  /** 触发嵌入模型权重下载（幂等） */
  EMBED_MODEL_DOWNLOAD: 'zotero:embed:model-download',
  /** 主进程 → 渲染端：嵌入模型下载状态/进度推送 */
  EMBED_MODEL_STATUS_CHANGED: 'zotero:embed:model-status-changed',
} as const

/** Zotero 运行状态 */
export interface ZoteroPingStatus {
  /** Zotero 桌面版进程是否在跑（localhost:23119 能否连通） */
  running: boolean
  /** 是否在 Zotero 设置里开启了"Allow other applications" */
  remoteEnabled: boolean
}

/** 安装探测结果 */
export interface ZoteroInstallStatus {
  installed: boolean
  /** 探测到的可执行文件绝对路径（用于启动） */
  installedPath?: string
  /**
   * 路径来源：
   * - 'custom'：用户在设置里手动指定的 zoteroInstallPath
   * - 'default'：扫描常见安装路径命中
   * - 'path'：在 PATH 环境变量里 which 到（Linux / Windows）
   * UI 用来区分"是默认装的"还是"用户已经手动配过"。
   */
  source?: 'custom' | 'default' | 'path'
}

/** 校验用户手动指定路径的结果 */
export interface ZoteroValidatePathResult {
  valid: boolean
  /** 校验通过时返回归一化后的绝对路径（如选了 .app/Contents/MacOS/zotero 会收敛到 .app） */
  normalizedPath?: string
  /** 校验失败时的原因码（用于 i18n 选错误文案） */
  reason?: 'not-exists' | 'not-a-zotero-binary' | 'platform-mismatch'
}

/** 启动结果 */
export interface ZoteroLaunchResult {
  success: boolean
  message?: string
}

/** Zotero UI 当前选中的 target（collection 或 library 根） */
export interface ZoteroSelectedTarget {
  id: string
  name: string
  /** 层级：0 = library 根，1+ = collection */
  level: number
}

/**
 * 可写入的 Zotero target（library 根或 collection），来自 connector /getSelectedCollection 的 targets 树。
 *
 * treeViewID 是 connector /updateSession 接受的 target 标识：
 *   - 'L1'      : 「我的文献库」根
 *   - 'C<整数>' : collection（Zotero 本地 collectionID，非 8 字符 Web API key）
 * 用于「加入 Zotero」弹窗的写入位置选择器（写入走 connector，故用 treeViewID 而非 Web API key）。
 */
export interface ZoteroCollectionTarget {
  treeViewID: string
  name: string
  /** 层级：0 = library 根，1+ = collection 嵌套深度（供 UI 缩进） */
  level: number
}

/** 单条 PDF 解析任务的状态 */
export type ZoteroPdfParseStatus = 'pending' | 'parsing' | 'completed' | 'failed'

/**
 * 解析策略名（"用户/调用方希望使用的策略"）
 *
 * - lite: 走 pdf-parse 抽 plain text + 简单 markdown 包装（最快、零结构、可读）
 * - structured: 走 pdfjs-dist layout-aware 抽取，识别双栏 / 标题 / 列表 / 段落 / 页眉页脚
 */
export type ZoteroPdfParseStrategy = 'lite' | 'structured'

/**
 * 实际产出 md 时落地的策略名
 *
 * 与 strategy 的差异：strategy 是"请求的"，actualStrategy 是"实际跑通的那一档"。
 * structured 内部对任一阶段错误会降级到 lite，此时 strategy='structured'、
 * actualStrategy='structured-fallback-lite'。
 *
 * 旧 record 中可能为 undefined，调用方按 `actualStrategy ?? strategy` 解释即可。
 */
export type ZoteroPdfActualStrategy = 'lite' | 'structured' | 'structured-fallback-lite'

/**
 * 单条 PDF 的解析状态嵌套字段（schema v2 引入）
 */
export interface ZoteroPdfParseState {
  status: ZoteroPdfParseStatus
  /** 实际生成的 .md 绝对路径，仅 status='completed' 时非空 */
  mdPath: string | null
  /** 本次（或最近一次）解析使用的策略 */
  strategy: ZoteroPdfParseStrategy
  /**
   * 本次（或最近一次）实际产出 md 的策略；
   * 仅 status='completed' 时有意义；undefined 视同 strategy
   */
  actualStrategy?: ZoteroPdfActualStrategy
  /**
   * 落地的 wiki md 文件格式版本：
   * - undefined / 1：旧版（H1 + blockquote metadata header + plain markdown body）
   * - 2：YAML frontmatter + `# OUTLINE` + `# CONTENT` + `<p id="pS_P">` 段落锚点
   *
   * 用于下游判断是否需要按新 schema 解析 md；老 record 没有此字段即视为 v1。
   */
  formatVersion?: number
  /** 完成时间 ISO，仅 status='completed' 时非空 */
  parsedAt: string | null
  /** 最近一次失败原因（短文本） */
  error: string | null
  /** 累计尝试次数（含成功的那次）；attempts ≥ MAX_ATTEMPTS 后停止自动重试 */
  attempts: number
  /** 解析时源文件的 mtimeMs / size，用于检测"绕过 Zotero 直接覆盖文件"场景 */
  sourceMtimeMs: number | null
  sourceSize: number | null
}

/**
 * Zotero 父条目的 metadata 摘要（schema v3 引入）
 *
 * 通过批量拉 /users/0/items?itemKey=K1,K2,... 获得，缓存到 ZoteroPdfRecord.parent
 * 避免每次生成 wiki/index.json 都重复请求。
 */
export interface ZoteroParentItemInfo {
  itemKey: string
  /** 'journalArticle' | 'book' | 'preprint' | 'thesis' | ... */
  itemType: string
  title: string | null
  /** Zotero 原始 creators 结构 */
  creators: Array<{
    firstName?: string
    lastName?: string
    name?: string
    creatorType: string
  }>
  /** 原始日期字符串，例如 "2012", "2012-05", "May 2012" */
  date: string | null
  DOI: string | null
  url: string | null
  abstractNote: string | null
  /** 期刊名 / 会议名（也可能是丛书名） */
  publicationTitle: string | null
}

/**
 * Zotero PDF 被动 diff —— 单条 PDF 附件的快照记录（schema v3）
 *
 * 主键 attachmentKey 等于 Zotero attachment item 的 key，亦即 storage 子目录名。
 */
export interface ZoteroPdfRecord {
  attachmentKey: string
  parentItemKey: string | null
  /** Zotero 内部单调递增的 metadata 版本号；本地 API 恒为 0，仅用于审计 */
  version: number
  /** 'imported_file' | 'imported_url'（仅这两种纳入快照） */
  linkMode: string
  contentType: string
  filename: string
  title: string
  /** ISO 时间字符串，可能为 null（旧条目无） */
  dateModified: string | null
  /** v2 引入：解析状态嵌套字段 */
  parse: ZoteroPdfParseState
  /** v3 引入：父条目 metadata 缓存；null 表示无父条目 / 上次拉取失败 */
  parent: ZoteroParentItemInfo | null
  /** v4 引入：article.md 段落总结增强生成状态；null 表示尚未实例化（lazy） */
  article: ZoteroPdfArticleState | null
}

/** 段落总结增强生成的状态（schema v4 引入） */
export type ZoteroPdfArticleStatus =
  | 'idle'
  | 'pending'
  | 'generating'
  | 'completed'
  | 'failed'
  | 'skipped'

/**
 * 单条 PDF 的 article.md 生成状态（schema v4 引入）
 *
 * `parse.status === 'completed'` 是生成 article 的前置条件；article 失败不影响 parse。
 */
export interface ZoteroPdfArticleState {
  status: ZoteroPdfArticleStatus
  /** 输出 .article.md 绝对路径，仅 status='completed' 时非空 */
  articlePath: string | null
  /** 本次（或最近一次）成功完成时间 ISO */
  generatedAt: string | null
  /** frontmatter.created（首次生成日期，重生成不覆盖）'YYYY-MM-DD' */
  articleCreated: string | null
  /** 上次生成所基于的源 md 的 mtimeMs；变化即触发重新生成 */
  sourceMdMtimeMs: number | null
  /** 最近一次失败原因（短文本） */
  error: string | null
  /** 累计尝试次数；attempts ≥ MAX_ATTEMPTS 后停止自动重试 */
  attempts: number
  /** 调用 LLM 的 channel id；用于审计与重新生成 */
  channelId: string | null
  /** 实际使用的模型名 */
  model: string | null
  /** prompt 模板版本号；升级时全量重生成 */
  promptVersion: number
}

/** 段落总结增强（article 生成器）配置（持久化为 zotero-article.json） */
export interface ZoteroArticleConfig {
  /** 总开关，默认 false */
  enabled: boolean
  /** 用哪个 channel-manager 渠道；null = 当前激活渠道 */
  channelId: string | null
  /** 覆盖渠道默认模型；null = 渠道默认 */
  model: string | null
  /** 并发上限 */
  concurrency: number
  /** 单次切片 token 估算上限 */
  maxTokensPerChunk: number
}

/** article 生成队列状态摘要（IPC 查询返回值） */
export interface ZoteroPdfArticleStatusSummary {
  /** 当前开关值 */
  enabled: boolean
  /** snapshot 中的 PDF 总数（不含未 parse completed 的） */
  total: number
  byStatus: Record<ZoteroPdfArticleStatus, number>
  runningKeys: string[]
  recentFailed: Array<{
    attachmentKey: string
    title: string
    filename: string
    error: string
    attempts: number
  }>
}

/**
 * wiki/index.json 单条索引项 —— 把 ZoteroPdfRecord 折叠成消费友好的扁平结构
 *
 * 字段映射规则见 zotero-pdf-parser/index-writer.ts。
 */
export interface ZoteroPdfWikiIndexEntry {
  attachmentKey: string
  parentItemKey: string | null

  // 文献信息（来自 parent，缺则降级到 attachment 自身）
  title: string
  /** "Last, First" 折叠 */
  authors: string[]
  /** 4 位年份；从 parent.date 抽取 */
  year: string | null
  doi: string | null
  publicationTitle: string | null
  itemType: string | null
  abstract: string | null

  // 文件信息
  filename: string
  linkMode: string

  // 解析信息
  parseStatus: ZoteroPdfParseStatus
  /** 仅 parseStatus='completed' 时非空 */
  mdPath: string | null
  parsedAt: string | null

  // 段落总结增强（v4 引入；旧索引读出来时为 null）
  /** 仅 articleStatus='completed' 时非空，绝对路径形如 ~/.asci/zotero/wiki/{key}.article.md */
  articlePath: string | null
  /** null 表示 record.article 字段未实例化（lazy）；其他 ZoteroPdfArticleStatus 见同名类型 */
  articleStatus: ZoteroPdfArticleStatus | null
}

/**
 * wiki/index.json 顶层结构
 *
 * 由 snapshot-store 的串行写锁尾自动生成，每次 snapshot 变动后覆盖。
 */
export interface ZoteroPdfWikiIndex {
  schemaVersion: 1
  generatedAt: string
  total: number
  byStatus: Record<ZoteroPdfParseStatus, number>
  entries: ZoteroPdfWikiIndexEntry[]
}

/**
 * structured .txt 链路一次批量生成的汇总（IPC 返回值）
 *
 * 由用户在设置页"生成结构化 TXT"按钮触发；统计总条数 / 成功 / 跳过 / 失败。
 */
export interface ZoteroStructuredTxtGenerationResult {
  /** snapshot 里的 record 总数 */
  total: number
  /** 成功生成的 .txt 数量 */
  generated: number
  /** 跳过（PDF 文件本地不存在）数量 */
  skipped: number
  /** 失败数量 */
  failed: number
  /** 失败摘要（最多 10 条） */
  failures: Array<{ attachmentKey: string; error: string }>
}

/** PDF 解析队列状态摘要（IPC 查询返回值） */
export interface ZoteroPdfParseStatusSummary {
  /** snapshot 中的 PDF 总数 */
  total: number
  /** 各状态计数 */
  byStatus: Record<ZoteroPdfParseStatus, number>
  /** 当前实际 in-flight 的 attachmentKey 列表 */
  runningKeys: string[]
  /** 最近 5 条失败 record 摘要 */
  recentFailed: Array<{
    attachmentKey: string
    title: string
    filename: string
    error: string
    attempts: number
  }>
}

/**
 * Zotero PDF 被动 diff 的执行结果
 *
 * - first-baseline: 上次快照不存在，本次仅建立基线，added/modified/deleted 均为空
 * - diff: 与上次快照成功 diff 完成
 * - skipped-zotero-offline: Zotero 桌面端不在跑，本次跳过且不写新快照
 * - skipped-disabled: settings.zoteroEnabled=false，自动触发层短路返回（不调 ping/diff）
 * - skipped-noop: 自动触发层心跳分支判定无变化（zotero.sqlite mtime 未变），静默跳过
 * - error: 拉取或写盘失败，详见 message
 *
 * 后两种仅会由 trigger 层产出，runZoteroPdfDiff 本身不会返回。
 */
export interface ZoteroPdfDiffResult {
  status:
    | 'first-baseline'
    | 'diff'
    | 'skipped-zotero-offline'
    | 'skipped-disabled'
    | 'skipped-noop'
    | 'error'
  /** 当前 Zotero 中 PDF 总数（diff 来源 = 当前快照） */
  total: number
  added: ZoteroPdfRecord[]
  modified: Array<{ prev: ZoteroPdfRecord; now: ZoteroPdfRecord }>
  deleted: ZoteroPdfRecord[]
  message?: string
}

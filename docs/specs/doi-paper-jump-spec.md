# 对话流 / 检索报告 DOI 跳转文献详情 Spec

> **状态**：已对齐（2026-06-05 grill-me 评审收口）· 实现中
> **关联 issue**：—（开 PR 时回填）
> **关联分支**：`fix/chat-doi-paper-jump`
> **领域语言事实源**：`CONTEXT.md`（PaperRecord / WorkspacePaperEntry / 本次检索 / 检索报告）

---

## 1. 问题

对话流回答与检索报告中出现的文献 DOI（行内 code、doi.org 链接、裸文本）目前是死文本。
论文明明已在右侧「检索论文」面板里，用户却要肉眼对照 DOI 手动找同一篇——本应一次点击完成的事拆成了「记 DOI → 切面板 → 滚动找 → 点卡片」四步。

## 2. 目标

**点击任意位置的 DOI → 右栏打开该文献详情页**，分三层兜底、永不留死胡同：

1. **命中本次检索** → 打开与面板点击完全一致的详情页（entry → `PaperEntryDetailPanel`，record → `PaperDetailRenderer`）
2. **未命中** → 主进程直调 crossref REST 即时查元数据（≤5s）→ 临时 record 详情页
3. **查询失败/超时** → toast 提示 + 系统浏览器打开 `doi.org` 页面

### 非目标（grill-me 明确不做）

| 不做 | 理由 |
|------|------|
| 派 research subagent 检索单篇 | 确定性查询下沉到代码（crossref REST 1-2s vs LLM 编排 30s+），lit-search 延迟治理的既定原则 |
| crossref 查到的论文写入「本次检索」 | 保护检索口径——报告阈值（≥20/≥50）、各源计数、跨轮去重统计全从 session papers 算，不容点击查询污染 |
| 报告 References `<li data-doi>` 条目加点击 | 综述溯源已由 `[N]` 角标承担（→ PDF 高亮）；References 可见文本按契约无 DOI，给 ref 条目加跳详情是另一个 feature |
| 文献库（library）全库匹配 | 范围收敛在「本次检索 + crossref 兜底」 |
| 点击前预判命中态（视觉区分在/不在面板） | 需要渲染期全量匹配 + 状态同步，且检索流式期间会抖动；点击时现场解析让用户无感知差异 |

## 3. 交互决策记录（grill-me 结论，2026-06-05）

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | DOI 识别形态 | 全部四种：A 行内 code、B doi.org 链接、C 裸文本、D `doi:` 前缀文本；chat 与 HTML 报告两条管线都做 |
| 2 | 未命中行为 | 不弹确认、不派 Agent；直接 crossref 即时查询，失败开外链兜底 |
| 3 | 查询结果落地 | 不写入「本次检索」；临时 record 仅开详情页，`source` 标 `doi-lookup` 不冒充 MCP 来源；持久化出口 = 详情页「加入 Zotero」按钮（硬性验收项） |
| 4 | 视觉 | 复用 `FilePathChip` 配方：`bg-primary/10 text-primary hover:bg-primary/20` + lucide `BookOpen` 12px 图标 + tooltip；静态可供性靠「染色+图标」双信号；图标避开 `FileText`（文件 chip 在用） |
| 5 | loading 反馈 | chip 图标原位换 `Loader2` spinner，不弹 toast |
| 6 | 匹配优先级 | workspace entry 优先于裸 record（与面板 `onOpenPreview` 行为一致） |
| 7 | 翻页导航 | 命中场景设置 `previewPaperSiblingsAtom`（保留 ◀ ▶ n/total）；临时 record 不设 siblings |
| 8 | 综述报告（reviews/*.html） | 按输出契约可见文本无 DOI，TreeWalker 装饰仅作「模型违约输出」的免费兜底；主战场是检索报告 §3 推荐表格的裸文本 DOI 列 |
| 9 | 历史会话 | 同样生效——点击时实时查当前会话 session papers，不依赖检索刚发生 |

## 4. DOI 识别与归一化

**单一事实源**：新建 `apps/electron/src/renderer/lib/doi.ts`，承接 `citation-references.ts` 中现有的
`DOI_PREFIX` / `DOI_BODY` 片段（该文件改为 import，行为零变化——注释原话「集中定义避免两处各写一份易走样」）。

```ts
/** DOI 主体：10.<4-9位注册号>/<后缀>。注册号位数下限 4 天然排除版本号（10.2.3）与小数 */
export const DOI_BODY = '10\\.\\d{4,9}\\/[^\\s)\\]>,;"\']+'
/** 可选前缀：doi:（冒号后容忍空格）/ https://doi.org/ / https://dx.doi.org/ */
export const DOI_PREFIX = '(?:doi:\\s*|https?:\\/\\/(?:dx\\.)?doi\\.org\\/)?'

/** 整串精确匹配（行内 code 用）：整段文本去首尾空白后必须就是一个 DOI（可带前缀） */
export function parseDoiExact(text: string): string | null
/** 多匹配扫描（remark 插件 / TreeWalker 用）：返回 [{ index, length, doi }] */
export function findDois(text: string): DoiMatch[]
/** 归一化为匹配 key：剥前缀 → 剥尾随装饰（[.,;)\]]+$）→ toLowerCase */
export function normalizeDoi(raw: string): string | null
/** 从 href 提取（MarkdownLink / 报告 <a> 用）：仅接受 doi.org / dx.doi.org host */
export function doiFromUrl(href: string): string | null
```

匹配 key 形如 `doi:10.18653/v1/2025.acl-long.28`（小写），与 `recordKey()`（`session-papers-utils.ts:32`）的
`doi:${r.doi.toLowerCase()}` 直接可比。

**误伤防护（测试必覆盖）**：版本号 `10.2.3`、小数 `10.5%`、`10.123/x`（注册号不足 4 位）不得命中；
尾随句点/逗号/右括号/引号剥离；`doi:` 大小写不敏感。

## 5. 架构

### 5.1 文件清单

```
packages/shared/src/types/papers-ipc.ts                          [改] 新通道 LOOKUP_DOI_METADATA + 输入/结果类型
apps/electron/src/main/lib/doi-metadata-lookup.ts                [新] crossref REST 查询 + JSON → PaperRecord 映射
apps/electron/src/main/lib/doi-metadata-lookup.test.ts           [新] 映射与异常路径单测（mock fetch）
apps/electron/src/main/ipc.ts                                    [改] ipcMain.handle 注册
apps/electron/src/preload/index.ts                               [改] papers.lookupDoiMetadata 暴露（类型 + 实现两处）
apps/electron/src/renderer/lib/doi.ts                            [新] DOI regex 单一事实源 + 4 个纯函数
apps/electron/src/renderer/lib/doi.test.ts                       [新] 四形态 + 误伤 + 归一化单测
apps/electron/src/renderer/lib/citation-references.ts            [改] DOI_PREFIX/DOI_BODY 改 import（行为零变化）
apps/electron/src/renderer/components/ai-elements/doi-chip.tsx   [新] DoiChip 组件（含 loading 态）
apps/electron/src/renderer/hooks/useOpenDoiInRightPanel.ts       [新] 点击解析 hook（三层兜底）
apps/electron/src/renderer/components/ai-elements/message.tsx    [改] remarkDois 插件 + MarkdownLink doi 分支 + MarkdownInlineCode doi 分支 + urlTransform 放行 doi://
apps/electron/src/renderer/components/agent/session-papers-filter.ts [改] 抽 buildMergedPaperItems(records, workspacePapers)
apps/electron/src/renderer/components/agent/SessionPapersPanel.tsx   [改] L173-187 merge 逻辑改调共享函数（行为零变化）
apps/electron/src/renderer/components/review-demo/ReviewHtmlRenderer.tsx [改] DOI slot 替换 + portal 渲染 DoiChip
apps/electron/src/renderer/locales/en/conversation/…             [改] doiChip.* keys
apps/electron/src/renderer/locales/zh/conversation/…             [改] 同步（key-parity 守门）
```

版本递增（开 PR 时一次）：`packages/shared` patch +1、`apps/electron` patch +1。

### 5.2 点击解析数据流（useOpenDoiInRightPanel）

```
DoiChip.onClick(doi)
  → normalizeDoi → 失败: return 'failed'（理论不可达，chip 渲染前已校验）
  → sessionId = currentAgentSessionIdAtom
  → records = await window.electronAPI.listSessionPapers(sessionId)   // 点击时实时取，不缓存
  → entries = workspacePapersAtom（useAtomValue，点击时当前值）
  → merged = buildMergedPaperItems(records, entries)                  // 与面板同一函数：recordKey join + url 过滤 + dedupeByIdentity
  → idx = merged.findIndex(recordKey(it.record) === `doi:${norm}` || it.entry?.doi?.toLowerCase() === norm)
  ├─ 命中 idx ≥ 0:
  │    setPaperSiblings({ items: merged, currentIndex: idx })         // 默认序（无面板筛选/排序状态），分母与面板全量一致
  │    openInRightPanel(it.entry ? { kind:'paper-entry', entry } : { kind:'paper', record })
  └─ 未命中:
       res = await window.electronAPI.papers.lookupDoiMetadata({ doi: norm })
       ├─ status 'found':
       │    setPaperSiblings(null)                                    // 临时 record 无翻页
       │    openInRightPanel({ kind:'paper', record: res.record })
       └─ 'not-found' | 'error' | IPC 异常:
            toast.info(t('doiChip.lookupFallback'))
            window.electronAPI.openExternal(`https://doi.org/${norm}`)
```

`listSessionPapers` IPC 异常时跳过匹配直接走 lookup 路径（try/catch，不吞错，console.error 留痕）。
loading 态由 DoiChip 自持（`useState` pending，图标换 `Loader2` 旋转，pending 期间忽略重复点击）。

### 5.3 新 IPC：papers:lookupDoiMetadata（四联同步）

`packages/shared/src/types/papers-ipc.ts` 追加：

```ts
export const PAPERS_IPC_CHANNELS = {
  // …既有三条不动
  /** 按 DOI 查 crossref 元数据 → PaperRecord（对话流 DOI 点击未命中本次检索时的即时查询） */
  LOOKUP_DOI_METADATA: 'papers:lookupDoiMetadata',
} as const

export interface PapersLookupDoiMetadataInput { doi: string }   // 已归一化（小写、无前缀）

export type PapersLookupDoiMetadataResult =
  | { status: 'found'; record: PaperRecord }      // record.source = 'doi-lookup'
  | { status: 'not-found' }                        // crossref 404
  | { status: 'error'; message: string }           // 网络/超时/解析异常，message 仅日志用
```

主进程 `doi-metadata-lookup.ts`：

- 核心元数据：`fetch('https://api.crossref.org/works/' + encodeURIComponent(doi), { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'ASCI (mailto:dev@opensci.io)' } })`（crossref etiquette）
- crossref `message` → `PaperRecord` 映射：`title[0]`（剥内嵌富文本标签）、`author[].given+family`、
  `issued.date-parts[0][0]` → year、`container-title[0]` → venue、`DOI` → doi、`URL` → url、
  `abstract`（JATS XML 剥标签）→ abstract、`is-referenced-by-count` → `extra.citedBy`、
  `source: 'doi-lookup'`、`ts: new Date().toISOString()`、`query: null`
- **摘要多源 fallback**（2026-06-05 实测定档，老章拍板）：crossref 对 Nature / Optica 等出版商
  不提供 `abstract` 字段。crossref 缺摘要时 OpenAlex（重构 `abstract_inverted_index`）与
  Semantic Scholar（`fields=abstract`）**并行**发起、取摘要优先 OpenAlex 其次 S2。仍是确定性
  REST、不派 Agent，各源独立 4s 超时。实测三篇全缺 crossref 摘要的论文：OpenAlex 补回 1 篇、
  Semantic Scholar 三篇全有。
  - **为何并行**：串行（OpenAlex→S2）会让某源的 4s 超时白白拖累另一源（实测 OpenAlex 偶发卡满
    4s 再轮到 S2），并行后总耗时 ≈ 单源 4s 封顶。
  - **三态分类**（错误必须可见）：单源返回 `ok | empty | error`——`empty`=源正常响应但无摘要
    （含 404）；`error`=超时/限流(429)/网络异常。都没拿到摘要时，只要有源是 `error` 就在
    `record.extra.abstractStatus = 'failed'`，详情页显示「摘要获取失败，可重新点击重试」而非
    「不可获取」；两源都 `empty` 才显示「不可获取」（真没有）。
- 全路径 try/catch；crossref 404 → `not-found`，crossref 网络/超时/解析异常 → `error`（不抛给 renderer）
- **进程内缓存**（LRU，cap 256）：同一未命中 DOI 反复点击不再重打网络。只缓存 `found` 且
  `abstractStatus !== 'failed'` 的 record——瞬时失败不缓存以保证「可重试」有效，`not-found` /
  `error` 不缓存。命中检查（listSessionPapers）仍每次实时做，缓存只作用于「未命中→查询」段，
  故两次点击间论文若被新一轮检索纳入「本次检索」，第二次仍正确走 entry 详情。

> 注：主进程改动**不走 Vite HMR**，改 `doi-metadata-lookup.ts` 后需重启 Electron（`bun run dev` 起 electron-vite 会重启主进程）才生效；调试时若摘要行为没变，先确认主进程已重载。

### 5.4 Chat 管线（message.tsx）

| 形态 | 接入点 | 实现 |
|------|--------|------|
| A 行内 code | `MarkdownInlineCode`（L617）文件路径分支之后 | `parseDoiExact(text)` 命中 → `<DoiChip doi label={text} />`；要求**整串**是 DOI，含杂质的 code 不动 |
| B doi.org 链接 | `MarkdownLink`（L478）mention 分支之后、外链分支之前 | `doiFromUrl(href)` 命中 → `<DoiChip doi label={linkText ?? doi} />`（链接文本可能是论文标题，保留展示） |
| C/D 裸文本 / `doi:` 前缀 | 新 remark 插件 `remarkDois`（镜像 `remarkMentions` 结构，L369） | `findDois` 切分 text 节点 → `{ type:'link', url:'doi://<doi>' }`；`MarkdownLink` 加 `doi://` 分支 → DoiChip |

C/D 细节：
- **探针前置**（镜像 `UNVERIFIED_PROBE` 模式）：消息含 `/\b10\.\d{4,9}\//` 才挂插件，避免每条消息空跑 mdast 遍历
- **跳过 link 父节点内的 text**（否则 `[标题](doi.org/…)` 的链接文本被二次包裹）与 inlineCode 节点（A 形态已接管）
- `mentionUrlTransform`（L453）放行 `doi://`

### 5.5 HTML 报告管线（ReviewHtmlRenderer.tsx）

复用既有 **cite → slot → portal** 惯用法（L283-364），在 sanitize + cite 替换之后、KaTeX 之前追加一步：

1. `root.querySelectorAll('a[href]')` 中 `doiFromUrl(href)` 命中者 → 整个 `<a>` 替换为
   `<span data-asci-doi-mount>`，收集 `{ el, doi, label: a.textContent }`
2. TreeWalker 扫剩余文本节点（跳过 `a` / `code` / 已建 slot / KaTeX 定界内文本），`findDois` 命中 →
   切分文本节点插入 slot span
3. 新 state `doiSlots: DoiSlot[]`，渲染段 `createPortal(<DoiChip doi label />, slot.el)`（与 CiteSlot 并列）
4. KaTeX effect 依赖数组补 `doiSlots`（与 slots 同语义：innerHTML 已被覆写时重跑）

适用 `searches/*.html` 与 `reviews/*.html`（同一渲染器，一次实现两处生效）。
检索报告 §3 推荐表格的 DOI 列（裸文本 `<td>`）走第 2 步。

**实现时核验项**：报告内非 DOI 的外部 `<a>` 点击在 Electron 中的实际行为（main 是否有
will-navigate/setWindowOpenHandler 兜底）。若点击无响应（死链），在同一 click 委托里补
`openExternal` 修复，作为正确性修复单独成段报备（不扩散到本 spec 范围外的渲染器）。

### 5.6 DoiChip 组件

```tsx
interface DoiChipProps {
  doi: string          // 已归一化
  label?: string       // 展示文本；缺省显示 doi 原文
  className?: string
}
```

- 视觉：`Button variant="chip"`，类名照搬 `FilePathChip`（`file-path-chip.tsx:90-96`）：
  `h-auto gap-1 rounded px-1.5 py-[2px] text-[12px] leading-[1.6] bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer duration-150 align-baseline not-prose`
- 图标：`BookOpen`（`!size-3 shrink-0`）；pending 时换 `Loader2` + `animate-spin`
- `title={t('doiChip.tooltip')}`；点击调 `useOpenDoiInRightPanel`

## 6. i18n（en + zh 同步，key-parity 守门）

ns：`conversation`（DoiChip 自持 `useT('conversation')`，报告管线复用同一组件即同一组 key）：

| key | zh | en |
|-----|----|----|
| `doiChip.tooltip` | 查看文献详情 | View paper details |
| `doiChip.lookupFallback` | 未找到该文献的元数据，已在浏览器中打开 | Paper metadata not found — opened in browser instead |

## 7. 测试计划

| 层 | 内容 |
|----|------|
| `doi.test.ts` | 四形态解析、归一化（大小写/前缀/尾随装饰）、误伤集（`10.2.3`、`10.5%`、注册号 <4 位）、`doiFromUrl` 仅认 doi.org host |
| `doi-metadata-lookup.test.ts` | crossref JSON → PaperRecord 映射（含 JATS 摘要剥标签、缺字段容错）、404 → not-found、超时 → error |
| 既有回归 | `citation-references` 既有测试（DOI regex 迁移后行为零变化）、`key-parity.test.ts` |
| 手测 golden path | 见 §8 AC，`bun run dev` 走查；zh↔en 切换验 tooltip/toast 无 raw key |

## 8. 验收标准（AC，grill-me 确认版）

**场景 1 — 命中本次检索**
- Given 本会话「检索论文」中存在 DOI 为 X 的论文，When 点击对话流中任意形态的 X（行内 code / doi.org 链接 / 裸文本 / `doi:` 前缀），Then 右栏打开该论文详情页，内容与从面板点开完全一致（entry 优先，◀ ▶ 翻页可用）

**场景 2 — 未命中 → 即时查询**
- Given DOI Y 不在本次检索中，When 点击 Y，Then chip 显示 loading，≤5s 内右栏打开临时详情页，来源显示 `doi-lookup`
- 临时详情页「加入 Zotero」可用，且点击后真实写入 Zotero（不是只长个按钮）
- 该论文不出现在「检索论文」列表，检索报告统计数字不变

**场景 3 — 查询失败兜底**
- When crossref 失败或超 5s，Then toast 提示 + 系统浏览器打开 doi.org 页面（永不留死胡同）

**场景 4 — HTML 报告**
- Given 右栏打开检索报告（`searches/*.html`），When 点击 §3 表格 DOI 单元格（已装饰成 chip），Then 行为与场景 1–3 一致；综述报告（`reviews/*.html`）的 TreeWalker 兜底同款生效；References 条目不因 `data-doi` 获得新点击行为

**视觉与误伤**
- [ ] DOI chip 复用 FilePathChip 配方（primary 染色 + BookOpen + hover 加深 + tooltip），静态可辨「可点击」
- [ ] 非 DOI 数字串不被误染（版本号 / 小数 / 短注册号）
- [ ] 同一 DOI 四种书写形态归一到同一 key，命中判定一致

**工程门槛**
- [ ] 新 IPC 四联同步（shared 常量 → main → preload → renderer）
- [ ] i18n en + zh 同步，key-parity 通过；`bun run typecheck` / `bun test` 通过
- [ ] 临时 record 的 `source` 不冒充 MCP 检索来源

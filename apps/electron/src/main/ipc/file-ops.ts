import { htmlPreviewServer } from '../lib/html-preview/server'
/**
 * 文件系统操作 / 文件预览 IPC 处理器
 *
 * 汇集 Agent 工作区文件系统操作（列目录 / 增删改移 / 打开 / 定位 / 搜索）、附加目录文件操作、
 * 以及文件预览（stat / 读文本 / 读二进制 / 解析 Notebook / 解析 Office / 下载论文 PDF）相关的 IPC 通道。
 */

import { shell, app, ipcMain } from 'electron'
import { nowMs } from '@asci/shared'
import type {
  FileEntry,
  ListDirectoryResult,
  ListDirectoryOptions,
  FileSearchResult,
  PreviewReadTextResult,
  PreviewParseNotebookResult,
  PreviewDownloadPdfInput,
  PreviewDownloadPdfResult,
  DownloadPdfLocalResult,
  NotebookCell,
} from '@asci/shared'
import { isHiddenEntry } from '@asci/shared/utils'
import { AGENT_IPC_CHANNELS } from '@asci/shared'
import { getAgentSessionWorkspacePath, getAgentWorkspacesDir } from '../lib/config-paths'
import { getAgentWorkspace } from '../lib/agent-workspace-manager'

/** 注册文件系统操作 / 文件预览 IPC 处理器 */
export function registerFileOpsIpc(): void {
  ipcMain.handle(AGENT_IPC_CHANNELS.PREVIEW_OPEN_HTML, (_, path: string) => htmlPreviewServer.open(path))
  // ===== Agent 文件系统操作 =====

  // 获取 session 工作路径
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SESSION_PATH,
    async (_, workspaceId: string, sessionId: string): Promise<string | null> => {
      const ws = getAgentWorkspace(workspaceId)
      if (!ws) return null
      return getAgentSessionWorkspacePath(ws.slug, sessionId)
    }
  )

  // 列出目录内容（浅层，安全校验，过滤隐藏条目并返回 hiddenCount）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_DIRECTORY,
    async (_, dirPath: string, options?: ListDirectoryOptions): Promise<ListDirectoryResult> => {
      const { readdirSync } = await import('node:fs')
      const { resolve } = await import('node:path')

      // 安全校验：路径必须在 agent-workspaces 目录下
      const safePath = resolve(dirPath)
      const workspacesRoot = resolve(getAgentWorkspacesDir())
      if (!safePath.startsWith(workspacesRoot)) {
        throw new Error('访问路径超出 Agent 工作区范围')
      }

      const entries: FileEntry[] = []
      let hiddenCount = 0
      const items = readdirSync(safePath, { withFileTypes: true })
      const visibleHiddenEntries = new Set(options?.visibleHiddenEntries ?? [])

      for (const item of items) {
        if (isHiddenEntry(item.name) && !visibleHiddenEntries.has(item.name)) {
          hiddenCount += 1
          continue
        }
        const fullPath = resolve(safePath, item.name)
        entries.push({
          name: item.name,
          path: fullPath,
          isDirectory: item.isDirectory(),
        })
      }

      // 目录在前，文件在后；按名称排序
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      return { entries, hiddenCount }
    }
  )

  // 删除文件或目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_FILE,
    async (_, filePath: string): Promise<void> => {
      const { rmSync } = await import('node:fs')
      const { resolve } = await import('node:path')

      // 安全校验：路径必须在 agent-workspaces 目录下
      const safePath = resolve(filePath)
      const workspacesRoot = resolve(getAgentWorkspacesDir())
      if (!safePath.startsWith(workspacesRoot)) {
        throw new Error('访问路径超出 Agent 工作区范围')
      }

      rmSync(safePath, { recursive: true, force: true })
      console.log(`[Agent 文件] 已删除: ${safePath}`)
    }
  )

  // 用系统默认应用打开文件
  ipcMain.handle(
    AGENT_IPC_CHANNELS.OPEN_FILE,
    async (_, filePath: string): Promise<void> => {
      const { resolve } = await import('node:path')

      const safePath = resolve(filePath)
      const workspacesRoot = resolve(getAgentWorkspacesDir())
      if (!safePath.startsWith(workspacesRoot)) {
        throw new Error('访问路径超出 Agent 工作区范围')
      }

      // 富 HTML 产物（reviews/+searches/ 下 .html）：就地把当前 ASCI 主题烤进文件，让系统
      // 浏览器打开的页面跟随应用主题（文件仍在工作区内，不开临时文件）。
      const { isRichHtmlPath, applyThemeToRichHtmlFile } = await import('../lib/file-preview-service')
      if (isRichHtmlPath(safePath)) {
        const { resolveTheme } = await import('../lib/theme-service')
        applyThemeToRichHtmlFile(safePath, resolveTheme().isDark)
      }

      await shell.openPath(safePath)
    }
  )

  // 在系统文件管理器中显示文件
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SHOW_IN_FOLDER,
    async (_, filePath: string): Promise<void> => {
      const { resolve } = await import('node:path')

      const safePath = resolve(filePath)
      const workspacesRoot = resolve(getAgentWorkspacesDir())
      if (!safePath.startsWith(workspacesRoot)) {
        throw new Error('访问路径超出 Agent 工作区范围')
      }

      shell.showItemInFolder(safePath)
    }
  )

  // 在新窗口中预览文件（允许任意绝对路径）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.PREVIEW_FILE,
    async (_, filePath: string): Promise<void> => {
      const { openFilePreview } = await import('../lib/file-preview-service')
      openFilePreview(filePath)
    }
  )

  // 手动「解析」综述 cite/q → 落 evidence_refs / evidence_set / 更新 source_evidence_set_id。
  // dev 期测试用按钮：UI 传当前预览文件的绝对路径，本 handler 反查 review 行后跑一次抽取。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REVIEW_REPARSE_CITATIONS,
    async (_, bodyPath: string) => {
      const { reparseReviewCitations } = await import(
        '../lib/objects/review-persistence-service'
      )
      const { getDb } = await import('../lib/objects/object-store')
      return reparseReviewCitations(getDb(), { bodyPath })
    }
  )

  // 重命名文件/目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.RENAME_FILE,
    async (_, filePath: string, newName: string): Promise<void> => {
      const { renameSync } = await import('node:fs')
      const { resolve, dirname, join } = await import('node:path')

      const safePath = resolve(filePath)
      const workspacesRoot = resolve(getAgentWorkspacesDir())
      if (!safePath.startsWith(workspacesRoot)) {
        throw new Error('访问路径超出 Agent 工作区范围')
      }

      const newPath = join(dirname(safePath), newName)
      renameSync(safePath, newPath)
      console.log(`[Agent 文件] 已重命名: ${safePath} → ${newPath}`)
    }
  )

  // 移动文件/目录到目标目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.MOVE_FILE,
    async (_, filePath: string, targetDir: string): Promise<void> => {
      const { renameSync } = await import('node:fs')
      const { resolve, basename, join } = await import('node:path')

      const safePath = resolve(filePath)
      const safeTarget = resolve(targetDir)
      const workspacesRoot = resolve(getAgentWorkspacesDir())
      if (!safePath.startsWith(workspacesRoot) || !safeTarget.startsWith(workspacesRoot)) {
        throw new Error('访问路径超出 Agent 工作区范围')
      }

      const newPath = join(safeTarget, basename(safePath))
      renameSync(safePath, newPath)
      console.log(`[Agent 文件] 已移动: ${safePath} → ${newPath}`)
    }
  )

  // 列出附加目录内容（无工作区路径限制，用于用户附加的外部目录）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_ATTACHED_DIRECTORY,
    async (_, dirPath: string): Promise<ListDirectoryResult> => {
      const { readdirSync } = await import('node:fs')
      const { resolve } = await import('node:path')

      const safePath = resolve(dirPath)
      const entries: FileEntry[] = []
      let hiddenCount = 0
      const items = readdirSync(safePath, { withFileTypes: true })

      for (const item of items) {
        if (isHiddenEntry(item.name)) {
          hiddenCount += 1
          continue
        }
        const fullPath = resolve(safePath, item.name)
        entries.push({
          name: item.name,
          path: fullPath,
          isDirectory: item.isDirectory(),
        })
      }

      // 目录在前，文件在后
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      return { entries, hiddenCount }
    }
  )

  // 用系统默认应用打开附加目录文件（无工作区路径限制）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.OPEN_ATTACHED_FILE,
    async (_, filePath: string): Promise<void> => {
      const { resolve } = await import('node:path')
      await shell.openPath(resolve(filePath))
    }
  )

  // 在文件管理器中显示附加目录文件（无工作区路径限制）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SHOW_ATTACHED_IN_FOLDER,
    async (_, filePath: string): Promise<void> => {
      const { resolve } = await import('node:path')
      shell.showItemInFolder(resolve(filePath))
    }
  )

  // 重命名附加目录文件/目录（无工作区路径限制）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.RENAME_ATTACHED_FILE,
    async (_, filePath: string, newName: string): Promise<void> => {
      const { renameSync } = await import('node:fs')
      const { resolve, dirname, join } = await import('node:path')

      const safePath = resolve(filePath)
      const newPath = join(dirname(safePath), newName)
      renameSync(safePath, newPath)
      console.log(`[附加目录] 已重命名: ${safePath} → ${newPath}`)
    }
  )

  // 移动附加目录文件/目录（无工作区路径限制）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.MOVE_ATTACHED_FILE,
    async (_, filePath: string, targetDir: string): Promise<void> => {
      const { renameSync } = await import('node:fs')
      const { resolve, basename, join } = await import('node:path')

      const safePath = resolve(filePath)
      const newPath = join(resolve(targetDir), basename(safePath))
      renameSync(safePath, newPath)
      console.log(`[附加目录] 已移动: ${safePath} → ${newPath}`)
    }
  )

  // 检查路径类型（文件 or 目录），用于拖拽检测
  ipcMain.handle(
    AGENT_IPC_CHANNELS.CHECK_PATHS_TYPE,
    async (_, paths: string[]): Promise<{ directories: string[]; files: string[] }> => {
      const { statSync } = await import('node:fs')
      const directories: string[] = []
      const files: string[] = []
      for (const p of paths) {
        try {
          const stat = statSync(p)
          if (stat.isDirectory()) {
            directories.push(p)
          } else {
            files.push(p)
          }
        } catch {
          // 无法访问的路径忽略
        }
      }
      return { directories, files }
    }
  )

  // 搜索工作区文件（用于 @ 引用，递归扫描，支持附加目录）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SEARCH_WORKSPACE_FILES,
    async (_, rootPath: string, query: string, limit = 20, additionalPaths?: string[]): Promise<FileSearchResult> => {
      const { readdirSync } = await import('node:fs')
      const { resolve, relative } = await import('node:path')

      const safeRoot = resolve(rootPath)
      const ignoreDirs = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv', 'build', '.cache'])
      const ignoreFiles = new Set(['.DS_Store', '.Spotlight-V100', '.Trashes', 'Thumbs.db', 'desktop.ini'])

      // 按来源分组收集文件，用于空 query 时均衡分配结果
      const rootEntries: Array<{ name: string; path: string; type: 'file' | 'dir' }> = []
      const additionalEntryGroups: Array<Array<{ name: string; path: string; type: 'file' | 'dir' }>> = []

      function scan(
        dir: string,
        depth: number,
        baseRoot: string,
        target: Array<{ name: string; path: string; type: 'file' | 'dir' }>,
        useAbsPath: boolean,
      ): void {
        if (depth > 10) return
        try {
          const items = readdirSync(dir, { withFileTypes: true })
          for (const item of items) {
            if (isHiddenEntry(item.name)) continue
            if (ignoreFiles.has(item.name)) continue  // 保留非点号开头的系统文件兜底
            if (item.isDirectory() && ignoreDirs.has(item.name)) continue
            // ASCI 在每个 session cwd 注入身份标记 CLAUDE.md（config-paths.ts），属 harness 内部文件，
            // 不应出现在 @ 引用列表。仅过滤 session 根这一份（主 root：useAbsPath=false 且 depth=0），
            // 不误伤附加目录 / 子目录里用户自建的 CLAUDE.md。
            if (!useAbsPath && depth === 0 && item.name === 'CLAUDE.md') continue

            const fullPath = resolve(dir, item.name)
            const entryPath = useAbsPath ? fullPath : relative(baseRoot, fullPath)
            target.push({
              name: item.name,
              path: entryPath,
              type: item.isDirectory() ? 'dir' : 'file',
            })

            if (item.isDirectory()) {
              scan(fullPath, depth + 1, baseRoot, target, useAbsPath)
            }
          }
        } catch {
          // 忽略无权限的目录
        }
      }

      // session 目录：相对路径
      scan(safeRoot, 0, safeRoot, rootEntries, false)

      // 附加目录：绝对路径（消除歧义，agent 可直接使用）
      if (additionalPaths && additionalPaths.length > 0) {
        for (const addPath of additionalPaths) {
          const addRoot = resolve(addPath)
          const group: Array<{ name: string; path: string; type: 'file' | 'dir' }> = []
          scan(addRoot, 0, addRoot, group, true)
          additionalEntryGroups.push(group)
        }
      }

      // 搜索匹配
      const q = query.toLowerCase()

      if (!q) {
        // 空 query：从各来源交替取结果，确保均衡展示
        const allGroups = [rootEntries, ...additionalEntryGroups].filter((g) => g.length > 0)
        const result: Array<{ name: string; path: string; type: 'file' | 'dir' }> = []
        const groupCount = allGroups.length
        if (groupCount > 0) {
          // 每组至少分配 perGroup 条，剩余名额按需补充
          const perGroup = Math.max(1, Math.floor(limit / groupCount))
          for (const group of allGroups) {
            result.push(...group.slice(0, perGroup))
          }
          // 如果还有剩余名额，按组顺序补充
          if (result.length < limit) {
            for (const group of allGroups) {
              for (let i = perGroup; i < group.length && result.length < limit; i++) {
                result.push(group[i]!)
              }
            }
          }
        }
        const allEntries = [rootEntries, ...additionalEntryGroups].flat()
        return { entries: result.slice(0, limit), total: allEntries.length }
      }

      const allEntries = [rootEntries, ...additionalEntryGroups].flat()
      const matched = allEntries.filter((entry) => {
        const nameLower = entry.name.toLowerCase()
        const pathLower = entry.path.toLowerCase()
        if (nameLower.startsWith(q)) return true
        if (nameLower.includes(q) || pathLower.includes(q)) return true
        // 模糊匹配
        let qi = 0
        for (let i = 0; i < nameLower.length && qi < q.length; i++) {
          if (nameLower[i] === q[qi]) qi++
        }
        return qi === q.length
      })

      // 排序：精确前缀优先，目录优先，路径短优先
      matched.sort((a, b) => {
        const aStartsWith = a.name.toLowerCase().startsWith(q) ? 0 : 1
        const bStartsWith = b.name.toLowerCase().startsWith(q) ? 0 : 1
        if (aStartsWith !== bStartsWith) return aStartsWith - bStartsWith
        if (a.type === 'dir' && b.type !== 'dir') return -1
        if (a.type !== 'dir' && b.type === 'dir') return 1
        return a.path.length - b.path.length
      })

      return { entries: matched.slice(0, limit), total: matched.length }
    }
  )

  // ===== 文件预览 IPC =====

  // 获取文件元信息（大小、是否目录）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.STAT_FILE,
    async (_, filePath: string): Promise<{ size: number; isDirectory: boolean }> => {
      const { stat } = await import('node:fs/promises')
      const info = await stat(filePath)
      return { size: info.size, isDirectory: info.isDirectory() }
    },
  )

  // 读取文本（2MB 默认上限，可覆盖）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.PREVIEW_READ_TEXT,
    async (_, filePath: string, maxBytes: number = 2 * 1024 * 1024): Promise<PreviewReadTextResult> => {
      const { readFile, stat } = await import('node:fs/promises')
      try {
        const info = await stat(filePath)
        // maxBytes<=0：仅探测存在性（stat 即可），不读文件内容。
        // 供 useFileGone 等只关心 notFound 的调用方使用，避免整文件 readFile 浪费。
        if (maxBytes <= 0) return { content: '', truncated: false }
        const truncated = info.size > maxBytes
        const buf = await readFile(filePath)
        const sliced = truncated ? buf.subarray(0, maxBytes) : buf
        return { content: sliced.toString('utf-8'), truncated }
      } catch (err) {
        // 文件不存在（如 Agent 临时脚本跑完即删，产物卡片仍指向它）不抛错，
        // 返回 notFound 让渲染端展示降级提示，避免原始 ENOENT 堆栈上屏（#704 同源）。
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
          return { content: '', truncated: false, notFound: true }
        }
        throw err
      }
    },
  )

  // 读取二进制为 base64
  ipcMain.handle(
    AGENT_IPC_CHANNELS.PREVIEW_READ_BINARY,
    async (_, filePath: string): Promise<string> => {
      const { readFile } = await import('node:fs/promises')
      const buf = await readFile(filePath)
      return buf.toString('base64')
    },
  )

  // 解析 Jupyter Notebook
  ipcMain.handle(
    AGENT_IPC_CHANNELS.PREVIEW_PARSE_NOTEBOOK,
    async (_, filePath: string): Promise<PreviewParseNotebookResult> => {
      const { readFile } = await import('node:fs/promises')
      const raw = await readFile(filePath, 'utf-8')
      const nb = JSON.parse(raw) as {
        cells?: Array<{ cell_type?: string; source?: string | string[]; outputs?: unknown[] }>
        metadata?: { kernelspec?: { name?: string }; language_info?: { name?: string } }
      }
      const cells: NotebookCell[] = (nb.cells ?? []).map((c) => {
        const source = Array.isArray(c.source) ? c.source.join('') : (c.source ?? '')
        const type: NotebookCell['type'] = (c.cell_type === 'code' || c.cell_type === 'markdown' || c.cell_type === 'raw')
          ? c.cell_type
          : 'raw'
        let outputs: string | undefined
        if (type === 'code' && Array.isArray(c.outputs) && c.outputs.length > 0) {
          outputs = c.outputs.map((o) => {
            const obj = o as { text?: string | string[]; data?: Record<string, unknown> }
            if (obj.text) return Array.isArray(obj.text) ? obj.text.join('') : obj.text
            if (obj.data?.['text/plain']) {
              const tp = obj.data['text/plain']
              return Array.isArray(tp) ? tp.join('') : String(tp)
            }
            return ''
          }).join('\n')
        }
        return { type, source, outputs }
      })
      return {
        cells,
        kernelName: nb.metadata?.kernelspec?.name,
        language: nb.metadata?.language_info?.name,
      }
    },
  )

  // 解析 Office 文档为纯文本（复用 document-parser）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.PREVIEW_PARSE_OFFICE,
    async (_, filePath: string): Promise<string> => {
      const { extractTextFromFile } = await import('../lib/document-parser')
      return extractTextFromFile(filePath)
    },
  )

  // 解析 PDF 下载地址 + 抓取字节（按 arxivId > url(.pdf) > url(arxiv abs) 优先级）。
  // 「缓存预览」与「下载到本地」两个 handler 复用，避免重复 URL 解析 / fetch 逻辑。
  const fetchPaperPdf = async (
    input: PreviewDownloadPdfInput,
  ): Promise<{ buf: Buffer; filename: string }> => {
    let targetUrl: string | null = null
    let filename: string | null = null

    if (input.arxivId) {
      targetUrl = `https://arxiv.org/pdf/${input.arxivId}.pdf`
      filename = `arxiv-${input.arxivId.replace(/\//g, '-')}.pdf`
    } else if (input.url && input.url.toLowerCase().endsWith('.pdf')) {
      targetUrl = input.url
      filename = `paper-${nowMs()}.pdf`
    } else if (input.url && input.url.includes('arxiv.org/abs/')) {
      const match = input.url.match(/arxiv\.org\/abs\/([\w./-]+)/)
      const arxivId = match?.[1]
      if (arxivId) {
        targetUrl = `https://arxiv.org/pdf/${arxivId}.pdf`
        filename = `arxiv-${arxivId.replace(/\//g, '-')}.pdf`
      }
    }

    if (!targetUrl || !filename) {
      throw new Error('无法确定 PDF 下载地址（arXiv / PDF URL 均不可用）')
    }

    const response = await fetch(targetUrl)
    if (!response.ok) {
      throw new Error(`下载失败：HTTP ${response.status}`)
    }
    const ab = await response.arrayBuffer()
    return { buf: Buffer.from(ab), filename }
  }

  // 下载论文 PDF 到应用缓存（供右栏内嵌预览）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.PREVIEW_DOWNLOAD_PDF,
    async (_, input: PreviewDownloadPdfInput): Promise<PreviewDownloadPdfResult> => {
      const { writeFile, mkdir } = await import('node:fs/promises')
      const { join } = await import('node:path')
      const { getAttachmentsDir } = await import('../lib/config-paths')

      const { buf, filename } = await fetchPaperPdf(input)
      const cacheDir = join(getAttachmentsDir(), input.sessionId, 'papers-cache')
      await mkdir(cacheDir, { recursive: true })
      const localPath = join(cacheDir, filename)
      await writeFile(localPath, buf)

      return { localPath, size: buf.byteLength }
    },
  )

  // 下载论文 PDF 到系统下载文件夹（用户可见）；重名自动追加序号；完成后在访达/资源管理器定位
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DOWNLOAD_PDF_LOCAL,
    async (_, input: PreviewDownloadPdfInput): Promise<DownloadPdfLocalResult> => {
      const { writeFile } = await import('node:fs/promises')
      const { existsSync } = await import('node:fs')
      const { join, parse } = await import('node:path')

      const { buf, filename } = await fetchPaperPdf(input)
      const downloadsDir = app.getPath('downloads')
      // 重名：foo.pdf → foo (1).pdf → foo (2).pdf …
      const { name, ext } = parse(filename)
      let finalName = filename
      let n = 1
      while (existsSync(join(downloadsDir, finalName))) {
        finalName = `${name} (${n})${ext}`
        n += 1
      }
      const savedPath = join(downloadsDir, finalName)
      await writeFile(savedPath, buf)
      shell.showItemInFolder(savedPath)

      return { savedPath, filename: finalName }
    },
  )
}

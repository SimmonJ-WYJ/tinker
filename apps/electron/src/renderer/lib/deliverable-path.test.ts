import { expect, test, describe } from 'bun:test'
import {
  isSessionDeliverable,
  extOf,
  resolveAgainstCwd,
  extractDeliverablePath,
  extractArtifactReference,
  isArtifactFile,
  deliverableTypeKey,
  extractTitleFromMarkdown,
  PREVIEWABLE_DELIVERABLE_EXTS,
} from './deliverable-path.ts'

const CWD = '/Users/x/.asci-dev/agent-workspaces/proj/sess-1'

describe('extOf', () => {
  test('普通文件名取小写扩展名', () => {
    expect(extOf('research_gap_analysis.md')).toBe('md')
    expect(extOf('Report.PDF')).toBe('pdf')
  })
  test('无扩展名 / 隐藏文件返回空', () => {
    expect(extOf('README')).toBe('')
    expect(extOf('.gitignore')).toBe('')
  })
})

describe('isSessionDeliverable', () => {
  test('cwd 根的可预览文件 → 是产物', () => {
    expect(isSessionDeliverable(`${CWD}/research_gap_analysis.md`, CWD)).toBe(true)
    expect(isSessionDeliverable(`${CWD}/review.html`, CWD)).toBe(true)
  })

  test('子目录里的文件 → 不是产物', () => {
    expect(isSessionDeliverable(`${CWD}/drafts/notes.md`, CWD)).toBe(false)
  })

  test('.context/ 等隐藏目录 / 隐藏文件 → 不是产物', () => {
    expect(isSessionDeliverable(`${CWD}/.context/note.md`, CWD)).toBe(false)
    expect(isSessionDeliverable(`${CWD}/.hiddenfile.md`, CWD)).toBe(false)
  })

  test('不可预览的扩展名 → 不自动打开', () => {
    expect(isSessionDeliverable(`${CWD}/data.bin`, CWD)).toBe(false)
    expect(isSessionDeliverable(`${CWD}/script.sh`, CWD)).toBe(false)
  })

  test('cwd 之外的路径 → 不是产物', () => {
    expect(isSessionDeliverable('/tmp/other.md', CWD)).toBe(false)
  })

  test('cwd 缺失 → false（无法判定层级）', () => {
    expect(isSessionDeliverable(`${CWD}/x.md`, '')).toBe(false)
  })

  test('cwd 带尾部斜杠也能匹配', () => {
    expect(isSessionDeliverable(`${CWD}/x.md`, `${CWD}/`)).toBe(true)
  })

  test('Windows 反斜杠路径归一化后判定', () => {
    const winCwd = 'C:\\Users\\x\\ws\\sess'
    expect(isSessionDeliverable('C:\\Users\\x\\ws\\sess\\out.md', winCwd)).toBe(true)
    expect(isSessionDeliverable('C:\\Users\\x\\ws\\sess\\sub\\out.md', winCwd)).toBe(false)
  })

  test('resolveAgainstCwd：相对路径拼到 cwd，绝对路径原样', () => {
    expect(resolveAgainstCwd('./out.md', CWD)).toBe(`${CWD}/out.md`)
    expect(resolveAgainstCwd('out.md', CWD)).toBe(`${CWD}/out.md`)
    expect(resolveAgainstCwd(`${CWD}/out.md`, CWD)).toBe(`${CWD}/out.md`)
    expect(resolveAgainstCwd('C:\\ws\\out.md', CWD)).toBe('C:\\ws\\out.md')
  })

  test('relative file_path 经 resolve 后能判定为产物', () => {
    expect(isSessionDeliverable(resolveAgainstCwd('./research_gap_analysis.md', CWD), CWD)).toBe(true)
  })

  test('可预览扩展名集合包含常见产物类型(占位)', () => {
    expect(PREVIEWABLE_DELIVERABLE_EXTS.has('md')).toBe(true)
  })
})

describe('extractDeliverablePath', () => {
  test('从「saved to」式文本里提出 cwd 根产物', () => {
    const text = '[报告] has been saved to `research_gap_analysis.md`. If you want...'
    expect(extractDeliverablePath(text, CWD)).toBe(`${CWD}/research_gap_analysis.md`)
  })

  test('中文摘要 + ./ 前缀', () => {
    expect(extractDeliverablePath('已完成，文件在：./index.html', CWD)).toBe(`${CWD}/index.html`)
  })

  test('子目录 / .context 文件不算产物', () => {
    expect(extractDeliverablePath('see `drafts/x.md` and `.context/note.md`', CWD)).toBeNull()
  })

  test('无文件提及 → null', () => {
    expect(extractDeliverablePath('纯文字没有文件', CWD)).toBeNull()
  })

  test('URL 里的文件名不会误命中（解析后含子目录）', () => {
    expect(extractDeliverablePath('见 https://x.com/a/b.md', CWD)).toBeNull()
  })
})

describe('isArtifactFile / extractArtifactReference（卡片用，不分场景含子目录）', () => {
  test('cwd 根产物 → 是', () => {
    expect(isArtifactFile(`${CWD}/research_gap_analysis.md`, CWD)).toBe(true)
  })
  test('子目录产物（searches/、reports/）→ 是（区别于 isSessionDeliverable）', () => {
    expect(isArtifactFile(`${CWD}/searches/2026-06-09_17-42-session-search-report.md`, CWD)).toBe(true)
    expect(isArtifactFile(`${CWD}/reports/x.html`, CWD)).toBe(true)
    // 对比：cwd 根判据会拒绝子目录
    expect(isSessionDeliverable(`${CWD}/searches/x.md`, CWD)).toBe(false)
  })
  test('隐藏段（.context/）→ 否', () => {
    expect(isArtifactFile(`${CWD}/.context/note.md`, CWD)).toBe(false)
  })
  test('cwd 之外 / 不可预览 → 否', () => {
    expect(isArtifactFile('/tmp/x.md', CWD)).toBe(false)
    expect(isArtifactFile(`${CWD}/data.bin`, CWD)).toBe(false)
  })
  test('从「检索报告」式文本提出子目录产物', () => {
    const text = '检索报告已生成：`searches/2026-06-09_17-42-session-search-report.md`'
    expect(extractArtifactReference(text, CWD)).toBe(`${CWD}/searches/2026-06-09_17-42-session-search-report.md`)
  })
})

describe('deliverableTypeKey', () => {
  test('扩展名 → 类型 key', () => {
    expect(deliverableTypeKey('html')).toBe('website')
    expect(deliverableTypeKey('md')).toBe('markdown')
    expect(deliverableTypeKey('pdf')).toBe('pdf')
    expect(deliverableTypeKey('docx')).toBe('document')
    expect(deliverableTypeKey('png')).toBe('image')
    expect(deliverableTypeKey('json')).toBe('data')
    expect(deliverableTypeKey('txt')).toBe('file')
  })
})

describe('extractTitleFromMarkdown', () => {
  test('优先 frontmatter title', () => {
    expect(extractTitleFromMarkdown('---\ntitle: 数云 AI 平台\n---\n# 别的\n正文')).toBe('数云 AI 平台')
  })
  test('无 frontmatter → 取首个 H1', () => {
    expect(extractTitleFromMarkdown('# 空白研究领域评分报告\n\n正文')).toBe('空白研究领域评分报告')
  })
  test('都没有 → null', () => {
    expect(extractTitleFromMarkdown('没有标题的正文\n第二行')).toBeNull()
  })
})

describe('其余占位', () => {
  test('可预览扩展名集合包含常见产物类型', () => {
    for (const e of ['md', 'html', 'pdf', 'docx', 'png']) {
      expect(PREVIEWABLE_DELIVERABLE_EXTS.has(e)).toBe(true)
    }
  })
})

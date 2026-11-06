/**
 * Review HTML 文件预览（reviews/*.html 专用）
 *
 * 与通用 HtmlRenderer 的区别：
 *   - 通用 HtmlRenderer 走 sandbox iframe（安全但样式不与主应用一致）
 *   - 本组件读文件内容 → DOMPurify 白名单 → KaTeX auto-render → 注引装饰
 *     → 与主应用 prose 样式融合，引用角标可点击
 *
 * 由 preview-registry 的 matches 钩子按 path 模式分发：
 * 包含 `/reviews/` 路径 + 扩展名 `.html` 的文件命中本组件，普通 .html 仍走
 * 通用 sandbox 渲染器。
 *
 * v0.2 后增量：组件挂载时按 path 反查 reviews.body_path → reviewId，传给
 * ReviewHtmlRenderer 用以启用 "+ Add note here" 入口。未入库的孤立 HTML
 * 反查返 null，按钮保持 disabled。
 */
import * as React from 'react'

import { ReviewHtmlRenderer } from '@/components/review-demo/ReviewHtmlRenderer.tsx'
import { useT } from '@/hooks/useT'
import { usePreviewScrollMemory } from '@/hooks/usePreviewScrollMemory.ts'
import type { ObjectId } from '@asci/shared'
import type { PreviewRendererProps } from '../preview-registry'

const MAX_BYTES = 2 * 1024 * 1024

export default function ReviewHtmlPreviewRenderer({
  path,
  onError,
}: PreviewRendererProps): React.ReactElement {
  const { t } = useT('preview')
  const [content, setContent] = React.useState<string | null>(null)
  const [truncated, setTruncated] = React.useState(false)
  const [reviewId, setReviewId] = React.useState<ObjectId | undefined>(undefined)
  // 滚动位置记忆（#551）：DOI 跳转论文详情再切回报告时不丢阅读位置。
  // key 用文件绝对路径（会话级唯一）；content 就绪后容器才渲染，故以此为 ready 信号。
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  usePreviewScrollMemory(scrollRef, path, content !== null)

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI
      .previewReadText(path, MAX_BYTES)
      .then((res) => {
        if (cancelled) return
        setContent(res.content)
        setTruncated(res.truncated)
      })
      .catch((err) =>
        onError(err instanceof Error ? err : new Error(String(err))),
      )
    return () => {
      cancelled = true
    }
  }, [path, onError])

  // 反查 reviewId（按 body_path 命中 reviews 行）。未入库的孤立 HTML 返 null →
  // 按钮保持 disabled；不影响其它预览功能（cite 跳转 / "Open full context" 等仍可用）。
  React.useEffect(() => {
    let cancelled = false
    setReviewId(undefined)
    window.electronAPI.reviews
      .resolveByBodyPath({ bodyPath: path })
      .then((res) => {
        if (cancelled) return
        if (res) setReviewId(res.id)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.warn('[ReviewHtmlPreviewRenderer] resolveByBodyPath failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  if (content === null) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        {t('markdown.loading')}
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      data-asci-citations-root
      className="h-full overflow-auto prose prose-sm dark:prose-invert max-w-none p-4 scrollbar-thin"
    >
      {truncated && (
        <div className="not-prose px-3 py-1 mb-3 text-sm text-warning bg-warning/10 border border-warning/30 rounded">
          {t('markdown.truncated')}
        </div>
      )}
      <ReviewHtmlRenderer html={content} reviewId={reviewId} />
    </div>
  )
}

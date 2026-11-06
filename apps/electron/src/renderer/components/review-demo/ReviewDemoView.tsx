/**
 * [mockup] P4 证据链查看器主视图（demo 静态内容）
 *
 * 渲染综述正文 + 内联引用标记。点击引用 toggle 段尾 EvidenceCard 展开。
 * 同一时刻只展开一个引用。
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import { CitationMarker } from './CitationMarker'
import { EvidenceCard } from './EvidenceCard'
import {
  DEMO_REVIEW,
  type DemoParagraph,
  type DemoTextPart,
} from './demo-content'
import { sessionReviewsAtom } from '@/atoms/session-reviews-atoms'

interface ReviewDemoViewProps {
  sessionId: string
}

const WORDS_PER_PAPER = 244 // 让副标题字数随论文数自然变化（demo 用，14 × 244 ≈ 3,420）

export function ReviewDemoView({ sessionId }: ReviewDemoViewProps): React.ReactElement {
  const { t } = useT('library')
  const reviews = useAtomValue(sessionReviewsAtom)
  const [activeRefId, setActiveRefId] = React.useState<string | null>(null)

  // 当前 session 对应的 review 元数据（title / paperCount），找不到时 fallback 到硬编码 demo
  const review = reviews.find((r) => r.id === sessionId)
  const displayTitle = review?.title ?? DEMO_REVIEW.title
  const paperCount = review?.paperCount ?? 14
  const wordCount = (paperCount * WORDS_PER_PAPER).toLocaleString()

  const toggleRef = (refId: string): void => {
    setActiveRefId((prev) => (prev === refId ? null : refId))
  }

  return (
    <div className="h-full overflow-auto bg-background scrollbar-thin">
      <div className="max-w-3xl mx-auto px-8 py-6">
        <h1 className="text-xl font-semibold text-foreground leading-snug tracking-tight mb-2">
          {displayTitle}
        </h1>
        <div className="text-xs text-muted-foreground mb-5">
          {t('reviewDemo.subtitle', { paperCount, wordCount })}
        </div>

        <article className="text-sm text-foreground/90 leading-relaxed space-y-3">
          {DEMO_REVIEW.sections.map((section) => (
            <section key={section.heading} className="space-y-3">
              <h3 className="text-base font-semibold text-foreground mt-4 mb-2">
                {section.heading}
              </h3>
              {section.paragraphs.map((paragraph, idx) => (
                <ParagraphBlock
                  key={`${section.heading}-${idx}`}
                  paragraph={paragraph}
                  activeRefId={activeRefId}
                  onToggleRef={toggleRef}
                  onCloseRef={() => setActiveRefId(null)}
                />
              ))}
            </section>
          ))}
        </article>

        <div
          className={cn(
            'mt-6 flex items-start gap-2 px-3 py-2 rounded-md',
            'bg-muted/40 border border-border/50 text-sm text-muted-foreground',
          )}
        >
          <Info className="size-3.5 flex-shrink-0 mt-0.5" />
          <span>{t('reviewDemo.legend')}</span>
        </div>
      </div>
    </div>
  )
}

interface ParagraphBlockProps {
  paragraph: DemoParagraph
  activeRefId: string | null
  onToggleRef: (refId: string) => void
  onCloseRef: () => void
}

function ParagraphBlock({
  paragraph,
  activeRefId,
  onToggleRef,
  onCloseRef,
}: ParagraphBlockProps): React.ReactElement {
  const activeRefInParagraph = paragraph.parts.find(
    (part): part is { refId: string } =>
      typeof part === 'object' && part.refId === activeRefId,
  )

  return (
    <>
      <p>
        {paragraph.parts.map((part, i) => (
          <PartRenderer
            key={i}
            part={part}
            activeRefId={activeRefId}
            onToggleRef={onToggleRef}
          />
        ))}
      </p>
      {activeRefInParagraph && (
        <EvidenceCard
          refData={DEMO_REVIEW.refs[activeRefInParagraph.refId]!}
          onClose={onCloseRef}
        />
      )}
    </>
  )
}

interface PartRendererProps {
  part: DemoTextPart
  activeRefId: string | null
  onToggleRef: (refId: string) => void
}

function PartRenderer({
  part,
  activeRefId,
  onToggleRef,
}: PartRendererProps): React.ReactElement {
  if (typeof part === 'string') {
    return <>{part}</>
  }
  const refData = DEMO_REVIEW.refs[part.refId]
  if (!refData) return <>[{part.refId}]</>
  return (
    <CitationMarker
      refData={refData}
      active={activeRefId === part.refId}
      onToggle={() => onToggleRef(part.refId)}
    />
  )
}

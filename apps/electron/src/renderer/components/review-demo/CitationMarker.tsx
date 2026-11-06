/**
 * [mockup] P4 内联引用标记
 *
 * indigo = supports / amber = contradicts。点击 toggle 活跃 refId。
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { DemoCitationRef } from './demo-content'

interface CitationMarkerProps {
  refData: DemoCitationRef
  active: boolean
  onToggle: () => void
}

export function CitationMarker({ refData, active, onToggle }: CitationMarkerProps): React.ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      size="chip"
      onClick={onToggle}
      className={cn(
        'h-auto px-1 py-0 rounded border text-sm',
        refData.type === 'supports' &&
          'bg-info/10 text-info border-info/30 hover:bg-info/15 hover:text-info',
        refData.type === 'contradicts' &&
          'bg-warning/10 text-warning border-warning/30 hover:bg-warning/15 hover:text-warning',
        active && 'ring-1 ring-offset-1 ring-foreground/30',
      )}
    >
      [{refData.label}]
    </Button>
  )
}

import type { SDKContentBlock } from '@asci/shared'

/** Tool boundaries, rather than wording, distinguish progress from the deliverable. */
export function processPresentation<T extends { block: SDKContentBlock }>(blocks: T[], compact: boolean) {
  const lastTool = blocks.findLastIndex(({ block }) => block.type === 'tool_use')
  if (!compact) return { records: [] as T[], answer: blocks }
  if (lastTool < 0) return { records: [] as T[], answer: blocks.filter(({block}) => block.type !== 'thinking') }
  return {
    records: blocks.slice(0, lastTool + 1).filter(({ block }) => block.type !== 'thinking'),
    answer: blocks.slice(lastTool + 1).filter(({ block }) => block.type !== 'thinking'),
  }
}

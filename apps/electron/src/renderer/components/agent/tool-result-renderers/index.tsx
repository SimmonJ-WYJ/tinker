/**
 * ToolResultRenderer — 工具结果分发渲染器
 *
 * 根据工具名称分发到对应的专属渲染器，
 * 未匹配时使用 DefaultResultRenderer。
 */

import * as React from 'react'
import { BashResultRenderer } from './bash-result'
import { ReadResultRenderer } from './read-result'
import { EditResultRenderer } from './edit-result'
import { WriteResultRenderer } from './write-result'
import { GrepResultRenderer } from './grep-result'
import { GlobResultRenderer } from './glob-result'
import { WebSearchResultRenderer } from './web-search-result'
import { WebFetchResultRenderer } from './web-fetch-result'
import { PaperSearchResultRenderer } from './paper-search-result.tsx'
import { ResearchGapResultRenderer } from './research-gap-result.tsx'
import { DefaultResultRenderer } from './default-result'

export interface ToolResultRendererProps {
  toolName: string
  input: Record<string, unknown>
  result: string
  isError: boolean
  /** 当前会话 cwd，用于把工具结果里的相对路径解析为可打开的绝对路径 */
  basePath?: string
}

export function ToolResultRenderer({ toolName, input, result, isError, basePath }: ToolResultRendererProps): React.ReactElement {
  switch (toolName) {
    case 'Bash':
      return <BashResultRenderer result={result} isError={isError} input={input} />
    case 'Read':
      return <ReadResultRenderer result={result} isError={isError} input={input} />
    case 'Edit':
      return <EditResultRenderer result={result} isError={isError} input={input} basePath={basePath} />
    case 'Write':
      return <WriteResultRenderer result={result} isError={isError} input={input} basePath={basePath} />
    case 'Grep':
      return <GrepResultRenderer result={result} isError={isError} input={input} />
    case 'Glob':
      return <GlobResultRenderer result={result} isError={isError} />
    case 'WebSearch':
      return <WebSearchResultRenderer result={result} isError={isError} />
    case 'WebFetch':
      return <WebFetchResultRenderer result={result} isError={isError} />
    case 'mcp__paper-search__process_search_results':
      return <PaperSearchResultRenderer result={result} isError={isError} input={input} />
    case 'mcp__researchgap__present_research_gap_table':
      return <ResearchGapResultRenderer result={result} isError={isError} input={input} />
    default:
      return <DefaultResultRenderer result={result} isError={isError} />
  }
}

export { CollapsibleResult } from './collapsible-result'

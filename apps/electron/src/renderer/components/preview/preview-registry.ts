import type * as React from 'react'
import type { PreviewTarget } from '@/atoms/side-panel-layout'

export type { PreviewTarget }

export interface PreviewRendererProps {
  /** 文件绝对路径 */
  path: string
  displayName?: string
  /** 文件大小（字节），用于 renderer 内部判断降级 */
  size: number
  /** 渲染失败时由 renderer 调用，上抛给 ErrorBoundary */
  onError: (err: Error) => void
}

export interface PreviewRenderer {
  /** 小写扩展名列表，如 ['md', 'markdown'] */
  extensions: string[]
  /** 文件字节上限；超过则不匹配（调用方降级为"另开窗口"） */
  maxSize?: number
  /** 渲染组件，懒加载 */
  Component: React.LazyExoticComponent<React.FC<PreviewRendererProps>>
  /**
   * 可选：在扩展名匹配之外补加 path 模式 / 元数据匹配。
   * 返回 true 时本 renderer 认领该 target；返回 false 时跳过到下一条注册项。
   * 未设置时仅按 extensions 匹配（向后兼容老的注册项）。
   *
   * 用于"reviews/ 下的 .html 走 ReviewHtmlPreviewRenderer，普通 .html 走通用
   * HtmlRenderer（sandbox iframe）"这种 path-aware 分发场景。
   */
  matches?: (target: PreviewTarget) => boolean
}

const registry: PreviewRenderer[] = []

export function registerRenderer(r: PreviewRenderer): void {
  registry.push(r)
}

export function clearRegistry(): void {
  registry.length = 0
}

/**
 * 解析一个预览目标对应的 renderer
 * - 仅对 kind === 'file' 生效；paper 类型返回 null（由上层直接 dispatch 到 PaperDetailRenderer）
 * - 扩展名大小写不敏感
 * - 若 renderer 设置了 maxSize 且 target.size 超出，返回 null
 * - 若 renderer 设置了 matches 钩子，扩展名匹配后还要 matches 返回 true 才算命中；
 *   matches=false 时跳过此 renderer 继续找下一条（**不**直接返回 null，因为后注册的
 *   通用 renderer 可能仍能 handle 同扩展名）。
 * - 注册顺序即匹配优先级：path-aware 的特化 renderer 应在通用 renderer 之前注册。
 */
export function resolveRenderer(target: PreviewTarget): PreviewRenderer | null {
  if (target.kind !== 'file') return null
  const ext = target.ext.toLowerCase()
  for (const r of registry) {
    if (!r.extensions.includes(ext)) continue
    if (r.maxSize !== undefined && target.size > r.maxSize) continue
    if (r.matches && !r.matches(target)) continue
    return r
  }
  return null
}

export function listRegisteredExtensions(): string[] {
  const all = new Set<string>()
  for (const r of registry) for (const e of r.extensions) all.add(e)
  return Array.from(all).sort()
}

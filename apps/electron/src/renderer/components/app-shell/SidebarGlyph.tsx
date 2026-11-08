import type * as React from 'react'
import chevron from '@/assets/sidebar/chevron.svg'
import collapse from '@/assets/sidebar/collapse.svg'
import back from '@/assets/sidebar/back.svg'
import forward from '@/assets/sidebar/forward.svg'
import plus from '@/assets/sidebar/plus.svg'
import search from '@/assets/sidebar/search.svg'
import folder from '@/assets/sidebar/folder.svg'
import folderOpen from '@/assets/sidebar/folderOpen.svg'
import projectAdd from '@/assets/sidebar/projectAdd.svg'

const GLYPHS = {
  chevron, collapse, back, forward, plus, search, folder, folderOpen, projectAdd,
}

/** 使用 Figma 115:645 的原始矢量和固有尺寸，点击区由外层按钮提供。 */
export function SidebarGlyph({ name }: { name: keyof typeof GLYPHS }): React.ReactElement {
  return <img className="tinker-sidebar-glyph" data-glyph={name} src={GLYPHS[name]} alt="" aria-hidden="true" draggable={false} />
}

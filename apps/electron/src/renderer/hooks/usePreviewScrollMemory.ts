/**
 * 预览滚动容器的滚动位置记忆（issue #551）
 *
 * 解决：检索报告（searches/*.html，走 ReviewHtmlPreviewRenderer）里点 DOI 角标跳到
 * 论文详情 tab，看完切回报告时——报告所在的 InlinePreview 分支按 currentPreview.kind
 * 重新路由，ReviewHtmlPreviewRenderer 被整体卸载/重挂载，scrollTop 归零，长报告被迫
 * 从头重滚。
 *
 * 与 useScrollPositionMemory（对话列表专用、绑定 use-stick-to-bottom、存「距底距离」）
 * 不同：本 hook 面向普通 overflow-auto 容器，存绝对 scrollTop，按 key 隔离。沿用同一套
 * 成例——模块级 Map 缓存 + scroll 持续保存 + ready 后恢复 + rAF 轮询对抗异步排版回流。
 *
 * 关键时序：报告内容经 IPC 异步读入后才渲染滚动容器，DOI chip / cite portal / KaTeX
 * 又在首帧之后才把容器高度撑开。若挂载即落位，容器还不够高 → scrollTop 被浏览器钳到
 * 顶部。所以恢复走逐帧轮询，等容器高到能容纳目标位置再一次性落位；用户中途手动滚动
 * 则立即让位，不与用户抢滚动。
 */
import * as React from 'react'

/**
 * 模块级缓存：key → scrollTop(px)。
 * 调用方用「会话级唯一」的 key（检索报告用文件绝对路径，路径本身落在
 * 各会话独立的工作区目录下）→ 切到新会话时报告是另一个路径、命不中旧 entry，
 * 天然回到顶部（满足 #551「新 session 报告 tab 不继承上个 session 滚动位置」）。
 */
const previewScrollCache = new Map<string, number>()

/** ~1s @60fps：等异步排版（KaTeX / DOI chip / 字体）把容器高度撑开的轮询上限 */
const MAX_RESTORE_FRAMES = 60

/**
 * 记忆并在重挂载时恢复一个滚动容器的 scrollTop。
 *
 * @param ref    滚动容器（overflow 在 y 方向为 auto/scroll 的元素）的 ref
 * @param key    会话级唯一标识（同一容器跨卸载/重挂载须保持稳定）
 * @param ready  内容是否已就绪（容器是否已渲染）；false 时不挂监听、不恢复
 */
export function usePreviewScrollMemory<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  key: string,
  ready: boolean,
): void {
  React.useEffect(() => {
    if (!ready) return
    const el = ref.current
    if (!el) return

    // 用户一旦手动滚动即置真 → 放弃自动恢复，避免把用户已经滚到的位置抢回去
    let userScrolled = false
    let restoreRaf = 0
    let saveRaf = 0

    // —— 恢复：逐帧轮询，等容器够高再一次性落位（否则会被钳到顶部）——
    const saved = previewScrollCache.get(key)
    if (saved != null && saved > 0) {
      let frames = 0
      const tryRestore = (): void => {
        const node = ref.current
        if (userScrolled || !node) return
        const maxScroll = node.scrollHeight - node.clientHeight
        if (maxScroll >= saved) {
          node.scrollTop = saved // 浏览器自动钳制到 [0, maxScroll]
          return
        }
        if (frames >= MAX_RESTORE_FRAMES) return
        frames++
        restoreRaf = requestAnimationFrame(tryRestore)
      }
      restoreRaf = requestAnimationFrame(tryRestore)
    }

    // —— 保存：滚动时按 rAF 节流写入当前 scrollTop ——
    const onScroll = (): void => {
      userScrolled = true
      if (saveRaf) return
      saveRaf = requestAnimationFrame(() => {
        saveRaf = 0
        const node = ref.current
        if (node) previewScrollCache.set(key, node.scrollTop)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      if (restoreRaf) cancelAnimationFrame(restoreRaf)
      if (saveRaf) {
        cancelAnimationFrame(saveRaf)
        previewScrollCache.set(key, el.scrollTop)
      }
      el.removeEventListener('scroll', onScroll)
    }
  }, [ready, key, ref])
}

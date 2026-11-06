/**
 * Review 正文 I/O 服务
 *
 * 综述元数据走 SQLite `reviews` 表（review-repository.ts），**正文文件由
 * `reviews.body_path` 列引用**，绝对路径直接落到产出方写的位置：
 *   - cwd 模式（litreview / literature-review-result skill 真实链路）：
 *     <session cwd>/reviews/{YYYY-MM-DD_HH-mm}-{slug}.html （v0.19.0+；老数据
 *     仍可能是 `.md`，本服务按 bodyPath 直读，不挑扩展名）
 *     —— 不复制镜像；删 session 文件夹综述正文就丢，符合 dev 期"一处真相"原则
 *   - inline 模式（兜底 <asci-review-artifact>）：会显式 writeReviewBody
 *     到 ~/.asci/reviews/{id}.{ext}（由调用方传入 ext，新链路默认 'html'）
 *   - DB 行的 bodyPath 为空时（旧 demo / 历史数据）：兜底按 id 推导
 *     ~/.asci/reviews/{id}.{html,md} —— 优先 .html 再回退 .md 兼容老数据
 *
 * 错误处理：写失败抛错，由上层决定是否回滚 DB 行。读失败（文件不存在）
 * 返回 null，与 repo getReviewById 的语义对齐。
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import type { ObjectId, Review } from '@asci/shared'

import { getReviewBodyPath } from '../config-paths.ts'

export type ReviewBodyExt = 'md' | 'html'

/**
 * 写入综述正文到内置目录 `~/.asci/reviews/{id}.{ext}`。
 * **仅 inline 模式 / 测试场景使用**；cwd 模式只把 path 写进 DB，不再调本函数。
 *
 * - 目录由 getReviewBodyPath → getReviewsDir 兜底创建
 * - 已存在文件会被覆写（用于同会话二次完成）
 */
export function writeReviewBody(
  reviewId: ObjectId,
  body: string,
  ext: ReviewBodyExt = 'html',
): void {
  const path = getReviewBodyPath(reviewId, ext)
  writeFileSync(path, body, 'utf-8')
  console.log(`[review-body] ✅ 写入 ${path} (${body.length} 字符)`)
}

/**
 * 读取综述正文。
 *
 * 入参：完整 Review 对象（要拿到 bodyPath 列），或仅 reviewId（兼容旧调用）。
 *
 * 解析顺序：
 *   1. review.bodyPath 非空且文件存在 → 直接读它（cwd 模式 / 已升级数据）
 *   2. review.bodyPath 为空 → 尝试 `~/.asci/reviews/{id}.html` 再回退 `.md`
 *   3. 都找不到 → 返回 null
 */
export function readReviewBody(reviewOrId: Review | ObjectId): string | null {
  if (typeof reviewOrId !== 'string') {
    const path = resolveReviewBodyPath(reviewOrId)
    return path ? readFileSync(path, 'utf-8') : null
  }
  return readReviewBodyFromConfigDir(reviewOrId)
}

/**
 * 解析综述正文的实际文件路径（解析顺序与 readReviewBody 一致：
 * bodyPath 优先，兜底 `~/.asci/reviews/{id}.{html,md}`）。找不到返回 null。
 *
 * 供需要文件本身（而非内容）的调用方使用，如数据导出打包（export-service）。
 */
export function resolveReviewBodyPath(review: Review): string | null {
  if (review.bodyPath && existsSync(review.bodyPath)) return review.bodyPath
  for (const ext of ['html', 'md'] as const) {
    const path = getReviewBodyPath(review.id, ext)
    if (existsSync(path)) return path
  }
  return null
}

function readReviewBodyFromConfigDir(reviewId: ObjectId): string | null {
  // v0.19.0+：新链路写 html；老数据按 md 兜底回退（顺序 html → md）
  for (const ext of ['html', 'md'] as const) {
    const path = getReviewBodyPath(reviewId, ext)
    if (existsSync(path)) return readFileSync(path, 'utf-8')
  }
  return null
}

/**
 * 删除综述正文文件。仅供硬删除 / 失败回滚使用；软删（visibility='deleted'）
 * 不调用此函数，文件保留作为可恢复备份。
 *
 * **只删本仓库自己写的镜像**（~/.asci/reviews/{id}.{html,md}），**不删**
 * skill 产出方在 session cwd 下写的原始文件 —— 那是产出方的资产，不归我们管。
 * 文件不存在不抛错（force=true），调用方可重复调用。
 */
export function deleteReviewBody(reviewId: ObjectId): void {
  for (const ext of ['html', 'md'] as const) {
    rmSync(getReviewBodyPath(reviewId, ext), { force: true })
  }
}

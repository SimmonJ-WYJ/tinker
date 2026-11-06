/**
 * [mockup] Session 内存中的「综述」列表
 *
 * 演示阶段：列表初始为空，由真实编排填充。
 * 正式版本：Agent 真编排 → 综述完成 hook → 落 ~/.asci/reviews/{id}.md
 * + ~/.asci/evidence-refs/{review-id}.jsonl，本 atom 改为 hydrate from 主进程。
 */

import { atom } from 'jotai'
import { DEMO_RAG_SESSION_ID } from '@/components/review-demo/demo-content'

export interface ReviewSession {
  id: string
  title: string
  topic: string
  paperCount: number
  createdAt: number
}

export const REVIEW_SESSION_ID_PREFIX = '__review:'

export const sessionReviewsAtom = atom<ReviewSession[]>([])

export function isReviewSessionId(sessionId: string): boolean {
  return sessionId === DEMO_RAG_SESSION_ID || sessionId.startsWith(REVIEW_SESSION_ID_PREFIX)
}

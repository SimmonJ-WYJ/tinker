#!/usr/bin/env bun
/**
 * 手动种一条综述（开发自检用）
 *
 * 跳过大模型 / agent-orchestrator，直接拼一个合法的 <asci-review-artifact> 块
 * 调用 maybePersistReviewFromMessages，验证 review-persistence-service 整条链路
 * 是否能正常落库 + 写文件。
 *
 * 用法：
 *   ASCI_DEV=1 bun run scripts/seed-review-dev.ts
 *   ASCI_DEV=1 bun run scripts/seed-review-dev.ts --session sess-xyz --title "RAG 综述"
 *
 * 前置：本地 ~/.asci-dev/objects.db 已是带 topic / agent_session_id 的新 schema
 *      （首次启动 ASCI 后会自动建表；或者删旧 DB 重建）。
 */

import { getDb, initObjectStore } from '../src/main/lib/objects/object-store.ts'
import { maybePersistReviewFromMessages } from '../src/main/lib/objects/review-persistence-service.ts'
import type { AgentMessage } from '@asci/shared'

// ---- 解析极简 CLI 参数 ----
function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def
}

const sessionId = arg('session', `seed-${Date.now()}`)
const title = arg('title', '手动种入的测试综述')
const topic = arg('topic', 'RAG 测试主题')
const intent = arg('intent', '验证综述实体化链路')

// ---- 拼一段符合 contract 的 artifact 文本 ----
const artifactText = `Some preamble chatter, evidence table 等正文…

<asci-review-artifact>
---
title: ${title}
topic: ${topic}
---
<!DOCTYPE html><html><body>
  <h1>${title}</h1>
  <p>这是一段示例正文，<span data-sentence-id="s-1">本句带 sentence-id 占位锚</span>。</p>
  <p>第二段，<span data-sentence-id="s-2">另一条句子</span>，下版会被 EvidenceRef 抽取。</p>
</body></html>
</asci-review-artifact>
`

const fakeMessages: AgentMessage[] = [
  { id: 'm-1', role: 'user', content: intent, createdAt: Date.now() - 1000 },
  { id: 'm-2', role: 'assistant', content: artifactText, createdAt: Date.now() },
]

// ---- 跑 ----
initObjectStore()
const res = maybePersistReviewFromMessages(getDb(), {
  agentSessionId: sessionId,
  intent,
  messages: fakeMessages,
})

if (!res) {
  console.error('❌ 解析失败：artifact 没被识别（不应发生）')
  process.exit(1)
}

console.log(`✅ ${res.mode} review:`)
console.log(`   id:               ${res.review.id}`)
console.log(`   title:            ${res.review.title}`)
console.log(`   topic:            ${res.review.topic}`)
console.log(`   agentSessionId:   ${res.review.agentSessionId}`)
console.log(`   sourceCapability: ${res.review.sourceCapability}`)
console.log(`   body file:        ~/.asci${process.env.ASCI_DEV === '1' ? '-dev' : ''}/reviews/${res.review.id}.html`)

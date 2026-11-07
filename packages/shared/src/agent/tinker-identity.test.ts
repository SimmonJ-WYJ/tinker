import { expect, test } from 'bun:test'
import { buildLeanSystemPrompt } from './runtime-policy.ts'
test('所有轻量模式都以 Tinker 自称，不继承 ASCI 身份',()=>{
 for(const profile of ['conversation','general','coding'] as const){
 const prompt=buildLeanSystemPrompt(profile,'zh')
 expect(prompt).toContain('You are Tinker')
 expect(prompt).not.toContain('You are ASCI')
 }
})

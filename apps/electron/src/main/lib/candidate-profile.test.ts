import { describe, expect, test, afterEach } from 'bun:test'
import { getCandidateRoot, isTinkerCandidate } from './candidate-profile'
const before = process.env.TINKER_CANDIDATE
afterEach(() => {
  if (before === undefined) delete process.env.TINKER_CANDIDATE
  else process.env.TINKER_CANDIDATE = before
})
describe('isolated Tinker candidate profile', () => {
  test('uses a separate persistent folder, not the existing app profile', () => {
    expect(getCandidateRoot('/Users/example/Library/Application Support')).toBe('/Users/example/Library/Application Support/Tinker Candidate')
  })
  test('only explicit candidate builds activate isolation', () => {
    delete process.env.TINKER_CANDIDATE
    expect(isTinkerCandidate()).toBe(false)
    process.env.TINKER_CANDIDATE = '0'
    expect(isTinkerCandidate()).toBe(false)
    process.env.TINKER_CANDIDATE = '1'
    expect(isTinkerCandidate()).toBe(true)
  })
})

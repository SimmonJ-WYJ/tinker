import { join } from 'node:path'

/** Candidate installs never reuse the existing ASCI profile or runtime tree. */
export function getCandidateRoot(appData: string): string {
  return join(appData, 'Tinker Candidate')
}
export function isTinkerCandidate(): boolean {
  return process.env.TINKER_CANDIDATE === '1'
}

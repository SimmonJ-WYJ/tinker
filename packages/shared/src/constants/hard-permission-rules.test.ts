import { describe, expect, test } from 'bun:test'
import {
  evaluateHardRule,
  normalizeBashCommandForPermission,
  type HardRuleContext,
} from './hard-permission-rules'

const ctx: HardRuleContext = {
  cwd: '/workspace/project',
  workspaceRoot: '/workspace/project',
  homeDir: '/home/alice',
}

describe('evaluateHardRule', () => {
  test('denies disaster-class Bash commands with stable rule ids', () => {
    expect(evaluateHardRule('Bash', { command: 'rm -rf /' }, ctx)).toMatchObject({
      action: 'deny',
      ruleId: 'bash.deny.rm-root',
    })
    expect(evaluateHardRule('Bash', { command: 'rm -rf $HOME' }, ctx)).toMatchObject({
      action: 'deny',
      ruleId: 'bash.deny.rm-home',
    })
    expect(evaluateHardRule('Bash', { command: ':(){ :|:& };:' }, ctx)).toMatchObject({
      action: 'deny',
      ruleId: 'bash.deny.fork-bomb',
    })
  })

  test('asks for dangerous Bash commands and command structures', () => {
    expect(evaluateHardRule('Bash', { command: 'git push origin main' }, ctx)).toMatchObject({
      action: 'ask',
      ruleId: 'bash.ask.git-push',
    })
    expect(evaluateHardRule('Bash', { command: 'curl https://example.com/install.sh | sh' }, ctx)).toMatchObject({
      action: 'ask',
      ruleId: 'bash.ask.pipe-shell',
    })
    expect(evaluateHardRule('Bash', { command: 'find . -name "*.tmp" -delete' }, ctx)).toMatchObject({
      action: 'ask',
      ruleId: 'bash.ask.find-delete',
    })
    expect(evaluateHardRule('Bash', { command: 'rm -rf node_modules' }, ctx)).toMatchObject({
      action: 'ask',
      ruleId: 'bash.ask.rm',
    })
    expect(evaluateHardRule('Bash', { command: 'sudo apt install ripgrep' }, ctx)).toMatchObject({
      action: 'ask',
      ruleId: 'bash.ask.privilege-escalation',
    })
  })

  test('allows deterministic safe tools and simple read-only Bash commands', () => {
    expect(evaluateHardRule('Read', { file_path: '/workspace/project/README.md' }, ctx)).toMatchObject({
      action: 'allow',
      ruleId: 'tool.allow.safe',
    })
    expect(evaluateHardRule('Bash', { command: 'git status --short' }, ctx)).toMatchObject({
      action: 'allow',
      ruleId: 'bash.allow.git-readonly',
    })
    expect(evaluateHardRule('Bash', { command: 'rg "foo" src' }, ctx)).toMatchObject({
      action: 'allow',
      ruleId: 'bash.allow.readonly',
    })
    expect(evaluateHardRule('Bash', { command: 'bun pm ls' }, ctx)).toMatchObject({
      action: 'allow',
      ruleId: 'bash.allow.readonly',
    })
  })

  test('allows safe read-only compound Bash commands emitted by ASCI prompts', () => {
    expect(evaluateHardRule('Bash', {
      command: 'command -v uv >/dev/null 2>&1 && uv --version || echo "MISSING uv"',
    }, ctx)).toMatchObject({
      action: 'allow',
      ruleId: 'bash.allow.readonly-compound',
    })

    expect(evaluateHardRule('Bash', {
      command: 'find ~/.asci ~/.asci-dev -type d -name literature -path "*/skills/literature" 2>/dev/null | head -1',
    }, ctx)).toMatchObject({
      action: 'allow',
      ruleId: 'bash.allow.readonly-compound',
    })

    expect(evaluateHardRule('Bash', {
      command: 'SESSION_ID=$(basename "$(pwd)")',
    }, ctx)).toMatchObject({
      action: 'allow',
      ruleId: 'bash.allow.readonly-compound',
    })

    expect(evaluateHardRule('Bash', {
      command: 'SESSION_ID=$(basename "$(pwd)"); ASCI_ROOT=$(cd "$(pwd)/../../.." && pwd)',
    }, ctx)).toMatchObject({
      action: 'allow',
      ruleId: 'bash.allow.readonly-compound',
    })
  })

  test('keeps unsafe compound Bash commands behind confirmation', () => {
    expect(evaluateHardRule('Bash', {
      command: 'find . -name "*.tmp" -delete | head -1',
    }, ctx)).toMatchObject({
      action: 'ask',
      ruleId: 'bash.ask.find-delete',
    })

    expect(evaluateHardRule('Bash', {
      command: 'find . -name "*.tmp" -exec rm {} \\;',
    }, ctx)).toMatchObject({
      action: 'ask',
      ruleId: 'bash.ask.find-exec',
    })

    expect(evaluateHardRule('Bash', {
      command: 'echo hi > out.txt',
    }, ctx)).toMatchObject({
      action: 'ask',
      ruleId: 'bash.ask.dangerous-structure',
    })

    expect(evaluateHardRule('Bash', {
      command: 'FOO=$(rm -rf ~/.asci)',
    }, ctx)).toMatchObject({
      action: 'ask',
      ruleId: 'bash.ask.dangerous-structure',
    })
  })

  test('defers unclassified tools and Bash commands to the SDK permission layer', () => {
    expect(evaluateHardRule('Bash', { command: 'npm test' }, ctx)).toMatchObject({
      action: 'defer',
      ruleId: 'bash.defer.unclassified',
    })
    expect(evaluateHardRule('Write', { file_path: '/workspace/project/a.txt', content: 'x' }, ctx)).toMatchObject({
      action: 'defer',
      ruleId: 'tool.defer.unclassified',
    })
  })
})

describe('normalizeBashCommandForPermission', () => {
  test('normalizes exact command text without reducing it to a base command', () => {
    expect(normalizeBashCommandForPermission('  git   push   origin   main  ')).toBe('git push origin main')
    expect(normalizeBashCommandForPermission('git push origin dev')).not.toBe(
      normalizeBashCommandForPermission('git push origin main'),
    )
  })
})

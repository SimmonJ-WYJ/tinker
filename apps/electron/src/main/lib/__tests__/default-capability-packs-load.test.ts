import { test, expect } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RETIRED_BUILTIN_PACK_IDS, RETIRED_BUILTIN_SKILL_SLUGS } from '@asci/shared'

test('retired builtin bundles are absent from the distribution, generic document skills remain', () => {
 const root = join(import.meta.dir, '../../../..')
 for (const id of RETIRED_BUILTIN_PACK_IDS) expect(existsSync(join(root, 'default-capability-packs', id))).toBe(false)
 for (const slug of RETIRED_BUILTIN_SKILL_SLUGS) expect(existsSync(join(root, 'default-skills', slug))).toBe(false)
 for (const slug of ['pdf', 'docx', 'pptx', 'xlsx']) expect(existsSync(join(root, 'default-skills', slug, 'SKILL.md'))).toBe(true)
 expect(readFileSync(join(root, 'electron-builder.yml'), 'utf8')).not.toContain('from: default-capability-packs')
})

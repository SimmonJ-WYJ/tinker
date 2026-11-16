<a id="tinker-科研专属能力分批退役"></a>

# Phased Retirement of Tinker Research-specific Capabilities

Status: Four implementation batches and automated validation complete, awaiting Draft PR human review and native follow-up validation. The user approved unified branding and development documentation, dependency-aware removal of research-specific entry points and features, and preservation of general capabilities, data, and compatibility contracts. Baseline main `4ca339592668581c1dc36abc9097fc9bf0aa1650`; PR #19 was still a separate draft at preflight, but was confirmed merged into main `53c191d` during execution. Work continued after normal synchronization; this batch does not rewrite its Rust source.

<a id="保护清单"></a>

## Preservation Checklist

Preserve chat, channel/model configuration, image generation and version references, projects/Recent, ordinary file previews, history reading and export, login, user settings, and user data. Preserve general PDF, OCR, ASR/Python tools and their on-demand startup boundaries. Do not read real keys, make paid requests, install over the official release, or operate on real session data.

Do not bulk-replace compatibility contracts still in use, such as `@asci/*`, ASCI_*, MCP protocol names, database/configuration paths, app identifiers/OAuth/deeplinks. Preserve LICENSE, NOTICE, original authors, and historical sources. Research history and old tool results remain readable/exportable; no table deletion, destructive migration, or resource-directory clearing.

The old Electron/SDK production backend continues supporting existing features; parts not yet replaced by Rust are not retired. This batch changes no Rust and does not join PR #19. Research entry points may change; other official UI/features remain unchanged.

<a id="批次-1身份和当前开发文档"></a>

## Batch 1: Identity and Current Development Documentation

- Change current CLAUDE/CONTEXT positioning from ASCI research to the Tinker general Agent, preserving valid development, security, i18n, testing, and submission rules.
- Archive original research-domain definitions as historical documents with source links and attribution; do not treat historical specifications as current product goals.
- Correct the default issue/PR repository in current development documentation, preserving explicit upstream references.
- Use Tinker for workspace identity descriptions in new projects and default sessions, preserving ambient CLAUDE protection and language-instruction boundaries without overwriting existing user/historical CLAUDE files.
- Regress identity/paths/preservation of existing files in isolated synthetic directories; commit separately after independent review.

<a id="批次-2科研运行接线与通用媒体解耦"></a>

## Batch 2: Decouple Research Runtime Wiring from General Media

- Remove production default research-intent routing, research-specific MCP, and capability-package automatic loading/seed/background startup wiring. Ordinary research questions remain processable as general search or file tasks.
- Hiding settings rows alone is insufficient: no general/coding/reference path should accidentally inject dedicated paper search, Zotero, review, research-gap, or searchplan tools.
- Preserve historical read-only data paths, database schema, export, and old result renderers/compatibility bridges; historical data support does not imply new research workflows remain available.
- OCR/ASR no longer depend on the Zotero master switch; preserve their original individual switch values and MCP configuration methods, without downloading speech models by default. PDF and general Python are unaffected by research retirement.
- Do not automatically delete user skills/capability packages/configuration on disk. Delete research-specific repository resources only after sufficient dependency and distribution validation; preserve general resources.

<a id="批次-3科研产品表面"></a>

## Batch 3: Research Product Surfaces

- Remove the default/new Papers page and active research entry points; new sessions default to the file page. Historical research outputs must remain explicitly openable in a read-only compatibility view.
- Restrict new literature/review/research-gap operations while preserving reading old sessions, old citations, and export.
- Replace research wording on general pages such as accounts with general user-data wording in both Chinese and English, without changing login or authorization configuration.

<a id="批次-4专属技能素材分发"></a>

## Batch 4: Dedicated Skill Asset Distribution

After checking dependencies directory by directory, retire another 49 clearly research-specific skills, totaling 54 with the preceding five workflows. Preserve 35 general skills and 10 cross-purpose/uncertain skills; do not clear entire categories or everything matching scientific.

Delete only corresponding source directories in Git and unify built-in retirement policy across seed/copy/upgrade/discovery. Do not delete existing user directories; runtime recognition requires an exact release layout and complete fingerprints, preserving unknown/modified copies. Extended trusted metadata must not restore unbounded recursion/attachment body reading. Licenses, NOTICE, and independent LICENSE files of retained skills remain unchanged.

<a id="验收与交付"></a>

## Acceptance and Delivery

Each batch begins with behavioral regressions and red/green tests, followed by implementation. Verify existing chat/image generation/channel/project/history/login regressions, research runtime isolation, independent media switches, new/old tabs and read-only compatibility, and no data deletion. Run repository-wide typecheck, lint, Bun, Electron build, necessary experimental frontend checks, independent code review, and simplification review. Record simulated-only checks; do not claim untested native or online flows were accepted.

Use independently reversible commits per batch, normal hooks, and validation before pushing a safe branch and Draft PR; no merge, deployment, installation, or remote history rewrite. If module coupling remains unclear, preserve its data/compatibility implementation and state follow-up scope explicitly; deleted-file counts do not establish completeness.

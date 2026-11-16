<a id="图片审批循环修复验证"></a>

# Image Approval Loop Fix Verification

Initial main baseline `b61ee1a8b7a04053643eb8da63dc43afee738459`. Before GitHub delivery, merged main `915d3ae6e655e1e40d8fbee9bb39887d7c07896e` without conflicts, on branch `fix/image-edit-approval-context`. Only Electron image host/shared authorization was fixed; relative to latest main, no Rust, README/CLAUDE, or user-session changes. This report does not establish release, installation, or successful real paid generation.

<a id="根因与修改"></a>

## Root Causes and Changes

1. The original request (English translation: “Take a look, add this girl, the three people together”) had valid host-selected/uploaded images but did not match the old fixed-word-order regex. A new pure visual-intent helper combines action, visual object, and complete scene destination; supports polite lead-ins, action-first wording, Chinese disposal constructions, pronouns, and explicit group portraits. Missing context, questions, discussion/analysis, whole-operation deferral, and code/libraries/group chats do not gain permission merely by mentioning image words; local face/background constraints remain.
2. Original `isImageTask()` always equaled automatic at construction; manual approval did not change task classification. Now valid explicit approval establishes task semantics in one direction and notifies the host; precise request permission, count, paths, and invocation identity remain confined to the current authorization object. Approval arriving after cancellation cannot establish semantics.
3. The sidecar adds `{kind:'image-task-confirmed',id}`, updating only existing consumption facts without reordering actual consumption. Duplicate confirmation does not append again; unknown IDs, abnormal fields, corrupt segments, and write failures recover conservatively. No prompts, images, keys, request parameters, or approval caches enter the sidecar.
4. On the next actual consumption turn, the factory reads the previous authorization object's latest task semantics and creates a new authorization object; queue registration itself does not advance state. Ordinary tasks clear context; now/next, late calls, cancellation, and restarts never reuse old permission.
5. On upgrade, old false consumption records may recover using the new recognizer and host evidence for that record. Recalculation follows consumption order and cannot skip ordinary input lacking proof; without image selection/upload for that record, images existing only now cannot restore old visual edits. Old records are not rewritten; real user JSONL is unchanged.

Primary implementation locations:

- `packages/shared/src/agent/image-edit-intent.ts`
- `packages/shared/src/agent/image-request-authorization.ts`
- `apps/electron/src/main/mcp/image-turn-factory.ts`
- `apps/electron/src/main/mcp/image-turn-journal.ts`

Other changes are targeted regressions, synthetic fixtures for real handlers, specifications, and this report. Commit hooks normally updated related package versions; no new dependencies, IPC, or UI allowlists.

<a id="红测自动检查与复审"></a>

## Failing Tests, Automated Checks, and Review

| Check | Actual result |
| --- | --- |
| Original authorization baseline | 83 pass, 0 fail; confirmed original tests lacked this round's two paths |
| First new regressions | 15 failed, reproducing original wording, approval semantics, and persistent recovery problems |
| Review and upgrade failing tests | Withdrawal, complete destination, old false, and missing ordinary records each reproduced then fixed |
| Final targeted six files | **162 pass, 0 fail, 410 assertions** |
| Repository-wide Bun | **3443 pass, 4 skip, 0 fail**; 3447 tests / 382 files / 9107 assertions |
| Repository-wide typecheck | All 6 workspaces exited 0 |
| Repository-wide lint | Exit 0 |
| Electron build | Exit 0; no DMG or installer produced |
| Independent read-only review | All four confirmed issues fixed; recheck found no new blockers; final explicit request for stricter rechecking also passed |
| Diff checks | Passed; before/after commit review confirmed only this round's scope |

The 4 skips are existing packaged rg binary integration tests whose test entry is unavailable in the development dependency layout; these tests were neither modified nor hidden. All newly added tests ran. Intermediate type checking found fixtures missing required homeDir/tool_use_id and recursive inference needing explicit types; after correction all six packages passed typecheck, without any.

Original red/green and post-merge verification logs remain local and are excluded from Git commits.

<a id="最新主干整合复验"></a>

## Latest Main Integration Recheck

- Integrated main `915d3ae` through merge without conflicts. Rust HTTP provider, Cargo files, and existing Rust reports were retained without this round's differences from main.
- Full Bun rerun after merge: **3443 pass, 4 skip, 0 fail, 9107 assertions**.
- Six-workspace typecheck, repository-wide lint, and Electron build passed again.
- Initial restricted-sandbox run failed 14 local-listener tests; full rerun passed after allowing loopback, without modifying tests to skip failures.
- Independent read-only review and code-simplifier reuse/simplification/readability checks found no blockers; independent seven-file targeted run: **165 pass, 0 fail, 423 assertions**.
- No real model or paid requests; builds did not launch, install, or replace the user's application. Rust Cargo builds were out of scope.

<a id="宿主链路覆盖"></a>

## Host Path Coverage

The real PermissionService PreToolUse hook → canUseTool → ImageRequestAuthorization/confirmation callback → consumption sidecar → restarted factory → real MCP generate_image handler were verified together. Tests used only temporary directories, synthetic PNGs, fake channels, and fake networking, with **10 fake API calls** across handlers. No real network generation or charges.

- Original wording does not show an approval card within valid actual selected/uploaded image scope; duplicate callbacks and ledger entries create no extra generation.
- Generic input first shows one actual permission request; explicit approval allows the current call; a new “generate again” turn does not repeat the old task's card.
- Default one image, explicit two, three people not meaning three images, extra files, cross-session IDs/selections, dangerous terminals, and plan mode each retain original boundaries.
- Covered live, restart, queued-but-unconsumed, actual consumption order, now interruption, late old-card approval, and calls after cancellation.
- Old false + original natural image-edit wording + valid image evidence + restart + generate again passes; withdrawal, unknown selections, future files, model self-description, and intermediate consumption gaps still ask.
- Duplicate confirmation events, old-turn confirmation, unknown identities, abnormal fields, write failures, and corrupt sidecars never fabricate task proof.

<a id="真实验收与升级限制"></a>

## Real Acceptance and Upgrade Limitations

- No real user JSONL, uploaded photos, keys, or profiles were read/modified; successful user image-generation calls were not resent.
- No operation on running Tinker, installation, packaging, main merge, or release. GitHub delivery covers only the fix branch and Draft PR; local Electron build verifies buildability only.
- No real model/SDK streaming end-to-end or real paid generation ran; “real handler” here means actual code with fake networking, not user-account end-to-end validation.
- No UI changes, screenshots, or browser style acceptance this round; approval emission assertions use real permission-service renderer request counts and actual execution boundaries.
- Old false records with natural image-edit requests can safely restore semantics. If an old version retained only generic text, false, and lost approval facts, seamless inference is impossible; users must explicitly request generation/editing again or confirm a valid call. The new version records semantics so subsequent explicit retries avoid the same loop.
- Unknown/extra files, excess output counts, and invalid/cross-session sources still require confirmation or rejection; these permission boundaries are retained.

<a id="github-交付与回滚"></a>

## GitHub Delivery and Rollback

Implementation commit `c015f9ff5675225a24ffaf450697add47d9ef027`. Latest main was merged; the delivery message is authoritative for final branch SHA, Draft PR, remote CI, and review comments. Developers must merge manually; the current installer does not acquire this fix automatically.

Reverting this commit restores old recognition and recovery logic without deleting user data. Old readers encountering new confirmation events conservatively lose continuation context without broadening old permissions; another explicit input can establish a new ordinary consumption boundary.

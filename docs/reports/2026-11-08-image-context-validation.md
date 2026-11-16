<a id="图片自然续作授权验证"></a>

# Image continuation authorization validation

Baseline: `fbde681afe228e408c73e5e6125fd72c658f1f2c` (main, Electron 0.1.611). Isolated development branch: `fix/image-context-continuations`. Repository version scripts updated this round's source versions to Electron 0.1.612, shared 0.1.143, root 0.1.41.

<a id="实际修复"></a>

## Actual fixes

- “Generate again / Regenerate / Another image / Generate again / Try again” (first three translated from Chinese) are allowed only when the host has established image-task context.
- Natural visual edits such as “Add this girl alongside and change her swimsuit” (English translation) require a current real upload, selected version, or image-task context with reference images. Historical image files alone do not authorize generation.
- Discussing costs, permissions, prompts, quoting others' instructions, coding tasks, or adding people to group chats/teams does not authorize generation. “But don't generate yet / Don't act yet” withdraws the task; “Don't draw people in the background / Don't draw a shadow on the title” retains the overall generation request (English translations).
- Each new user turn still establishes independent count and parameter authorization. Default one image; canceled old calls cannot borrow a new turn's permission. Exact image selection, current-session references, unknown-file external sending, plan mode, and dangerous-terminal rules remain.
- Before ordinary sends, the factory reads host user history; rotation occurs when the SDK actually consumes a registered queue item. Added an internal queue marker and attachment-directory `.image-consumed-turns.jsonl` consumption sidecar storing UUID, task category, and queued status, without messages or credentials. Recovery preserves actual now/next consumption order; unknown or truncated records block old-task inheritance.
- History scans use a fixed number of passes; pure intent folding does not reread every image for every turn, and a single attachment scan deduplicates. No quantified memory or whole-machine performance benefits.

<a id="检查证据"></a>

## Check evidence

| Check | Result |
| --- | --- |
| Original natural-continuation/edit failing tests | 9 failed, confirming missing existing rules |
| Multisentence negation, queue recovery, order, truncated logs, local constraints failing tests | Reproduced in batches, fixed, regressions retained |
| Six-file targeted image checks | 107 pass, 0 fail, 266 assertions |
| Repository-wide `bun test` | 3330 pass, 0 fail, 371 files, 8726 assertions |
| Repository-wide `bun run typecheck` | 6 workspaces exited 0 |
| ESLint on changed TS files | Exit 0 |
| `bun run electron:build` | Exit 0 |
| `bun install --frozen-lockfile --ignore-scripts` | Exit 0, no third-party dependency or lockfile changes |
| `git diff --check` | Passed |
| Independent read-only code review and simplification retrospective | Ready after original important findings fixed; no new important findings |

The full suite initially had 14 loopback-listening failures in the restricted sandbox. After allowing local test ports, final repository-wide results were as above; no related login, bridge, or HTML-preview product code was changed to evade tests. Another typecheck found a factory-local inference cycle; final typecheck passed after explicit types were added.

Logs are in local build directory `/tmp/tinker-image-context-checks-20261108`; key files: `target-verified.log`, `test-verified.log`, `typecheck-verified.log`, `lint-verified.log`, `build-verified.log`.

<a id="宿主链路与未验证项"></a>

## Host pipeline and unverified items

- Executed real ImageTurnFactory → ImageTurnController → AgentPermissionService hook/canUseTool; confirmed natural continuations create no permission card, canceled requests are denied, and dangerous terminals remain denied.
- Ran real MCP generate_image handler in an independent process with synthetic images, local temporary directories, and fake networking. 7 fake API calls covered ordinary manual retries, selected-image edits, ledger deduplication, consumption switching, rejection of old in-flight now turns, and plan mode. These are not paid-model end-to-end results.
- Tests used isolated configuration and synthetic messages without reading real user sessions, copying credentials, paid generation, Google login, or replacing/launching installed versions.
- No renewed real desktop UI or real SDK-model end-to-end generation validation; the currently mounted/running 0.1.611 app does not automatically receive branch fixes.
- Old versions lack queue markers, so historical consumption of an old queued message cannot be proven retrospectively. Unprovable queues and abnormal consumption logs use conservative recovery in the new format.
- React layouts, reference UI, OAuth, and Rust/Tauri were unchanged this round. Pure authorization rules and host-turn contracts remain the suitable future migration boundary; do not rewrite a second feature implementation simultaneously.

<a id="交付与回滚"></a>

## Delivery and rollback

Per parent-conversation coordination, complete only an independent local commit, then publish together after serial integration with session/reference UI work. This record does not establish push or passing remote CI; no duplicate PR, merge, deployment, or installer packaging.

Reverting this round's commit restores old authorization behavior. No data migration. The sidecar records only internal consumption semantics; old versions ignore new queue properties and sidecar, requiring no deletion of user sessions, images, settings, or keys.

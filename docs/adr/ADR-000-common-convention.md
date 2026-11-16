<a id="adr-000协作规范分支-&#45;commit-&#45;pr"></a>

# ADR-000: Collaboration Conventions (Branches / Commits / PRs)

| Field | Content |
|------|------|
| **Status** | Accepted |
| **Decision deadline** | None (independent of milestones) |
| **Decision date** | 2026-05-19 |
| **Decision maker** | Riting |
| **Author** | Riting |
| **Related** | [CLAUDE.md §3 Feedback Loop](../../CLAUDE.md), [`.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md), [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) |

---

<a id="一背景"></a>

## I. Background

Existing [ADR-001](./ADR-001-local-storage.md) / [ADR-002](./ADR-002-server-stack.md) / [ADR-003](./ADR-003-ui-design-system-layering.md) are **architectural decisions** governing technology tradeoffs. The repository lacks a **collaboration meta-convention** governing workflows for people / Agents interacting with it:

- The repository follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) (`feat / fix / chore / refactor / docs / ci / revert`, etc.), without written rules for newcomers / Agents
- The relationship of `UI-main` to `main` (baseline / mock data / synchronization) is undocumented
- PRs use squash merge (evidenced by `(#NN)` suffixes in commit logs), while single-theme / rebase prerequisites / screenshot requirements are scattered across review comments
- CI strictly validates committer email and version suffixes, but rules live only in workflows and are invisible to developers

This ADR **documents** these established conventions as foundational meta-ADR 000, providing collaboration foundations across later ADRs and daily development.

---

<a id="二决策维度"></a>

## II. Decision Dimensions

| Dimension | Key question |
|------|---------|
| **Discoverability** | Can a newcomer / Agent read all collaboration constraints in one file on day one? |
| **Machine validation** | Can CI block violations of key rules (email / version / Conventional Commits prefix)? |
| **Historical consistency** | Do rules align with existing commit history / PR practices? |
| **Multiple branches** | How do `main` / `UI-main` coexist, and when do they synchronize? |
| **Extensibility** | Are rules too restrictive for releases / large refactors? |

---

<a id="三决策"></a>

## III. Decision

<a id="31-分支branch"></a>

### 3.1 Branches

Use [trunk-based development](https://trunkbaseddevelopment.com/) with short-lived feature branches off trunk, plus `UI-main` as a parallel trunk for UI mock workflows.

| Rule | Explanation |
|------|------|
| Baseline | Always create branches from `main` or `UI-main`; backend / full-stack changes use `main`, pure UI/UX mock changes use `UI-main` |
| `UI-main` origin | Created from `main`; before backend APIs are ready, commit UI changes with **mock data** to `UI-main`. Once available, corresponding backend PRs merge into `main`, then `chore/sync-main-ui-into-main` brings changes back to `UI-main` |
| `UI-main` purpose | All mock-data UI/UX changes merge here; periodically synchronize both directions through `chore/sync-main-ui-into-main` (see practices around commit `c2f2bf47`) |
| Naming | `<type>/<short-slug>`, type from commit-prefix set (`feat / fix / chore / refactor / docs / ci`); issue-linked examples: `fix/issue-142-<slug>` or `feat/f51-<slug>` |
| Prohibited | Direct commits to `main` / `UI-main` / shared release or freeze branches; always use PRs |
| Lifecycle | Short-lived (< 1 week); rebase once if exceeding 1 week to avoid accumulating divergence |

<a id="32-commit-message"></a>

### 3.2 Commit Messages

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

| Rule | Explanation |
|------|------|
| Format | `<type>(<scope>): <subject>`, optional `<body>` / `<footer>` |
| type | `feat / fix / chore / refactor / docs / ci / revert / test / perf / style` (first 7 are the actual repository set by git-log frequency) |
| scope | Optional; common values: `ui / i18n / agent / channels / ux / release / auto-resolve / paper-search-mcp`, etc. (from git log) |
| subject | ≤ 72 characters; present-tense imperative; lowercase initial; no final period; may include Chinese |
| body | Explain why, rather than what; blank line after subject |
| footer | Link issues: `Closes #142` / `closes #93`; mark BREAKING CHANGE in footer |
| Prohibited | Direct shared-branch commits (including `main` / `UI-main`); skipping hooks with `--no-verify`; amending pushed commits |
| committer email | Must use the current user's `*@opensci.io` address; CI `verify-commit-email` enforces it (see `.github/workflows/ci.yml`); non-opensci domains such as `noreply@github.com` prohibited |
| Versions | No manual bump: pre-commit (`scripts/bump-version-on-commit.mjs`) pins changed workspace `package.json` to `origin/main` patch+1 (numeric, no `-rc.N`) and auto-stages; pre-push no longer changes versions; CI `Version Lint` still rejects `-rc.N` in non-release PRs |

<a id="33-pull-request"></a>

### 3.3 Pull Requests

Use [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow) + squash-and-merge. Current documentation policy, explicitly requested on 2026-11-16, requires English PR titles, descriptions, and review replies; it supersedes this ADR's former Chinese-copy requirement.

| Rule | Explanation |
|------|------|
| Before creation | Merge the latest target branch first (`git fetch origin && git merge origin/main` or `origin/UI-main`), resolve conflicts, then open PR. ⚠️ Merge exposes author / committer emails from **all** source-branch commits to CI `verify-email`; contributor addresses outside `*@opensci.io` require rewriting first (§3.2 / `scripts/verify-commit-email.sh`) |
| Pre-PR self-review | **Before** opening or updating/pushing an existing PR, run `simplify` / `@code-simplifier` to review reuse / simplification / readability, then push |
| After opening | After pushing the PR, run `/review` on it and post results using `gh pr comment <num> --body ...` (workflow: [`docs/agents/pr-flow.md`](../agents/pr-flow.md)). **Replies follow body constraints: tables + bullets only, no semicolons or long prose sentences, in English** |
| committer email | All PR commits (including after merge / rebase) must use the current user's `*@opensci.io` address |
| Single theme | Each PR addresses **one theme**; split multiple themes into multiple PRs |
| Title | Same format as commits: `<type>(<scope>): <subject>`, in English (becomes main's commit message after squash) |
| body | Follow `.github/PULL_REQUEST_TEMPLATE.md` (`Summary / Why / Test Plan / Closes #`). Agent bodies use **tables + bullets only**, **no semicolons or long prose sentences**, in **English**; UI changes **must include screenshots / GIFs** |
| Merge ownership | After `/review` + reply, the Agent's **workflow ends**: **never** execute `gh pr merge` or enable auto-merge. Developers merge manually |
| Merge strategy | Developers manually **squash merge** unless history truly requires every commit; each main commit then corresponds to a complete PR, simplifying `git log` / blame / revert |
| Retain commits (no squash) | Releases / large refactors with explicitly independently reversible steps; explain in PR description |
| Review | At least 1 approval; CI must pass (typecheck / test / key-parity) |
| Self-check | Complete [CLAUDE.md §8 Done When](../../CLAUDE.md) |

<a id="34-文件体积与模块化"></a>

### 3.4 File Size and Modularity

Large monolithic files (ipc.ts / agent-orchestrator.ts / preload/index.ts once around ~2000–3000 lines each) impede code review, coarsen unit-test granularity, and increase merge conflicts. Establish file-size thresholds and three decomposition patterns to prevent regrowth.

| Rule | Explanation |
|------|------|
| Threshold | Each `.ts` / `.tsx` source file has a **soft limit ~500 lines, hard limit ~800 lines** (total lines as measurable threshold). Evaluate splitting near the soft limit; split beyond hard limit. **Known exception**: Large core classes with tightly coupled instance state (e.g. `agent-orchestrator.ts`) may retain a core loop over the hard limit after extracting self-contained helpers; this is an allowed transitional state requiring continued phased reduction, never a reason to stop splitting or refill with new code |
| IPC pattern | Split main IPC registration by domain into `apps/electron/src/main/ipc/<domain>.ts`, exporting `register<Domain>Ipc(...)` per domain (following `lib/updater/updater-ipc.ts`). `ipc.ts` only orchestrates; `registerIpcHandlers()` calls domains in order, preserving export signature and `main/index.ts` call site |
| preload pattern | Split API by domain into `apps/electron/src/preload/domains/<domain>.ts`, exporting API fragments + corresponding interfaces. `index.ts` aggregates the same-shaped `electronAPI` with `satisfies ElectronAPI` guarding runtime shape; shared listening uses `subscribe()` in `preload/helpers.ts`. ⚠️ Never change `window.electronAPI` runtime key set/nesting/signatures |
| Class pattern | Extract **self-contained pure helpers** (no `this`) from large classes such as `AgentOrchestrator` into sibling `*-helpers.ts` / `*-<concern>.ts` (e.g. `-sdk-env.ts` / `-mcp.ts`), injecting dependencies explicitly; conservatively retain tightly coupled stateful core loops. ⚠️ Move constrained functions such as `buildSdkEnv()` ([CLAUDE.md §7.2](../../CLAUDE.md)) with internal logic preserved verbatim |
| Reverse rule | **New IPC handlers go in matching `ipc/<domain>.ts`; new preload APIs in matching `domains/<domain>.ts`. Never refill slimmed orchestration/aggregation files for convenience**, or monoliths recur |
| Conservation | Splits are **pure mechanical moves**: conserve channel names / signatures / runtime shape / handler counts and behavior; each split gets a separate `refactor(...)` commit, with passing `typecheck` + `bun test` |

---

<a id="四已排除方案"></a>

## IV. Rejected Alternatives

- **GitFlow**: Multiple branches (`develop` / `release` / `hotfix`) are too heavy for single-milestone and Electron desktop release rhythms
- **Fast-forward only**: Conflicts with squash-merge's PR-as-atomic-unit semantics and fills main logs with WIP commits
- **Unrestricted commit messages**: `feat / fix / chore` are already established standards; writing them down reduces review friction

---

<a id="五后果"></a>

## V. Consequences

<a id="正向后果"></a>

### Positive Consequences
- One source of truth for newcomer / Agent onboarding
- Alignment among PR templates, CI checks, and ADR
- Later ADRs (004 onward) can reference this ADR instead of restating collaboration conventions

<a id="负向后果-&#45;风险"></a>

### Negative Consequences / Risks
- No retroactive application to old PRs / commits; new rules take effect from sign-off
- Rules must evolve with practice; if CI / templates diverge, revise the ADR rather than allowing documentation and machine checks to drift

<a id="后续动作"></a>

### Follow-up Actions
- [x] Update `docs/adr/README.md` index (000 before 001)
- [x] Add a row linking ADR-000 to `CLAUDE.md §2`
- [ ] (Optional) Add `> 提交前请确认遵循 [ADR-000](../docs/adr/ADR-000-common-convention.md)` atop `.github/PULL_REQUEST_TEMPLATE.md` (the preserved proposed literal means "Before submitting, confirm compliance with ADR-000")
- [x] Introduce commit-msg hook (`.husky/commit-msg` → `scripts/verify-commit-msg.sh`), upgrading Conventional Commits from human review to machine enforcement; dependency-free shell (mirroring `scripts/verify-commit-email.sh`), unit tests `scripts/verify-commit-msg.test.ts`

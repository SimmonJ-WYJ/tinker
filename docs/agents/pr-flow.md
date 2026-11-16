# PR flow: open, sync, review

See [ADR-000 §3.3](../adr/ADR-000-common-convention.md) for general PR conventions. This document defines the current Tinker repository target and executable `gh` / `git` steps for agents. Use the `gh` CLI for all operations and always target `origin` (`SimmonJ-WYJ/tinker`).

<a id="开-pr-前合并最新主干"></a>

## Before Opening a PR: Merge the Latest Mainline

1. Fetch and merge the target branch (base = `main` or `UI-main`):
   ```bash
   git fetch origin
   git merge origin/main      # or origin/UI-main
   ```
   Resolve every conflict before continuing.
2. **Commit identity and history**: run repository hooks normally. The current `scripts/verify-commit-email.sh` permits `@opensci.io`, personal GitHub noreply addresses, and listed bots. The script is authoritative. If a guard fails, first check the new commit range and configuration. Preserve existing authorship and do not rewrite inherited history to impose upstream organization rules.
3. Run `simplify` / `@code-simplifier` to review reuse, simplification, and readability before pushing.

<a id="开-pr"></a>

## Open a PR

- Write multiline PR bodies to a temporary file and use `--body-file`. The example shows the fields and avoids interpolating body text into a shell command.

```bash
# Fill /tmp/tinker-pr-body.md with Summary / Why / Closes # / Test Plan
# Record actual typecheck, Bun tests, and relevant build or UI results in Test Plan.
gh pr create --repo SimmonJ-WYJ/tinker \
  --base main \
  --title "<type>(<scope>): <subject>" \
  --body-file /tmp/tinker-pr-body.md
```

- Use the same title format as commits. After squash merging, it becomes the commit message on main.
- Follow the `.github/PULL_REQUEST_TEMPLATE.md` body fields (`Summary / Why / Test Plan / Closes #`).
- **Required body format**: use **tables and bullet points only**, **no semicolons or long prose sentences**, and write in **English**. UI changes must include screenshots / GIFs.

<a id="pr-开好后审查并回帖"></a>

## After Opening a PR: Review and Comment

1. Run the `/review` skill on the newly pushed PR.
2. Write the review to a temporary file and post findings, locations, recommendations, and verified items:
   ```bash
   gh pr comment <num> --repo SimmonJ-WYJ/tinker --body-file /tmp/tinker-pr-review.md
   ```
   - **Required comment format**: as with the PR body, use **tables and bullet points only**, **no semicolons or long prose sentences**, and write in **English**.
3. ⚠️ **The comment ends the workflow**: the agent stops here. **Never** run `gh pr merge` or enable auto-merge. A developer must merge manually.

<a id="远端说明"></a>

## Remote Repository Notes

The current `origin` is `SimmonJ-WYJ/tinker`. Within a clone, `gh` normally infers it. If inference selects the wrong repository, pass `--repo SimmonJ-WYJ/tinker` explicitly. Issue / PR links to upstream [`OPENSCI-Labs/ASCI-Alpha`](https://github.com/OPENSCI-Labs/ASCI-Alpha) retain their original context. Do not treat old numbers as issues in this repository.

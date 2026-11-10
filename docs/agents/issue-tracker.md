# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues on `SimmonJ-WYJ/tinker`. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Write multi-line bodies to a temporary file and pass `--body-file`.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone. The current `origin` is `SimmonJ-WYJ/tinker`; pass `--repo SimmonJ-WYJ/tinker` explicitly if needed. Historical upstream references belong to [`OPENSCI-Labs/ASCI-Alpha`](https://github.com/OPENSCI-Labs/ASCI-Alpha). Never retarget an upstream issue number to this fork without checking its repository.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

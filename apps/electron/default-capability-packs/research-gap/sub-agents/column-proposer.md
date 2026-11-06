# column-proposer (research-gap step 1)

You are given a **fixed set of papers** (ids + titles). Skim each paper's structured source and propose the dimensions on which this group can be lined up in a comparison table.

## How to read

For each paper, use `papers_read_outline` to get the section structure, and `papers_read_article_section` (or `papers_semantic_search` within the paper) to peek at method/setup/results sections. You do **not** need full reads here — just enough to see what attributes recur across the set.

## What to produce

Propose **exactly 4–6 columns** that are:
- **Comparable** — most papers in the set can be placed on this dimension (skip attributes only one paper has).
- **Discriminating** — values differ across papers (a column where everyone is identical adds nothing).
- **Focused** — concrete attributes (e.g. dataset, backbone, pretraining yes/no, task setting, evaluation metric), not vague themes. The more focused, the more meaningful the gaps later.

Return **strict JSON only**, no prose:

```json
{
  "columns": [
    { "id": "c1", "name": "Dataset", "why": "5/6 papers report an evaluation dataset" },
    { "id": "c2", "name": "Backbone", "why": "papers use different backbones, comparable" }
  ]
}
```

- `id`: short stable id (`c1`, `c2`, …).
- `name`: the column header in the user's language.
- `why`: one line on why it's comparable/discriminating (for your own reasoning; the scenario may drop it).

Do **not** fill any values, do **not** read deeply, do **not** add a dimension only one paper addresses.

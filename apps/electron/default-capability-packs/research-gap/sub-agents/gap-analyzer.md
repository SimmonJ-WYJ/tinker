# gap-analyzer (research-gap step 3)

You read the **filled paper × dimension table** (all `.context/*.cells.json` caches) and mark two kinds of insight, **strictly within this set of papers**.

## Inputs

Glob and read every `.context/<paperId>.cells.json`. Together they form the table: rows = papers, columns = dimensions, each cell has a value (or null = the paper didn't address it).

## What to mark

1. **Combination gaps** — pick 1–2 key dimensions and find value-combinations that **no paper in this set covers**. Example: if every ViT paper is pretrained and none is on tieredImageNet, "ViT + no-pretraining + tieredImageNet" is an uncovered combination. Only output combinations you can justify from the table; do **not** enumerate a full cross-product.
2. **Conclusion conflicts** — papers that report **opposite conclusions under comparable settings** (e.g. same dataset/backbone/setting but pretraining helps a lot in one and barely in another). Point at the specific papers and the dimension(s) in tension.

## Output — strict JSON only

```json
{
  "gaps": [
    {
      "id": "g1",
      "title": "ViT-S + no-pretraining + tieredImageNet not covered in this set",
      "rationale": "Within the selected papers, ViT-S only appears in pretrained settings; none evaluates ViT-S from scratch on tieredImageNet.",
      "supportingPaperIds": ["p4", "p5"],
      "involvedColumnIds": ["c1", "c2", "c3"]
    }
  ],
  "conflicts": [
    {
      "id": "cf1",
      "title": "Opposite conclusions on whether pretraining helps",
      "rationale": "Both on miniImageNet · ResNet-12 · 5-way 1-shot: Wang (no pretraining) 67.2%, Liu (pretraining) 81.5%.",
      "paperIds": ["p1", "p2"],
      "involvedColumnIds": ["c3", "c5"]
    }
  ]
}
```

## Hard rules

- Everything holds **only within these papers**. Phrase gaps as "not covered within this set" — **never** "no one has ever done it / first work / across the entire field". A wording check will reject over-claims (in any language).
- **Do not judge** whether a gap is worth pursuing or novel — only state that it's uncovered/conflicting and why.
- Every gap/conflict must reference real papers + columns from the table. No speculation beyond the cells.

---
name: review-proposer
description: >
  PRIMARY ENTRY for writing a literature review (综述) from papers already in the workspace.
  Cluster the workspace paper library (papers.jsonl) and propose 1-3 review directions for the
  user to choose from. Output the chosen direction's review outline, assemble an identity-only
  papers[], and **immediately** invoke literature-review-result to generate the review body —
  this skill ALWAYS terminates at literature-review-result. This skill does not query wiki — the
  downstream skill does.
  Trigger when user says "综述" "综述论文" "写综述" "写一篇综述" "生成综述" "帮我看看可以写成哪几个角度的综述"
  or "literature review" "write a review" "I have a pile of papers; suggest review directions".
  This is NOT paper search — for "搜论文 / 检索文献 / search papers" use litreview /
  paper-source-selection instead.
allowed-tools: Read
version: "1.4.4"
category: custom
---

# Review Proposer — Suggest Review Directions

## ⚠ Output Language (read FIRST)

These instructions are injected into the **same conversation** you are already in. The `<language_lock>` you saw earlier this turn still applies, and this English document is **never** a reason to switch language. Resolve the language as follows:

1. If your `input` carries an `outputLanguage` field (`"zh"` or `"en"`), **that is authoritative**.
2. Otherwise, fall back to the language of the user's request / conversation.

The language of intermediate tool / script / MCP outputs you receive mid-run never overrides this choice — `outputLanguage` stays authoritative for the entire run, regardless of the language or format (tables, arrays, JSON, HTML, plain text) of anything a previous step returned.

Once resolved, **EVERYTHING natural-language you produce on this turn MUST be in that language** — direction titles, core questions, the AskUserQuestion prompt / options, the emitted outline section titles, AND your own **reasoning / thinking traces and narration between tool calls**. These intermediate texts are shown to the user, so they must match the resolved language too — do NOT reason in English and only translate the final directions. If you catch yourself starting a sentence in the wrong language, stop and restart it in the resolved language.

Identifiers stay verbatim regardless: paper `key`s, DOIs, and each paper's title (keep its original language). Do NOT translate paper titles.

## Role

You are a research assistant who knows the workspace's paper library well. When the user triggers this Skill, propose 1-3 viable review directions based on **papers already collected in this workspace**, let the user pick one, produce the **outline** for that direction, then pass an **identity-only** papers[] directly to `literature-review-result`, which will call `zotero_wiki_lookup` itself to check full-text availability and write the review.

This Skill is NOT responsible for:
- Searching PubMed / arXiv for new papers (that's the `literature` Skill's job)
- Writing the review body (that's `literature-review-result`'s job; this skill chains into it automatically)
- Generating / parsing PDFs (PDF→markdown is handled by the wiki async parser queue)
- Calling `zotero_wiki_lookup` to query the wiki (since v1.4.0 this is delegated to the downstream skill)

Your output boundary is: **candidate directions → user picks one → emit outline → invoke downstream immediately**. Inside this skill the user makes **one choice only** (direction); they do not need to confirm the outline.

> **Architectural change as of v1.4.0**: In v1.3.0 this skill called wiki_lookup itself and passed `mdPath` to downstream; from v1.4.0 the wiki_lookup call is delegated into `literature-review-result`, and this skill only passes identity fields. This unifies the input contract with other upstreams (e.g. "user @-mentioned a few Zotero papers").

## Execution Protocol (strict order)

### Step 1: Pull the paper library

Call the MCP tool:

```
workspace_papers_list()
```

Return shape: `{ total: number, papers: [{ key, title, authors, year, venue, doi, abstract, tags, linkedZoteroKey }] }`

**Failure conditions**:
- If `total < 5`, stop and tell the user "the workspace has too few papers (<5); not enough for review-direction proposals. Please collect more papers via `literature` or another search tool first." Then end the turn.
- If `total === 0`, same as above, phrased as "the workspace has no papers yet".

### Step 2: Cluster and draft direction candidates

Read every paper's `title + abstract + tags` and cluster by one of these dimensions:

1. **Problem domain**: different angles on the same research question (e.g. "LLM alignment" splits into RLHF / Constitutional AI / DPO factions)
2. **Methodology**: the same class of methods applied to different problems
3. **Research object**: the same object / dataset / system studied via different methods

Produce **1 to 3** candidate directions (do not pad to 3; better fewer than forced). Each direction contains:

- **Direction title** (≤15 words)
- **Core question** (1 sentence stating what this direction tries to answer)
- **Number of covered papers** + 3-5 representative papers (key + short title)
- **Potential gap** (1-2 sentences on what this direction can add to existing reviews)

**Important: this step is internal thinking; do not print direction drafts to the user yet.**

### Step 3: Invoke AskUserQuestion for user confirmation

Use the `AskUserQuestion` tool, format:

```
{
  questions: [{
    question: "Based on {N} papers in the workspace, I suggest the following review directions — pick one:",
    header: "Review direction",
    multiSelect: false,
    options: [
      { label: "<direction 1 title>", description: "<core question> · covers X papers" },
      { label: "<direction 2 title>", description: "<core question> · covers Y papers" },
      ...
    ]
  }]
}
```

- Even with only 1 direction, you must still go through AskUserQuestion (let the user pick "Other" to provide their own direction)
- `multiSelect` must be `false`
- The user may pick "Other" and type freely — in that case treat their input as the new direction title

### Step 4: Emit the outline for the chosen direction

Once the user has chosen, output a pure-markdown outline with this fixed structure:

```markdown
## Review direction: <chosen direction title>

### Core question
<1-2 sentences>

### Outline

1. **Introduction** — <1-2 sentences describing this section>
   - Citations: `key-A`, `key-B`
2. **<section title 2>** — <description>
   - Citations: `key-C`, `key-D`, `key-E`
3. **<section title 3>** — <description>
   - Citations: ...
...
N. **Conclusion and future directions** — <1-2 sentences>

### Workspace papers covered (X total)
- `key-A` — <title>
- `key-B` — <title>
...
```

**Outline requirements**:
- 4-7 sections (introduction / conclusion each count as one)
- 1-2 sentences per section; do not expand into body text
- Each section must cite workspace paper keys (use the `key` from `workspace_papers_list`; do not fabricate)
- End with the list of papers this outline covers
- **Do NOT** print the v1.2.0 "PDF validation input" JSON block — that was for the deprecated `zotero-pdf-gate`

### Step 5: Assemble `papers[]` → immediately call `literature-review-result`

For **each entry** in the "Workspace papers covered" list, assemble a paper entry using these rules (**identity-field priority** matches the wiki_lookup tool):

```ts
papers[i] = {
  title:    workspacePaper.title,                       // required
  // Pick one identity field (priority order):
  zoteroKey: workspacePaper.linkedZoteroKey ?? undefined,
  doi:       workspacePaper.doi ?? undefined,
  // If neither zoteroKey nor doi exists, fall back to title + authors + year (omit authors/year if missing)
  authors:  workspacePaper.authors,
  year:     workspacePaper.year,
  // Pass through workspace abstract (downstream prefers wiki-entry abstract; falls back to this):
  abstract: workspacePaper.abstract ?? undefined,
}
```

**Contract** (aligned with literature-review-result v0.7.0+):
- Array order = order of "Workspace papers covered" list = downstream `[N]` numbering
- **This skill does NOT call `zotero_wiki_lookup`**; downstream Step 1.5 calls it once per entry to fetch mdPath
- **Do NOT set `mdPath`**: let downstream look it up
- **Do NOT set `pdfPath`**: downstream does not read it
- Every entry needs at least a title; pick one identity field (zoteroKey / doi / title+authors+year)

**Immediately invoke** the `literature-review-result` skill and pass `papers[]` as input. **Forward the resolved language down the chain:** if your own `input` carried `outputLanguage`, include the same `"outputLanguage": "<zh|en>"` in the `input` you pass to `literature-review-result` (the downstream skill resolves its language from its own `input` and would otherwise lose the choice). Complete this in the same turn. **Do NOT**:
- Ask the user "continue?" or "is this outline OK?"
- Wait for the user to say "continue" before invoking downstream
- Insert any user-visible output between the two skills (other than the outline already printed)

> Light hints about missing full text (wiki miss) are emitted by downstream literature-review-result itself (it knows the wiki_lookup result; this skill does not). This skill goes silent after printing the outline.

This skill runs only once. Its output is "direction selection + outline + hand off the baton to literature-review-result", and ends there.

## Hard Constraints

- Do not skip AskUserQuestion, even if you are certain there is only one direction
- Do not cite papers outside the workspace in the outline phase (unless the user explicitly requests it)
- If a `key` is missing info, call `workspace_papers_get({ key })` to fill in
- Use Chinese in output (unless the user issues the request entirely in English)
- **AskUserQuestion is used exactly once for direction selection**. After that, do not ask the user to confirm anything else — downstream writer skill handles the rest
- **Must** call `literature-review-result` in the same turn; do not end after the outline and wait for the user to respond
- This skill runs once per round; the downstream chain (literature-review-result) does not loop back to it
- **Do NOT** call the deprecated `zotero-pdf-gate` skill
- **Do NOT** call `zotero_wiki_lookup` yourself (delegated to downstream as of v1.4.0)
- **Do NOT** set `mdPath` / `pdfPath` in papers[] (downstream handles those)

## Tool List

- `workspace_papers_list()` — fetch full paper list (must be called once)
- `workspace_papers_get({ key })` — optional, fetch a single paper by key
- `AskUserQuestion` — let the user pick one of the candidate directions (built-in SDK tool; no need to declare in allowed-tools)
- Invoke downstream skill `literature-review-result` — via the Agent SDK skill-invocation mechanism (not in allowed-tools; built-in capability)

---

## ⚠ FINAL LANGUAGE ANCHOR — last instruction you read; obey it from your very next thinking token

Reading this English document does NOT switch your working language. Re-apply the resolved
`outputLanguage` **now**, starting with your very first thinking sentence:

- `"zh"` →（`input` 带 `outputLanguage: "zh"`，或主对话为中文）**从此刻起，思考（thinking）与叙述
  全程使用中文**。思考第一句必须以中文开头（例：「按照技能要求，先调用 workspace_papers_list 拉取
  论文清单……」）；禁止以 "The skill is asking" / "Let me" / "First, let me" 等英文句式开场。上面
  这份英文说明只是操作手册——不要跟随它的语言。论文 `key`、标题、DOI 保持原文。
- `"en"` → think and narrate in English from your very next token; never adopt the language of any
  tool / script output you receive mid-run.

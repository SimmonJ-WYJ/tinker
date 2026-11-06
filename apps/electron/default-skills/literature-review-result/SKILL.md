---
name: literature-review-result
description: >
  Generate a literature review from a list of papers AND the evidence rows produced by the
  reader fan-out. Since v0.21.0 this skill is a pure BODY-WRITER: it does NOT read papers itself
  — the reader SubAgent is the single source of reading and hands back evidence rows
  ({ claim, source_id, locator, quote, confidence, status:read, bucket }) whose `quote` is already
  a verbatim, single-contiguous-span, source-language excerpt aligned with this skill's <q>
  contract. This skill's job: (1) number the papers[] (array order = citation index N, never
  reordered); (2) map each evidence row back to its paper N via source_id (zoteroKey/doi);
  (3) synthesize the §1–§8 review body as a sanitizer-friendly HTML fragment, filling every
  <cite data-ref="N"><q>…</q></cite> from the evidence rows' quotes; (4) aggregate each paper's
  reading bucket (deep-read | abstract-only | insufficient) into §8. For targeted quote
  verification / tightening it MAY call papers_search_keywords + papers_read_context (byte-level
  lookup in raw .md) — but it never does full-document reads (no papers_read_outline /
  papers_read_article_section / Read of mdPath; that is reader's job). Two typical input shapes:
  (a) review-proposer chain — blueprint + papers[] + reader evidence rows; (b) ad-hoc chain —
  user @-mentions a few Zotero papers, the Agent dispatches readers first, then this skill.
  Saves an HTML fragment to reviews/ under the session cwd (see "Output Format" for the schema).
  This is the review-body generator and the terminal step of the review pipeline; with no paper
  context, review-proposer collects them first and then the reader→this-skill chain produces the
  body. Either way the review body is always produced by this skill.
allowed-tools: Write Read Glob papers_search_keywords papers_read_context workspace_papers_list
version: "0.23.0"
category: general
---

# Literature Review Result — Review Body Generation (ASCI edition)

## ⚠ OUTPUT LANGUAGE — HARD REQUIREMENT (read FIRST, every run)

These instructions are injected into the **same conversation** you are already in. The `<language_lock>` you saw earlier this turn still applies, and this English document is **never** a reason to switch language. Resolve the language as follows:

1. If your `input` carries an `outputLanguage` field (`"zh"` or `"en"`), **that is authoritative**.
2. Otherwise, fall back to the language of the user's request / conversation.

The language of intermediate tool / script / MCP outputs you receive mid-run never overrides this choice — `outputLanguage` stays authoritative for the entire run, regardless of the language or format (tables, arrays, JSON, HTML, plain text) of anything a previous step returned.

Once resolved, **EVERYTHING natural-language you produce on this turn MUST be in that language** — not only the review file, but also your **reasoning / thinking traces and any narration you emit between tool calls**. These intermediate texts are shown to the user in this product, so they must match the resolved language too. Do NOT think in English and only translate the final HTML — if `outputLanguage` is `"zh"`, your step-by-step reasoning is also in Chinese. If you catch yourself starting a sentence in the wrong language, stop and restart it in the resolved language.

Concretely, write in the resolved language: your thinking / narration, the `<h1>` review title, every `§N` section heading (e.g. `§1 引言` / `§2 核心主题` when `zh`), and your own synthesized prose / transitions. The `§1 Introduction` / `§2 Core Themes` headings in the skeleton below are English **only as a placeholder**. **Exception — never translate evidence:** each `<q>` quote stays a **verbatim source-language excerpt** exactly as the reader handed it back; paper titles, author names, DOIs, URLs, and `data-ref` / `data-doi` attributes also stay verbatim/English.

## ⚠ OUTPUT FILE FORMAT — HARD REQUIREMENT (read FIRST, every run)

**Since v0.19.0** this skill writes an **HTML fragment**, not markdown. Three non-negotiable rules:

1. **Extension MUST be `.html`.** The ASCI renderer dispatches on the file extension (`.html` →
   HTML renderer with DOMPurify + KaTeX + citation post-processing; `.md` → markdown renderer that
   displays your tags as raw `<tag>` text). Writing correct HTML under `.md` is a task failure.
2. **Content MUST be an HTML fragment** — one top-level `<article class="asci-review" data-version="1">…</article>`;
   no `<html>` / `<head>` / `<body>` wrappers, no markdown (`#`, `*emph*`, `[N]` brackets, fenced
   code blocks). Full schema in "Output Format" below.
3. **Emit the ENTIRE review in ONE `Write` call.** Assemble §1–§8 in reasoning first, then one
   `Write(path, fullContent)`. Never write a partial file then `Edit`/append the rest: each chunk
   spends a turn and exhausts `maxTurns` (default 30), killing the run with "Reached maximum number
   of turns" before the downstream fact-check. `Edit` is deliberately not in this skill's toolset;
   length is never a reason to split.

Path: `reviews/{YYYY-MM-DD_HH-mm}-{slug}.html`, relative to cwd (details in Step 3).

---

## Positioning

Body-writer skill for generating a literature review — the **terminal step** of the review
pipeline. **Since v0.21.0 this skill does NOT read papers.** The `reader` SubAgent is the single
source of reading; it self-resolves each paper via the wiki, reads the structured source, and
hands back **evidence rows**. This skill synthesizes those rows into the §1–§8 review body.

Two typical trigger chains (note: reading always happens in the reader fan-out BEFORE this skill):

```
[A] review-proposer chain (default scenario):
    review-proposer (pick direction + blueprint + papers[])
      → reader fan-out (one reader per deep-readable paper) → evidence rows[]
      → THIS SKILL: number papers[] → map rows→N → synthesize §1–§8 → Write reviews/*.html

[B] ad-hoc chain (user @-mentions a few Zotero papers for a small review):
    user picks a few Zotero papers in chat
      → Agent dispatches reader fan-out → evidence rows[]
      → THIS SKILL (same as [A])
```

**Key design**: this skill consumes **evidence rows + paper identity**, not raw papers. It never
opens a paper's full text — it writes prose and drops the readers' verbatim quotes into
`<cite data-ref="N"><q>…</q></cite>`. It may byte-level verify/tighten a quote via
`papers_search_keywords` + `papers_read_context` on the row's locator, but never does a
full-document read (see Tool Usage Rules for the exact allowed/forbidden surface).

Each paper's place in the review is decided by the **reading bucket** the reader reported on its
evidence rows:
- `deep-read` → fully citable in §1–§6 (rich method / result quotes available).
- `abstract-only` → citable in §1–§6, but quotes come from abstract-keyed rows; note limited depth.
- `insufficient` → **§8 only (NOT §7)**; **not** cited in §1–§6.

**PDF parsing happens nowhere in this chain.** PDF→markdown is owned upstream by the wiki async
parser queue; if a paper isn't parsed yet the reader degrades to `abstract-only` / `insufficient`
and reports it — this skill never chases a PDF.

This skill's job, in three steps (detailed under "Workflow"): (1) number `papers[]` (array order =
citation index N, never reordered); (2) map each evidence row → paper N via `source_id`
(zoteroKey / doi), grouping rows + bucket per paper; (3) synthesize the §1–§8 HTML fragment with
`<cite data-ref="N"><q>…</q></cite>` citations (see "Output Format") and Write it to `reviews/`.

## Input Contract (since v0.21.0: papers identity + reader evidence rows)

The terminal-skill `input` carries **`papers[]`** (identity, for numbering + §7) and, since the
reader fan-out switched to terse pointers, the readers' / skimmer's **pointers**
(`{ N, source_id, bucket, rowCount, cacheFile }` each) rather than inline rows. **The evidence rows
themselves now live in the session `.context/*.evidence.json` cache** — your primary evidence
channel is to `Glob` + `Read` that cache (see "Evidence rows live in `.context/`" below). Inline
`evidenceRows[]` may still appear in the ad-hoc small-review chain where a reader inlined them;
when present, use them. A `blueprint` (direction skeleton) is optional.

### `papers[]` — identity + citation index

Each entry **must have at least `title`**; everything else is optional.

```json
[
  { "title": "...", "zoteroKey": "ABC12345", "abstract": "..." },
  { "title": "...", "doi": "10.xxx/yy",      "abstract": "..." }
]
```

Field semantics:
- `zoteroKey` / `doi` — Zotero identity; the **key used to match evidence rows** (`source_id`)
  back to this paper's index N.
- `abstract` — abstractNote from metadata; used as a §7/§8 fallback and to back abstract-only
  citations when a row's quote is itself abstract-keyed.
- `authors` / `year` / `venue` — optional metadata for §7. Missing fields can be filled via
  `workspace_papers_list()` (see below).

Conventions:
- **Array order = `[N]` citation number**, N starts at 1, **never reordered**.
- A paper with no evidence row and no abstract / identity → §8 only (or omitted); not cited in §1–§6.

### `evidenceRows[]` — reader output (the body's raw material)

Each row is the lit-review evidence schema (status `read`): `{ claim, source_id, locator, quote,
confidence, status:read, bucket }`. The `quote` is **already** a verbatim, single-contiguous-span,
source-language excerpt (≤240 CJK) — drop it straight into a `<q>` without re-cropping.

- **`source_id`** → map to paper N via `papers[].zoteroKey` (else `doi`). If a row's `source_id`
  matches no paper, drop the row (do not invent a citation).
- **`bucket`** (`deep-read | abstract-only | insufficient`) → per-paper reading tier; aggregate
  into §8 and gate §1–§6 citability (insufficient = §8 only, NOT §7).
- Multiple rows per paper are normal — they are the quote pool you draw `<q>` payloads from.

### Evidence rows live in `.context/` — your primary evidence channel

The reader fan-out runs BEFORE this skill and caches each paper's rows to a per-session file
`.context/<key>.evidence.json` under the session cwd, returning only terse pointers
(`{ N, source_id, bucket, rowCount, cacheFile }`) upstream. **So your default way to get evidence
rows is to read that cache** — not to expect inline `evidenceRows[]`. Do this on **every** run
(it is also what makes the pipeline compaction-proof: even if a context compaction dropped
everything, the cache is on disk):

1. `Glob(".context/*.evidence.json")` to list the cached files.
2. `Read` each file; each is `{ N, source_id, zoteroKey, doi, attachmentKey, title, bucket, rows[] }`.
3. Union all `rows[]` into your working `evidenceRows[]`; map each row to paper N (via `source_id`
   → `papers[].zoteroKey`/`doi`). The cached rows are a faithful copy of what the readers produced.
4. **`rowCount` guard**: if the `input` carried pointers, cross-check each pointer's `rowCount`
   against the cache file's actual `rows` length. A pointer with `rowCount > 0` but a missing /
   empty / unparseable cache file → that paper's evidence was lost; it cannot be cited (no
   quote), so mark it in §8 only as "evidence missing (cache not found)" and do NOT silently drop it.

This is the ONLY sanctioned use of `Read` / `Glob` in this skill, and it is scoped to
`.context/*.evidence.json` ONLY. **Never** use `Read` / `Glob` to open a paper's source
(`.md` / `.article.md` / `.txt`) — that is still forbidden (see Tool Usage Rules). When inline
`evidenceRows[]` ARE present (ad-hoc small-review chain), union them with the cache rows
(dedupe by `source_id` + `quote`); the cache is authoritative for the reader-fan-out chain.

If `evidenceRows[]` is **empty or absent AND `.context/` has no cached rows either** (no reader
fan-out ran): you cannot write a full-text review. Produce an abstract-only review from
`papers[].abstract` where available (each `<cite>` still carries a `<q>` excerpted from the
abstract), mark every paper `abstract-only` in §8, and add the §1 "Evidence depth limited" notice.
If neither rows nor abstracts exist → see Error Handling.

### blueprint (optional)

Comes from review-proposer's output. If present, the blueprint is the authoritative skeleton
for §1 / §2 / §8 tiers; do not re-judge direction. Structure is the same as before.

### Workspace paper metadata (optional supplement)

Call `workspace_papers_list()` once and join `authors / year / venue / doi / abstract` onto the
papers array via `linkedZoteroKey == itemKey`. Used for §7 References. **If a paper already
carries an abstract, do not let workspace data overwrite it.**

### User-attached PDFs

If the user `@`-mentioned a local PDF, it is handled the same way as any other paper: the reader
attempts it; if the wiki hasn't parsed it the reader reports `abstract-only` / `insufficient`.
This skill never reads the PDF — a not-yet-parsed @-attached PDF lands in §8 only.

## Citation Format — HARD REQUIREMENT (read this first)

**The only legal inline citation form is `<cite data-ref="N">`**, where N is the 1-based index of
the paper in `papers[]`. This overrides any default academic convention; the bare `[N]` bracket form
is not accepted (and `lit-review-structure-lint-guard` blocks stray `[N]` at Write time with a fix-list).

✅ Correct:

```html
<p>The wave-optics model established by Broxton et al. became the standard framework for LFM
reconstruction<cite data-ref="1"><q>verbatim source passage…</q></cite>.</p>
<p>Anti-aliasing filters effectively suppress artifacts<cite data-ref="3"><q>…</q></cite><cite data-ref="5"><q>…</q></cite>.</p>
```

❌ Forbidden: bare `[N]` / `[1,3]` / `[1][3]`; author–year anchors (`Broxton et al. (2013)`);
nested/wrapped (`<b><cite>…</cite></b>`, `<a><cite>…</cite></a>`, nested `<cite>`); merged
`<cite data-ref="1,3">` (use two adjacent `<cite>`s); **narrative `<cite>`** — a `<cite>` wrapping
your own paraphrase instead of a `<q>` quote (the most common slip, and rejected since it has no
`<q>` child).

**Mandatory inner payload**: every `<cite data-ref="N">` in §1–§6 contains exactly one `<q>…</q>`
child (see "Inline Quote Requirement"). §7 References (`<li id="ref-N">`) carry no `<q>`.

**Narrative vs quote — the decisive rule**: describe what a paper does in **plain prose with no
`<cite>`**; attach `<cite data-ref="N"><q>…</q></cite>` only where you drop in a real verbatim quote.
Do not emit a separate `<q>`-less `<cite>` for the narrative clause — the quote-cite that follows
carries the attribution. Author names / years may appear in prose as long as the anchor is `<cite>`.

```html
✅ <p>LLM 综述系统性地总结了注意力优化方向：<cite data-ref="7"><q>intra-layer attention grouping methods (e.g., GQA, MQA)…</q></cite></p>
❌ <p>LLM 综述<cite data-ref="7">系统性地总结了注意力优化方向</cite>：<cite data-ref="7"><q>intra-layer attention grouping methods…</q></cite></p>
```

## Tool Usage Rules (MANDATORY)

This skill is a body-writer; its tool surface is deliberately small. **Reading papers is NOT in
scope** — that already happened in the reader fan-out.

**Allowed tools (only these):**

- `workspace_papers_list()` — optional; fills §7 metadata (authors/year/venue/doi/abstract). At
  most one call per skill run.
- `papers_search_keywords({ query, paperIds?, fixedStrings?, caseSensitive?, maxResults? })` —
  ripgrep across the wiki `.md` corpus. Returns `[{ paperId, lineNumber, byteOffset, snippet }]`.
  **Targeted use only**: verify / tighten a quote from an evidence row, or locate the exact
  contiguous span for a row whose `quote` looks loose. Not for bulk reading.
- `papers_read_context({ paperId, byteOffset, contextBytes? })` — read N bytes around a
  byteOffset (default 300, clamped to [50, 2000]). Pairs with `papers_search_keywords` for the
  "hit → read context" flow during quote verification. **Byte-level only — never read a whole file.**
- `Write(path, content)` — saves the review HTML fragment to **`reviews/{filename}.html`
  relative to cwd** (the session cwd is `~/.asci/agent-workspaces/{slug}/{sessionId}/`; files
  written here show up in the right-hand "Session Files" panel). EXACTLY ONCE, after all
  content is generated and the consistency check passes. **Do not use absolute paths, do not
  use `../`, do not write to `workspace-files/`** (that is the cross-session workspace
  directory, not in the Session Files panel). **The file content must be an HTML fragment per
  the "Output Format" section — no `<html>` / `<head>` / `<body>` wrappers, no markdown.**
- `Glob(".context/*.evidence.json")` + `Read` — **the primary evidence channel** (full procedure in
  Input Contract → "Evidence rows live in `.context/`"). Scoped to `.context/*.evidence.json` only.

**Forbidden tools (reading belongs to the reader SubAgent):**

- `papers_read_outline` / `papers_read_article_section` — full-document / whole-section reads are
  the reader's job. This skill works from the evidence rows; do not re-read the article.
- `Read` / `Glob` on a paper's source — do not read `mdPath` / `.article.md` / `.txt` / any paper
  file. The rows already carry the quotes. (`Read` / `Glob` are permitted ONLY for the
  `.context/*.evidence.json` cache recovery described above; use `papers_search_keywords` +
  `papers_read_context` for byte-level quote checks.)
- `zotero_wiki_lookup` — path resolution happened inside the reader. This skill does not resolve.
- `pdf_parse_batch` / `zotero_get_attachment_path` — never; PDF→markdown is owned upstream by the
  wiki async parser queue.
- `Bash` / `Shell` / `execute_code` — not needed; disabled to shrink the error surface.
- Any network tools (`WebFetch` / `WebSearch`) — this skill only synthesizes the evidence rows.
- `Edit` — use `Write` for the new file; do not edit a saved file.

Violating these rules degrades review quality. In particular, do NOT re-derive quotes by reading
the article — every `<q>` must come from an evidence row (or a `papers_read_context` tightening
of that row's span).

## Workflow (3 steps)

### Step 1 — Intake & Numbering

Extract `papers[]` and `evidenceRows[]` from the prompt context. Number the papers into a fixed
array:

```text
[
  { N: 1, title: "...", zoteroKey: "ABC12345", abstract?: "..." },
  { N: 2, title: "...", doi: "10.xxx/yy",      abstract?: "..." },
  { N: 3, title: "...", zoteroKey: "DEF67890" }
]
```

**Numbering rules**:
- Array order = `[N]` citation number, **never reorder**.
- Upstream papers keep their original order; any extra entries get the next numbers (N must not
  be skipped and must not collide with earlier numbers).

**Edge cases**:
- If `papers[]` is empty → reply "Upstream did not provide any papers; cannot generate a
  review" and stop.
- If fewer than 3 papers → continue normally; note "limited review scope" in §1.

Optional: call `workspace_papers_list()` once to fill authors/year/venue/doi/abstract for §7.
**Do not** let workspace data overwrite an existing abstract field in papers[].

### Step 2 — Evidence Mapping & Bucket Aggregation (think; tools only for targeted checks)

You do NOT read papers — the reader fan-out already did. Instead, organise the evidence rows:

1. **Map each row → paper N** via `source_id` (match `papers[].zoteroKey`, else `doi`). Group
   rows under their paper. Rows whose `source_id` matches no paper are dropped.
2. **Aggregate the per-paper reading bucket** from its rows' `bucket` field:

   | Per-paper bucket | Meaning | Citable in §1–§6? | §8 wording |
   |---|---|---|---|
   | `deep-read` | reader read the structured source | ✅ rich quotes available | `Deep-Read — <reader reason>` |
   | `abstract-only` | wiki parse not finished; rows keyed to abstract | ✅ but limited depth | `Abstract-Only — <reader reason>` |
   | `insufficient` | not in wiki index / no source | ❌ §8 only (NOT §7) | `Metadata-Only — <reader reason>` |

   - **Blueprint present**: papers not covered by the blueprint go into §8 as `not included in
     this direction by blueprint`; not cited in §1–§6 even if they have rows.
3. **Quote pool**: each paper's rows are the pool of `<q>` payloads for Step 3. The row `quote`
   is already verbatim / single-contiguous-span / source-language — use it as-is. Only when a
   row's quote looks loose or you need a tighter span do you call `papers_search_keywords` +
   `papers_read_context` (byte-level, using the row's `locator` / `paperId`) to verify it.

**Global downgrade** (see Error Handling): no rows but some abstracts → abstract-only review (§1 gets
the "Evidence depth limited" sentence; every `<cite>` still carries an abstract-excerpted `<q>`); no
rows and no abstracts → stop with "Input papers lack readable material; cannot generate a review".

### Step 3 — Synthesize & Finalize

Produce **§1–§8** per the "Output Format" below as a **single HTML fragment** (**do not** put
the evidence-depth reminder inside the file — that belongs to the chat reply) → run the
Consistency Check yourself → on success call `Write` to save → in the chat reply, optionally
append the evidence-depth reminder per the template below.

**Write target path** (**relative to the current cwd**; cwd is the session root, and files
saved here appear in the right-hand "Session Files" panel):

```
reviews/{YYYY-MM-DD_HH-mm}-{dir_slug}.html
```

- **Must be a relative path**; the first character is not `/`; no `../`. Pass `"reviews/..."`
  directly to `Write(path, content)`.
- **Do not** write to `workspace-files/` — that is the shared workspace directory and does not
  appear in the session files panel.
- `{YYYY-MM-DD_HH-mm}`: current local time, 24-hour format (e.g. `2026-04-24_15-30`).
- `{dir_slug}`: a short slug of the direction title from the blueprint (lowercase, spaces →
  `-`, punctuation stripped, at most 40 chars); use `review` when there is no blueprint.
- Example: `reviews/2026-04-24_15-30-lfm-reconstruction.html`
- `Write` auto-creates the `reviews/` subdirectory; no need to mkdir first.
- **Extension MUST be `.html`** (see top callout) — `.md` is a task failure even with correct HTML.

**Write content**: the complete §1–§8 HTML fragment per "Output Format", in a single `Write` call,
with every `<cite data-ref="N"><q>…</q></cite>` written verbatim.

**Wrap-up**: after Write succeeds, emit a short save confirmation (the `reviews/…html` path) and
**report the evidence-depth tally** — the abstract-only and metadata-only paper counts (and which
papers) — so the caller can word the user-facing notice. In the primary pipeline the `body-writer`
SubAgent relays these counts and the **scenario Turn-2 closing words the user notice; you do NOT
re-emit it**. Only when this skill is **invoked directly** (no body-writer wrapper) is your chat reply
user-facing — then also append the notice yourself (compact template under "Evidence Depth Reminder").

```
Review saved to the session files panel: reviews/2026-04-24_15-30-lfm-reconstruction.html
```

Do not echo Write's return value; do not call any tool after this; **never** write the evidence-depth
notice into the HTML file (it is chat-only).

Handling **Write failure**:

- First failure → retry once.
- Second failure → append `> ⚠ Review generated but save failed; please copy the HTML above
  manually.` to the reply and stop.

## Output Format

The file is an HTML fragment wrapped in `<article class="asci-review" data-version="1">`; the renderer
sanitizes it with DOMPurify then embeds via `dangerouslySetInnerHTML` — so inline `style` / event
handlers / `<script>` are stripped (don't emit them). Fragment + no-markdown rules: see the top callout.

**Sanitizer allowlist** (the renderer keeps these tags and attributes; everything else is
stripped):

- Tags: `article`, `header`, `section`, `h1`, `h2`, `h3`, `p`, `ul`, `ol`, `li`, `cite`, `q`,
  `em`, `i`, `b`, `strong`, `code`, `pre`, `blockquote`, `table`, `thead`, `tbody`, `tr`, `th`,
  `td`, `figure`, `figcaption`, `br`, `hr`, `a`, `span`.
- Attributes: `class`, `id`, `data-ref`, `data-paper-id`, `data-doi`, `data-zotero-key`,
  `data-version`, `href` (http/https only), `title`, `lang`, `dir`.

**Math**: write LaTeX delimiters verbatim (`\(…\)` for inline, `\[…\]` for block, or `$$…$$`).
The renderer runs KaTeX `auto-render` against the sanitized DOM; do **not** pre-render KaTeX
HTML yourself.

The file must contain **exactly one** top-level `<article class="asci-review" data-version="1">`
element; everything else lives inside it. Sections appear **in order** §1–§8 below.

### Skeleton

```html
<article class="asci-review" data-version="1">
  <header>
    <h1>{{review title — required, plain text}}</h1>
    <p class="topic">{{optional topic / direction line}}</p>
  </header>

  <section id="s1">
    <h2>§1 Introduction</h2>
    <p>…</p>
  </section>

  <section id="s2">
    <h2>§2 Core Themes</h2>
    <p>… key claim<cite data-ref="3"><q>verbatim source passage…</q></cite> …</p>
  </section>

  <!-- §3 Methodologies / §4 Key Findings / §5 Gaps / §6 Conclusion: same shape -->

  <section id="s7" class="references">
    <h2>§7 References</h2>
    <ol class="refs">
      <li id="ref-1" data-ref="1" data-doi="10.xxx/yyy">
        Broxton, M., et al. <i>Wave optics theory and 3D deconvolution for the light field microscope</i>. Optics Express, 2013.
      </li>
      <li id="ref-3" data-ref="3">
        Stefanoiu, A. <i>Artifact-free deconvolution in light field microscopy</i>. (2019)
      </li>
    </ol>
  </section>

  <section id="s8" class="decisions">
    <h2>§8 Per-Paper Decisions</h2>
    <ul>
      <li data-ref="1">Deep-Read — read raw mdPath (whole file)</li>
      <li data-ref="3">Abstract-Only — full text unavailable (wiki parse not finished)</li>
    </ul>
  </section>
</article>
```

### Section content

- **`<header>` / `<h1>`**: short review title (plain text only; no nested tags). The renderer
  also derives the DB row's title from the first `<h1>` in the fragment.
- **`<section id="sN">`**: §N container. Use `<h2>§N Title</h2>` as the section heading; use
  `<h3>` for any subsections inside (do not skip levels).
- **§1 Introduction**: research background + the core goal of the papers. If deep-reading was
  globally downgraded, add a `<p class="evidence-depth-notice">Evidence depth limited: this
  review is based primarily on abstracts.</p>` here. If a blueprint exists, §1 must reflect
  `blueprint.core_question`.
- **§2 Core Themes**: with a blueprint, §2 uses `expected_themes` as its skeleton (new themes
  allowed; do not drop listed themes unless the deep read shows they have no support).
- **§3 Methodologies / §4 Key Findings / §6 Conclusion**: same prose-with-citation
  shape as §2.
- **§5 Gaps (研究空白 / 开放问题) — the most frequently-dropped section; mandatory whenever the
  evidence surfaces any gap signal**: unresolved problems, contradictory findings, author-flagged
  limitations, untested assumptions, missing baselines / datasets, or explicit "future work". Mine
  these from the evidence rows. Write §5 as its own `<section id="s5">` with a gaps / open-problems
  heading (e.g. "§5 研究空白与开放问题") — do **not** rename it to a generic theme or merge it into
  §6. Back each gap with a `<cite data-ref="N"><q>…</q></cite>`. Only omit §5 on genuinely zero gap
  signal — then state in §6 that no significant open problems were surfaced.
- **§7 References**: `<ol class="refs">` of `<li id="ref-N" data-ref="N">` entries.
  - `data-ref="N"` must equal the paper's 1-based index in `papers[]`. **Do not renumber by
    appearance order.**
  - Sort items by N ascending; gaps are allowed (uncited papers do not appear in §7). **Two
    numbering levels — do not conflate:** `papers[]` numbering is **contiguous** 1..M (never skip an
    N there); §7 lists only the **cited subset** of those N's, so §7's visible numbers may have
    **gaps** — that is expected. Removing an uncited paper leaves a gap; do **NOT** renumber the
    remaining entries to close it (`data-ref` must stay = the paper's `papers[]` index).
  - Every `data-ref="N"` used in §1–§6 must have a matching `<li id="ref-N">`; every `<li>`
    in §7 must be cited at least once in §1–§6.
  - Items in §7 **do not** carry a `<q>` payload.
  - **Identity attributes (set whichever the paper carries; this is how the evidence sidebar
    links the reference back to a real paper — getting it wrong shows "(source removed)")**:
    - `data-zotero-key="<zoteroKey>"` — when the paper has a Zotero key (the common case, since
      `papers[]` identity is `zoteroKey`/`doi`). **Always prefer this for Zotero papers.**
    - `data-doi="<doi>"` — when the paper has a DOI.
    - `data-paper-id="<id>"` — **ONLY** for a real workspace/library Paper object id. **Never put
      a `zoteroKey` or a DOI in `data-paper-id`** — it is matched as a DB primary key, so a
      mislabeled value resolves to nothing and the reference renders as "(source removed)". If all
      you have is a Zotero key, use `data-zotero-key`, not `data-paper-id`.
    - Never invent values; omit an attribute you don't have.
- **§8 Per-Paper Decisions**: `<ul>` of `<li data-ref="N">` lines — **one per paper in `papers[]`
  (every considered paper, including the uncited / metadata-only ones that do NOT appear in §7)**.
  §8 is the full per-paper decision ledger, so a paper that was dropped from §7 for being uncited
  still has its home here. Keep the legacy three-bucket wording (Deep-Read / Abstract-Only /
  Metadata-Only) followed by an em-dash and the reason.

### §7 entry format (the renderer parses inner text for the hover tooltip)

Inside each `<li data-ref="N">` the **plain-text content** must follow this pattern (the
renderer extracts authors / title / year / venue from the textContent):

1. **Authors come first**, then `. ` separator.
2. **Title wrapped in `<i>…</i>`** (italics) — this is the authors / title delimiter; do not
   use `<em>` or `<b>`.
3. **Venue / Year after** the title; segments separated with `. `.
4. **Year is a 4-digit 19xx / 20xx**; allowed anywhere as `(2024)` / `, 2024` / at the end; the
   parser takes the last match.
5. Keep the entry on one logical line (line breaks are stripped, but do not insert `<br>` /
   nested block tags).

✅ Recommended:

```html
<li id="ref-1" data-ref="1" data-zotero-key="F5E2JEY7" data-doi="10.1364/OE.21.025418">
  Broxton, M., et al. <i>Wave optics theory and 3D deconvolution for the light field microscope</i>. Optics Express, 2013.
</li>
<li id="ref-3" data-ref="3" data-zotero-key="ABC12345">
  Stefanoiu, A. <i>Artifact-free deconvolution in light field microscopy</i>. (2019)
</li>
```

❌ Avoid (title not in `<i>` / authors after title / missing `data-ref` → parser fails or hover degrades):

```html
<li id="ref-1" data-ref="1"><b>Broxton et al.</b> Wave optics... 2013.</li>
```

## Inline Quote Requirement (mandatory)

**Every** `<cite data-ref="N">` citation in §1–§6 must contain **exactly one** `<q>…</q>` child
whose content is the source evidence backing that citation.

```html
<p>The wave-optics model established by Broxton et al. became the standard framework for LFM
reconstruction<cite data-ref="1"><q>verbatim-ish source passage, 1–3 sentences, ≤240 chars</q></cite>.</p>
```

Hard rules:

- `<q>` appears ONLY inside a `<cite data-ref="N">` in §1–§6. §7 / §8 `<li>` entries carry no
  `<q>`. Combined citations = two adjacent `<cite>` elements each with its own `<q>`
  (`<cite data-ref="1"><q>…</q></cite><cite data-ref="3"><q>…</q></cite>`); never merge into one.
  Do not nest `<cite>`/`<q>`, and do not place `<cite>` inside `<pre>`/`<code>`. The same `data-ref`
  at multiple positions each gets its own `<cite><q>`.
- **Quote source** by bucket: deep-read → an evidence row's `quote` (already verbatim/contiguous;
  tighten via `papers_search_keywords` + `papers_read_context` on its `locator`, never by re-reading
  the article); abstract-only → an abstract-keyed row's `quote`, else `papers[i].abstract`, else the
  `workspace_papers_list` abstract; neither full text nor abstract → do not cite in §1–§6.
- **Single contiguous span only — no `…` / `...` / `⋯` bridging, no trailing ellipsis**: the `<q>`
  must appear verbatim at one location in the source (a bridged string exists nowhere, breaking the
  "jump to PDF and highlight" UX). If one ≤240-char span can't cover the claim, pick the most
  representative sentence/clause, or split into two adjacent `<cite>`s — never stitch with `…`.
  - ❌ `<q>We evaluated 21 inorganic solid electrolytes … structural stability and material cost</q>`
  - ✅ `<q>structural stability and material cost across 21 inorganic solid electrolytes</q>`
- **Preserve source language — never translate / paraphrase**: English paper → English quote,
  Chinese paper → Chinese quote (the body prose may differ). The whole point of the tooltip is the
  verbatim original as verifiable evidence; a translated/paraphrased `<q>` is a task failure.
  - ✅ `<cite data-ref="5"><q>Language modeling performance improves smoothly as we increase model
    size, dataset size, and the amount of compute</q></cite>` — not a paraphrase, not `…`-bridged.
- Whitespace normalization is allowed; **never** change numbers / units / sign of conclusions.
  Length ≤ 240 Chinese chars (English words ≈ 0.5 char each).
- **Abstract-only is NOT exempt**: every `<cite data-ref="N">` still gets a `<q>` excerpted from the
  abstract (reusing the same sentence across `<cite>`s is fine). "Short" / "would repeat" is not a
  reason to leave a `<cite>` bare.
- Missing `<q>` (bare `<cite data-ref="N"></cite>` or text-only payload) = task failure — and is
  caught deterministically by `lit-review-structure-lint-guard` at Write time, which blocks with a
  per-occurrence fix-list. Get it right up front rather than relying on the rejection round-trip.

## Citation Rules

- Every key claim is backed by ≥1 `<cite data-ref="N"><q>…</q></cite>`; multi-paper claims emit one
  `<cite>` per paper back-to-back (no merged `data-ref="1,3"`).
- **Never** fabricate citations or cite papers outside `papers[]`; if a claim isn't supported by the
  material, say so rather than inventing.
- Prefer read-from-file content for detailed / methodological / quantitative claims; abstracts carry
  only framing / background.

## Evidence Depth Reminder (chat-only; direct-invocation path)

In the primary pipeline the **scenario Turn-2 closing** words this notice from the counts you report
— you do NOT emit it. This section applies **only when the skill is invoked directly** (no body-writer
wrapper), where your chat reply is user-facing.

> **Two distinct things — do not mix:** the §1 in-HTML `<p class="evidence-depth-notice">Evidence depth
> limited…</p>` sentence (global-downgrade only, stays in the file) vs this **chat-only** "Evidence
> depth notice" (which papers + how to fix) — the notice **never** goes into the HTML.

**Trigger**: ≥1 paper is abstract-only or metadata-only (both empty → emit nothing). Compact template
(markdown, after the "Review saved…" line; each `[N]` = the paper's 1-based `papers[]` index; no `<q>`):

```markdown
> ⚠ **Evidence depth notice** — K papers abstract-only (not full text), M papers metadata-only (not cited in §1–§6):
> - [N] Authors. *Title*. (Year)
>
> Fix: attach the missing PDF in Zotero and wait for the wiki parser, or narrow the set / use a larger-context model, then re-run.
```

## Consistency Check (must run before Write)

Before calling `Write`, self-check every item below:

1. The file is a single HTML fragment rooted at `<article class="asci-review" data-version="1">`;
   no `<html>` / `<head>` / `<body>` outer wrappers; no markdown syntax (`#`, `*emph*`, `[N]`,
   fenced code blocks); no inline `style` / event handlers / `<script>` / `<iframe>`.
2. Every inline citation in §1–§6 uses the form `<cite data-ref="N"><q>…</q></cite>`; no bare
   `[N]`, no wrapping (`<b><cite>…</cite></b>` / `<a><cite>…</cite></a>` / nested `<cite>`),
   no merged `data-ref="1,3"`; no `<cite>` inside `<pre>` / `<code>`.
3. Every `data-ref="N"` that appears inside `<cite>` in §1–§6 has a matching `<li id="ref-N"
   data-ref="N">` in §7.
4. **§7 = EXACTLY the §1–§6 citation set.** Every `data-ref="N"` cited in §1–§6 has a matching
   `<li id="ref-N">`, AND every `<li>` in §7 is cited at least once in §1–§6. **Any uncited paper
   — of ANY bucket (abstract-only that ended up uncited, insufficient, metadata-only) — appears in
   §8 ONLY, never §7.** When a paper is uncited, leave its N as a GAP in §7; `data-ref` always
   equals the paper's 1-based index in `papers[]`, so do NOT renumber the remaining §7 entries.
5. The N of every `data-ref` equals the paper's 1-based index in `papers[]`; **no renumbering**.
6. §7 `<li>` entries sorted by N ascending; gaps are allowed.
7. The N used per paper in §8 (`<li data-ref="N">`) matches §7 / the citations.
8. Every §1–§6 `<cite>` has exactly one `<q>` first-child (sourced per bucket, source-language,
   never translated/paraphrased); §7 / §8 `<li>` carry no `<q>`. (Details: Inline Quote Requirement.)
9. If Path A (blueprint present):
   - §1–§6 cites no papers outside the blueprint coverage set.
   - Each §8 Deep-Read entry matches that paper's role tier in the blueprint (unless
     downgraded by parse / read failure).
   - All papers excluded by the blueprint go into §8 (not cited in §1–§6). Keep each paper's own
     bucket label (`Metadata-Only` for insufficient, `Abstract-Only` for abstract-only, `Deep-Read`
     for deep-read) and append `— not included in this direction by blueprint` as the reason; do
     NOT relabel an insufficient paper as Abstract-Only.
10. **The HTML file contains NO "Evidence depth notice"** — that notice is chat-only; only the §1
    `<p class="evidence-depth-notice">Evidence depth limited…</p>` sentence (global downgrade) may
    appear inside the HTML.
11. **§5 Gaps present unless evidence truly has none** (see Output Format §5): if the rows surface
    any limitation / disagreement / unresolved-problem / "future work" signal, the fragment MUST
    contain a dedicated `<section id="s5">` (not a generic theme, not merged into §6). Omit §5 only
    on genuinely zero gap signal — and then §6 must explicitly say no open problems were surfaced.

Any item failing → fix in place → re-check. **Never** return an inconsistent review.

## Error Handling Summary

| Trigger | Behavior | Stop? | Call Write? |
|---|---|---|---|
| `papers[]` missing / empty | Reply `Upstream did not provide any papers; cannot generate a review` | ✅ | ❌ |
| No evidence rows, but some papers have abstracts | Produce an abstract-based review from `papers[].abstract` (note "Evidence depth limited..." in §1); mark every paper abstract-only in §8 | ❌ | ✅ |
| No evidence rows and no abstracts | Reply `Input papers lack readable material; cannot generate a review` | ✅ | ❌ |
| A row's `source_id` matches no paper | Drop that row (do not invent a citation); keep processing others | ❌ | ✅ |
| A paper has only `insufficient` rows | List it in §8 only (NOT §7); do not cite in §1–§6 | ❌ | ✅ |
| `workspace_papers_list` fails | Ignore; fall back to info carried by `papers[i]` and the evidence rows | ❌ | — |
| `papers_search_keywords` / `papers_read_context` fail during a quote check | Use the row's `quote` as-is (it is already verbatim); do not block | ❌ | ✅ |
| Consistency Check fails | Fix in place + re-check | ❌ | ✅ |
| `Write` fails the first time | Retry once | ❌ | ✅ (retry) |
| `Write` fails the second time | Append `> ⚠ Review generated but save failed...` to the reply; stop | ❌ | ❌ (give up) |

## Tone & Quality

- Academic writing: formal, objective, analytical.
- Emphasize **synthesis**: surface agreement / disagreement / inter-paper relationships; **do
  not** summarize one paper at a time.
- Concise but with academic depth.
- Output in Chinese (unless the blueprint or ready data is clearly a pure-English scenario).

## Integration Hints

- **This skill runs inside the `body-writer` SubAgent's isolated context** (the Turn-2 PLAN names
  body-writer as its `terminal_subagent`). Functionally nothing changes for you — same input, same
  `.context` glob, same HTML output; the point is the bulky review prose stays in body-writer's
  context and never enters the main loop, avoiding a mid-run compaction. Return your usual short save
  confirmation; body-writer relays a terse pointer upward.
- One review per turn; to switch direction or expand the paper set, go back to `review-proposer`.
- The review HTML lands under `reviews/` in the session cwd and opens from the "Session Files" panel
  (the renderer detects `.html` and pipes it through DOMPurify + KaTeX + citation post-processing).
  No index is written. To persist across sessions, the user copies it into `workspace-files/reviews/`
  or downloads it — this skill does not duplicate it proactively.

---

## ⚠ FINAL LANGUAGE ANCHOR — obey from your very next thinking token

Reading this English manual does NOT switch your working language. Re-apply the resolved
`outputLanguage` now, from your first thinking sentence: `"zh"` → 思考与叙述全程中文（首句即中文，
勿以 "Let me" / "First" 开场）；`"en"` → think and narrate in English. Either way, `<q>` quotes,
titles, author names and DOIs / URLs stay verbatim in the source language.

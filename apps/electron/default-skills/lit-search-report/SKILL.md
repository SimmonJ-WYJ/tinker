---
name: lit-search-report
description: >
  Generate a structured **search report** (检索报告) from the lit-search session —
  trigger whenever the user asks to "generate a search report / 生成检索报告 / 检索结果报告 /
  出一份检索报告 / write up the search results", or when the lit-search PLAN names this skill as
  its terminal_skill. This is NOT a literature review (route review WRITING to
  `literature-review-result`) and it does NOT deep-read papers (that is the lit-review `reader`'s
  job). It is a pure METADATA CONSUMER: it reads (1) the already-persisted candidate set across
  ALL search rounds of the session (title / authors / year / abstract / relevance score —
  `score.finalScore`, legacy fields as fallback) and
  (2) the search strategy + per-source hit counts handed in via `input`, then synthesizes a
  **tiered** report — ≥50 unique candidates → FULL six-section report (overview · theme
  distribution · recommendations by theme · key research groups · trends & gaps · next steps);
  <50 → MINIMAL three-section report (overview · top papers · coverage & limitations) — as a
  sanitizer-friendly HTML fragment saved to `searches/{timestamp}-{slug}.html` under the session
  cwd. The right-panel renderer switches on the `searches/` path + `.html` extension to render it
  with DOMPurify + KaTeX + citation decoration. The paper list itself already lives in the search
  panel; this report adds the prose the ≤60-word closing summary cannot carry.
allowed-tools: Bash Write
version: "0.4.8"
category: general
---

# Lit-Search Report — Search Report Generation (ASCI edition)

## ⚠ OUTPUT LANGUAGE — HARD REQUIREMENT (read FIRST, every run)

These instructions are injected into the **same conversation** you are already in. The
`<language_lock>` you saw earlier this turn still applies, and this English document is **never**
a reason to switch language. Resolve the language as follows:

1. If your `input` carries an `outputLanguage` field (`"zh"` or `"en"`), **that is authoritative**.
2. Otherwise, fall back to the language of the user's request / conversation.

The language of intermediate tool / script / MCP outputs you receive mid-run never overrides this
choice — `outputLanguage` stays authoritative for the entire run, regardless of the language or
format (tables, arrays, JSON, HTML, plain text) of anything a previous step returned.

Set `judgments.lang` to the resolved language and write **every natural-language judgement field**
in it — the report `title`, theme names/descriptions, recommendation reasons, group contributions,
trends, and gaps. (`render_report.py` renders all section headings and table labels itself —
single-language in the resolved `lang`, never bilingual — so you never write a heading or label.)

This also governs your **reasoning / thinking traces and any narration you emit between tool calls**
(e.g. "Let me load the candidate set", "Now I'll analyze the data") — these intermediate texts are
shown to the user, so they must be in the resolved language too. Do NOT think in English and only
fill the judgement JSON in the target language; if the resolved language is `"zh"`, your
step-by-step reasoning is also in Chinese. Identifiers stay English regardless: DOIs, URLs, file
paths, author names, and paper titles (keep each title verbatim in its original language).

## ⚠ v0.4.0 — YOU PRODUCE JUDGEMENT JSON, NOT HTML (read FIRST, every run)

The HTML report is assembled **deterministically by `render_report.py`**, not by you. Your job is
to produce only the *judgement* fields — theme clustering, one-line recommendation reasons, group
contributions, trends, gaps — as a small JSON object. Every structural / data field (titles,
authors, years, DOIs, counts, References) is filled by the script straight from the candidate set.

Why: the slow part of the old skill was you re-typing data the database already holds (titles,
DOIs, stats, References — ~76% of the bytes). Offloading that to code is both **faster** (you stop
emitting ~30KB of HTML) and **safer** (no transcription errors in DOIs / long titles). The output
path format and the References numbering are now **guaranteed by code**: a search report **carries no
`[N]` citation markers anywhere in the body** (it reports *distribution* — it does not cite like a
review). In a FULL report each paper sits under a single theme, so the §3 table is numbered
**1..K top-to-bottom** via a leading **No.** column, and the closing References list holds **exactly
those §3 papers** with the **same numbers** — row N in §3 ↔ entry N in References (§4 representative
works show a title only and are not numbered into the References). The historical "wrong path /
drifting citation index / uncited refs" failure modes are gone.

**Three hard rules:**

1. You **never** write an `.html` file and **never** hand-author any `<tag>`. The only file you
   `Write` is `.report-build/judgments.json`.
2. Every paper you reference is identified by its **`n`** (the integer index `render_report.py
   prepare` printed for it). `n` is purely an **internal join key** for your judgement fields
   (`paper_ns`, the `recommendations` / `top_findings` keys, etc.) — it is **not** a visible citation
   number. The rendered report shows **no `[n]` badges**; the script resolves `n` → title / DOI and
   renumbers the References 1..K by appearance. Never type `[n]` or any `<cite>`.
3. Run exactly the three Bash/Write steps below, in order. Do not print the report into chat.

`$SKILL_DIR` below = **this skill's base directory** — the absolute path given on the first line of
this skill's invocation result ("Base directory for this skill: …"). `render_report.py` sits in it.

---

## Positioning

You are the **search-report generator** and the optional terminal step of a lit-search session. You
turn an already-finished search (the candidate set is persisted, the panel is rendered) into a
human-readable report covering **all search rounds of the session**. You do **not**:

- search, re-search, re-score, or re-rank — searching already happened (`searcher`), and scoring
  was already done by `scorer` (`apply_scoring`).
- deep-read / open full text — you only use the candidate metadata (title / authors / year / abstract).
- write a literature review or synthesize cross-paper arguments — that is `literature-review-result`.
- invent numbers, titles, DOIs, authors, or **affiliations** — everything you state must trace to the
  candidate set or the counts handed in via `input`.

The report's value is the **prose the ≤60-word closing summary cannot carry**: why these sources,
what came back, how it clusters, who keeps publishing it, what is missing.

---

## Tiering — `render_report.py prepare` decides it for you

`FULL_REPORT_MIN_RESULTS = 50` (unique candidates across all rounds, post-dedup). Step 1 prints
`tier=FULL` or `tier=MINIMAL`; **do not re-derive it**. You fill the judgement fields the printed
tier needs (see the Judgements schema). Never pad a thin candidate set into FULL; never truncate a
large one into MINIMAL — the script renders strictly the printed tier.

---

## Input Contract

The main Agent invokes you via `Skill(lit-search-report)` and SHOULD pass an `input` JSON object
with `plan_summary` (`research_question`, `keywords`, `sources`, `method_terms`, `time_range`…) and
optionally `rounds` (per-round strategy/keywords) and `panel` (pre-dedup counts).

**`rounds` and `panel` are usually absent** — the auto-trigger path fixes `input` at plan time
(before any counts exist), so in practice you receive only `plan_summary` (possibly partial). **Do
not depend on them.** Your authoritative counts are the ones **Step 1 derives from the JSONL**
(`total_unique`, the per-round `ROUND` lines, `by_source`). Use `rounds` only to label rounds with
their keywords; use `panel` only when present (its `total_from_sources` is the one figure the JSONL
cannot give). When either is absent, omit those details rather than inventing them.

---

## Workflow (3 steps)

### Step 1 — `prepare`: load + dedup + stats + print candidates (one Bash call)

```bash
python3 "$SKILL_DIR/render_report.py" prepare --out .report-build/report-data.json
```

`prepare` reads the whole-session candidate set (it derives the JSONL path itself from the cwd —
the session JSONL convention `agent-sessions-papers/<session>.jsonl`; do NOT explore
the filesystem), dedups globally across rounds, computes stats, decides the tier, assigns each
surviving candidate a stable index `n` (1..N by relevance score desc — `score.finalScore`,
legacy `finalRelevance` / `relevance` as fallback), writes
`.report-build/report-data.json`, and prints, for you to read:

```
tier=FULL total_unique=161 with_abstract=75 years=2009-2026 by_source={...}
ROUND {"round": 1, "rows": 161, "new_unique": 161, "by_source": {...}}
RECURRING_AUTHORS [["James Chih-Hsin Yang", 5], ...]
DATA_FILE .report-build/report-data.json
{"n": 1, "title": "...", "authors": [...], "year": 2026, "doi": "...", "finalRelevance": 90, "abstract": "..."}
                                       // ^ printed key keeps the legacy name; the value is the
                                       //   resolved relevance score (score.finalScore first)
{"n": 2, ...}      // top 40 (FULL) or top 10 (MINIMAL)
```

If it prints `NO_CANDIDATES`, it still wrote a minimal `report-data.json`; proceed to Steps 2–3 and
state in `overview` / `coverage` that the panel was not populated (do not invent papers).

### Step 2 — produce the judgement JSON and `Write` it

Read the printed candidates (reference each by its `n`) plus `input`, then `Write`
`.report-build/judgments.json` following the **Judgements schema** below. This is the ONLY file you
author. Do not write any HTML.

### Step 3 — `render`: assemble the HTML and write the report (one Bash call)

```bash
python3 "$SKILL_DIR/render_report.py" render \
  --data .report-build/report-data.json \
  --judgments .report-build/judgments.json \
  --out-dir searches
```

`render` joins your judgements onto the candidate data by `n`, assembles the sanitizer-friendly HTML
fragment (filling §1 stats / §3 No.·title·author·year·DOI columns / §4 hits / References from the data,
and your reasons/themes/trends into the judgement slots; fixed labels localised by `lang`), writes
`searches/{YYYY-MM-DD_HH-mm}-{slug}.html`, and prints the final path. **That path is the report —
do not also print the report body into chat.** You are done.

---

## Judgements schema (`.report-build/judgments.json`)

```jsonc
{
  "lang": "zh",                         // "zh" | "en" — resolved per the OUTPUT LANGUAGE section
                                        //   above. Sets the localised fixed labels AND must match
                                        //   the language you write reasons/themes/trends in.
  "title": "文献检索报告：…",            // report <h1>, plain text
  "research_question": "…",             // shown in §1 检索主题 (use input.plan_summary.research_question)
  "slug": "osimertinib-adverse-effects",// SHORT ascii-only slug for the filename (you translate the
                                        //   topic to a few english words; script sanitises it)

  // ─ FULL tier (tier=FULL) ─────────────────────────────────────────────────
  "themes": [                           // 3–6 themes, clustered from the printed top set's
    {                                   //   titles+abstracts. EACH theme must hold ≥2 candidate
      "name": "间质性肺炎（ILD）的识别与管理",  //   papers; merge/drop one that cannot. Never pad with
      "desc": "1–2 句主题描述，落脚于该主题候选论文的共性。", // papers outside the printed set.
      "paper_ns": [1, 8, 14, 16]        // relevant n's for this theme (drives §3; be generous, no
                                        //   row cap). Assign each paper to ONE theme only — the same
                                        //   n must not appear in two themes. See Content rules §3.
    }
  ],
  "recommendations": {                  // n → one-line why-relevant, GROUNDED IN THAT PAPER'S
    "1": "系统综述与 meta 分析，评估 ILD 后再挑战的安全性与获益。",  // abstract. If a paper has no
    "8": "重症肺炎个案，提供 tocilizumab 处置经验。"               // abstract, OMIT it here — the
  },                                    //   script fills a "(no abstract; relevance capped at 60)".
  "groups": {                           // RECURRING_AUTHORS only (≥2 hits). author → one-line
    "James Chih-Hsin Yang": "在 EGFR-TKI 耐药与不良反应管理方向持续产出。"  // contribution from THEIR
  },                                    //   papers' abstracts. NO affiliations (not in the data).
  "trends": [                           // 1-line trend statements as plain strings — a search
    "支持治疗与剂量调整并重，长期安全性数据仍在积累。"                      //   report states trends, it does
  ],                                    //   NOT cite papers (no [N] markers anywhere).
  "gaps": [                             // candidate-set-scoped inferences ("not seen in THIS
    "候选集中未见 ILD 与心脏毒性联合管理的前瞻研究。"                       //   search"), never field-wide
  ],                                    //   claims.

  // ─ MINIMAL tier (tier=MINIMAL) ───────────────────────────────────────────
  "overview": "1–3 句总体观察：高分论文聚焦的方向、共识或分歧。",
  "top_findings": {                     // n → one-line why-relevant for the top ≤10 (script lists
    "1": "ILD 再挑战安全性的最高级别证据。"                                //  all printed papers as plain
  },                                    //   text "title — relevance X. <why>", no [N] badge).
  "coverage": "命中分布；哪些源返 0/失败/被早停丢弃；可见盲区与下一步建议（如手动重试某源、放宽年份）。"
}
```

**Provide the fields for the printed tier** (FULL → `themes`/`recommendations`/`groups`/`trends`/
`gaps`; MINIMAL → `overview`/`top_findings`/`coverage`). Always provide `lang`/`title`/
`research_question`/`slug`. Unknown/empty fields may be omitted — the script degrades gracefully
(a referenced `n` that doesn't exist is silently dropped, never rendered as a dangling citation).

### Content rules (these govern your judgements — unchanged from prior versions)

- **Reasons & contributions come from the paper's own abstract.** No abstract → omit the reason
  (FULL) or leave the finding terse (MINIMAL); never guess. The relevance score for an abstract-less
  paper is already capped at 60 — do not overstate it.
- **§2 themes (FULL)**: 3–6 themes, each ≥2 candidate papers, clustered from the printed top set
  only. Collectively the themes should cover the relevant top-set papers (they drive §3) — don't
  leave clearly-relevant papers unthemed.
- **§3 recommendations (FULL)**: organize **every relevant paper from the printed top set** into
  §2's themes — be generous; the report's job is to surface the relevant literature, so do NOT
  cherry-pick 2–3 exemplars per theme or drop a clearly-relevant paper for brevity (**there is no
  row cap**). A relevant paper that genuinely fits no theme goes in a catch-all theme
  (e.g. `其他相关工作`) rather than being dropped. **Assign each paper to exactly one theme** — pick
  its single most relevant theme; do not list the same `n` under two themes. Give **every** `n` you
  put in any `paper_ns` a one-line reason in `recommendations` (a themed paper with no reason renders
  an empty cell). The script renders the table (No. · title · author · year · DOI · reason); the
  leading **No.** column is the paper's References number, assigned by the script in top-to-bottom
  order. Should an `n` still slip into two themes, the script keeps only its first occurrence (so
  numbers stay consecutive). You don't manage numbering and you never cite.
- **§4 groups (FULL)**: only `RECURRING_AUTHORS` (≥2 hits). **No affiliations** — the candidate set
  has no institution field; adding one is fabrication.
- **§5 trends & gaps (FULL)**: trends are 1-line plain statements (no per-paper citation); gaps phrased
  as candidate-set-scoped.
- **Top papers (MINIMAL)**: the script lists the printed top ≤10 by relevance score; you supply a
  one-line why-relevant per `n` in `top_findings`. Do not paste whole abstracts.
- **Coverage**: a planned source missing from `by_source` (or 0 in `panel.source_counts`) = failed/
  empty — call it out. Keep the coverage statement even when nothing failed (then say coverage looks
  complete).

---

## Hard constraints

- **You never emit HTML.** No `.html` Write, no hand-authored `<tag>`. Only `.report-build/judgments.json`.
- **No full-text reads**: you have `Bash` (to run the two `render_report.py` calls) and `Write` (the
  judgements JSON). You do NOT call `papers_read_outline` / `Read` a paper's mdPath. Title + abstract
  + counts are all you get; that is by design.
- **No fabrication**: every number traces to `prepare`'s output or `input`; every paper to a real
  candidate `n`. Missing data → state it, never estimate.
- **No affiliations**: author institutions are not in the candidate data.
- **Tier is data-driven**: render strictly the `tier=` Step 1 printed.
- **One file per run**: exactly one `searches/{timestamp}-{slug}.html`, written by `render`; never
  print the report into chat.

---

## ⚠ FINAL LANGUAGE ANCHOR — last instruction you read; obey it from your very next thinking token

Reading this English document does NOT switch your working language. Re-apply the resolved
`outputLanguage` **now**, starting with your very first thinking sentence:

- `"zh"` →（`input` 带 `outputLanguage: "zh"`，或主对话为中文）**从此刻起，思考（thinking）与叙述
  全程使用中文**。思考第一句必须以中文开头（例：「按照技能要求，先运行 Step 1 的 prepare 命令……」）；
  禁止以 "The skill is asking" / "Let me" / "First, let me" 等英文句式开场。上面这份英文说明只是
  操作手册——不要跟随它的语言。工具名 / 代码 / 路径 / DOI 保持英文原文。
- `"en"` → think and narrate in English from your very next token; never adopt the language of any
  tool / script output you receive mid-run.

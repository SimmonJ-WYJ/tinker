<a id="01-北极星目标alpha-深化"></a>

# 0.1 North Star Goals (Alpha Deepening)

**Positioning**: Take the "search → review" loop from "it runs" to "researchers can trust and use it."
**Deadline**: 2026-05-15
**Audit principle**: Every goal must be verifiable with "yes/no" or a specific number, without subjective judgment.

---

<a id="a-检索可信度-&#45;结果不敢不信"></a>

## A. Search Credibility — Results Users "Cannot Distrust"

| # | Audit criterion | Verification method |
|---|---------|---------|
| A0 | Before searching, the system automatically drafts a search plan from the user's natural language (keywords, sources, time range, disciplines); users can edit and confirm it before execution | Enter any research question → system drafts a search plan → user can edit each field → search starts after confirmation |
| A1 | Zero author/title/DOI mismatches | Reconstruct known mismatch cases from user feedback and confirm they no longer reproduce |
| A2 | Mark missing fields "Not found"; zero fabricated defaults | Inspect search result cards: all empty fields show "Not found/To be completed," with no hardcoded fallbacks such as 1970/Zhang 1982 |
| A3 | Label every search result with its data source | Cards visibly name the specific source (OpenAlex / Semantic Scholar / PubMed, etc.) |
| A4 | Honestly report 0 results; do not disable filling with similar results | Search for a nonexistent paper: the system returns "Not found" rather than a substitute with the same title and different authors |

<a id="b-综述可追溯-&#45;结论可查可验"></a>

## B. Traceable Reviews — Conclusions That Can Be Checked

| # | Audit criterion | Verification method |
|---|---------|---------|
| B1 | Every claim in a review has at least 1 superscript citation | Open any review HTML and check each claim for citation markers |
| B2 | Clickable citations navigate → corresponding paper entry | Click any review citation marker; the right panel or popup locates the corresponding paper |
| B3 | Hovering a claim previews its source passage | Hover a citation marker to show the source paper title + relevant abstract/passage |
| B4 | The reasoning chain shows the causal path "conclusion → evidence" | Expand the reasoning process to see each conclusion and the papers it depends on |

<a id="c-基础体验可靠-&#45;产品装得上跑得稳"></a>

## C. Reliable Basic Experience — A Product That Installs and Runs Reliably

| # | Audit criterion | Verification method |
|---|---------|---------|
| C1 | Windows requires no manual Python/Node.js/Git installation | Fresh Win10/Win11 install → launch, without "Please install XXX first" prompts |
| C2 | First Mac installation → main interface ≤ 1 minute | Verify with a timer |
| C3 | Search + review work without a literature library | Without connecting Zotero or creating a library, search keywords directly → generate a review |
| C4 | Conversation continues after session rollback without losing the session ID | Roll back to node N → send a new message → no error |
| C5 | Multilingual support, English by default | Switching languages applies throughout the UI and persists after restart |

<a id="d-透明度-&#45;过程看得见可干预"></a>

## D. Transparency — A Visible Process Users Can Intervene In

| # | Audit criterion | Verification method |
|---|---------|---------|
| D1 | Ambiguous terms automatically trigger time/discipline clarification | Enter "latest advances" → system asks "Time range? Discipline?" |
| D2 | Chinese and English queries automatically route to corresponding sources | English queries primarily use English sources; Chinese queries primarily use Chinese sources |
| D3 | Search details show a statistical overview | The result list exposes total count, year distribution chart, source distribution, and relevance distribution |

---

<a id="审计关系"></a>

## Audit Relationships

- **C (basic experience)**: The entry threshold; nothing else matters if it cannot be installed.
- **A (search credibility)**: The foundation of trust; inaccurate data drives users away.
- **B (traceable reviews)**: The core distinction; without traceability, this becomes ordinary AI chat.
- **D (transparency)**: Amplifies the experience by making credibility visible.

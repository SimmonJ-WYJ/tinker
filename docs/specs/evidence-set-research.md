<a id="04-p2-需求探索科研场景证据集-&#45;笔记模型带引用"></a>

# 0.4 P2 Requirements Exploration: Research Evidence Set / Note Model (with Citations)

> **Nature**: Requirements exploration attachment for the 0.4 P2 redefinition “evidence set → research topic container,” addressing three open items in [ADR-007](../../adr/ADR-007-evidence-set-topic-container.md).
> **Source**: deep-research multisource fan-out + three-way adversarial verification (2026-06-01). 25 claims verified → 20 confirmed / 5 killed.
> **Related**: [0.4.0 PRD](./0.4.0-prd.md) Epic P2 · [CONTEXT.md evidence set and note domain](../../../CONTEXT.md)

---

<a id="执行摘要"></a>

## Executive Summary

Evidence from mainstream research note-taking (Zettelkasten) and PKM tools (Zotero/Obsidian/Logseq/Roam/Readwise) consistently supports three conclusions directly relevant to deciding on a “research topic container (1:N)”:

1. **Freeform notes should exist**: Zettelkasten treats permanent notes/Zettel as first-class objects that can exist without an anchored source (the method explicitly allows skipping fleeting/literature notes and writing Zettel directly), alongside evidence-anchored notes as two legitimate note forms.
2. **Notes and evidence should be co-members, not subordinate**: Literature reviews are structured around topics rather than individual sources. Notes cite/link sources (note cites source), rather than placing sources inside notes; they are peers.
3. **Multiple containers should use flat organization + tags/links + multiple membership, rather than rigid nested folders**: Luhmann rejected predefined topic classification in favor of bottom-up organization; links let a note belong to multiple contexts simultaneously (semilattice).

---

<a id="对-adr-007-三个待定项的明确建议"></a>

## Explicit Recommendations for ADR-007's Three Open Items

<a id="a-自由笔记是否应成立-应成立高置信"></a>

### (a) Should Freeform Notes Exist? → **Yes** (High Confidence)

Zettelkasten permanent notes/Zettel are self-contained, never discarded, and form the layer for developing arguments rather than collecting material. Ahrens explicitly allows skipping fleeting/literature notes and writing Zettel directly when thoughts are fully formed; permanent notes arising from one's own thinking need not originate in literature-note links.

**ASCI implementation refinement**: Freeform notes should be **durable first-class objects**, but **need not copy two orthodox Zettelkasten rules**: ① deleting/transcribing fleeting notes after use; ② mandatory network linking for permanent notes. Linking should be an optional best practice in ASCI, not a hard constraint.
Sources: [zettelkasten.de](https://zettelkasten.de/posts/concepts-sohnke-ahrens-explained/) · [scrintal/Ahrens](https://scrintal.com/guides/how-to-take-smart-notes) · [ctnet](https://www.ctnet.co.uk/how-to-create-a-zettelkasten-in-logseq/)

<a id="b-笔记-vs-证据从属还是并列-并列co-member高置信"></a>

### (b) Notes vs. Evidence: Subordinate or Peers? → **Co-Members** (High Confidence)

Notes identify sources by linking to reference notes (note→source is a **citation relationship**, one entity citing another), not containment (notes nested under sources). Reviews aggregate multiple sources by topic; a topic container exceeds one paper.

**ASCI implementation**: **Notes and evidence are peer members** of topic containers, associated through citations/links rather than evidence nested under notes.
Sources: [wilde-at-heart](https://wilde-at-heart.garden/pages/how-i-use-the-logseq-readwise-plugin-in-my-zettelkasten/) · [GMU Writing Center](https://writingcenter.gmu.edu/writing-resources/research-based-writing/organizing-literature-reviews-the-basics) · [atlasworkspace](https://www.atlasworkspace.ai/blog/pkm-apps-for-researchers)

<a id="c-多容器组织方式-扁平-&#45;标签双向链接-&#45;多归属高置信"></a>

### (c) How Should Multiple Containers Be Organized? → **Flat + Tags/Bidirectional Links + Multiple Membership** (High Confidence)

Luhmann: "It is not important where you place a new note as long as you can link to it" and "we decide against the order and categorization by topics and subtopics"; a semilattice allows "a single note can be referenced from multiple Structure Notes". Logseq's absence of folders and use of tags to distinguish note types support this.

**ASCI implementation**: Model research topics as emergent containers, organized flat with tags/links; **avoid rigid nested folders**.
Sources: [sloww/Luhmann](https://www.sloww.co/zettelkasten/) · [zettelkasten.de](https://zettelkasten.de/posts/concepts-sohnke-ahrens-explained/)

---

<a id="️-关键待决1n-vs-mn多归属"></a>

## ⚠️ Key Pending Decision: 1:N vs. M:N (Multiple Membership)

Research evidence **strongly supports multiple membership (M:N)**: a note/evidence item may belong to multiple topic containers (Luhmann semilattice / references from multiple Structure Notes / Logseq Linked References). P2 currently specifies strict **1:N**.

**PM confirmation needed**: Is this an intentional reduction to 1:N or pending expansion to M:N? M:N better fits research intuition but increases data model and UI complexity.

---

<a id="caveats证据强度与时效"></a>

## Caveats (Evidence Strength and Timeliness)

- Core methodological claims trace to Ahrens's *How to Take Smart Notes* (2017) and Luhmann's original 1981 text, cross-validated by zettelkasten.de and multiple university writing centers; stable over time, high confidence.
- Some individual citations come from blogs/SaaS articles (scrintal/atlasworkspace/medium), weaker alone but all corroborated through three-way checks against more authoritative sources.
- Treating notes and evidence as peers is **design inspiration** that **maps** Zettelkasten's note-cites-source mechanism to ASCI's data model, not an externally imposed requirement for ASCI.
- Rejected popular claims (5 killed): ① the absolute version of “reviews are purely thematic rather than single-source” (chronological/methodological organization is also valid, but all group at a higher level); ② the flat formulation “four types including reference notes”; ③ “fleeting notes have no independent value” (their retention and comprehension value is valid).

---

<a id="其他-open-questions供-p2-设计细化"></a>

## Other Open Questions (for P2 Design Refinement)

1. **1:N vs. M:N multiple membership** (above; highest priority, requires PM decision).
2. Does Ahrens's “project note” (outside Zettelkasten, discardable after project completion) correspond to an ASCI writing/review workspace independent of topic containers? How should freeform notes and project layers divide responsibilities?
3. Citation granularity: Are **block-level** citations needed (paragraph/highlight-level, as in Roam/Logseq), or are document/note-level citations sufficient for the annotation→interpretation→review chain? This affects annotation data structures.
4. Should optional **lightweight hierarchy** (Logseq namespace-style page naming conventions) provide a gradual onboarding path for users accustomed to folders, while storage remains flat with multiple membership?

---

<a id="参考来源19-源按角度"></a>

## References (19 Sources, by Perspective)

- **Competitor models**: [Obsidian forum folders-vs-tags](https://forum.obsidian.md/t/folders-vs-linking-vs-tags-the-definitive-guide-extremely-short-read-this/78468) · [Bob Doto permanent note](https://writing.bobdoto.computer/what-is-a-permanent-note-correcting-some-common-misunderstandings/) · [atlasworkspace PKM](https://www.atlasworkspace.ai/blog/pkm-apps-for-researchers)
- **Block citations/subordination**: [wilde-at-heart Logseq+Readwise](https://wilde-at-heart.garden/pages/how-i-use-the-logseq-readwise-plugin-in-my-zettelkasten/) · [ctnet Logseq Zettelkasten](https://www.ctnet.co.uk/how-to-create-a-zettelkasten-in-logseq/)
- **Freeform note positioning**: [zettelkasten.de Ahrens](https://zettelkasten.de/posts/concepts-sohnke-ahrens-explained/) · [scrintal](https://scrintal.com/guides/how-to-take-smart-notes)
- **Topic aggregation workflow**: [sloww Zettelkasten](https://www.sloww.co/zettelkasten/) · [GMU Writing Center](https://writingcenter.gmu.edu/writing-resources/research-based-writing/organizing-literature-reviews-the-basics)
- **Counterexamples/pitfalls**: [karl-voit avoiding complex folders](https://karl-voit.at/2020/01/25/avoid-complex-folder-hierarchies/) · [zettelkasten.de backlinks-are-bad](https://zettelkasten.de/posts/backlinks-are-bad-links/) · [nayuki tags-not-hierarchies](https://www.nayuki.io/page/designing-better-file-organization-around-tags-not-hierarchies)

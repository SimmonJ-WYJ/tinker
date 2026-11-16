<a id="asci-护城河多视角分析"></a>

# ASCI Moat Analysis from Multiple Perspectives

**Discussion initiator**: Yannik (PM)
**Participants**: Eagle Nick (market research), Cat Nick (user analysis), Fox Nick (product design), Tiger Nick (strategy integration)
**Date**: 2026-04-28
**Core question**: In an AI era where tool products are easily copied through vibe-coding, what is ASCI's real moat?

---

<a id="一鹰尼克竞争格局-&#45;护城河评估"></a>

# I. Eagle Nick: Competitive Landscape & Moat Assessment

<a id="11-前提验证工具型产品确实没有护城河"></a>

## 1.1 Validating the Premise: Tool Products Indeed Have No Moat

This judgment is correct. Apply our own **Wrapper vs Native test**:

> If 80% of a product's core value can be reproduced with “ChatGPT + custom Prompt,” it is a Wrapper.

Most current “AI research tools” are Wrappers: LLM API shells providing literature search + summaries. Elicit, Consensus, Scite, Perplexity Deep Research differentiate through UI and prompt engineering. These can indeed be reproduced through vibe-coding.

<a id="12-asci-当前的护城河位置"></a>

## 1.2 ASCI's Current Moat Position

Against our **four AI moat mechanisms** framework:

| Moat | ASCI today | Potential | Explanation |
|--------|----------|------|------|
| **Data flywheel** | ❌ None | 🟡 Medium | Local-first architecture; no user-data feedback yet |
| **Workflow embedding** | 🟡 Emerging | 🟢 High | Search→review→object creation forms a coherent workflow |
| **Distribution** | ❌ None | 🟡 Medium | Desktop app + future Web; channels still to build |
| **Brand trust** | ❌ None | 🟢 High | “Traceable evidence chains” are central to trust |

**Key finding**: workflow embedding + brand trust are ASCI's most feasible dual moat. Data flywheel and distribution come later.

<a id="13-竞品护城河对比"></a>

## 1.3 Competitor Moat Comparison

| Product | Moat type | Defensibility | What ASCI can learn |
|------|-----------|--------|---------------|
| Notion | Workflow embedding + data | Extremely strong | Accumulated user data creates switching costs |
| Obsidian | Local data + plugin ecosystem | Strong | Local files use standard formats; users “own” data |
| Zotero | Format standards + community | Moderately strong | CSL/BibTeX became the lingua franca of reference management |
| Semantic Scholar | Data flywheel | Strong | Paper-graph data forms a barrier |
| Elicit | Brand trust | Medium | First-mover trust in “AI literature search” |

**Eagle Nick's judgment**: ASCI should benchmark **Obsidian + Zotero combined**, rather than search tools Elicit/Consensus, building a moat through local data ownership + extensible object formats + community standards. Tool features can be copied, but **users' accumulated research data + data-format standards** are hard to copy.

---

<a id="二猫尼克用户粘性-&#45;切换成本分析"></a>

# II. Cat Nick: Retention & Switching Costs

<a id="21-工具型产品的切换成本为什么低"></a>

## 2.1 Why Tool Products Have Low Switching Costs

Using the **AARRR retention analysis** framework:

Traditional AI-tool retention chain:
```
Sign in → enter question → receive answer → leave
```

The only sticky point is answer quality. Once competitors catch up, switching costs are zero: another website/App is one click away.

<a id="22-asci-可以构建的切换成本层级"></a>

## 2.2 Switching-Cost Levels ASCI Can Build

From **behavioral cohort analysis**, switching costs rise as users complete these actions:

| Level | User behavior | Switching cost | Build difficulty |
|------|---------|---------|---------|
| L0 | Search + read reviews only | Zero | — |
| L1 | Trace citations in reviews | Low (search again in another tool) | Low |
| L2 | Write multiple Notes on papers | Medium (Notes lost when switching) | Medium |
| L3 | Build EvidenceSet + Hypothesis links | High (knowledge structure hard to migrate) | Medium-high |
| L4 | Accumulate many CitationRelations (paper relationship graph) | Extremely high (personal knowledge graph) | High |
| L5 | Agent works from personal object library | Extremely high (Agent does not understand you in the new tool) | High |

**Core insight**: ASCI's retention comes from **personal research knowledge assets accumulated through its object model**, rather than features themselves. This is classic “data gravity”: heavier data is harder to migrate.

<a id="23-用-sean-ellis-测试反推"></a>

## 2.3 Working Backward from the Sean Ellis Test

“How disappointed would you be if you could no longer use ASCI?”

- Search-only users → not very disappointed (alternatives exist)
- Users with 50+ Notes and 10+ EvidenceSets → very disappointed (cannot take their knowledge along)
- Users whose Agent understands their research context → extremely disappointed (Agent context memory cannot migrate)

**Conclusion**: PMF signals should track **user data depth**, not just DAU: how many users reach L3+. The “very disappointed” share among L3+ users is the real PMF metric.

<a id="24-冷启动的诚实评估"></a>

## 2.4 Honest Cold-Start Assessment

`[推断]` (inference) ASCI has a **cold-start valley**: new users initially see only search + reviews (L0), with zero switching cost. They cross the retention threshold only through “first Note → first EvidenceSet → first Agent object operation.”

**Suggested North Star metric**: “share of users reaching L3 data depth,” rather than monthly active users.

---

<a id="三狐尼克产品差异化-&#45;不可复制性"></a>

# III. Fox Nick: Product Differentiation & Resistance to Copying

<a id="31-什么可以被-vibe-coding-复制"></a>

## 3.1 What Can Vibe-Coding Copy?

```
ChatGPT + “Build me a paper-search tool with keyword search and review generation”
→ A prototype in one weekend
```

Copyable layers:
- UI interactions (sidebars, cards, search boxes)
- LLM calls (prompt engineering)
- Basic search flows (call API → display results)

<a id="32-什么不能"></a>

## 3.2 What Cannot Be Copied?

<a id="不可复制层一对象模型即数据协议"></a>

### Layer One: Object Model as Data Protocol

6 objects + 3 protocols are a **design-decision problem**, not a coding problem. Vibe-coding can generate CRUD but not the protocol design “append, never overwrite + reference, never copy + query, never traverse.”

Anyone can write JSON, but **JSON Schema** and the **GraphQL spec** require careful design. If ASCI's object model becomes an open research standard (like BibTeX for references), it rises from product feature to **infrastructure protocol**.

<a id="不可复制层二证据链的完整性担保"></a>

### Layer Two: Guaranteed Evidence-Chain Integrity

“This conclusion traces to this paragraph of this paper” is a **product architecture guarantee**, not an AI capability.

Why vibe-coding cannot achieve this:
- Requires 0.1 trusted retrieval (A0-A4 audit criteria) as the data-quality foundation
- Requires the 0.2 object model as the reference carrier
- Requires the review-generation reasoning chain (B4) as the causal path
- Lose any of the three links and the citation chain breaks

<a id="不可复制层三agent-对用户个人对象库的上下文理解"></a>

### Layer Three: Agent Contextual Understanding of Personal Object Libraries

The Agent **operates your personal Paper, Note, EvidenceSet, and Hypothesis objects**, rather than merely answering through an LLM API. This requires:

- Understanding your research context (through the CitationRelation graph)
- Knowing which Hypotheses have new evidence awaiting review (V8)
- Finding relevant annotations in your Note history

This deeply couples Agent + personal knowledge base, beyond API-call differences.

<a id="33-狐尼克的产品差异化建议"></a>

## 3.3 Fox Nick's Differentiation Suggestions

| Differentiation | Concrete action | Resistance to copying |
|---------|---------|-----------|
| **Open object formats** | Open-source Paper/EvidenceRef/Hypothesis JSON Schemas | Become a standard competitors must support |
| **Evidence-chain visualization** | Trace graph Hypothesis → EvidenceSet → EvidenceRef → Paper | UI can be copied, chain integrity cannot |
| **Local data ownership** | Local files, standard formats, portable | Counter cloud lock-in with local freedom |
| **Agent research objects** | ASCI objects are the Agent's operating unit, rather than plain-text chat | Tools can be copied, understanding of your objects cannot |

---

<a id="四虎尼克战略整合-&#45;行动建议"></a>

# IV. Tiger Nick: Strategy Integration & Actions

<a id="41-护城河三层模型"></a>

## 4.1 Three-Layer Moat Model

Combining the three analyses gives three layers:

```
Layer 3: Brand trust (long term,0.3+)
├── Traceable evidence chains build a research-integrity brand
├── Open object formats build community trust
└── GDPR + local data ownership build user trust

Layer 2: Workflow embedding (medium term, starts0.2)
├── Complete search→review→objects→hypothesis-tracking loop
├── Agent deeply understands personal object-library context
└── Data gravity: accumulated user research assets

Layer 1: Functional tools (short term,0.1 complete)
├── Trusted retrieval + reviews
├── Paper management + Zotero integration
└── Basic UI interactions
```

**Key insight**: Layer 1 is admission, not a moat; vibe-coding can copy it. ASCI must build Layer 2 in 0.2/0.3 and Layer 3 in later versions.

<a id="42-最具战略价值的护城河排序"></a>

## 4.2 Ranking the Most Strategic Moats

Ranked by **defensibility × construction speed**:

| Rank | Moat | Defensibility | Build speed | Starting version |
|------|--------|--------|---------|---------|
| **🥇** | **Accumulated personal research assets** | Extremely high | Slow (requires usage) | 0.2 |
| **🥈** | **Object model becomes an open standard** | Extremely high | Medium | 0.2 (open formats) |
| **🥉** | **Agent contextual understanding of personal object library** | High | Medium | 0.2/0.3 |
| 4 | Complete evidence-chain traceability | Medium-high | Medium | 0.1/0.2 |
| 5 | Local data ownership vs cloud lock-in | Medium | Fast | Already in 0.1 |
| 6 | Brand trust (research integrity) | Medium-high | Extremely slow | Long term |

<a id="43-战略建议"></a>

## 4.3 Strategic Suggestions

<a id="-p0-行动将-asci-对象格式设计为开放标准"></a>

### 🥇 P0 Action: Design ASCI Object Formats as an Open Standard

This is a **strategic positioning recommendation**, beyond engineering implementation.

- Publish JSON Schemas for all 6 objects as independent documentation (open protocol)
- Design for extensibility (third parties can define their own object types)
- Follow the ecosystem position of BibTeX/Zotero CSL: standards rather than features

Success makes ASCI “a standardized protocol for research data in the AI era,” beyond another AI research tool. Competitors either support it (joining the ecosystem) or do not (users favor ASCI for portability).

<a id="-p1-行动设计从-l0-&#45;l3-的激活路径"></a>

### 🥈 P1 Action: Design L0 → L3 Activation

Cat Nick's cold-start valley is a real risk. In 0.2 validation apps, make these a **guided activation path**:

1. First search + review (L0, inherited from 0.1)
2. Click review citation → Paper detail (L1, evidence-chain viewer)
3. Write first Note on a Paper (L2, notes panel)
4. Group papers into an EvidenceSet (L3, hypothesis tracker)

Each step needs clear UI guidance and an aha moment. Users remaining at L0 see ASCI as a replaceable search tool.

<a id="-p2-行动在-03-中强化数据所有权的叙事"></a>

### 🥉 P2 Action: Strengthen Data-Ownership Messaging in 0.3

Local storage + open formats = “your data always belongs to you.” This is rare differentiation in AI: most products lock users into cloud storage. ASCI takes the opposite approach, building trust through portability.

In 0.3 Privacy Policy and product copy, translate data ownership from technical fact into a user-perceived value proposition.

<a id="44-一个诚实的提醒"></a>

## 4.4 An Honest Reminder

`[推断]` (inference) These moats have high theoretical value, but ASCI faces a **time-window paradox**:

- Moats take time (user assets, object-standard adoption, brand trust)
- AI-tool competition accelerates (competitors iterate faster too)
- ASCI remains a small team (4 people)

Thus **the strategy's validity depends on execution speed**. The 0.2/0.3 cadence (~5.5 weeks) is reasonable, but the window shrinks if competitors start object capabilities.

**Eagle Nick suggests**: continuously monitor Elicit, Semantic Scholar, and Consensus, especially user notes, evidence links, and hypothesis tracking. Currently `[未搜索，待验证]` (not searched, awaiting verification), their roadmaps remain uncertain.

---

<a id="五共识总结"></a>

# V. Consensus

| Role | One-sentence judgment |
|------|-----------|
| 🦅 Eagle Nick | Benchmark Obsidian+Zotero rather than AI search tools; the moat lies in format standards and user assets |
| 🐱 Cat Nick | Retention is data depth; the North Star should be L3+ user share rather than DAU |
| 🦊 Fox Nick | Vibe-coding copies UI/prompts, not protocol design, evidence integrity, or Agent understanding of personal objects |
| 🐯 Tiger Nick | Three layers: Layer 1 admission, Layer 2 defense, Layer 3 brand. Build Layer 2 in 0.2/0.3 |

**ASCI's real moat = accumulated personal research assets × open object standards × local data ownership × Agent contextual understanding**

Multiplied together, these cannot be reproduced by a weekend vibe-coding project.

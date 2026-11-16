<a id="04-设计输入默认页改造中心对话框-&#45;总控-agent"></a>

# 0.4 design input: default-page redesign (central chat input + Orchestrator Agent)

> **Source**: Extracted from [0.3 north-star.md §3-D](../../0.3/north-star.md#section-3-d) by the 2026-05-12 decision and retained as 0.4 design input. The 0.3.0 public release preserves the existing 0.1 / 0.2 entry paradigm and **delivers none** of these items.
> **Status**: Design reserve, awaiting formal inclusion in the 0.4 north-star by the product/engineering Lead when the milestone starts.
> **Do not treat this document as 0.3 scope**: No items here belong to 0.3 audits, schedule risks, or deliverables.

---

<a id="一背景为何把默认页改造从-03-抽出到-04"></a>

## 1. Background: why move the default-page redesign from 0.3 to 0.4

| Decision item | Original 0.3 plan | After decision | Reason |
|--------|----------|--------|------|
| All of §3-D | Required for 0.3.0 | Entirely deferred to 0.4 | Tight 2-week window; redesign adds Orchestrator routing / natural-language intent recognition / shortcut cards, overloading the window alongside accounts / servers / capability-pack integration |
| Main user path | Central chat input + Orchestrator automatically routes to packs | Preserve existing 0.1 / 0.2 entry paradigm | In public 0.3.0, users start scenario tasks from installed packs (left “Configuration” page → capability-pack section) or existing shortcuts |

> **Product risk identified**: Deferring the default-page redesign makes the “configuration-driven to capability-pack-driven” value narrative almost invisible on the main user path at public 0.3.0 launch; ASCI still opens with the old 0.1/0.2 entry points. **Reviewed with and accepted by the product/engineering Lead** (2026-05-12 decision recorded in 0.3 §10), because capability packs remain visible in the left “Configuration” page in 0.3.0 and 0.4 starts shortly after public 0.3.0 release (no large gap).

---

<a id="二新页面结构04-设计输入"></a>

## 2. New page structure (0.4 design input)

- Screen center: Single chat input (Orchestrator receives user intent)
- Below input: Scenario shortcut cards (1:1 with installed packs, e.g. “Start a literature search,” “Write a review,” “Import Zotero papers”)
- Above input: Optional recent sessions for quick return
- Remove the prerequisite of selecting a model / Skill first

---

<a id="三总控-agent-行为04-设计输入"></a>

## 3. Orchestrator Agent behavior (0.4 design input)

- Receive natural-language intent → invoke 0.2 §3-4 Orchestrator → route to the corresponding pack's sub-Agent
- Unclear intent: Ask for clarification (do not select a pack directly)
- Pack not installed: Prompt “Install pack X” and provide one-click navigation to the 0.3 §3-C installation entry

---

<a id="四原-03-三-d-审计标准保留作为-04-候选审计项"></a>

## 4. Original 0.3 §3-D audit criteria (retained as 0.4 candidates)

| # | Audit criterion | Validation | Notes |
|---|---------|---------|------|
| DH1 | New-session default page matches §2 structure (central input + shortcuts below + recent sessions above) | UI walkthrough + archived screenshots | 0.4 candidate |
| DH2 | Start with natural language “Find me RAG reviews” (English translation); Orchestrator correctly routes to literature-search pack and completes search | Run 3 intents end-to-end (search / review / Zotero import), routing accuracy ≥95% | 0.4 candidate |
| DH3 | Shortcut count = installed pack count (including 2 launch packs: literature search / literature review); clicking directly starts the pack's scenario task | Uninstall literature review → its card disappears | 0.4 candidate |
| DH4 | Missing-pack intent triggers guidance: User says “Write me a review” (English translation) without literature-review pack; Orchestrator prompts installation and navigates to left “Configuration” page → capability-pack section | Uninstall literature review and verify the above instruction | 0.4 candidate |

---

<a id="五不做推迟到-v1"></a>

## 5. Exclusions (deferred to V1)

- RAG / historical-session learning for intent recognition (0.4 input uses rules + short LLM routing)
- Orchestrator coordination across packs (2 launch packs do not invoke each other)
- Personalized shortcut ordering

---

<a id="六对-03-的影响已闭环"></a>

## 6. Impact on 0.3 (resolved)

- 0.3 §3-D shrinks to a pointer paragraph, keeping its placeholder to preserve numbering and pointing here
- 0.3 §10 “Deferred to 0.4” table retains §3-D (all DH1-DH4)
- 0.3 §9 “Relationship to 0.2” references none of §3-D
- 0.3 §7 activation path (AC1-AC3) does not depend on central input; L3 guidance triggers through Proposal decisions, independent of §3-D

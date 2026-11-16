<a id="adr-008总控-agent-从单路由升级为supervisor-自主编排多包"></a>

# ADR-008: Upgrade the Coordinator Agent from Single Routing to Supervisor-Led Autonomous Multi-Pack Orchestration

| Field | Content |
|------|------|
| **Status** | Proposed (grill-with-docs session decision 2026-06-01, awaiting product/engineering Lead signature) |
| **Decision date** | 2026-06-01 |
| **Decision maker** | (to be filled; product/engineering Lead recommended) |
| **Hard decision deadline** | Before opening the implementation issue for 0.4 P3 “Supervisor orchestration / default page” |
| **Related** | 0.4 P3 (default page + coordinator Agent) · P4 (self-evolution → personalized orchestration) · [0.4 design-input default-page.md](../milestones/0.4/design-inputs/default-page.md) · [CONTEXT.md Agent orchestration domain](../../CONTEXT.md) · 0.2 §0 Agent-led philosophy |

---

<a id="一背景"></a>

## I. Background

`0.4/design-inputs/default-page.md` (2026-05-12, when there were 2 capability packs) defines the coordinator Agent as “receive intent → Orchestrator → **route to the corresponding capability-pack subagent**,” with §V explicitly deferring multi-pack coordinator orchestration to V1 (“the 2 launch packs do not call each other”).

0.4 P1 expands capability packs from 2 to 4 (search / review / writing / data analysis), while **search→review→writing naturally forms a research workflow chain**. The no-cross-calling decision for 2 packs no longer fits 4: high-level user goals (“search RAG and write a review for me”) naturally span multiple packs.

ASCI already has supervisor→teammate dispatch ([CONTEXT.md Teammate](../../CONTEXT.md): the main Agent dispatches scenario subagents through Task/Agent tools).

<a id="二决策维度"></a>

## II. Decision Dimension

The coordinator Agent's **capability level**: route to a single pack or autonomously orchestrate multiple packs? Who drives orchestration: users hand-authoring workflows or the Agent autonomously?

<a id="三候选方案"></a>

## III. Options

| | Single routing (current design-input) | Lightweight chaining | Autonomous Supervisor orchestration (**selected**) |
|---|---|---|---|
| Behavior | Recognize intent → enter one pack | One-click “send artifact to next pack” chaining | Coordinator clarifies requirements, then independently chooses packs and sequence |
| Cross-pack workflow | ❌ Users switch manually; chain breaks | Semiautomatic, users confirm each step | ✅ Agent closes the loop autonomously |
| Orchestration driver | — | User, manually | **Agent, autonomously** (not hand-authored user workflows or predefined flows) |
| Agent-led philosophy | Weak | Medium | ✅ Fully delivers 0.2 §0 |
| Engineering effort | Low | Medium | High |

<a id="四决策"></a>

## IV. Decision

**Adopt autonomous Supervisor multi-pack orchestration.**

- Users give high-level requirements in the central conversation → **Supervisor first clarifies requirements** (align intent) → **autonomously orchestrates** capability-pack teammates (scenario subagents) to collaborate; Supervisor chooses whom to dispatch and in what order, **without user-authored workflows or predefined flows**.
- **User control point = requirements clarification**; conversation streams (execution-step groups + teammate badges) make execution transparent; final artifacts are reviewable.
- Default page: central conversation (Supervisor entry for complex / cross-pack / ambiguous intent) + shortcut cards (1:1 with capability packs, direct single-pack entry for clear tasks).

<a id="五反转"></a>

## V. Reversal

Reverses `default-page.md` §V “2 launch packs do not call each other + multi-pack orchestration deferred to V1” and §III's single-routing “route to corresponding capability pack” position. The `CONTEXT.md` Agent orchestration domain records this reversal as flagged ambiguity (coordinator capability level).

<a id="六后果"></a>

## VI. Consequences

- **Critical prerequisite infrastructure**: build a **cross-pack collaboration contract**. Each pack declares a capability description (for Supervisor dispatch decisions) + inputs/outputs (to transfer artifacts between teammates). This delivers the higher-level use of the object JSON Schema / A2A data exchange layer reserved since 0.2. **This is P3's substantial work, rather than the default-page UI**.
- Upgrade the coordinator Agent and design requirements clarification.
- Align with **P4**: 5 types of implicit self-evolution signals → personalized Supervisor orchestration (increasingly understands which packs / models suit the user).
- **Open safety valve**: can users stop / correct Supervisor orchestration mid-execution (flagged in CONTEXT.md)?
- **Risk**: reliability of autonomous multi-step orchestration (accumulating errors, sensitive in high-precision research). **Mitigation = upfront clarification + transparent execution + final artifact review**, rather than mandatory node pauses, preserving the Agent-led philosophy.

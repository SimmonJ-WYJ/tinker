<a id="adr-006ui-框架库扩展边界右侧产物-renderer-可注册而非整体布局可注册"></a>

# ADR-006: UI Framework Library Extension Boundary: Registrable Right-Hand Artifact Renderers (Rather Than Whole Layouts)

| Field | Content |
|------|------|
| **Status** | Proposed (grill-with-docs session decision 2026-06-01, awaiting Product/Engineering Lead sign-off) |
| **Decision date** | 2026-06-01 |
| **Decision owner** | (TBD; Product/Engineering Lead suggested) |
| **Hard decision deadline** | Before opening the 0.4 P1 “UI Framework Library” implementation issue |
| **Related** | 0.4 P1 (new capability packs: writing / data analysis) · [0.3 north-star §III-C.5](../milestones/0.3/north-star.md) · [0.3.0 PRD §1 Capability Pack vs Skill](../specs/0.3.0/0.3.0-prd.md) · [CONTEXT.md Agent orchestration domain](../../CONTEXT.md) |

---

<a id="一背景"></a>

## I. Background

0.3 §III-C.5 postponed “multiple UI framework registration + switching” to 0.4+, using the wording “the main app includes only 1 UI framework; 0.4+ can extend to **multiple** UI frameworks.” 0.4 P1 adds capability packs with **different forms**, including a **writing pack** (right-hand rich-text/Markdown editor) and a **data analysis pack** (right-hand charts/tables), so a framework extension mechanism must be established first.

**Current code (2026-06-01 investigation)**: there is **no framework abstraction at all**. The manifest has a `uiFramework` field (enum only `'conversation-and-artifact'`), but the loader **never uses** it after reading and does not pass it to the renderer; the “left navigation + center conversation + right artifact” three-part layout in `AppShell.tsx` and dispatch for 5 TabKind variants in `RightPanelTabContent.tsx` are **entirely hardcoded**. Every new form requires manual changes in both places.

<a id="二决策维度"></a>

## II. Decision Dimension

Extension **granularity**: can capability packs register an “entire workspace layout,” or only “content renderers for the right-hand artifact panel”?

<a id="三候选方案"></a>

## III. Options

| | Boundary A: registrable right-hand artifact renderers (**selected**) | Boundary B: registrable whole layouts |
|---|---|---|
| Abstraction scope | Retain the “left navigation + center conversation + right artifact” skeleton; only right-hand artifact renderers register by capability pack | Capability packs can define entirely different workspace layouts, with conversation becoming secondary |
| Product form | Agent conversation **always leads**; new forms replace only the right side (writing→editor, data→charts) | Editor/notebook can lead, with conversation in a floating window/bottom bar |
| Differentiation | ✅ Preserve ASCI's “Agent-led” approach | ❌ Drift toward “traditional editor/notebook + AI assistance,” resembling Cursor/Notion AI |
| Consistency with default page P3 | ✅ Consistent with “conversation-centered + Supervisor orchestration” | ❌ Conflicts with conversation as the primary entry point |
| Engineering effort | Medium | High |

<a id="四决策"></a>

## IV. Decision

**Adopt boundary A: UI framework library = registrable right-hand artifact renderers within a single “conversation-led + right-hand artifact” framework.**

- Add a “right-hand artifact renderer type” declaration to the capability-pack contract; actually connect `manifest.uiFramework` / renderer selection logic (eliminating the current unused field).
- Writing and data analysis packs implement their artifact panels under the “right-hand renderer contract.”
- Defer the experiment-log pack to 0.5 (the third new form; 0.4 validates only 2).

<a id="五反转-&#45;收敛"></a>

## V. Revision / Narrowing

Narrow the 0.3 §III-C.5 wording “0.4+ can extend to **multiple** UI frameworks”: 0.4 implements “one framework + registrable right-hand artifact renderers,” not “multiple-layout framework registration.” Reevaluate “registrable whole layouts” (boundary B) for V1 if needed.

<a id="六后果"></a>

## VI. Consequences

- **Positive**: preserves Agent-led differentiation, controls cost, and provides a stable right-hand renderer registration point for later pack forms (such as experiment logs).
- **Negative / constrained**: limits capability-pack form flexibility; scenarios requiring a layout that is not conversation-led (such as a full-screen notebook) cannot be supported in 0.4.
- **Risk**: if future research scenarios strongly require whole layouts, a separate ADR must introduce boundary B, potentially requiring adaptation of existing pack renderer contracts.

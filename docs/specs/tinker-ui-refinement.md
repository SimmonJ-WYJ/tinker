<a id="tinker-界面比例与细节校准"></a>

# Tinker Interface Proportion and Detail Refinement

Status: implemented and validated, with final review fixes complete. Baseline: main 77d52dc, retaining the merged isometric Logo. References are the user-provided Tinker conversation screenshot and Perplexity homepage screenshot; no claim of obtaining Perplexity's internal design parameters.

<a id="设计判断"></a>

## Design Decisions

Retain existing information architecture, branding, business features, and English/Chinese copy. Use a quiet, precise desktop reading interface. Visual change 3/10, motion 2/10, density 4/10. Reuse React, Tailwind, Radix, and existing Lucide icons without new dependencies.

Current problems: workspace-home.css repeatedly overrides the same dimensions, the main panel has an overly heavy border and small radius, control heights and font sizes lack unified hierarchy, the tab bar has fixed width limits, and multiple image-generation metadata groups compete with body content.

<a id="测量约定与目标"></a>

## Measurement Conventions and Targets

Screenshot pixels do not directly equal CSS pixels. Browser validation uses fixed viewports and records DPR, zoom, and actual DOM dimensions. Reference screenshots inform proportions; the following are Tinker's implementation values.

| Element | CSS target |
| --- | --- |
| Sidebar | 256px; existing drawer below 1100px |
| Top bar | 52px; window buttons 28px; icons 16px |
| Main panel | 24px radius; right/bottom space 8px; no prominent border |
| Primary navigation | 36px row height; 14px/20px; icons 18px; icon/text gap 10px |
| Projects and recent sessions | 32px row height; 13px/20px; unified left text baseline |
| Reading and input surfaces | Maximum 680px, shrink with window, at least 20px each side |
| Home heading | 36px/44px, regular weight; 28px/36px in narrow windows |
| Home input | 20px radius; 10px soft outer background; editor 72px; bottom bar 40px |
| Conversation input | Same radius and toolbar dimensions; editor minimum 48px |
| Control icons | 16/18px, uniform 1.5 stroke; hit area at least 28px |
| Image results | Images first, compact summaries, native details expansion, retain billing and size notices |

Light mode uses a slightly cool window background, near-white reading panels, blue-gray body text, and subtle neutral separators. Dark mode has independently paired colors. Preserve focus rings, disabled states, keyboard operations, and reduced-motion.

<a id="实现计划"></a>

## Implementation Plan

- [x] 1. Define workbench color and geometry variables in tokens.css; update design.md values and principles.
- [x] 2. Consolidate workspace-home.css definitions and refine sidebar, top toolbar, main panel, homepage, and input, preserving existing project/drawer/code-mode behavior.
- [x] 3. Replace the tab bar's fixed 240px limit with a flexible container; compact individual tabs while preserving navigation.
- [x] 4. Add genuinely expandable image-card details; write behavioral tests before layout implementation, retaining save, edit, version comparison, and all existing notices.
- [x] 5. Check homepage, conversation, image results, narrow windows, sidebar collapse, light/dark themes, and long English/Chinese text in an isolated real React-component preview, recording actual dimensions.
- [x] 6. Run targeted tests, full typechecking, full tests, and renderer build; review diffs and deliver screenshots and a design guide.

<a id="范围"></a>

## Scope

Do not modify the user's current desktop instance/data directory, backend/channel/permission logic, README/CLAUDE, or Logo geometry; do not assume visual validation updates an installer.

<a id="验证记录"></a>

## Validation Record

- Actual React-component preview using mock sessions and brand icons without reading user data or calling models. The preview shell combines the production layout; screenshots are not from the installed Electron app.
- Before/after homepage/conversation screenshots use 1536×960 CSS px, DPR=1; narrow window 980×800. Actual DOM values are in [metrics.json](../ui-refinement-review/metrics.json).
- Sidebar 256px, top bar 52px, current tab 34px, main panel radius 24px, input surface 680px, home heading 36px/44px, editor 72px. In narrow windows the sidebar leaves content flow but keeps its toggle; input remains 680px without horizontal overflow. Desktop collapse measures sidebar width 0.
- Light-mode secondary text contrasts about 4.6:1 against the window background, higher on body panels; dark mode about 6.7:1. The Chinese “General Agent” label sizes naturally to content, with matching scrollWidth/clientWidth and no truncation.
- Expanded image details show original version, model, reference images, size, and billing information; collapse retains a clear entry point. Targeted review passed.
- `bun test`: 3168 pass, 0 fail. Shell tests 25 pass, image-related tests 25 pass. No installer rebuild.
- Before/after comparisons: [homepage](../ui-refinement-review/home-comparison.png), [image results](../ui-refinement-review/conversation-comparison.png); [dark Chinese](../ui-refinement-review/home-dark-zh.jpg), [narrow window](../ui-refinement-review/narrow.jpg).

- Final review fixed normal appearance overriding drag state. Real AgentView drives state through data-drag-over/data-disabled; the browser confirmed distinct normal/disabled/drag/focused-drag surfaces and persistent highlighting. Attachment/send hit areas measure 30×30px, mode button height 28px; see [controls.json](../ui-refinement-review/controls.json) and [state screenshot](../ui-refinement-review/composer-states.jpg).


<a id="2026-11-08用户手调侧栏同步"></a>

## 2026-11-08: Sync User-Adjusted Sidebar

- Status: implemented with actual Electron acceptance complete, ready for branch review.
- New baseline: main 2006607. Current sidebar/toolbar values follow this section and docs/design.md §10.4; earlier content is historical acceptance evidence.
- Sources: Figma 115:599 / 115:645, specification Guide 119:187.
- Sidebar 256px, horizontal margins 12px, inline spacing 6px. Navigation 36px, projects/Recent 30px, icon box 14px, icon/text gap 6px, text 14/22px. Top bar 56px, preserving macOS traffic-light safe space.
- Given a noncurrent project, When its inline plus is clicked, Then create exactly one draft in that project and switch sessions, retaining the project's expansion state.
- Given keyboard focus on Recent, When Enter / Space is pressed, Then open the session; internal actions and inputs no longer trigger row navigation.
- Given English/Chinese and light/dark themes, When views or window widths change, Then preserve sidebar hierarchy and keyboard reachability, using the existing drawer in narrow windows.
- Actual Electron measurements, screenshots, and independent review: [acceptance record](../qa/2026-11-08-sidebar/README.md).
- Submit only a branch for manual merge; do not replace the user's running app or mix in Rust migration/other business changes.

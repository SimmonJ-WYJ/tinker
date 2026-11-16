<a id="figma-侧栏同步验收-&#45;2026-11-08"></a>

# Figma Sidebar Synchronization Acceptance · 2026-11-08

- Target repository: SimmonJ-WYJ/tinker (private)
- Baseline: main 2006607
- Branch: fix/figma-sidebar-115-599
- Source: [Conversation frame 115:599](https://www.figma.com/design/qNZ4GSgKdkHK51a5x79VF8/Tinker?node-id=115-599), sidebar 115:645
- Specification: [Editable Figma Guide 119:187](https://www.figma.com/design/qNZ4GSgKdkHK51a5x79VF8/Tinker?node-id=119-187) and [docs/design.md §10.4](../../design.md#104-侧栏的文字几何与交互figma-1155992026-11-08)
- This delivery is branch source code; it does not establish an update to the installed application or main.

<a id="实际运行环境"></a>

## Actual Runtime Environment

Ran Electron 39 using main/preload built from this branch and a local Vite renderer. Native profile directories, Chromium user directories, and project/session data were independent temporary QA data; no user profiles were read and no model requests sent. Screenshots show the actual Electron application, rather than static HTML or assembled components. SQL native modules used the corresponding Electron ABI obtained through repository scripts.

<a id="测量"></a>

## Measurements

| Item | Figma target | Actual Electron |
| --- | --- | --- |
| Sidebar | 256px | 256px |
| Navigation start / row height | y=56 / 36px | y=56 / 36px |
| Project row | y=166 / 30px | y=166 / 30px |
| Recent heading / first row | y=304 / y=328 | y=304 / y=328 |
| Recent row / text | 30px / 14px, 22px line height | 30px / 14px, 22px line height |
| Icon box | 14px | 14px |
| Account row | 40px | 40px |
| Sidebar background | #ECEDEF | rgb(236,237,239) |

[Full DOM and interaction results](verification.json)

<a id="图像证据"></a>

## Image Evidence

- [Sidebar comparison: Figma left, actual Electron right](sidebar-comparison.png)
- [Actual Electron · light English](electron-light-en.png)
- [Actual Electron · dark English](electron-dark-en.png)
- [Actual Electron · dark Chinese](electron-dark-zh.png)
- [Actual Electron · 900px narrow-window drawer](electron-narrow.png)

The main content is simply the actual application's empty conversation state; this acceptance covers the sidebar. Figma uses custom project names; QA's fourth item displays the application's default project name. macOS windowed mode retains native traffic lights, so top controls begin at the 108px safe offset without overlapping system buttons. Folders remain real expand/collapse buttons; empty folder placeholders in the design were not converted into invisible application controls.

<a id="行为验收"></a>

## Behavioral Acceptance

- [x] Original Figma frame retained; Guide consists of new editable layers
- [x] All local SVGs are nonempty, load successfully, and retain intrinsic dimensions
- [x] Back icon mirrored externally; forward disabled state follows actual history
- [x] Dark project plus retains foreground/background distinction
- [x] English / Chinese primary navigation visible, with no raw keys
- [x] Recent focus reveals actions; Enter / Space opens conversations
- [x] Explicit Enter saves renaming immediately, without being swallowed by the 300ms accidental-blur guard
- [x] Long titles truncate without breaking sidebar width
- [x] Real search dialog opens and closes
- [x] Project folders expand/collapse independently
- [x] Sidebar collapse/expand works
- [x] No horizontal overflow at 900px and 560px narrow widths
- [x] Clicking plus in a noncurrent project adds only one draft with the correct workspaceId; drawer closes on success

<a id="机器检查与复审"></a>

## Automated Checks and Review

- Repository-wide typecheck passed
- New keyboard and project-plus behavior tests passed, covering workspace parameters, draft collections, repeated clicks, and input event boundaries
- docs/design.md ↔ tokens.css bidirectional parity passed
- Renderer build passed
- Independent reviewer reran the three relevant test files: 7 passed, 0 failed, 36 assertions
- Independent review passed with no remaining substantive issues. The initial drawer question was resolved through AppShell's state-change effect and actual runtime results
- Full bun test: 3285 passed, 4 skipped, 0 failed across 370 files. Server tests ran in an environment allowing local loopback listeners. Keyboard tests flush asynchronous updates through React async act without timed polling.

<a id="范围"></a>

## Scope

No changes to models, channels, login, permissions, data contracts, Logo, or blue-ball animation; no main merge or installer release. The original MD Guide was synchronized to the user-specified diagnostics path; repository specifications are saved with this branch.

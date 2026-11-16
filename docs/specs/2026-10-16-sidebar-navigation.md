<a id="工作台侧栏与页面导航"></a>

# Workbench Sidebar and Page Navigation

- The desktop sidebar has a fixed width of 248px and does not scale proportionally with screen width; the persistent top toolbar is 52px high.
- The top toolbar provides a sidebar toggle and page back/forward buttons; each button is disabled when its history is empty.
- Above 1100px wide, the sidebar occupies layout space and collapses to zero width.
- At widths of 1100px or less, use an overlay drawer; the backdrop, Esc, and close button all dismiss it, returning focus to the toggle.
- Clicking a session, project, or navigation entry in the drawer closes it; expanding the project tree does not.
- Page history includes session and project views; restoring a session reuses its original session and generation task without resending messages. A new branch clears forward history; deleted projects or sessions are skipped.
- Preserve Research / Coding modes, project selection, ripple transitions, and the logic for returning to the reading position during generation.

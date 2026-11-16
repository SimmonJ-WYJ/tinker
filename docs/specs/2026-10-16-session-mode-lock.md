<a id="会话模式与窗口导航"></a>

# Session Mode and Window Navigation

User confirmation: choose Research / Coding before the first send; after the first send, the mode is fixed, reused for subsequent requests, and retained when reopened. The locked state shows only the current mode label. Old sessions without a recorded mode retain the current mode (Research by default), without inferring it from message content.

Window navigation: native macOS windows reserve 108px for traffic lights outside fullscreen; fullscreen and other platforms use 16px. The sidebar toggle and back/forward navigation remain visible. Tabs align with the main panel's left edge; remove the duplicate session title inside the panel. Move TabBar to the toolbar while retaining menus and session activation side effects.

Verification: five mode selection/locking tests, navigation back/forward tests, main process and preload builds; read actual Electron fullscreen state and capture screenshots.

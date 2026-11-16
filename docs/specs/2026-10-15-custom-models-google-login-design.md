<a id="自定义中转站与-google-登录"></a>

# Custom Relay Providers and Google Sign-In

The user approved this approach. The goal is configurable third-party relay providers in the local desktop app and direct Google sign-in, removing the OPENSCI sign-in entry.

<a id="模型渠道"></a>

## Model Channels
Add two custom channel types, custom-anthropic and custom-openai, for Anthropic Messages and OpenAI Chat Completions respectively. Reuse names, encrypted API Keys, Base URLs, manually entered models, model fetching, and connection testing. Users must see the actual protocol and request address; custom channels must not switch back to official endpoints based on an sk-ant prefix. Connection tests must verify a successful request with the specified model, rather than treating any HTTP response as success.

Agent SDK continues to use the Anthropic protocol. OpenAI channels convert text, images, tool calls and results, and streaming output through a local bridge listening only on 127.0.0.1 and protected by random credentials; unsupported content produces explicit errors. The bridge forwards only to that channel's configured URL, prohibits browser cross-origin access, and does not log credentials.

<a id="登录"></a>

## Sign-In
Use the system browser + Authorization Code + PKCE, fixed Google endpoints, a random loopback port, state validation, and timeout cancellation; the main process holds tokens. Reuse safeStorage (file encryption protected by macOS Keychain), caching the user profile separately. Missing configuration displays actionable setup instructions without simulated sign-in. Google tokens are never forwarded to OPENSCI services. Old OPENSCI sessions are not restored as Google sessions. Sign-out clears only local login state; disconnecting revokes the app's authorization rather than deleting the Google account, with this distinction clearly explained in the UI. The local research library remains intact.

Configuration uses a local file or build-time defaults; never commit real credentials. Provide instructions for creating Google Cloud Desktop OAuth credentials and configuring test users. Real browser authorization requires valid OAuth configuration created by the user; do not claim end-to-end sign-in passed before it exists.

<a id="验证"></a>

## Validation
Tests first: protocol URLs, model fetching, tool round trips and streams, bridge authentication, authorization URL/PKCE/state, cancellation/timeouts, refresh, old-account isolation, and token destinations. Run repository-wide typecheck, bun test, and Electron build; validate the new UI with a separate development data directory. README/CLAUDE changes are unnecessary.

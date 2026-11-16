# Custom Models and Google Login Implementation Plan

**Goal:** Make custom relay endpoints actually serve models and Agents; replace the OPENSCI entry point with direct Google login.
**Architecture:** Reuse Channel and authentication orchestration, add pure OpenAI protocol conversion and a local bridge; implement the Google client separately and inject it into the existing AuthService.
**Tech Stack:** Bun, Electron, TypeScript, React, Jotai, Node HTTP/crypto, existing safeStorage.

## Global Constraints
- Add no dependencies and write no any. Keep UI copy synchronized in en/zh and use semantic color tokens.
- Preserve original channels and local research data; Google tokens must not flow to OPENSCI.
- Explicitly report missing configuration for real Google authorization; tests must not pretend to perform actual Google login.

<a id="task-1-自定义模型主代理"></a>

## Task 1: Custom models (main agent)
- [x] First write URL/model protocol/tool round-trip/streaming tests and run them to confirm failure from missing implementation.
- [x] Extend ProviderType, profile/adapter registries, and default capabilities; add custom Anthropic/OpenAI.
- [x] A pure conversion module handles Anthropic ↔ OpenAI Chat Completions; the native HTTP bridge binds only to loopback and validates a random token; Agent env and scoring share the same source.
- [x] Add protocol-specific custom options, manually entered models, Base URL, accurate request previews, and strict test results to the form. Synchronize Chinese and English.
- [x] Run repository-wide typecheck after targeted tests.

<a id="task-2-google-登录独立实现"></a>

## Task 2: Google login (independent implementation)
- [x] First write authorization URL, state/cancellation/missing configuration, token refresh, and session destination tests and confirm failure.
- [x] Create a Google client: fixed official endpoints, PKCE, random loopback, timeout and cancellation, userinfo profile validation, retention of refresh tokens on refresh, safeStorage.
- [x] Inject the Google client into AuthService; production entry uses only Google; old OPENSCI sessions cannot resume; Google tokens are not provided to journal; keep sign-out/disconnect semantics consistent.
- [x] Update the login page to Google, missing-configuration prompts and Chinese/English translations, account disconnect semantics, and the configuration guide.
- [x] Run targeted tests and typecheck; submit a concrete change list for integration review.

<a id="task-3-集成与交付"></a>

## Task 3: Integration and delivery
- [x] Review data flows and failure paths in both implementations; fix issues found.
- [x] Run bun run typecheck, bun test, bun run electron:build and record results.
- [x] Start the independent development directory to check the login page/model form; explain that real Google and relay endpoint validation still requires user configuration.

<a id="验证记录"></a>

## Validation record
- Repository-wide typecheck and Electron build succeeded.
- Final repository-wide regression (20s timeout): 2983 pass / 3 fail. Two overlay style assertions also failed in an independent /tmp copy of unmodified HEAD, confirming baseline issues; the capability-pack registration test hit a hook timeout in the full run, while rerunning that file alone yielded 3 pass / 0 fail. The full suite is not yet entirely green.
- Protocol, bridge, Google, and model form targeted regressions succeeded; a real Bash tool round trip from the SDK subprocess to a simulated relay endpoint succeeded.
- Native UI checks: Google button and missing-configuration prompt; custom Anthropic/OpenAI options, manual models, request URL preview; en/zh switching and form screenshots showed no overflow.
- Real Google authorization (no valid Desktop OAuth configuration yet) and real relay endpoints (no user test credentials yet) were not verified.
- Changes remain on codex/custom-models-google-login, without pushing/merging or replacing the old installed package.

- Final correction: Google disconnect revokes the refresh token first; independent regression passed. Chinese/English name regression for the custom channel list passed. Final typecheck, Electron build, and ESLint for changed code all succeeded.

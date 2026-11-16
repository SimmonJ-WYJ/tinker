<a id="图像编辑静默失败修复"></a>

# Fix Silent Image Editing Failures

Status: implementation in progress. The user agreed to fix silent failures after charging first, then improve size and cost notices.

Design: OpenAI-compatible conversion rejects responses with neither body nor tools, including whitespace-only responses; the bridge returns identifiable, redacted errors, preserving the status, rate-limit classification, and bounded Retry-After for 429. Orchestration streams must end in a terminal state; empty successes must report an error. User cancellation and the watchdog retain their existing flows. Do not automatically replay image operations. Errors reuse existing persistence, events, and recovery paths, with synchronized English and Chinese copy.

Image cards read actual natural dimensions; notices must not guarantee the original size. Without a trustworthy local quote or bill, do not display fabricated costs; defer to the relay bill. Show a billing notice when approving a single generation without changing permission policy.

Implementation plan:
1. Add empty-body, empty-stream, 429, and redaction tests to openai-compat and openai-bridge; observe failures, then implement conversion guards and error classification. Run `bun test packages/core/src/providers/openai-compat.test.ts apps/electron/src/main/lib/openai-bridge.test.ts`.
2. Add tests for no result, empty success, text, tools, replay, subtasks, and cancellation to agent-turn-outcome. Observe failures before connecting orchestration finalization. Use agent-response-failure to verify English and Chinese recovery copy.
3. Test GeneratedImage load events for actual dimensions and cost explanations, with no missing keys when switching English/Chinese; show no invented dimensions before loading. Verify PermissionBanner shows billing notices only for image-generation approval.
4. Run typecheck, full bun test, and electron:build; validate in an isolated source copy, without deploying or overwriting the production package, and provide a patch and verification logs.

Constraints: preserve all changes in the production directory; do not write there when Git queries are blocked. Fix the accepted source copy. The earlier billing total for today was ¥1.4717, including user testing; this round uses local simulations first and incurs no real charges.

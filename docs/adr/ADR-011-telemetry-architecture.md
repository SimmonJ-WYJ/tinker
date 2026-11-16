<a id="adr-011遥测埋点架构三层主进程汇集地域判定eu-驻留"></a>

# ADR-011: Telemetry Architecture (Three Layers, Main-Process Aggregation, Regional Detection, EU Residency)

| Field | Content |
|------|------|
| **Status** | Accepted |
| **Decision date** | 2026-06-02 |
| **Related** | issues #416 / #426 / #427 · [0.3.0 PRD Epic 3](../specs/0.3.0/0.3.0-prd.md) · [telemetry-spec](../specs/telemetry-spec.md) |

---

<a id="背景"></a>

## Background

The 0.3 public release needs crash diagnosis (Sentry), product behavior analytics (PostHog), and self-evolution signal collection (self-hosted endpoint).
Research users place high value on privacy, EU users are subject to GDPR, and the self-hosted backend (ADR-002) remains undecided.
This ADR records five **hard-to-reverse or counterintuitive** architectural decisions and their rationale.

<a id="决策"></a>

## Decisions

<a id="1-主进程统一汇集禁-autocapture"></a>

### 1. Aggregate in the Main Process; Prohibit Autocapture

All telemetry (behavior events + self-evolution signals) is aggregated via IPC into the main-process `telemetry-service`, which applies
consent gate → Zod allowlist → redaction → deviceId injection → reporting. The renderer never connects directly to SaaS.

- **Why not posthog-js (the officially recommended path)**: autocapture collects DOM text automatically, potentially sending literature titles /
  note content and violating the strict rule against collecting research content; direct renderer connections also bypass the project's proxy-fetch,
  causing extensive data loss for the many research users working behind proxies.
- **Why not posthog-node**: its built-in http client cannot reuse undici ProxyAgent;
  instead, a custom thin sender connects directly to PostHog's HTTP `/batch/` API (zero additional runtime dependencies).

<a id="2-地域判定-&#45;本地时区启发式偏离-prd欧盟-ip字面"></a>

### 2. Regional Detection = Local Time-Zone Heuristic (Departing from the PRD's Literal "EU IP")

The PRD says "EU IP," but looking up IP geography requires first sending the IP to a geo service, **before** the user consents to collection,
creating the paradox of disclosing an IP before consent. Instead, compare `Intl.DateTimeFormat().resolvedOptions().timeZone` against
an EU/EEA/UK time-zone list (`packages/shared/src/telemetry/consent.ts`), with zero outgoing network traffic;
**treat all indeterminate cases conservatively as GDPR regions** (off by default). Errors from travel/proxies lean toward more conservative treatment rather than more aggressive collection.

<a id="3-consent-闸门-&#45;采集入口全停"></a>

### 3. Consent Gate = Stop All Collection at Entry

Toggle off = neither local JSONL writes nor reporting (rather than continuing local writes and gating only reports). The toggle means what it says and is straightforward to audit.
The two toggles (PostHog / self-evolution) are fully independent. Sentry is always on without a toggle (PRD decision; crash reporting is handled under legitimate interests,
with deep redaction through `beforeSend` in both main + renderer processes; native minidumps cannot be redacted client-side,
and uploads contain no user fields injected by ASCI—this is a known limitation).

<a id="4-saas-数据驻留选-eu"></a>

### 4. Choose EU Residency for SaaS Data

PostHog EU Cloud (`eu.i.posthog.com`) + Sentry EU region. This matches ADR-002's preference for EU node locations,
avoids SCC dependence for EU users, and simplifies the Privacy Policy subprocessor list. Migrating regions after project creation is expensive, making this hard to reverse.

<a id="5-sentryelectron-必须-externalclaudemd-71-的第三个例外"></a>

### 5. @sentry/electron Must Be External (The Third Exception in CLAUDE.md §7.1)

`@sentry/electron` depends on OTel dynamic instrumentation (require-in-the-middle), cannot be bundled by esbuild,
and must use `--external`, with its full transitive dependency closure (68 packages) included in electron-builder `files`
(see comments in `apps/electron/scripts/build-main.ts` and `electron-builder.yml`).
Use the same treatment as agent-sdk.

<a id="其他要点"></a>

## Other Details

- **Anonymous deviceId**: a local UUID (`~/.asci/telemetry/device-id.json`) serves as PostHog distinct_id;
  after #420 OPENSCI sign-in is implemented, merge it into the account with `identify()/alias()`; do not block on sign-in.
- **Decoupled self-evolution reporting**: the backend (ADR-002) is not built; the sender is pluggable. Without an endpoint configured, only local
  `signals.jsonl` buffering is used (5MB rotation ×2); schemas are generated with zod `z.toJSONSchema()` into
  `schema/telemetry/*.schema.json` (tracked) for external audit, with drift tests as a guard.
- **Key injection**: PostHog key / Sentry DSN are publishable, injected at build time using esbuild `--define`
  (env `ASCI_POSTHOG_KEY` / `ASCI_SENTRY_DSN`); when absent, the entire pipeline falls back to local buffering.
- **Dev gate**: unpackaged / `ASCI_DEV=1` sends no real network requests, only local JSONL (`~/.asci-dev/telemetry/`).

<a id="后果"></a>

## Consequences

- Adding an event requires updating the `packages/shared/src/telemetry/event-registry.ts` registry + reviewing the property allowlist;
  bare strings are prohibited at call sites.
- Self-evolution signal fields are defined by `schema/telemetry/`; Zod changes require rerunning `gen:telemetry-schema`.
- Enable self-evolution reporting once the backend is ready by configuring the endpoint (`ASCI_EVOLUTION_ENDPOINT`), without changing collection code.

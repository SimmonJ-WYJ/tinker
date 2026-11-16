<a id="adr-005opensci-作为-asci-唯一身份提供方"></a>

# ADR-005: OPENSCI as ASCI's Sole Identity Provider

| Field | Content |
|------|------|
| **Status** | Proposed (grill-with-docs session decision 2026-06-01, awaiting formal product/engineering Lead signature) |
| **Decision date** | 2026-06-01 |
| **Decision maker** | (to be filled; product/engineering Lead recommended) |
| **Related** | [0.3.0 PRD](../specs/0.3.0/0.3.0-prd.md) Epic 1 / §3 · 0.3 north-star §I / §X.2 · [ADR-002](./ADR-002-server-stack.md) ③ Authentication strategy |

---

<a id="一背景"></a>

## I. Background

0.3 introduces user accounts for public release (identity, attribution of behavioral telemetry, future cross-device synchronization). 0.3 north-star §I originally planned **an independent ASCI account system** (email + password registration/reset, direct Google/ORCID OAuth), with §I.2 reserving `linkedOpenSciId` only as a placeholder and §X.2 explicitly excluding **OPENSCI OAuth binding (field reservation only)**.

The product/engineering retrospective before 0.3 changed direction: ASCI belongs to the OPENSCI ecosystem and should share its identity system rather than build another account system.

<a id="二决策"></a>

## II. Decision

**ASCI will not build its own account system; delegate the sole login entry to OPENSCI (OAuth/OIDC).**

- Sole login entry = OPENSCI; OPENSCI supplies specific methods such as Email/Google/ORCID.
- ASCI's server holds only a **user mapping table** (OPENSCI uid → ASCI user), limited to identity and behavioral telemetry attribution; **no profile storage**.
- User profiles (nickname/avatar/institution/discipline) are **read live from OPENSCI for read-only display**.
- ASCI locally caches only OPENSCI-issued tokens, encrypted with safeStorage and refreshed through rotation.
- Login is mandatory.

<a id="三理由与取舍委托-vs-自建"></a>

## III. Rationale and Tradeoffs (Delegation vs Independent Accounts)

| | Delegate to OPENSCI (selected) | Independent accounts (rejected) |
|---|---|---|
| Ecosystem identity | ✅ Unified OPENSCI identity | ❌ Another isolated account system |
| Lead-time | ✅ ASCI need not apply for Google/ORCID OAuth clients or build registration/password/email verification | ❌ OAuth verification + email domain authentication takes 2-4 weeks |
| Security surface | ✅ No password/credential custody; account attack surface concentrated at OPENSCI | ❌ ASCI handles password storage/reset/protection |
| Control | ❌ Login methods and availability constrained by OPENSCI | ✅ Full control |
| Dependency risk | ❌ Strong dependence on OPENSCI SSO readiness (built in parallel during 0.3, medium risk) | ✅ No strong external dependency |

Net assessment: given ASCI's place in the OPENSCI ecosystem, unified identity + shorter lead-time + reduced security surface substantially outweigh independent accounts. The cost is a strong OPENSCI SSO readiness dependency, mitigated by freezing the interface contract early and providing a fallback path.

<a id="四与既有规划的反转"></a>

## IV. Reversal of Existing Plans

This decision **reverses** north-star §I (“independent account system”) and §X.2 (“no OPENSCI OAuth binding”). OPENSCI moves from a reserved binding field to the sole identity source.

<a id="五后果"></a>

## V. Consequences

- north-star §I U1/U2/U3 (registration / email verification / multiple OAuth bindings) **belong to OPENSCI** and are not implemented by ASCI; ASCI retains U4/U5 (local token encryption / refresh rotation).
- §II authentication service becomes “OPENSCI SSO integration + user mapping + behavior attribution,” replacing independent authentication.
- §V-A's ORCID/Google OAuth client application lead-time **moves to OPENSCI**; ASCI adds **OPENSCI SSO OAuth/OIDC contract freeze + readiness deadline** as release prerequisites.
- ADR-002 ③ Authentication strategy must align (integrate OPENSCI rather than self-written/Auth0/Clerk).
- **Risk**: OPENSCI SSO is built in parallel during 0.3; delays block the account epic. Mitigation = early contract freeze; product/engineering Lead decides fallback (temporary placeholder login / accounts deferred to 0.4).

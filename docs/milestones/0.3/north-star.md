<a id="03-北极星目标公开发布用户体系-&#45;能力包范式-&#45;发布就绪"></a>

# 0.3 North Star Goals (Public Release: User System + Capability Package Paradigm + Release Readiness)

> ⚠️ **Substantially revised by 0.3.0 PRD (2026-06-01)**: The pre-0.3 product/engineering retrospective (grill-with-docs) overturned/narrowed core assumptions: accounts changed from self-built to **OPENSCI SSO** as sole login ([ADR-005](../../adr/ADR-005-opensci-identity-provider.md)); **Proposal mechanism removed entirely from 0.3**; **§VII user activation removed** (measurement framework, not functionality); local research data changed from account-isolated to **one device-level library**; DO1 data card / DO4 narrative deferred to 0.4; packages **enabled by default and cannot be disabled** (Codex style).
>
> **Implement according to [`docs/specs/0.3.0/0.3.0-prd.md`](../../specs/0.3.0/0.3.0-prd.md), whose §3 lists all 14 revisions.** This document remains historical planning context and is no longer updated item by item; PRD prevails in conflicts.

**Positioning**: Establish ASCI accounts, implement capability packages (2 launch scenario packages + separate Configuration page + Settings restructuring), complete security/compliance/data infrastructure, and release publicly.
**Deadline**: 2026-06-19 (immediately after 0.2 delivery, about 2 weeks)
**Release form**: Public release (macOS first; Windows depends on §V-A EV signing lead time)
**Prerequisites**: 0.2 object foundation delivered, 0.2 §III-4 Agent extensibility refactor (A0/A1/A2/A3) signed off, 0.2 §III-5 capability concepts (X1-X4) signed off, self-hosted server ready, ADR-001 / ADR-002 signed
**Design philosophy**: Inherit [0.2 §0 ASCI Agent-led Principle](../0.2/north-star.md#section-zero): Agent-triggered Proposals handle observation / induction / annotation / organization where possible; users set goals, review, and decide. §III-C launch packages must implement `capabilities.proposals[]` output contracts (§III-C.1 / CP1); decision signals feed §III-A self-evolution "user feedback" (§III-A.2).
**Audit principle**: Every goal verifiable by yes/no or specific numbers, without subjective judgment; each criterion marks priority.
**Sole authority**: This document solely defines 0.3 milestone. GitHub milestone descriptions provide only brief guidance (≤200 characters + link), never duplicate content; scope changes defer here.

> **Scope reordering (2026-05-12)**: Retrospective found the 2-week window tight and proactively narrowed scope (full decisions §X.1): default-page redesign (§III-D) deferred wholesale to 0.4 / single-node server launch / GitHub OAuth dropped / self-evolution UI only one Settings toggle / Windows contingent on EV lead time.

| Label | Meaning |
|------|------|
| Required | Must pass before 6.19 or public release is blocked |
| Observe | Track, nonblocking |
| Downgradable | May defer to 0.4 if behind at Week 2 end |
| 0.4 second release | Formally assigned to next milestone |

> **Version convention**: 0.3.0 is the public release; 0.3.x are internal development versions (e.g. 0.3.5 hotfix), not user-facing catch-up increments. Everything beyond 0.3.0 scope enters 0.4.

---

<a id="一asci-独立账户体系"></a>

## I. ASCI Independent Accounts

<a id="11-认证方式"></a>

### 1.1 Authentication Methods

| Method | Description |
|------|------|
| **Email + password** | Registration, login, password reset (email service) |
| **Google OAuth** | Most common for international users |
| **ORCID OAuth** | Standard for researchers, priority integration |

> **GitHub OAuth removed from 0.3.0**: Originally included for developers, but researchers are the primary audience and it is not essential at launch; ORCID + Google cover core scenarios. Reconsider in 0.4 from feedback.

<a id="12-账户数据模型"></a>

### 1.2 Account Data Model

| Field | Description |
|------|------|
| UID, email, password hash | Basic authentication |
| Nickname, avatar | Basic profile |
| Institution, discipline | Research profile, optional on registration |
| Registration time, last login | Audit |
| Language preference | C5 multilingual integration |
| linkedOpenSciId | Reserved OPENSCI linking field; no linking flow in 0.3 |

<a id="13-审计标准"></a>

### 1.3 Audit Criteria

| # | Criterion | Verification | Priority |
|---|---------|---------|--------|
| U1 | Both Google / ORCID complete registration+login | Run both OAuth flows with test accounts; either failure fails U1, aligned with §V-A lead-time risks | Required |
| U2 | Email registration → verification → login → password reset | Complete email verification chain | Required |
| U3 | Multiple OAuth methods linked to one email access the same account | Google login, link ORCID, then ORCID login reaches same account | Required |
| U4 | Client tokens encrypted locally, unrecoverable after logout | Inspect encryption of Token files under ~/.asci/ | Required |
| U5 | Refresh-token rotation, old token invalidated once | Capture requests; old Access Token returns 401 after refresh | Required |

---

<a id="二服务器"></a>

## II. Servers

<a id="21-服务清单"></a>

### 2.1 Service List

| Service | Purpose | Priority |
|------|------|--------|
| Authentication | Registration/login/OAuth callbacks/token issuance, refresh, revocation | P0 |
| User data | Profile CRUD, preference sync | P0 |
| Telemetry endpoint | PostHog proxy / Sentry relay | P1 |
| Version updates | electron-updater feed | P1 |
| Data sync | Desktop ↔ Web | Interface reserved only, not implemented in 0.3 |
| MCP / A2A | Paper-search MCP, PDF parse cache, object A2A protocol | V1 roadmap; reserve API extensibility in 0.3 design |

<a id="22-技术约束"></a>

### 2.2 Technical Constraints

- Backend stack selected through 0.2 F1 ADR-002: Deployment platform / database / auth strategy / application framework (output `docs/adr/ADR-002-server-stack.md`, including research + review + decision maker + decision record, not research alone)
- Database: PostgreSQL (users + auth)
- **Single-node launch**; ADR-002 selects region (EU preferred for compliance consistency, avoiding SCC dependency for EU users, all data inherently EU-hosted); EU/US routing deferred to 0.4
- Closed-source server code in separate repository/CI/CD (distinct from 0.2 §II O1 open object JSON Schema: implementation vs data contract)
- **New repositories follow OPS process**: Contact sciops before creation for permissions / branch protection / secrets policy / CODEOWNERS, never create directly under personal accounts
- Protocol: REST + JSON

<a id="23-审计标准"></a>

### 2.3 Audit Criteria

| # | Criterion | Verification | Priority |
|---|---------|---------|--------|
| S1 | Single-node registration/login, all users routed there | Accessible from EU and US IPs; requests reach selected region | Required |
| S2 | Authentication 99.5% available | Load-test 1000 concurrent login requests | Required |
| S3 | Region compliance: EU node under ADR-002 stores all data in EU, automatically satisfying GDPR sovereignty; US node requires EU cross-border SCC in Privacy Policy | Inspect DB region + SCC text | Required |
| S4 | Verification/reset emails within 30 seconds, delivery ≥ 99% | Trigger 100 registration emails, measure arrival/failures | Required |
| S5 | EU/US dual-node routing (old S1) | — | 0.4 second release |

---

<a id="三数据埋点-&#45;采集"></a>

## III. Telemetry and Collection

<a id="31-分层"></a>

### 3.1 Layers

| Layer | Content | Solution |
|------|------|------|
| Crashes/errors | Uncaught exceptions, main-process stacks | Sentry |
| Product analytics | Feature usage, user journeys, retention | PostHog |

<a id="32-审计标准"></a>

### 3.2 Audit Criteria

| # | Criterion | Verification | Priority |
|---|---------|---------|--------|
| T1 | Uncaught exceptions auto-reported to Sentry with stack | Trigger crash; visible in Sentry Dashboard | Required |
| T2 | Search/review/login events reported to PostHog | Complete flow; event stream visible | Required |
| T3 | EU IP users default off for nonessential PostHog, explicit opt-in; non-EU opt-out (on, can disable) | Simulate EU registration: no reports until enabled; non-EU: reports until disabled | Required |
| T4 | Crash reports exclude personal data (redact email/IP) | Inspect Sentry payload | Required |
| T4a | Replace usernames in stack paths with placeholders (`/Users/<USER>/...`, `C:\Users\<USER>\...`) | Trigger crash containing local paths; inspect every username segment redacted | Required |

> **T3 basis**: GDPR requires nonessential EU collection off by default + explicit opt-in (opt-out is noncompliant for EU users). T3 and §III-A share regional opt-in/out framework.

---

<a id="三-aagent-自进化埋点"></a>

## III-A. Agent Self-evolution Signals

> **Purpose**: Build data foundations for an Agent that improves with use. 0.3.0 completes 6 signal types (schema + endpoint + client instrumentation), accumulating data; automatic tuning deferred to 0.4 / V1.
> **Scope decision (2026-05-12)**: **All 6 collection types complete**; visible UI only one Settings toggle (compliance floor for EU opt-in/non-EU opt-out). Weekly-event viewer / clear-all / first-task opt-in guidance deferred to 0.4.
> Shares regional consent framework with §III but uses an **independent upload channel**, separate from PostHog, for auditability and future tuning independence.

> **0.3.0 Data Consumption (Important)**:
>
> | Phase | Data action | User-visible value |
> |------|---------|------------|
> | 0.3.0 | **Collect only, no consumption**: All 6 types persist at self-evolution endpoint, complete schema/endpoint/client chain, but enter no model/recommendation/RAG | No user-facing product value; foundations for 0.4 only |
> | 0.4 | Begin consumption: Proposal adoption drives package defaults / Agent style tuning / personalized routing (scope in 0.4 north-star) | First sense of an Agent adapting to the user |
> | V1 | Full chain: Automatic tuning / federated learning / local small models (V1 roadmap scope) | Actual data flywheel |
>
> §III-A is infrastructure investment, not 0.3.0 user-value delivery; promise no experience improvement from it in 0.3.0.

<a id="三-a1-采集原则"></a>

### III-A.1 Collection Principles

| Principle | 0.3.0 implementation |
|------|------|
| Regional branching | EU Settings toggle off, deliberate enabling = explicit opt-in; non-EU on with opt-out, aligned with T3 |
| User visibility (0.3.0) | New Data Collection tab: independent T3 PostHog + AE2 self-evolution switches, each briefly explaining separate channel, no content collection, disable anytime |
| User visibility (0.4) | Full transparency panel: Weekly uploaded events + clear-all + first-task guidance |
| Separate channel | Physically separate self-evolution backend endpoint from PostHog |
| Minimization | Collect only §III-A.2 six structured signals, never §III-A.3 content |

<a id="三-a2-6-类合规可采集信号030-全部完成"></a>

### III-A.2 Six Compliant Signal Types (All Complete in 0.3.0)

| Category | Examples | Evolution value |
|------|---------|----------------------|
| Task structure | Instruction length, domain (search/review/writing/experiments), turns, ending (complete/interrupted/timeout) | Identify strengths/weak task types |
| Tool use | MCPs/Skills/packages invoked, ordering, success rate, package co-installation | Default recommendations + tool combinations |
| User feedback (most critical) | Explicit votes, implicit copy/save/cite/discard, next-instruction nature (correct/continue/change topic), retries; **Proposal decisions, five action ratios `采纳 / 修改 / 拒绝 / scoped / silence-this-kind` (accept / modify / reject / scoped / silence-this-kind), grouped by `sourceCapability × kind`, naming strictly matching [0.2 §I-A](../0.2/north-star.md#section-1a)** | Core RLHF-style signal; adoption directly drives [0.2 §0 Agent-led philosophy](../0.2/north-star.md#section-zero) iteration |
| Model choice | Provider/model distribution, in-session switching, token use vs satisfaction | Defaults + package/model binding |
| Errors/exceptions | Hangs/timeouts/errors, interruption timing, permission denials | Robustness weaknesses inform revisions |
| Workspace structure (not content) | Library size, EvidenceRef/Note creation-edit frequency, CitationRelation distribution | Research-object usage intensity informs default UX |

<a id="三-a3-绝不采集红线"></a>

### III-A.3 Never Collect (Red Lines)

Full literature / PDF contents / original notes / conversations / API Keys / emails / usernames / paths containing usernames (T4a redaction).

<a id="三-a4-审计标准"></a>

### III-A.4 Audit Criteria

| # | Criterion | Verification | Priority |
|---|---------|---------|--------|
| AE1 | Six independent event JSON Schemas in `schema/agent-evolution-events/` | External auditor reconstructs collectible fields without source code | Required |
| AE1a | All six client instrumentation types shipped and actually reported | Run one scenario per type; endpoint logs show persistence | Required |
| AE2 | Data Collection tab has Self-evolution Collection toggle, independent of T3; disable stops events | Endpoint receives none after disabling, T3 unaffected | Required |
| AE2a | First app entry: EU off, non-EU on | Create accounts with simulated EU/non-EU IPs, inspect initial state | Required |
| AE5 | Endpoint colocated with §II servers, S3 compliance | Inspect persistence region | Required |
| AE3 | Weekly uploaded events + clear-all (server deletion within 30 days) | — | 0.4 second release |
| AE4 | First EU Agent-task entry opt-in guidance, dismissible/nonblocking | — | 0.4 second release (0.3.0 compliance via AE2a off default + deliberate Settings enabling) |

<a id="三-a5-03-不做推迟-04-&#45;v1"></a>

### III-A.5 Not in 0.3 (Deferred 0.4 / V1)

- Automatic tuning (data → model weights / RAG)
- Federated learning
- Local small models (distillation / LoRA)
- Personalized package recommendations
- Full transparency UI (AE3 / AE4)

---

<a id="三-c能力包实现层02-三-5-概念层的落地"></a>

## III-C. Capability Package Implementation (0.2 §III-5 Concepts)

> **Dependencies**: 0.2 §III-4 extensibility (A0/A1/A2/A3) complete, §III-5 concepts (X1-X4) signed.
> **Purpose**: Bring package paradigm into product experience, separating system foundation vs Agent ecosystem; users face research scenario packages rather than scattered MCP/Skill/provider configuration.
> **Philosophy**: ASCI is a research-Agent foundation, expanded by scenario packages. Four core contents: **scenario Agent settings + Skill references + MCP references + UI framework (selection + render configuration)**. **Host supplies framework library** (one conversation-first/right-product framework in 0.3, expandable 0.4+); packages declare framework/details. Both launch packages use it.
> **Workload note (2026-05-12)**: Review capability comes from **0.1 review pipeline (group B: generation + citation tracing) + 0.2 V1 evidence-chain viewer** ([ownership note, 0.2 §III-2](../0.2/north-star.md#section-3-2)). §III-C work **reduces to A3 reconnection + Configuration registration + render adaptation**, without rebuilding citation/passage tracing.

<a id="三-c0-配置分层系统底座-vs-agent-生态"></a>

### III-C.0 Configuration Layers (System Foundation vs Agent Ecosystem)

| Layer | Location | Responsibility | Examples |
|----|---------|------|------|
| **System foundation** | Settings dialog | Shared resources/credentials consumed by packages | Provider keys, Zotero credentials, ASR models, MCP list, proxy, UI preferences |
| **Agent ecosystem** | Separate sidebar Configuration page, peer of Library | Skill/package install, uninstall, enable, preferences | Skills + packages sections |

Principle: **System layer adjusts system parameters; Agent ecosystem manages capabilities**, with completely independent entry points/pages.

> **User mental-model validation**: [0.2 §III-4 X1.2](../0.2/north-star.md#section-3-4) tests this separation. If interview accuracy < 60%, CP5's no-split-entry hard rule becomes weaker: New Configuration + Settings default; old Settings Configuration tab remains read-only/deprecated in 0.3.0 as transition guidance, removed 0.4. X1.2 drives downgrade, not hardcoded 0.3 assumptions.

<a id="三-c1-首发场景能力包2-个"></a>

### III-C.1 Two Launch Scenario Packages

| Package | Scenario Agent settings | Skills | MCPs | UI framework/rendering | 0.1 / 0.2 capability | 0.3.0 workload |
|--------|----------------|-----------|----------|--------------------|--------------------|--------------|
| **Literature Search** | Clarify keywords/time/discipline, generate plan, summarize results | Search planning, ranking, Zotero import (system Zotero) | arXiv / Semantic Scholar / IACR / OpenReview search MCPs | Conversation-first/right-product; results with field labels, sources, citation counts, sorting/filtering | 0.1 search pipeline | A3 integration + page registration + render adaptation |
| **Literature Review** | Clarify goals, explain tracing, revision feedback | Review orchestration, citation tracing | System MCPs + Zotero | Same framework; review body + provenance panel with clickable citations | 0.1 B traceable reviews + 0.2 V1 evidence viewer ([ownership](../0.2/north-star.md#section-3-2)) | **Capability already complete**; only A3 integration + registration + rendering |

> **Zotero is not a package**: System configuration enabling multiple scenarios (import search results, select review papers). Credentials + optional ASR download stay in Settings → Zotero.

<a id="提议产出proposal-副产品"></a>

#### Proposal Outputs (Byproducts)

Beyond task responses, each package declares `capabilities.proposals[]` per 0.2 §III-3 A3, implementing [0.2 §0 philosophy](../0.2/north-star.md#section-zero):

| Package | Proposal kind | Trigger | Details destination |
|--------|-------------------|--------|----------|
| Search | `evidence-set` (results matching existing set topic) | Results enter library | Related EvidenceSet Pending Proposals |
| Search | `citation-relation` (relations between result papers) | Results enter library | Affected Paper Pending Proposals |
| Review | `citation-relation` (relations between review passages) | Review completes | Affected Paper Pending Proposals |
| Review | `hypothesis-promote` (falsifiable assertions found in review) | Review completes / user Note contains assertion | Note Pending Proposals |
| Review | `hypothesis-review` (support/refutation of attached hypothesis after new Paper) | Paper added to EvidenceSet | Hypothesis Note Pending Proposals |

<a id="三-c2-独立配置页左侧-sidebar"></a>

### III-C.2 Separate Sidebar Configuration Page

Add Configuration sidebar entry, peer of Library, independently routed, with two sections:

<a id="skill-板块"></a>

#### Skills Section
- Overview of **all available Skills** (built-in / from packages / user-installed), each labeled by source
- Per Skill: Enable/disable, metadata (name/version/capability/source), reverse package-use links
- Filter by source / enabled status

<a id="能力包板块"></a>

#### Capability Packages Section
- Installed list including 2 launch packages
- Details: Scenario Agent preview, referenced Skills linked to Skills section, MCP list, framework/rendering explanation, **Proposal Outputs** listing `capabilities.proposals[]` kinds/triggers so proactive pending suggestions are clear, preferences such as default model
- Install/uninstall (0.3 local manual only, no third-party uploads; §III-C.5)

<a id="三-c3-settings-弹窗结构调整"></a>

### III-C.3 Settings Dialog Restructuring

| Tab | Content | 0.3 status |
|-----|------|---------|
| General | UI preferences, language | Retain |
| Models | Provider API keys, cross-scenario system credentials | Retain |
| Zotero | Credentials + optional ASR model download | Retain |
| Proxy | Network settings | Retain |
| **MCP** | Shared MCP server infrastructure | **New**, replaces old Configuration tab |
| **Data Collection** | T3 PostHog consent + AE2 self-evolution, minimal compliance UI | **New** |
| Shortcuts | — | Retain |
| Archived | — | Retain |
| About | — | Retain |

**Changes**: Remove old Configuration tab, move MCPs to separate MCP tab, Skills/packages to sidebar Configuration, and add Data Collection for T3 + AE2 consent.

<a id="三-c4-审计标准"></a>

### III-C.4 Audit Criteria

| # | Criterion | Verification | Priority |
|---|---------|---------|--------|
| CP1 | Both packages integrate through 0.2 §III-4 A3 registry, no hardcoding; **each emits §III-C.1 kinds via `capabilities.proposals[]` into relevant Pending Proposals** (search: `evidence-set` + `citation-relation`; review: `citation-relation` + `hypothesis-promote` + `hypothesis-review`) | Inspect registry use; removing either package removes scenario capability without crash; **end-to-end search + review show correctly placed Proposals with `reasoning` and decision buttons** | Required |
| CP2 | Sidebar Configuration includes all Skills with sources, and package install/uninstall/preferences | Open → source filter → review-package details with Skills/framework → uninstall → reverse usage links update | Required |
| CP3 | 9 Settings tabs per §III-C.3; Zotero credentials + working optional ASR download | Download ASR model (source/size frozen in spec), transcribe ≤ 1min audio, inspect all tabs | Required |
| CP4 | Upgrade 0.1/0.2 auto-migrates old Configuration: MCPs to MCP tab, packages to sidebar; system Zotero/provider/proxy unchanged | Upgrade fully configured 0.1 test account; search/review/Zotero immediately usable without reentry; old tab route 404 | Required |
| CP5 | No split configuration entries: Skills/packages only in sidebar Configuration, absent from Settings | grep no old Settings routes + UI walkthrough | Required |

<a id="三-c5-03-不做推迟-04-&#45;v1"></a>

### III-C.5 Not in 0.3 (Deferred 0.4 / V1)

- **Public third-party package extension points**: Only 2 built-ins in 0.3, no public extension. Start later with **internally built team tools** through ASCI PRs; third-party packaging/loading/review defer at least 0.5 / V1
- Package marketplace / remote discovery (2 built-ins only, no market entry)
- Package versioning / automatic upgrades (follow host version)
- Inter-package dependency resolution (2 launch packages independent)
- User-installed / third-party Skills (0.3 sources only built-in/from packages)
- **Framework-library extension**: One conversation-first/right-product framework for both packages; registration/switching deferred 0.4+ for writing/logs/analysis layouts

---

<a id="section-3-d"></a>

<a id="三-d默认页改造中心对话框-&#45;总控-agent-整体推迟-04"></a>

## III-D. Default-page Redesign (Central Conversation + Supervisor Agent) — **Entirely Deferred to 0.4**

> ⚠️ **2026-05-12 decision**: Entire redesign deferred. 0.3.0 retains 0.1/0.2 entries through installed packages (sidebar Configuration → packages) or shortcuts; **none of DH1-DH4 delivered**.

**Complete design (page structure, supervisor behavior, DH1-DH4 criteria, exclusions) extracted separately**:

📄 [`ya-docs/milestones/0.4/design-inputs/default-page.md`](../0.4/design-inputs/default-page.md)

**Reason**: Keep 0.3 focused on deliverables, excluding deferred work from progress risks/audits.

**0.3 closure**:

- §X deferred-to-0.4 table retains all §III-D (DH1-DH4)
- §IX relationship to 0.2 references no §III-D content
- §VII L3 guidance triggers through Proposal decisions, **independent of §III-D**

**Product risk**: At public launch the configuration→package narrative is nearly invisible in primary usage because entry remains 0.1/0.2. Tradeoff assessed/accepted in [0.4 design input §I](../0.4/design-inputs/default-page.md#一背景为何把默认页改造从-03-抽出到-04); 0.4 starts immediately after launch without a large gap.

---

<a id="四版本更新"></a>

## IV. Version Updates

<a id="41-方案"></a>

### 4.1 Approach

- Use `electron-updater`
- Feed hosted on self-hosted servers
- Startup automatic checks + manual entry
- **Platforms**: macOS required; Windows contingent on §V-A EV lead time, decision at Week 1 end

<a id="42-审计标准"></a>

### 4.2 Audit Criteria

| # | Criterion | Verification | Priority |
|---|---------|---------|--------|
| UP1 | macOS startup shows update after new release | Publish → start old version → prompt | Required |
| UP1w | Windows startup update prompt | As UP1, Windows | Downgradable, §V-A EV |
| UP2 | Full macOS download → install → restart → new version | Complete flow, confirm version | Required |
| UP2w | Full Windows update | As UP2, Windows | Downgradable, §V-A EV |
| UP3 | Failed update leaves current app usable | Update offline, no crash | Required |

---

<a id="五安全机制"></a>

## V. Security

| Area | Measure | Criterion | Priority |
|------|------|---------|--------|
| Transport | TLS 1.3, no API Certificate Pinning, optional update pinning | Network capture shows no plaintext | Required |
| Auth | JWT + Refresh Token rotation | U5 | Required |
| API | Rate Limiting, CORS allowlist | Load triggers 429 | Required |
| Local storage | Token safeStorage encryption inherited from 0.1 | U4 | Required |
| Operations | Dependabot vulnerability scans | CI blocks high-risk vulnerabilities | Required |
| Compliance | **GDPR MVP**: Privacy Policy/ToS, signed DPA, outsourced EU Representative, EU opt-in (T3/AE2a), export/delete (DO2/DO3), SCC where applicable (S3) | Policy accessible, data deletion requestable, SCC visible | Required |

> **No API cert pinning rationale**: In Electron desktop apps, certificate rotation/CDN changes disconnect all clients; fixes require new releases, potentially deadlocking HTTPS updates. `electron-updater` signing already ensures package integrity; API pinning adds marginal value. Retain optional update-channel pinning only.
>
> **GDPR MVP boundary**: DPO selection, formal DPIA, lawyer-drafted documents **defer to 0.4/V1 scale triggers** (1k+ EU users or charging). ASCI currently does not meet Art.37 mandatory-DPO conditions (not public authority/large-scale monitoring/special-category data).

---

<a id="五-a发布前置事务lead-time-checklist"></a>

## V-A. Release Prerequisites (Lead-time Checklist)

> **Basis**: These are review/logistics/contract durations, not engineering effort. Without early starts the 2-week coding window is insufficient. Product/engineering Leads (@pantsbang-yannik / @lesterli) inventory/start this week.

<a id="五-a1-lead-time-事项清单"></a>

### V-A.1 Lead-time Items

| Item | Duration | Current state | Owner | 0.3 blocker |
|------|------|---------|--------|-------------|
| Apple Developer + macOS Notarization readiness | 3-7 days | ❓ Inventory pending | Dev D | Gatekeeper blocks package without approval |
| Windows EV Code Signing (USB hardware token) | **2-4 weeks** | ❓ Inventory pending | Dev D | Required by electron-updater; Windows cannot release without it. **Longest lead time, decisive for dual-platform launch; absent by Week 1 end → all Windows to 0.4, macOS only** |
| ORCID OAuth client_id (institution verification) | 1-2 weeks | ❓ Inventory pending | Dev D | ORCID unavailable, U1 fails |
| Google OAuth verification (email scope) | 2-4 weeks | ❓ Inventory pending | Dev D | Google shows unverified warning |
| Sender-domain SPF / DKIM / DMARC + email-provider verification | 1-2 weeks | ❓ Inventory pending | Dev D | Verification/reset lands in spam, S4 fails |

<a id="五-a2-盘点硬截止与审计"></a>

### V-A.2 Hard Inventory Deadline and Audit

| # | Criterion | Verification | Priority |
|---|---------|---------|--------|
| LT0 | **By 2026-06-08 (mid 0.2 Week 3), all 5 states move from pending to started/complete/unreachable-needs-downgrade**; delays trigger same-day downgrade assessment (Windows→0.4 / ORCID placeholder, etc.) | Review all 5 at mid-Week3 sync, record decisions in `docs/ops/release-readiness.md`, location created by Dev D | Required |
| LT1 | macOS Notarization yields usable package by 0.3 Week1 end, 2026-06-12 | Full sign+notarize creates double-clickable .dmg | Required |
| LT2 | Week1-end Windows EV decision: Ready→dual platform; otherwise §X.1 downgrade | Dev D reports physical token arrival + successful signing at sync | Required |
| LT3 | ORCID/Google verification + email-domain auth ready by mid-Week2, 2026-06-17, otherwise U1/U2/S4 downgrade assessment | Actual ORCID callback / no Google unverified warning / Gmail inbox rather than spam | Required |

> **Already decided, reference only**:
> - GitHub OAuth dropped, no lead-time item
> - Dual-node deferred 0.4; single node, ADR-002 region, EU preferred
> - Default-page §III-D deferred entirely
> - AE3/AE4 transparency deferred; 0.3.0 only Settings toggle
>
> **Week1-end decision**: Does EV progress permit dual-platform launch? Otherwise formally defer Windows to 0.4.

---

<a id="五-b公开发布运维-sop-&#45;整章推迟-04-&#45;v1"></a>

## V-B. Public-release Operations SOP — **Entire Chapter Deferred to 0.4 / V1**

> ⚠️ **2026-05-14 decision**: Originally planned SaaS-level Status page / on-call / incident SOP / P0 drills (OPS1-OPS5) in 0.3.0. **Entire chapter deferred to 0.4 or later**.
>
> **Reason**: ASCI ships a **desktop client**, not SaaS, and is **not open source**, so no public issue triage/community-maintainer SOP. Build SaaS-grade operations when server dependencies deepen (desktop↔Web sync, A2A, shared MCP) or user scale warrants it.
>
> **Minimum operations retained in 0.3.0**, already covered elsewhere:
>
> - **Automatic crashes**: §III T1/T4/T4a Sentry, no manual response needed
> - **Prerequisite inventory**: §V-A LT0–LT3 fixes readiness dates for Apple/Windows/OAuth/email
> - **Dependency scans**: §V Dependabot
>
> **Reevaluate 0.4/V1**: Status page, on-call, incident SOP, P0 drills, support channels. Minimal bug feedback (in-app email/private community/closed-source tracker) remains a product decision outside 0.3.0.

---

<a id="六数据所有权叙事护城河-p2"></a>

## VI. Data Ownership Narrative (Moat P2)

> Strategy: [moat-analysis.md](../0.2/moat-analysis.md) §4.3 🥉 P2: Turn local storage + open formats = your data stays yours from technical fact into user-visible value.

<a id="61-审计标准"></a>

### 6.1 Audit Criteria

| # | Criterion | Verification | Priority |
|---|---------|---------|--------|
| DO1 | Settings visualization of data location, paths/counts | Settings → Data Ownership shows `~/.asci/` and object counts | Required |
| DO2 | One-click full export to JSON conforming to [0.2 O1](../0.2/north-star.md#section-open-standard) | Export My Data → zip → `ajv` passes | Required |
| DO3 | One-click account deletion + server-data clearing (GDPR Art.17 right to information / erasure) | Delete → server user records cleared → local library retained for offline use | Required |
| DO4 | Welcome/landing copy states local-first + portability, no cloud-exclusive counter-narrative | Copy review | Required |

<a id="62-与护城河的关系"></a>

### 6.2 Relationship to the Moat

DO2 export = 0.2 O1 open JSON Schema, binding standards and ownership: Users take an industry-readable format, not a proprietary dump.

---

<a id="七用户激活路径护城河-p1"></a>

## VII. User Activation (Moat P1)

> Strategy: [moat-analysis.md](../0.2/moat-analysis.md) §4.3 🥈 P1: Cross L0 cold start, guide toward L3 data gravity.

<a id="71-激活路径定义"></a>

### 7.1 Activation Definition

| Level | User behavior | 0.3 guidance |
|------|---------|----------------|
| L0 | First search+review | Inherit 0.1, no new UI |
| L1 | Click review citation → Paper | Inherit 0.2 evidence viewer |
| L2 | First Paper Note | Bubble: "Thoughts on this passage? Write them down" |
| L3 | **First Agent Proposal decision**, one of `采纳` / `修改` / `拒绝` / `仅本对象不再提示（scoped）` / `不再提示这类（silence-this-kind）` (accept / modify / reject / silence for this object / silence this kind), naming aligned with [0.2 §I-A](../0.2/north-star.md#section-1a) | After L2, first details page with pending Proposals: "Agent identified candidates; see which are worth keeping" |

<a id="72-审计标准"></a>

### 7.2 Audit Criteria

| # | Criterion | Verification | Priority |
|---|---------|---------|--------|
| AC1 | Explicit first-use guidance for L0→L3, **L3 teaches any first Proposal decision**, implementing [0.2 §0](../0.2/north-star.md#section-zero); action names exactly match [§I-A](../0.2/north-star.md#section-1a): `采纳 / 修改 / 拒绝 / 仅本对象不再提示 / 不再提示这类` (accept/modify/reject/silence this object/silence this kind) | Fresh account sees each level's guidance; L3 on first details with pending Proposals; button-copy grep passes | Required |
| AC2 | PostHog (§III) tracks highest reached level | Query per-user `max_level` | Required |
| AC3 | ≥ 15% of registered users reach L3 within 2 weeks of public launch | PostHog first 14 days; observation baseline, nonblocking | Observe |

> **AC3 baseline**: 15% starting observation target reflects desktop ToC first-week activation experience (10-20%). 0.1/0.2 had only dogfood/small private testing, no public baseline. Two weeks post-launch feed formal 0.4 baseline. **Observation, not release gate**: Much lower results imply 0.4 iteration (L3 timing/action visibility/reasoning copy), not blocking 0.3.

---

<a id="八法律文本-&#45;国际化"></a>

## VIII. Legal Texts and Internationalization

| Deliverable | Description |
|------|------|
| Privacy Policy | Primarily English, GDPR data-processing explanations |
| Terms of Service | Primarily English |
| i18n | Inherit 0.1 C5, complete account UI translations |

> **Legal entity**: Final entity **does not block 0.3**; ToS may launch with placeholder. **Confirm within 30-90 days after release**, updating entity fields in ToS/Privacy Policy, or 0.4 has compliance exposure. Neo follows up personally.

---

<a id="九与-02-的关系"></a>

## IX. Relationship to 0.2

```
0.2 outputs                       0.3 consumption
──────────                        ──────────
Object model + storage protocol → Authenticated CRUD on users' own objects
Two validation applications     → Own evidence chains/notes (including hypothesis Notes) after login
Server prototype (Dev D)        → Production auth+user data+updates (single-node launch)
Local accountless state         → Account isolation, independent per-user data spaces
Agent extensibility + package contracts (A0/A3) → 2 launch packages (§III-C); review core complete, contract reconnection only
Package concept Spec + UI concepts (X1-X4) → Separate Configuration page + old Settings entry removed
Old configuration→package migration (X4) → Automatic 0.1 / 0.2 upgrade migration (CP4)
```

English rendering: 0.2 objects/storage → authenticated own-object CRUD; two validation apps → own evidence/notes including hypothesis Notes after login; Dev D prototype → production auth/user/update single node; local accountless state → isolated per-user spaces; A0/A3 extensibility/contracts → launch packages (§III-C), review core already complete and only reconnected; X1-X4 concepts/UI → independent Configuration/removal of old Settings; X4 migration → automatic old-user upgrade CP4.

0.2 object foundation underpins 0.3 data; 0.3 adds account isolation/server capabilities. D1-D3 first materialize in APIs reusing object JSON Schemas for requests/responses. §III-4 refactor/§III-5 concepts directly precede §III-C.

<a id="v1-路线图预留"></a>

### V1 Roadmap Reservations

```
0.2 / 0.3 design constraints       V1 consumption
─────────────────                 ──────────
Object JSON Schema (D1)          → MCP Server output format
ID references + parameterized queries (D2/D3) → A2A data exchange layer
PDF parsing cache               → Paper-search MCP acceleration
User accounts + data isolation  → A2A authentication foundation
```

English rendering: D1 object JSON Schema → MCP Server output; D2/D3 ID references + parameterized queries → A2A exchange; PDF cache → search MCP acceleration; accounts/isolation → A2A authentication.

---

<a id="十03-不做的事"></a>

## X. Exclusions from 0.3

> Three nonoverlapping tables/lists: **§X.1** 2026-05-12 decisions (scope reductions + parallel adjustments); **§X.2** V1/V2 roadmap; **§X.3** confirmed 0.4 deferrals.

<a id="十1-030-范围决策表2026-05-12"></a>

### X.1 0.3.0 Scope Decisions (2026-05-12)

> Formally removed from 0.3.0 scope, not vague future exclusions; public release follows this scope and no longer treats these as delivery risks.

| Item | Original plan | Decision | Type | Destination |
|---|--------|--------|-----|------|
| Default-page §III-D, all DH1-DH4 | Required | Entirely defer; retain old entries | Scope reduction | [0.4 input](../0.4/design-inputs/default-page.md) |
| Dual-node S5 | Required, old S1 | Single node; ADR-002 region, EU preferred | Scope reduction | 0.4 |
| GitHub OAuth | Required | Drop; only Email/Google/ORCID, no lead-time item | Scope reduction | 0.4 feedback |
| Self-evolution transparency AE3 weekly/clear, AE4 first-task popup | Required | Settings toggle AE2/AE2a only; all 6 signals AE1/AE1a | Scope reduction | 0.4 |
| Windows launch | Required | EV-contingent §V-A, Week1-end decision | Conditional reduction | 0.4 if EV late |
| Operations §V-B, OPS1-OPS5 | Required | **Entire chapter deferred**: Desktop, closed-source, no SaaS Status/on-call/incident/P0 drills in 0.3.0 | Scope reduction | 0.4/V1 server-dependency/scale triggers |
| 0.2/0.3 overlapping weeks | — | Start 0.3 server skeleton/account spike in 0.2 Week3, consuming serial lead times early | Parallel adjustment | 0.2 Week3 onward |
| Review-package effort | Rebuild in 0.3.0 | Core complete 0.1/0.2 ([ownership](../0.2/north-star.md#section-3-2)); only contracts + registration | Parallel adjustment | §III-C.1 |

<a id="十2-一直不做v1-&#45;v2-路线图"></a>

### X.2 Always Excluded Here (V1 / V2 Roadmap)

- No OPENSCI OAuth linking (reserved field only)
- No desktop↔Web sync (reserved API only)
- No Web version
- No full multi-Agent collaborative orchestration (V1)
- No plugin marketplace / developer docs (V2)

<a id="十3-03-不做推迟到-04"></a>

### X.3 Not in 0.3, Deferred to 0.4

- **Deeper GDPR**: DPO/formal DPIA/lawyer documents, 0.4/V1 scale triggers (1k+ EU users or charging)
- **Automatic tuning**: Collect-only in 0.3 (§III-A consumption table); tuning/RAG injection/weights deferred 0.4
- **Federated/local small models**: Deferred with tuning
- **Personalized package recommendations**: Implementation/configuration/install entry in §III-C; smart defaults/remote discovery/third-party review deferred
- **Marketplace/third-party uploads**: §III-C.5

> **Specific 0.4 scope**: Product/engineering Lead and strategy assessment confirm during 0.3 Week2, then separate `ya-docs/milestones/0.4/north-star.md`. Current candidates: [default page §III-D](../0.4/design-inputs/default-page.md), dual-node S5, AE3/AE4 transparency, Windows updates if delayed, GitHub OAuth per feedback, **framework-library extension** (multi-framework registry/package selection supporting writing/experiment logs/data analysis layouts).

---

<a id="adr-002服务器后端栈选型"></a>

# ADR-002: Server Backend Stack Selection

| Field | Content |
|------|------|
| **Status** | Proposed |
| **Hard decision deadline** | Before 0.3 starts (end of 0.2 Week 1) |
| **Decision date** | (to be filled) |
| **Decision maker** | (to be filled; product/engineering Lead recommended) |
| **Author** | (to be filled; Dev D recommended) |
| **Related** | [0.2 north-star §VI F1](../../ya-docs/milestones/0.2/north-star.md) / [0.3 north-star §II](../../ya-docs/milestones/0.3/north-star.md) |

---

<a id="一背景"></a>

## I. Background

The 0.3 milestone introduces ASCI's independent account system and public release, requiring a custom server (authentication / user data / telemetry ingestion / version updates). This ADR decides 4 backend-stack dimensions + node location. Once signed, its conclusion governs 0.3 implementation; changes require ADR revision.

**Terminology**: “custom server” here means **writing our own backend code**, rather than avoiding AWS / GCP or other clouds. The 0.3 server will run on public cloud; decisions concern the implementation stack, cloud, and SaaS vs custom authentication.

**0.3.0 scope decisions (locked in 0.3 north-star §II / §X; binding on this ADR)**:
- **Single-node launch**; Europe/US dual-node routing deferred to 0.4
- This ADR decides node location (0.3 north-star favors the EU for consistent compliance, avoiding SCC dependence for EU users, and naturally keeping all user data in the EU)
- Database: PostgreSQL (locked; dimension ② decides only which PG service)
- API protocol: REST + JSON (locked)
- Closed-source server code in a separate repository with independent CI/CD

---

<a id="二决策粒度"></a>

## II. Decision Dimensions

<a id="-部署平台"></a>

### ① Deployment Platform

**Candidates**: AWS / GCP / Hetzner / DigitalOcean

**Key criteria**:
- GDPR data sovereignty (lawful operation after selecting the launch node location)
- Europe/US dual-node capability (0.3.0 launches one node; platform must support two for 0.4)
- Monthly cost (estimated launch users <1k, annual TCO)

<a id="-数据库"></a>

### ② Database

**Candidates**: AWS RDS / Neon / Supabase (DB only) / self-managed PG

**Key criteria**:
- Managed fees vs operations cost
- Compatibility with ① deployment platform (low same-cloud internal network latency)
- Backup / restore SOP complexity
- Data processors in Privacy Policy (subprocessor list)

<a id="-认证策略"></a>

### ③ Authentication Strategy

**Candidates**: custom / Auth0 / Clerk / WorkOS

**Key criteria**:
- ORCID integration cost (0.3 must support ORCID OAuth, a nondefault provider; compare custom OAuth integration difficulty)
- Monthly pricing thresholds (Auth0 free tier ends after 7000 MAU; other providers' pricing models)
- 0.3.0 already removed GitHub OAuth; only Google + ORCID + Email/Password needed
- Refresh Token rotation / safeStorage encryption integration complexity (U4 / U5 audit requirements)

<a id="-应用层框架"></a>

### ④ Application Framework

**Candidates**: Bun + Hono / Go + Gin / Node + Fastify

**Key criteria**:
- Team learning cost (desktop currently uses Bun + TypeScript; server reuse vs a new stack)
- 0.3 time window (approximately 2 weeks coding, including 1 overlapping week at the end of 0.2)
- Performance (authentication 99.5% availability + 1000 concurrent logins, see S2)
- ORM / client ecosystem maturity for database ②

---

<a id="三调研与评估"></a>

## III. Research and Evaluation

<a id="-部署平台-1"></a>

### ① Deployment Platform

| Candidate | Estimated annual TCO | Advantages | Disadvantages | Decision basis |
|------|-------------|------|------|---------|
| AWS | (to be filled) | (to be filled) | (to be filled) | (to be filled) |
| GCP | (to be filled) | (to be filled) | (to be filled) | (to be filled) |
| Hetzner | (to be filled) | (to be filled) | (to be filled) | (to be filled) |
| DigitalOcean | (to be filled) | (to be filled) | (to be filled) | (to be filled) |

<a id="-数据库-1"></a>

### ② Database

| Candidate | Estimated annual TCO | Advantages | Disadvantages | Decision basis |
|------|-------------|------|------|---------|
| AWS RDS | (to be filled) | (to be filled) | (to be filled) | (to be filled) |
| Neon | (to be filled) | (to be filled) | (to be filled) | (to be filled) |
| Supabase (DB only) | (to be filled) | (to be filled) | (to be filled) | (to be filled) |
| Self-managed PG | (to be filled) | (to be filled) | (to be filled) | (to be filled) |

<a id="-认证策略-1"></a>

### ③ Authentication Strategy

| Candidate | Estimated annual TCO | ORCID integration cost | Monthly pricing threshold | Decision basis |
|------|-------------|---------------|----------|---------|
| Custom | (to be filled) | (to be filled) | N/A | (to be filled) |
| Auth0 | (to be filled) | (to be filled) | Free tier ends after 7000 MAU | (to be filled) |
| Clerk | (to be filled) | (to be filled) | (to be filled) | (to be filled) |
| WorkOS | (to be filled) | (to be filled) | (to be filled) | (to be filled) |

<a id="-应用层框架-1"></a>

### ④ Application Framework

| Candidate | Advantages | Disadvantages | Decision basis |
|------|------|------|---------|
| Bun + Hono | (to be filled) | (to be filled) | (to be filled) |
| Go + Gin | (to be filled) | (to be filled) | (to be filled) |
| Node + Fastify | (to be filled) | (to be filled) | (to be filled) |

---

<a id="四已排除方案"></a>

## IV. Excluded Options

> 0.2 north-star §VI F1 states that Firebase / Supabase full-stack BaaS can generally be excluded in §3 due to GDPR sovereignty + ORCID absent from default providers + local-first architecture, but reasons must be recorded.

<a id="firebase-全栈"></a>

### Firebase Full Stack
- **Reason for exclusion**: (to be filled—consider GDPR data sovereignty, ORCID integration, fit with local-first architecture)

<a id="supabase-全栈包含-auth-&#45;db-&#45;storage"></a>

### Supabase Full Stack (Auth + DB + Storage)
- **Reason for exclusion**: (to be filled—distinguish from using Supabase solely as a DB provider; the former binds Supabase Auth, the latter uses only PG)

---

<a id="五决策"></a>

## V. Decision

> Dev D to fill after research + review.

<a id="拍板结论"></a>

### Final Decision

| Dimension | Decision | Main rationale |
|------|------|---------|
| ① Deployment platform | (to be filled) | (to be filled) |
| ② Database | (to be filled) | (to be filled) |
| ③ Authentication strategy | (to be filled) | (to be filled) |
| ④ Application framework | (to be filled) | (to be filled) |
| **Node location (0.3.0 launch)** | (to be filled; EU recommended) | (to be filled) |

<a id="与-五-a-发布前置事务的关联"></a>

### Relationship to §V-A Release Prerequisites

After this ADR is decided, owners of the following §V-A items must start immediately:

- Apple Developer + macOS Notarization (independent of node location, but related to ④ framework deployment targets)
- ORCID OAuth client_id application (depends on ③ authentication strategy: Auth0/Clerk configures clients in SaaS consoles; custom authentication requires ASCI to apply directly to ORCID)
- Google OAuth verification (same as above)
- Sending-domain SPF / DKIM / DMARC + email provider verification (independent of this ADR)

---

<a id="六后果"></a>

## VI. Consequences

<a id="正向后果"></a>

### Positive Consequences
(to be filled)

<a id="负向后果-&#45;风险"></a>

### Negative Consequences / Risks
(to be filled)

<a id="后续动作"></a>

### Follow-up Actions

- [ ] Create server repository (sciops OPS process; permissions / branch protection / secrets policy / CODEOWNERS)
- [ ] Configure CI/CD
- [ ] Start §V-A lead-time tasks (per dimension ③'s decision)
- [ ] Update §V GDPR MVP DPA subprocessor list (per providers chosen in ① ② ③)
- [ ] (to be filled)

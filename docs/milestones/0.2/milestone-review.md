<a id="0203-里程碑战略评价"></a>

# 0.2/0.3 Milestone Strategic Review

**Reviewer**: Tiger Nick (strategist)
**Date**: 2026-04-28
**Method**: SWOT + six-dimensional AI project feasibility + CLEAR + AI lifecycle

---

<a id="一战略定位判断"></a>

## I. Strategic Positioning

ASCI is transitioning from **POC → Pilot**:

- 0.1 verified the technical feasibility of search→review (POC complete)
- 0.2/0.3 aim to turn verified laboratory capability into a product usable by real users
- This matches AI-roadmap progression from POC to Pilot

**Conclusion**: positioning is correct: 0.2 builds foundations, 0.3 releases; two versions reduce per-release risk.

---

<a id="二ai-项目可行性六维评估"></a>

## II. Six-Dimensional AI Project Feasibility

| Dimension | 0.2 (object foundation) | 0.3 (user system + release) | Assessment |
|------|---------|---------|------|
| **Business value** | ✅ High. Object model accumulates 0.1 outputs, forming ASCI's moat | ✅ High. Accounts prerequisite for Web and data collection | Both target core value |
| **Data readiness** | ✅ Local-first, no data dependencies | ✅ PostgreSQL, structured user data | Clear data path |
| **Technical feasibility** | ✅ Familiar TypeScript + Electron | ⚠️ New server stack needed (research pending) | 0.3 server choice is a variable |
| **Team capability** | ✅ Frontend-focused, 4 AI Native people | ⚠️ Backend/DevOps capability needs validation | 0.3 demands more of the team |
| **Compliance** | ✅ Entirely local, no exposure | ⚠️ Full GDPR includes appointing a DPO; 3 weeks is tight | 0.3 compliance is challenging |
| **Budget** | ✅ Zero server costs | ⚠️ EU/US nodes + email + Sentry + PostHog; assess monthly costs | Recurring operations costs begin in 0.3 |

**Overall**: 0.2 = **Go** (local, controlled risk); 0.3 = **Conditional Go** (confirm after server selection; start GDPR early, before Week 2)

---

<a id="三swot-交叉矩阵"></a>

## III. SWOT Cross-Matrix

<a id="strengths内部优势"></a>

### Strengths (Internal)
- S1: 4-person AI Native team, fast product/engineering execution
- S2: 0.1 verified the core search+review chain
- S3: Mature Electron stack and working packaging/release path
- S4: Strong Monorepo engineering (typecheck/test/build throughout)

<a id="weaknesses内部劣势"></a>

### Weaknesses (Internal)
- W1: Lacking backend/DevOps experience (first server in 0.3)
- W2: No GDPR experience; external resources needed
- W3: Gap between 0.2 and 0.3 may let competitors launch first

<a id="opportunities外部机会"></a>

### Opportunities (External)
- O1: No research AI product yet integrates search+review+object management
- O2: ORCID widely used by researchers, low OAuth integration barrier
- O3: Improving OpenAI/Anthropic Agent capabilities benefit ASCI as host

<a id="threats外部威胁"></a>

### Threats (External)
- T1: Elicit/Semantic Scholar/Consensus may quickly add object capabilities
- T2: Stricter EU AI Act regulation raises compliance costs
- T3: LLM API cost fluctuations affect inference-cost structure

<a id="交叉矩阵"></a>

### Cross-Matrix

| Combination | Strategy | Action |
|------|------|------|
| **S+O (build)** | Use ASIC speed to complete search+review+objects before competitors | Keep the reasonable 5.5-week 0.2/0.3 cadence |
| **W+O (strengthen)** | ORCID integration necessity drives backend capability | Dev D's 0.2 server research must yield a definite stack choice |
| **S+T (defend)** | Object model makes accumulated research context hard to copy | Open extensibility beyond papers offers long-term differentiation |
| **W+T (retreat/pivot)** | If GDPR blocks progress, consider launching 0.3 outside the EU first | Not recommended; harms international positioning. Start compliance early |

---

<a id="四02-版本逐项评价"></a>

## IV. Itemized 0.2 Review

<a id="整体判断-范围合理审计标准可验证"></a>

### Overall: ✅ Reasonable Scope, Verifiable Audit Criteria

**What works**:

1. **Clean object-foundation scope**. 6 core objects + 3 protocols + 3 validation apps, local with no external dependencies, naturally deliverable independently. Good release partitioning.

2. **Verifiable audit criteria**. Every V1-V9 criterion is can/cannot or visible/invisible, matching North Star audit principles.

3. **Clear dependencies**. Evidence-chain viewer → notes panel → hypothesis tracker, P0→P1→P2; cut P2 if needed to preserve P0+P1.

4. **Good version integration**. Clear 0.2 → 0.3 data flow (object foundation + account isolation → independent user data spaces); Dev D's parallel server research does not block delivery.

**Potential risks**:

- **Storage protocol engineering is unspecified**. P1-P3 describe protocols but not a storage backend (JSON files? SQLite? custom format?), affecting V9 large-data queries. `[推断]` (inference) Specify this in the technical design.
- **No direct CitationRelation validation in 0.2**. It is the only one of 6 objects without a validation app. Explicitly include it in V2 (Paper detail lists CitationRelations), or acknowledge modeling without validation.
- **Sidebar notes entry (V6a/V6b) is undervalued**. It validates cross-object Note queries and thus P3 (query without traversal) early, beyond UI. Mark it as preliminary P3 validation.

**Suggested adjustments**:
1. Explicitly include CitationRelation visibility in V2
2. Add “indirect P3 validation (cross-object Note queries)” to notes-panel dependencies

---

<a id="五03-版本逐项评价"></a>

## V. Itemized 0.3 Review

<a id="整体判断️-范围偏激进建议做风险缓冲"></a>

### Overall: ⚠️ Aggressive Scope; Add Risk Buffer

**What works**:

1. **Restrained accounts**. Email + three OAuth providers; reserve OPENSCI fields without binding. Good scope control.

2. **Specific audits**. U1-U5 cover multiple OAuth bindings (U3, bug-prone) and Token security (U4/U5), without gaps.

3. **Clear exclusions**. Web, sync, and OPENSCI binding are excluded, preventing creep.

4. **Concrete GDPR architecture**. EU/US nodes and no cross-border data (S3) provide minimal viable technical architecture.

5. **Clear telemetry layers**. Sentry crashes vs PostHog product analytics; T3 opt-out is key to GDPR.

**Key risks**:

1. **3 weeks is too tight for full GDPR**. DPO appointment (external/internal training), legal DPA review, and consent UI take time. `[推断]` (inference) Start DPO selection and DPA drafting in Week 1, not Week 2.

2. **Three OAuth debugging cycles underestimated**. Provider reviews differ (Google callback-domain verification, ORCID institutional verification) and exceed purely controllable development time.

3. **Server selection depends on 0.2**. Dev D's research directly affects 0.3. If Go + Gin wins (unfamiliar), learning consumes 0.3 time. Decide in 0.2 Week 1.

4. **Email absent from audits**. Registration/password reset (U2) needs email, but service choice/reliability is unspecified. This is a single failure point: unsent email breaks registration.

**Suggested additions**:
- Add **S4**: “verification/password-reset emails arrive within 30 seconds, delivery rate > 99%”
- Decide server stack by end of 0.2 Week 1 for maximum 0.3 buffer
- Start DPO selection/DPA drafting during 0.2 (Dev D can also own this)

---

<a id="六asci-战略方向贴合度"></a>

## VI. Alignment with ASCI Strategy

Against ASCI's long-term positioning (“a deep Agent desktop app for researchers”):

| Strategic dimension | 0.2/0.3 contribution | Score |
|---------|---------------|------|
| **Research depth** | Paper/Evidence/Hypothesis objects directly serve research workflows | ⭐⭐⭐⭐⭐ |
| **Agent native** | Object model underpins Agent operations; Notes share context with users | ⭐⭐⭐⭐ |
| **Accumulation** | P1 append without overwrite, P2 reference without copy preserve asset growth | ⭐⭐⭐⭐⭐ |
| **Internationalization** | 0.3 multilingual + GDPR + EU/US nodes for global researchers | ⭐⭐⭐⭐ |
| **Open ecosystem** | Reserved OPENSCI binding/Web sync interfaces; excluded now but right direction | ⭐⭐⭐ |

**Deviation**: 0.2/0.3 omit multi-Agent orchestration, central to V1. Explicit exclusion makes this deliberate rather than overlooked. Establishing single-user+single-Agent data first, then multi-Agent collaboration in V1, is reasonable.

---

<a id="七clear-五维评估"></a>

## VII. Five-Dimensional CLEAR Assessment

Research-tool weights: C=0.15, L=0.2, E=0.3, A=0.2, R=0.15 (quality first, then cost):

| Dimension | 0.2 | 0.3 | Assessment |
|------|-----|-----|------|
| **Cost** | 🟢 Full marks. Local, zero server cost | 🟡 EU/US nodes + SaaS, quantify costs | 0.3 research needs TCO estimate |
| **Latency** | 🟢 Negligible local latency | 🟡 Network auth/data, watch P95 | S2 tests concurrency, not latency |
| **Efficacy** | 🟢 V1-V9 cover core paths | 🟢 U1-U5 + T1-T4 cover auth/telemetry | Missing end-to-end UX tests |
| **Assurance** | 🟢 Local, TLS irrelevant | 🟡 GDPR depth depends on 3-week execution | See section VII risk 1 |
| **Reliability** | 🟢 Local, no network reliance | 🟡 OAuth depends on third parties | Add OAuth Provider fallback policy |

**Overall CLEAR**: 0.2 = 🟢 high confidence; 0.3 = 🟡 medium confidence (server selection and GDPR execution dependent)

---

<a id="八战略建议"></a>

## VIII. Strategic Suggestions

<a id="保持的"></a>

### Retain
1. Clear, reasonable 0.2/0.3 split (object foundation → public release)
2. Audit-driven, binary-verifiable criteria
3. Exclusion lists preventing scope creep

<a id="需要调整的"></a>

### Adjust
1. **0.2**: V2 covers CitationRelation; notes panel marked preliminary P3 validation
2. **0.3**: add S4 email delivery; start GDPR during 0.2
3. **Accelerate server selection**: conclusions in 0.2 Week 1, not Week 2

<a id="长期战略方向的确认"></a>

### Confirm Long-Term Direction
The 0.1→0.2→0.3 path is correct: **first researchers can trust it (0.1), then research can accumulate (0.2), then the product can distribute (0.3)**. Together they form a complete trust-infrastructure stack.

Exclusions matter equally: Web, multi-Agent collaboration, and plugin marketplace deferred to V1/V2. Such restraint is rare and correct in AI projects. Excessive scope is the leading failure cause; ASCI's roadmap avoids it effectively.

---

<a id="九总结"></a>

## IX. Summary

| Dimension | Assessment |
|------|------|
| **Strategy** | 🟢 Correct. 0.1→0.2→0.3 forms complete trust infrastructure |
| **Version split** | 🟢 Reasonable. 0.2 independently local, 0.3 adds server capabilities |
| **Scope control** | 🟢 Restrained. Explicit exclusions remove all unnecessary items |
| **Audits** | 🟢 Verifiable. All binary judgments |
| **0.2 risk** | 🟢 Low. Local, familiar stack |
| **0.3 risk** | 🟡 Medium. Server selection + GDPR + third-party OAuth review cycles |
| **Key suggestions** | Server choice in 0.2 Week 1; earlier GDPR; add CitationRelation validation |

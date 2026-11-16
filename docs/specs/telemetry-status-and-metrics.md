<a id="埋点能力现状-&#45;目标看板指标对照"></a>

# Current instrumentation capabilities × target dashboard metrics

> **Status**: Current-state inventory (against 0.3.0 milestone instrumentation issues and dashboard targets)
> **Related issues**: [#416](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/416) Sentry · [#426](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/426) PostHog behavior · [#427](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/427) Self-evolution signals
> **Related documents**: [ADR-011 Telemetry architecture](../adr/ADR-011-telemetry-architecture.md) · [telemetry-spec](./telemetry-spec.md) · `~/Downloads/埋点/格物0.3-PostHog埋点Spec-v0.4.3.md` (dashboard target Spec, 38 events)
> **Current data source**: PostHog Cloud EU, distinct_id = local anonymous deviceId (#420 login not implemented, no account attribution yet)

---

<a id="一三个-issue-的实现状态"></a>

## 1. Implementation status of the three issues

| Issue | Content | Status | Notes |
|-------|------|------|------|
| **#416** | Sentry crash reporting + redaction | ✅ **Supported** | main+renderer processes, beforeSend redaction (email/IP/path username segments); DSN configured |
| **#426** | PostHog behavior instrumentation + Data Collection tab + regional opt-in/out | 🟡 **Partially supported** | Architecture + 6 events + consent tab + timezone-region determination implemented; event list far short of dashboard needs (6 vs 38) |
| **#427** | 5 self-evolution signal kinds + separate channel + toggle | 🟡 **Partially supported** | Schema + collection + local JSONL + toggle implemented; **reporting channel awaits backend (ADR-002 undecided)**, and uses a separate channel outside PostHog |

---

<a id="二当前已上报的数据事实清单"></a>

## 2. Data currently reported (fact inventory)

<a id="21-posthog-行为事件6-个-进-posthog可做看板"></a>

### 2.1 PostHog behavior events (6) → sent to PostHog, usable for dashboards

| Event | Properties | Trigger |
|------|------|--------|
| `app_launched` | `appVersion` / `platform` / `uiLocale` | Main-process app ready |
| `profile_created` | (empty) | First local profile creation |
| `login_completed` | (empty, **unwired placeholder**) | Awaiting #420 login |
| `search_executed` | `source` / `resultCount` / `durationMs` / `success` | Search results persisted |
| `review_generated` | `paperCount` / `durationMs` / `success` | Review successfully materialized |
| `agent_task_completed` | `numTurns` / `durationMs` / `success` / `resultSubtype` / `modelId` / `channelType` | One runAgent finishes |

**Common dimensions**: `distinct_id` = account uid after login (OPENSCI uid, #420), anonymous deviceId fallback when logged out.
**Account attribution wired** (successful login `$identify` merges anonymous history + `$set` person properties `institution` / `discipline` / `signup_method`). Still missing: `current_activation_level` / `pmf_status` / `install_source` (funnel/recall events, separate discussion).

<a id="22-自进化信号5-类-&#45;隐式反馈-走独立通道不进-posthog"></a>

### 2.2 Self-evolution signals (5 kinds + implicit feedback) → separate channel, **outside PostHog**

Persist locally at `~/.asci/telemetry/signals.jsonl`; no external sending without endpoint configuration (backend not built).

| kind | Fields |
|------|------|
| `task_structure` | promptChars / attachmentCount / mentionedSkillCount / numTurns / durationMs / success |
| `tool_usage` | toolName / success / durationMs |
| `model_choice` | modelId / channelType |
| `error_event` | stage / message (redacted) / retryable |
| `workspace_structure` | workspaceHash / sessionCount / paperCount / noteCount |
| `implicit_feedback` | action(copy/save/cite/discard/retry) / target |

<a id="23-sentry-&#45;崩溃异常-&#45;堆栈脱敏"></a>

### 2.3 Sentry → crashes/exceptions + stacks (redacted)

---

<a id="三目标看板指标-&#45;能否算出-&#45;如何加工"></a>

## 3. Target dashboard metrics × calculability × processing

Targets = the 8 dashboards in `格物0.3-数据看板预览` (Gewu 0.3 dashboard preview). The table groups targets by whether existing data supports them.

<a id="-a-现在就能算用已上报的-6-事件-&#45;sentry"></a>

### ✅ A. Calculable now (using the 6 reported events + Sentry)

| Target metric | Source | PostHog processing |
|----------|--------|------------------|
| DAU / WAU / MAU | `app_launched` | Trends → unique users (deduplicate distinct_id), daily/weekly/monthly |
| Version / platform / language distribution | `app_launched.appVersion/platform/uiLocale` | Trends breakdown by property |
| Search count / success rate | `search_executed` (+`success`) | Trends total + `success=true` proportion |
| Search source distribution | `search_executed.source` | breakdown by source |
| **Search TTLT P90** (§9.3) | `search_executed.durationMs` | Trends → numeric property P90 (search is nonstreaming, so durationMs is TTLT) ✅ Exact match |
| Review count / success rate | `review_generated` (+`success`) | Same as above |
| Review paper-count distribution | `review_generated.paperCount` | Histogram / average |
| **Review TTLT P90** (§9.3) | `review_generated.durationMs` | P90 (≈total duration; see approximation caveat below) |
| Agent task volume / success rate / turns | `agent_task_completed` | Trends + breakdown |
| **Model-selection distribution** (§9.8 single dimension) | `agent_task_completed.modelId` / `channelType` | breakdown by modelId |
| Crash count / rate / by version and platform | Sentry | Sentry Issues + release/tag dimensions |

<a id="-b-部分能算-&#45;只能近似缺分层或精确字段"></a>

### 🟡 B. Partially calculable / approximate only (missing segmentation or exact fields)

| Target metric | Current state | Gap |
|----------|------|------|
| Overall retention (D1/D7/D30) | `app_launched` supports PostHog Retention | ✅ Overall retention possible; **cannot segment by L0/L2/L3** (§9.2 retention comparison unavailable, missing `current_activation_level`) |
| Activation funnel (coarse) | `profile_created → search_executed → review_generated` supports a 3-step funnel | **Not the §9.1 L0→L3 ladder**: missing deduplicated `first_l{n}_reached` derivations and L2 (write Note)/L3 (create EvidenceSet) events; existing steps can count repeatedly, not first achievement |
| Review TTLT | `review_generated.durationMs` | Whether it strictly equals submission→all tokens depends on instrumentation placement and needs checking; currently review materialization duration, potentially including persistence |
| Approximate new users | `profile_created` | Not real signup (#420 login unimplemented); after login use `login_completed` + account distinct_id |

<a id="-c-现在算不出缺事件-&#45;缺字段-&#45;缺后端"></a>

### ❌ C. Not calculable now (missing events / fields / backend)

| Target dashboard / metric | Missing | Events or fields to add |
|----------------|--------|------------------|
| **§9.1 L0→L3 ladder funnel** | Ladder derivations + L2/L3 actions | `first_l0/l2/l3_reached` (deduplicated derivations), `note_created`, `evidence_set_created`, `current_activation_level` (person prop) |
| **§9.2 Ladder retention comparison** | Segmentation dimension | person property `current_activation_level` |
| **§9.3 False-success rate** ⭐ | Output quality determination | Add `output_complete` + `claim_count` / `cited_paper_count` to `review_generated`; `skill_execution_incomplete` (H2) + `incompleteness_type` |
| **§9.3 Review TTFT P90** ⭐ | First-token timestamp | New event `synthesis_first_token_received.ttft_ms` (currently only full durationMs, no first token) |
| **§9.3 Review abandonment / routing accuracy / report delivery rates** | Corresponding events | `synthesis_abandoned`, skill routing events (H1), `*_report_rendered` |
| **§9.4 L2 bubble A/B** | Experiment framework | `note_prompt_shown` + `experiment_exposed` + PostHog Feature Flags integration |
| **§9.5 Acquisition channels / Referral** | Acquisition + invitations | person `install_source`, `invite_sent/accepted` (group I) |
| **§9.6 Recall / PMF** | Group J | `inactive_user_detected` / `recall_message_*` / `pmf_survey_answered` + person `pmf_status` |
| **§9.7 Workflow loop closure (reuse/second invocation/scatter)** | Cross-period references + backend | `seeded_from_*` / `references_*` / `source_note_ids` / `evidence_set_opened` + **server-side 24h cross-period join** (ADR-002 backend not built) |
| **§9.8 Output evaluation (up/down votes, two dimensions)** | Claim-level feedback | `claim_feedback` (N1/N2) + `workflow_path` dimension (currently modelId only, no workflow_path or claim-level votes) |
| **Any breakdown by discipline/source/signup method** | person properties | `identify` + install_source / discipline / signup_method |
| **Implicit feedback on dashboards** | Channel mismatch | Existing `implicit_feedback` uses self-evolution channel (local JSONL), **outside PostHog**; dashboard use requires another PostHog event or connected self-evolution backend |

---

<a id="四关键结论与差距根因"></a>

## 4. Key conclusions and root causes of gaps

1. **Immediately available dashboards**: Basic health (DAU/WAU, search/review/task volumes and success, search TTLT, model distribution, crash rate), configurable in PostHog using existing 6 events + Sentry.
2. **Most advanced dashboards lack events**: Current 6 behavior events vs Spec target 38 + 3 derived events. Funnels (L0-L3), segmented retention, false-success rate, TTFT, A/B, Referral, PMF, and output evaluation **all lack corresponding events/fields**.
3. **Three structural root causes**:
   - **No person properties / account attribution**: distinct_id remains anonymous deviceId (#420 login unimplemented), preventing account deduplication, `current_activation_level` segmentation, and discipline/source breakdowns.
   - **§9.7 loop closure strongly depends on backend**: PostHog cannot natively perform 24h cross-period joins / `is_cross_session` derivation; depends on ADR-002 server stack (undecided).
   - **Self-evolution signals isolated from PostHog**: Implicit feedback lives in the self-evolution channel (local JSONL, backend not built), inaccessible to the current PostHog dashboard.

---

<a id="五要补齐到目标按优先级的工作项"></a>

## 5. Prioritized work to reach targets

1. **Wire person properties + login attribution** (depends on #420): `identify` + install_source/discipline/signup_method/current_activation_level → enables retention segments, funnel deduplication, breakdowns.
2. **Expand PostHog events (6 → core Spec groups A/B/C/D/E/F/H)**: Add `first_l{n}_reached`, `note_created`, `evidence_set_created`, `synthesis_first_token_received`, `synthesis_abandoned`, skill routing/delivery events, and `output_complete`/`claim_count` on `review_generated` (false-success rate).
3. **A/B (§9.4)**: Integrate Feature Flags + `experiment_exposed` (0.3 Spec marks W3; may defer).
4. **Loop closure (§9.7)**: Await ADR-002 backend; add `seeded_from_*`/`references_*`/`evidence_set_opened` + server-side cross-period joins.
5. **Referral/PMF/recall (§9.5/9.6)**: Deferred in 0.3 (explicit in Spec).

> Detailed event fields follow `格物0.3-PostHog埋点Spec-v0.4.3.md` (Gewu 0.3 PostHog instrumentation Spec); this table only compares current state → target gaps.

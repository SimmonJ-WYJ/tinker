<a id="能力包概念-speccapability-package-concept-specification"></a>

# Capability Package Concept Spec (Capability Package Concept Specification)

> **Status**: Draft · Awaiting review
> **Audit criterion**: 0.2 §III-4 X2
> **Related issue**: #231 (E-4)
> **Input dependencies**: E-1 (#218) interview checklist · lit-search / lit-review scenario Agent orchestration descriptions (original sources absorbed into `docs/milestones/0.2/2026-05-23-agent-and-capability-pack-spec.md` §5.3/§5.4 and removed)
> **Blocks**: D-4 (#239) schema implementation · E-5 (#236) UI concept · E-6 (#240) migration plan

---

<a id="1-概述与定位"></a>

## 1. Overview and Positioning

<a id="11-什么是能力包"></a>

### 1.1 What Is a Capability Package?

A **Capability Package** is ASCI's smallest releasable unit delivering a user-assignable task capability.

Current configuration/scenarios resemble a Coding Agent: Users configure MCP, Skills, and provider models separately. Packages bundle infrastructure into understandable task domains (search/review/writing/experiments...), enabling **task assignment to the Agent after one-click installation**.

Core formula:

```
Capability package = scenario Agent settings + Skill references + MCP references + UI framework/render configuration
                   + capabilities.proposals[] (byproduct contract, delivered in v0.3)
```

English formula: Package = scenario Agent settings + Skill references + MCP references + UI framework/render configuration + capabilities.proposals[] (byproduct contract delivered in v0.3).

<a id="12-与-skill-的关系"></a>

### 1.2 Relationship to Skills

| Dimension | Skill | Capability package |
|------|-------|--------|
| Granularity | One capability fragment (SKILL.md + implementation) | Complete task-domain solution |
| Mental model | A screwdriver in a toolbox | A complete workbench |
| Composition | Referenced by packages or independently enabled | Multiple Skills + MCPs in a pipeline |
| Agent interaction | Selected by Agent for matching relevance | Own scenario Agent defining complete conversation topology |
| User perspective | Advanced users manage in settings | All users browse/install/manage on Configuration page |

> **Design criterion**: Users distinguish "system parameters vs Agent capabilities" within 30 seconds (X1.2; retain separation only if accuracy ≥ 60%).

<a id="13-不做的事non-scope"></a>

### 1.3 Non-scope

- Package marketplace / third-party extensions (0.4+)
- Automatic package upgrades (0.4+)
- Inter-package dependency resolution (conceptual reservation in 0.2; 0.3 launch packages independent)
- Non-TypeScript packages (evaluate Python, etc. in 0.4+)

---

<a id="2-命名与粒度"></a>

## 2. Naming and Granularity

<a id="21-包-id-命名规范"></a>

### 2.1 Package ID Convention

```
<scope>.<category>.<name>

Examples:
  asci.builtin.lit-search    ← Built-in literature search package
  asci.builtin.lit-review    ← Built-in literature review package
  asci.community.writing     ← Community writing package (0.4+)
```

The preserved examples identify built-in literature search, built-in literature review, and community writing (0.4+) packages.

| Field | Rule |
|------|------|
| `scope` | `asci` (official); organization scopes open in 0.4+ |
| `category` | `builtin` / `community` / `enterprise` |
| `name` | kebab-case, ≤ 32 characters, globally unique |

Full package ID populates `Proposal.sourceCapability`, grouping adoption statistics; **globally unique and immutable**.

<a id="22-最小可发布单元粒度判据"></a>

### 2.2 Smallest Releasable Unit Criteria

One package corresponds to **one user-perceived task domain**:

1. **Independently usable**: Completes at least one end-to-end task without other packages
2. **Unique scenario Agent**: Exactly one scenario Agent entry per package
3. **Reusable Skills**: Referenced Skills shared with other packages, by reference rather than copy
4. **Split signal**: Split when one scenario Agent must handle two unrelated intent branches

Counterexamples:
- Search + review are two packages: Inputs (natural-language query vs selected EvidenceSet) and outputs (paper list vs review.md) differ completely
- Search + citation tracing are one package: Citation tracing is a search intent branch sharing the scenario Agent

---

<a id="3-四要素内容物"></a>

## 3. Four Contents

<a id="31-场景-agent-设定scene-agent-setting"></a>

### 3.1 Scenario Agent Settings (Scene Agent Setting)

The scenario Agent is the package entry, handling conversation opening, intent classification, SubAgent dispatch, and closing summary.

```typescript
interface SceneAgentSetting {
  /** 场景 Agent 的系统提示词（英文，末尾由主程序注入 Output Language directive） */
  systemPrompt: string

  /** 场景 Agent 使用的模型偏好 */
  modelPreference: 'sonnet' | 'haiku' | 'opus'

  /** SubAgent 定义列表 */
  subAgents: SubAgentDefinition[]

  /** 意图分类规则（场景 Agent 在职责 02 中使用） */
  intentClassification: {
    /** 支持的意图列表 */
    intents: IntentDefinition[]
    /** 默认意图（无法分类时回退） */
    defaultIntent: string
  }

  /** 场景 Agent 每 turn 内 LLM 调用上限（默认 2：开口 + 收口） */
  maxSceneAgentCallsPerTurn: number
}

interface SubAgentDefinition {
  /** SubAgent 唯一标识（包内唯一） */
  slug: string
  /** 英文名称 */
  name: string
  /** 英文描述（Agent 选择依据） */
  description: string
  /** 模型偏好 */
  modelPreference: 'sonnet' | 'haiku' | 'opus'
  /** 执行形态 */
  executionMode: 'deterministic-pipeline' | 'agent-loop'
  /** 触发条件：哪些意图下派活 */
  triggeredByIntents: string[]
  /** 串接顺序（同意图下多个 SubAgent 的执行序号） */
  sequenceOrder: number
  /** 暴露给该 SubAgent 的 tool 白名单（引用 MCP tool 名） */
  allowedTools: string[]
  /** 失败兜底策略 */
  failurePolicy: 'fail-turn' | 'degrade-and-continue' | 'skip-and-continue'
}

interface IntentDefinition {
  /** 意图标识 */
  slug: string
  /** 意图描述 */
  description: string
  /** 触发关键词（可选，辅助分类） */
  triggerKeywords?: string[]
  /** 该意图下的 SubAgent 派活链 */
  subAgentChain: string[]
}
```

Preserved interface comments describe: English system prompt with host-injected Output Language directive; model preference; SubAgent definitions; supported/default intents; default maximum 2 scenario calls per turn. SubAgent fields cover unique slug, English name/selection description, model, execution mode, triggering intents, sequence order, and exposed tools; intent fields define intent identity/description and dispatch chain.

**Key constraints** (from both orchestration descriptions):

- **Only 2 LLM calls per turn** for scenario Agent (opening + intent classification together, then closing)
- No interruption, judgment, or replanning by scenario Agent during SubAgent execution
- Issue the plan once; runtime executes it

<a id="32-skill-引用skill-references"></a>

### 3.2 Skill References

```typescript
interface SkillReference {
  /** Skill slug（对应 SkillMeta.slug） */
  slug: string
  /** Skill 来源 */
  source: 'workspace' | 'builtin' | 'imported'
  /** 是否为包的必要依赖（安装时校验） */
  required: boolean
  /** 该 Skill 被哪些 SubAgent 使用 */
  usedBy: string[]
}
```

Preserved fields: Skill slug matching SkillMeta.slug; source; required-installation dependency; SubAgents using it.

Skill references are **declarative references**, not copies:
- Installation checks `required: true` Skills exist in workspace
- Missing required Skills block installation and prompt prior enablement
- Multiple packages may share a Skill; its granularity is independent

<a id="33-mcp-引用mcp-references"></a>

### 3.3 MCP References

```typescript
interface McpReference {
  /** MCP 服务器名称（对应 McpServerEntry 的 key） */
  name: string
  /** 是否为内建 MCP（zotero / ocr / asr / paper-search） */
  isBuiltin: boolean
  /** 是否为包的必要依赖 */
  required: boolean
  /** 该 MCP 被哪些 SubAgent 使用 */
  usedBy: string[]
  /** 暴露给包内 SubAgent 的 tool 白名单（不列则暴露该 MCP 全部 tool） */
  allowedTools?: string[]
  /** 配置模板（非内建 MCP 的安装引导） */
  configTemplate?: Partial<McpServerEntry>
}
```

Preserved fields: MCP server name matching McpServerEntry key; built-in status (zotero/ocr/asr/paper-search); required dependency; consuming SubAgents; optional tool allowlist (omission exposes all); optional non-built-in installation configuration template.

**Tool allowlist mechanism**:

Packages may restrict SubAgent access to MCP tools. For example, lit-review references paper-search but exposes only `get_paper_meta` and `get_paper_full_text`, not `search_papers` or `snowball_search`: A key cross-package scope guard.

<a id="34-ui-框架选择与渲染配置ui-framework-selection"></a>

### 3.4 UI Framework Selection and Render Configuration (UI Framework Selection)

```typescript
interface UiFrameworkSelection {
  /** UI 框架标识（0.3 仅内置 'dialog-main-product'） */
  frameworkId: string
  /** 渲染配置（框架特定） */
  renderConfig: DialogMainProductConfig | Record<string, unknown>
}

/** 0.3 内置框架：对话主 + 右侧产物面板 */
interface DialogMainProductConfig {
  /** 右侧面板渲染的产物类型 */
  productType: 'search-results' | 'review-html' | 'custom'
  /** 是否启用右侧面板流式渲染 */
  streamToPanel: boolean
  /** 面板标题 i18n key */
  panelTitleKey: string
}
```

Preserved fields: framework ID (only built-in 'dialog-main-product' in 0.3), framework-specific configuration; conversation-first/right-product-panel settings define product type, streaming, and title i18n key.

**Extension path**:
- **0.3**: Only built-in `dialog-main-product` (conversation-first + right-side product), used by both launch packages
- **0.4+**: Open framework registration for writing/experiment logs/data analysis layouts

---

<a id="4-capabilitiesproposals-副产品契约"></a>

## 4. `capabilities.proposals[]` Byproduct Contract

> **v0.2 convergence decision** (2026-05-22): Defer Proposal mechanism wholesale to v0.3. Neither v0.2 launch package emits Proposals. This section defines authoritative contract fields for v0.3 implementation.

<a id="41-字段定义"></a>

### 4.1 Field Definitions

```typescript
interface ProposalDeclaration {
  /** 该包能产出的 Proposal 类型 */
  kind: ProposalKind
  /** 触发点描述（何时产出） */
  triggerEvent: string
  /** reasoning 模板（Agent 填充的结构化理由框架） */
  reasoningTemplate: string
  /** 目标对象类型 */
  targetObjectKind: 'paper' | 'evidence-set' | 'note'
}
```

Preserved fields define emitted Proposal kind, trigger-event description, structured reasoning template, and target object type.

<a id="42-两个首发包的-proposal-产出清单v03-规划"></a>

### 4.2 Proposal Outputs of Both Launch Packages (v0.3 Plan)

Neither package emits Proposals in v0.2. These v0.3 placeholders derive from 0.2 §I-A triggered-output table:

<a id="lit-search-包"></a>

#### lit-search Package

| Proposal kind | Trigger | Target | Reasoning template |
|---------------|---------|----------|----------------|
| `evidence-set` | Search results enter library | EvidenceSet | "Based on search results, add these N papers to EvidenceSet '{name}' because..." |
| `citation-relation` | Search results enter library | Paper | "New papers {paperA} and {paperB} have a {relationType} relationship, based on..." |

<a id="lit-review-包"></a>

#### lit-review Package

| Proposal kind | Trigger | Target | Reasoning template |
|---------------|---------|----------|----------------|
| `citation-relation` | Review generation completes | Paper | "Review identified a {relationType} relationship between {paperA} and {paperB}..." |
| `hypothesis-promote` | Review completes / claim recognition from user Note | Note | "This assertion can become a formal hypothesis: '{claim}', supported by {N} papers..." |
| `hypothesis-review` | Paper added to EvidenceSet | Note (hypothesis) | "New paper {paper} takes stance {stance} toward hypothesis '{hypothesis}' because..." |

> **v0.2 fact-checker substitute**: Only four claim labels (`verified` / `unsupported` / `contradicted` / `unchecked`), no Proposal candidates. Candidate production (`citation-relation` / `hypothesis-promote`, etc.) and the entire mechanism defer to v0.3.

---

<a id="5-依赖-&#45;安装-&#45;卸载语义"></a>

## 5. Dependency / Installation / Uninstallation Semantics

<a id="51-依赖解析"></a>

### 5.1 Dependency Resolution

```typescript
interface PackageDependency {
  /** 依赖类型 */
  type: 'skill' | 'mcp' | 'capability-package'
  /** 依赖标识 */
  identifier: string
  /** 是否必要（required=true 阻塞安装） */
  required: boolean
  /** 最低版本要求（可选） */
  minVersion?: string
}
```

Preserved fields define dependency type, identifier, required/blocking status, and optional minimum version.

**Resolution rules**:

1. Scan all `required: true` dependencies before installation
2. Skills: Check workspace `skills/` + `skills-inactive/`; if missing, prompt enablement/installation
3. MCP: Check registration in `~/.asci/mcp.json` + built-ins; offer configuration templates for unregistered non-built-ins
4. Inter-package dependencies: Not implemented in 0.2 (launch packages independent); fields reserved for v0.3

<a id="52-安装顺序"></a>

### 5.2 Installation Order

```
1. Validate dependency completeness
   ├─ Missing required dependency → block and list missing items
   └─ All satisfied → continue
2. Register package manifest in workspace
3. Enable referenced Skills (move skills-inactive/ to skills/)
4. Confirm MCP servers ready
5. Register scenario Agent in Orchestrator routing
6. Broadcast CAPABILITY_PACKAGE_INSTALLED
```

English sequence: 1 Validate dependencies, blocking with missing-required list or continuing if complete; 2 register workspace manifest; 3 enable referenced Skills by moving skills-inactive/→skills/; 4 confirm MCP readiness; 5 register scenario Agent in Orchestrator routing; 6 broadcast CAPABILITY_PACKAGE_INSTALLED.

<a id="53-卸载语义"></a>

### 5.3 Uninstallation Semantics

| Concern | Behavior |
|--------|---------|
| Referenced Skills | **Do not automatically disable**; other packages/users may use them |
| MCP servers | **Do not automatically delete**; shared global resources |
| Existing Proposals | **Retain**; `status: accepted` already became formal objects; mark `pending` `sourceCapability` uninstalled, gray in UI without deleting |
| Scenario Agent registration | **Remove** from Orchestrator routing |
| Conversation history | **Retain**, read-only with no new turns |
| Preferences | **Retain** for reinstall, at `~/.asci/capability-packages/{packageId}/preferences.json` |

**Rationale for Proposal cleanup after uninstall**: `payload` is immutable signal data feeding 0.3 §III-A adoption analysis; deletion damages historical statistics. `sourceCapability` remains a provenance key with audit value even after uninstall.

---

<a id="6-二分布局skill-板块-&#45;能力包板块"></a>

## 6. Split Layout: Skills + Capability Packages

<a id="61-分层判据"></a>

### 6.1 Layer Criteria

| Layer | Location | Content | User mental model |
|------|------|------|----------|
| **System foundation** | Settings dialog | Provider keys, MCP servers, Zotero credentials, proxy, theme, language | System parameters |
| **Agent ecosystem** | Sidebar Configuration page | Skill registry + package browser | Agent capabilities |

<a id="62-skill-板块"></a>

### 6.2 Skills Section

Reuse existing `SkillMeta`, adding reverse package references:

```typescript
interface SkillMetaExtended extends SkillMeta {
  /** 引用该 Skill 的能力包列表（反向索引，只读） */
  usedByPackages: string[]
}
```

The preserved field is the read-only reverse index of packages referencing this Skill.

Display:
- Group by `category`
- Each card: Name (`nameI18n[lang] ?? name`), description, enable switch, referencing packages
- Disabling a `required` Skill prompts confirmation: "{packageName} depends on this Skill"

<a id="63-能力包板块"></a>

### 6.3 Capability Packages Section

Display:
- Installed / available groups
- Each card:
  - Name (`displayNameI18n[lang] ?? displayName`)
  - Summary
  - Four-content summary (N Skills · M MCPs · scenario Agent · UI framework)
  - Install/uninstall button
  - Proposal output declarations (active v0.3, gray "Not enabled yet" in v0.2)
- Click details: Complete four contents + SubAgent topology + package preferences

---

<a id="7-两个首发包详解"></a>

## 7. Two Launch Packages in Detail

<a id="71-lit-search文献检索包"></a>

### 7.1 lit-search (Literature Search Package)

> Field authority: As-built `apps/electron/default-capability-packs/lit-search/manifest.json` + `docs/milestones/0.2/2026-05-23-agent-and-capability-pack-spec.md` §5.3 (original `lit-search场景 Agent 编排说明.md` absorbed and removed; filename means lit-search scenario Agent orchestration description)

<a id="基本信息"></a>

#### Basic Information

| Field | Value |
|------|-----|
| Package ID | `asci.builtin.lit-search` |
| Display name | Literature Search (Chinese / English) |
| UI framework | `dialog-main-product` (productType: `search-results`) |
| Scenario Agent model | sonnet (first token ~600ms) |

<a id="subagent-拓扑"></a>

#### SubAgent Topology

```
Scenario Agent (dispatcher, 2 LLM calls/turn)
  ├─ Exact lookup → no SubAgent (scenario Agent calls paper-search directly)
  ├─ Ordinary search → searcher → relevance-scorer
  └─ Citation tracing → [seed parsing] → citation-explorer → relevance-scorer
```

English topology: Dispatcher scenario Agent, 2 LLM calls/turn. Exact lookup → no SubAgent, scenario directly calls paper-search; ordinary search → searcher → relevance-scorer; citation tracing → seed parsing → citation-explorer → relevance-scorer.

| SubAgent | Model | Execution | Intent | Exposed tools |
|----------|------|---------|---------|-----------|
| searcher | sonnet | deterministic-pipeline | Ordinary search | paper-search: `search_papers` |
| citation-explorer | sonnet | deterministic-pipeline | Citation tracing | paper-search: `snowball_search`, `get_paper_meta` |
| relevance-scorer | sonnet + haiku | deterministic-pipeline | Ordinary search, citation tracing | No external tools, LLM scoring only |

<a id="skill-引用"></a>

#### Skill References

| Skill slug | required | Purpose |
|------------|----------|------|
| `literature-search-enhanced` | true | searcher retrieval capability skeleton |

<a id="mcp-引用"></a>

#### MCP References

| MCP name | isBuiltin | required | Exposed tools |
|----------|-----------|----------|-----------|
| `paper-search` | true | true | `search_papers`, `get_paper_meta`, `get_paper_full_text`, `snowball_search` |
| `zotero` | true | false | `add_to_library` |

<a id="ttlt-预算"></a>

#### TTLT Budget

| Intent | Typical TTLT | Worst TTLT | LLM calls |
|------|:---------:|:---------:|:--------:|
| Exact lookup | ~3s | 5s | 2 |
| Ordinary search | ~8s | 15s | 5 |
| Citation tracing | ~12-15s | 22s | 4 |

<a id="proposal-产出v03-规划"></a>

#### Proposal Outputs (v0.3 Plan)

- `evidence-set`: Search results enter library
- `citation-relation`: Relationship candidates between newly added papers

> v0.2: No Proposal outputs.

---

<a id="72-lit-review文献综述包"></a>

### 7.2 lit-review (Literature Review Package)

> Field authority: As-built `apps/electron/default-capability-packs/lit-review/manifest.json` + `docs/milestones/0.2/2026-05-23-agent-and-capability-pack-spec.md` §5.4 (original `lit-review场景 Agent 编排说明.md` absorbed and removed; filename means lit-review scenario Agent orchestration description)

<a id="基本信息-1"></a>

#### Basic Information

| Field | Value |
|------|-----|
| Package ID | `asci.builtin.lit-review` |
| Display name | Literature Review (Chinese / English) |
| UI framework | `dialog-main-product` (productType: `review-html`, streamToPanel: true) |
| Scenario Agent model | sonnet |

<a id="会话拓扑两-turn-必走断点"></a>

#### Conversation Topology: Mandatory Two-turn Breakpoint

```
Turn 1 · Direction selection (~10-12s)
  Scenario Agent → review-proposer Skill → litreview.present_directions tool → ChoiceCard
  User selects direction → tool returns → same agent run enters Turn 2

Turn 2 · Review generation (~70-200s)
  Scenario Agent → synthesizer (parallel A: outline splitting + parallel B: reader fan-out)
  → Merge tracks → chapter-streamed review.md → asynchronous fact-checker → closing
```

English topology: Turn1 direction selection (~10-12s): scenario Agent → review-proposer Skill → litreview.present_directions → ChoiceCard; user choice returns from tool and same run enters Turn2. Turn2 review generation (~70-200s): scenario → synthesizer with parallel outline splitting and reader fan-out; merge tracks → chapter-streamed review.md → asynchronous fact-checker → closing.

<a id="subagent-拓扑-1"></a>

#### SubAgent Topology

| SubAgent | Model | Execution | Turn | Exposed tools | Failure fallback |
|----------|------|---------|----------|-----------|---------|
| synthesizer | sonnet | **agent-loop** | Turn 2 | paper-search: `get_paper_meta`, `get_paper_full_text` | One LLM segment error → Turn 2 fails |
| reader | haiku | deterministic-pipeline | Turn 2 (parallel fan-out) | No external tools, reads PDFs | Single-paper failure → abstract fallback |
| fact-checker | haiku | deterministic-pipeline | Turn 2 (asynchronous, nonblocking) | No external tools, LLM verification only | Single-segment failure → claim `unchecked` |

<a id="skill-引用-1"></a>

#### Skill References

`skillRefs: []` (empty). After architectural evolution, `review-proposer` and the review-body author became package **SubAgents** (above), no longer skillRefs:
- `review-proposer`: Turn1 directions, now a SubAgent (`subAgents[]`).
- `synthesizer` (Agent loop) **produces the body directly with its own full prompt**, no skeleton Skill references.
- `literature-review-result` is an **independent fallback Skill**: Only without any registered review package does master use Skills-First (`review-proposer` → `literature-review-result`); this package does not reference it.

> Historical note: Early draft planned `skillRefs: [review-proposer, literature-review-result]`, the latter as synthesizer skeleton. Implementation switched to SubAgent topology and self-contained synthesizer, empty skillRefs. This table matches as-built `apps/electron/default-capability-packs/lit-review/manifest.json`.

<a id="mcp-引用-1"></a>

#### MCP References

| MCP name | isBuiltin | required | Exposed tools | Notes |
|----------|-----------|----------|-----------|------|
| `paper-search` | true | false | `get_paper_meta`, `get_paper_full_text` | Cross-package exact-lookup gap filling (cap=3) |
| `zotero` | true | false | — | Indirect EvidenceSet association |

**Cross-package Exact-lookup Hard Cap**:

| Dimension | Value |
|------|-----|
| Cumulative calls per Turn 2 | 3 |
| Timeout per call | 8s |
| Stop after cumulative failures | ≥ 2 |
| Main-flow blocking | 0s (fire-and-forget) |

<a id="工具调用契约"></a>

#### Tool-call Contract

| Tool | Purpose | Argument summary |
|------|------|----------|
| `litreview.present_directions` | Turn 1 direction ChoiceCard | `directions[]` + `rerollLabel` + `customLabel` → return `{ choice, customDirection? }` |
| `litreview.present_resume_choice` | Interruption recovery ChoiceCard | "Regenerate / Abandon" → return `{ choice }` |

<a id="ttlt-预算-1"></a>

#### TTLT Budget

| Scenario | Turn 1 | Turn 2 | Total | LLM calls |
|------|:------:|:------:|:------:|:--------:|
| Small (10 papers) | ~10s | ~70s | ~80s | ~40 |
| Medium (20 papers) | ~12s | ~110s | ~120s | ~58 |
| Large (40 papers) | ~15s | ~200s | ~215s | ~95 |

<a id="输出格式"></a>

#### Output Format

review.md (actually stored at `~/.asci/reviews/{id}.html`):
- YAML frontmatter: `reviewId` / `title` / `direction` / `sourceEvidenceSetId` / `sourceCapability` / `generatedAt` / `factCheckSummary` / `chapters` / `totalSentences`
- Body: sentence-anchor (`data-sentence-id`) + inline fact-check (`data-fact-check`) + claim associations (`data-claims`)
- References: `<handle>` reverse lookup in paper-search process cache

<a id="proposal-产出v03-规划-1"></a>

#### Proposal Outputs (v0.3 Plan)

- `citation-relation`: Review completion
- `hypothesis-promote`: Review completion / claim recognition from user Note
- `hypothesis-review`: Paper added to EvidenceSet

> v0.2: No Proposal outputs; fact-checker only applies four claim labels.

---

<a id="8-d-4-契约-schema-映射"></a>

## 8. D-4 Contract Schema Mapping

This section enables D-4 (#239) implementation to consume this spec's field definitions directly.

<a id="81-能力包-manifest-完整-interface"></a>

### 8.1 Complete Capability Package Manifest Interface

```typescript
/**
 * 能力包清单（Capability Package Manifest）
 *
 * D-4 实现层从此 interface 生成 JSON Schema，
 * 放置于 schema/capabilities/ 目录下。
 */
interface CapabilityPackageManifest {
  /** 包 ID（全局唯一，不可变） */
  id: string

  /** 版本号（semver） */
  version: string

  /** 英文显示名 */
  displayName: string

  /** 双语显示名（可选） */
  displayNameI18n?: { zh?: string; en?: string }

  /** 英文描述 */
  description: string

  /** 双语描述（可选） */
  descriptionI18n?: { zh?: string; en?: string }

  /** 图标（emoji 或 asset 路径） */
  icon?: string

  /** 四要素 */
  sceneAgentSetting: SceneAgentSetting
  skillReferences: SkillReference[]
  mcpReferences: McpReference[]
  uiFramework: UiFrameworkSelection

  /** 副产品契约（v0.3 兑现） */
  proposals: ProposalDeclaration[]

  /** 依赖声明 */
  dependencies: PackageDependency[]

  /** 包内偏好默认值 */
  defaultPreferences?: Record<string, unknown>
}
```

Preserved interface comments specify D-4 JSON Schema generation into schema/capabilities/, immutable globally unique ID, semver, English/bilingual names/descriptions, emoji/asset icon, four contents, v0.3 proposal contract, dependencies, and default preferences.

<a id="82-字段到现有类型的映射"></a>

### 8.2 Mapping Fields to Existing Types

| Manifest field | Existing type | Location |
|--------------|---------|------|
| `proposals[].kind` | `ProposalKind` | `packages/shared/src/types/objects/proposal.ts` |
| `skillReferences[].slug` | `SkillMeta.slug` | `packages/shared/src/types/agent.ts` |
| `mcpReferences[].name` | `McpServerEntry` key | `packages/shared/src/types/agent.ts` |
| `mcpReferences[].isBuiltin` | `BUILTIN_MCP_RESERVED_NAMES` | `packages/shared/src/types/agent.ts` |
| `proposals[].targetObjectKind` | `ProposalTargetRef.kind` | `packages/shared/src/types/objects/proposal.ts` |
| `id` → `Proposal.sourceCapability` | `string` | `packages/shared/src/types/objects/proposal.ts` |

---

<a id="9-e-1-218-访谈清单交叉验证"></a>

## 9. E-1 (#218) Interview Checklist Cross-validation

Cross-validate this spec against E-1 interviews. X1.1 / X1.2 impact matrix:

| Validation | Spec section | Cross-check | Failure impact |
|--------|----------|-----------|----------------|
| X1.1 Acceptance of proactive Agent proposals | §4 Proposal byproducts | ≥ 50% rate three Proposal types (citation-relation / hypothesis-promote / hypothesis-review) ≤ 2 points → trigger §0 downgrade | Proposal may defer further or become opt-in |
| X1.2 Skill/package split comprehension | §6 Split layout | < 60% correctly distinguish system parameters vs Agent capabilities in 30 seconds | Downgrade split layout to tabs in unified Settings |
| X1 Package candidates | §2.2 Granularity | Whether ≥3 interview-identified package types fit current criteria | Adjust boundaries or merge/split launch packages |

---

<a id="附录-a术语表"></a>

## Appendix A: Glossary

| Term | Definition |
|------|------|
| Capability Package | Smallest releasable user-assignable task unit, four contents + Proposal byproduct contract |
| Scene Agent | Package entry, opens conversation, classifies intent, dispatches SubAgents, summarizes closure |
| SubAgent | Scenario-dispatched Agent executing specific work (search, scoring, review generation) |
| Proposal | Agent-produced, user-decided suggestion object; interaction vehicle, not research artifact |
| `sourceCapability` | Proposal source field pointing to producing package ID |
| TTFT | Time To First Token, first scenario chat token |
| TTLT | Time To Last Token, final scenario chat token (turn end) |
| ChoiceCard | User decision card rendered by tool call, following 0.1 ExitPlanMode |

<a id="附录-b与-north-star-审计标准的对齐"></a>

## Appendix B: Alignment with north-star Audit Criteria

| Criterion | Spec coverage | Status |
|---------|-----------------|------|
| X2 · Naming/granularity | §2 | ✅ |
| X2 · Four contents | §3 | ✅ |
| X2 · `capabilities.proposals[]` contract | §4 (v0.3 placeholder) | ✅ |
| X2 · Dependency/install-uninstall semantics | §5 | ✅ |
| X2 · Skills/packages split | §6 | ✅ |
| X2 · Per-package byproduct lists | §4.2 + §7.1/7.2 Proposal outputs | ✅ (SubAgent topology + exposed-tool contracts + v0.3 placeholders) |
| A3 · Documented contracts consumable by implementation | §8 D-4 mapping | ✅ |

---

**Spec ID**: `2026-05-25-capability-package-concept`
**Author**: ASCI 0.2 design session
**Version**: v1

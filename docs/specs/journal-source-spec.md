<a id="journal-检索源-specopensci-journal"></a>

# Journal Search Source Spec (OPENSCI `/journal`)

> **Status**: draft · awaiting review
> **Related issue**: (to be added)
> **Related PR**: (to be added)
> **Domain language source of truth**: `CONTEXT.md` (search-source / connector terminology)
> **Server source of truth**: ASCI-Server `internal/application/works/` (OpenAlex-`/works` compatible implementation) + ADR-0006 (token authentication) / ADR-0007 (`/works`→`/journal` rename)

---

<a id="1-背景与目标"></a>

## 1. Background and Goals

ASCI literature retrieval is provided by built-in MCP `paper-search-mcp`, supporting 20+ public sources including arxiv / openalex / crossref / pubmed (organized by database/platform). OPENSCI has built a journal-corpus search endpoint at `https://asci-test.opensci.io/journal`, currently **not integrated into paper-search-mcp**.

This spec's goal: **add a search-source connector named `journal`**, integrating OPENSCI `/journal` into literature retrieval so it automatically participates in literature-review retrieval while users are signed in.

<a id="11-关键前提journal-是-openalex-works-兼容接口"></a>

### 1.1 Key Premise: `/journal` Is Compatible with OpenAlex `/works`

Confirmed by the server (ASCI-Server; ADR-0005/0006/0007, `internal/application/works/`):

- **Path**: `GET {asciServerBaseUrl}journal` (test environment `https://asci-test.opensci.io/journal`).
- **Query syntax**: identical to OpenAlex `/works` — `search`, `filter` (OpenAlex syntax, supporting `title.search:`, `publication_year`, `from_/to_publication_date`, `doi`, `is_oa`, etc.), `sort`, `page`, `per-page`/`per_page`, `cursor`.
- **Response**: OpenAlex Work shape — `{ meta: { count, page, per_page, next_cursor? }, results: [Work...] }`; `Work` includes `id`, `doi`, `title`, `display_name`, `publication_year`, `publication_date`, `abstract_inverted_index`, `authorships[]`, `primary_location.source.display_name` (venue), `open_access`, `concepts[]`, `cited_by_count`.
- **Authentication**: `Authorization: Bearer <token>`. Accepts (a) real OPENSCI access tokens (same OIDC validation as `/me`, `/events`), or (b) a temporary hardcoded test token (server marks it "remove before launch").

**This connector therefore ≈ existing `openalex.py` redirected to `/journal` + Bearer header + renamed source.**

<a id="12-认证方案已与用户确认"></a>

### 1.2 Authentication Approach (Confirmed with User)

Use **real OPENSCI tokens**: ASCI-Alpha main process already has full OIDC sign-in (`AuthService` + encrypted token store + automatic refresh). Inject the signed-in access token into paper-search-mcp subprocess environment variables; the connector uses it for `Authorization: Bearer`. Do not use the temporary test token.

---

<a id="2-设计"></a>

## 2. Design

<a id="21-单元划分"></a>

### 2.1 Units

| Unit | Responsibility | Interface | Dependencies |
|------|------|------|------|
| `connectors/journal.py` | Send OpenAlex-syntax requests to `/journal`, parse Work → `Paper` | `search(query, max_results, **kwargs) -> List[Paper]` (inherited) | `OpenAlexConnector` (reuse parsing), `get_env`, `requests` |
| Minimal `openalex.py` refactor | Allow subclasses to override `source` | Add class attribute `SOURCE_NAME` | None |
| Main-process env injection | Inject valid access token + base URL into subprocess | Existing paper-search env block in `agent-orchestrator.ts` | `AuthService`, `resolveAuthConfig()` |
| `AuthService` token getter | Main-process-internal retrieval of current valid access token (refresh on demand) | New method (not exposed via IPC) | Existing single-flight refresh |
| Include journal in retrieval | Ensure journal participates in actual retrieval (see §2.6) | Automatically include `"journal"` in `retrieve()` when registered (**not** changing defaults—planner's explicit sources bypass them) | None |

### 2.2 `connectors/journal.py`

```python
@register("journal")
class JournalConnector(OpenAlexConnector):
    """OPENSCI /journal 期刊语料检索（OpenAlex-/works 兼容）。"""
    capabilities = ConnectorCapabilities(
        search=True, download=False, read=False,
        requires_key="JOURNAL_ACCESS_TOKEN",
    )
    SOURCE_NAME = "journal"

    def __init__(self):
        # 注意：私有鉴权接口，必须用普通 Session，禁止 ProxyFallbackSession
        # （Bearer token 绝不能走公共代理回退泄漏）。
        self.BASE_URL = get_env("JOURNAL_BASE_URL", "https://asci-test.opensci.io/journal")
        self.session = requests.Session()
        token = get_env("JOURNAL_ACCESS_TOKEN", "")
        self.session.headers.update({
            "User-Agent": "paper-search-mcp/1.0 (mailto:asci@opensci.io)",
            "Authorization": f"Bearer {token}",
        })
```

- Set `BASE_URL` as an instance attribute (parent `_fetch_works` / `_fetch_title_exhaust` read `self.BASE_URL`).
- `requires_key="JOURNAL_ACCESS_TOKEN"`: if `get_env("JOURNAL_ACCESS_TOKEN")` is empty at registry instantiation (signed out), **skip instantiation** → journal is silently absent, without errors; activate only after sign-in injects a token.
- Reuse parent `search()` (two phases: title-first + broad), `_fetch_works`, `_fetch_title_exhaust`, `_parse_item`, `_reconstruct_abstract`.
- **Do not reuse** `download_pdf` / `read_paper` (capabilities declare download=read=False; parent defaults suffice).

<a id="23-openalexpy-最小重构"></a>

### 2.3 Minimal `openalex.py` Refactor

`_parse_item` currently hardcodes `source="openalex"` ([openalex.py:240](../../apps/electron/resources/paper-search-mcp/paper_search/connectors/openalex.py)). Change to:

```python
class OpenAlexConnector(PaperConnector):
    SOURCE_NAME = "openalex"   # 新增类属性
    ...
    # _parse_item 内：source=self.SOURCE_NAME
```

No behavior change for openalex itself (default remains `"openalex"`); subclass override yields `"journal"`.

<a id="24-主进程token-&#45;base-url-注入"></a>

### 2.4 Main Process: Token + Base URL Injection

Append to the existing per-session paper-search env special-case block in `agent-orchestrator.ts` (around lines 876-882, already injecting `ASCI_SESSION_ID` / `ASCI_CONFIG_DIR`):

```ts
const journalToken = await authService.<取有效token方法>()   // 未登录返回空
if (journalToken) {
  psEntry.env = {
    ...psEntry.env,
    PAPER_SEARCH_MCP_JOURNAL_ACCESS_TOKEN: journalToken,
    PAPER_SEARCH_MCP_JOURNAL_BASE_URL: `${resolveAuthConfig().asciServerBaseUrl}journal`,
  }
}
```

- **Single source of truth for base URL**: reuse `resolveAuthConfig().asciServerBaseUrl` from `auth-opensci-client.ts` (default `https://asci-test.opensci.io/`, overridable in dev through `auth-config.json` to `localhost:6060/`). Add no separate hardcoded constant.
- **Refresh before injection**: when the token method finds access-token expiry approaching, reuse existing `AuthService` single-flight refresh to maximize validity at injection.
- Signed out / no valid token → no injection → connector `requires_key` gate leaves journal inactive.

<a id="25-authservice-取-token-方法"></a>

### 2.5 `AuthService` Token Getter

Add a **main-process-internal** method (e.g. `getAccessTokenForServices()`), returning the current valid access-token string (triggering single-flight refresh as needed; empty if signed out/refresh fails).

- Unlike existing dev-only `getAccessTokenForDev()`, gated by `app.isPackaged` and intended only for debug IPC, the new method serves main-process business logic and is **not exposed to the renderer via IPC** (tokens stay exclusively in main, respecting contextIsolation).

<a id="26-让-journal-真正参与检索retrieve-层自动并入已注册即纳入"></a>

### 2.6 Ensure Journal Participates: Automatic Inclusion in Retrieve (Whenever Registered)

> **Design evolution**: initially, add `"journal"` to `retrieve()` default sources. But lit-search orchestration's **planning Agent always explicitly supplies `sources`** (e.g. `["openalex","crossref","pubmed","europepmc"]`), **bypassing defaults**, so journal was never requested (verified). Therefore **automatically include** it within `retrieve()`:

`search_service.py` (`retrieve()`, after default resolution and before `build_query_matrix`):

```python
sources = sources or ["openalex", "crossref", "arxiv"]
# 机构自有 journal 语料：连接器已注册（= 已登录、token 已注入）时，无论上游 planner
# 传入哪些 sources 都自动并入；未注册（未登录）自然缺席。去重避免重复。
if self.registry.get("journal") is not None and "journal" not in sources:
    sources = [*sources, "journal"]
```

- **Signed in**: journal connector registered → include journal regardless of planner sources, participating in every retrieval.
- **Signed out**: connector unregistered (`requires_key` gate) → auto-inclusion guard does not fire, leaving journal out of sources; even explicitly supplied, existing `_retrieve_inner` filters `registered_sources` / `registered_matrix` silently remove it, **without counting a failed source or triggering failure-source expansion** (see related paths in [[lit-search-failure-source-expansion]]).
- This is the **only journal-inclusion mechanism**; default sources revert to the original three `["openalex","crossref","arxiv"]`, without journal as a hardcoded default.

<a id="261-透明度落差已知取舍"></a>

### 2.6.1 Transparency Gap (Known Tradeoff)

The `present_search_plan` confirmation page displays planner-generated sources (without journal), while actual `retrieve` includes journal. Thus the confirmed plan and actual sources differ slightly. This change prioritizes automatic participation and accepts that gap; showing journal on the plan page would be a later planner-driven enhancement (change scenario prompt + thread sign-in state into the availability block), outside this scope.

<a id="27-自动生成的-mcp-工具"></a>

### 2.7 Automatically Generated MCP Tools

`journal` is absent from `_STATIC_SEARCH_TOOLS`, so `_register_platform_tools()` in `mcp_server.py` **automatically generates `search_journal`**, without handwritten code. `capabilities.read=False` → no `read_journal_paper` generation.

---

<a id="3-测试"></a>

## 3. Tests

### 3.1 Python `connectors/test_journal.py`
- Mock `session.get` with OpenAlex-shaped JSON → assert:
  - Request includes `Authorization: Bearer <token>` and targets `JOURNAL_BASE_URL`;
  - Parsed `Paper.source == "journal"`, with correct title / venue / doi / authors / abstract (reconstructed inverted index) / published_date mapping;
  - Non-200 (429/5xx) propagates with parent semantics, without silently becoming empty.
- Registry gate: journal absent from `all_names()` without `JOURNAL_ACCESS_TOKEN`, present with it.

### 3.2 TS
- Env-injection helper unit tests (if structurally possible): token → inject token + derived base URL; no token → no injection; base URL from `resolveAuthConfig()`.

<a id="33-机器校验"></a>

### 3.3 Automated Validation
- `bun run typecheck`, `bun test` (including key-parity; no i18n changes in this batch, so unaffected).
- Run `dist:fast` smoke check if packaging configuration changes (none expected by this spec).

---

<a id="4-非目标yagni"></a>

## 4. Non-goals (YAGNI)

- **No new UI / settings** → **zero i18n changes** (token comes from sign-in, source joins the matrix automatically, no user-facing copy).
- No PDF downloads / full-text read (`/journal`, like OpenAlex, does not host full text).
- No journal-specific filter UI (journal name / venue filters, etc.); integrate only as a search source.
- **Mid-session token-expiry reinjection**: v1 injects a fresh token on agent startup (~15min TTL covers typical retrieval); a mid-session 401 returns `[]` for graceful degradation, without reinjection.
- Do not use the temporary test-token path.

---

<a id="5-受影响文件清单"></a>

## 5. Affected Files

| File | Change |
|------|------|
| `apps/electron/resources/paper-search-mcp/paper_search/connectors/journal.py` | New connector |
| `apps/electron/resources/paper-search-mcp/paper_search/connectors/openalex.py` | Minimal refactor: `SOURCE_NAME` class attribute |
| `apps/electron/resources/paper-search-mcp/paper_search/service/search_service.py` | Automatically include `"journal"` in `retrieve()` when registered (§2.6); retrieve fan-out silently skips unregistered sources without counting failures |
| `apps/electron/resources/paper-search-mcp/paper_search/connectors/test_journal.py` | New tests |
| `apps/electron/src/main/lib/agent-orchestrator.ts` | Env injection of token + base URL |
| `apps/electron/src/main/lib/auth-service.ts` | New main-process-internal token getter |
| (Possibly) `apps/electron/src/main/lib/auth-opensci-client.ts` | Export `resolveAuthConfig` / base URL (if not already reusable) |

---

<a id="6-验收"></a>

## 6. Acceptance

1. Run literature retrieval while signed in: journal contributes recall, results have `source` of `journal`, and journal corpus hits are returned.
2. Signed-out literature retrieval works normally (journal silently absent, no errors or failed-source-count anomalies).
3. `bun run typecheck` + `bun test` pass.
4. Bearer token passes through no proxy and is not exposed to the renderer.

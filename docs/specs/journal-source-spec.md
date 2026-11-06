# Journal 检索源 Spec（OPENSCI `/journal`）

> **状态**：草稿 · 待 review
> **关联 issue**：（待补）
> **关联 PR**：（待补）
> **领域语言事实源**：`CONTEXT.md`（检索源 / 连接器术语）
> **服务端事实源**：ASCI-Server `internal/application/works/`（OpenAlex-`/works` 兼容实现）+ ADR-0006（token 认证）/ ADR-0007（`/works`→`/journal` 改名）

---

## 1. 背景与目标

ASCI 的文献检索由内置 MCP `paper-search-mcp` 提供，现支持 arxiv / openalex / crossref / pubmed 等 20+ 个公共检索源（按"数据库/平台"维度组织）。OPENSCI 自建了一个期刊语料检索接口，部署在 `https://asci-test.opensci.io/journal`，目前 **未被 paper-search-mcp 接入**。

本 spec 的目标：**新增一个名为 `journal` 的检索源连接器**，把 OPENSCI `/journal` 接入文献检索流程，使其在用户登录态下自动参与文献综述检索。

### 1.1 关键前提：`/journal` 是 OpenAlex-`/works` 兼容接口

服务端（ASCI-Server）已确认（ADR-0005/0006/0007，`internal/application/works/`）：

- **路径**：`GET {asciServerBaseUrl}journal`（测试环境 `https://asci-test.opensci.io/journal`）。
- **查询语法**：与 OpenAlex `/works` 完全一致 —— `search`、`filter`（OpenAlex 过滤语法，支持 `title.search:`、`publication_year`、`from_/to_publication_date`、`doi`、`is_oa` 等）、`sort`、`page`、`per-page`/`per_page`、`cursor`。
- **响应体**：OpenAlex Work 形状 —— `{ meta: { count, page, per_page, next_cursor? }, results: [Work...] }`，`Work` 含 `id`、`doi`、`title`、`display_name`、`publication_year`、`publication_date`、`abstract_inverted_index`、`authorships[]`、`primary_location.source.display_name`（venue）、`open_access`、`concepts[]`、`cited_by_count`。
- **认证**：`Authorization: Bearer <token>`。接受 (a) 真实 OPENSCI access token（与 `/me`、`/events` 同一套 OIDC 校验），或 (b) 一个临时硬编码测试 token（服务端标注"上线前删除"）。

**因此本连接器 ≈ 现有 `openalex.py` 重指向到 `/journal` + 加 Bearer 头 + 改 source 名。**

### 1.2 认证方案（已与用户确认）

采用 **真实 OPENSCI token**：ASCI-Alpha 主进程已有完整 OIDC 登录（`AuthService` + 加密 token store + 自动刷新）。把登录后的 access token 注入 paper-search-mcp 子进程的环境变量，连接器用它发 `Authorization: Bearer`。不使用临时测试 token。

---

## 2. 设计

### 2.1 单元划分

| 单元 | 职责 | 接口 | 依赖 |
|------|------|------|------|
| `connectors/journal.py` | 向 `/journal` 发 OpenAlex 语法请求、解析 Work → `Paper` | `search(query, max_results, **kwargs) -> List[Paper]`（继承基类） | `OpenAlexConnector`（复用解析）、`get_env`、`requests` |
| `openalex.py` 最小重构 | 让 `source` 字段可被子类覆盖 | 新增类属性 `SOURCE_NAME` | 无 |
| 主进程 env 注入 | 把有效 access token + base URL 注入子进程 | `agent-orchestrator.ts` 现有 paper-search env 块 | `AuthService`、`resolveAuthConfig()` |
| `AuthService` 取 token 方法 | 主进程内部取当前有效 access token（按需刷新） | 新增方法（非 IPC 暴露） | 现有 single-flight 刷新 |
| journal 参与检索 | 让 journal 真正进入实际检索（见 §2.6） | `retrieve()` 已注册时自动并入 `"journal"`（**非**改默认列表——planner 显式传 sources 会绕过默认） | 无 |

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

- `BASE_URL` 设为实例属性（父类的 `_fetch_works` / `_fetch_title_exhaust` 读 `self.BASE_URL`）。
- `requires_key="JOURNAL_ACCESS_TOKEN"`：registry 实例化时 `get_env("JOURNAL_ACCESS_TOKEN")` 为空（未登录）则**跳过实例化** → journal 静默缺席，不报错；登录注入 token 后才激活。
- 复用父类 `search()`（两阶段 title-first + broad）、`_fetch_works`、`_fetch_title_exhaust`、`_parse_item`、`_reconstruct_abstract`。
- **不复用** `download_pdf` / `read_paper`（capabilities 已声明 download=read=False，父类默认行为即可）。

### 2.3 `openalex.py` 最小重构

`_parse_item` 当前硬编码 `source="openalex"`（[openalex.py:240](../../apps/electron/resources/paper-search-mcp/paper_search/connectors/openalex.py)）。改为：

```python
class OpenAlexConnector(PaperConnector):
    SOURCE_NAME = "openalex"   # 新增类属性
    ...
    # _parse_item 内：source=self.SOURCE_NAME
```

行为对 openalex 本身零变化（默认仍 `"openalex"`）；子类覆盖即得 `"journal"`。

### 2.4 主进程：token + base URL 注入

在 `agent-orchestrator.ts` 现有的 per-session paper-search env 特例块（约 876-882 行，已注入 `ASCI_SESSION_ID` / `ASCI_CONFIG_DIR`）追加：

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

- **base URL 单一真相源**：复用 `auth-opensci-client.ts` 的 `resolveAuthConfig().asciServerBaseUrl`（默认 `https://asci-test.opensci.io/`，dev 可经 `auth-config.json` 覆盖到 `localhost:6060/`）。不再另起硬编码常量。
- **注入前刷新**：调 token 方法时若 access token 临近过期，复用 `AuthService` 现有 single-flight 刷新，最大化注入时刻的有效窗口。
- 未登录 / 无有效 token → 不注入 → 连接器 `requires_key` 门控不激活 journal。

### 2.5 `AuthService` 取 token 方法

新增一个**主进程内部用**的方法（例如 `getAccessTokenForServices()`），返回当前有效 access token 字符串（按需触发 single-flight 刷新；无登录态 / 刷新失败返回空）。

- 与现有 dev-only 的 `getAccessTokenForDev()` 区别：后者被 `app.isPackaged` 门控、仅供调试 IPC；新方法供主进程业务调用，**不经 IPC 暴露给渲染进程**（token 仍只在主进程持有，符合 contextIsolation 约束）。

### 2.6 让 journal 真正参与检索：retrieve 层自动并入（已注册即纳入）

> **设计演进**：最初设想是把 `"journal"` 加进 `retrieve()` 的默认 sources 列表。但 lit-search 编排里 **规划 Agent 总是显式传入 `sources`**（如 `["openalex","crossref","pubmed","europepmc"]`），**绕过默认列表**，导致 journal 从不被请求（实测验证）。故改为在 `retrieve()` 内**自动并入**：

`search_service.py`（`retrieve()`，default-resolution 之后、`build_query_matrix` 之前）：

```python
sources = sources or ["openalex", "crossref", "arxiv"]
# 机构自有 journal 语料：连接器已注册（= 已登录、token 已注入）时，无论上游 planner
# 传入哪些 sources 都自动并入；未注册（未登录）自然缺席。去重避免重复。
if self.registry.get("journal") is not None and "journal" not in sources:
    sources = [*sources, "journal"]
```

- **登录态**：journal 连接器已注册 → 无论 planner 给什么 sources，journal 都被并入，参与每次检索。
- **未登录**：连接器未注册（`requires_key` 门控）→ 自动并入的 guard 不触发，journal 不进 sources；即便被显式传入，`_retrieve_inner` 的 `registered_sources` / `registered_matrix` 过滤（既有安全网）也会静默剔除，**不计为失败源、不触发失败扩源**（见 [[lit-search-failure-source-expansion]] 相关路径）。
- 这是 journal 纳入的**唯一机制**——默认 sources 列表回退为原始三源 `["openalex","crossref","arxiv"]`，不再把 journal 作为硬编码默认。

### 2.6.1 透明度落差（已知取舍）

`present_search_plan` 确认页展示的是 planner 生成的 sources（不含 journal），但 `retrieve` 实际会并入 journal。即「确认的计划」与「实际跑的源」存在轻微不一致。本次取「自动参与」优先、接受该落差；如需计划页也展示 journal，属后续 planner-driven 增强（改 scenario prompt + 把登录态 threading 进可用性块），不在本次范围。

### 2.7 自动生成的 MCP 工具

`journal` 不在 `_STATIC_SEARCH_TOOLS` 内，故 `mcp_server.py` 的 `_register_platform_tools()` 会**自动生成 `search_journal` 工具**，无需手写。`capabilities.read=False` → 不生成 `read_journal_paper`。

---

## 3. 测试

### 3.1 Python `connectors/test_journal.py`
- mock `session.get` 返回 OpenAlex 形状 JSON → 断言：
  - 请求带 `Authorization: Bearer <token>` 头、打到 `JOURNAL_BASE_URL`；
  - 解析出的 `Paper.source == "journal"`、title / venue / doi / authors / abstract（inverted index 还原）/ published_date 映射正确；
  - 非 200（429/5xx）按父类语义向上抛（不静默吞成空）。
- registry 门控：`JOURNAL_ACCESS_TOKEN` 缺失时 journal 不在 `all_names()`；存在时在。

### 3.2 TS
- env 注入助手单测（若可结构化）：有 token → 注入 token + 派生 base URL；无 token → 不注入；base URL 取自 `resolveAuthConfig()`。

### 3.3 机器校验
- `bun run typecheck`、`bun test`（含 key-parity，本次无 i18n 改动应不受影响）。
- 改了打包相关配置时跑 `dist:fast` 冒烟（本 spec 预期不改打包配置）。

---

## 4. 非目标（YAGNI）

- **不加任何新 UI / 设置项** → 本次**零 i18n 改动**（token 来自登录、源自动入矩阵，无面向用户文案）。
- 不做 PDF 下载 / 全文 read（`/journal` 同 OpenAlex，不托管全文）。
- 不做 journal 专属过滤参数（期刊名 / venue 过滤等）的 UI 暴露 —— 本次只接入"作为一个检索源"。
- **token 会话中过期重注入**：v1 在 agent 启动时注入新鲜 token（~15min TTL 覆盖典型检索）；中途 401 时连接器返回 `[]` 优雅降级，不做会话中途重注入。
- 不使用临时测试 token 路径。

---

## 5. 受影响文件清单

| 文件 | 改动 |
|------|------|
| `apps/electron/resources/paper-search-mcp/paper_search/connectors/journal.py` | 新增连接器 |
| `apps/electron/resources/paper-search-mcp/paper_search/connectors/openalex.py` | 最小重构：`SOURCE_NAME` 类属性 |
| `apps/electron/resources/paper-search-mcp/paper_search/service/search_service.py` | `retrieve()` 已注册时自动并入 `"journal"`（§2.6）；retrieve fan-out 对未注册源静默跳过、不计失败源 |
| `apps/electron/resources/paper-search-mcp/paper_search/connectors/test_journal.py` | 新增测试 |
| `apps/electron/src/main/lib/agent-orchestrator.ts` | env 注入 token + base URL |
| `apps/electron/src/main/lib/auth-service.ts` | 新增主进程内部取 token 方法 |
| (可能) `apps/electron/src/main/lib/auth-opensci-client.ts` | 导出 `resolveAuthConfig` / base URL（若尚未可复用） |

---

## 6. 验收

1. 登录态下发起一次文献检索，journal 源参与召回、结果 `source` 为 `journal`、能命中期刊语料。
2. 未登录时文献检索正常（journal 静默缺席，无报错、无失败源计数异常）。
3. `bun run typecheck` + `bun test` 通过。
4. Bearer token 不经任何代理、不暴露到渲染进程。

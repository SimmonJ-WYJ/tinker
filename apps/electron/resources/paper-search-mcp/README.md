# Paper Search

> **Refactored from [openags/paper-search-mcp](https://github.com/openags/paper-search-mcp)** — original project by P.S Zhang, MIT licensed.
>
> This project **refactors the original into a service architecture**, decoupling business logic from the MCP protocol into an independent service layer, usable directly as a **Python library** or as an **MCP Server** for Claude Desktop and other LLM clients.

A paper search, download, and export service supporting **20+ academic platforms**.

![Python](https://img.shields.io/badge/python-3.10+-blue.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Pydantic v2](https://img.shields.io/badge/pydantic-v2-green.svg)

---

<a id="特性"></a>

## Features

- **20+ academic sources** — arXiv, PubMed, Semantic Scholar, Crossref, OpenAlex, Google Scholar, and more
- **Three-layer architecture** — Connectors → Service → Transport, with clear separation of concerns
- **Plug and play** — one file adds a platform, with automatic registration and zero configuration
- **Dual usage modes** — both Python library (`from paper_search import PaperSearchService`) and MCP Server
- **Pydantic data models** — type-safe and serialization-friendly
- **Concurrent multi-source search + automatic deduplication** — based on DOI / title+authors
- **6-stage intelligent download fallback** — direct pdf_url → source-native download → OA resolver (Unpaywall/OpenAlex/Semantic) → OA repository search (with identity verification) → DOI landing-page HTML extraction → Sci-Hub (optional)
- **Citation network tracing** — Snowball search with recursive forward/backward citations (depth 1-3)
- **Multiple export formats** — CSV, RIS (Zotero/Mendeley/EndNote), BibTeX

---

<a id="架构"></a>

## Architecture

```
paper_search/
├── models/          # Pydantic models (Paper, SearchResult, SnowballResult)
├── connectors/      # Platform connectors (@register auto-registration)
│   ├── base.py      #   Abstract PaperConnector base class
│   ├── registry.py  #   Connector registry (auto-discovery)
│   ├── arxiv.py     #   arXiv connector
│   ├── semantic.py  #   Semantic Scholar connector
│   └── ...          #   25+ connectors
├── service/         # Business orchestration (transport-independent)
│   ├── search_service.py    # Multi-source search + Snowball
│   ├── download_service.py  # Download fallback chain
│   └── export_service.py    # CSV/RIS/BibTeX export
├── transports/      # Transport adapters
│   └── mcp_server.py        # MCP Server (thin wrapper)
├── config.py        # Environment-variable management
└── utils.py         # Utilities
```

<a id="mcp-工具一览"></a>

### MCP Tool Overview

The MCP Server exposes these tools to LLMs:

| Tool | Description |
|------|------|
| `search_papers` | Concurrent multi-source search (`sources` selects sources) |
| `search_<source>` | Single-source search (automatically generated per registered source, e.g. `search_arxiv`, `search_crossref`) |
| `download_paper` | **Unified download entry point**, supporting `source`, `paper_id`, `doi`, `title`, `pdf_url`, with automatic 6-stage fallback |
| `download_scihub` | Dedicated Sci-Hub download (separate tool) |
| `snowball_search` | Citation network tracing (forward/backward citations) |
| `recommend_papers` | Embedding-based similar-paper recommendations |
| `get_crossref_paper_by_doi` | Exact DOI lookup |
| `read_<source>_paper` | Download and extract PDF text (generated per source supporting read) |
| `process_search_results` | Deduplicate multi-source results + complete abstracts + write session JSONL |
| `export_papers` | Export CSV / RIS / BibTeX |

<a id="下载回退链"></a>

### Download Fallback Chain

`download_paper` uses 6 fallback stages, trying each until successful:

```
Stage 0: direct pdf_url download (fastest when caller knows PDF URL)
Stage 1: source-native connector download (e.g. arxiv.org/pdf/xxx)
Stage 2: concurrent OA resolvers (Unpaywall + OpenAlex + Semantic Scholar + CrossRef TDM)
Stage 3: OA repository title search (OpenAIRE → CORE → EuropePMC → PMC, DOI/title identity checks)
Stage 4: DOI landing-page HTML extraction (citation_pdf_url meta + PDF links in body)
Stage 5: Sci-Hub (optional; disable with use_scihub=false)
```

Stage 3 adds **paper identity verification**: download only if DOI matches or title similarity passes the threshold (Jaccard ≥ 0.6), avoiding different papers with similar titles.

<a id="与原项目的区别"></a>

### Differences from the Original

| Aspect | Original (paper-search-mcp) | This project (paper-search) |
|------|--------------------------|----------------------|
| Architecture | Single server.py file (1570 lines) | Three layers with separated responsibilities |
| Data models | dataclass | Pydantic v2 |
| Reusability | MCP calls only | Importable library |
| Adding a platform | Change 5 code locations | Write only 1 file |
| Platform dispatch | 20+ if/elif branches | Automatic @register registration |
| Tests | Must start MCP Server | Test Service layer directly |

---

<a id="支持的数据源"></a>

## Supported Sources

<a id="免费开放数据源无需-api-key"></a>

### Free Open Sources (No API Key Required)

| Platform | Search | Download | Read | Description |
|------|:----:|:----:|:----:|------|
| arXiv | ✅ | ✅ | ✅ | Preprints covering physics/CS/mathematics, etc. |
| PubMed | ✅ | - | - | Biomedical literature metadata |
| bioRxiv | ✅ | ✅ | ✅ | Biology preprints |
| medRxiv | ✅ | ✅ | ✅ | Medical preprints |
| Crossref | ✅ | - | - | DOI metadata backbone |
| OpenAlex | ✅ | - | - | Open scholarly knowledge graph |
| Europe PMC | ✅ | ✅ | ✅ | European biomedical OA |
| PubMed Central | ✅ | ✅ | ✅ | NIH OA full text |
| dblp | ✅ | - | - | Computer-science bibliography |
| IACR | ✅ | ✅ | ✅ | Cryptography preprints |
| HAL | ✅ | ✅ | ✅ | French open archive |
| SSRN | ✅ | ⚠️ | ⚠️ | Social-science preprints (best-effort) |
| ChemRxiv | ✅ | ✅ | ✅ | Chemistry preprints |

<a id="可选-api-key-数据源免费申请提升速率"></a>

### Sources with Optional API Keys (Free Registration, Higher Rate Limits)

| Platform | Environment variable | Registration URL |
|------|---------|---------|
| Semantic Scholar | `PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY` | [semanticscholar.org](https://www.semanticscholar.org/product/api) |
| CORE | `PAPER_SEARCH_MCP_CORE_API_KEY` | [core.ac.uk](https://core.ac.uk/services/api) |
| DOAJ | `PAPER_SEARCH_MCP_DOAJ_API_KEY` | [doaj.org](https://doaj.org/apply-for-api-key/) |
| Zenodo | `PAPER_SEARCH_MCP_ZENODO_ACCESS_TOKEN` | [zenodo.org](https://zenodo.org/account/settings/applications/) |
| Unpaywall | `PAPER_SEARCH_MCP_UNPAYWALL_EMAIL` | [unpaywall.org](https://unpaywall.org/products/api) |
| Google Scholar | `PAPER_SEARCH_MCP_GOOGLE_SCHOLAR_PROXY_URL` | Supply your own proxy |
| OpenAIRE | `PAPER_SEARCH_MCP_OPENAIRE_API_KEY` | [openaire.eu](https://develop.openaire.eu/) |
| CiteSeerX | `PAPER_SEARCH_MCP_CITESEERX_API_KEY` | - |

<a id="付费受限数据源需-api-key-激活"></a>

### Paid/Restricted Sources (API Key Required to Activate)

| Platform | Environment variable | Description |
|------|---------|------|
| IEEE Xplore | `PAPER_SEARCH_MCP_IEEE_API_KEY` | Automatically disabled without a key |
| ACM Digital Library | `PAPER_SEARCH_MCP_ACM_API_KEY` | Automatically disabled without a key |

---

<a id="快速开始"></a>

## Quick Start

<a id="安装"></a>

### Installation

```bash
# 克隆项目
git clone https://github.com/its-antony/paper-search.git
cd paper-search

# 安装依赖（自动创建虚拟环境）
uv sync

# 如果需要 MCP Server 功能
uv sync --extra mcp
```

<a id="作为-python-库使用"></a>

### Use as a Python Library

```python
import asyncio
from paper_search import PaperSearchService

async def main():
    svc = PaperSearchService()

    # 多源并发搜索
    result = await svc.search(
        "real world assets tokenization",
        sources="crossref,openalex,arxiv",
        max_results_per_source=5,
    )

    for paper in result.papers:
        print(f"{paper.title} ({paper.source})")
        print(f"  DOI: {paper.doi}")

asyncio.run(main())
```

<a id="引文网络追踪snowball-search"></a>

### Citation Network Tracing (Snowball Search)

```python
async def snowball_demo():
    svc = PaperSearchService()

    result = await svc.snowball(
        paper_id="DOI:10.1038/nature12373",
        direction="both",      # forward + backward
        depth=2,               # 2 层递归
        max_results_per_direction=10,
    )
    print(f"发现 {result.total} 篇相关论文")
```

<a id="下载与导出"></a>

### Download and Export

```python
from paper_search.service import DownloadService, ExportService
from paper_search.connectors.registry import ConnectorRegistry

async def download_and_export():
    reg = ConnectorRegistry()
    dl = DownloadService(registry=reg)
    export = ExportService()

    # 下载论文 PDF（6 阶段自动回退链）
    path = await dl.download(
        source="arxiv",
        paper_id="2106.12345",
        doi="10.48550/arXiv.2106.12345",       # 用于 OA resolver 和 HTML 提取
        title="Paper Title",                     # 用于仓库搜索（含身份校验）
        pdf_url="https://arxiv.org/pdf/2106.12345.pdf",  # 最高优先级直链
        save_path="./downloads",
    )

    # 导出搜索结果
    svc = PaperSearchService()
    result = await svc.search("blockchain finance", sources="crossref")
    export.export(result.papers, format="bibtex", save_path="./exports")
```

<a id="作为-mcp-server-使用"></a>

### Use as an MCP Server

<a id="claude-desktop-配置"></a>

#### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "paper-search": {
      "command": "uv",
      "args": [
        "run", "--directory", "/path/to/paper-search",
        "-m", "paper_search.transports.mcp_server"
      ],
      "env": {
        "PAPER_SEARCH_MCP_UNPAYWALL_EMAIL": "your@email.com",
        "PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY": ""
      }
    }
  }
}
```

<a id="claude-code-cli-配置"></a>

#### Claude Code (CLI) Configuration

```bash
# 添加为全局 MCP Server（所有项目可用）
claude mcp add --scope user paper-search -- \
  uv run --directory /path/to/paper-search -m paper_search.transports.mcp_server

# 或仅当前项目可用
claude mcp add paper-search -- \
  uv run --directory /path/to/paper-search -m paper_search.transports.mcp_server

# 如需配置 API Key
claude mcp add --scope user paper-search \
  -e PAPER_SEARCH_MCP_UNPAYWALL_EMAIL=your@email.com \
  -e PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY=sk-xxx \
  -- uv run --directory /path/to/paper-search -m paper_search.transports.mcp_server
```

Restart Claude Code after adding it to use paper-search tools directly in conversations.

<a id="局域网-&#45;远程访问http-模式"></a>

#### LAN / Remote Access (HTTP Mode)

The MCP Server supports three transports: `stdio` (default), `sse`, `streamable-http`.

```bash
# 启动 HTTP 模式（局域网可访问）
uv run -m paper_search.transports.mcp_server --transport streamable-http --host 0.0.0.0 --port 8000

# 或 SSE 模式
uv run -m paper_search.transports.mcp_server --transport sse --host 0.0.0.0 --port 8000
```

Claude Code on other machines connects through a URL:

```bash
claude mcp add --scope user paper-search --transport http http://192.168.x.x:8000/mcp
```

---

<a id="配置"></a>

## Configuration

Put API keys in the project-root `.env` file (loaded automatically on startup):

```bash
cp .env.example .env
# 编辑 .env 填入你的 key
```

All environment variables use the `PAPER_SEARCH_MCP_` prefix, with backward compatibility for the original unprefixed names.

---

<a id="扩展新平台"></a>

## Adding a Platform

Adding an academic source requires only **1 file**:

```python
# paper_search/connectors/my_platform.py
from ..models.paper import Paper
from .base import PaperConnector, ConnectorCapabilities
from .registry import register

@register("my_platform")
class MyPlatformConnector(PaperConnector):
    capabilities = ConnectorCapabilities(search=True, download=True, read=False)

    def search(self, query: str, max_results: int = 10, **kwargs):
        # 你的搜索逻辑
        return [Paper(paper_id="...", title="...", source="my_platform")]

    def download_pdf(self, paper_id: str, save_path: str) -> str:
        # 你的下载逻辑
        return f"{save_path}/{paper_id}.pdf"
```

**No other files need changes** — Registry discovers it, Service includes it, and MCP registers tools automatically.

---

<a id="开发"></a>

## Development

```bash
# 安装开发依赖
uv sync --extra dev --extra mcp

# 运行单元测试
uv run pytest tests/ -v --ignore=tests/benchmark

# 运行基准测试（真实 API 调用，约 15 分钟）
uv run pytest tests/benchmark/ -v

# 仅搜索基准（约 1.5 分钟）
uv run pytest tests/benchmark/test_search_benchmark.py -v

# 仅下载基准（约 13 分钟）
uv run pytest tests/benchmark/test_download_benchmark.py -v

# 启动 MCP Server（stdio 模式）
uv run paper-search-mcp

# 启动 MCP Server（HTTP 模式，局域网可访问）
uv run paper-search-mcp --transport streamable-http --host 0.0.0.0 --port 8000
```

Benchmarks automatically generate reports in `docs/benchmark-reports/` (JSON + Markdown), including success rates by source/difficulty and fallback-stage distributions.

---

<a id="致谢"></a>

## Acknowledgments

- Original project [openags/paper-search-mcp](https://github.com/openags/paper-search-mcp), developed by [P.S Zhang](https://github.com/openags)
- This project refactors it into a service architecture, retaining all platform-connector business logic

<a id="许可证"></a>

## License

MIT License — see [LICENSE](LICENSE).

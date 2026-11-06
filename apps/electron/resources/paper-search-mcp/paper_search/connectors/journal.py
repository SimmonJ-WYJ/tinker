"""OPENSCI /journal 期刊语料检索连接器。

/journal 与 OpenAlex /works 完全兼容（同样的 search/filter/sort/cursor 语法、
同样的 Work 响应形状），故直接子类化 OpenAlexConnector 复用其全部解析逻辑，
仅：(1) 换 BASE_URL 到 /journal；(2) 加 Authorization: Bearer 头；(3) source=journal。

认证：token 由主进程登录态注入到 env（PAPER_SEARCH_MCP_JOURNAL_ACCESS_TOKEN）。
requires_key 门控 → 未登录（无 token）时注册表不实例化本连接器，journal 静默缺席。

安全：私有鉴权接口必须用普通 requests.Session，禁止 OpenAlex 那套
ProxyFallbackSession——Bearer token 绝不能走公共代理回退泄漏。
"""
import requests

from ..config import get_env
from .base import ConnectorCapabilities
from .openalex import OpenAlexConnector
from .registry import register

# 默认指向已上线测试环境；主进程会用 PAPER_SEARCH_MCP_JOURNAL_BASE_URL 覆盖
# （取自 auth-config 的 asciServerBaseUrl，dev 可切 localhost:6060）。
_DEFAULT_JOURNAL_BASE_URL = "https://asci-test.opensci.io/journal"


@register("journal")
class JournalConnector(OpenAlexConnector):
    """OPENSCI /journal（OpenAlex-/works 兼容）期刊检索。"""

    capabilities = ConnectorCapabilities(
        search=True, download=False, read=False, requires_key="JOURNAL_ACCESS_TOKEN"
    )
    SOURCE_NAME = "journal"

    def __init__(self) -> None:
        # 不调用 super().__init__()：父类会建 ProxyFallbackSession，本连接器禁用代理回退。
        self.BASE_URL = get_env("JOURNAL_BASE_URL", _DEFAULT_JOURNAL_BASE_URL)
        token = get_env("JOURNAL_ACCESS_TOKEN", "")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "paper-search-mcp/1.0 (mailto:asci@opensci.io)",
                "Authorization": f"Bearer {token}",
            }
        )

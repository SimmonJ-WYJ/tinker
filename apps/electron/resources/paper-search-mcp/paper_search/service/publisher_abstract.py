"""出版社 landing page 摘要末位兜底（issue #685）。

职责：当结构化元数据源（Semantic Scholar / OpenAlex / Crossref / Europe PMC）
都补不到摘要时，从论文 DOI 跳转的出版社页面里**只抽高置信元数据**（HTML meta
标签 / JSON-LD 的 description），绝不做 HTML 正文区块启发式——避免误抓 access
options / 导航 / 参考文献 / 图注。

边界（用户硬约束）：单次尝试、无重试、硬超时；不下载 PDF、不做全文抽取；
任何异常 / 非 200 / 被拦截 → 返回 ""（优雅失败，由上层回落到"摘要不可获取"）。

拆两层便于脱网单测：
- extract_abstract_from_html(html) —— 纯解析，无网络，单测主力。
- fetch_abstract_from_landing_page(doi) —— 带网络抓取，内部调上面的解析。
"""
from __future__ import annotations

import html as html_lib
import json
import logging
import re
from typing import Any, Optional

import requests
from bs4 import BeautifulSoup

from ..connectors.http_proxy import ProxyFallbackSession

logger = logging.getLogger(__name__)

# #743：出版社页面抓取用 ProxyFallbackSession，在 enrich 代理上下文内自动走
# 「直连优先 + 失败回退代理」；上下文外（不会发生，本函数仅 enrich 末位兜底调用）
# 则等价于普通 requests.Session。模块级单例，复用连接池。
_SESSION = ProxyFallbackSession()

# 接受为摘要的最小长度（字符）。挡掉标语 / "Access options" 短文案 / 截断版
# og:description；出版社的真实摘要普遍 ≥ 此值。
MIN_ABSTRACT_LEN = 150

# 单次下载的最大字节数：出版社页面可能很大（实测 Nature ~320KB），读够解析
# meta/JSON-LD 即截断，避免把整页正文 / 内联资源全下载下来。
MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024  # 2MB

# 浏览器风格 UA：部分出版社对非浏览器 UA 直接 403；实测 Nature 用此 UA 放行。
_USER_AGENT = (
    "Mozilla/5.0 (compatible; paper-search-mcp/1.0; +mailto:asci@opensci.io)"
)

# JSON-LD 里被视为"学术文章"的 @type，命中才取其 description。
_ARTICLE_LD_TYPES = {
    "article",
    "scholarlyarticle",
    "report",
    "creativework",
    "medicalscholarlyarticle",
}


def _clean(text: str) -> str:
    """解 HTML 实体 + 规整空白；返回去首尾空白的纯文本。"""
    if not text:
        return ""
    unescaped = html_lib.unescape(text)
    return re.sub(r"\s+", " ", unescaped).strip()


def _meta_content(soup: BeautifulSoup, *, name: Optional[str] = None,
                  prop: Optional[str] = None) -> str:
    """按 name= 或 property= 取 <meta> 的 content（大小写不敏感匹配 name）。"""
    if name is not None:
        tag = soup.find("meta", attrs={"name": re.compile(rf"^{re.escape(name)}$", re.I)})
    else:
        tag = soup.find("meta", attrs={"property": prop})
    if tag is None:
        return ""
    return _clean(tag.get("content") or "")


def _iter_ld_descriptions(node: Any):
    """递归遍历 JSON-LD 结构，yield (article_typed, description) 候选。"""
    if isinstance(node, dict):
        types = node.get("@type")
        type_set = set()
        if isinstance(types, str):
            type_set = {types.lower()}
        elif isinstance(types, list):
            type_set = {t.lower() for t in types if isinstance(t, str)}
        desc = node.get("description")
        if isinstance(desc, str) and desc.strip():
            yield (bool(type_set & _ARTICLE_LD_TYPES), desc)
        # @graph / 嵌套对象继续下钻
        for value in node.values():
            if isinstance(value, (dict, list)):
                yield from _iter_ld_descriptions(value)
    elif isinstance(node, list):
        for item in node:
            yield from _iter_ld_descriptions(item)


def _jsonld_description(soup: BeautifulSoup) -> str:
    """从 <script type="application/ld+json"> 抽 Article 节点的 description。
    优先返回 @type 命中学术文章的；否则返回任一足够长的 description。"""
    fallback = ""
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = script.string or script.get_text() or ""
        if not raw.strip():
            continue
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            continue
        for is_article, desc in _iter_ld_descriptions(data):
            cleaned = _clean(desc)
            if len(cleaned) < MIN_ABSTRACT_LEN:
                continue
            if is_article:
                return cleaned
            if not fallback:
                fallback = cleaned
    return fallback


def extract_abstract_from_html(html_text: str) -> str:
    """从出版社页面 HTML **按置信度顺序**抽摘要；抽不到高置信摘要返回 ""。

    顺序（命中且长度 ≥ MIN_ABSTRACT_LEN 即返回）：
      1. <meta name="citation_abstract">      —— Highwire，Springer/Wiley 等通用
      2. <meta name="dcterms.abstract" | "dc.description">  —— Nature 实测全文摘要
      3. JSON-LD 的 description（@type 命中 Article 优先）
      4. <meta name="description"> / og:description —— 低置信，仍需 ≥ 阈值
    """
    if not html_text:
        return ""
    try:
        soup = BeautifulSoup(html_text, "html.parser")
    except Exception as exc:  # 解析器异常也优雅失败
        logger.debug("publisher-html 解析失败: %s", exc)
        return ""

    # 按置信度从高到低的候选抽取器；首个命中且长度 ≥ MIN_ABSTRACT_LEN 即返回。
    extractors = (
        lambda: _meta_content(soup, name="citation_abstract"),  # 1) Highwire（最高置信）
        lambda: _meta_content(soup, name="dcterms.abstract"),   # 2) Dublin Core
        lambda: _meta_content(soup, name="dc.description"),
        lambda: _meta_content(soup, name="dc.abstract"),
        lambda: _jsonld_description(soup),                      # 3) JSON-LD
        lambda: _meta_content(soup, name="description"),        # 4) 通用（低置信，长度门槛挡标语）
        lambda: _meta_content(soup, prop="og:description"),
    )
    for extract in extractors:
        candidate = extract()
        if len(candidate) >= MIN_ABSTRACT_LEN:
            return candidate
    return ""


def fetch_abstract_from_landing_page(doi: str, timeout: float = 8.0) -> str:
    """跟随 https://doi.org/{doi} 跳转到出版社页面，抽高置信摘要；失败返回 ""。

    单次尝试、无重试；限下载体积；任何异常 / 非 200 → 返回 ""。
    """
    doi = (doi or "").strip()
    if not doi:
        return ""
    url = f"https://doi.org/{doi}"
    try:
        resp = _SESSION.get(
            url,
            headers={"User-Agent": _USER_AGENT, "Accept": "text/html"},
            timeout=timeout,
            allow_redirects=True,
            stream=True,
        )
    except requests.RequestException as exc:
        logger.debug("publisher-html 抓取 %s 失败: %s", doi, exc)
        return ""

    try:
        if resp.status_code != 200:
            logger.debug("publisher-html %s 返回非 200: %s", doi, resp.status_code)
            return ""
        ctype = (resp.headers.get("Content-Type") or "").lower()
        if "html" not in ctype:
            return ""  # 不是 HTML（PDF / JSON 等）直接放弃，不下载
        # 限体积读取：累计到上限即停。
        chunks: list[bytes] = []
        total = 0
        for chunk in resp.iter_content(chunk_size=65536):
            if not chunk:
                continue
            chunks.append(chunk)
            total += len(chunk)
            if total >= MAX_DOWNLOAD_BYTES:
                break
        encoding = resp.encoding or "utf-8"
        html_text = b"".join(chunks).decode(encoding, errors="replace")
    except requests.RequestException as exc:
        logger.debug("publisher-html 读取 %s 失败: %s", doi, exc)
        return ""
    finally:
        resp.close()

    return extract_abstract_from_html(html_text)

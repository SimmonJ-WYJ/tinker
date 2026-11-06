import re


def extract_doi(text: str) -> str:
    """Extract DOI from arbitrary text or URL if present."""
    if not text:
        return ""
    match = re.search(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+", text, re.IGNORECASE)
    return match.group(0).rstrip(".,;)") if match else ""


# DOI 归一：小写 + 剥常见前缀，供 seed exact lookup 两侧比较用
# （planner 给的 seed DOI 常带 https://doi.org/ 或 doi: 前缀，连接器解析出的 DOI 是裸串，
#  不归一会导致 `10.1126/science.1225829` 与 `https://doi.org/10.1126/science.1225829` 比不中）
_DOI_PREFIXES = ("https://doi.org/", "http://doi.org/", "https://dx.doi.org/",
                 "http://dx.doi.org/", "doi:")


def normalize_doi(doi: str) -> str:
    """归一 DOI：strip + lower，并剥掉 https://doi.org/ / dx.doi.org / doi: 等前缀。"""
    normalized = (doi or "").strip().lower()
    for prefix in _DOI_PREFIXES:
        if normalized.startswith(prefix):
            return normalized[len(prefix):]
    return normalized

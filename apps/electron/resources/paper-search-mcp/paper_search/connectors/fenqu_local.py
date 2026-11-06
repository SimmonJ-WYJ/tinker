"""本地期刊分区 / 影响因子查询(取代 EasyScholar 在线 API)。

数据源:``packages/shared/src/constants/fenqu_simple_2025.json`` —— 跨包共享常量目录,
数组,每条 ``{"title": <刊名>, "cas": "1"|null, "cas_es": "材料科学1区"|null,
"jcr": "Q1"|...|null, "impact_factor": "5.1"|null}``(2025 版,约 2.2 万条)。
含 JCR 分区 + 影响因子 + 中科院分区升级版(``cas_es``,全称)。

替换 EasyScholar 的理由:离线、零网络延迟、无 API key / 无 403 限流;命中率对
SCI 收录刊更稳。匹配按"折叠空白 + 小写"归一化,大小写不敏感。

路径解析(``_resolve_fenqu_path``)按序尝试:
  ① 环境变量 ``PAPER_SEARCH_MCP_FENQU_PATH`` 显式覆盖;
  ② 包内副本 ``paper_search/constants/fenqu_simple_2025.json`` —— 打包时由
     electron-builder extraResources 从 shared/constants 复制进来(打包态用);
  ③ 向上查找仓库根下 ``packages/shared/src/constants/...`` —— dev 态用(源唯一)。
"""
from __future__ import annotations

import functools
import json
import os
from typing import Iterable, Optional

_FENQU_REL = ("packages", "shared", "src", "constants", "fenqu_simple_2025.json")


def _norm(name: Optional[str]) -> str:
    """与 process_service._norm_venue_key 一致:折叠空白 + 小写。"""
    return " ".join((name or "").split()).lower()


def _resolve_fenqu_path() -> Optional[str]:
    """定位 fenqu json:① 环境变量覆盖;② 包内副本(打包态);③ 向上查找仓库根下的
    packages/shared/src/constants/...(dev 态)。找不到返回 None。"""
    env = os.environ.get("PAPER_SEARCH_MCP_FENQU_PATH")
    if env and os.path.isfile(env):
        return env
    # ② 包内副本:打包时 electron-builder 把 shared/constants 的文件复制到
    #    paper_search/constants/ 下(见 electron-builder.yml extraResources)。
    here = os.path.dirname(os.path.abspath(__file__))
    bundled = os.path.join(here, "..", "constants", "fenqu_simple_2025.json")
    if os.path.isfile(bundled):
        return os.path.abspath(bundled)
    # ③ dev:从本文件向上逐级找仓库根下的 packages/shared/src/constants/...
    cur = here
    for _ in range(10):
        cand = os.path.join(cur, *_FENQU_REL)
        if os.path.isfile(cand):
            return cand
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return None


@functools.lru_cache(maxsize=1)
def _load_index() -> dict[str, dict]:
    """加载 fenqu json → {归一化刊名: row};找不到 / 失败返回空表。"""
    path = _resolve_fenqu_path()
    if not path:
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            rows = json.load(f)
    except Exception:
        return {}
    index: dict[str, dict] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = _norm(row.get("title"))
        if key:
            index.setdefault(key, row)  # 首次出现优先
    return index


def lookup_journal_rank(name: Optional[str]) -> Optional[dict]:
    """按刊名查本地分区表。

    Returns:
        命中 → journalRank dict(与原 EasyScholar 写盘结构一致):
            {"impactFactor", "impactFactor5Year", "casPartition", "jcrPartition"}
            （casPartition 取本地 ``cas_es`` 中科院分区升级版全称;本地源无 5 年 IF,恒 None）;
        未命中 → None。
    """
    row = _load_index().get(_norm(name))
    if not row:
        return None
    return {
        "impactFactor": row.get("impact_factor"),
        "impactFactor5Year": None,
        "casPartition": row.get("cas_es") or None,
        "jcrPartition": row.get("jcr"),
    }


def dedupe_venues(venues: Iterable[Optional[str]]) -> list[str]:
    """对检索到的期刊名去重(查本地分区表前先去重)。

    规则：去首尾空白、折叠内部空白、忽略大小写判重；保留首次出现的原始写法。
    空 / None 跳过。

    Args:
        venues: 期刊名集合（可含 None / 空串 / 重复 / 大小写不一）。

    Returns:
        去重后的期刊名列表，顺序为首次出现顺序。
    """
    seen: set[str] = set()
    unique: list[str] = []
    for raw in venues:
        if not raw or not raw.strip():
            continue
        normalized = " ".join(raw.split())
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(normalized)
    return unique

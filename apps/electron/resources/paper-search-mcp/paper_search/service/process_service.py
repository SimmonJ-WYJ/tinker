"""搜索结果处理服务：去重 + 摘要补全 + 写入 PaperRecord JSONL。

从 _process_results.py CLI 脚本中抽取核心逻辑，供 MCP tool 和 CLI 共用。
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .scoring import MISSING_ABSTRACT_CAP

logger = logging.getLogger(__name__)


# ===== 去重 key 生成（与 ASCI 主进程 recordKey 一致） =====

def record_key(paper: dict) -> Optional[str]:
    """生成论文去重 key，优先级：DOI > paperId > arxivId > pmid > openalexId > title+year"""
    doi = (paper.get("doi") or "").strip().lower()
    if doi:
        return f"doi:{doi}"

    extra = paper.get("extra") or {}

    pid = extra.get("paperId") or extra.get("paper_id") or ""
    if pid:
        return f"pid:{pid}"

    arx = extra.get("arxivId") or extra.get("arxiv_id") or ""
    if arx:
        return f"arx:{arx}"

    pmid = extra.get("pmid") or ""
    if pmid:
        return f"pmid:{pmid}"

    oa = extra.get("openalexId") or extra.get("openalex_id") or ""
    if oa:
        return f"oa:{oa}"

    title = (paper.get("title") or "").strip().lower()
    year = paper.get("year")
    if title and title not in ("(doi 片段)", "(无标题)") and year:
        return f"t:{title}|y:{year}"

    return None


# ===== MCP 返回格式 → PaperRecord 转换 =====

def to_paper_record(paper: dict, query: str, source_name: str) -> dict:
    """将 MCP 工具返回的单篇论文转为 PaperRecord 格式"""
    authors_raw = paper.get("authors") or ""
    if isinstance(authors_raw, str):
        authors = [a.strip() for a in authors_raw.split(";") if a.strip()] \
            if ";" in authors_raw \
            else [a.strip() for a in authors_raw.split(",") if a.strip()]
    elif isinstance(authors_raw, list):
        authors = list(authors_raw)
    else:
        authors = []

    year = paper.get("year")
    if year is None:
        date_str = paper.get("published_date") or ""
        if date_str and len(date_str) >= 4:
            try:
                year = int(date_str[:4])
            except ValueError:
                pass

    extra: dict = {}
    for field in ("paper_id", "paperId", "arxivId", "arxiv_id", "pmid",
                  "openalexId", "openalex_id", "pdf_url",
                  "published_date", "fields_of_study", "source"):
        val = paper.get(field)
        if val is not None and val != "":
            extra[field] = val

    # citations 字段：Pydantic 默认 0，部分源（arXiv/Google Scholar/IACR）不填即 0，
    # 与"真 0 引用"无法区分。仅在 > 0 时记录为 citedBy（前端约定字段名），避免 UI 误导。
    citations = paper.get("citations")
    if isinstance(citations, int) and citations > 0:
        extra["citedBy"] = citations

    # HTML 实体解码：crossref / openalex 等源返回的 title / venue / abstract 常含
    # &amp; / &lt; 等转义串（如 "Laser &amp; Optoelectronics Progress"），统一 unescape，
    # 避免面板显示错乱 + 影响 venue 的本地分区表匹配。
    return {
        "ts": datetime.now(timezone.utc).isoformat(),
        "query": query,
        "source": f"tool:MCP:paper-search:{source_name}",
        "title": html.unescape((paper.get("title") or "").strip()),
        "authors": authors,
        "year": year,
        "venue": html.unescape(paper.get("venue") or "") or None,
        "doi": paper.get("doi") or None,
        "url": paper.get("url") or None,
        "abstract": html.unescape((paper.get("abstract") or "").strip()) or None,
        "extra": extra if extra else None,
    }


# ===== Fuzzy title 去重（P1-1，第二层兜底）=====
#
# 背景：record_key 是精确去重（DOI / paperId / arxivId / pmid / openalexId）。
# 但 OpenAlex 会把同一篇论文的期刊版 vs 会议版当作两个独立 work id，
# arxiv preprint 与 ACL/NeurIPS 正式收录版也是两个 DOI。第一层精确去重
# 看到的是 N 条不同 key 的 record，不会合并 — RotateKV / Long Range Arena /
# HiRoPE 这类双载体上一次实测都各占了 Top 50 两个名额。
# 第二层 fuzzy dedup：title 归一化后严格相等 / prefix subset 视为同篇；
# 合并时保留信号最强的一条（citedBy 多 → venue 非空 → year 新）。
# 关键边界：后缀白名单（v2 / Revisited / Extended / ...）视为真续作，
# 保留两条 — 否则会把 "LongRoPE v2" 误并到 "LongRoPE"。

# 后缀白名单：归一化后差异部分若以这些字符串开头（或完全等于），视为续作不合并。
# 保持小写、含前导空格（与归一化输出对齐）。新增时保持稳定性。
_SUFFIX_WHITELIST = (
    " extended", " revisited", " v2", " v3", " v4",
    " improved", " continued", " ii", " iii", " 2", " 3",
)


def _normalize_title(t: str) -> str:
    """title 归一化：lower + 去标点 + 折叠空格。"""
    s = (t or "").lower().strip()
    s = "".join(c if c.isalnum() or c.isspace() else " " for c in s)
    return " ".join(s.split())


def _bounded_levenshtein(a: str, b: str, max_dist: int) -> int:
    """Levenshtein 距离，一旦确定 > max_dist 立即短路返回 max_dist + 1。
    标题很短（≤ ~200 字符）且只在通过长度差预筛的少数对上调用，开销可忽略。"""
    la, lb = len(a), len(b)
    if abs(la - lb) > max_dist:
        return max_dist + 1
    prev = list(range(lb + 1))
    for i in range(1, la + 1):
        cur = [i] + [0] * lb
        row_min = cur[0]
        ca = a[i - 1]
        for j in range(1, lb + 1):
            cost = 0 if ca == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if cur[j] < row_min:
                row_min = cur[j]
        if row_min > max_dist:
            return max_dist + 1  # 整行都超阈值，后续不可能回落
        prev = cur
    return prev[lb]


def _titles_near_equal(t1: str, t2: str) -> bool:
    """无 prefix 关系时的兜底：标题极相似（源端 OCR 错字 / 变音符号 / 个别拼写
    差异）视为同篇。保守判定，避免误并不同论文：
      - 双方都足够长（≥ 16 字符），排除短标题巧合；
      - 长度差 ≤ 2（原地替换/个别增删，而非真续作的成段后缀）；
      - Levenshtein 距离 ≤ 阈值（随长度分档：<60→1, <140→2, 否则 3）。
    边界：语义相反的单词翻转（Long↔Short）编辑距离远超阈值，不会误并。"""
    short, long_ = (t1, t2) if len(t1) <= len(t2) else (t2, t1)
    if len(short) < 16:
        return False
    if len(long_) - len(short) > 2:
        return False
    n = len(long_)
    threshold = 1 if n < 60 else 2 if n < 140 else 3
    return _bounded_levenshtein(t1, t2, threshold) <= threshold


def _titles_likely_same(t1: str, t2: str) -> bool:
    """归一化 title 是否属于同一篇论文。

    判定顺序：
    1. 严格相等 → 同篇
    2. 一方是另一方的 prefix（按空格分词边界）:
       - 差异部分匹配后缀白名单 → 视为续作，不合并
       - 否则若短/长 ≥ 0.5 → 同篇（防止极短词误配长 title）
    3. 无 prefix 关系但原地字符级差异极小（OCR 错字 / 变音符号）→ 同篇
    4. 其它 → 不同篇
    """
    if not t1 or not t2:
        return False
    if t1 == t2:
        return True
    short, long_ = (t1, t2) if len(t1) <= len(t2) else (t2, t1)
    # 路径 A：词边界 prefix（arxiv 简标题 ⊂ 正式版全标题），避免 "rope" 误配 "ropework"
    if long_.startswith(short + " "):
        diff = long_[len(short):]  # 含前导空格
        for suf in _SUFFIX_WHITELIST:
            # 完全等于白名单后缀，或以"白名单后缀+空格"开头（防止 "v2.0 supplement" 类误判）
            if diff == suf or diff.startswith(suf + " "):
                return False  # 续作后缀，保留两条
        if len(short) / len(long_) < 0.5:
            return False  # 短 title 太短，prefix 巧合可能性大
        return True
    # 路径 B：无 prefix 关系，但标题近乎相等（源端 OCR 错字 / 变音符号）
    return _titles_near_equal(t1, t2)


def _record_signal(r: dict) -> tuple:
    """记录的"信号强度"排序键：citedBy desc, venue 非空 desc, year desc。
    返回 tuple 用作 max() 的 key。"""
    extra = r.get("extra") or {}
    cb = extra.get("citedBy")
    cb = cb if isinstance(cb, (int, float)) and cb > 0 else 0
    venue_strong = 1 if (r.get("venue") or "").strip() else 0
    y = r.get("year") if isinstance(r.get("year"), int) else 0
    return (cb, venue_strong, y)


def _fuzzy_dedupe(records: list[dict]) -> list[dict]:
    """对 records 做 fuzzy title 去重。返回新列表，长度 ≤ 输入。"""
    if not records:
        return records
    # 按归一化 title 分组；组内合并为信号最强的一条
    # 顺序保留：first-seen 的归一化 title 决定组的位置
    groups: list[tuple[str, list[dict]]] = []
    no_title: list[dict] = []
    for r in records:
        t = _normalize_title(r.get("title") or "")
        if not t:
            no_title.append(r)
            continue
        matched_idx: Optional[int] = None
        for i, (key, _) in enumerate(groups):
            if _titles_likely_same(t, key):
                matched_idx = i
                break
        if matched_idx is not None:
            groups[matched_idx][1].append(r)
        else:
            groups.append((t, [r]))
    kept = [max(grp, key=_record_signal) for _, grp in groups]
    kept.extend(no_title)
    return kept


# ===== Crossref 非论文噪声过滤（#622）=====
#
# 背景：Crossref 把论文的 Figure / Table / 补充材料也分配独立 DOI 并作为
# 独立条目返回（标题形如 "Figure 3 from ..." / "Supplementary material for ..."）。
# 这些不是论文，是 Crossref 召回里的主要噪声形态，会挤占候选池并污染排序。
# 仅对 crossref 来源生效（其他源元数据干净，不动）；seed 永远豁免——核心论文
# 即便标题恰好含这些词（如 "Figure of merit ..."）也不能误删。
#
# 词边界匹配（\b）确保只命中独立词，不误杀正文词：
#   - "tabletop" / "stable" 含子串 "table" 但无词边界 → 不过滤
#   - "Fig." 缩写单独成段：用 `fig\.` 直接匹配句点（尾部不加 \b，否则
#     "Fig. 3" 中句点后接空格无词/非词边界，反而匹配失败）。
CROSSREF_NOISE_RE = re.compile(
    r"\bfig\.|\b(?:figure|table|supplementary|supplement|appendix)\b",
    re.IGNORECASE,
)


def _is_crossref_noise(record: dict) -> bool:
    """判定 record 是否为应过滤的 Crossref 非论文噪声（Figure/Table/补充材料等）。

    三道短路：seed 豁免 → 仅 crossref 来源 → 标题命中噪声词边界。
    """
    if (record.get("extra") or {}).get("seed"):
        return False
    source = (record.get("source") or "").lower()
    if "crossref" not in source:
        return False
    title = record.get("title") or ""
    return bool(CROSSREF_NOISE_RE.search(title))


# ===== 摘要补全 =====

# Enrich 调优旋钮（P0-1）。enrich 是检索关键路径上最大的单点耗时——对全部
# 无摘要论文分批补摘要。三个旋钮：
#   - BATCH_SIZE：每批并发篇数。10→16→默认 6（#743）：每篇 enrich 又向 4 个源
#     fan-out，16 批 = 最高 ~64 路并发连接，开着 VPN 时实测会把国际链路打到广泛
#     ReadTimeout、整批补 0（单篇直连本来 1s 就回）。收到 6（~24 路并发）显著降低
#     争用、抬高补全成功率；连接器自带 per-request 限速，并发降低只是更稳不会越权。
#     代价是批次变多、enrich 略慢，但 enrich 本就 best-effort，稳比快重要。env 可调。
#   - INTER_BATCH_SLEEP_SEC：批间强制等待。原 0.3s 是保守冗余（连接器已自限速），
#     默认收紧到 0。
#   - MAX_PAPERS：本轮最多补多少篇（0 = 不限）。给超大候选集兜底，避免长尾把
#     关键路径拖长；默认 0 不改变现有行为。
ENRICH_BATCH_SIZE = int(os.getenv("PAPER_SEARCH_ENRICH_BATCH_SIZE", "6"))
ENRICH_INTER_BATCH_SLEEP_SEC = float(
    os.getenv("PAPER_SEARCH_ENRICH_INTER_BATCH_SLEEP_SEC", "0")
)
ENRICH_MAX_PAPERS = int(os.getenv("PAPER_SEARCH_ENRICH_MAX_PAPERS", "0"))


async def enrich_missing_abstracts(
    records: list[dict],
    batch_size: Optional[int] = None,
    session_id: Optional[str] = None,
    config_dir: Optional[str] = None,
    turn_id: Optional[str] = None,
) -> int:
    """对无摘要的论文调用 paper_search.enrich_paper 补全，返回补全数量。

    #775：补摘要是 processing 阶段唯一真正耗时的事（去重是内存瞬时操作），逐批向 live 文件
    续写「已补 X / 需补 Y」进度（phase=processing），供面板显示「正在补全摘要（X/Y）」。
    仅在 no_abstract 非空后才写第一帧，杜绝 (0/0)；session_id 为空则全程不写（best-effort）。
    """
    try:
        from .search_service import PaperSearchService
        svc = PaperSearchService()
    except ImportError:
        return 0

    no_abstract = [r for r in records if not (r.get("abstract") or "").strip()]
    if not no_abstract:
        return 0

    # 数量上限兜底（0 = 不限）：保留输入顺序（≈ 源/相关度顺序）取前 N 篇。
    if ENRICH_MAX_PAPERS > 0 and len(no_abstract) > ENRICH_MAX_PAPERS:
        no_abstract = no_abstract[:ENRICH_MAX_PAPERS]

    batch_size = batch_size if batch_size is not None else ENRICH_BATCH_SIZE
    if batch_size < 1:
        batch_size = 1

    # #775：enrich 确认要跑，写第一帧 X=0/Y=待补总数，让面板从「整理候选」切到「补全摘要(0/Y)」。
    enrich_total = len(no_abstract)

    def _emit_processing(done: int) -> None:
        try:
            from .live_progress import write_processing_progress

            write_processing_progress(config_dir, session_id, turn_id, done, enrich_total)
        except Exception as _e:  # noqa: BLE001 — live 是增强不是关键路径
            logger.warning("[补摘要进度] live 续写失败（不影响 enrich）: %s", _e)

    _emit_processing(0)

    enriched_count = 0
    for i in range(0, len(no_abstract), batch_size):
        batch = no_abstract[i:i + batch_size]
        tasks = []
        for rec in batch:
            doi = rec.get("doi") or ""
            title = rec.get("title") or ""
            tasks.append(svc.enrich_paper(doi=doi, title=title))

        results = await asyncio.gather(*tasks, return_exceptions=True)
        for rec, result in zip(batch, results):
            if isinstance(result, Exception) or result is None:
                continue
            abstract = getattr(result, "abstract", "") or ""
            if abstract.strip():
                rec["abstract"] = abstract.strip()
                enriched_count += 1
                # 同时补全其他缺失字段
                if not rec.get("venue") and getattr(result, "venue", ""):
                    rec["venue"] = result.venue
                extra = rec.get("extra") or {}
                citations = getattr(result, "citations", None)
                if isinstance(citations, int) and citations > 0 and not extra.get("citedBy"):
                    extra["citedBy"] = citations
                pdf_url = getattr(result, "pdf_url", "")
                if pdf_url and not extra.get("pdf_url"):
                    extra["pdf_url"] = pdf_url
                rec["extra"] = extra if extra else None

        # #775：本批跑完，刷新进度。X=已处理篇数（跑完 enrich 的，非成功补到数——enrich 常
        # 有源未命中，成功数是质量结果不是进度，用它做分子永远到不了 Y、无法变绿）。最后一
        # 批后 X==Y → 面板转绿提示进入评分。
        _emit_processing(min(i + batch_size, enrich_total))

        # 速率控制：连接器内部已自带 per-request rate limit（Semantic Scholar
        # 5/2s base + 2^attempt 退避；OpenAlex/CrossRef 无显式限速），批间强制
        # 等待是保守冗余。默认收紧到 0（ENRICH_INTER_BATCH_SLEEP_SEC），需要时
        # 可经 env 调回；> 0 时仍只在批之间等待，不在最后一批后空等。
        if ENRICH_INTER_BATCH_SLEEP_SEC > 0 and i + batch_size < len(no_abstract):
            await asyncio.sleep(ENRICH_INTER_BATCH_SLEEP_SEC)

    # AC #5（#743）：大面积补全失败时不静默——给出网络/代理排查指引。逐源逐篇的
    # 选路/失败细节由 search_service 的 enrich 上下文记录（route=direct/proxy/*-failed），
    # 这里只在「攒了一批缺摘要却几乎一篇都没补上」时升一条 warning 把问题顶到面上。
    attempted = len(no_abstract)
    if attempted >= 5 and enriched_count == 0:
        logger.warning(
            "enrich 大面积未补全：%d 篇缺摘要论文无一补上，疑似网络/代理问题"
            "（开着系统代理时 enrich 源 TLS 可能间歇失败）。可设 "
            "PAPER_SEARCH_HTTP_PROXY_MODE=system 强制走代理，或 =direct 强制直连排查。",
            attempted,
        )
    elif attempted:
        logger.info("enrich 完成：%d 篇缺摘要中补上 %d 篇", attempted, enriched_count)

    return enriched_count


# ===== 已有记录加载 =====

def load_existing_keys(out_path: str) -> set[str]:
    """读取已有 JSONL 文件，建立去重 key 集合"""
    keys: set[str] = set()
    if not os.path.exists(out_path):
        return keys
    with open(out_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                key = record_key(rec)
                if key:
                    keys.add(key)
            except Exception:
                pass
    return keys


# ===== 核心处理流程 =====

def _detect_config_dir() -> str:
    """检测 ASCI 配置目录：优先环境变量 ASCI_CONFIG_DIR（由 Electron 注入），其次自动检测"""
    from_env = os.environ.get("ASCI_CONFIG_DIR")
    if from_env:
        return from_env
    # 默认 ~/.asci（与打包后一致），仅当 ~/.asci 不存在但 ~/.asci-dev 存在时 fallback
    asci_dir = os.path.expanduser("~/.asci")
    if os.path.isdir(asci_dir):
        return asci_dir
    dev_dir = os.path.expanduser("~/.asci-dev")
    if os.path.isdir(dev_dir):
        return dev_dir
    return asci_dir


# ===== 后台异步富化：venue 反查（正刊刊名）+ 本地分区 / 影响因子 =====
# 设计：检索结果先写 JSONL 秒出；富化放后台 fire-and-forget 任务，回写 JSONL 后由
# 面板 5s 轮询自动反映（与 relevance-scorer 的 finalRelevance 同机制）。两步：
#   ① 对 venue 为空的预印本按标题反查正刊 venue（严格匹配防误配，走 crossref→openalex 网络）；
#   ② 对（含回填后的）venue 去重查【本地分区表】(fenqu_local)，写 extra.journalRank。
# 回写采用「重读最新 JSONL → 按 handle 合并 → 原子重写」，避免与 apply_rerank 抢写丢数据。
# 开关：PAPER_SEARCH_MCP_DISABLE_VENUE_BACKFILL / ...DISABLE_JOURNAL_RANK = 1。

# venue 反查（crossref→openalex 网络调用）的最大并发。分区查询已改本地、不走网络,
# 此并发只约束 ① 的反查请求。
VENUE_BACKFILL_CONCURRENCY = int(
    os.environ.get("PAPER_SEARCH_MCP_VENUE_BACKFILL_CONCURRENCY", "2") or "2"
)

# 后台任务引用集合：asyncio 只持弱引用，存一份防止 create_task 的任务被 GC。
_BACKGROUND_TASKS: set = set()


def _journal_rank_enabled() -> bool:
    """本地分区 / IF 查询(fenqu_local)。设 PAPER_SEARCH_MCP_DISABLE_JOURNAL_RANK=1 关闭。"""
    return os.environ.get("PAPER_SEARCH_MCP_DISABLE_JOURNAL_RANK", "") not in ("1", "true", "True")


def _venue_backfill_enabled() -> bool:
    return os.environ.get("PAPER_SEARCH_MCP_DISABLE_VENUE_BACKFILL", "") not in ("1", "true", "True")


# 后台网络富化(venue 反查 + 本地分区)只处理按 F22 排序的前 N 篇，避免大候选集
# (max_results 调大后 venue 可达数百)把 fire-and-forget 任务拖到 MCP 退出后才跑完被杀。
_ENRICH_TOP_N = int(os.environ.get("PAPER_SEARCH_MCP_ENRICH_TOP_N", "80") or "80")


def _norm_venue_key(v: Optional[str]) -> str:
    """venue 归一化判重 key：折叠空白 + 小写（与 fenqu_local.dedupe_venues 一致）。"""
    return " ".join((v or "").split()).lower()


def _read_jsonl(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _atomic_rewrite_jsonl(path: str, records: list[dict]) -> None:
    """临时文件 + rename 原子重写，避免面板轮询读到半截 JSONL。"""
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


# JSONL 回写并发锁（issue #689）：所有"读整份 → 改 → 原子重写同一份 JSONL"的写者必须串行化，
# 否则后写者会用读时的旧快照覆盖先写者的字段（丢分 / 丢 enrich 的 venue·journalRank）。涉及的写者：
#   - apply_scoring（多个 scorer shard 并发回写 score）
#   - enrich_session_async（后台 venue 反查 + 分区 + 七维评分回写）
# MCP 单进程单事件循环模型下，进程内按 path 建 asyncio.Lock 即可串行化（同一 loop 内复用同一锁）。
_SCORING_WRITE_LOCKS: dict[str, "asyncio.Lock"] = {}


def _scoring_write_lock(path: str) -> "asyncio.Lock":
    lock = _SCORING_WRITE_LOCKS.get(path)
    if lock is None:
        lock = asyncio.Lock()
        _SCORING_WRITE_LOCKS[path] = lock
    return lock


# 注：原 EasyScholar 在线查询的持久缓存（easyscholar-cache.json）已随分区查询改为
# 本地离线（fenqu_simple_2025.json）而移除——本地查询即时、无需缓存。


async def _compute_journal_ranks(records: list[dict], timeout: float = 6.0,
                                 config_dir: Optional[str] = None) -> dict:
    """venue 去重 → 查本地分区表(fenqu_simple_2025.json)→ {handle: journalRank dict}。
    本地离线查询,即时返回、无网络 / 无并发 / 无 API key;过滤"空壳"。失败降级为空 map。
    （timeout / config_dir 形参保留以兼容调用方,本地查询不使用。）"""
    try:
        from ..connectors.fenqu_local import dedupe_venues, lookup_journal_rank
    except Exception:
        return {}
    unique = dedupe_venues(r.get("venue") for r in records)
    if not unique:
        return {}

    by_key: dict = {_norm_venue_key(v): lookup_journal_rank(v) for v in unique}

    out: dict = {}
    for rec in records:
        rank_dict = by_key.get(_norm_venue_key(rec.get("venue")))
        if not rank_dict:
            continue
        if not any(val for val in rank_dict.values()):
            continue  # 空壳（纯会议 / 无 SCI 指标）→ 不写
        h = _record_handle(rec)
        if h:
            out[h] = rank_dict
    return out


# 预印本平台名标记：openalex 兜底反查时用，命中则排除（这些不是正刊 venue）。
_PREPRINT_VENUE_MARKERS = (
    "arxiv", "ssrn", "biorxiv", "medrxiv", "chemrxiv", "preprint",
    "research square", "techrxiv", "authorea",
)


def _is_preprint_venue(venue: str) -> bool:
    low = venue.lower()
    return any(m in low for m in _PREPRINT_VENUE_MARKERS)


def _lookup_published_venue(title: str, year: Optional[int]) -> Optional[str]:
    """按标题反查正刊 venue（同步，丢线程池调用）。crossref 主查，查不到再 openalex 兜底。

    严格防误配（两源共用）：归一化标题**完全相等** + venue 非空 +（若双方年份均有）
    相差 ≤ 1。crossref 额外限 journal-article；openalex 无 type 字段，改用预印本平台
    名黑名单排除（arXiv/SSRN/bioRxiv/Preprints… 不算正刊）。任一不满足返回 None。
    """
    norm = _normalize_title(title or "")
    if not norm:
        return None

    def _year_ok(pub_date) -> bool:
        return not (year and pub_date and abs(pub_date.year - year) > 1)

    # 1) crossref：限 journal-article + container-title
    try:
        from ..connectors.crossref import CrossRefConnector
        for p in CrossRefConnector().search(title, max_results=5):
            if _normalize_title(p.title) != norm:
                continue
            ctype = (p.extra or {}).get("crossref_type", "") if isinstance(p.extra, dict) else ""
            if ctype and ctype != "journal-article":
                continue
            venue = (p.venue or "").strip()
            if venue and _year_ok(p.published_date):
                return venue
    except Exception:
        pass

    # 2) openalex 兜底：crossref 查不到时按标题反查，排除预印本平台 venue
    try:
        from ..connectors.openalex import OpenAlexConnector
        for p in OpenAlexConnector().search(title, max_results=5):
            if _normalize_title(p.title) != norm:
                continue
            venue = (p.venue or "").strip()
            if venue and not _is_preprint_venue(venue) and _year_ok(p.published_date):
                return venue
    except Exception:
        pass

    return None


async def _compute_venue_backfill(records: list[dict], timeout: float = 6.0) -> dict:
    """对 venue 为空的记录按标题反查正刊 venue，返回 {handle: venue}。"""
    targets = [
        r for r in records
        if not (r.get("venue") or "").strip() and (r.get("title") or "").strip()
    ]
    if not targets:
        return {}
    sem = asyncio.Semaphore(max(1, VENUE_BACKFILL_CONCURRENCY))

    async def _one(rec: dict):
        async with sem:
            return await asyncio.to_thread(_lookup_published_venue, rec.get("title"), rec.get("year"))

    venues = await asyncio.gather(*[_one(r) for r in targets])
    out: dict = {}
    for rec, v in zip(targets, venues):
        h = _record_handle(rec)
        if v and h:
            out[h] = v
    return out


async def enrich_session_async(out_path: str, turn_id: Optional[str], timeout: float = 6.0) -> None:
    """后台异步富化一个 session JSONL：venue 反查 + 分区查询 → 回写。全程容错降级。"""
    try:
        if not out_path or not os.path.exists(out_path):
            return
        records = _read_jsonl(out_path)
        turn_records = [r for r in records if (not turn_id or r.get("turn_id") == turn_id)]
        if not turn_records:
            return

        # 网络富化(venue 反查 + 本地分区)只对按 F22 排序的 top-N 做：大候选集(max_results 调大后
        # 可达数百篇、数百个 venue)会让后台任务跑不完就被 MCP 退出杀掉。用户只看前排，且缓存逐步积累。
        # score(本地、便宜)仍对全部算。（F22 取值复用 _scoring_rel，与判分窗口口径同源。）
        top_records = sorted(turn_records, key=_scoring_rel, reverse=True)[:_ENRICH_TOP_N]

        # ① venue 反查（仅 top-N 内 venue 空者）
        venue_map = await _compute_venue_backfill(top_records, timeout) if _venue_backfill_enabled() else {}
        # 把回填 venue 先应用到内存副本，供 ② 用新 venue 查分区
        if venue_map:
            for r in top_records:
                h = _record_handle(r)
                if h in venue_map:
                    r["venue"] = venue_map[h]

        # ② 本地分区 / IF（仅 top-N；config_dir 用于持久缓存；out_path=<cfg>/agent-sessions-papers/<sid>.jsonl）
        cfg = os.path.dirname(os.path.dirname(out_path))
        rank_map = await _compute_journal_ranks(top_records, timeout, config_dir=cfg) if _journal_rank_enabled() else {}

        # 七维评分始终运行（对本轮每篇全算），故 enrich 临界区无条件进入

        # ③④ read→modify→write 必须在写锁内串行化：否则与并发的 apply_scoring shard 互相用旧快照
        #    覆盖（enrich 丢 shard 的 score / shard 丢 enrich 的 venue·journalRank，issue #689）。
        #    网络富化(①②)已在锁外完成，临界区只含本地 read/merge/rewrite，锁持有窗口短。
        scored = 0
        async with _scoring_write_lock(out_path):
            # ③ 重读最新 JSONL（apply_rerank / scorer shard 可能已写）→ 按 handle 合并 venue/分区
            fresh = _read_jsonl(out_path)
            for r in fresh:
                h = _record_handle(r)
                if h in venue_map:
                    r["venue"] = venue_map[h]
                if h in rank_map:
                    extra = r.get("extra") if isinstance(r.get("extra"), dict) else {}
                    extra["journalRank"] = rank_map[h]
                    r["extra"] = extra

            # ④ 七维评分：对本轮每篇用确定性维 + semantic 回退算 extra.score。
            #    **关键**：若该篇已被 scorer 子 Agent 写过（method 非 null = LLM 判过），保留它的
            #    semantic + method，只用最新 venue/journalRank 重算确定性维 —— 否则会把 agent 评分
            #    整片覆盖成 keyword 回退基线（method=null）。这是 enrich 与 scorer 的时序竞态修复。
            # score 七维是本地确定性计算（便宜）→ 对本轮**每篇全算**，保证所有论文都有
            # finalScore、排序同量纲（避免无 score 的论文回退到 keywordRelevance 等异量纲
            # 信号而虚高窜位）。F22 阈值只用于「哪些论文送 LLM scorer 判 semantic/method」
            # （见 search_service.retrieve 的 top_k），与本地七维是否计算无关。
            from .paper_scoring import score_record
            for r in fresh:
                if turn_id and r.get("turn_id") != turn_id:
                    continue
                try:
                    extra = r.get("extra") if isinstance(r.get("extra"), dict) else {}
                    # 旧会话 JSONL 评分键名为 scoreV2，读取时兜底回退（写入统一用 score）
                    prev_raw = extra.get("score") or extra.get("scoreV2")
                    prev = prev_raw if isinstance(prev_raw, dict) else None
                    prev_scores = (prev or {}).get("scores") or {}
                    prev_method = prev_scores.get("method_match")
                    # 「LLM 判过」用单一判定 _score_is_judged（#745/#801）：scorer 可能只给
                    # semantic 漏 method，用 method_match 会误判没判过、把 scorer 的 semantic
                    # 覆盖成回退基线（且丢 judged 标记 → 进度条把这篇算回未判 → X<Y 到不了变绿）。
                    if _score_is_judged(prev):
                        # scorer 已判（已进 LLM 判分窗口）→ 保留其 semantic + method（method 可能
                        # 为 None，scorer 只给 semantic），只用最新 venue/journalRank 重算确定性维。
                        # 已判分支（进入条件即 _score_is_judged(prev)=True）→ 显式保留 judged=True，
                        # 不再靠维度推断：模型坏维度篇的 semantic/method 可能都 null，推断会把已判篇
                        # 翻回未判、进度条 X 退回卡死（#801），与 apply_scoring/apply_rerank 口径一致。
                        extra["score"] = score_record(
                            r, semantic=prev_scores.get("semantic_relevance"), method=prev_method,
                            judged=True,
                        )
                    else:
                        # 未经 LLM 判分 → semantic 回退现有对题度信号、method=null（全算，不按 F22 过滤）。
                        extra["score"] = score_record(r)
                    r["extra"] = extra
                    scored += 1
                except Exception:
                    continue

            _atomic_rewrite_jsonl(out_path, fresh)
        logger.info("[enrich_session_async] venue 回填 %d，分区命中 %d，v2 评分 %d",
                    len(venue_map), len(rank_map), scored)
    except Exception:
        logger.warning("[enrich_session_async] 后台富化失败（已降级，不影响检索）", exc_info=True)


def spawn_session_enrich(out_path: Optional[str], turn_id: Optional[str]) -> None:
    """在当前事件循环 fire-and-forget 富化任务（七维评分始终运行，故总会有活）。"""
    if not out_path:
        return
    try:
        task = asyncio.create_task(enrich_session_async(out_path, turn_id))
    except RuntimeError:
        return  # 无运行中的事件循环（理论上不会发生：MCP 在 async 上下文）
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)


async def process_results_core(
    query: str,
    inputs: list[dict],
    enrich: bool = True,
    session_id: Optional[str] = None,
    config_dir: Optional[str] = None,
    method_terms: Optional[list[str]] = None,
    object_terms: Optional[list[str]] = None,
    turn_id: Optional[str] = None,
    return_records: bool = False,
    seed_keys: Optional[set] = None,
) -> dict:
    """去重 + 摘要补全 + 写入 session 论文 JSONL，返回统计信息。

    Args:
        query: 搜索关键词
        inputs: 每个元素为 {"source": "<source_name>", "papers": [<paper_dict>, ...]}
        enrich: 是否对无摘要论文调 enrich_paper 补全
        session_id: ASCI 会话 ID；为 None 时从环境变量 ASCI_SESSION_ID 读取
        config_dir: ASCI 配置目录；为 None 时自动检测 ~/.asci-dev 或 ~/.asci
        method_terms: F21 (#98) — 研究方法关键词列表，透传给 score_papers
        object_terms: F21 (#98) — 研究对象关键词列表，透传给 score_papers
        seed_keys: required_seeds (#614) — 已 verified 命中的种子论文标识集合（小写 DOI ∪ 小写
            title）。去重后的记录命中其中任一 → 标 extra.seed=true。None / 空集时不标记（默认行为）。

    Returns:
        统计信息 dict，格式与 _process_results.py 的 stdout 输出一致
    """
    # 确定 session_id
    if not session_id:
        session_id = os.environ.get("ASCI_SESSION_ID", "")
    if not session_id:
        return {"error": "session_id 未提供且环境变量 ASCI_SESSION_ID 未设置"}

    # turn_id：本次 lit-search 流程的唯一标识，写入每条新增 record。
    # scorer 加载 JSONL 后按"最新 turn_id"过滤本轮 records，避免跨 session 历史污染。
    # caller 可传入复用：searcher 在一次 lit-search 内调多轮 process_search_results
    # 时（round 1 + round 2），所有轮次复用第一轮返回的 turn_id，让 scorer 一次拿
    # 全所有轮次的 records。不传 turn_id（None）→ 生成新 UUID（首轮 / 独立调用）。
    if not turn_id:
        turn_id = uuid.uuid4().hex

    # 确定输出路径
    if not config_dir:
        config_dir = _detect_config_dir()

    papers_dir = os.path.join(config_dir, "agent-sessions-papers")
    os.makedirs(papers_dir, exist_ok=True)
    out_path = os.path.join(papers_dir, f"{session_id}.jsonl")

    # 加载已有 key
    existing_keys = load_existing_keys(out_path)

    # 解析所有源的结果
    all_records: list[dict] = []
    source_counts: dict[str, int] = {}
    new_keys: set[str] = set()

    for item in inputs:
        source_name = item.get("source", "unknown")
        papers = item.get("papers", [])

        # 兼容 MCP 返回的多种格式
        if isinstance(papers, dict):
            if "_handle" in papers and isinstance(papers.get("papers"), list):
                # R3 返回结构：{"_handle": str, "count": int, "papers": [...]}
                # 防御性自动解包；正确用法应走 handles 路径而非把整个 dict 塞 inputs.papers
                papers = papers["papers"]
            elif "result" in papers:
                result = papers["result"]
                papers = result if isinstance(result, list) else [result]
            elif "title" in papers:
                papers = [papers]
            else:
                papers = []

        # P2-2：searcher 通常对同一 source 调多次 search_*（关键词 × 源矩阵），
        # 把所有 handles 一次性传给 process_search_results — inputs 列表里同一
        # source_name 会出现多次。这里必须累加而非覆盖赋值，否则 total_from_sources
        # 只反映"最后一次该源的 paper 数"，导致 duplicates_removed = total - new
        # 变成负数（实测 -41）。
        source_counts[source_name] = source_counts.get(source_name, 0) + len(papers)
        added = 0

        for paper in papers:
            record = to_paper_record(paper, query, source_name)
            key = record_key(record)
            if key and (key in existing_keys or key in new_keys):
                continue
            if key:
                new_keys.add(key)
            all_records.append(record)
            added += 1

        new_key = f"{source_name}_new"
        source_counts[new_key] = source_counts.get(new_key, 0) + added

    # 摘要补全
    enriched_count = 0
    if enrich and all_records:
        enriched_count = await enrich_missing_abstracts(
            all_records, session_id=session_id, config_dir=config_dir, turn_id=turn_id
        )

    # Fuzzy title 去重（P1-1）：在 enrich 之后跑 — 这样 citedBy / venue
    # 经 enrich 补全后才能正确选出每组里"信号最强"的一条。同篇论文不同
    # 载体（OpenAlex 期刊版 vs 会议版）至此合并；后缀白名单（v2/Revisited/
    # Extended 等）视为真续作不合并。
    all_records = _fuzzy_dedupe(all_records)

    # required_seeds (#614)：给去重后命中种子的记录标 extra.seed=true。
    # 在 _fuzzy_dedupe 之后、写 JSONL 之前标记 —— 对幸存记录按 raw doi/title 匹配，
    # 不依赖入池顺序、也不受 record_key 与 seed 标识形态差异影响。seed_keys 仅含
    # verified（高置信）命中的标识；fuzzy 命中只进池不在此集合，故不会被标 seed。
    if seed_keys and all_records:
        for rec in all_records:
            doi = (rec.get("doi") or "").strip().lower()
            title = (rec.get("title") or "").strip().lower()
            if (doi and doi in seed_keys) or (title and title in seed_keys):
                extra = rec["extra"] if isinstance(rec.get("extra"), dict) else {}
                extra["seed"] = True
                rec["extra"] = extra

    # Crossref 非论文噪声过滤（#622）：滤掉 crossref 源中标题命中 Figure/Fig./Table/
    # Supplementary/Supplement/Appendix（词边界）的图表 / 补充材料条目。必须放在 seed
    # 标记之后 —— 让 extra.seed=true 先标好，确保核心论文走豁免分支不被误删。
    if all_records:
        before_noise = len(all_records)
        all_records = [r for r in all_records if not _is_crossref_noise(r)]
        crossref_noise_removed = before_noise - len(all_records)
        if crossref_noise_removed:
            logger.info(
                "[process_results_core] Crossref 非论文噪声过滤：移除 %d 条",
                crossref_noise_removed,
            )

    # 注：venue 反查 + 本地分区/IF 富化已移出同步路径，改由 retrieve() 在
    # 写盘后 fire 后台任务 enrich_session_async 异步完成（回写 JSONL，面板 5s 轮询反映），
    # 避免拖慢检索。这里不再做分区查询。

    # 相关度评分（F22 issue #93 + F21 issue #98）：去重 + 补全后、写 JSONL 前
    if all_records:
        from .scoring import score_papers
        score_papers(
            all_records,
            query=query,
            method_terms=method_terms,
            object_terms=object_terms,
        )

    # 写入 JSONL（每条 record 注入 turn_id 字段，供 scorer 按 turn 过滤）
    if all_records:
        with open(out_path, "a", encoding="utf-8") as f:
            for rec in all_records:
                rec["turn_id"] = turn_id
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    # 构建统计信息
    total_from_sources = sum(
        v for k, v in source_counts.items() if not k.endswith("_new")
    )
    # 前端面板会过滤掉无 URL 的记录，提前计算面板实际展示数
    papers_without_url = sum(1 for r in all_records if not r.get("url"))
    display_count = len(all_records) - papers_without_url
    stats = {
        "total_from_sources": total_from_sources,
        "duplicates_removed": total_from_sources - len(all_records),
        "new_records": len(all_records),
        "papers_without_url": papers_without_url,
        "display_count": display_count,
        "enriched_abstracts": enriched_count,
        "source_counts": {
            k: v for k, v in source_counts.items() if not k.endswith("_new")
        },
        "source_new_counts": {
            k.replace("_new", ""): v
            for k, v in source_counts.items()
            if k.endswith("_new")
        },
        "output_path": out_path,
        "turn_id": turn_id,
    }
    # Stage 3：retrieve 工具需要拿回已 F22 打分的 records 以返回 top-K 排序列表，
    # 避免再读一次 JSONL。默认不返回，保持向后兼容。
    if return_records:
        stats["records"] = all_records
    return stats


# ===== Stage 3 / P1-1：rerank 分数工具回写 =====

# finalRelevance 语义 = 纯"对题度"(topical relevance) = LLM 语义分 ×100。
# 设计取舍：面板"相关度"应表达"这篇有多对题"——精确命中一篇论文就该 ~100。
# 旧的 0.6·F22+0.4·llm 混合把引用/venue/时新等"质量"信号(与是否匹配查询无关)
# 揉进了相关度,导致精确命中也只有 ~80。改为相关度只反映对题度;F22 综合分仍
# 保留在 extra.relevance 作质量信号(bench / 可选排序用),两概念解耦。


def _record_handle(rec: dict) -> str:
    """与 retrieve.top_k / 旧 scorer 一致的 handle：paper_id > doi > url。"""
    extra = rec.get("extra") if isinstance(rec.get("extra"), dict) else {}
    return extra.get("paper_id") or rec.get("doi") or rec.get("url") or ""


# ===== V2 评分窗口 + 分片（服务端确定，scorer shard 据此并行判分，issue #689） =====
# 原来这套窗口规则散落在 scorer.md 的手写 Python（读整份 JSONL 自行切片）；下沉为服务端
# 确定性函数后，scorer prompt 不再依赖手写脚本，且多个 scorer shard 拿到的是同一稳定窗口
# 的不相交切片。F22 阈值 / cap 直接复用 search_service 的同名常量（单一事实源，防判分窗口
# 与 retrieve 的 top_k 口径漂移）；method-axis / floor 是判分窗口特有，本地定义（可环境覆盖）。
SCORING_METHOD_AXIS_THRESHOLD = float(os.getenv("PAPER_SEARCH_SCORING_METHOD_AXIS", "70"))
SCORING_WINDOW_FLOOR = int(os.getenv("PAPER_SEARCH_SCORING_FLOOR", "50"))
# issue #689：默认并行分片数。**实际分片数由 scenario PLAN 决定**（planner 在每个 scorer 步骤里
# 显式传 shard_index/shard_count），prompt 读不到服务端环境变量，故这里不挂 env 覆盖以免造成
# "改环境变量能调分片数"的假象——它只作为直接调用 get_scoring_shard 省略 shard_count 时的回退默认。
# 小候选集 / 空 shard / 单 scorer fallback（shard_count=1）均须正常工作。
DEFAULT_SCORING_SHARD_COUNT = 3


def _scoring_rel(rec: dict) -> float:
    v = (rec.get("extra") or {}).get("relevance")
    return float(v) if isinstance(v, (int, float)) else 0.0


def _scoring_method_rel(rec: dict) -> float:
    v = (rec.get("extra") or {}).get("methodRelevance")
    return float(v) if isinstance(v, (int, float)) else 0.0


def _is_scoring_seed(rec: dict) -> bool:
    return bool((rec.get("extra") or {}).get("seed"))


def _score_is_judged(score: Optional[dict]) -> bool:
    """判定一条 extra.score / extra.scoreV2 是否为 LLM 判过（而非 enrich 回退基线）。

    单一事实源，供进度条 `_is_scored`、enrich 保留判据、`apply_rerank` 三处共用，杜绝各自
    手写副本口径漂移（#801）。优先 `judged` 标记（apply_scoring 命中即写 True，含模型返回
    坏维度值的篇）；旧 JSONL 无 `judged` 字段 → 兜底看 `method_match` 非 null（LLM 判过通常
    给 method）。非 dict 输入安全返回 False。
    """
    if not isinstance(score, dict):
        return False
    if "judged" in score:
        return bool(score["judged"])
    return (score.get("scores") or {}).get("method_match") is not None


def select_scoring_window(
    records: list[dict], turn_id: Optional[str] = None,
) -> tuple[Optional[str], list[dict]]:
    """从 session records 选出本轮 turn 的 LLM 判分窗口（稳定、确定）。

    窗口规则（与历史 scorer.md 口径一致）：
    - 选 turn：给定 turn_id 则用之；否则取 ts 最新的非 "_legacy" turn。
      （口径微调：历史 scorer.md 把 "_legacy" 也纳入 max(ts) 竞争、若它胜出则直接判 NO_CANDIDATES
       中止；这里改为先剔除 "_legacy" 再取 max。现有记录均带 turn_id，仅当全部记录都缺 turn_id
       时行为不同——那种情形两者都得不到可判窗口，结果等价。）
    - 按 F22 `extra.relevance` 降序稳定排序。
    - 收 F22 > THRESHOLD **或** methodRelevance ≥ METHOD_AXIS 的候选；
    - 合并 forced seeds（extra.seed=true，按 handle 去重）；
    - FLOOR：不足 FLOOR 时按 F22 desc 回填，coverage 不饿死；
    - CAP：超过 CAP 时 seeds 优先保留、仅截非 seed。

    Returns: (resolved_turn_id, window_records)；无候选时 (None|turn_id, [])。
    """
    # F22 阈值 / cap 复用 search_service 同名常量（单一事实源）；延迟导入避免模块级循环。
    from .search_service import TOPK_CAP, TOPK_F22_THRESHOLD

    groups: dict[str, list[dict]] = {}
    for rec in records:
        groups.setdefault(rec.get("turn_id") or "_legacy", []).append(rec)
    if turn_id:
        cur = groups.get(turn_id, [])
        resolved = turn_id
    else:
        real = {t: g for t, g in groups.items() if t != "_legacy"}
        if not real:
            return (None, [])
        resolved = max(real.keys(), key=lambda t: max(x.get("ts", "") for x in real[t]))
        cur = real[resolved]
    if not cur:
        return (resolved, [])

    cur = sorted(cur, key=_scoring_rel, reverse=True)
    top = [
        p for p in cur
        if _scoring_rel(p) > TOPK_F22_THRESHOLD
        or _scoring_method_rel(p) >= SCORING_METHOD_AXIS_THRESHOLD
    ]
    seen = {_record_handle(p) for p in top}
    for p in cur:  # 合并 forced seeds（#615），按 handle 去重
        if _is_scoring_seed(p):
            h = _record_handle(p)
            if h and h not in seen:
                top.append(p)
                seen.add(h)
    if len(top) < SCORING_WINDOW_FLOOR:  # floor 回填（cur 已按 F22 排序）
        for p in cur:
            if len(top) >= SCORING_WINDOW_FLOOR:
                break
            h = _record_handle(p)
            if h not in seen:
                top.append(p)
                seen.add(h)
    if len(top) > TOPK_CAP:  # cap：seeds 优先保留，仅截非 seed
        top = (
            [p for p in top if _is_scoring_seed(p)]
            + [p for p in top if not _is_scoring_seed(p)]
        )[:TOPK_CAP]
    return (resolved, top)


def _emit_scoring_progress(
    window: list,
    turn_id: Optional[str],
    session_id: Optional[str],
    config_dir: Optional[str],
) -> None:
    """#775：算「已评分 X / 评分窗口 Y」并续写 live 文件（phase=scoring）。

    X = 评分窗口内已被 LLM scorer 判过的篇数；Y = 窗口大小 len(window)。判定「判过」用
    extra.score.judged 标记（apply_scoring 写 True，enrich 回退基线写 False）——**不能**只看
    score 存在性：enrich 后台对本轮每篇都写回退基线 score，抢在 score_window 开工帧前跑完时，
    按存在性数会让开工帧 X==Y 假报「评分完成」（#745 时序竞态）。也**不**看 method_match 维度
    值：scorer 可能只给 semantic 漏 method，用维度值会漏算导致 X<Y 永远不变绿。旧 JSONL 无
    judged 字段（含旧键 scoreV2）→ 兜底看 method_match 是否非 null。
    且只数 window 内，X ≤ Y 恒成立（不会因整轮历史判分 / CAP 截断显示 (135/120) 穿帮）。
    window 由调用方传入（已算好），不在此重算 select_scoring_window。
    空 window（无候选过阈值）直接不写 scoring 帧——没有评分工作，避免面板蹦「正在评分 (0/0)」。
    两处共用：get_scoring_shard（scorer 开工取分片即触发，消除 retrieve→scorer 空窗）、
    apply_scoring（每片写回后刷新，最后一片完成时 X==Y）。best-effort：失败只 warn。
    """
    if not window:
        return
    try:
        from .live_progress import write_scoring_progress

        # 写入统一用 score；旧会话评分键名为 scoreV2，一并兜底
        def _is_scored(p: dict) -> bool:
            e = p.get("extra") or {}
            return _score_is_judged(e.get("score") or e.get("scoreV2"))

        scored_x = sum(1 for p in window if _is_scored(p))
        write_scoring_progress(config_dir, session_id, turn_id, scored_x, len(window))
    except Exception as _e:
        logger.warning("[scorer 进度] live 续写失败（不影响打分）: %s", _e)


async def get_scoring_shard(
    shard_index: int,
    shard_count: int = DEFAULT_SCORING_SHARD_COUNT,
    session_id: Optional[str] = None,
    turn_id: Optional[str] = None,
    config_dir: Optional[str] = None,
) -> dict:
    """返回本轮 V2 判分窗口的第 shard_index 个分片（共 shard_count 片）。

    服务端确定窗口与分片，scorer shard 只读自己分片内的候选并判 semantic/method。
    分片用 round-robin（window[shard_index::shard_count]）——稳定、不相交、合并即完整窗口、
    且把高低 F22 难度均摊到各 shard。单 scorer fallback = shard_count=1 / shard_index=0（整窗）。

    Args:
        shard_index: 0..shard_count-1。
        shard_count: 分片总数，默认 DEFAULT_SCORING_SHARD_COUNT（3）。
        session_id: 为空读环境变量 ASCI_SESSION_ID。
        turn_id: 指定只取该 turn；为空自动取最新 turn。

    Returns:
        {turn_id, shard_index, shard_count, window_total, shard_size, candidates,[note]}
        或 {error}（shard_count<1 / shard_index 越界）。空窗口/空 shard 不报错。
    """
    if not isinstance(shard_count, int) or shard_count < 1:
        return {"error": f"shard_count 必须是 ≥1 的整数，收到 {shard_count!r}"}
    if not isinstance(shard_index, int) or shard_index < 0 or shard_index >= shard_count:
        return {"error": f"shard_index 越界：需 0 ≤ shard_index < {shard_count}，收到 {shard_index!r}"}
    if not session_id:
        session_id = os.environ.get("ASCI_SESSION_ID", "")
    if not session_id:
        return {"error": "session_id 未提供且环境变量 ASCI_SESSION_ID 未设置"}
    if not config_dir:
        config_dir = _detect_config_dir()
    out_path = os.path.join(config_dir, "agent-sessions-papers", f"{session_id}.jsonl")
    if not os.path.exists(out_path):
        return {"error": f"session JSONL 不存在: {out_path}"}

    records = await asyncio.to_thread(_read_jsonl, out_path)
    resolved_turn, window = select_scoring_window(records, turn_id=turn_id or None)
    # #775：scorer 取分片即视为「评分开始」——此刻续写 phase=scoring（首次 X 多为 0），
    # 让 banner 在 retrieve.finalize 删文件后立刻重建，消除 retrieve→scorer 空窗。
    # 直接复用上面已算好的 window（不重算 select_scoring_window）。
    _emit_scoring_progress(window, resolved_turn or turn_id, session_id, config_dir)
    shard = window[shard_index::shard_count]  # round-robin 切片：不相交、合并即整窗
    result = {
        "turn_id": resolved_turn,
        "shard_index": shard_index,
        "shard_count": shard_count,
        "window_total": len(window),
        "shard_size": len(shard),
        # 候选构造与 score_window 共用 _window_to_candidates（单一事实源：handle + 200 字摘要）。
        "candidates": _window_to_candidates(shard),
    }
    if not window:
        result["note"] = "no candidates in scoring window (searcher/retrieve must run first, or no paper cleared the window)"
    elif not shard:
        result["note"] = f"empty shard: window has {len(window)} candidate(s), fewer than shard_count={shard_count}"
    return result


async def apply_rerank(
    scores: dict,
    session_id: Optional[str] = None,
    turn_id: Optional[str] = None,
    config_dir: Optional[str] = None,
    return_records: bool = False,
) -> dict:
    """把 LLM rerank 分数回写 session JSONL，原地更新"相关度"。

    取代旧 relevance-scorer 把整套排序集以文本吐回 context 的做法：LLM 只产出
    `{handle: llm_relevance(0–1)}`，本工具把 `finalRelevance = round(llm×100)`
    就地写入（同时记 `extra.llmRelevance`）。**finalRelevance 是纯"对题度"**：
    精确命中一篇论文 → llm≈1.0 → 100。F22 综合分 `extra.relevance` 保留不变
    （质量信号，bench / 可选排序用），与"相关度"解耦。

    Args:
        scores: {handle: llm_relevance}，handle 同 retrieve.top_k 的 handle；
            llm_relevance ∈ [0,1]，越界自动 clamp。
        session_id: 为空读环境变量 ASCI_SESSION_ID。
        turn_id: 仅更新该 turn 的 records；为空则不限 turn（按 handle 匹配全表）。
        config_dir: 为空自动检测。
        return_records: True 时返回更新后的 records（供测试/retrieve 复用）。

    Returns:
        {updated, missing, total_in_turn, output_path, turn_id} 或 {error}。
    """
    if not isinstance(scores, dict) or not scores:
        return {"error": "scores 必须是非空 {handle: llm_relevance} 映射"}

    if not session_id:
        session_id = os.environ.get("ASCI_SESSION_ID", "")
    if not session_id:
        return {"error": "session_id 未提供且环境变量 ASCI_SESSION_ID 未设置"}
    if not config_dir:
        config_dir = _detect_config_dir()
    out_path = os.path.join(config_dir, "agent-sessions-papers", f"{session_id}.jsonl")
    if not os.path.exists(out_path):
        return {"error": f"session JSONL 不存在: {out_path}"}

    with open(out_path, "r", encoding="utf-8") as f:
        records = [json.loads(line) for line in f if line.strip()]

    # 归一化 scores 的 handle（去空白），clamp llm 到 [0,1]
    norm_scores: dict[str, float] = {}
    for h, v in scores.items():
        hh = (h or "").strip()
        if not hh:
            continue
        try:
            fv = float(v)
        except (TypeError, ValueError):
            continue
        norm_scores[hh] = max(0.0, min(1.0, fv))

    updated = 0
    matched_handles: set[str] = set()
    total_in_turn = 0
    for rec in records:
        if turn_id and rec.get("turn_id") != turn_id:
            continue
        total_in_turn += 1
        h = _record_handle(rec)
        if h not in norm_scores:
            continue
        llm = norm_scores[h]
        extra = rec.get("extra") if isinstance(rec.get("extra"), dict) else {}
        extra["llmRelevance"] = round(llm, 4)
        # 相关度 = 纯对题度 = LLM×100（精确命中→100）；不再混 F22 质量分
        final = round(llm * 100.0)
        # issue #442：finalRelevance 是用户可见字段，缺摘要论文即便 LLM 给近满分
        # 也无法让用户充分判断相关性——与 F22 一致硬上限到 MISSING_ABSTRACT_CAP
        # （min 取小，不抬高本就低分的论文）。原始 llmRelevance 如实保留供解释。
        if not (rec.get("abstract") or "").strip():
            final = min(final, MISSING_ABSTRACT_CAP)
        extra["finalRelevance"] = final
        rec["extra"] = extra
        matched_handles.add(h)
        updated += 1

    # 评分刷新（附加，不改 v1 上面的 finalRelevance 逻辑）：finalRelevance 是 score
    # 的 semantic 首选来源，但后台 enrich 往往在它写入前就算过 score（semantic 只能回退
    # keywordRelevance）。这里 finalRelevance 既已写入，对刚更新的 record 重算 score，
    # 让 semantic 用上 LLM 对题度。
    if matched_handles:
        from .paper_scoring import score_record
        for rec in records:
            if _record_handle(rec) in matched_handles:
                extra = rec.get("extra") if isinstance(rec.get("extra"), dict) else {}
                # 保留 LLM 已判的 method（若 scorer 精修过），否则维持 null
                # 旧会话 JSONL 评分键名为 scoreV2，读取时兜底回退（写入统一用 score）
                prev = extra.get("score") or extra.get("scoreV2") or {}
                prev_method = (prev.get("scores") or {}).get("method_match")
                # 保留「判过」状态（#801）：用单一判定 _score_is_judged，scorer 只给 semantic
                # 漏 method 的已判篇重算后仍 judged=True，不退回未判。
                extra["score"] = score_record(rec, method=prev_method, judged=_score_is_judged(prev))
                rec["extra"] = extra

    # 全量重写（仅匹配到的 record 被改，其余原样保留）
    with open(out_path, "w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    missing = sorted(set(norm_scores.keys()) - matched_handles)
    result = {
        "updated": updated,
        "missing": missing,
        "total_in_turn": total_in_turn if turn_id else len(records),
        "output_path": out_path,
        "turn_id": turn_id,
    }
    if return_records:
        result["records"] = records
    return result


# ===== 评分 v2 回写（与 apply_rerank 并行，写 extra.score，不动 v1） =====

def _window_to_candidates(shard: list[dict]) -> list[dict]:
    """把窗口 record 转成 judge 用的 candidate（handle + 200 字摘要）。

    score_window 与 get_scoring_shard 共用此函数构造候选——单一事实源，避免两条
    打分路径的字段集 / 摘要截断长度漂移。
    """
    return [
        {
            "handle": _record_handle(p),
            "title": p.get("title") or "",
            "abstract": (p.get("abstract") or "")[:200],
            "year": p.get("year"),
        }
        for p in shard
    ]


def _default_judge_fn():
    """默认判分器：从 env 读模型渠道（主进程注入，spec §4.4），调 judge_candidates。

    渠道三要素任一缺失返回 None —— 由调用方（score_window）翻成可判定 error，避免拿空
    渠道去 POST 把每个分片都打成 http 失败、只在 failed_shards 里留黑盒。
    """
    from .paper_scoring_judge import judge_candidates

    model = os.environ.get("ASCI_SCORING_MODEL", "").strip()
    base_url = os.environ.get("ASCI_SCORING_BASE_URL", "").strip()
    api_key = os.environ.get("ASCI_SCORING_API_KEY", "").strip()
    if not (model and base_url and api_key):
        return None

    async def _judge(candidates, research_question, method_terms, object_terms):
        return await judge_candidates(
            candidates, research_question, method_terms, object_terms,
            model=model, base_url=base_url, api_key=api_key,
        )

    return _judge


async def score_window(
    research_question: str,
    method_terms: Optional[list] = None,
    object_terms: Optional[list] = None,
    shard_count: int = DEFAULT_SCORING_SHARD_COUNT,
    session_id: Optional[str] = None,
    turn_id: Optional[str] = None,
    config_dir: Optional[str] = None,
    judge_fn=None,
) -> dict:
    """整轮判分（#745 scorer 下沉）：选窗口 → round-robin 切批 → asyncio.gather 并发
    调模型判 semantic/method（barrier）→ apply_scoring 算 score 写回。

    取代「主编排 Agent 派 N 个 scorer 子 Agent」——派发在确定性代码里，不依赖模型遵循。
    某批失败（模型超时/解析错）记入 failed_shards，不阻断其余批（return_exceptions=True）。
    judge_fn 可注入（测试用）；默认从 env 渠道构造。
    """
    method_terms = method_terms or []
    object_terms = object_terms or []
    if not session_id:
        session_id = os.environ.get("ASCI_SESSION_ID", "")
    if not session_id:
        return {"error": "session_id 未提供且环境变量 ASCI_SESSION_ID 未设置"}
    if not config_dir:
        config_dir = _detect_config_dir()
    out_path = os.path.join(config_dir, "agent-sessions-papers", f"{session_id}.jsonl")
    if not os.path.exists(out_path):
        return {"error": f"session JSONL 不存在: {out_path}"}

    records = await asyncio.to_thread(_read_jsonl, out_path)
    resolved_turn, window = select_scoring_window(records, turn_id=turn_id or None)
    base = {
        "window_total": len(window),
        "shard_count": shard_count,
        "turn_id": resolved_turn,
    }
    if not window:
        return {
            **base, "scored": 0, "missing": 0, "failed_shards": 0,
            "note": "no candidates in scoring window (searcher/retrieve must run first, or no paper cleared the window)",
        }

    if judge_fn is None:
        judge_fn = _default_judge_fn()
        if judge_fn is None:
            return {
                **base, "scored": 0, "missing": 0, "failed_shards": 0,
                "error": "打分渠道未配置：ASCI_SCORING_MODEL/BASE_URL/API_KEY 缺失"
                         "（主进程 env 注入失败）；score_window 需调模型判 semantic/method",
            }

    # #775 衔接：发起并发 judge 前先写开工帧（phase=scoring, X=0/Y）。score_window 不走
    # get_scoring_shard（自己 round-robin 切批），那条路径的开工帧到不了，须在此补，否则
    # 并发 judge 的几十秒面板会退回 searcher 后的静态死等（正是 #775 要消除的）。
    _emit_scoring_progress(window, resolved_turn, session_id, config_dir)

    # round-robin 切批（口径同 get_scoring_shard：window[i::n]），丢弃空批。
    batches = [window[i::shard_count] for i in range(shard_count)]
    batches = [b for b in batches if b]

    # 每片判完即 apply_scoring 写回（不合并后单次写）：apply_scoring 内会刷新 scoring 帧，
    # X 随分片逐次完成递增（0→~Y/n→…→Y），面板有中间过程而非 0 直跳 Y（#745 用户反馈）。
    # apply_scoring 本就为「多片并发各写自己 handle」设计（写锁串行化、读最新快照、不互相覆盖），
    # 故并发判分 + 并发写回安全。judge 在 gather 里仍真并发发起（派发确定性不变）。
    async def _judge_and_apply(batch: list) -> dict:
        scores = await judge_fn(
            _window_to_candidates(batch), research_question, method_terms, object_terms
        )
        return await apply_scoring(
            scores, session_id=session_id, turn_id=resolved_turn, config_dir=config_dir
        )

    results = await asyncio.gather(
        *[_judge_and_apply(b) for b in batches], return_exceptions=True
    )

    scored_total = 0
    missing_total = 0
    failed_shards = 0
    for idx, r in enumerate(results):
        if isinstance(r, BaseException):
            failed_shards += 1
            # 不吞异常：记录类型+消息，否则 judge 的真实失因（ConnectTimeout=代理/网络 vs
            # ReadTimeout=模型太慢 vs 解析错）只剩 failed_shards 计数、无从排查（#745 实测教训）。
            logger.warning("[score_window] 分片 %d 判分失败: %r", idx, r)
            continue
        if isinstance(r, dict) and not r.get("error"):
            scored_total += r.get("scored", 0)
            m = r.get("missing", [])
            missing_total += len(m) if isinstance(m, list) else 0
        else:  # apply_scoring 返回 error（判分为空映射，或 handle 全不匹配 0 命中，见 #805）
            failed_shards += 1
            logger.warning("[score_window] 分片 %d 写回失败: %s", idx, (r or {}).get("error"))

    if scored_total == 0:
        return {
            **base, "scored": 0, "missing": missing_total, "failed_shards": failed_shards,
            "note": f"all {failed_shards} scoring shard(s) failed (model timeout / parse error); "
                    "no paper scored this turn — retry score_window or check the scoring channel",
        }

    return {
        **base,
        "scored": scored_total,
        "missing": missing_total,
        "failed_shards": failed_shards,
    }


async def apply_scoring(
    scores: dict,
    session_id: Optional[str] = None,
    turn_id: Optional[str] = None,
    config_dir: Optional[str] = None,
    now_year: Optional[int] = None,
    return_records: bool = False,
) -> dict:
    """把 scorer 子 Agent 的 {handle:{semantic,method}} 算成 v2 七维分，写入 extra.score。

    确定性维（venue_quality/publication_status/recency/influence/reproducibility）由
    `score_record` 从 record 现有字段（含 extra.journalRank）就地算，semantic/method 用
    LLM 传入（缺则回退/置 null）。仅更新命中 handle 的 record，原子重写 JSONL。

    Args:
        scores: {handle: {"semantic": 0-100, "method": 0-100}}，handle 同 retrieve top_k。
        session_id: 为空读 ASCI_SESSION_ID。
        turn_id: 仅评分该 turn 的 records。
        now_year: 测试可注入。

    Returns:
        {scored, missing, total_in_turn, output_path, turn_id} 或 {error}。
    """
    if not isinstance(scores, dict) or not scores:
        return {"error": "scores 必须是非空 {handle:{semantic,method}} 映射"}
    if not session_id:
        session_id = os.environ.get("ASCI_SESSION_ID", "")
    if not session_id:
        return {"error": "session_id 未提供且环境变量 ASCI_SESSION_ID 未设置"}
    if not config_dir:
        config_dir = _detect_config_dir()
    out_path = os.path.join(config_dir, "agent-sessions-papers", f"{session_id}.jsonl")
    if not os.path.exists(out_path):
        return {"error": f"session JSONL 不存在: {out_path}"}

    from .paper_scoring import score_record

    norm = {(h or "").strip(): v for h, v in scores.items() if (h or "").strip()}

    scored = 0
    matched: set[str] = set()
    total_in_turn = 0
    # 并发安全：整段 read-modify-write 在 (loop,path) 锁内串行化，文件 I/O 移出事件循环。
    # 每个 shard 据此读到的是含先前 shard 已写 score 的最新快照，只改自己命中的 handle，
    # 后写 shard 不会覆盖先写 shard 的分数。
    async with _scoring_write_lock(out_path):
        records = await asyncio.to_thread(_read_jsonl, out_path)
        for rec in records:
            if turn_id and rec.get("turn_id") != turn_id:
                continue
            total_in_turn += 1
            h = _record_handle(rec)
            if h not in norm:
                continue
            sm = norm[h] if isinstance(norm[h], dict) else {}
            # 命中 handle = 已经过 LLM 判分 → judged=True（哪怕模型返回坏维度值、两维都 None）；
            # 否则该篇 judged=False、进度条 X 到不了 Y 卡死不变绿（#801，判过 ≠ 判得好）。
            breakdown = score_record(
                rec, semantic=sm.get("semantic"), method=sm.get("method"), now_year=now_year, judged=True,
            )
            extra = rec.get("extra") if isinstance(rec.get("extra"), dict) else {}
            extra["score"] = breakdown
            rec["extra"] = extra
            matched.add(h)
            scored += 1
        await asyncio.to_thread(_atomic_rewrite_jsonl, out_path, records)
        # #775 scorer 进度：锁内（records 为含本片在内的最新快照）刷新「已评分 X / 评分窗口 Y」。
        # 3 个 shard 串行在锁内写，每片写完刷新一次，最后一片完成时 X==Y。取窗口与
        # get_scoring_shard 同口径（X 只数窗口内已判篇数），保证 X ≤ Y。
        _resolved_turn, _window = select_scoring_window(records, turn_id=turn_id or None)
        _emit_scoring_progress(_window, _resolved_turn or turn_id, session_id, config_dir)
    result = {
        "scored": scored,
        "missing": sorted(set(norm) - matched),
        "total_in_turn": total_in_turn if turn_id else len(records),
        "output_path": out_path,
        "turn_id": turn_id,
    }
    # 0 命中兜底（issue #805）：本轮有 record、scores 也非空（入口已拦空 scores），却一篇都没写上分，
    # 说明模型给的 handle 全不对——两种子情况都堵：
    #   ① handle 全不匹配任何 record（典型如 example-first：先输出一个格式合法的示例对象再输出真
    #      batch，示例与真判分结构相同，解析层无法区分 → 取到示例，handle "example" 不在本轮）；
    #   ② handle 全为空白字符串（norm 去空白后为空），同样一篇写不上。
    # 这类「结构合法但 handle 不对/为空」比解析崩溃更隐蔽——解析崩溃会 raise、计入 failed_shards
    # （可见），而 0 命中若不报错就伪装成 scored:0 成功，上游 score_window 会把它当成功而非
    # failed_shards（#804 /review 发现）。故在此显式报错，让上游计入失败、不再静默丢分。
    # 与合法「空窗口 / searcher 未产出」区分：那是 total_in_turn==0（score_window 已提前拦截、
    # 不会走到这里），不是 handle 不匹配 —— 用 total_in_turn > 0 排除，避免误伤。
    if scored == 0 and total_in_turn > 0:
        logger.warning(
            "[apply_scoring] 0 命中：judge 返回 %d 个 handle（有效 %d）、本轮 %d 条 record，无一写分"
            "（疑似模型输出结构合法但 handle 不对/为空，如 example-first）；handle 样例=%s",
            len(scores), len(norm), total_in_turn, sorted(norm)[:5],
        )
        result["error"] = (
            f"judge 返回 {len(scores)} 个 handle 但本轮 {total_in_turn} 条 record 无一匹配"
            "（handle 全不对或全为空白，疑似 example-first / 拿错对象），本片全部论文未评分"
        )
    if return_records:
        result["records"] = records
    return result

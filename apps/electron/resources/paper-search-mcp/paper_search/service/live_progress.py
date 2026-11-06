"""retrieve 检索过程的 live 进度文件写入器。

fan-out 期间（20-90s）右侧面板原本完全黑盒；本模块把"每个查询 cell 一返回"
的进度原子写到 `<config_dir>/agent-sessions-papers/<session_id>.live.json`，
Electron 主进程 chokidar 监听该目录后推 IPC 给面板做流式渲染。

设计约束：
- 与正式 JSONL（{session_id}.jsonl）物理分离：scorer / recorder / 回流等
  canonical 消费者完全不感知 live 文件，零污染。
- live 是增强不是关键路径：任何写盘失败只 log warning，绝不影响 retrieve。
- 原子写（tmp + os.replace）：监听端永远只见完整 JSON，无半写态。
- records 按 PaperRecord 形状写（复用 to_paper_record），与 canonical 落地后
  的 record_key 一致，前端靠同 key 去重实现 live → canonical 平滑收敛。
- retrieve 结束（成功或异常）必须 finalize() 删文件；进程被 kill 的残留
  由 Electron 侧读取时的 updated_at TTL 兜底。

文件 schema（单 JSON 对象）：
{
  "schema_version": 1,
  "session_id": str,
  "turn_id": str,
  "phase": "searching" | "processing" | "scoring" | "reporting",
  "updated_at": float,            # time.time()
  "sources": {"arxiv": {"verdict": "pending|ok|empty|failed", "count": int}, ...},
  "records": [<PaperRecord>, ...],  # 去重前轻量快照，上限 LIVE_RECORDS_CAP
  "raw_total": int                # 累计原始命中（含未进 records 的溢出）
}
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# live 快照里最多保留的 record 数：进度展示用，不追求全量（raw_total 仍如实累计）
LIVE_RECORDS_CAP = 200

LIVE_FILE_SUFFIX = ".live.json"


def live_file_path(config_dir: str, session_id: str) -> str:
    """live 进度文件路径（与正式 JSONL 同目录，后缀区分）"""
    return os.path.join(config_dir, "agent-sessions-papers", f"{session_id}{LIVE_FILE_SUFFIX}")


class LiveProgress:
    """单次 retrieve 的 live 进度写入器。

    session_id 为空（独立调用 / 测试场景，环境变量也未注入）时全程 no-op，
    与 process_results_core 的 session 校验语义一致。
    """

    def __init__(
        self,
        session_id: Optional[str],
        turn_id: str,
        requested_sources: List[str],
        config_dir: Optional[str] = None,
    ) -> None:
        self._enabled = bool(session_id)
        if not self._enabled:
            return
        if not config_dir:
            from .process_service import _detect_config_dir  # 懒导入避免循环依赖
            config_dir = _detect_config_dir()
        self._path = live_file_path(config_dir, session_id or "")
        self._seen_keys: set[str] = set()
        self._state: Dict[str, Any] = {
            "schema_version": 1,
            "session_id": session_id,
            "turn_id": turn_id,
            "phase": "searching",
            "updated_at": time.time(),
            "sources": {
                name: {"verdict": "pending", "count": 0} for name in requested_sources
            },
            "records": [],
            "raw_total": 0,
        }
        self._write()

    def on_source_done(self, source: str, papers: List[Any], ok: bool) -> None:
        """单个查询 cell 完成时的回调（一个源有多个 cell，会被调多次）。

        papers 为连接器返回的 Paper 模型列表（带 to_api_dict）；ok 为该 cell
        的请求是否成功（超时 / 非 200 → False）。verdict 聚合规则：
        - 有论文 → ok（终态，后续 failed cell 不降级）
        - 无论文且请求失败 → failed（重试 / backup 成功可升回 ok）
        - 无论文且请求成功 → empty（同源后续 cell 可升级）
        """
        if not self._enabled:
            return
        try:
            src = self._state["sources"].setdefault(
                source, {"verdict": "pending", "count": 0}
            )
            src["count"] += len(papers)
            if papers:
                src["verdict"] = "ok"
            elif not ok:
                if src["verdict"] != "ok":
                    src["verdict"] = "failed"
            elif src["verdict"] == "pending":
                src["verdict"] = "empty"

            self._state["raw_total"] += len(papers)
            if papers and len(self._state["records"]) < LIVE_RECORDS_CAP:
                self._append_records(source, papers)
            self._write()
        except Exception as e:
            logger.warning("[live] on_source_done 更新失败（不影响检索）: %s", e)

    def set_phase(self, phase: str) -> None:
        """phase 转换：searching（fan-out 中）→ processing（去重/enrich/打分中）"""
        if not self._enabled:
            return
        try:
            self._state["phase"] = phase
            self._write()
        except Exception as e:
            logger.warning("[live] phase 更新失败（不影响检索）: %s", e)

    def finalize(self) -> None:
        """retrieve 结束（成功或异常）：删除 live 文件，canonical JSONL 接管展示"""
        if not self._enabled:
            return
        try:
            os.unlink(self._path)
        except FileNotFoundError:
            pass
        except Exception as e:
            logger.warning("[live] 清理进度文件失败: %s", e)

    # ===== 内部 =====

    def _append_records(self, source: str, papers: List[Any]) -> None:
        """Paper 模型 → PaperRecord 形状追加进快照；live 内部按 record_key 轻量去重"""
        from .process_service import record_key, to_paper_record  # 懒导入避免循环依赖

        for paper in papers:
            if len(self._state["records"]) >= LIVE_RECORDS_CAP:
                break
            try:
                paper_dict = paper.to_api_dict() if hasattr(paper, "to_api_dict") else dict(paper)
                record = to_paper_record(paper_dict, "", source)
            except Exception:
                continue
            key = record_key(record)
            if key and key in self._seen_keys:
                continue
            if key:
                self._seen_keys.add(key)
            record["turn_id"] = self._state["turn_id"]
            self._state["records"].append(record)

    def _write(self) -> None:
        """原子写：tmp（带 pid 防撞名）+ os.replace；同目录 rename 在 macOS/Linux 原子"""
        self._state["updated_at"] = time.time()
        tmp = f"{self._path}.{os.getpid()}.tmp"
        try:
            os.makedirs(os.path.dirname(self._path), exist_ok=True)
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._state, f, ensure_ascii=False)
            os.replace(tmp, self._path)
        except Exception as e:
            logger.warning("[live] 进度文件写入失败（不影响检索）: %s", e)
            try:
                os.unlink(tmp)
            except OSError:
                pass


# ===== retrieve 之后的进度续写（#775：scorer 阶段无 LiveProgress 实例，直接续写同一 live 文件） =====
#
# searcher 的 LiveProgress 在 retrieve 结束即 finalize 删文件；之后 enrich（processing）与
# scorer（独立子 Agent 的 get_scoring_shard / apply_scoring）是同进程内的后续调用，没有
# LiveProgress 实例。这几个模块级函数据 session_id 直接原子写 live 文件，复用现有 chokidar
# watcher + IPC 链路，让面板在 searcher 完成后继续显示「补全摘要 X/Y」「已评分 X/Y」，消除静态死等。
# 报告阶段的预告/清理由 render_report.py skill 内联（独立进程、不 import 本包，见文件末注）。
# 与 LiveProgress 同样是「增强不是关键路径」：任何写盘失败只 log warning，绝不影响打分/报告。


def _atomic_write_live(config_dir: str, session_id: str, state: Dict[str, Any]) -> None:
    """原子写 live 文件（tmp + os.replace）；失败只 warn，不抛。"""
    path = live_file_path(config_dir, session_id)
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception as e:
        logger.warning("[live] 进度续写失败（不影响打分/报告）: %s", e)
        try:
            os.unlink(tmp)
        except OSError:
            pass


def _read_live_state(config_dir: str, session_id: str) -> Optional[Dict[str, Any]]:
    """读现有 live 文件；不存在 / 损坏返回 None。供 processing 续写做读-改-写保留 records。"""
    try:
        with open(live_file_path(config_dir, session_id), encoding="utf-8") as f:
            state = json.load(f)
        return state if isinstance(state, dict) else None
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def write_processing_progress(
    config_dir: str,
    session_id: Optional[str],
    turn_id: Optional[str],
    enriched: int,
    enrich_total: int,
) -> None:
    """补全摘要进度（phase=processing）：enriched=已补摘要篇数 X，enrich_total=需补全篇数 Y。

    去重是内存瞬时操作、不产生等待，X/Y 只代表真正耗时的 enrich（补摘要）。仅在
    enrich 确认要跑（no_abstract 非空）之后才写，从根上杜绝面板蹦 (0/0)。best-effort。

    与 scoring/reporting 不同：processing 发生在 canonical JSONL 落地**之前**，面板此刻
    靠 live.records 渲染流式检索结果，故必须**读-改-写**保留 searching 阶段累积的
    records/sources/raw_total，只更新补摘要进度——整片覆写成空会让右侧瞬间「暂无检索结果」。
    （enrich 期间 fan-out 已结束、LiveProgress 无并发写，读-改-写安全。）
    """
    if not session_id:
        return
    state = _read_live_state(config_dir, session_id) or {
        "schema_version": 1,
        "session_id": session_id,
        "sources": {},
        "records": [],
        "raw_total": 0,
    }
    state["session_id"] = session_id
    state["turn_id"] = turn_id or state.get("turn_id") or ""
    state["phase"] = "processing"
    state["updated_at"] = time.time()
    state["processed"] = enriched
    state["process_total"] = enrich_total
    _atomic_write_live(config_dir, session_id, state)


def write_scoring_progress(
    config_dir: str,
    session_id: Optional[str],
    turn_id: Optional[str],
    scored: int,
    score_total: int,
) -> None:
    """scorer 分片打分进度（phase=scoring）：scored=已评分篇数 X，score_total=评分窗口总数 Y。"""
    if not session_id:
        return
    _atomic_write_live(
        config_dir,
        session_id,
        {
            "schema_version": 1,
            "session_id": session_id,
            "turn_id": turn_id or "",
            "phase": "scoring",
            "updated_at": time.time(),
            "sources": {},
            "records": [],
            "raw_total": 0,
            "scored": scored,
            "score_total": score_total,
        },
    )


# 注：reporting 阶段的预告与 live 文件清理由 render_report.py（lit-search-report skill）内联实现
# （`_write_reporting_live` / `_clear_live`，纯标准库）——skill 是独立进程、不 import 本包，故不在
# 此提供 write_reporting_progress / clear_live（曾有，因无调用方移除）。改 reporting live schema
# 时只需改 render_report.py 一处。

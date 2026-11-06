"""judge 模块：调模型判 semantic/method（#745 scorer 下沉）。

把判分窗口的候选发给模型（Anthropic-compat /v1/messages，非流式），解析模型返回的
{handle: {semantic, method}} 两维判分。模型渠道（model / base_url / api_key）由主进程
经 env 注入（见 spec docs/specs/scorer-deterministic-dispatch-spec.md §4.4）。

这是 paper-search 首次具备「调 LLM」能力——此前打分的语义两维由 scorer 子 Agent 判、
经 apply_scoring 回传；#745 把这一步下沉到服务端，让打分在 paper-search 内完整闭环、
派发不再依赖主编排 Agent 的指令遵循。判分 rubric 见 JUDGE_RUBRIC（自 scorer.md 下沉）。
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Iterator, Optional

import httpx

logger = logging.getLogger(__name__)

# 判分超时（秒）——env 可覆盖，默认对齐 enrich 量级。
DEFAULT_JUDGE_TIMEOUT_SEC = float(os.environ.get("ASCI_SCORING_TIMEOUT_SEC", "60"))

# 判分输出预算（max_tokens）——env 可覆盖。deepseek-v4-pro 等推理模型思考与输出**共享** max_tokens，
# 8192 会被长 thinking 挤断判分 JSON（真机已证 content[0] 是 thinking 块）→ 解析失败整片丢分。
# 提到 16384 给输出留足空间（双保险，独立于能否关 thinking）；判分输出本身很小（~40 篇 ≈ 数百 token）。
DEFAULT_JUDGE_MAX_TOKENS = int(os.environ.get("ASCI_SCORING_MAX_TOKENS", "16384"))

# 重试规则：沿用 paper-search 既有约定（download_service.RETRYABLE_STATUS_CODES + 指数退避），
# 重试次数取 search_service 的「单次重试」语义（首次 + 1 次）——判分是昂贵 LLM 调用，多轮重试
# 会拖垮整轮延迟（#745 本就是治延迟），单次重试足以扛瞬时抖动（5xx / 429 / 连接读超时）。
JUDGE_RETRYABLE_STATUS = {429, 500, 502, 503, 504}
JUDGE_MAX_ATTEMPTS = 2

# 判分 rubric（自 sub-agents/scorer.md Step 1 + Hard constraints 下沉，#745）。
# 内置 prompt 统一英文（CLAUDE.md 约定）。去掉了 SDK 专属部分（get_scoring_shard /
# apply_scoring 工具调用、输出语言、tool 白名单）——这些由 score_window 工具确定性接管。
# 逐字保留全部判分语义（semantic/method 0-100 bands、缺摘要 ≤50、领域重叠 ≤50、通用方法 ≤40、
# calibration 段 + worked examples few-shot 锚点），确保判分质量与子 Agent 时代不变（#745 fidelity 核对）。
JUDGE_RUBRIC = """You are the evidence-driven scorer (v2) for a research literature pipeline. \
For each candidate paper the user gives you, judge exactly TWO dimensions and output them as JSON. \
You do NOT compute venue tier / citations / recency / publication status — those are derived server-side.

## semantic (0-100): how directly the paper addresses the user's research_question (judge against the \
QUESTION, not the method_terms/object_terms keyword lists — those are recall-optimized broad hints only).
- 90-100 directly solves the question's specific goal · 75-89 addresses it, different scope/variant · \
60-74 partially related · 40-59 same domain but NOT the question's goal · 0-39 broad-field/keyword overlap only.
- HARD CONSTRAINT: domain/modality overlap is NOT enough. If the abstract does not mention or address the \
question's specific goal (e.g. for "extend depth of field": EDOF / all-in-focus / extended focal range), \
then semantic <= 50, no matter how well it matches the field. Generic volumetric / 3D / reconstruction \
imaging that never states the question's specific goal caps at 50.
- HARD CONSTRAINT (missing abstract): if a candidate's abstract is empty/blank, score semantic <= 50 — \
you cannot verify topical relevance from the title alone (the server also hard-caps abstract-less papers).

## method (0-100): how well the paper's method/approach targets the question's specific goal (not just \
"is it the same kind of technique").
- 90-100 the method is built FOR the question's goal · 75-89 close variant of that goal · 55-74 adjacent · \
0-54 different goal/method.
- HARD CONSTRAINT: a paper whose method/goal is generic (and does not explicitly aim at the question's \
specific goal) gets method <= 40 — even if it is the same modality and uses the same family of techniques.
- Worked example — question "deep learning to extend depth of field in light field microscopy": a paper on \
"real-time volumetric light-field microscopy" (volumetric imaging, never mentions DOF/EDOF) -> method ~30, \
semantic <= 50; a paper on "deep-learning extended-depth-of-field microscopy" -> method high, semantic high.

## Calibration & stability (avoid drift / low-balling)
- Judge by OBJECTIVE features in the title/abstract — does it name the question's goal, object, and method? \
— not by overall gestalt. The same paper MUST land in the same band on every run.
- Do NOT low-ball when all three align: a paper whose title names the question's goal AND its object/scene \
AND a relevant method -> semantic >= 85, method >= 75. Worked anchor: "Single-Shot Extended-Depth-of-Field \
Fourier Light Field Microscopy" explicitly names EDOF + light field microscopy -> semantic ~90.
- Use the full 0-100 range. Reserve <40 for field/keyword overlap only. The clearly on-topic papers should \
separate at 80+.

## Output
Output ONLY a JSON object {handle: {"semantic": <0-100>, "method": <0-100>}}, handles copied verbatim from \
the candidates. No prose, no ranked table."""


def _normalize_base_url(base_url: str) -> str:
    """镜像 packages/core url-utils.normalizeAnthropicBaseUrl：去尾斜杠 / 去误填
    /messages / 无版本路径则补 /v1。结果直接 + '/messages' 发请求。
    """
    url = base_url.strip().rstrip("/")
    url = re.sub(r"/messages$", "", url)
    if not re.search(r"/v\d+$", url):
        url = f"{url}/v1"
    return url


def _build_user_message(
    candidates: list[dict],
    research_question: str,
    method_terms: list[str],
    object_terms: list[str],
) -> str:
    lines = [f"Research question: {research_question}"]
    if method_terms:
        lines.append(f"method_terms (secondary hints): {', '.join(method_terms)}")
    if object_terms:
        lines.append(f"object_terms (secondary hints): {', '.join(object_terms)}")
    lines.append(
        '\nJudge each candidate below. Output ONLY a JSON object '
        '{handle: {"semantic": 0-100, "method": 0-100}}, handles copied verbatim.'
    )
    for c in candidates:
        lines.append(
            f"- handle={c['handle']} | title={c.get('title', '')} "
            f"| year={c.get('year', '')} | abstract={c.get('abstract', '')}"
        )
    return "\n".join(lines)


def _extract_text(data: dict) -> str:
    """从 Anthropic(-compat) messages 响应取文本——拼接所有 type==text 块。

    不能盲取 content[0]：deepseek-v4-pro 等模型走 compat 端点时会先发 thinking 块
    （{type:"thinking",...} 无 "text" 键），文本答案在后续块，content[0]["text"] 直接
    KeyError（#745 真机失因）。遍历取所有 text 块拼接，跳过 thinking / tool_use 等。
    """
    content = data.get("content") if isinstance(data, dict) else None
    if not isinstance(content, list):
        raise ValueError(f"判分响应缺 content 数组: {str(data)[:200]!r}")
    text = "".join(
        b["text"] for b in content
        if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str)
    )
    if not text:
        raise ValueError(f"判分响应无 text 块（仅 thinking/其他）: {str(content)[:200]!r}")
    return text


def _iter_json_objects(text: str) -> Iterator[str]:
    """按出现顺序 yield 文本里每个「括号配平」的顶层 JSON 对象子串。

    跟踪字符串字面量与转义，不被字符串内、markdown fence（``` 不含 {）、或前置说明文字里的
    { } 干扰。从某个 { 起若括号未闭合（前置伪对象少一个 } / 尾部被 max_tokens 截断），跳到
    下一个 { 继续找，而非放弃剩余文本——保证真 JSON 不被未配平的前置 { 吞掉（#802）。
    """
    i, n = 0, len(text)
    while i < n:
        if text[i] != "{":
            i += 1
            continue
        depth = 0
        in_str = False
        escaped = False
        closed_at = -1
        for j in range(i, n):
            c = text[j]
            if in_str:
                if escaped:
                    escaped = False
                elif c == "\\":
                    escaped = True
                elif c == '"':
                    in_str = False
                continue
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    closed_at = j
                    break
        if closed_at == -1:
            i += 1  # 从当前 { 起未闭合 → 跳过它，从下一字符继续找下一个 {
            continue
        yield text[i : closed_at + 1]
        i = closed_at + 1


def _looks_like_scores(obj: object) -> bool:
    """判分结果形如 {handle: {semantic, method}}——顶层非空 dict，且至少一个 value 是含
    `semantic` 或 `method` 键的 dict。

    据此跳过模型在真 JSON 前回显的伪对象：① 标量伪对象（{"note": "..."}，value 非 dict）；
    ② wrapper（{"scores": {handle: {...}}}——其 value 是 {handle:...}、不含 semantic/method
    键）。否则把伪对象当判分结果 → apply_scoring 0 命中、静默丢分且不计 failed_shards（比原
    bug 更隐蔽，#804）。维度值可坏 / 为 null（键在即可），不误伤 #801 坏值判分场景。
    """
    return isinstance(obj, dict) and any(
        isinstance(v, dict) and ("semantic" in v or "method" in v)
        for v in obj.values()
    )


def _parse_scores(text: str) -> dict:
    """从模型返回文本提取判分 JSON：按出现顺序对每个括号配平的顶层 JSON 对象尝试解析，
    返回**第一个既能解析、又形如判分结果**的 dict。

    不预剥 markdown fence——fence 标记（```）不含 {，括号配平天然跳过；预剥 fence 反而会在
    多 fence / fence 外有真 JSON 时丢数据。逐候选 + 结构校验共同跳过模型在真 JSON 前回显的
    伪对象（含 { 的说明文字 / 标量对象），避免旧「首 { 到末 }」子串法截出非法子串致整批丢分（#802）。
    """
    for candidate in _iter_json_objects(text):
        try:
            obj = json.loads(candidate)
        except ValueError:
            continue
        if not isinstance(obj, dict):
            continue
        if _looks_like_scores(obj):
            return obj
        # 解 wrapper：模型可能把判分包一层（{"scores": {...}} / {"result": {...}}）——顶层不像
        # 判分但某个 value 像判分，则取该 value，避免把 wrapper 的顶层 key 当 handle（#804）。
        for v in obj.values():
            if _looks_like_scores(v):
                return v
    raise ValueError(f"判分响应未含可解析的判分 JSON 对象: {text[:200]!r}")


def _coerce_dim(v: object) -> Optional[int]:
    """把单个维度值钳到 [0,100] 整数；非数字 / 缺失 / bool 置 None（交 score_record 回退）。"""
    if isinstance(v, bool):  # bool 是 int 子类，须先排除
        return None
    if isinstance(v, (int, float)):
        return max(0, min(100, int(round(v))))
    return None


def _sanitize_scores(raw: dict) -> dict:
    """规整模型判分：丢弃非 dict 条目，每个 handle 钳制 semantic/method。"""
    out: dict[str, dict] = {}
    for handle, dims in raw.items():
        if not isinstance(dims, dict):
            continue
        out[handle] = {
            "semantic": _coerce_dim(dims.get("semantic")),
            "method": _coerce_dim(dims.get("method")),
        }
    return out


async def judge_candidates(
    candidates: list[dict],
    research_question: str,
    method_terms: list[str],
    object_terms: list[str],
    *,
    model: str,
    base_url: str,
    api_key: str,
    timeout_sec: float = DEFAULT_JUDGE_TIMEOUT_SEC,
    transport: Optional[httpx.BaseTransport] = None,
) -> dict:
    """调模型判 candidates 的 semantic/method，返回 {handle: {semantic, method}}。"""
    body = {
        "model": model,
        "max_tokens": DEFAULT_JUDGE_MAX_TOKENS,
        "stream": False,
        "system": JUDGE_RUBRIC,
        "messages": [
            {
                "role": "user",
                "content": _build_user_message(
                    candidates, research_question, method_terms, object_terms
                ),
            }
        ],
    }
    headers = {
        "x-api-key": api_key,
        "Authorization": f"Bearer {api_key}",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    url = f"{_normalize_base_url(base_url)}/messages"

    async with httpx.AsyncClient(transport=transport, timeout=timeout_sec) as client:
        for attempt in range(JUDGE_MAX_ATTEMPTS):
            try:
                resp = await client.post(url, json=body, headers=headers)
            except httpx.TransportError:  # 连接 / 读写超时等瞬时网络错误
                if attempt < JUDGE_MAX_ATTEMPTS - 1:
                    await asyncio.sleep(min(8, 2 ** attempt))
                    continue
                raise
            if resp.status_code in JUDGE_RETRYABLE_STATUS and attempt < JUDGE_MAX_ATTEMPTS - 1:
                await asyncio.sleep(min(8, 2 ** attempt))
                continue
            resp.raise_for_status()  # 非可重试 4xx / 重试耗尽的 5xx 在此抛出
            data = resp.json()
            # R1 可观测：judge 走裸 httpx 直连模型、不经 SDK，token 不进主进程计费/遥测。
            # 先把每次判分的 usage 记进 paper-search 日志（可审计），完整接入计费走后续跨进程遥测。
            usage = data.get("usage") if isinstance(data, dict) else None
            if isinstance(usage, dict):
                logger.info(
                    "[judge] usage model=%s in=%s out=%s candidates=%d",
                    model, usage.get("input_tokens"), usage.get("output_tokens"), len(candidates),
                )
            return _sanitize_scores(_parse_scores(_extract_text(data)))
    raise RuntimeError("judge 重试耗尽且未捕获异常")  # 理论不可达（循环必 return 或 raise）

"""judge 模块单测（#745 scorer 下沉）。

judge_candidates：把候选发给模型（Anthropic-compat /v1/messages 非流式），
解析返回 {handle:{semantic,method}}。mock 模型 http 用 httpx.MockTransport
（外部模型调用不可避免要 mock；其余逻辑均真实）。
"""
from __future__ import annotations

import asyncio

import httpx

from .paper_scoring_judge import judge_candidates


def _anthropic_text_response(text: str) -> httpx.Response:
    """构造 Anthropic messages 非流式响应（content[0].text 装判分 JSON）。"""
    return httpx.Response(
        200,
        json={
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "content": [{"type": "text", "text": text}],
            "stop_reason": "end_turn",
        },
    )


def test_judge_candidates_parses_scores_from_model() -> None:
    """judge_candidates 调模型后，把返回 JSON 解析成 {handle:{semantic,method}}。"""
    candidates = [
        {"handle": "h1", "title": "Extended-depth-of-field light field microscopy",
         "abstract": "A deep-learning method to extend depth of field.", "year": 2024},
        {"handle": "h2", "title": "Volumetric light-field imaging",
         "abstract": "Generic 3D reconstruction, no DOF goal.", "year": 2023},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return _anthropic_text_response(
            '{"h1": {"semantic": 90, "method": 85}, "h2": {"semantic": 40, "method": 30}}'
        )

    result = asyncio.run(
        judge_candidates(
            candidates,
            research_question="extend depth of field in light field microscopy",
            method_terms=[],
            object_terms=[],
            model="deepseek-v4-pro",
            base_url="https://api.example.com",
            api_key="sk-test",
            transport=httpx.MockTransport(handler),
        )
    )

    assert result == {
        "h1": {"semantic": 90, "method": 85},
        "h2": {"semantic": 40, "method": 30},
    }


def test_judge_candidates_extracts_json_from_markdown_fence() -> None:
    """模型把判分 JSON 包在 ```json fence 里时仍能提取（真机高频）。"""
    candidates = [{"handle": "h1", "title": "t", "abstract": "a", "year": 2024}]

    def handler(request: httpx.Request) -> httpx.Response:
        return _anthropic_text_response(
            'Here are the scores:\n```json\n{"h1": {"semantic": 80, "method": 70}}\n```\n'
        )

    result = asyncio.run(
        judge_candidates(
            candidates, research_question="q", method_terms=[], object_terms=[],
            model="m", base_url="https://api.example.com", api_key="sk",
            transport=httpx.MockTransport(handler),
        )
    )

    assert result == {"h1": {"semantic": 80, "method": 70}}


def test_judge_candidates_request_uses_large_max_tokens() -> None:
    """max_tokens 须足够大：deepseek-v4-pro 思考与输出共享预算，8192 会被长 thinking
    挤断 JSON（真机 thinking 块已证）。提高到 >=16384 给输出留足空间（双保险）。"""
    candidates = [{"handle": "h1", "title": "t", "abstract": "a", "year": 2024}]
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json
        captured["body"] = _json.loads(request.content)
        return _anthropic_text_response('{"h1": {"semantic": 80, "method": 70}}')

    asyncio.run(
        judge_candidates(
            candidates, research_question="q", method_terms=[], object_terms=[],
            model="m", base_url="https://api.example.com", api_key="sk",
            transport=httpx.MockTransport(handler),
        )
    )

    assert captured["body"]["max_tokens"] >= 16384


def test_judge_candidates_skips_thinking_block_picks_text() -> None:
    """模型（deepseek-v4-pro 等）走 Anthropic-compat 时 content[0] 是 thinking 块、
    文本答案在后续块——judge 须遍历取 type==text 块，不能盲取 content[0]（真机 KeyError 根因）。"""
    candidates = [{"handle": "h1", "title": "t", "abstract": "a", "year": 2024}]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "id": "msg_1", "type": "message", "role": "assistant",
                "content": [
                    {"type": "thinking", "thinking": "let me judge h1 ..."},
                    {"type": "text", "text": '{"h1": {"semantic": 88, "method": 72}}'},
                ],
                "stop_reason": "end_turn",
            },
        )

    result = asyncio.run(
        judge_candidates(
            candidates, research_question="q", method_terms=[], object_terms=[],
            model="m", base_url="https://api.example.com", api_key="sk",
            transport=httpx.MockTransport(handler),
        )
    )

    assert result == {"h1": {"semantic": 88, "method": 72}}


def test_judge_candidates_retries_once_on_transient_5xx() -> None:
    """首次命中可重试状态码（503）时单次重试，第二次成功则正常解析。"""
    candidates = [{"handle": "h1", "title": "t", "abstract": "a", "year": 2024}]
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503, text="upstream busy")
        return _anthropic_text_response('{"h1": {"semantic": 80, "method": 70}}')

    result = asyncio.run(
        judge_candidates(
            candidates, research_question="q", method_terms=[], object_terms=[],
            model="m", base_url="https://api.example.com", api_key="sk",
            transport=httpx.MockTransport(handler),
        )
    )

    assert calls["n"] == 2  # 重试了一次
    assert result == {"h1": {"semantic": 80, "method": 70}}


def test_judge_candidates_retries_once_on_transport_error() -> None:
    """首次抛瞬时网络错误（ConnectError）时单次重试，第二次成功则正常解析。"""
    candidates = [{"handle": "h1", "title": "t", "abstract": "a", "year": 2024}]
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ConnectError("conn reset", request=request)
        return _anthropic_text_response('{"h1": {"semantic": 80, "method": 70}}')

    result = asyncio.run(
        judge_candidates(
            candidates, research_question="q", method_terms=[], object_terms=[],
            model="m", base_url="https://api.example.com", api_key="sk",
            transport=httpx.MockTransport(handler),
        )
    )

    assert calls["n"] == 2
    assert result == {"h1": {"semantic": 80, "method": 70}}


def test_judge_candidates_raises_after_retry_exhausted() -> None:
    """两次都命中可重试状态码时，重试耗尽抛错（交 score_window 计 failed_shards）。"""
    candidates = [{"handle": "h1", "title": "t", "abstract": "a", "year": 2024}]
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(503, text="still busy")

    raised = False
    try:
        asyncio.run(
            judge_candidates(
                candidates, research_question="q", method_terms=[], object_terms=[],
                model="m", base_url="https://api.example.com", api_key="sk",
                transport=httpx.MockTransport(handler),
            )
        )
    except httpx.HTTPStatusError:
        raised = True

    assert raised is True
    assert calls["n"] == 2  # 首次 + 1 次重试，不再多打


def test_judge_candidates_clamps_out_of_range_scores() -> None:
    """模型返回越界分值时，judge 在源头钳到 [0,100]。"""
    candidates = [{"handle": "h1", "title": "t", "abstract": "a", "year": 2024}]

    def handler(request: httpx.Request) -> httpx.Response:
        return _anthropic_text_response('{"h1": {"semantic": 150, "method": -10}}')

    result = asyncio.run(
        judge_candidates(
            candidates, research_question="q", method_terms=[], object_terms=[],
            model="m", base_url="https://api.example.com", api_key="sk",
            transport=httpx.MockTransport(handler),
        )
    )

    assert result == {"h1": {"semantic": 100, "method": 0}}


def test_judge_candidates_nulls_missing_or_nonnumeric_dimensions() -> None:
    """缺字段 / 非数字维度置 None（apply_scoring 的 score_record 会回退处理）。"""
    candidates = [
        {"handle": "h1", "title": "t", "abstract": "a", "year": 2024},
        {"handle": "h2", "title": "t", "abstract": "a", "year": 2024},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return _anthropic_text_response(
            '{"h1": {"semantic": 70}, "h2": {"semantic": "x", "method": 50}}'
        )

    result = asyncio.run(
        judge_candidates(
            candidates, research_question="q", method_terms=[], object_terms=[],
            model="m", base_url="https://api.example.com", api_key="sk",
            transport=httpx.MockTransport(handler),
        )
    )

    assert result == {
        "h1": {"semantic": 70, "method": None},
        "h2": {"semantic": None, "method": 50},
    }


# ===== #802：_parse_scores 健壮性（前置说明含 { / fence / 纯 JSON / 无 JSON）=====


def test_parse_scores_skips_preamble_with_braces() -> None:
    """#802：模型在真 JSON 前回显含 { 的说明文字（rubric 内嵌 {handle:{...}} 模板易被复述）时，
    _parse_scores 须跳过伪对象、解析真正的判分 JSON——而非 first-{ / last-} 截出非法子串报错、
    导致该分片整批候选静默丢分。"""
    from .paper_scoring_judge import _parse_scores
    text = 'Here is the {handle: {"semantic": 0-100}} format:\n{"h1": {"semantic": 90, "method": 80}}'
    assert _parse_scores(text) == {"h1": {"semantic": 90, "method": 80}}


def test_parse_scores_strips_markdown_fence() -> None:
    """```json fence 包裹（真机高频）→ 剥 fence 后解析。"""
    from .paper_scoring_judge import _parse_scores
    text = '```json\n{"h1": {"semantic": 88, "method": 70}}\n```'
    assert _parse_scores(text) == {"h1": {"semantic": 88, "method": 70}}


def test_parse_scores_fence_with_preamble() -> None:
    """fence + fence 前含 { 的说明文字：剥 fence 取真 JSON，不被前置 { 干扰。"""
    from .paper_scoring_judge import _parse_scores
    text = 'Output {handle:{...}} below:\n```json\n{"h1": {"semantic": 60, "method": 55}}\n```'
    assert _parse_scores(text) == {"h1": {"semantic": 60, "method": 55}}


def test_parse_scores_plain_json() -> None:
    """无 fence、无前置——纯 JSON 直接解析（既有主路径不回归）。"""
    from .paper_scoring_judge import _parse_scores
    assert _parse_scores('{"h1": {"semantic": 50, "method": 40}}') == {"h1": {"semantic": 50, "method": 40}}


def test_parse_scores_no_json_raises() -> None:
    """完全无 JSON 对象 → 抛 ValueError（明确失因，不静默）。"""
    import pytest
    from .paper_scoring_judge import _parse_scores
    with pytest.raises(ValueError):
        _parse_scores("no json object here at all")


def test_parse_scores_multiple_fences_picks_real_json() -> None:
    """#802 A：多 fence——第一个是推理/说明、第二个才是判分 JSON。须取真 JSON，
    不能被首个 fence 卡住（剥 fence 只取首个会丢真 JSON）。"""
    from .paper_scoring_judge import _parse_scores
    text = '推理:\n```\njust reasoning\n```\n分数:\n```json\n{"h1": {"semantic": 5, "method": 5}}\n```'
    assert _parse_scores(text) == {"h1": {"semantic": 5, "method": 5}}


def test_parse_scores_bare_json_after_fence() -> None:
    """#802 A：真 JSON 裸在 fence 之后（fence 内是无关说明）→ 仍取到真 JSON。"""
    from .paper_scoring_judge import _parse_scores
    text = '```\nformat note\n```\n{"h1": {"semantic": 60, "method": 55}}'
    assert _parse_scores(text) == {"h1": {"semantic": 60, "method": 55}}


def test_parse_scores_skips_unbalanced_preamble_braces() -> None:
    """#802 A：前置说明含未配平的 { → 不能吞掉其后的真 JSON（配平失败须跳到下一个 { 继续）。"""
    from .paper_scoring_judge import _parse_scores
    text = 'template like {handle: {sub} and scores: {"h1": {"semantic": 5, "method": 5}}'
    assert _parse_scores(text) == {"h1": {"semantic": 5, "method": 5}}


def test_parse_scores_skips_scalar_pseudo_object() -> None:
    """#802 B：真 JSON 前有合法但非判分结果的标量伪对象（如 {"note": ...}）→ 跳过取真判分，
    避免拿错对象致 apply_scoring 0 命中、静默丢分（比原 bug 更隐蔽）。"""
    from .paper_scoring_judge import _parse_scores
    text = '{"note": "scoring now"}\n{"h1": {"semantic": 90, "method": 80}}'
    assert _parse_scores(text) == {"h1": {"semantic": 90, "method": 80}}


def test_parse_scores_ignores_truncated_trailing_object() -> None:
    """#802 A：尾部对象被 max_tokens 截断未闭合 → 已闭合的完整判分对象照常解析。"""
    from .paper_scoring_judge import _parse_scores
    text = '{"h1": {"semantic": 5, "method": 5}}\n{"h2": {"semantic'
    assert _parse_scores(text) == {"h1": {"semantic": 5, "method": 5}}


def test_parse_scores_unwraps_wrapper_object() -> None:
    """#804：模型常把判分包一层（{"scores": {...}} / {"result": {...}}）——顶层 key 不是 handle。
    须解包取内层判分，而非把 "scores" 当 handle（否则 apply_scoring 0 命中、静默丢分、不计
    failed_shards——比原 bug 更隐蔽）。"""
    from .paper_scoring_judge import _parse_scores
    text = '{"scores": {"h1": {"semantic": 90, "method": 80}}}'
    assert _parse_scores(text) == {"h1": {"semantic": 90, "method": 80}}


def test_parse_scores_keeps_bad_dimension_values() -> None:
    """#804：收紧「像判分」的结构校验不能误伤 #801 坏值场景——模型返回的维度键在、但值坏
    （非数字 / null），仍是判分结果（键在即可），须返回交 _sanitize_scores/apply_scoring 处理，
    不能被当成非判分对象跳过。"""
    from .paper_scoring_judge import _parse_scores
    text = '{"h1": {"semantic": "x", "method": null}}'
    assert _parse_scores(text) == {"h1": {"semantic": "x", "method": None}}

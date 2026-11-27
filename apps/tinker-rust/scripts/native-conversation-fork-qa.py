"""Verify the existing message menu, prefix isolation and process restart in a signed QA bundle."""
import argparse
import json
from pathlib import Path
from runpy import run_path
import time
import tempfile
import uuid

HERE = Path(__file__).resolve().parent
portable = run_path(str(HERE / "native-portable-project-qa.py"))
routes, tasks = portable["routes"], portable["tasks"]
PROJECT = "Conversation forks"
FIRST = "First orchard note."
LATER = "Keep this later note only in the original."
FOLLOW = "[qa:fork-context] Continue the forked orchard note."


def rows(w):
    return portable["snapshot"](w)[PROJECT]["sessions"]


def send(w, text):
    w.send(text)
    # The prior reply can still have a completed badge while the new turn streams.
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        for record in rows(w):
            last = record["messages"][-2:]
            if (len(last) == 2 and last[0]["role"] == "user" and last[0]["text"] == text
                    and last[1]["role"] == "assistant" and last[1]["text"].endswith("completed.")):
                return
        time.sleep(.1)
    raise AssertionError("New user message did not receive a completed mock response")


def fork_first(w):
    w.wait("""const buttons=[...document.querySelectorAll('button')].filter(b=>
        ['More message actions','更多消息操作'].includes(b.getAttribute('aria-label')));
        if(!buttons[0])return false;buttons[0].focus();
        buttons[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));return true;""",
           "open the first reply menu")
    routes["named"](w, "[role=menuitem]", ["Fork from here", "从此处分叉"])
    w.wait("return document.body.innerText.includes('(fork)')", "opened the new conversation")


def user_prompts(session):
    return [r["text"] for r in session["messages"] if r["role"] == "user"]


def run(bundle):
    if not __debug__:
        raise ValueError("Run with Python assertions enabled")
    binary = run_path(str(HERE / "native-macos-release-gate.py"))["check_bundle"](bundle, "qa")
    evidence = Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-fork-", dir="/private/tmp"))
    root = Path("/private/tmp") / ("tinker-tauri-channels-preview-fork-" + uuid.uuid4().hex)
    pids = []
    print("Evidence:", evidence, flush=True)
    with portable["window"](binary, root, evidence, "first", pids) as w:
        routes["open_settings"](w)
        routes["add_provider"](w, routes["A"], routes["endpoint"](root, ""), 1)
        channel, = routes["catalog"](w)
        routes["common"]["close_settings"](w)
        routes["select_model"](w, channel["id"], routes["TEXT"])
        tasks["create_project"](w, PROJECT)
        tasks["select_project"](w, PROJECT, new=True)
        send(w, FIRST)
        send(w, LATER)
    with portable["window"](binary, root, evidence, "fork", pids) as w:
        tasks["select_project"](w, PROJECT)
        tasks["enter_session"](w)
        original, = rows(w)
        assert user_prompts(original) == [FIRST, LATER], original
        before = routes["counts"](root)
        fork_first(w)
        parent, branch = sorted(rows(w), key=lambda s: s["title"].endswith("(fork)"))
        assert original == parent and user_prompts(branch) == [FIRST], (parent, branch)
        assert before == routes["counts"](root)
        send(w, FOLLOW)
        w.wait("return document.querySelector('.conversation-column__messages')?.innerText.includes('Fork prefix verified.')",
               "provider confirmed the exact three-message request body")
        expected = rows(w)
        assert next(s for s in expected if s["id"] == original["id"]) == original
        assert user_prompts(next(s for s in expected if s["id"] == branch["id"])) == [FIRST, FOLLOW]
        after = routes["counts"](root)
        assert after == [[before[0][0],before[0][1]+1], before[1]], after
    with portable["window"](binary, root, evidence, "restore", pids) as w:
        assert rows(w) == expected
        w.wait(f"return document.querySelector('.conversation-column__messages')?.innerText.includes({json.dumps(FOLLOW)})",
               "reopened active fork")
        assert routes["counts"](root) == after
    assert len(set(pids)) == 3
    print(json.dumps({"pids": pids, "providerCounts": after, "result":"passed"}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("qa_bundle", type=Path)
    run(parser.parse_args().qa_bundle)

"""Exercise project task lifecycle through an isolated macOS native QA window and owned HTTP mock."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
from runpy import run_path
import signal
import subprocess
import tempfile
import time
import uuid

helpers = run_path(str(Path(__file__).with_name("native-session-import-qa.py")))
Window = helpers["Window"]
choose = helpers["choose"]

NORTH, SOUTH = "Northern observations", "Southern observations"
A = "[task-stream] Summarize the northern field notebook."
B = "[task-stream] Summarize the southern field notebook."
RETRY = "[task-retry] Compare the southern observations."
QUIT_ACTIVE = "[task-stream] Continue the northern field notebook before departure."
INTERRUPT = "[task-stream] Continue the northern field notebook after the storm."
STOP = ".agent-composer__stop"
PROJECT_ROW = ".project-overview__sessions button"
SEND = ",".join(f'button[aria-label="{label}"]' for label in ("Send message", "Send", "发送消息", "发送"))


def create_project(w, name):
    choose(w, ".home-projects__heading button:last-child", "new project")
    w.wait(f"""const input=document.querySelector('.home-projects__input');
        if(!input)return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,{json.dumps(name)});
        input.dispatchEvent(new Event('input',{{bubbles:true}}));return true;""", "enter project name")
    w.js("""const input=document.querySelector('.home-projects__input');
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true;""")
    w.wait(f"return document.querySelector('.project-overview h1')?.textContent==={json.dumps(name)}",
           "created project overview")


def select_project(w, name, new=False):
    cls = ".home-projects__create" if new else ".home-projects__item"
    w.wait(f"""const branch=[...document.querySelectorAll('.home-projects__branch')].find(
            e=>e.querySelector('.home-projects__item')?.innerText.trim()==={json.dumps(name)});
        const b=branch?.querySelector({json.dumps(cls)});if(!b||b.disabled)return false;b.click();return true;""",
           "new project conversation" if new else "select project")
    if new:
        w.ready()
    else:
        w.wait(f"return document.querySelector('.project-overview h1')?.textContent==={json.dumps(name)}",
               "selected project overview")


def wait_project_status(w, status):
    expr = f"""const rows=document.querySelectorAll({json.dumps(PROJECT_ROW)});
        return rows.length===1 && rows[0].querySelector('[data-task-status]')?.dataset.taskStatus==={json.dumps(status)};"""
    # Each long stream deliberately lives for 16 seconds so both native workers can overlap.
    end = time.monotonic() + 25
    while time.monotonic() < end:
        if w.js(expr):
            return
        time.sleep(.5)
    raise AssertionError(f"Missing project task status {status}: {w.js('return document.body.innerText.slice(-1200)')}")


def enter_session(w):
    choose(w, PROJECT_ROW, "open the project's only conversation")
    w.ready()


def streaming(w, prompt, expected_user_turns=1):
    w.wait(f"""const chat=document.querySelector('.conversation-column__messages')?.innerText??'';
        const prompt={json.dumps(prompt)}, pos=chat.lastIndexOf(prompt);
        const users=[...document.querySelectorAll('.conversation-column__messages [data-message-role="user"]')];
        return !!document.querySelector({json.dumps(STOP)}) && pos>=0 &&
          chat.slice(pos+prompt.length).includes('Local Mock A · 上下文') &&
          users.filter(row=>row.innerText.includes(prompt)).length==={expected_user_turns};""",
           "visible mock delta, correct number of user turns and Stop control")


def double_send(w, text):
    w.js(f"""const e=document.querySelector('.ProseMirror[contenteditable=true]');
        e.focus(); document.execCommand('insertText',false,{json.dumps(text)});return true;""")
    w.wait(f"""const e=document.querySelector('.ProseMirror[contenteditable=true]');
        const b=document.querySelector({json.dumps(SEND)});
        if(!b||b.disabled||e?.textContent!=={json.dumps(text)})return false;
        b.click();b.click();return true;""", "two immediate clicks on the same Send control")


def terminal(w, status):
    return w.wait(f"""const b=[...document.querySelectorAll('[data-native-task-status]')].at(-1);
        return b?.dataset.nativeTaskStatus==={json.dumps(status)} && b.dataset.requestId;""",
                  f"latest visible assistant result marked {status}")


def interrupted_snapshot(w, request_id):
    w.command("focus")
    script = f"""const badge=document.querySelector('[data-request-id="{request_id}"]');
        const button=badge?.querySelector('[data-native-task-retry]');
        const reply=badge?.previousElementSibling;
        if(!button||!reply||!reply.innerText.includes('Local Mock A'))return false;
        const r=button.getBoundingClientRect(), x=r.x+r.width/2,y=r.y+r.height/2;
        const hit=document.elementFromPoint(x,y);
        const chain=[];
        for(let e=button;e;e=e.parentElement){{
            const css=getComputedStyle(e);
            chain.push({{cls:String(e.className).slice(0,90),opacity:+css.opacity,
                visible:css.visibility==='visible',display:css.display,scrollTop:e.scrollTop}});
        }}
        const rect=reply.getBoundingClientRect();
        const walker=document.createTreeWalker(reply,NodeFilter.SHOW_TEXT);
        let text;
        while((text=walker.nextNode()) && !text.textContent.includes('Local Mock A')){{}}
        if(!text)return false;
        const range=new Range();range.selectNodeContents(text);
        const line=range.getBoundingClientRect();
        const partialHit=reply.contains(document.elementFromPoint(line.x+line.width/2,line.y+line.height/2));
        return {{retryHit:button.contains(hit),partialHit,x,y,replyTop:rect.top,replyBottom:rect.bottom,
            visible:document.visibilityState,viewport:window.innerHeight,
            opaque:chain.every(e=>e.opacity>=.99&&e.visible&&e.display!=='none')}};"""
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        view = w.js(script)
        if view and view["retryHit"] and view["partialHit"] and view["opaque"] and view["visible"] == "visible" and (
                view["replyBottom"] > 0 and view["replyTop"] < view["viewport"]):
            # WKWebView can composite its outgoing view immediately after the DOM changes.
            time.sleep(.5)
            png = w.command("snapshot")["png"]
            checker = Path(__file__).with_name("native-project-task-paint.js")
            pixels = subprocess.run(["/usr/bin/osascript", "-l", "JavaScript", str(checker), png],
                                    text=True, capture_output=True, timeout=15, check=True).stdout
            if all(term in pixels.lower() for term in ("interrupted", "retry", "storm", "1/0")):
                return png, {**view, "recognized": pixels.splitlines()}

        time.sleep(.25)
    raise AssertionError(f"Restored reply and Retry did not become visible: {view}")


def histories(w):
    w.js(f"""window.__qaTaskHistory=null;void (async()=>{{
        const api=window.electronAPI;
        const [projects,sessions]=await Promise.all([api.listAgentWorkspaces(),api.listAgentSessions()]);
        const result={{}};
        for(const name of {json.dumps([NORTH,SOUTH])}){{
            const ws=projects.find(p=>p.name===name);
            const matches=sessions.filter(s=>s.workspaceId===ws?.id);
            if(!ws || matches.length!==1)throw Error('Incorrect project scope: '+name);
            const sid=matches[0].id;
            const rows=await api.getAgentSessionSDKMessages(sid);
            result[name]={{workspaceId:ws.id,sessionId:sid,rows:rows.filter(r=>['user','assistant'].includes(r.type))
                .map(r=>({{id:r.uuid,role:r.type,status:r._desktopRuntimeStatus??null,
                    text:r.message.content.filter(c=>c.type==='text').map(c=>c.text).join('')}}))}};
        }}
        window.__qaTaskHistory=result;
    }})().catch(e=>window.__qaTaskHistory={{error:String(e)}});return true;""")
    data = w.wait("return window.__qaTaskHistory", "read Rust SDK projections for both projects")
    assert "error" not in data, data
    assert data[NORTH]["workspaceId"] != data[SOUTH]["workspaceId"]
    assert data[NORTH]["sessionId"] != data[SOUTH]["sessionId"]
    return data


def verify_turns(history, expected):
    rows = history["rows"]
    assert len(rows) == len(expected) * 2, rows
    assert len({row["id"] for row in rows}) == len(rows), rows
    for i, (prompt, status) in enumerate(expected):
        user, result = rows[i*2 : i*2+2]
        assert (user["role"], user["text"]) == ("user", prompt), user
        assert (result["role"], result["status"]) == ("assistant", status), result
        assert result["text"].startswith("Local Mock "), result


def scenarios(w):
    return [r["scenario"] for r in w.command("records")]


def acceptance(binary):
    if not __debug__ or binary.name != "tinker-formal-native-qa" or not binary.is_file():
        raise ValueError("Use the dedicated native QA binary and Python assertions")
    evidence = Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-project-tasks-", dir="/private/tmp"))
    profile = Path("/private/tmp") / ("tinker-tauri-formal-preview-tasks-" + uuid.uuid4().hex)
    print("Evidence:", evidence, flush=True)
    one = Window(binary, profile, evidence, "interleaved")
    try:
        one.ready()
        create_project(one, NORTH)
        create_project(one, SOUTH)
        assert scenarios(one) == []

        select_project(one, NORTH, new=True)
        double_send(one, A)
        streaming(one, A)
        select_project(one, NORTH)
        wait_project_status(one, "running")
        select_project(one, SOUTH, new=True)
        one.send(B)
        streaming(one, B)
        select_project(one, NORTH)
        wait_project_status(one, "running")
        enter_session(one)
        streaming(one, A)
        choose(one, STOP, "cancel northern worker")
        cancelled_id = terminal(one, "cancelled")
        select_project(one, SOUTH)
        wait_project_status(one, "running")
        enter_session(one)
        streaming(one, B)
        assert scenarios(one) == ["task-stream", "task-stream"]
        select_project(one, SOUTH)
        wait_project_status(one, "completed")
        enter_session(one)
        southern_id = terminal(one, "completed")
        one.send(RETRY)
        failed_id = terminal(one, "failed")
        failed_history = histories(one)
        verify_turns(failed_history[NORTH], [(A,"cancelled")])
        verify_turns(failed_history[SOUTH], [(B,"completed"), (RETRY,"failed")])

        select_project(one, SOUTH)
        wait_project_status(one, "failed")
        enter_session(one)
        assert terminal(one, "failed") == failed_id
        assert scenarios(one) == ["task-stream", "task-stream", "task-retry-failed"]
        one.wait("""const b=document.querySelector('[data-native-task-retry]');
            if(!b||b.disabled)return false;b.click();b.click();return true;""", "explicit double-click on Retry")
        retry_id = terminal(one, "completed")
        assert len({cancelled_id,southern_id,failed_id,retry_id}) == 4
        one.command("stale")
        assert not one.js("return /QA_STALE_/.test(document.body.innerText)")
        before_quit = histories(one)
        verify_turns(before_quit[NORTH], [(A,"cancelled")])
        verify_turns(before_quit[SOUTH], [(B,"completed"), (RETRY,"failed"), (RETRY,"completed")])
        assert before_quit[SOUTH]["rows"][:4] == failed_history[SOUTH]["rows"]
        first_records = one.command("records")
        assert [r["scenario"] for r in first_records] == [
            "task-stream","task-stream","task-retry-failed","task-retry-completed"]
        assert [(r["userMessages"],r["assistantMessages"]) for r in first_records] == [(1,0),(1,0),(2,1),(2,1)]
        assert first_records[2]["model"] == first_records[3]["model"]
        assert first_records[2]["effort"] == first_records[3]["effort"]
        select_project(one, NORTH)
        wait_project_status(one, "cancelled")
        enter_session(one)
        assert not one.js("return /QA_STALE_/.test(document.body.innerText)")
        one.send(QUIT_ACTIVE)
        streaming(one, QUIT_ACTIVE)
        first_records = one.command("records")
        assert len(first_records) == 5 and first_records[-1]["scenario"] == "task-stream"
        one.quit()
    finally:
        one.stop_if_running()

    two = Window(binary, profile, evidence, "clean-restart")
    try:
        two.ready()
        assert two.proc.pid != one.proc.pid
        select_project(two, NORTH)
        wait_project_status(two, "interrupted")
        enter_session(two)
        quit_id = terminal(two, "interrupted")
        assert quit_id not in {cancelled_id,southern_id,failed_id,retry_id}
        select_project(two, SOUTH)
        wait_project_status(two, "completed")
        enter_session(two)
        assert terminal(two, "completed") == retry_id
        after_quit = histories(two)
        verify_turns(after_quit[NORTH], [(A,"cancelled"),(QUIT_ACTIVE,"interrupted")])
        assert after_quit[NORTH]["rows"][:2] == before_quit[NORTH]["rows"]
        assert after_quit[SOUTH] == before_quit[SOUTH] and scenarios(two) == []
        select_project(two, NORTH)
        enter_session(two)
        two.send(INTERRUPT)
        streaming(two, INTERRUPT)
        second_records = two.command("records")
        assert [r["scenario"] for r in second_records] == ["task-stream"]
        two.proc.kill()
        assert two.proc.wait(timeout=10) == -signal.SIGKILL
    finally:
        two.stop_if_running()

    three = Window(binary, profile, evidence, "crash-restart")
    try:
        three.ready()
        assert len({one.proc.pid,two.proc.pid,three.proc.pid}) == 3
        select_project(three, NORTH)
        wait_project_status(three, "interrupted")
        enter_session(three)
        interrupted_id = terminal(three, "interrupted")
        assert interrupted_id not in {cancelled_id,southern_id,failed_id,retry_id,quit_id}
        screenshot, recovery_paint = interrupted_snapshot(three, interrupted_id)
        select_project(three, SOUTH)
        wait_project_status(three, "completed")
        enter_session(three)
        assert terminal(three, "completed") == retry_id
        recovered = histories(three)
        verify_turns(recovered[NORTH], [(A,"cancelled"),(QUIT_ACTIVE,"interrupted"),(INTERRUPT,"interrupted")])
        assert recovered[SOUTH] == before_quit[SOUTH]
        assert recovered[NORTH]["rows"][:4] == after_quit[NORTH]["rows"]
        assert recovered[NORTH]["sessionId"] == before_quit[NORTH]["sessionId"] and scenarios(three) == []
        select_project(three, NORTH)
        wait_project_status(three, "interrupted")
        enter_session(three)
        choose(three, "[data-native-task-retry]", "explicit retry of interrupted northern task")
        streaming(three, INTERRUPT, expected_user_turns=2)
        choose(three, STOP, "cancel only this fresh retry")
        interrupted_retry_id = terminal(three, "cancelled")
        assert interrupted_retry_id not in {cancelled_id,southern_id,failed_id,retry_id,quit_id,interrupted_id}
        after_explicit_retry = histories(three)
        verify_turns(after_explicit_retry[NORTH], [(A,"cancelled"),(QUIT_ACTIVE,"interrupted"),
                     (INTERRUPT,"interrupted"),(INTERRUPT,"cancelled")])
        assert after_explicit_retry[NORTH]["rows"][:6] == recovered[NORTH]["rows"]
        assert after_explicit_retry[SOUTH] == recovered[SOUTH]
        third_records = three.command("records")
        assert [r["scenario"] for r in third_records] == ["task-stream"]
        three.quit()
    finally:
        three.stop_if_running()
    digest = sha256()
    with binary.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    report = {"binarySha256":digest.hexdigest(), "pids":[one.proc.pid,two.proc.pid,three.proc.pid], "firstProcessRequests":first_records,
              "cleanRestartBrowsingRequests":0, "preCrashExplicitRequests":second_records,
              "crashRestartBrowsingRequests":0, "explicitPostCrashRetryRequests":third_records, "projects":recovered, "interruptedScreenshot":screenshot, "recoveryPaint":recovery_paint,
              "mockScope":"accepted chat completions at the native host's owned loopback provider"}
    (evidence/"summary.json").write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n")
    print(json.dumps(report,indent=2,ensure_ascii=False), flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary",type=Path)
    acceptance(parser.parse_args().binary.resolve(strict=True))

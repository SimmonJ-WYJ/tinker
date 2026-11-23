"""Run read-only Electron folder import acceptance in two isolated native QA processes."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
from runpy import run_path
import tempfile
import uuid

from native_image_file_checks import fixture_png

Window = run_path(str(Path(__file__).with_name("native-image-qa.py")))["Window"]
TITLE = "Synthetic orchard notebook"
SOURCE_TEXT = "Second observation: amber canopies are visible."
QUERY = "amber canopies"
LOCAL_TEXT = "Independent native thread for import acceptance"
CONTINUE = "Continue the imported orchard observations."
STAMP = 1_730_000_000_000


def json_file(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def seed_source(root):
    """Mirror createAgentSession's v1 index and appendSDKMessages' JSONL line format."""
    root.mkdir(mode=0o700)
    logs = root / "agent-sessions"
    logs.mkdir()
    session, broken, first, second = [str(uuid.uuid4()) for _ in range(4)]
    index = [
        {"id": session, "title": TITLE, "createdAt": STAMP, "updatedAt": STAMP + 5000},
        {"id": broken, "title": "Damaged synthetic session", "createdAt": STAMP, "updatedAt": STAMP},
    ]
    json_file(root / "agent-sessions.json", {"version": 1, "sessions": index})
    files = root / "attachments" / session
    files.mkdir(parents=True)
    rows = []
    for i, (role, message_id, text) in enumerate([
        ("user", first, "First observation: the orchard is still green."),
        ("assistant", str(uuid.uuid4()), "Recorded the initial green leaves."),
        ("user", second, SOURCE_TEXT),
        ("assistant", str(uuid.uuid4()), "Recorded the amber leaves and the missing photo."),
    ]):
        row = {"type": role, "uuid": message_id, "parent_tool_use_id": None, "_createdAt": STAMP + i * 1000,
               "message": {"content": [{"type": "text", "text": text}]}}
        if role == "assistant":
            row["message"].update({"role": role, "id": f"msg_qa_{i}", "model": "synthetic-model"})
        if role == "user":
            asset = str(uuid.uuid4())
            row["imageEditReference"] = {"imageId": asset, "filename": f"{asset}.png",
                                         "localPath": f"{session}/{asset}.png", "mediaType": "image/png"}
            if message_id == first:
                (files / f"{asset}.png").write_bytes(fixture_png())
        rows.append(row)
    (logs / f"{session}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    (logs / f"{broken}.jsonl").write_bytes(b'{"type":"user","message":')
    # These files are synthetic; the importer must ignore them even when located beside the index.
    json_file(root / "channels.json", {"fixture": "synthetic-unrelated-configuration"})
    return first, second


def source_digests(path):
    return {str(p.relative_to(path)): sha256(p.read_bytes()).hexdigest()
            for p in sorted(path.rglob("*")) if p.is_file()}


def choose(w, selector, label):
    w.wait(f"""const b=document.querySelector({json.dumps(selector)});
        if(!b || b.disabled)return false; b.click();return true;""", label)


def click_named(w, scope, names):
    w.wait(f"""const b=[...document.querySelectorAll({json.dumps(scope)})]
        .find(e=>{json.dumps(names)}.includes(e.textContent.trim()));
        if(!b || b.disabled)return false;b.click();return true;""", "click " + names[0])


def search(w, query):
    w.command("focus")
    click_named(w, "button", ["Search", "搜索"])
    w.wait("return !!document.querySelector('[role=dialog] input')", "search field")
    w.js(f"""const input=document.querySelector('[role=dialog] input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,{json.dumps(query)});
        input.dispatchEvent(new Event('input',{{bubbles:true}}));return true;""")
    w.js("""if(!window.__qaImportedFocus) {
        window.__qaImportedFocus=[];document.addEventListener('focusin',event=>{
            if(window.__qaImportedFocus.length>=30)window.__qaImportedFocus.shift();
            window.__qaImportedFocus.push([event.target.tagName,event.target.dataset.messageId]);
        },true);
        new MutationObserver(rs=>rs.forEach(r=>window.__qaImportedFocus.push(
            ['located',r.target.dataset.messageId,r.target.hasAttribute('data-search-located')])))
            .observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-search-located']});
    } return true;""")
    row = w.wait(f"""const mark=[...document.querySelectorAll('[role=dialog] mark')]
        .find(e=>e.textContent.toLowerCase()==={json.dumps(query.lower())});
        const row=mark?.closest('[data-index]');if(!row)return false;
        const text=row.innerText;row.click();return text;""", "matching search result")
    return row


def exact_focus(w, original):
    try:
        return w.wait(f"""const e=document.activeElement?.closest('[data-message-id]');
            return e?.dataset.messageRole==='user' && e.dataset.messageId==={json.dumps(original)}
              && e.textContent.includes({json.dumps(SOURCE_TEXT)}) && e.dataset.messageId;""",
                      "search focuses exact imported user turn")
    except AssertionError:
        print("Focus diagnostic:", w.js("""return {trace:window.__qaImportedFocus,
            active:document.activeElement?.outerHTML.slice(0,180),
            visibility:document.visibilityState,windowFocused:document.hasFocus(),
            dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>[e.dataset.state,
              getComputedStyle(e).animationDuration,e.getAnimations().map(a=>[a.playState,a.currentTime])]),
            nodes:[...document.querySelectorAll('[data-message-id]')].map(e=>
            [e.dataset.messageId,e.dataset.messageRole,e.hasAttribute('data-search-located'),e.innerText.slice(0,50)])};"""), flush=True)
        raise


def recent_titles(w):
    return w.js("return [...document.querySelectorAll('.home-recent-session span.truncate')].map(e=>e.textContent.trim())")


def import_button(w):
    choose(w, '.sidebar-account-trigger', 'open settings')
    click_named(w, '[role=dialog] button', ["General", "通用", "常规"])
    w.wait("return !!document.querySelector('[data-testid=native-session-import]')", "import settings")


def select_folder(w, choice):
    assert w.command("arm-session-folder", choice=choice)
    choose(w, '[data-testid=native-session-import]', "choose Electron folder")


def count_report(w, imported, duplicates, skipped):
    expected = f"Imported {imported} · already imported {duplicates} · skipped {skipped}"
    return w.wait(f"""const s=[...document.querySelectorAll('[role=dialog] [role=status]')]
        .map(e=>e.innerText).join(' ');
        return s.includes({json.dumps(expected)}) && s;""", expected)


def close_settings(w):
    choose(w, '[data-spotlight-target=settings-close]', 'close settings')
    w.wait("return !document.querySelector('[role=dialog][data-state=open]')", "closed settings")


def mapped_ids(w, original_ids):
    # Validate the public SDK projection against the source before locating its visible rows.
    w.js(f"""void (async()=>{{
        const [session]=(await window.electronAPI.listAgentSessions()).filter(s=>s.title==={json.dumps(TITLE)});
        const rows=await window.electronAPI.getAgentSessionSDKMessages(session.id);
        const hits=await window.electronAPI.searchAgentSessionMessages({json.dumps(QUERY)});
        window.__qaImportedIds={{sid:session.id,searchHits:hits.filter(h=>h.sessionId===session.id).map(h=>h.messageId),rows:rows.filter(row=>row._electronImported)
            .map(row=>[row._electronSourceMessageId,row.uuid,row.session_id])}};
    }})().catch(()=>{{window.__qaImportedIds={{error:true}}}});return true;""")
    state = w.wait("return window.__qaImportedIds", "imported SDK identities")
    assert not state.get("error") and len(state["rows"]) == 4, state
    native_sid = state["sid"]
    by_source = {src: current for src, current, sid in state["rows"] if sid == native_sid}
    expected = [f"electron-import:{native_sid}:{source}" for source in original_ids]
    assert [by_source[source] for source in original_ids] == expected and state["searchHits"] == [expected[1]], state
    return expected


def verify_restored_attachment(w, thumbnail_id, missing_id):
    thumb = f'[data-message-id="{thumbnail_id}"] figure[data-local-image-attachment] img'
    missing = f'[data-message-id="{missing_id}"] figure[data-local-image-attachment] button'
    assert not w.js(f"return !!document.querySelector({json.dumps(missing)})")
    w.wait(f"""const i=document.querySelector({json.dumps(thumb)});
        return i?.complete && i.naturalWidth===72 && i.naturalHeight===48;""", "decoded imported PNG")
    # The synthetic source has a known green tree against a blue sky.
    pixels = w.js(f"""const i=document.querySelector({json.dumps(thumb)});
        const canvas=document.createElement('canvas');canvas.width=72;canvas.height=48;
        const ctx=canvas.getContext('2d');ctx.drawImage(i,0,0);
        return [[36,18],[0,0]].map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data));""")
    assert pixels == [[31,128,60,255],[148,206,243,255]], pixels
    choose(w, f'[data-message-id="{thumbnail_id}"] figure[data-local-image-attachment] button',
           'open imported attachment')
    w.wait("""const i=document.querySelector('[role=dialog][data-state=open] img');
        return i?.complete && i.naturalWidth===72 && i.naturalHeight===48;""", "enlarged imported image")
    w.close_dialog()
    return pixels


def acceptance(binary):
    if not __debug__ or binary.name != "tinker-formal-native-qa" or not binary.is_file():
        raise ValueError("Use the dedicated native QA binary and Python assertions")
    evidence = Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-session-import-", dir="/private/tmp"))
    profile = Path("/private/tmp") / ("tinker-tauri-formal-preview-import-" + uuid.uuid4().hex)
    print("Evidence:", evidence, flush=True)
    one = Window(binary, profile, evidence, "import")
    source = one.directory / "qa-electron-copy"
    try:
        thumbnail_id, original_id = seed_source(source)
        digests = source_digests(source)
        one.ready()
        one.send(LOCAL_TEXT)
        one.wait("return document.body.innerText.includes('上下文 1/0')", "existing native reply")
        baseline = one.command("records")
        assert len(baseline) == 1
        pre = recent_titles(one)
        import_button(one)
        select_folder(one, "cancel")
        one.wait("return !document.querySelector('[data-testid=native-session-import]').disabled", "folder picker dismissed")
        assert not one.js("return !!document.querySelector('[role=dialog] [role=status]')")
        assert recent_titles(one) == pre and one.command("records") == baseline
        select_folder(one, "fixture")
        imported = count_report(one, 1, 0, 1)
        assert "Missing attachments (1)" in imported and "Invalid histories (1)" in imported, imported
        select_folder(one, "fixture")
        repeated = count_report(one, 0, 1, 1)
        close_settings(one)
        after = recent_titles(one)
        assert sum(TITLE in name for name in after) == 1 and all(name in after for name in pre), (pre, after)
        assert all("Damaged synthetic" not in name for name in after)
        assert source_digests(source) == digests and one.command("records") == baseline
        thumbnail_dom, search_dom = mapped_ids(one, [thumbnail_id, original_id])
        search_result = search(one, QUERY)
        assert TITLE in search_result and QUERY in search_result
        focused = exact_focus(one, search_dom)
        one.send(CONTINUE)
        one.wait("return document.body.innerText.includes('上下文 3/2')", "reply with imported history")
        records = one.command("records")
        assert len(records) == len(baseline) + 1 and records[-1]["userMessages"] == 3 and records[-1]["assistantMessages"] == 2
        one.quit()
    finally:
        one.stop_if_running()
    # Move only this disposable fixture after the first process exits. A reference to the
    # original path can no longer supply missing imported data after restart.
    retained = evidence / "retained-source-copy"
    source.rename(retained)
    assert not source.exists() and source_digests(retained) == digests
    two = Window(binary, profile, evidence, "reopened")
    try:
        two.ready()
        assert two.proc.pid != one.proc.pid and two.command("records") == []
        assert sum(TITLE in name for name in recent_titles(two)) == 1
        assert TITLE in search(two, QUERY)
        exact_focus(two, focused)
        two.wait(f"return document.body.innerText.includes({json.dumps(CONTINUE)}) && document.body.innerText.includes('上下文 3/2')",
                 "continued native turn after relaunch")
        pixels = verify_restored_attachment(two, thumbnail_dom, search_dom)
        snapshot = two.command("snapshot")["png"]
        assert LOCAL_TEXT in search(two, LOCAL_TEXT)
        two.wait(f"return document.activeElement?.closest('[data-message-id]')?.textContent.includes({json.dumps(LOCAL_TEXT)})",
                 "pre-existing native conversation preserved")
        assert two.command("records") == [] and source_digests(retained) == digests
        two.quit()
    finally:
        two.stop_if_running()
    summary = {"firstPid":one.proc.pid, "reopenedPid":two.proc.pid, "picker":"fixed synthetic folder",
               "restoredAttachmentPixels":pixels, "sourceFilesVerified":len(digests), "sourceSha256":digests, "beforeImportRequests":len(baseline),
               "importAndSearchRequests":0, "continuationRequests":1, "continuationUserTurns":3,
               "continuationAssistantTurns":2, "requestsOnRestoreAndSearch":0, "importReport":imported,
               "repeatReport":repeated, "sourceUuid":original_id, "focusedRenderedMessageId":focused,
               "restoredConversation":snapshot}
    (evidence / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False)+"\n")
    print(json.dumps(summary, indent=2, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    acceptance(parser.parse_args().binary.resolve(strict=True))

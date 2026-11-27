"""Exercise image-reference navigation in a staged native QA app with two owned loopback listeners."""
import argparse
import base64
from hashlib import sha256
import json
from pathlib import Path
from runpy import run_path
import tempfile
import uuid

from native_image_file_checks import ATTACH, CHIP, SENT, fixture_png, image_bytes, pick, same_pixels

HERE = Path(__file__).resolve().parent
portable = run_path(str(HERE / "native-portable-project-qa.py"))
routes, tasks, large = (portable[key] for key in ("routes", "tasks", "large"))
imports = routes["common"]
NORTH, SOUTH = "Northern orchard", "Southern orchard"
DISPLAY = "field-photo.png"
ORIGINAL = fixture_png()
ORIGINAL_HASH = sha256(ORIGINAL).hexdigest()
RED = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC")
LINK = "[data-reference-source-link]"
THUMB = ".conversation-reference__thumbnail"
ROW = "[data-message-id]"
PROMPT = "Warm the orchard light. [qa:fork-reference]"


def seed(folder):
    folder.mkdir(mode=0o700)
    logs = folder / "agent-sessions"
    logs.mkdir()
    sessions, projects = [], []
    stamp = imports["STAMP"]
    for title in (NORTH, SOUTH):
        project, session = (str(uuid.uuid4()) for _ in range(2))
        projects.append(dict(id=project, name=title, slug=title.split()[0].lower(), createdAt=stamp, updatedAt=stamp))
        sessions.append(dict(id=session, title=title + " notebook", workspaceId=project,
                             createdAt=stamp, updatedAt=stamp))
        assets = folder / "attachments" / session
        assets.mkdir(parents=True)
        rows = []
        # 两个项目故意共享旧消息 ID、文件名和像素；同一会话内还有同名红色干扰图。
        for number in range(28):
            role = "assistant" if number % 2 else "user"
            row = dict(type=role, uuid=f"observation-{number}", parent_tool_use_id=None,
                       _createdAt=stamp + number * 1000,
                       message={"content": [{"type": "text", "text": f"{title} reading {number}."}]})
            if role == "assistant":
                row["message"].update(role=role, id=f"msg_qa_{number}", model="synthetic")
            if number in (0, 2):
                asset = f"leaf-{number}"
                (assets / (asset + ".png")).write_bytes(ORIGINAL if number == 0 else RED)
                row["imageEditReference"] = dict(imageId=asset, mediaType="image/png", filename=DISPLAY,
                                                 localPath=f"{session}/{asset}.png")
            rows.append(row)
        (logs / (session + ".jsonl")).write_text("".join(json.dumps(row) + "\n" for row in rows))
    imports["json_file"](folder / "agent-sessions.json", {"version": 1, "sessions": sessions})
    imports["json_file"](folder / "agent-workspaces.json", {"version": 2, "workspaces": projects})


def enter(w, name):
    tasks["select_project"](w, name)
    tasks["enter_session"](w)
    w.wait(f"return document.querySelector('[data-message-role=user]')?.innerText.includes({json.dumps(name + ' reading 0.')})",
           "selected project conversation")


def locator(message_id):
    return f'[data-message-id={json.dumps(message_id)}]'


def lightbox(w, card):
    assert same_pixels(image_bytes(w, card + " " + THUMB + " img"), ORIGINAL)
    routes["choose"](w, card + " " + THUMB, "open restored thumbnail")
    w.wait("""const i=document.querySelector('[role=dialog][data-state=open] img');
        return i?.complete && i.naturalWidth===72 && i.naturalHeight===48 && i.src.startsWith('blob:');""",
           "actual full-resolution original")
    digest = routes["async_read"](w, """const i=document.querySelector('[role=dialog][data-state=open] img');
        const bytes=await (await fetch(i.src)).arrayBuffer();
        const sha=await crypto.subtle.digest('SHA-256',bytes);
        return Array.from(new Uint8Array(sha),b=>b.toString(16).padStart(2,'0')).join('');""")
    assert digest == ORIGINAL_HASH, digest
    w.close_dialog()


def jump_and_return(w, card, target, *, minimum_scroll):
    link = card + " " + LINK
    script = f"""const b=document.querySelector({json.dumps(link)});if(!b || b.disabled)return false;
        let r=b.parentElement;while(r && !(r.scrollHeight>r.clientHeight+4 &&
          /auto|scroll/.test(getComputedStyle(r).overflowY)))r=r.parentElement;
        if(!r)return false;"""
    w.command("focus")
    w.wait(script + """b.scrollIntoView({block:'center',behavior:'instant'});b.focus({preventScroll:true});return true;""",
           "visible focused link in a scrollable conversation")
    start = w.wait(script + """const rect=b.getBoundingClientRect();
        if(!b.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)))return false;
        const before=r.scrollTop;b.click();return {top:before};""", "activate source card")
    focused = w.wait(f"""const e=document.activeElement;return e?.matches('[data-reference-highlighted=true]') &&
        e.dataset.messageId==={json.dumps(target)} && e.dataset.messageId;""", "exact source row focused and highlighted")
    at_source = w.wait(script + f"""const e=document.querySelector({json.dumps(locator(target))});
        const v=r.getBoundingClientRect(), a=e.getBoundingClientRect();
        return a.bottom>v.top && a.top<v.bottom && Math.abs(r.scrollTop-{start["top"]})>={minimum_scroll}
            && {{top:r.scrollTop}};""", "source visible in its own session")
    routes["choose"](w, ".conversation-reference-return", "return to previous reading position")
    returned = w.wait(script + f"""return document.activeElement===b && Math.abs(r.scrollTop-{start["top"]})<=2 &&
        !document.querySelector('[data-reference-highlighted=true]') && {{top:r.scrollTop}};""",
        "prior reading offset and exact link keyboard focus")
    return dict(sourceRow=focused, readingTop=start["top"], sourceTop=at_source["top"], returnTop=returned["top"])


def run(bundle):
    if not __debug__:
        raise ValueError("Python assertions are required")
    binary = run_path(str(HERE / "native-macos-release-gate.py"))["check_bundle"](bundle, "qa")
    evidence = Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-history-source-", dir="/private/tmp"))
    root = Path("/private/tmp") / ("tinker-tauri-channels-preview-history-source-" + uuid.uuid4().hex)
    print("Evidence:", evidence, flush=True)
    pids = []
    with portable["window"](binary, root, evidence, "select", pids) as w:
        portable["docs"]["foreground"](w)
        backup = w.directory / "qa-electron-copy"
        seed(backup)
        digests = imports["source_digests"](backup)
        large["setup_channel"](w, root)
        channel, = routes["catalog"](w)
        imports["import_button"](w)
        imports["select_folder"](w, "fixture")
        imports["count_report"](w, 2, 0, 0)
        imports["close_settings"](w)
        snapshots = portable["snapshot"](w)
        north, = snapshots[NORTH]["sessions"]
        south, = snapshots[SOUTH]["sessions"]
        source_id = f"electron-import:{north['id']}:observation-0"
        foreign_id = f"electron-import:{south['id']}:observation-0"
        assert source_id != foreign_id
        enter(w, NORTH)
        routes["select_model"](w, channel["id"], routes["IMAGE"])
        attachment = " figure[data-local-image-attachment]"
        for number, expected in ((0, ORIGINAL), (2, RED)):
            image = locator(f"electron-import:{north['id']}:observation-{number}") + attachment + " img"
            assert same_pixels(image_bytes(w, image), expected)
            assert w.js(f"return document.querySelector({json.dumps(image)}).alt") == DISPLAY
        assert routes["counts"](root) == [[2, 0], [0, 0]]
        edit = locator(source_id) + attachment + " [data-history-image-edit]"
        w.command("focus")
        w.wait("return document.hasFocus()", "WebKit keyboard focus after the model menu closes")
        control = w.js(f"""const b=document.querySelector({json.dumps(edit)});
            return {{adapter:typeof window.__TAURI_FORMAL__?.imageFiles?.prepareHistoryImage,
                rendered:!!b,disabled:b?.disabled??null}};""")
        assert control == {"adapter": "function", "rendered": True, "disabled": False}, control
        w.wait(f"""const b=document.querySelector({json.dumps(edit)});if(!b || b.disabled)return false;
            b.scrollIntoView({{block:'center',behavior:'instant'}});b.focus({{preventScroll:true}});
            const r=b.getBoundingClientRect();if(Number(getComputedStyle(b).opacity)<0.9)return false;
            if(!b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))return false;
            b.click();return true;""", "edit the chosen historical attachment")
        assert same_pixels(image_bytes(w, CHIP), ORIGINAL)
        assert routes["counts"](root) == [[2, 0], [0, 0]]
        w.send(PROMPT)
        edited, = large["names"](w, 1)
        assert same_pixels(image_bytes(w, SENT), ORIGINAL)
        assert routes["counts"](root) == [[2, 1], [0, 0]]
        # 南部另选一份无来源消息的同图，再显式编辑它的原生结果。
        enter(w, SOUTH)
        routes["select_model"](w, channel["id"], routes["IMAGE"])
        path = w.directory / "qa-orchard.png"
        path.write_bytes(ORIGINAL)
        pick(w, "fixture", ATTACH)
        w.send(PROMPT)
        generated, = large["names"](w, 1)
        w.edit(generated, "Warm the same scene again. [qa:fork-version]")
        large["names"](w, 2)
        assert routes["counts"](root) == [[2, 3], [0, 0]]
        assert imports["source_digests"](backup) == digests
    backup.rename(evidence / "retained-synthetic-backup")
    path.unlink()
    with portable["window"](binary, root, evidence, "reopened", pids) as w:
        assert len(set(pids)) == 2
        foreground = portable["docs"]["foreground"](w)
        enter(w, SOUTH)
        assert w.js(f"return !!document.querySelector({json.dumps(locator(foreign_id))}) && !document.querySelector({json.dumps(locator(source_id))})")
        card_without_source = w.wait(f"""const cards=[...document.querySelectorAll('[data-image-edit-reference]')];
            const c=cards.find(e=>e.closest('{ROW}').innerText.includes({json.dumps(PROMPT)}));
            return c?.closest('{ROW}').dataset.messageId;""", "external reference in the other project")
        orphan = locator(card_without_source) + " [data-image-edit-reference]"
        assert not w.js(f"return !!document.querySelector({json.dumps(orphan + ' ' + LINK + ':not(:disabled)')})")
        lightbox(w, orphan)
        native = w.wait(f"""const img=[...document.querySelectorAll('[data-generated-image] img')].find(i=>i.alt==={json.dumps(generated)});
            const link=[...document.querySelectorAll('[data-image-edit-reference] {LINK}:not(:disabled)')];
            return img && link.length===1 && {{target:img.closest('{ROW}').dataset.messageId,card:link[0].closest('{ROW}').dataset.messageId}};""",
            "single native result with a linked source")
        native_jump = jump_and_return(w, locator(native["card"]), native["target"], minimum_scroll=0)
        enter(w, NORTH)
        assert large["names"](w, 1) == [edited]
        assert not w.js(f"return !!document.querySelector({json.dumps(locator(foreign_id))})")
        card = "[data-image-edit-reference]"
        lightbox(w, card)
        imported_jump = jump_and_return(w, card, source_id, minimum_scroll=100)
        screenshot = w.command("snapshot")["png"]
        assert routes["counts"](root) == [[2, 3], [0, 0]]
    expected_posts = [[("image-edited", 1)] * 3, []]
    routes["check_posts"](root, expected_posts)
    result = dict(result="passed", pids=pids, originalSha256=ORIGINAL_HASH, binarySha256=large["digest"](binary),
                  importedJump=imported_jump, generatedJump=native_jump, screenshot=screenshot, reopenedWindow=foreground,
                  listenerCounts=routes["counts"](root), acceptedEditsPerProvider=[3, 0], requestsOnRestoreAndNavigation=0,
                  picker="synthetic selections in the isolated packaged WKWebView")
    (evidence / "summary.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("qa_bundle", type=Path)
    run(parser.parse_args().qa_bundle)

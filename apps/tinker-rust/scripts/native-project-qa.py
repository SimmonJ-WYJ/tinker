"""Verify two same-name Electron projects through the isolated native QA workbench."""
import argparse
import json
from pathlib import Path
from runpy import run_path
from shutil import copytree
import tempfile
import uuid

helpers = run_path(str(Path(__file__).with_name("native-session-import-qa.py")))
Window = helpers["Window"]
choose, search = helpers["choose"], helpers["search"]
TITLE = "Orchard fieldwork"
A, B, G = "Alpine notebooks", "Coastal notebooks", "Independent notes"
LEGACY_NOTE = "Keep this coastal annotation across desktop preview versions."
NATIVE = "Pre-existing native field notes"
QUERY = "alpine larch colour"
PROJECT_NEW = "Begin a fresh alpine project-only notebook."
GLOBAL_NEW = "Start independent notes outside every project."
STAMP = 1_720_000_000_000


def seed(root):
    root.mkdir(mode=0o700)
    logs = root / "agent-sessions"
    logs.mkdir()
    project_a, project_b = str(uuid.uuid4()), str(uuid.uuid4())
    # A copied workspace index can contain identical display names; IDs and slugs are distinct.
    projects = [{"id": pid, "name": TITLE, "slug": slug, "createdAt": STAMP, "updatedAt": STAMP}
                for pid, slug in [(project_a,"orchard-north"), (project_b,"orchard-coast")]]
    helpers["json_file"](root / "agent-workspaces.json", {"version":2,"workspaces":projects})
    # Electron stores previous attachment roots as path hints in per-project config.
    # This synthetic historical path deliberately does not exist on the test Mac.
    config = root / "agent-workspaces" / "orchard-north"
    config.mkdir(parents=True)
    helpers["json_file"](config/"config.json", {"attachedDirectories":[str(root.parent/"obsolete-qa-folder")]})
    sessions, message_ids = [], {}
    for title, workspace, turns in [
            (A, project_a, ["A green northern ridge.", "The ridge is green.", "The alpine larch colour is amber.", "Recorded the amber observation."]),
            (B, project_b, ["Coastal cypress shades the bay.", "Recorded the salt breeze."]),
            (G, None, ["Independent observations stay global.", "Recorded the global note."])]:
        sid = str(uuid.uuid4())
        meta = {"id":sid, "title":title, "createdAt":STAMP,"updatedAt":STAMP+10000}
        if workspace:
            meta["workspaceId"] = workspace
        sessions.append(meta)
        rows = []
        for i, text in enumerate(turns):
            role = "assistant" if i % 2 else "user"
            uid = str(uuid.uuid4())
            message_ids[text] = uid
            row = {"type":role,"uuid":uid,"parent_tool_use_id":None,"_createdAt":STAMP+i*1000,
                   "message":{"content":[{"type":"text","text":text}]}}
            if role == "assistant":
                row["message"].update({"role":role,"model":"synthetic","id":f"msg_qa_{i}"})
            rows.append(json.dumps(row))
        (logs / f"{sid}.jsonl").write_text("\n".join(rows)+"\n", encoding="utf-8")
    helpers["json_file"](root / "agent-sessions.json", {"version":1, "sessions":sessions})
    return message_ids


def state(w):
    w.js("""window.__qaProjects=null;
        void Promise.all([window.electronAPI.listAgentWorkspaces(),window.electronAPI.listAgentSessions()])
            .then(([projects,sessions])=>{window.__qaProjects={
              projects:projects.map(p=>[p.id,p.name]), sessions:sessions.map(s=>[s.id,s.workspaceId??null,s.title])}});
        return true;""")
    return w.wait("return window.__qaProjects", "project and session metadata")


def overview(w, index):
    w.wait(f"""const b=[...document.querySelectorAll('.home-projects__item')].filter(b=>b.innerText.trim()==={json.dumps(TITLE)})[{index}];
        if(!b)return false;b.click();return true;""", "open project from sidebar")
    w.wait(f"""const b=[...document.querySelectorAll('.home-projects__item')].filter(b=>b.innerText.trim()==={json.dumps(TITLE)})[{index}];
        return b?.getAttribute('aria-current')==='page' && document.querySelector('.project-overview h1')?.innerText==={json.dumps(TITLE)}
            && !!document.querySelector('.project-overview__sessions button');""", "matching project overview")
    return w.js("return [...document.querySelectorAll('.project-overview__sessions button')].map(b=>b.textContent.trim())")


def directory(w, status):
    return w.wait(f"""const el=document.querySelector('[data-testid=project-directory]');
        return el?.dataset.directoryStatus==={json.dumps(status)} && el.innerText;""", "directory status "+status)


def pick_directory(w, choice):
    assert w.command("arm-project-folder",choice=choice) is True
    choose(w, "[data-testid=project-directory] button", "open project folder chooser")
    w.wait("return !!document.querySelector('[data-testid=project-directory] button:not(:disabled)')", "folder selection resolved")


def project_filter(w, query, expected_title):
    w.js(f"""const input=document.querySelector('.project-overview__search input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,{json.dumps(query)});
        input.dispatchEvent(new Event('input',{{bubbles:true}}));return true;""")
    w.wait(f"""const rows=[...document.querySelectorAll('.project-overview__sessions button')];
        return rows.length===1 && rows[0].innerText.includes({json.dumps(expected_title)});""", "project-scoped result")


def open_session(w, title):
    w.wait(f"""const row=[...document.querySelectorAll('.project-overview__sessions button')].find(b=>b.innerText.includes({json.dumps(title)}));
        if(!row)return false;row.click();return true;""","open session from its project")
    w.ready()


def old_preview(binary, profile, evidence, source):
    """Import B on the unmodified previous preview and preserve an actual later chat turn."""
    previous = Window(binary, profile, evidence, "previous-preview")
    try:
        copy = previous.directory/"qa-electron-copy"
        copytree(source, copy)
        index = json.loads((copy/"agent-sessions.json").read_text())
        index["sessions"] = [s for s in index["sessions"] if s["title"]==B]
        helpers["json_file"](copy/"agent-sessions.json", index)
        original = helpers["source_digests"](copy)
        previous.ready()
        previous.send(NATIVE)
        previous.wait("return document.body.innerText.includes('上下文 1/0')","independent conversation on previous preview")
        helpers["import_button"](previous)
        helpers["select_folder"](previous,"fixture")
        helpers["count_report"](previous,1,0,0)
        helpers["close_settings"](previous)
        snapshot = state(previous)
        sid, old_workspace, _ = next(row for row in snapshot["sessions"] if row[2]==B)
        assert not old_workspace and all(name!=TITLE for _,name in snapshot["projects"])
        assert B in search(previous,"Coastal cypress")
        previous.wait("return document.body.innerText.includes('Recorded the salt breeze.')","previous preview loaded imported B")
        previous.send(LEGACY_NOTE)
        previous.wait("return document.body.innerText.includes('上下文 2/1')","local continuation on previous preview")
        records = previous.command("records")
        assert [(r['userMessages'],r['assistantMessages']) for r in records]==[(1,0),(2,1)]
        assert helpers["source_digests"](copy)==original
        previous.quit()
        return previous.proc.pid, sid
    finally:
        previous.stop_if_running()


def rollback_read(previous_binary, profile, evidence, old_sid):
    """Reopen the previous executable on the synthetic profile and check its original view."""
    catalog=profile/"formal-project-platform-v1"/"snapshot.json"
    before=catalog.read_bytes()
    previous=Window(previous_binary,profile,evidence,"rollback-read")
    try:
        previous.ready()
        old=state(previous)
        assert all(name!=TITLE for _,name in old["projects"])
        assert [old_sid,None,B] in old["sessions"]
        assert B in search(previous,LEGACY_NOTE)
        previous.wait(f"return document.body.innerText.includes({json.dumps(LEGACY_NOTE)}) && document.body.innerText.includes('上下文 2/1')",
                      "previous preview opens its original session and local continuation")
        assert previous.command("records")==[]
        previous.quit()
        assert catalog.read_bytes()==before
        return previous.proc.pid
    finally:
        previous.stop_if_running()


def verify_creation_scope(w, prompt, workspace_id):
    w.ready()
    w.send(prompt)
    w.wait("return document.body.innerText.includes('上下文 1/0')", "fresh conversation context")
    w.js(f"""window.__qaCreatedScope=null;
        void (async()=>{{
          const [hit]=await window.electronAPI.searchAgentSessionMessages({json.dumps(prompt)});
          const row=(await window.electronAPI.listAgentSessions()).find(s=>s.id===hit?.sessionId);
          window.__qaCreatedScope=row?{{id:row.id,workspaceId:row.workspaceId??null}}:{{missing:true}};
        }})().catch(()=>{{window.__qaCreatedScope={{missing:true}}}});return true;""")
    scope=w.wait("return window.__qaCreatedScope","new conversation in native catalog")
    assert not scope.get("missing") and scope["workspaceId"]==workspace_id, scope
    return scope["id"]


def acceptance(binary, previous_binary):
    if not __debug__ or binary.name != "tinker-formal-native-qa" or not binary.is_file():
        raise ValueError("Use the dedicated QA binary and Python assertions")
    evidence = Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-projects-",dir="/private/tmp"))
    profile = Path("/private/tmp")/("tinker-tauri-formal-preview-projects-"+uuid.uuid4().hex)
    print("Evidence:", evidence, flush=True)
    complete_backup = evidence/"prepared-source"
    ids = seed(complete_backup)
    old_pid = old_sid = relink_pid = None
    if previous_binary is not None:
        if previous_binary==binary or previous_binary.name!="tinker-formal-native-qa" or not previous_binary.is_file():
            raise ValueError("Supply a separate previous native QA build")
        old_pid, old_sid = old_preview(previous_binary,profile,evidence,complete_backup)
    one = Window(binary, profile, evidence, "initial")
    source = one.directory/"qa-electron-copy"
    folder = one.directory/"qa-project-folder"
    try:
        complete_backup.rename(source)
        digests = helpers["source_digests"](source)
        folder.mkdir(mode=0o700)
        (folder/"local-synthetic-note.txt").write_text("Locally selected synthetic folder only.")
        one.ready()
        if old_sid is None:
            one.send(NATIVE)
            one.wait("return document.body.innerText.includes('上下文 1/0')","existing native conversation created")
        before = state(one)
        preexisting = {s[0]:s[1] for s in before["sessions"] if s[0]!=old_sid}
        assert preexisting
        requests = one.command("records")
        assert len(requests)==(1 if old_sid is None else 0)
        helpers["import_button"](one)
        helpers["select_folder"](one,"fixture")
        first = helpers["count_report"](one,3 if old_sid is None else 2,0 if old_sid is None else 1,0)
        assert "Projects imported 2" in first, first
        helpers["select_folder"](one,"fixture")
        repeat = helpers["count_report"](one,0,3,0)
        helpers["close_settings"](one)
        if old_sid:
            # B was the active tab when the previous preview quit. Its project changed
            # during reimport. Do not navigate or reopen B before this extra restart.
            one.wait(f"return document.body.innerText.includes({json.dumps(LEGACY_NOTE)})",
                     "B remains active after its previously global tab gains a project")
            assert one.command("records")==requests
            relink_pid=one.proc.pid
            one.quit()
            one=Window(binary,profile,evidence,"relinked-restart")
            one.ready()
            one.wait(f"return document.body.innerText.includes({json.dumps(LEGACY_NOTE)}) && document.body.innerText.includes('上下文 2/1')",
                     "relinked B and its local continuation restore automatically")
            assert one.command("records")==[] and one.proc.pid!=relink_pid
            new_folder=one.directory/"qa-project-folder"
            folder.rename(new_folder)
            folder=new_folder
        catalog = state(one)
        projects = {pid for pid,name in catalog["projects"] if name==TITLE}
        sessions = {title:(sid,ws) for sid,ws,title in catalog["sessions"]}
        assert len(projects)==2 and {sessions[A][1],sessions[B][1]}==projects
        if old_sid:
            assert sessions[B][0]==old_sid and len([s for s in catalog["sessions"] if s[2]==B])==1
        assert sessions[G][1] is None and {s[0]:s[1] for s in catalog["sessions"] if s[0] in preexisting}==preexisting
        appearances = [overview(one, i) for i in range(2)]
        a = next(i for i, rows in enumerate(appearances) if any(A in name for name in rows))
        b = 1-a
        assert all(B not in name and G not in name for name in appearances[a])
        assert any(B in name for name in appearances[b]) and all(A not in name and G not in name for name in appearances[b])
        overview(one,b)
        directory(one,"unbound")
        open_session(one,B)
        one.wait("return document.body.innerText.includes('Coastal cypress shades the bay.')","coastal project text")
        if old_sid:
            one.wait(f"return document.body.innerText.includes({json.dumps(LEGACY_NOTE)})","prior-preview continuation survived relink")
        assert not one.js("return document.body.innerText.includes('The alpine larch colour is amber.')")
        overview(one,a)
        directory(one,"unbound")
        pick_directory(one,"cancel")
        directory(one,"unbound")
        pick_directory(one,"fixture")
        directory(one,"bound")
        project_filter(one,"Alpine",A)
        open_session(one,A)
        assert A in search(one,QUERY)
        uid = ids["The alpine larch colour is amber."]
        mapped_id = f"electron-import:{sessions[A][0]}:{uid}"
        one.wait(f"return document.activeElement?.dataset.messageId==={json.dumps(mapped_id)}","exact imported project search hit")
        assert not one.js("return document.body.innerText.includes('Coastal cypress shades the bay.')")
        assert one.command("records")==requests
        one.send("Continue the observations from this ridge.")
        one.wait("return document.body.innerText.includes('上下文 3/2')","continued with alpine history")
        records = one.command("records")
        assert len(records)==len(requests)+1 and (records[-1]["userMessages"],records[-1]["assistantMessages"])==(3,2)
        assert helpers["source_digests"](source)==digests
        one.quit()
    finally:
        one.stop_if_running()
    saved_source=evidence/"retained-source";source.rename(saved_source)
    moved=evidence/"relocated-bound-folder";folder.rename(moved)
    two = Window(binary,profile,evidence,"restart")
    try:
        assert one.proc.pid!=two.proc.pid
        two.ready()
        two.wait("""return document.body.innerText.includes('Continue the observations from this ridge.')
            && document.body.innerText.includes('上下文 3/2')
            && document.body.innerText.includes('The alpine larch colour is amber.');""",
                 "last active alpine conversation and continuation restored before any navigation")
        assert two.command("records")==[]
        after=state(two)
        assert {p for p,n in after["projects"] if n==TITLE}==projects
        for sid,ws,title in catalog["sessions"]:
            assert [sid,ws,title] in after["sessions"]
        views=[overview(two,i) for i in range(2)]
        a=next(i for i,rows in enumerate(views) if any(A in name for name in rows)); b=1-a
        overview(two,b);directory(two,"unbound")
        overview(two,a);directory(two,"unavailable")
        pick_directory(two,"cancel");directory(two,"unavailable")
        open_session(two,A)
        two.wait("return document.body.innerText.includes('上下文 3/2')","restored chat available with moved folder")
        assert A in search(two,QUERY)
        two.wait(f"return document.activeElement?.dataset.messageId==={json.dumps(mapped_id)}","exact project hit after restart")
        overview(two,a)
        directory(two,"unavailable")
        moved.rename(two.directory/"qa-project-folder")
        pick_directory(two,"fixture")
        directory(two,"bound")
        snapshot=two.command("snapshot")["png"]
        overview(two,b);directory(two,"unbound")
        assert helpers["source_digests"](saved_source)==digests
        assert two.command("records")==[]
        # From the existing project row create a fresh project conversation, then use
        # the global button while that project conversation is still the active one.
        two.wait(f"""const branches=[...document.querySelectorAll('.home-projects__branch')].filter(
              e=>e.querySelector('.home-projects__item')?.innerText.trim()==={json.dumps(TITLE)});
            const b=branches[{a}]?.querySelector('.home-projects__create');
            if(!b||b.disabled)return false;b.click();return true;""", "new conversation inside the alpine project")
        project_new=verify_creation_scope(two,PROJECT_NEW,sessions[A][1])
        helpers["click_named"](two,"button",["New session","新建会话"])
        global_new=verify_creation_scope(two,GLOBAL_NEW,None)
        assert project_new!=global_new
        post=two.command("records")
        assert [(r['userMessages'],r['assistantMessages']) for r in post]==[(1,0),(1,0)]
        two.quit()
    finally:
        two.stop_if_running()
    rollback_pid=rollback_read(previous_binary,profile,evidence,old_sid) if old_sid else None
    report={"preRelinkRestartPid":relink_pid,"relinkedBVisibleBeforeNavigation":bool(relink_pid),"rollbackPid":rollback_pid,"rollbackRequests":0 if rollback_pid else None,"previousPreviewPid":old_pid, "relinkedPreviousSessionId":old_sid, "firstPid":one.proc.pid,"restartPid":two.proc.pid,"projects":sorted(projects),"workspaceA":sessions[A][1],
            "workspaceB":sessions[B][1],"firstImport":first,"repeatImport":repeat,"picker":"fixed synthetic directories",
            "originalBackupSha256":digests,"explicitNativeSetupRequests":1,"previousPreviewContinuationRequests":int(old_sid is not None),"importNavigationRequests":0,
            "continuationRequests":1,"userMessages":3,"assistantMessages":2,"requestsOnRestartSearchAndRebind":0,"lastActiveAVisibleBeforeNavigation":True,
            "newProjectConversation":project_new,"newGlobalConversation":global_new,"explicitCreationRequestsAfterRecovery":2,
            "restoredFocusedMessage":mapped_id,"reboundProject":snapshot}
    (evidence/"summary.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2),flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary",type=Path)
    parser.add_argument("--previous-binary", type=Path, help="Prior preview QA build, to verify real upgrade using the same isolated profile")
    args=parser.parse_args()
    acceptance(args.binary.resolve(strict=True),args.previous_binary.resolve(strict=True) if args.previous_binary else None)

"""Rehearse a synthetic Electron-to-native upgrade in one credentialed macOS QA profile."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
from runpy import run_path
import tempfile
import uuid

from native_upgrade_rollback import begin_rollback, finish_rollback

HERE = Path(__file__).resolve().parent
large = run_path(str(HERE / "native-large-image-qa.py"))
routes = large["routes"]
projects = run_path(str(HERE / "native-project-qa.py"))
legacy = projects["helpers"]
A, B, G = (projects[n] for n in ("A", "B", "G"))
TITLE = projects["TITLE"]
NOTE = "Keep this existing native rehearsal conversation independent."
CONTINUE = "Continue the imported alpine notebook. [qa:upgrade-context]"
RESPONSE = "Imported alpine context verified."
EDIT = "Give the selected quilt a warm copper tone. [qa:large-image]"


def seed(backup):
    ids = projects["seed"](backup)
    session, = [s["id"] for s in json.loads((backup/"agent-sessions.json").read_text())["sessions"] if s["title"]==A]
    log = backup/"agent-sessions"/(session+".jsonl")
    rows = [json.loads(line) for line in log.read_text().splitlines()]
    asset = str(uuid.uuid4())
    png = asset + ".png"
    rows[0]["imageEditReference"] = {"imageId":asset,"filename":png,"localPath":f"{session}/{png}","mediaType":"image/png"}
    attachment = backup/"attachments"/session/png
    attachment.parent.mkdir(parents=True)
    attachment.write_bytes(legacy["fixture_png"]())
    log.write_text("".join(json.dumps(row)+"\n" for row in rows))
    legacy["json_file"](backup/"channels.json",{"fixture":"ignored-electron-channel-settings"})
    return ids, session


def add_channel(w,profile,label,secondary):
    routes["open_settings"](w)
    base = routes["endpoint"](profile,"secondary-" if secondary else "")
    routes["add_provider"](w,label,base,2 if secondary else 1)
    rows = routes["catalog"](w)
    channel, = [c for c in rows if c["name"]==label]
    legacy["close_settings"](w)
    return channel


def imported_projects(w):
    catalog=projects["state"](w)
    projects_by_id={p for p,n in catalog["projects"] if n==TITLE}
    assert len(projects_by_id)==2,catalog
    sessions={title:(sid,ws) for sid,ws,title in catalog["sessions"] if title in (A,B,G)}
    assert set(sessions)=={A,B,G} and {sessions[A][1],sessions[B][1]}==projects_by_id and sessions[G][1] is None
    opposite=[]
    for i in range(2):
        titles=projects["overview"](w,i)
        assert len(titles)==1 and G not in titles[0],titles
        opposite.append(A in titles[0])
    assert sorted(opposite)==[False,True]
    return sessions,opposite.index(True)


def project_task(w,index,kind):
    projects["overview"](w,index)
    return w.wait(f"""const row=[...document.querySelectorAll('.project-overview__sessions button')]
        .find(b=>b.innerText.includes({json.dumps(A)}));
        const task=row?.querySelector('[data-task-kind][data-task-status]');
        return task?.dataset.taskKind==={json.dumps(kind)} && task.dataset.taskStatus==='completed'
            && [task.dataset.taskKind,task.dataset.taskStatus];""","persisted project task "+kind)


def previous_photo(w,sid,uid):
    selector=f'[data-message-id="electron-import:{sid}:{uid}"] figure[data-local-image-attachment]'
    return w.wait(f"""const i=document.querySelector({json.dumps(selector+' img')});
        return i?.complete && i.naturalWidth===72 && i.naturalHeight===48 && [i.naturalWidth,i.naturalHeight];""",
        "decoded imported photo in the original message")


def rows_for(w,sid):
    return routes["async_read"](w,f"""const rows=await window.electronAPI.getAgentSessionSDKMessages({json.dumps(sid)});
        const files=[];const text=[];
        for(const row of rows)for(const b of Array.isArray(row.message?.content)?row.message.content:[]){{
          if(b.type==='text')text.push(b.text);
          if(b.type==='tool_result'&&!b.is_error){{const r=JSON.parse(b.content);if(r.generatedImage)files.push(
            [r.imageId,r.baseImageId??null,r.generatedImage.filename,r.generatedImage.localPath]);}}
        }}return {{files,text}};""")


def export(w,filename,disk):
    click=f"""const i=[...document.querySelectorAll({json.dumps(large['CARD'])})].find(i=>i.alt==={json.dumps(filename)});
        const b=[...(i?.closest('[data-generated-image]')?.querySelectorAll('button')??[])].find(b=>b.innerText.trim()==='Save');
        if(!b||b.disabled)return false;b.click();return true;"""
    target=w.directory/"qa-export.png"
    large["files"]["pick"](w,"cancel-save",click)
    assert not target.exists()
    large["files"]["pick"](w,"destination",click)
    large["wait_for"](lambda:target.is_file() and target.stat().st_size==disk.stat().st_size,"full scoped export")
    assert target.read_bytes()==disk.read_bytes()
    return {"path":str(target),"bytes":target.stat().st_size,"sha256":large["digest"](target)}


def acceptance(binary):
    if not __debug__ or binary.name!="tinker-channels-native-qa":
        raise ValueError("Use the isolated Channels QA app, with assertions enabled")
    assert plistlib.loads((binary.parent.parent/"Info.plist").read_bytes())["CFBundleIdentifier"]=="com.tinker.channels-native-qa"
    evidence=Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-upgrade-",dir="/private/tmp"))
    profile=Path("/private/tmp")/("tinker-tauri-channels-preview-upgrade-"+uuid.uuid4().hex)
    print("Evidence:",evidence,flush=True)
    one=routes["ChannelWindow"](binary,profile,evidence,"upgrade")
    backup=one.directory/"qa-electron-copy"
    folder=one.directory/"qa-project-folder"
    positive=[("completed",1),("completed",1)]
    image_events=[("image-generated",2),("image-edited",2)]
    try:
        source_ids,old_sid=seed(backup)
        baseline=begin_rollback(evidence,backup)
        folder.mkdir(mode=0o700)
        (folder/"synthetic-note.txt").write_text("Selected test workspace only.\n")
        one.wait("return !!document.querySelector('.sidebar-account-trigger')","new profile workbench")
        assert routes["counts"](profile)==[[0,0],[0,0]]
        cedar=add_channel(one,profile,routes["A"],False)
        routes["select_model"](one,cedar["id"],routes["TEXT"])
        one.send(NOTE)
        one.wait("return document.body.innerText.includes('Owned QA streamed text completed.')","native baseline completed")
        original_state=projects["state"](one)
        native_ids={sid for sid,ws,title in original_state["sessions"]}
        assert native_ids and routes["counts"](profile)==[[2,1],[0,0]]
        legacy["import_button"](one)
        legacy["select_folder"](one,"cancel")
        one.wait("return !document.querySelector('[data-testid=native-session-import]').disabled","cancelled import")
        assert projects["state"](one)==original_state
        legacy["select_folder"](one,"fixture")
        imported=legacy["count_report"](one,3,0,0)
        assert "Projects imported 2" in imported,imported
        legacy["select_folder"](one,"fixture")
        repeated=legacy["count_report"](one,0,3,0)
        legacy["close_settings"](one)
        assert routes["catalog"](one)==[cedar] and routes["defaults"](one)==[cedar["id"],routes["TEXT"]]
        sessions,ix=imported_projects(one)
        sid,workspace=sessions[A]
        all_ids={s[0] for s in projects["state"](one)["sessions"]}
        assert all_ids==native_ids|{v[0] for v in sessions.values()}
        projects["overview"](one,ix)
        projects["directory"](one,"unbound")
        projects["pick_directory"](one,"cancel")
        projects["directory"](one,"unbound")
        projects["pick_directory"](one,"fixture")
        projects["directory"](one,"bound")
        projects["open_session"](one,A)
        assert A in legacy["search"](one,projects["QUERY"])
        uid=source_ids["The alpine larch colour is amber."]
        one.wait(f"""const row=document.activeElement?.closest('[data-message-id]');
            return row?.dataset.messageId==={json.dumps(f'electron-import:{sid}:{uid}')} &&
                row.textContent.includes('The alpine larch colour is amber.');""","search focuses exact imported user turn")
        prevphoto=previous_photo(one,sid,source_ids["A green northern ridge."])
        assert routes["counts"](profile)==[[2,1],[0,0]]
        harbor=add_channel(one,profile,routes["B"],True)
        routes["select_model"](one,cedar["id"],routes["TEXT"])
        one.send(CONTINUE)
        one.wait(f"return document.body.innerText.includes({json.dumps(RESPONSE)})","provider verified exactly the imported text context")
        routes["check_posts"](profile,[positive,[]])
        text_status=project_task(one,ix,"text")
        projects["open_session"](one,A)
        routes["select_model"](one,harbor["id"],routes["IMAGE"])
        one.send(large["GENERATE"])
        source,=large["names"](one,1)
        thumbnail=large["thumbnail"](one,source)
        one.edit(source,EDIT)
        child=large["images"]["added"](large["names"](one,2),[source])
        routes["check_posts"](profile,[positive,image_events])
        route_rows=rows_for(one,sid)
        assets=route_rows["files"]
        assert [r[2] for r in assets]==[source,child] and [r[1] for r in assets]==[None,assets[0][0]]
        assert all(r[3]==sid+"/"+r[2] for r in assets) and one.sent_thumbnail(source)==assets[0][0]
        assert CONTINUE in route_rows["text"] and any(RESPONSE in t for t in route_rows["text"])
        target=export(one,child,large["stored"](profile,child))
        before=routes["counts"](profile)
        assert before==[[2,2],[2,2]]
        processes=[routes["process_check"](one)]
        one.quit()
    finally:
        one.stop_if_running()
    two=routes["ChannelWindow"](binary,profile,evidence,"reopened")
    try:
        two.ready()
        assert two.proc.pid!=one.proc.pid
        current,current_ix=imported_projects(two)
        assert current==sessions
        restored_status=project_task(two,current_ix,"imageEdit")
        projects["directory"](two,"bound")
        projects["open_session"](two,A)
        assert rows_for(two,sid)==route_rows and set(large["names"](two,2))=={source,child}
        assert {s[0] for s in projects["state"](two)["sessions"]}==all_ids
        assert routes["defaults"](two)==[harbor["id"],routes["IMAGE"]]
        assert sorted(routes["catalog"](two),key=lambda c:c["id"])==sorted([cedar,harbor],key=lambda c:c["id"])
        assert previous_photo(two,sid,source_ids["A green northern ridge."])==prevphoto
        assert two.sent_thumbnail(source)==assets[0][0]
        comparison=large["edited_compare"](two,source,child,profile)
        assert target["sha256"]==comparison["hashes"][1]
        projects["overview"](two,1-current_ix)
        projects["directory"](two,"unbound")
        projects["open_session"](two,B)
        assert not rows_for(two,sessions[B][0])["files"]
        processes.append(routes["process_check"](two))
        assert routes["counts"](profile)==before
        two.quit()
    finally:
        two.stop_if_running()
    immutable=[large["stored"](profile,name) for name in (source,child)]+[Path(target["path"])]
    expected_hashes=comparison["hashes"]+[target["sha256"]]
    assert [large["digest"](p) for p in immutable]==expected_hashes
    rollback=finish_rollback(evidence,backup,baseline)
    assert [large["digest"](p) for p in immutable]==expected_hashes
    report={"binarySha256":hashlib.sha256(binary.read_bytes()).hexdigest(),"pids":[one.proc.pid,two.proc.pid],
            "backup":str(backup),"profile":str(profile),"sourceSessionId":old_sid,"sourceMessageId":uid,
            "importedSessionId":sid,"workspaceId":workspace,"boundFixture":str(folder),
            "sourcePhotoDimensions":prevphoto,"import":imported,"repeat":repeated,"models":[cedar,harbor],
            "projectSessions":sessions,"projectTasks":[text_status,restored_status],"nativeSessionIds":sorted(native_ids),"thumbnail":thumbnail,
            "images":assets,"export":target,"comparison":comparison,"restoreRequestDelta":0,
            "providerObservations":routes["observations"](profile),"observedAppProcesses":processes,
            "metadata":large["metadata_scan"](profile),"scannedFiles":routes["check_test_keys"](profile,evidence),
            "nativeHashesAfterRollback":expected_hashes,"rollback":rollback,"picker":"fixed synthetic paths in the isolated QA bundle","vault":"finite synthetic credentials"}
    (evidence/"summary.json").write_text(json.dumps(report,indent=2)+"\n")
    print("Passed:",evidence/"summary.json",flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary",type=Path)
    acceptance(parser.parse_args().binary.resolve(strict=True))

"""Run project-scoped image task acceptance with real WKWebViews and an owned loopback provider."""
import argparse
import hashlib
import json
from pathlib import Path
from runpy import run_path
import signal
import subprocess
import tempfile
import time
import uuid

here = Path(__file__).resolve().parent
tasks = run_path(str(here / "native-project-task-qa.py"))
Window = tasks["Window"]
create_project, select_project, enter_session = (tasks[k] for k in ("create_project","select_project","enter_session"))
NORTH, SOUTH = "Northern image notebook", "Southern image notebook"
GEN = "Generate an image [image-task-delay] of a northern orchard."
EDIT = "Edit this image to add a green apple."
CANCEL = "Edit this image [image-task-delay] to tint the leaves purple."
OTHER = "Generate an image [image-task-delay] of a southern beach."
FAIL = "Edit this image [image-task-retry] to turn the sky gold."
QUIT = "Edit this image [image-task-delay] to add an orchard gate."
CRASH = "Edit this image [image-task-delay] to show a snowy orchard."
TEXT = "[task-stream] Describe the southern field notebook in one sentence."
CARD = "[data-generated-image] .generated-image__preview img"
STATUS = '[data-native-task-kind="image"][data-native-task-status]'
WAIT_EDIT = "image-edit-pending-response"
LATE_EDIT = "image-edit-response-attempted"
WAIT_GEN = "image-generate-pending-response"
LATE_GEN = "image-generate-response-attempted"


def project_status(w, project, kind, status):
    select_project(w, project)
    tasks["wait_project_status"](w, status)
    row = w.js("return document.querySelector('.project-overview__sessions [data-task-status]')?.dataset.taskKind")
    assert row == kind, (kind, row)


def outcome(w, status):
    return w.wait(f"""const latest=[...document.querySelectorAll({json.dumps(STATUS)})].at(-1);
        return latest?.dataset.nativeTaskStatus==={json.dumps(status)} && latest.dataset.requestId;""",
        f"visible latest image task {status}")


def wait_scenarios(w, expected):
    deadline = time.monotonic() + 11
    while time.monotonic() < deadline:
        actual = tasks["scenarios"](w)
        if actual==expected:
            return actual
        time.sleep(.15)
    raise AssertionError(f"Expected owned HTTP requests {expected}, got {actual}")


def start_edit(w, filename):
    w.wait(f"""const img=[...document.querySelectorAll({json.dumps(CARD)})].find(i=>i.alt==={json.dumps(filename)});
        const b=img?.closest('[data-generated-image]')?.querySelector('.generated-image__action');
        if(!b||b.disabled)return false;b.click();return true;""", "select existing image reference")
    w.wait(f"""return [...document.querySelectorAll('[role=status] img')].some(
        i=>i.alt==={json.dumps(filename)}&&i.complete&&i.naturalWidth);""","selected reference thumbnail")


def retry(w):
    w.wait("""const b=document.querySelector('[data-native-task-kind=image] [data-native-task-retry]');
        if(!b||b.disabled)return false;b.click();b.click();return true;""", "explicit double-click on image Retry")


def order_snapshot(w):
    w.js(f"""window.__qaImgRows=null;void (async()=>{{
        const api=window.electronAPI;
        const [projects,sessions]=await Promise.all([api.listAgentWorkspaces(),api.listAgentSessions()]);
        const result={{}};
        for(const name of {json.dumps([NORTH,SOUTH])}){{
            const ws=projects.find(p=>p.name===name);
            const matches=sessions.filter(s=>s.workspaceId===ws?.id);
            if(!ws||matches.length!==1)throw Error('invalid project scope');
            const id=matches[0].id;
            const rows=await api.getAgentSessionSDKMessages(id);
            const uses=new Map();const assets=[];const inputs=[];
            for(const row of rows){{
                for(const block of (Array.isArray(row.message?.content)?row.message.content:[])){{
                    if(row.type==='user' && block.type==='text')inputs.push([block.text,row.imageEditReference?.filename??null]);
                    if(block.type==='tool_use')uses.set(block.id,block.input?.prompt);
                    if(block.type==='tool_result'&&!block.is_error){{
                        const file=JSON.parse(block.content);
                        assets.push({{prompt:uses.get(block.tool_use_id),id:file.imageId,base:file.baseImageId??null,
                            filename:file.generatedImage.filename,path:file.generatedImage.localPath}});
                    }}
                }}
            }}
            result[name]={{workspace:ws.id,session:id,inputs,assets}};
        }}
        window.__qaImgRows=result;
    }})().catch(e=>window.__qaImgRows={{error:String(e)}});return true;""")
    data=w.wait("return window.__qaImgRows", "read native histories and image relationships")
    assert "error" not in data and data[NORTH]["session"]!=data[SOUTH]["session"],data
    assert data[NORTH]["workspace"]!=data[SOUTH]["workspace"], data
    for note in data.values():
        files=note["assets"]
        assert len({f["id"] for f in files})==len(files), files
        assert all(f["path"]==note["session"]+"/"+f["filename"] for f in files),files
    return data


def added(names, previous):
    assert set(previous).issubset(names) and len(names)==len(previous)+1, names
    new, = set(names)-set(previous)
    return new


def check_source_png(path, checks, stage):
    contents = path.read_bytes()
    assert contents.startswith(b"\x89PNG\r\n\x1a\n"), (stage, path)
    measured = hashlib.sha256(contents).hexdigest()
    if stage != "generated":
        assert measured == checks["generated"], (stage, path, measured, checks["generated"])
    checks[stage] = measured


def image_digests(profile):
    directory=profile/"formal-images-v1"
    files={str(f.relative_to(directory)):hashlib.sha256(f.read_bytes()).hexdigest()
           for f in directory.rglob("*") if f.is_file() and f.name!="writer.lock"}
    assert any(name.endswith(".png") for name in files) and any(name.endswith(".json") for name in files)
    return files


def painted(w, words):
    w.command("focus")
    deadline=time.monotonic()+12
    while time.monotonic()<deadline:
        time.sleep(.35)
        screenshot=w.command("snapshot")["png"]
        output=subprocess.run(["/usr/bin/osascript","-l","JavaScript",str(here/"native-project-task-paint.js"),screenshot],
                              text=True,capture_output=True,check=True,timeout=15).stdout
        if all(s.lower() in output.lower() for s in words):
            # The macOS OCR helper can take focus while reading the finished snapshot.
            w.command("focus")
            return {"png":screenshot,"recognized":output.splitlines()}
    raise AssertionError(f"Window pixels did not show {words}: {output}")


def see_image(w, filename):
    w.command("focus")
    w.wait("return document.visibilityState==='visible' && !document.querySelector('[role=dialog]')",
           "foreground window after previous dialog closes")
    w.wait(f"""const img=[...document.querySelectorAll({json.dumps(CARD)})].find(i=>i.alt==={json.dumps(filename)});
        const b=img?.closest('button');if(!b||!img.complete||!img.naturalWidth)return false;
        b.scrollIntoView({{block:'center',behavior:'instant'}});const r=b.getBoundingClientRect();
        if(!b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))return false;
        b.click();return true;""", "click actual decoded card")
    w.wait(f"""const img=document.querySelector('[role=dialog][data-state=open] img');
        return img?.alt==={json.dumps(filename)}&&img.complete&&img.naturalWidth===192&&img.naturalHeight===128;""",
        "enlarged original fixture pixels")
    w.close_dialog()


def compare_painted(w, parent, child):
    w.wait(f"""const img=[...document.querySelectorAll({json.dumps(CARD)})].find(i=>i.alt==={json.dumps(child)});
        const b=[...(img?.closest('[data-generated-image]')?.querySelectorAll('button')??[])].find(b=>/Compare versions/i.test(b.innerText));
        if(!b||b.disabled)return false; b.click();return true;""","open comparison of exact source and retried result")
    w.compared_small_images(parent,child)
    proof=painted(w,["Compare versions","Source version","This version"])
    # Compare a point inside each decoded source with the composited screenshot.
    samples=w.js("""return [...document.querySelectorAll('[role=dialog][data-state=open] figure img')].map(i=>{
        const r=i.getBoundingClientRect(), u=.22, v=.26;
        const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;
        const ctx=c.getContext('2d');ctx.drawImage(i,0,0);
        return {u:(r.x+u*r.width)/innerWidth,v:(r.y+v*r.height)/innerHeight,
            expected:Array.from(ctx.getImageData(Math.floor(u*c.width),Math.floor(v*c.height),1,1).data).slice(0,3)};
    });""")
    assert len(samples)==2 and samples[0]["expected"]!=samples[1]["expected"]
    decode="""const sharp=require('sharp');
        const {data,info}=await sharp(process.argv[1]).toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
        const values=JSON.parse(process.argv[2]).map(({u,v})=>{
            const pos=(Math.floor(v*info.height)*info.width+Math.floor(u*info.width))*info.channels;
            return [...data.subarray(pos,pos+3)];
        });console.log(JSON.stringify(values));"""
    measured=json.loads(subprocess.check_output(["bun","-e",decode,proof["png"],json.dumps(samples)],
                        cwd=here.parents[1]/"electron",text=True))
    for point,actual in zip(samples,measured):
        assert all(abs(a-b)<=10 for a,b in zip(actual,point["expected"])), (samples,measured)
    proof["persistedImagePixels"]=[point["expected"] for point in samples]
    proof["windowPixels"]=measured
    w.close_dialog()
    return proof


def rollback(binary,profile,evidence,reference,filenames):
    before=image_digests(profile)
    w=Window(binary,profile,evidence,"previous-preview")
    try:
        w.ready()
        select_project(w,NORTH)
        enter_session(w)
        assert set(w.cards(len(filenames)))==set(filenames)
        assert w.sent_thumbnail(filenames[0])==reference[NORTH]["assets"][0]["id"]
        for name in filenames:
            see_image(w,name)
        w.compare_parent(filenames[-2],filenames[-1])
        assert order_snapshot(w)==reference
        assert tasks["scenarios"](w)==[]
        w.quit()
        assert image_digests(profile)==before
        return {"pid":w.proc.pid,"requests":0,"binarySha256":hashlib.sha256(binary.read_bytes()).hexdigest(),
                "unchangedImageFiles":before}
    finally:
        w.stop_if_running()


def acceptance(binary,previous):
    binaries=(binary,previous) if previous else (binary,)
    if not __debug__ or any(b.name!="tinker-formal-native-qa" or not b.is_file() for b in binaries) or binary==previous:
        raise ValueError("Use distinct dedicated native QA executables with assertions enabled")
    evidence=Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-project-images-",dir="/private/tmp"))
    profile=Path("/private/tmp")/("tinker-tauri-formal-preview-image-tasks-"+uuid.uuid4().hex)
    print("Evidence:",evidence,flush=True)
    one=Window(binary,profile,evidence,"interleaved")
    try:
        one.ready()
        create_project(one,NORTH)
        create_project(one,SOUTH)
        select_project(one,SOUTH,new=True)
        one.send(TEXT)
        tasks["streaming"](one,TEXT)
        project_status(one,SOUTH,"text","running")
        select_project(one,NORTH,new=True)
        tasks["double_send"](one,GEN)
        wait_scenarios(one,["task-stream",WAIT_GEN])
        project_status(one,NORTH,"imageGenerate","running")
        project_status(one,SOUTH,"text","running")
        enter_session(one)
        tasks["streaming"](one,TEXT)
        project_status(one,NORTH,"imageGenerate","completed")
        enter_session(one)
        source,=one.cards(1)
        source_path, = (p for p in (profile/"formal-images-v1").glob("*/*.png") if p.name == source)
        source_checks = {}
        check_source_png(source_path, source_checks, "generated")
        outcome(one,"completed")
        project_status(one,SOUTH,"text","completed")
        enter_session(one)
        tasks["terminal"](one,"completed")
        project_status(one,NORTH,"imageGenerate","completed")
        enter_session(one)
        one.edit(source,EDIT)
        edited=added(one.cards(2),[source])
        one.compare_parent(source,edited)
        records=["task-stream",LATE_GEN,"image-edit"]
        wait_scenarios(one,records)
        one.edit(edited,CANCEL)
        wait_scenarios(one,records+[WAIT_EDIT])
        project_status(one,NORTH,"imageEdit","running")
        select_project(one,SOUTH)
        enter_session(one)
        one.send(OTHER)
        project_status(one,SOUTH,"imageGenerate","running")
        project_status(one,NORTH,"imageEdit","running")
        enter_session(one)
        tasks["choose"](one,tasks["STOP"],"cancel only the northern image worker")
        cancelled=outcome(one,"cancelled")
        assert set(one.cards(2))=={source,edited}
        project_status(one,SOUTH,"imageGenerate","running")
        wait_scenarios(one,records+[LATE_EDIT,LATE_GEN])
        check_source_png(source_path, source_checks, "cancelledAfterLateResponse")
        project_status(one,SOUTH,"imageGenerate","completed")
        enter_session(one)
        beach,=one.cards(1)
        assert beach not in (source,edited)
        project_status(one,NORTH,"imageEdit","cancelled")
        enter_session(one)
        assert set(one.cards(2))=={source,edited}
        one.edit(source,FAIL)
        failed=outcome(one,"failed")
        check_source_png(source_path, source_checks, "failedEdit")
        assert set(one.cards(2))=={source,edited}
        start_edit(one,edited)
        retry(one)
        retried=added(one.cards(3),[source,edited])
        completed=outcome(one,"completed")
        check_source_png(source_path, source_checks, "successfulRetry")
        assert len({cancelled,failed,completed})==3
        one.compare_parent(source,retried)
        snapshot=order_snapshot(one)
        assets=snapshot[NORTH]["assets"]
        assert [f["filename"] for f in assets]==[source,edited,retried]
        assert [f["base"] for f in assets]==[None,assets[0]["id"],assets[0]["id"]]
        assert snapshot[NORTH]["inputs"]==[[GEN,None],[EDIT,source],[CANCEL,edited],[FAIL,source],[FAIL,source]]
        assert snapshot[SOUTH]["inputs"]==[[TEXT,None],[OTHER,None]]
        assert [f["filename"] for f in snapshot[SOUTH]["assets"]]==[beach]
        records += [LATE_EDIT,LATE_GEN,"image-edit-retry-failed","image-edit-retry-completed"]
        wait_scenarios(one,records)
        one.edit(edited,QUIT)
        first=wait_scenarios(one,records+[WAIT_EDIT])
        one.quit()
    finally:
        one.stop_if_running()

    two=Window(binary,profile,evidence,"clean-restart")
    try:
        two.ready()
        assert two.proc.pid!=one.proc.pid
        project_status(two,NORTH,"imageEdit","interrupted")
        enter_session(two)
        quit_id=outcome(two,"interrupted")
        check_source_png(source_path, source_checks, "normalRestart")
        assert set(two.cards(3))=={source,edited,retried}
        comparison=compare_painted(two,source,retried)
        see_image(two,source)
        see_image(two,retried)
        assert two.sent_thumbnail(source)==assets[0]["id"]
        project_status(two,SOUTH,"imageGenerate","completed")
        enter_session(two)
        assert two.cards(1)==[beach]
        assert tasks["scenarios"](two)==[]
        project_status(two,NORTH,"imageEdit","interrupted")
        enter_session(two)
        two.edit(retried,CRASH)
        wait_scenarios(two,[WAIT_EDIT])
        project_status(two,NORTH,"imageEdit","running")
        two.proc.kill()
        assert two.proc.wait(timeout=10)==-signal.SIGKILL
    finally:
        two.stop_if_running()

    three=Window(binary,profile,evidence,"crash-restart")
    try:
        three.ready()
        assert len({one.proc.pid,two.proc.pid,three.proc.pid})==3
        project_status(three,NORTH,"imageEdit","interrupted")
        enter_session(three)
        crash_id=outcome(three,"interrupted")
        check_source_png(source_path, source_checks, "crashRestart")
        assert crash_id!=quit_id
        three.wait(f"""const b=document.querySelector('[data-request-id="{crash_id}"] [data-native-task-retry]');
            if(!b||b.disabled)return false;
            b.scrollIntoView({{block:'center',behavior:'instant'}});
            const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));""",
            "recovered image task Retry is visible and hit-testable")
        interrupted_paint=painted(three,["Interrupted","Retry"])
        assert set(three.cards(3))=={source,edited,retried}
        recovered=order_snapshot(three)
        assert recovered[NORTH]["assets"]==snapshot[NORTH]["assets"]
        assert recovered[SOUTH]==snapshot[SOUTH]
        assert recovered[NORTH]["inputs"]==snapshot[NORTH]["inputs"]+[[QUIT,edited],[CRASH,retried]]
        assert three.sent_thumbnail(retried)==assets[2]["id"] and tasks["scenarios"](three)==[]
        retry(three)
        wait_scenarios(three,[WAIT_EDIT])
        wait_scenarios(three,[LATE_EDIT])
        final_image=added(three.cards(4),[source,edited,retried])
        outcome(three,"completed")
        final_history=order_snapshot(three)
        assert final_history[NORTH]["assets"][-1]["base"]==assets[2]["id"]
        assert final_history[NORTH]["inputs"]==recovered[NORTH]["inputs"]+[[CRASH,retried]]
        assert final_history[SOUTH]==snapshot[SOUTH]
        three.compare_parent(retried,final_image)
        assert tasks["scenarios"](three)==[LATE_EDIT]
        three.quit()
    finally:
        three.stop_if_running()
    prev=rollback(previous,profile,evidence,final_history,[source,edited,retried,final_image]) if previous else None
    report={"binarySha256":hashlib.sha256(binary.read_bytes()).hexdigest(),"pids":[one.proc.pid,two.proc.pid,three.proc.pid],
            "firstProcessAcceptedRequests":first,"cleanRestartBrowsingRequests":0,"preCrashExplicitRequests":[WAIT_EDIT],
            "crashRestartBrowsingRequests":0,"postCrashExplicitRetryRequests":[LATE_EDIT],"source":source,"initialEdit":edited,
            "retriedEdit":retried,"comparison":comparison,"interrupted":interrupted_paint,
            "cancelledId":cancelled,"failedId":failed,"retriedId":completed,"menuQuitInterruptedId":quit_id,"crashInterruptedId":crash_id,
            "sourceFile":str(source_path.relative_to(profile)), "sourceSha256ByStage":source_checks,
            "sessions":final_history,"files":image_digests(profile),"rollback":prev}
    (evidence/"summary.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2),flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary",type=Path)
    parser.add_argument("--previous-binary",type=Path,help="Reopen the same isolated image profile in an earlier native QA build")
    args=parser.parse_args()
    acceptance(args.binary.resolve(strict=True),args.previous_binary.resolve(strict=True) if args.previous_binary else None)

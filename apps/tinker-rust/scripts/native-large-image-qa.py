"""Verify multi-megabyte image assets in the two separately scoped native QA apps."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import re
import subprocess
from runpy import run_path
import tempfile
import time
import uuid

HERE = Path(__file__).resolve().parent
routes = run_path(str(HERE / "native-channel-model-qa.py"))
images = routes["images"]
tasks = images["tasks"]
files = run_path(str(HERE / "native_image_file_checks.py"))
CARD = images["CARD"]
LARGE = "[qa:large-image]"
GENERATE = "Generate an image of a textured blue quilt. " + LARGE
FAILED = "Add copper tones to this quilt. " + LARGE + " [qa:image-retry]"
NORTH, SOUTH = "Texture study", "Separate small study"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def wait_for(fn, label, timeout=60):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        result = fn()
        if result:
            return result
        time.sleep(.22)
    raise AssertionError("Timed out waiting for " + label)


def names(w, n):
    def cards():
        actual = w.js(f"""return [...document.querySelectorAll({json.dumps(CARD)})]
            .filter(i=>i.complete && i.naturalWidth).map(i=>i.alt);""")
        return actual if len(actual) == n else None
    try:
        return wait_for(cards, f"{n} decoded image cards")
    except AssertionError as error:
        raise AssertionError((str(error),w.js("return document.body.innerText.slice(-1100)"))) from error


def stored(profile, name):
    assert Path(name).name == name and name.endswith(".png")
    path, = (profile / "formal-images-v1").glob("*/" + name)
    return path


def thumbnail(w, name, selector=CARD):
    size = w.wait(f"""const i=[...document.querySelectorAll({json.dumps(selector)})].find(i=>i.alt==={json.dumps(name)});
        return i?.complete && i.naturalWidth && [i.naturalWidth,i.naturalHeight,i.src.startsWith('data:image/png;base64,'),i.src.length];""",
        "bounded decoded thumbnail")
    assert 0 < max(size[:2]) <= 256 and size[2] and size[3] <= 700_000, size
    proof = routes["async_read"](w,f"""const i=[...document.querySelectorAll({json.dumps(selector)})].find(i=>i.alt==={json.dumps(name)});
        const bytes=Uint8Array.from(atob(i.src.split(',')[1]),c=>c.charCodeAt(0));
        const h=await crypto.subtle.digest('SHA-256',bytes);
        return {{pixels:[i.naturalWidth,i.naturalHeight],bytes:bytes.length,
          sha256:[...new Uint8Array(h)].map(v=>v.toString(16).padStart(2,'0')).join('')}};""")
    assert proof["bytes"]<=512*1024
    return proof


def metadata_scan(profile):
    files=[p for p in profile.rglob("*") if p.is_file() and p.suffix in (".json",".jsonl")]
    assert files and any(p.name in ("turns.json","routed-images-v1.json") for p in files)
    checked_bytes=0
    for p in files:
        raw=p.read_bytes()
        assert not re.search(rb"data:image/|iVBORw0KGgo|[A-Za-z0-9+/]{4096}",raw),p.relative_to(profile)
        checked_bytes+=len(raw)
    return {"jsonAndJsonlFiles":len(files),"bytes":checked_bytes,"embeddedImageOrLongBase64Matches":0}


def full(w, name, path, dims=(1536,1024)):
    w.command("focus")
    w.wait(f"""const i=[...document.querySelectorAll({json.dumps(CARD)})].find(i=>i.alt==={json.dumps(name)});
        const b=i?.closest('button');if(!b||b.disabled)return false;b.scrollIntoView({{block:'center',behavior:'instant'}});
        const r=b.getBoundingClientRect();if(!b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))return false;
        b.click();return true;""","open exact image card")
    w.wait(f"""const i=document.querySelector('[role=dialog][data-state=open] img');
        return i?.complete && i.alt==={json.dumps(name)} && i.naturalWidth==={dims[0]} &&
          i.naturalHeight==={dims[1]} && i.src.startsWith('blob:');""", "full original loaded in lightbox")
    proof = routes["async_read"](w, """const i=document.querySelector('[role=dialog][data-state=open] img');
        const bytes=await (await fetch(i.src)).arrayBuffer(); const sha=await crypto.subtle.digest('SHA-256',bytes);
        return {sha256:[...new Uint8Array(sha)].map(n=>n.toString(16).padStart(2,'0')).join(''),bytes:bytes.byteLength};""")
    assert proof == {"sha256": digest(path), "bytes": path.stat().st_size}, (proof,path)
    scale=w.wait("""return parseInt(document.querySelector('[role=dialog][data-state=open] output')?.textContent??'0',10);""","initial zoom level")
    w.wait("""const b=document.querySelector('[role=dialog][data-state=open] .lucide-zoom-in')?.closest('button');
        if(!b||b.disabled)return false;b.click();return true;""","zoom original")
    zoom=w.wait(f"""const dlg=document.querySelector('[role=dialog][data-state=open]');
        const pct=parseInt(dlg?.querySelector('output')?.textContent??'0',10);
        return pct>{scale} && pct;""","increased zoom level")
    proof["zoomPercent"]=[scale,zoom]
    proof["pixels"] = list(dims)
    proof["snapshot"] = w.command("snapshot")["png"]
    w.close_dialog()
    return proof


def edited_compare(w, source, child, profile):
    w.wait(f"""const i=[...document.querySelectorAll({json.dumps(CARD)})].find(i=>i.alt==={json.dumps(child)});
        const b=[...(i?.closest('[data-generated-image]')?.querySelectorAll('button')??[])].find(b=>/Compare versions/i.test(b.innerText));
        if(!b||b.disabled)return false;b.click();return true;""","compare edited version to its original")
    w.wait("""const pair=[...document.querySelectorAll('[role=dialog][data-state=open] figure img')];
        return pair.length===2 && pair.every(i=>i.src.startsWith('blob:') && i.naturalWidth===1536 && i.naturalHeight===1024);""","full-resolution comparison")
    hashes = routes["async_read"](w, """return await Promise.all([...document.querySelectorAll('[role=dialog] figure img')].map(async i=>{
        const bytes=await (await fetch(i.src)).arrayBuffer();const h=await crypto.subtle.digest('SHA-256',bytes);
        return [...new Uint8Array(h)].map(n=>n.toString(16).padStart(2,'0')).join('');}));""")
    assert hashes == [digest(stored(profile, f)) for f in (source,child)] and hashes[0]!=hashes[1]
    screenshot = images["painted"](w,["Compare versions","Source version","This version"])["png"]
    samples=w.js("""return [...document.querySelectorAll('[role=dialog] figure img')].map(i=>{
        const r=i.getBoundingClientRect(), u=.22, v=.26, c=document.createElement('canvas');c.width=1;c.height=1;
        const ctx=c.getContext('2d');ctx.drawImage(i,Math.floor(u*i.naturalWidth)-2,Math.floor(v*i.naturalHeight)-2,5,5,0,0,1,1);
        return [ (r.x+r.width*u)/innerWidth,(r.y+r.height*v)/innerHeight,Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3) ];});""")
    decode="""const sharp=require('sharp');const {data,info}=await sharp(process.argv[1]).toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
        console.log(JSON.stringify(JSON.parse(process.argv[2]).map(([u,v])=>{const p=(Math.floor(v*info.height)*info.width+Math.floor(u*info.width))*info.channels;
        return [...data.subarray(p,p+3)];})));"""
    colors=json.loads(subprocess.check_output(["bun","-e",decode,screenshot,json.dumps(samples)],cwd=HERE.parents[1]/"electron",text=True))
    assert all(max(abs(a-b) for a,b in zip(expected,actual))<=34 for (_,_,expected),actual in zip(samples,colors)),(samples,colors)
    assert colors[0][2]>colors[0][0]+40 and colors[1][0]>colors[1][2]+40,colors
    w.close_dialog()
    return {"hashes":hashes,"snapshot":screenshot,"windowRgb":colors}


def reopen_session(w):
    w.ready()
    if not w.js("return !!document.querySelector('[data-generated-image]')"):
        routes["choose"](w,".home-recent-session","open existing image conversation")


def setup_channel(w, profile):
    w.wait("return !!document.querySelector('.sidebar-account-trigger')","native settings ready")
    routes["open_settings"](w)
    routes["add_provider"](w,routes["A"],routes["endpoint"](profile,""),1)
    channel, = routes["catalog"](w)
    routes["common"]["close_settings"](w)
    routes["select_model"](w, channel["id"], routes["IMAGE"])


def channels(binary, evidence, previous):
    assert binary.name=="tinker-channels-native-qa" and plistlib.loads(
        (binary.parent.parent/"Info.plist").read_bytes())["CFBundleIdentifier"]=="com.tinker.channels-native-qa"
    profile=Path("/private/tmp")/("tinker-tauri-channels-preview-large-"+uuid.uuid4().hex)
    Window=routes["ChannelWindow"]
    legacy=None
    expected=[]
    if previous:
        assert previous.name==binary.name and previous!=binary
        old=Window(previous,profile,evidence,"previous")
        try:
            setup_channel(old,profile)
            old.send("Generate an image of a small orchard.")
            legacy,=old.cards(1)
            legacy_hash=digest(stored(profile,legacy))
            expected.append(("image-generated",1))
            routes["check_posts"](profile,[expected,[]])
            old.quit()
        finally:
            old.stop_if_running()
    one=Window(binary,profile,evidence,"channels")
    try:
        if legacy:
            reopen_session(one)
            names(one,1)
            full(one,legacy,stored(profile,legacy),(192,128))
            assert digest(stored(profile,legacy))==legacy_hash and routes["counts"](profile)==[[2,1],[0,0]]
        else:
            setup_channel(one,profile)
        first=[legacy] if legacy else []
        one.send(GENERATE)
        source=images["added"](names(one,len(first)+1),first)
        path=stored(profile,source)
        assert path.stat().st_size>1024*1024
        thumb=thumbnail(one,source)
        assert thumb["pixels"][0]==256 and 169<=thumb["pixels"][1]<=172
        original=full(one,source,path)
        expected.append(("image-generated",1))
        routes["check_posts"](profile,[expected,[]])
        one.edit(source,FAILED)
        failed=images["outcome"](one,"failed")
        expected.append(("image-edit-failed",1))
        routes["check_posts"](profile,[expected,[]])
        assert set(names(one,len(first)+1))==set(first+[source])
        assert thumbnail(one,source,files["SENT"])==thumb
        before=routes["counts"](profile)
        one.quit()
    finally:
        one.stop_if_running()
    two=Window(binary,profile,evidence,"channels-reopened")
    try:
        reopen_session(two)
        assert two.proc.pid!=one.proc.pid and images["outcome"](two,"failed")==failed
        assert set(names(two,len(first)+1))==set(first+[source])
        full(two,source,path)
        assert routes["counts"](profile)==before
        images["retry"](two)
        child=images["added"](names(two,len(first)+2),first+[source])
        expected.append(("image-edited",1))
        routes["check_posts"](profile,[expected,[]])
        comparison=edited_compare(two,source,child,profile)
        assert digest(path)==original["sha256"]
        two.quit()
    finally:
        two.stop_if_running()
    return {"pids":[one.proc.pid,two.proc.pid],"binary":digest(binary),"previousBinary":digest(previous) if previous else None,
            "legacy":legacy,"source":source,"child":child,"thumbnail":thumb,"zoom":original,"comparison":comparison,
            "restoreRequestDelta":0,"http":routes["observations"](profile),"metadata":metadata_scan(profile),"checkedFiles":routes["check_test_keys"](profile,evidence)}


def formal(binary,evidence):
    assert binary.name=="tinker-formal-native-qa"
    profile=Path("/private/tmp")/("tinker-tauri-formal-preview-large-"+uuid.uuid4().hex)
    one=tasks["Window"](binary,profile,evidence,"formal")
    try:
        one.ready()
        for project in (SOUTH,NORTH):
            tasks["create_project"](one,project)
        tasks["select_project"](one,NORTH,new=True)
        one.send(GENERATE)
        source,=names(one,1)
        path=stored(profile,source)
        assert path.stat().st_size>1024*1024
        source_sha=digest(path)
        thumb=thumbnail(one,source)
        save=f"""const i=[...document.querySelectorAll({json.dumps(CARD)})].find(i=>i.alt==={json.dumps(source)});
            const b=[...(i?.closest('[data-generated-image]')?.querySelectorAll('button')??[])].find(b=>b.innerText.trim()==='Save');
            if(!b||b.disabled)return false;b.click();return true;"""
        target=one.directory/"qa-export.png"
        files["pick"](one,"cancel-save",save)
        assert not target.exists()
        files["pick"](one,"destination",save)
        wait_for(lambda:target.is_file() and target.stat().st_size==path.stat().st_size,"complete native Save As")
        assert target.read_bytes()==path.read_bytes()
        one.edit(source,"Edit this image [image-task-delay] to add a stripe.")
        logs=["image-generate","image-edit-pending-response"]
        images["wait_scenarios"](one,logs)
        tasks["choose"](one,tasks["STOP"],"cancel pending large edit")
        cancelled=images["outcome"](one,"cancelled")
        images["wait_scenarios"](one,["image-generate","image-edit-response-attempted"])
        assert names(one,1)==[source] and digest(path)==source_sha
        tasks["select_project"](one,SOUTH,new=True)
        one.send("Generate an image of a small pebble.")
        small,=names(one,1)
        assert small!=source
        assert stored(profile,small).parent!=path.parent
        one.quit()
    finally:
        one.stop_if_running()
    two=tasks["Window"](binary,profile,evidence,"formal-reopened")
    try:
        two.ready()
        assert one.proc.pid!=two.proc.pid
        for project,name in ((SOUTH,small),(NORTH,source)):
            tasks["select_project"](two,project)
            tasks["enter_session"](two)
            assert names(two,1)==[name]
        assert images["outcome"](two,"cancelled")==cancelled
        original=full(two,source,path)
        assert tasks["scenarios"](two)==[] and digest(target)==original["sha256"]==source_sha
        assert list(path.parent.glob("img-*.png"))==[path]
        two.quit()
    finally:
        two.stop_if_running()
    return {"pids":[one.proc.pid,two.proc.pid],"binary":digest(binary),"projects":[NORTH,SOUTH],"source":source,
            "otherSessionImage":small,"cancelled":cancelled,"restoreRequestDelta":0,"thumbnail":thumb,
            "metadata":metadata_scan(profile),"zoom":original,
            "syntheticSaveAs":{"sha256":digest(target),"bytes":target.stat().st_size,"path":str(target)}}


if __name__=="__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--channels-binary",type=Path)
    p.add_argument("--formal-binary",type=Path)
    p.add_argument("--previous-binary",type=Path)
    a=p.parse_args()
    if not __debug__ or not(a.channels_binary or a.formal_binary) or (a.previous_binary and not a.channels_binary):
        p.error("Provide at least one isolated QA binary and enable assertions.")
    evidence=Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-large-images-",dir="/private/tmp"))
    print("Evidence:",evidence,flush=True)
    for name,binary,run in (("channels",a.channels_binary,channels),("formal",a.formal_binary,formal)):
        if binary:
            resolved=binary.resolve(strict=True)
            report=run(resolved,evidence,a.previous_binary.resolve(strict=True) if a.previous_binary else None) if name=="channels" else run(resolved,evidence)
            (evidence/f"{name}.json").write_text(json.dumps(report,indent=2)+"\n")
            print(name, json.dumps(report),flush=True)

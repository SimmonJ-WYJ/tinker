"""Verify authenticated text and image routes in the native QA window with two owned listeners."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
from runpy import run_path
import subprocess
import tempfile
import time
import uuid

HERE = Path(__file__).resolve().parent
common = run_path(str(HERE/"native-session-import-qa.py"))
images = run_path(str(HERE/"native-project-image-task-qa.py"))
Window, choose, named = common["Window"], common["choose"], common["click_named"]
A, B = "Cedar QA provider", "Harbor QA provider"
IMAGE, TEXT = "gpt-image-1","owned-text"
ASK = "Describe an orchard in one sentence."
GEN_A = "A green apple on a white table."
GEN_B = "A harbor at sunrise."
EDIT = "Add a violet tree to the foreground. [qa:image-retry]"


class ChannelWindow(Window):
    def __init__(self, binary, profile, evidence, label):
        self.directory = evidence/"native-qa"/label
        self.directory.mkdir(mode=0o700,parents=True)
        with (evidence/f"{label}.log").open("w") as log:
            self.proc = subprocess.Popen([binary], env={**os.environ,"TINKER_CHANNELS_PREVIEW_ROOT":str(profile),
                "TINKER_NATIVE_QA_DIR":str(self.directory)},stdout=log,stderr=subprocess.STDOUT)


def endpoint(profile, name):
    data = json.loads((profile/f"qa-{name}endpoint.json").read_text())
    return f"http://127.0.0.1:{data['port']}/v1"


def observations(profile):
    return [json.loads((profile/f"qa-{prefix}observations.json").read_text()) for prefix in ("","secondary-")]


def counts(profile):
    return [[c["getCount"],c["postCount"]] for c in observations(profile)]


def async_read(w, js):
    w.js(f"""window.__qaChannelRead=null;void (async()=>{{ {js} }})()
        .then(v=>window.__qaChannelRead={{value:v}}).catch(e=>window.__qaChannelRead={{error:String(e)}});return true;""")
    reply=w.wait("return window.__qaChannelRead","native public metadata")
    assert "error" not in reply, reply
    return reply["value"]


def catalog(w):
    return async_read(w,"""return (await window.electronAPI.listChannels()).map(c=>({
        id:c.id,name:c.name,models:c.models.map(m=>[m.id,m.capability,m.enabled])}));""")


def defaults(w):
    return async_read(w,"""const s=await window.electronAPI.getSettings();return [s.agentChannelId,s.agentModelId];""")


def open_settings(w):
    choose(w,".sidebar-account-trigger","open Settings")
    named(w,"[role=dialog] button",["Models & Channels","模型与渠道"])


def input_value(w, selector, value):
    w.wait(f"""const i=document.querySelector({json.dumps(selector)});if(!i||i.disabled)return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,{json.dumps(value)});
        i.dispatchEvent(new Event('input',{{bubbles:true}}));return true;""","enter visible channel field")


def open_menu(w, selector):
    w.wait(f"""const b=document.querySelector({json.dumps(selector)});if(!b||b.disabled)return false;
        b.focus();b.dispatchEvent(new KeyboardEvent('keydown',{{key:'ArrowDown',bubbles:true}}));return true;""",
        "open native renderer selector")


def add_provider(w,name,base,slot):
    choose(w,'[data-spotlight-target=add-channel]',"add provider")
    open_menu(w,'[role=dialog] button[role=combobox]')
    w.wait("""const o=[...document.querySelectorAll('[role=option]')].find(el=>el.textContent.includes('Custom relay · OpenAI'));
        if(!o)return false;o.focus();o.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true;""",
        "choose OpenAI-compatible relay")
    input_value(w,'input[placeholder="e.g. My Anthropic"]',name)
    input_value(w,'input[placeholder="e.g. https://api.example.com"]',base)
    assert w.command("type-owned-key",slot=slot) is True
    named(w,"[role=dialog] button",["Refresh"])
    # The form starts discovered models disabled; choose both explicitly.
    for model in (TEXT,IMAGE):
        w.wait(f"""const row=[...document.querySelectorAll('[role=switch]')].find(el=>
            (el.parentElement?.innerText??'').includes({json.dumps(model)}));
            if(!row||row.disabled)return false;if(row.getAttribute('aria-checked')!=='true')row.click();return true;""",
            "enable discovered model "+model)
    named(w,"[role=dialog] button",["Test connection"])
    named(w,"[role=dialog] button",["Create"])
    w.wait(f"""return [...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==='Edit '+{json.dumps(name)});""",
        "provider persisted and shown in Settings")


def select_model(w, channel, model):
    w.wait("""const b=document.querySelector('.conversation-model-selector') ??
        [...document.querySelectorAll('button[aria-haspopup=menu]')].find(el=>/owned-text|gpt-image-1/.test(el.innerText));
        if(!b||b.disabled)return false;b.focus();
        b.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));return true;""",
        "open home or conversation model selector")
    w.wait(f"""const item=[...document.querySelectorAll('[role=menuitem]')].find(e=>
        e.dataset.modelChannel==={json.dumps(channel)}&&e.dataset.modelId==={json.dumps(model)});
        if(!item)return false;item.click();return true;""","select discovered model in its own channel")
    w.wait("return !document.querySelector('[role=menu][data-state=open]')","model menu closed")
    until=time.monotonic()+5
    while defaults(w)!=[channel,model]:
        assert time.monotonic()<until,"selected channel/model not persisted"
        time.sleep(.1)


def check_posts(profile, expected):
    until=time.monotonic()+4
    while True:
        obs=observations(profile)
        completed=[[(e["phase"],e["keyVersion"]) for e in c["events"] if e["method"]=="POST" and e["phase"]!="accepted"] for c in obs]
        if completed==expected and not any(c["activeHandlers"] for c in obs):
            assert [s["postCount"] for s in obs]==[len(e) for e in expected]
            return
        if time.monotonic()>=until:
            raise AssertionError(f"Unexpected POST delivery: {completed} expected {expected}")
        time.sleep(.1)


def process_check(w):
    assert async_read(w,"return await window.electronAPI.getRuntimeStatus();") is None
    found=[]
    pending=[w.proc.pid]
    while pending:
        pid=pending.pop()
        name=subprocess.run(["/bin/ps","-p",str(pid),"-o","comm="],capture_output=True,text=True).stdout.strip()
        if name:
            found.append({"pid":pid,"executable":Path(name).name})
            assert all(s not in name.lower() for s in ("/electron","/node","/bun")),name
        children=subprocess.run(["/usr/bin/pgrep","-P",str(pid)],capture_output=True,text=True)
        assert children.returncode in (0,1)
        pending.extend(int(s) for s in children.stdout.split())
    return found


def check_test_keys(profile,evidence):
    # Both public sentinel values are fixed by the finite fake vault. The QA text-entry command
    # takes a slot number, so the command file never contains either value.
    keys=[s.encode(encoding) for s in ("tinker-qa-finite-key-one","tinker-qa-finite-key-two")
          for encoding in ("utf-8","utf-16-le","utf-16-be")]
    checked=0
    for root in (profile,evidence):
        for file in root.rglob("*"):
            if file.is_file():
                data=file.read_bytes()
                assert not any(key in data for key in keys),f"Synthetic key found in {file.name}"
                checked+=1
    return checked


def acceptance(binary):
    if not __debug__ or binary.name!="tinker-channels-native-qa":
        raise ValueError("Use the dedicated channels native QA app with assertions enabled")
    plist=plistlib.loads((binary.parent.parent/"Info.plist").read_bytes())
    assert plist["CFBundleIdentifier"]=="com.tinker.channels-native-qa"
    evidence=Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-channel-models-",dir="/private/tmp"))
    profile=Path("/private/tmp")/("tinker-tauri-channels-preview-model-routes-"+uuid.uuid4().hex)
    print("Evidence:",evidence,flush=True)
    one=ChannelWindow(binary,profile,evidence,"configure")
    processes=[]
    try:
        one.wait("return !!document.querySelector('.sidebar-account-trigger')","native workbench")
        bases=[endpoint(profile,s) for s in ("","secondary-")]
        assert bases[0]!=bases[1] and counts(profile)==[[0,0],[0,0]]
        open_settings(one)
        add_provider(one,A,bases[0],1)
        add_provider(one,B,bases[1],2)
        rows=catalog(one)
        assert len(rows)==2,rows
        for row in rows:
            assert sorted(row["models"])==sorted([[TEXT,"text",True],[IMAGE,"image",True]]),row
        ids={c["name"]:c["id"] for c in rows}
        assert ids[A]!=ids[B]
        discovery=counts(profile)
        assert discovery==[[2,0],[2,0]],discovery
        common["close_settings"](one)
        processes.append(process_check(one))
        select_model(one,ids[A],TEXT)
        one.send(ASK)
        one.wait("return document.querySelector('.conversation-column__messages')?.innerText.includes('Owned QA streamed text completed.')","text reply through provider A")
        ea=[("completed",1)]
        eb=[]
        check_posts(profile,[ea,eb])
        select_model(one,ids[A],IMAGE)
        one.send(GEN_A)
        source,=one.cards(1)
        ea.append(("image-generated",1))
        check_posts(profile,[ea,eb])
        select_model(one,ids[B],IMAGE)
        one.send(GEN_B)
        shore=images["added"](one.cards(2),[source])
        eb.append(("image-generated",2))
        check_posts(profile,[ea,eb])
        one.edit(source,EDIT)
        failed=images["outcome"](one,"failed")
        eb.append(("image-edit-failed",2))
        check_posts(profile,[ea,eb])
        assert set(one.cards(2))=={source,shore}
        source_id=one.sent_thumbnail(source)
        select_model(one,ids[A],IMAGE)
        before=counts(profile)
        assert before==[[2,2],[2,2]],before
        one.quit()
    finally:
        one.stop_if_running()
    two=ChannelWindow(binary,profile,evidence,"reopened")
    try:
        two.ready()
        assert one.proc.pid!=two.proc.pid and catalog(two)==rows
        if not two.js("return !!document.querySelector('[data-native-task-status=failed]')"):
            choose(two,".home-recent-session","open saved session")
        assert images["outcome"](two,"failed")==failed and set(two.cards(2))=={source,shore}
        assert defaults(two)==[ids[A],IMAGE]
        assert two.sent_thumbnail(source)==source_id
        images["see_image"](two,source)
        images["see_image"](two,shore)
        assert counts(profile)==before
        # Composer points to A, while the failed edit belongs to B and referenced A's image.
        images["retry"](two)
        child=images["added"](two.cards(3),[source,shore])
        succeeded=images["outcome"](two,"completed")
        assert failed!=succeeded
        eb.append(("image-edited",2))
        check_posts(profile,[ea,eb])
        comparison=images["compare_painted"](two,source,child)
        processes.append(process_check(two))
        two.quit()
    finally:
        two.stop_if_running()
    obs=observations(profile)
    assert all(row["unauthorizedRequests"]==row["activeHandlers"]==0 for row in obs)
    assert [[row[key] for key in ("keyOneGets","keyTwoGets","keyOnePosts","keyTwoPosts")]
            for row in obs]==[[2,0,2,0],[0,2,0,3]]
    scanned=check_test_keys(profile,evidence)
    report={"binarySha256":hashlib.sha256(binary.read_bytes()).hexdigest(),"pids":[one.proc.pid,two.proc.pid],
            "catalog":rows,"ownedBases":bases,"initialDiscoveryCounts":discovery,"reopeningRequests":0,
            "observations":obs,"original":source,"providerBGeneration":shore,"retryResult":child,
            "failedRequestId":failed,"retriedRequestId":succeeded,"paintedComparison":comparison,
            "scannedProfileAndEvidenceFiles":scanned,"observedAppProcesses":processes}
    (evidence/"summary.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2),flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary",type=Path)
    acceptance(parser.parse_args().binary.resolve(strict=True))

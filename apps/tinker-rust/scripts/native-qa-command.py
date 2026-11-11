"""仅向独立 QA binary 的 owned evidence 目录提交有界测试动作。"""
import json
import os
from pathlib import Path
import sys
import time

root = Path(sys.argv[1]).resolve(strict=True)
if root.parent.name != "native-qa" or not root.parent.parent.name.startswith("tinker-tauri-checks-") or not root.is_relative_to("/private/tmp"):
    raise SystemExit("仅允许本批临时 QA evidence 目录")
command = json.loads(sys.argv[2])
sequence = max([int(p.stem.split("-")[1]) for p in root.glob("result-*.json")] + [0]) + 1
if sequence > 256:
    raise SystemExit("已达到本进程测试动作上限")
command["sequence"] = sequence
(root / "next.json").write_text(json.dumps(command))
os.replace(root / "next.json", root / "command.json")
for _ in range(200):
    result = root / f"result-{sequence}.json"
    if result.exists():
        print(result.read_text())
        break
    time.sleep(0.1)
else:
    raise SystemExit("20 秒内没有 QA 回包")
